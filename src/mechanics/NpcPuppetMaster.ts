import type { ILlmProvider, LlmProviderContent, LlmProviderMessage } from './llm/ILlmProvider';
import { ActorPlanExecutor } from './ActorPlanExecutor';
import { NpcWorldModelBuilder } from './NpcWorldModelBuilder';
import type { IGame } from '../core/IGame';
import type { Scene } from '../scene/Scene';
import { Actor } from '../entities/Actor';
import type { ActorMoveResult } from '../entities/Actor';
import { ComponentSystem } from '../systems/ComponentSystem';
import type {
  NpcPlan,
  NpcPlanExecutionOutcome,
  NpcPlanStep,
  NpcPuppetMasterDebugInfo,
  NpcPuppetMasterResponse,
  NpcWorldModel,
} from './npcTypes';

const SYSTEM_PROMPT_URL = '/text/system/npc-pm-system.md';
const FALLBACK_SYSTEM_PROMPT = [
  'You are the Puppet Master for NPCs in a retro adventure game.',
  'Respond with exactly one JSON object and no extra text.',
  'Return {"kind":"pm_response","plans":[...]}.',
  'Each plan must target a real NPC id from context.',
  'Reliable steps are SAY, MEMORY_SET, OBJECTIVES_SET, WAIT, MOVE_TO, LOOK, EXAMINE, OPEN, CLOSE, TAKE, PUT, COMMAND, and USE.',
  'Prefer COMMAND when a visible entity lists a suitable authored command; use USE only as fallback.',
  'Hidden entities absent from context are unknown; inspect known anchors with LOOK or EXAMINE.',
  'Titled objects inside inactive Subscenes may be used through virtual NPC access without opening the player view.',
  'OPEN and CLOSE use real Switch rules, including keys held by the acting NPC.',
  'Do not claim actions succeeded before a successful action_completed result.',
  'Emit at most one consequential action per NPC plan and wait for its outcome.',
  'inventory.available false means the Actor has no inventory, not that it is full.',
  'Do not store attempted actions as successful facts in memory.',
  'Do not repeat an action when worldChanged is false and repeatCount is 2 or more.',
].join('\n');

type NpcIndividualTrigger =
  | {
      type: 'wait_elapsed';
      ms: number;
    }
  | {
      type: 'manual';
      reason?: string;
    }
  | {
      type: 'plan_continued';
      reason: string;
    }
  | {
      type: 'move_completed';
      result: ActorMoveResult;
    }
  | {
      type: 'action_completed';
      result: NpcPlanExecutionOutcome;
    };

type NpcBatchTrigger = {
  type: 'batch';
  triggersByNpc: Record<string, NpcIndividualTrigger[]>;
};

type PendingNpcBatch = {
  scene: Scene;
  npcIds: Set<string>;
  triggersByNpc: Map<string, NpcIndividualTrigger[]>;
  timeoutId: any;
  completionResolvers: Array<() => void>;
};

type NpcLoopState = {
  repeatKey: string;
  count: number;
  cooldownUntil: number;
};

const PM_BATCH_DEBOUNCE_MS = 150;
const PM_REPEAT_WARNING_COUNT = 2;
const PM_REPEAT_SUPPRESS_COUNT = 3;
const PM_LOOP_COOLDOWN_MS = 10_000;
const PM_RATE_WINDOW_MS = 10_000;
const PM_MAX_NPC_CALLS_PER_WINDOW = 6;
const PM_MAX_SCENE_CALLS_PER_WINDOW = 12;

export class NpcPuppetMaster {
  private provider: ILlmProvider;
  private readonly worldModelBuilder: NpcWorldModelBuilder;
  private readonly executor: ActorPlanExecutor;
  private readonly game: IGame;
  private systemPromptCache: string | null = null;
  private processingScenes = new Set<string>();
  private lastDebugInfo: NpcPuppetMasterDebugInfo | null = null;
  private haltGenerationId = 0;
  private waitTimeouts = new Map<string, any>();
  private pendingBatches = new Map<string, PendingNpcBatch>();
  private loopStates = new Map<string, NpcLoopState>();
  private npcCallTimes = new Map<string, number[]>();
  private sceneCallTimes = new Map<string, number[]>();

  constructor(game: IGame, provider: ILlmProvider) {
    this.game = game;
    this.provider = provider;
    this.worldModelBuilder = new NpcWorldModelBuilder(game);
    this.executor = new ActorPlanExecutor(
      game,
      (npcId, ms) => {
        const existing = this.waitTimeouts.get(npcId);
        if (existing) {
          globalThis.clearTimeout(existing);
        }
        const timeoutId = globalThis.setTimeout(() => {
          this.waitTimeouts.delete(npcId);
          const scene = game.sceneManager.currentScene;
          if (scene) {
            this.scheduleNpc(scene, npcId, { type: 'wait_elapsed', ms });
          }
        }, ms);
        this.waitTimeouts.set(npcId, timeoutId);
      },
      (npcId, result) => {
        const scene = game.sceneManager.currentScene;
        if (scene) {
          this.scheduleNpc(scene, npcId, { type: 'move_completed', result });
        }
      },
      (npcId, result) => {
        const scene = game.sceneManager.currentScene;
        if (scene) {
          this.scheduleNpc(scene, npcId, {
            type: 'action_completed',
            result: this.recordActionProgress(scene, npcId, result),
          });
        }
      }
    );
  }

  setProvider(provider: ILlmProvider): void {
    this.provider = provider;
  }

  haltAllNpcs(): void {
    this.haltGenerationId++;
    for (const timeoutId of this.waitTimeouts.values()) {
      globalThis.clearTimeout(timeoutId);
    }
    this.waitTimeouts.clear();
    for (const batch of this.pendingBatches.values()) {
      globalThis.clearTimeout(batch.timeoutId);
      batch.completionResolvers.forEach((resolve) => resolve());
    }
    this.pendingBatches.clear();
    this.loopStates.clear();
    this.npcCallTimes.clear();
    this.sceneCallTimes.clear();
    this.executor.clearAllPending();

    const scene = this.game.sceneManager.currentScene;
    if (!scene) return;

    for (const entity of scene.entities) {
      if (entity instanceof Actor && ComponentSystem.isNpc(entity)) {
        entity.stop();
        this.executor.clearState(entity.name);
      }
    }
  }

  getLastDebugInfo(): NpcPuppetMasterDebugInfo | null {
    return this.lastDebugInfo;
  }

  traceWake(stage: string, details: Record<string, unknown> = {}): void {
    const console = (this.game as any).console;
    if (!console?.parserPeekPmEnabled) return;
    const body = Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
    const message = `--- PM WAKE TRACE ---\n${stage}${body}`;
    if (typeof console.logDebug === 'function') {
      console.logDebug(message);
    } else if (typeof console.log === 'function') {
      console.log(message, 'info', { showInClosed: false });
    }
  }

  async scheduleScene(scene: Scene): Promise<void> {
    const npcStates = this.worldModelBuilder.getNpcActors(scene).map((npc) => ({
      npcId: npc.name,
      cursor: scene.sceneLog.lastPmProcessedAtByNpc[npc.name] ?? scene.sceneLog.lastPmProcessedAt,
      unread: scene.sceneLog.getUnreadEntries(npc.name).map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        timestamp: entry.timestamp,
      })),
    }));
    const unreadNpcIds = npcStates
      .filter((state) => state.unread.length > 0)
      .map((state) => state.npcId);
    this.traceWake('schedule_scene_scan', {
      sceneId: scene.id,
      npcStates,
      selectedNpcIds: unreadNpcIds,
    });
    if (!unreadNpcIds.length) {
      this.traceWake('schedule_scene_stopped', {
        reason: 'no_npc_with_unread_events',
        sceneEntries: scene.sceneLog.entries.length,
      });
      return;
    }

    // External scene events such as player speech must never be starved by an
    // autonomous NPC chain that exhausted its background rate budget.
    this.sceneCallTimes.delete(scene.id);
    const completions: Promise<void>[] = [];
    for (const npcId of unreadNpcIds) {
      this.clearLoopSuppression(scene, npcId);
      this.npcCallTimes.delete(this.getNpcStateKey(scene, npcId));
      completions.push(this.enqueueNpc(scene, npcId));
    }
    await Promise.all(completions);
  }

  scheduleNpc(scene: Scene, npcId: string, trigger: NpcIndividualTrigger): void {
    const loopState = this.loopStates.get(this.getNpcStateKey(scene, npcId));
    if (
      trigger.type === 'action_completed' &&
      loopState?.cooldownUntil &&
      loopState.cooldownUntil > Date.now() &&
      trigger.result.repeatKey === loopState.repeatKey &&
      (trigger.result.repeatCount || 0) > PM_REPEAT_SUPPRESS_COUNT
    ) {
      return;
    }
    void this.enqueueNpc(scene, npcId, trigger);
  }

  async processScene(scene: Scene): Promise<NpcPlan[]> {
    const unreadEntries = scene.sceneLog.getUnreadEntries();
    if (!unreadEntries.length) return [];
    const processingKey = `scene:${scene.id}`;
    if (this.processingScenes.has(processingKey)) return [];
    if (!this.provider.isAvailable()) {
      this.lastDebugInfo = {
        matched: false,
        provider: this.provider.getProviderName(),
        model: this.provider.getModelName(),
        error: 'provider_unavailable',
      };
      this.logPeekDebug();
      return [];
    }

    const currentGeneration = this.haltGenerationId;
    this.processingScenes.add(processingKey);
    try {
      const worldModel = this.worldModelBuilder.build(scene);
      const plans = await this.processWorldModel(worldModel);
      if (this.haltGenerationId !== currentGeneration) return [];
      if (this.lastDebugInfo?.error) return [];
      for (const npc of worldModel.npcs) {
        scene.sceneLog.markProcessed(undefined, npc.id);
      }
      scene.sceneLog.markProcessed();
      return plans;
    } finally {
      this.processingScenes.delete(processingKey);
    }
  }

  async processNpc(
    scene: Scene,
    npcId: string,
    trigger: NpcIndividualTrigger = { type: 'manual' }
  ): Promise<NpcPlan[]> {
    const processingKey = `npc:${scene.id}:${npcId}`;
    if (this.processingScenes.has(processingKey)) return [];
    if (!this.provider.isAvailable()) {
      this.lastDebugInfo = {
        matched: false,
        provider: this.provider.getProviderName(),
        model: this.provider.getModelName(),
        error: 'provider_unavailable',
      };
      this.logPeekDebug();
      return [];
    }

    const currentGeneration = this.haltGenerationId;
    this.processingScenes.add(processingKey);
    try {
      const fullWorldModel = this.worldModelBuilder.build(scene);
      const worldModel = {
        ...fullWorldModel,
        npcs: fullWorldModel.npcs.filter((npc) => npc.id === npcId),
      };
      if (!worldModel.npcs.length) return [];
      const plans = await this.processWorldModel(worldModel, trigger);
      if (this.haltGenerationId !== currentGeneration) return [];
      if (!this.lastDebugInfo?.error) {
        scene.sceneLog.markProcessed(undefined, npcId);
      }
      return plans;
    } finally {
      this.processingScenes.delete(processingKey);
    }
  }

  private async processWorldModel(
    worldModel: NpcWorldModel,
    trigger?: NpcIndividualTrigger | NpcBatchTrigger
  ): Promise<NpcPlan[]> {
    const currentGeneration = this.haltGenerationId;
    const system = await this.buildSystemPrompt(worldModel);
    const messages = this.buildMessages(worldModel, trigger);
    const response = await this.provider.sendMessageStream(system, messages, () => {});

    if (this.haltGenerationId !== currentGeneration) {
      return [];
    }

    if (!response.ok) {
      this.lastDebugInfo = {
        matched: false,
        provider: this.provider.getProviderName(),
        model: this.provider.getModelName(),
        prompt: { system, messages },
        rawResponse: response.text,
        error: response.error || response.reason || 'api_error',
        durationMs: response.durationMs,
        inputTokens: response.inputTokens,
        tokensGenerated: response.tokensGenerated,
        cacheCreationInputTokens: response.cacheCreationInputTokens,
        cacheReadInputTokens: response.cacheReadInputTokens,
      };
      this.logPeekDebug();
      return [];
    }

    const extractedJson = this.extractJson(response.text);
    const parsed = this.parseJson(extractedJson);
    const normalized = this.normalizeResponse(parsed, worldModel);
    this.lastDebugInfo = {
      matched: normalized.plans.length > 0,
      provider: this.provider.getProviderName(),
      model: this.provider.getModelName(),
      prompt: { system, messages },
      rawResponse: response.text,
      extractedJson,
      acceptedPlans: normalized.plans,
      filteredPlans: normalized.filteredPlans,
      error: normalized.valid ? undefined : 'invalid_response',
      durationMs: response.durationMs,
      inputTokens: response.inputTokens,
      tokensGenerated: response.tokensGenerated,
      cacheCreationInputTokens: response.cacheCreationInputTokens,
      cacheReadInputTokens: response.cacheReadInputTokens,
    };
    this.logPeekDebug();

    if (!normalized.valid) return [];

    for (const plan of normalized.plans) {
      const outcomes = this.executor.executePlan(plan);
      const planTrigger =
        trigger?.type === 'batch'
          ? [...(trigger.triggersByNpc[plan.npcId] || [])]
              .reverse()
              .find((candidate) => candidate.type === 'move_completed')
          : trigger;
      this.maybeScheduleContinuation(
        [plan],
        planTrigger,
        outcomes.some((outcome) => outcome.status === 'scheduled')
      );
    }
    return normalized.plans;
  }

  private maybeScheduleContinuation(
    plans: NpcPlan[],
    trigger: NpcIndividualTrigger | undefined,
    hasScheduledStep: boolean
  ): void {
    if (hasScheduledStep || trigger?.type !== 'move_completed') return;

    for (const plan of plans) {
      const shouldContinue =
        typeof plan.memory === 'string' ||
        plan.steps.some((step) => step.type === 'MEMORY_SET' || step.type === 'OBJECTIVES_SET');
      if (!shouldContinue) continue;

      globalThis.setTimeout(() => {
        const scene = this.game.sceneManager.currentScene;
        if (!scene) return;
        this.scheduleNpc(scene, plan.npcId, {
          type: 'plan_continued',
          reason: 'previous_plan_updated_memory_or_objectives_without_scheduling_action',
        });
      }, 0);
    }
  }

  private async buildSystemPrompt(worldModel: NpcWorldModel): Promise<LlmProviderContent> {
    const systemPrompt = await this.loadSystemPrompt();
    const staticContext = {
      scene: worldModel.scene,
      npcs: worldModel.npcs.map((npc) => ({
        id: npc.id,
        title: npc.title,
        lore: npc.lore,
      })),
    };

    return [
      { type: 'text', text: systemPrompt },
      {
        type: 'text',
        text: ['## Scene-Static NPC Context', JSON.stringify(staticContext, null, 2)].join('\n'),
        cacheControl: { type: 'ephemeral', ttl: '5m' },
      },
    ];
  }

  private buildMessages(
    worldModel: NpcWorldModel,
    trigger?: NpcIndividualTrigger | NpcBatchTrigger
  ): LlmProviderMessage[] {
    const dynamicContext = {
      ...(trigger ? { trigger } : {}),
      npcs: worldModel.npcs.map((npc) => ({
        id: npc.id,
        objectives: npc.objectives,
        memory: npc.memory,
        inventory: npc.inventory,
        actors: npc.actors,
        newEvents: npc.newEvents,
        recentEvents: npc.recentEvents,
        entities: npc.entities,
      })),
    };

    return [
      {
        role: 'user',
        content: [
          'Per-call dynamic NPC context:',
          JSON.stringify(dynamicContext, null, 2),
          '',
          'Return only {"kind":"pm_response","plans":[...]}.',
        ].join('\n'),
      },
    ];
  }

  private enqueueNpc(scene: Scene, npcId: string, trigger?: NpcIndividualTrigger): Promise<void> {
    let resolveCompletion: () => void = () => {};
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    let batch = this.pendingBatches.get(scene.id);
    if (!batch) {
      batch = {
        scene,
        npcIds: new Set(),
        triggersByNpc: new Map(),
        timeoutId: null,
        completionResolvers: [],
      };
      this.pendingBatches.set(scene.id, batch);
    }
    batch.npcIds.add(npcId);
    if (trigger) {
      const triggers = batch.triggersByNpc.get(npcId) || [];
      triggers.push(trigger);
      batch.triggersByNpc.set(npcId, triggers);
    }
    batch.completionResolvers.push(resolveCompletion);
    this.traceWake('batch_enqueued', {
      sceneId: scene.id,
      npcId,
      triggerType: trigger?.type,
      batchNpcIds: [...batch.npcIds],
      alreadyScheduled: !!batch.timeoutId,
    });
    if (batch.timeoutId) return completion;
    batch.timeoutId = globalThis.setTimeout(() => {
      void this.flushBatch(scene.id);
    }, PM_BATCH_DEBOUNCE_MS);
    return completion;
  }

  private async flushBatch(sceneId: string): Promise<void> {
    const batch = this.pendingBatches.get(sceneId);
    if (!batch) {
      this.traceWake('batch_stopped', { sceneId, reason: 'batch_not_found' });
      return;
    }
    this.pendingBatches.delete(sceneId);
    const { scene } = batch;
    if (scene !== this.game.sceneManager.currentScene) {
      this.traceWake('batch_stopped', {
        sceneId,
        reason: 'scene_is_no_longer_current',
      });
      batch.completionResolvers.forEach((resolve) => resolve());
      return;
    }
    if (!this.provider.isAvailable()) {
      this.traceWake('batch_stopped', {
        sceneId,
        reason: 'provider_unavailable',
        provider: this.provider.getProviderName(),
        model: this.provider.getModelName(),
      });
      batch.completionResolvers.forEach((resolve) => resolve());
      return;
    }

    if (!this.consumeSceneRateBudget(scene)) {
      this.traceWake('batch_deferred', {
        sceneId,
        reason: 'scene_rate_limit',
        npcIds: [...batch.npcIds],
      });
      this.deferBatch(batch);
      batch.completionResolvers.forEach((resolve) => resolve());
      return;
    }
    const allowedNpcIds = [...batch.npcIds].filter((npcId) =>
      this.consumeNpcRateBudget(scene, npcId)
    );
    const deferredNpcIds = [...batch.npcIds].filter((npcId) => !allowedNpcIds.includes(npcId));
    if (deferredNpcIds.length) {
      this.traceWake('batch_deferred', {
        sceneId,
        reason: 'npc_rate_limit',
        npcIds: deferredNpcIds,
      });
      this.deferBatch(batch, deferredNpcIds);
    }
    if (!allowedNpcIds.length) {
      this.traceWake('batch_stopped', {
        sceneId,
        reason: 'no_npc_passed_rate_limit',
      });
      batch.completionResolvers.forEach((resolve) => resolve());
      return;
    }

    const processingKey = `batch:${scene.id}`;
    if (this.processingScenes.has(processingKey)) {
      this.traceWake('batch_requeued', {
        sceneId,
        reason: 'scene_batch_already_processing',
        npcIds: allowedNpcIds,
      });
      for (const npcId of allowedNpcIds) {
        for (const trigger of batch.triggersByNpc.get(npcId) || []) {
          void this.enqueueNpc(scene, npcId, trigger);
        }
      }
      batch.completionResolvers.forEach((resolve) => resolve());
      return;
    }

    this.processingScenes.add(processingKey);
    try {
      const fullWorldModel = this.worldModelBuilder.build(scene);
      const worldModel = {
        ...fullWorldModel,
        npcs: fullWorldModel.npcs.filter((npc) => allowedNpcIds.includes(npc.id)),
      };
      if (!worldModel.npcs.length) {
        this.traceWake('batch_stopped', {
          sceneId,
          reason: 'selected_npcs_missing_from_world_model',
          npcIds: allowedNpcIds,
        });
        return;
      }
      const triggersByNpc = Object.fromEntries(
        allowedNpcIds
          .map((npcId) => [npcId, batch.triggersByNpc.get(npcId) || []] as const)
          .filter(([, triggers]) => triggers.length > 0)
      );
      this.traceWake('provider_request_start', {
        sceneId,
        npcIds: worldModel.npcs.map((npc) => npc.id),
        triggerNpcIds: Object.keys(triggersByNpc),
        provider: this.provider.getProviderName(),
        model: this.provider.getModelName(),
      });
      await this.processWorldModel(
        worldModel,
        Object.keys(triggersByNpc).length ? { type: 'batch', triggersByNpc } : undefined
      );
      if (!this.lastDebugInfo?.error) {
        for (const npcId of allowedNpcIds) {
          scene.sceneLog.markProcessed(undefined, npcId);
        }
      }
    } finally {
      this.processingScenes.delete(processingKey);
      batch.completionResolvers.forEach((resolve) => resolve());
    }
  }

  private recordActionProgress(
    scene: Scene,
    npcId: string,
    result: NpcPlanExecutionOutcome
  ): NpcPlanExecutionOutcome {
    const stateKey = this.getNpcStateKey(scene, npcId);
    const repeatKey =
      result.repeatKey || `${result.actionType || 'ACTION'}:${result.targetId || ''}`;
    if (result.worldChanged || !repeatKey) {
      this.loopStates.delete(stateKey);
      return { ...result, repeatCount: 0 };
    }

    const previous = this.loopStates.get(stateKey);
    const count = previous?.repeatKey === repeatKey ? previous.count + 1 : 1;
    const cooldownUntil = count >= PM_REPEAT_SUPPRESS_COUNT ? Date.now() + PM_LOOP_COOLDOWN_MS : 0;
    this.loopStates.set(stateKey, { repeatKey, count, cooldownUntil });
    if (count < PM_REPEAT_WARNING_COUNT) return { ...result, repeatCount: count };
    return {
      ...result,
      status: count >= PM_REPEAT_SUPPRESS_COUNT ? 'failed' : result.status,
      code: count >= PM_REPEAT_SUPPRESS_COUNT ? 'repeated_without_progress' : result.code,
      repeatCount: count,
      message:
        count >= PM_REPEAT_SUPPRESS_COUNT
          ? 'The same action produced no new information or world change repeatedly.'
          : result.message,
    };
  }

  private consumeNpcRateBudget(scene: Scene, npcId: string): boolean {
    const now = Date.now();
    const cutoff = now - PM_RATE_WINDOW_MS;
    const npcKey = this.getNpcStateKey(scene, npcId);
    const npcTimes = (this.npcCallTimes.get(npcKey) || []).filter((time) => time >= cutoff);
    if (npcTimes.length >= PM_MAX_NPC_CALLS_PER_WINDOW) return false;
    npcTimes.push(now);
    this.npcCallTimes.set(npcKey, npcTimes);
    return true;
  }

  private consumeSceneRateBudget(scene: Scene): boolean {
    const now = Date.now();
    const cutoff = now - PM_RATE_WINDOW_MS;
    const sceneTimes = (this.sceneCallTimes.get(scene.id) || []).filter((time) => time >= cutoff);
    if (sceneTimes.length >= PM_MAX_SCENE_CALLS_PER_WINDOW) return false;
    sceneTimes.push(now);
    this.sceneCallTimes.set(scene.id, sceneTimes);
    return true;
  }

  private clearLoopSuppression(scene: Scene, npcId: string): void {
    this.loopStates.delete(this.getNpcStateKey(scene, npcId));
  }

  private deferBatch(batch: PendingNpcBatch, npcIds: string[] = [...batch.npcIds]): void {
    globalThis.setTimeout(() => {
      for (const npcId of npcIds) {
        const triggers = batch.triggersByNpc.get(npcId) || [];
        if (!triggers.length) {
          void this.enqueueNpc(batch.scene, npcId);
          continue;
        }
        for (const trigger of triggers) {
          void this.enqueueNpc(batch.scene, npcId, trigger);
        }
      }
    }, 1000);
  }

  private getNpcStateKey(scene: Scene, npcId: string): string {
    return `${scene.id}:${npcId}`;
  }

  private async loadSystemPrompt(): Promise<string> {
    if (this.systemPromptCache) return this.systemPromptCache;
    if (typeof fetch !== 'function') {
      this.systemPromptCache = FALLBACK_SYSTEM_PROMPT;
      return this.systemPromptCache;
    }

    try {
      const response = await fetch(SYSTEM_PROMPT_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const prompt = await response.text();
      this.systemPromptCache = prompt.trim() || FALLBACK_SYSTEM_PROMPT;
    } catch {
      this.systemPromptCache = FALLBACK_SYSTEM_PROMPT;
    }
    return this.systemPromptCache;
  }

  private extractJson(text: string): string {
    const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/.exec(text);
    if (fenceMatch?.[1]) return fenceMatch[1].trim();
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return text.slice(firstBrace, lastBrace + 1).trim();
    }
    return text.trim();
  }

  private parseJson(text: string): unknown | null {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private logPeekDebug(): void {
    const console = (this.game as any).console;
    const isPmPeek = !!console?.parserPeekPmEnabled;
    const isLlmPeek = !!console?.parserPeekLlmEnabled;
    if (!isPmPeek && !isLlmPeek) return;

    const debug = this.lastDebugInfo;
    if (!debug) return;

    const logDebug = (message: string) => {
      if (typeof console.logDebug === 'function') {
        console.logDebug(message);
      } else if (console.isOpen !== false && typeof console.log === 'function') {
        console.log(message, 'info', { showInClosed: false });
      }
    };

    const formatFullSection = (title: string, value: unknown) => {
      const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      return `--- PM ${title.toUpperCase()} ---\n${body}`;
    };

    // 1. Raw LLM Logging (if #peekllm-on is active)
    if (isLlmPeek) {
      if (debug.prompt) {
        logDebug(formatFullSection('llm prompt', debug.prompt));
      }
      logDebug(
        formatFullSection('llm response', {
          rawResponse: debug.rawResponse || '',
          extractedJson: debug.extractedJson,
          acceptedPlans: debug.acceptedPlans,
          filteredPlans: debug.filteredPlans,
          error: debug.error,
          provider: debug.provider,
          model: debug.model,
          durationMs: debug.durationMs,
          inputTokens: debug.inputTokens,
          tokensGenerated: debug.tokensGenerated,
          cacheCreationInputTokens: debug.cacheCreationInputTokens,
          cacheReadInputTokens: debug.cacheReadInputTokens,
        })
      );
    }

    // 2. Compact PM Logging (if #peekpm-on is active)
    if (isPmPeek) {
      // Format Prompt (Trigger and Active NPCs context)
      if (debug.prompt) {
        let dynamicContext: any = null;
        try {
          const content = debug.prompt.messages[0]?.content;
          if (typeof content === 'string') {
            const startIdx = content.indexOf('{');
            if (startIdx !== -1) {
              let braceCount = 0;
              let endIdx = -1;
              for (let i = startIdx; i < content.length; i++) {
                if (content[i] === '{') braceCount++;
                else if (content[i] === '}') {
                  braceCount--;
                  if (braceCount === 0) {
                    endIdx = i;
                    break;
                  }
                }
              }
              if (endIdx !== -1) {
                dynamicContext = JSON.parse(content.slice(startIdx, endIdx + 1));
              }
            }
          }
        } catch (e) {
          // ignore
        }

        const promptLines: string[] = ['--- PM PROMPT ---'];

        if (dynamicContext) {
          // Format Trigger
          let triggerStr = 'None';
          if (dynamicContext.trigger) {
            const t = dynamicContext.trigger;
            if (t.type === 'wait_elapsed') {
              triggerStr = `Wait elapsed (${t.ms}ms)`;
            } else if (t.type === 'move_completed') {
              triggerStr = `Move completed (${t.result?.status || 'unknown'})`;
            } else if (t.type === 'action_completed') {
              triggerStr = `Action completed (${t.result?.code || 'unknown'})`;
            } else if (t.type === 'plan_continued') {
              triggerStr = `Plan continued: ${t.reason}`;
            } else if (t.type === 'manual') {
              triggerStr = `Manual trigger: ${t.reason || 'none'}`;
            } else {
              triggerStr = JSON.stringify(t);
            }
          }
          promptLines.push(`Trigger: ${triggerStr}`);

          // Format Speech Events if any
          if (Array.isArray(dynamicContext.npcs)) {
            for (const npc of dynamicContext.npcs) {
              if (Array.isArray(npc.newEvents)) {
                for (const ev of npc.newEvents) {
                  if (ev.kind === 'speech') {
                    promptLines.push(`Speech: ${ev.displayName || ev.actorId}: "${ev.text}"`);
                  }
                }
              }
            }
          }

          // Summarize Active NPCs
          promptLines.push('Active NPCs:');
          if (Array.isArray(dynamicContext.npcs)) {
            for (const npc of dynamicContext.npcs) {
              const objStr = npc.objectives ? JSON.stringify(npc.objectives) : '[]';
              const memStr = npc.memory ? `"${npc.memory}"` : 'none';
              let invStr = '';
              if (npc.inventory && npc.inventory.available && Array.isArray(npc.inventory.items)) {
                const itemNames = npc.inventory.items.map((i: any) => i.title || i.id);
                if (itemNames.length > 0) {
                  invStr = ` | Inventory: [${itemNames.join(', ')}]`;
                }
              }
              let actorsStr = '';
              if (Array.isArray(npc.actors)) {
                const actorNames = npc.actors
                  .filter((a: any) => a.id !== npc.id)
                  .map((a: any) => a.title || a.id);
                if (actorNames.length > 0) {
                  actorsStr = ` | Seen: [${actorNames.join(', ')}]`;
                }
              }
              promptLines.push(
                `  * ${npc.id} -> Objectives: ${objStr} | Memory: ${memStr}${invStr}${actorsStr}`
              );
            }
          }
        } else {
          promptLines.push(JSON.stringify(debug.prompt, null, 2));
        }

        logDebug(promptLines.join('\n'));
      }

      // Format Response & Metrics
      const responseLines: string[] = [];
      if (debug.error) {
        responseLines.push(`--- PM RESPONSE (ERROR: ${debug.error}) ---`);
        if (debug.rawResponse) {
          responseLines.push(`Raw Response:\n${debug.rawResponse}`);
        }
      } else {
        responseLines.push('--- PM RESPONSE ---');
        if (Array.isArray(debug.acceptedPlans) && debug.acceptedPlans.length > 0) {
          for (const plan of debug.acceptedPlans) {
            responseLines.push(`Plan for ${plan.npcId}:`);
            if (Array.isArray(plan.steps)) {
              for (const step of plan.steps) {
                const stepArgs = { ...step };
                delete (stepArgs as any).type;
                const argsStr = Object.keys(stepArgs).length ? ` ${JSON.stringify(stepArgs)}` : '';
                responseLines.push(`  * ${step.type}${argsStr}`);
              }
            }
            if (plan.memory !== undefined) {
              responseLines.push(`  * Memory Update: "${plan.memory}"`);
            }
          }
        } else {
          responseLines.push('No plans generated.');
        }

        if (Array.isArray(debug.filteredPlans) && debug.filteredPlans.length > 0) {
          responseLines.push('Filtered (Invalid) Plans:');
          for (const plan of debug.filteredPlans) {
            responseLines.push(`  * ${JSON.stringify(plan)}`);
          }
        }
      }

      // Append Metrics Line
      const durationSec =
        debug.durationMs !== undefined ? (debug.durationMs / 1000).toFixed(2) : '?';
      const cacheCreationStr = debug.cacheCreationInputTokens
        ? `, ${debug.cacheCreationInputTokens} created`
        : '';

      responseLines.push(
        `[${debug.model || 'unknown'} (${debug.provider || 'unknown'}) | ${durationSec}s | Tokens: ${debug.inputTokens ?? '?'} in, ${debug.tokensGenerated ?? '?'} out (Cache: ${debug.cacheReadInputTokens ? debug.cacheReadInputTokens + ' read' : '0 read'}${cacheCreationStr})]`
      );

      logDebug(responseLines.join('\n'));
    }
  }

  private normalizeResponse(
    parsed: unknown,
    worldModel: NpcWorldModel
  ): { valid: boolean; plans: NpcPlan[]; filteredPlans: unknown[] } {
    const allowedNpcIds = new Set(worldModel.npcs.map((npc) => npc.id));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { valid: false, plans: [], filteredPlans: parsed ? [parsed] : [] };
    }

    const record = parsed as Partial<NpcPuppetMasterResponse>;
    if (record.kind !== 'pm_response' || !Array.isArray(record.plans)) {
      return { valid: false, plans: [], filteredPlans: [parsed] };
    }

    const plans: NpcPlan[] = [];
    const filteredPlans: unknown[] = [];
    for (const plan of record.plans) {
      const normalized = this.normalizePlan(plan, allowedNpcIds);
      if (normalized) plans.push(normalized);
      else filteredPlans.push(plan);
    }
    return { valid: true, plans, filteredPlans };
  }

  private normalizePlan(value: unknown, allowedNpcIds: Set<string>): NpcPlan | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Partial<NpcPlan>;
    const npcId = typeof record.npcId === 'string' ? record.npcId.trim() : '';
    if (!npcId || !allowedNpcIds.has(npcId)) return null;

    const steps = Array.isArray(record.steps)
      ? record.steps
          .map((step) => this.normalizeStep(step))
          .filter((step): step is NpcPlanStep => !!step)
      : [];
    const memory = typeof record.memory === 'string' ? record.memory.trim() : undefined;
    if (!steps.length && memory === undefined) return null;
    return {
      npcId,
      steps,
      ...(memory !== undefined ? { memory } : {}),
    };
  }

  private normalizeStep(value: unknown): NpcPlanStep | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.type === 'SAY') {
      const text = typeof record.text === 'string' ? record.text.trim() : '';
      return text ? { type: 'SAY', text } : null;
    }
    if (record.type === 'MEMORY_SET') {
      const memory = typeof record.memory === 'string' ? record.memory.trim() : '';
      return memory ? { type: 'MEMORY_SET', memory } : null;
    }
    if (record.type === 'OBJECTIVES_SET') {
      if (!Array.isArray(record.objectives)) return null;
      const objectives = record.objectives
        .map((objective) => (typeof objective === 'string' ? objective.trim() : ''))
        .filter(Boolean);
      return { type: 'OBJECTIVES_SET', objectives };
    }
    if (record.type === 'MOVE_TO') {
      const x = typeof record.x === 'number' && Number.isFinite(record.x) ? record.x : undefined;
      const y = typeof record.y === 'number' && Number.isFinite(record.y) ? record.y : undefined;
      const targetId = typeof record.targetId === 'string' ? record.targetId.trim() : undefined;
      if (x !== undefined && y !== undefined) return { type: 'MOVE_TO', x, y };
      return targetId ? { type: 'MOVE_TO', targetId } : null;
    }
    if (
      record.type === 'LOOK' ||
      record.type === 'EXAMINE' ||
      record.type === 'OPEN' ||
      record.type === 'CLOSE'
    ) {
      const targetId = typeof record.targetId === 'string' ? record.targetId.trim() : '';
      return targetId ? { type: record.type, targetId } : null;
    }
    if (record.type === 'TAKE') {
      const targetId = typeof record.targetId === 'string' ? record.targetId.trim() : '';
      return targetId ? { type: 'TAKE', targetId } : null;
    }
    if (record.type === 'PUT') {
      const itemId = typeof record.itemId === 'string' ? record.itemId.trim() : '';
      const targetId =
        typeof record.targetId === 'string'
          ? record.targetId.trim()
          : record.targetId === null
            ? null
            : undefined;
      const rawRelation = typeof record.relation === 'string' ? record.relation.trim() : null;
      const relation =
        rawRelation === 'in' ||
        rawRelation === 'on' ||
        rawRelation === 'under' ||
        rawRelation === 'behind'
          ? rawRelation
          : null;
      return itemId ? { type: 'PUT', itemId, targetId, relation } : null;
    }
    if (record.type === 'COMMAND') {
      const commandId = typeof record.commandId === 'string' ? record.commandId.trim() : '';
      if (!commandId) return null;
      const rawArgs =
        record.arguments && typeof record.arguments === 'object' && !Array.isArray(record.arguments)
          ? (record.arguments as Record<string, unknown>)
          : {};
      const args: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(rawArgs)) {
        args[key] = typeof value === 'string' ? value.trim() || null : value === null ? null : null;
      }
      return Object.keys(args).length
        ? { type: 'COMMAND', commandId, arguments: args }
        : { type: 'COMMAND', commandId };
    }
    if (record.type === 'USE') {
      const itemId = typeof record.itemId === 'string' ? record.itemId.trim() : '';
      const targetId = typeof record.targetId === 'string' ? record.targetId.trim() : '';
      return itemId && targetId ? { type: 'USE', itemId, targetId } : null;
    }
    if (record.type === 'WAIT') {
      const ms = typeof record.ms === 'number' && Number.isFinite(record.ms) ? record.ms : 0;
      return ms > 0 ? { type: 'WAIT', ms: Math.max(250, Math.min(60_000, ms)) } : null;
    }
    return null;
  }
}
