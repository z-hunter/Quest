import type { ILlmProvider, LlmProviderContent, LlmProviderMessage } from './llm/ILlmProvider';
import { ActorPlanExecutor } from './ActorPlanExecutor';
import { NpcWorldModelBuilder } from './NpcWorldModelBuilder';
import type { IGame } from '../core/IGame';
import type { Scene } from '../scene/Scene';
import { Actor } from '../entities/Actor';
import type { ActorMoveResult } from '../entities/Actor';
import { ComponentSystem } from '../systems/ComponentSystem';
import type {
  NpcActorContext,
  NpcPlan,
  NpcPlanInterruptCondition,
  NpcPlanExecutionOutcome,
  NpcPlanStep,
  NpcPuppetMasterDebugInfo,
  NpcPuppetMasterStrategyDebugInfo,
  NpcPuppetMasterResponse,
  NpcStaticPrefixDebugInfo,
  NpcWorldModel,
} from './npcTypes';

const SYSTEM_PROMPT_URL = '/text/system/npc-pm-system.md';
const FALLBACK_SYSTEM_PROMPT = [
  'You are the Puppet Master for NPCs in a retro adventure game.',
  'Respond with exactly one JSON object and no extra text.',
  'Return {"kind":"pm_response","plans":[...]}.',
  'You may include a short top-level "reasoning" string for diagnostics; it never changes runtime behavior.',
  'Each plan must target a real NPC id from context.',
  'Observed action entries in newEvents/recentEvents are passive context. They do not require a reply or plan unless they materially affect this NPC, its objectives, or the current situation.',
  'Reliable steps are SAY, MEMORY_SET, OBJECTIVES_SET, WAIT, THINK_STRATEGY, MOVE_TO, TRAVERSE_EXIT, LOOK, EXAMINE, OPEN, CLOSE, TAKE, PUT, COMMAND, and USE.',
  'For an entity with exit metadata, MOVE_TO it first when needed, then use TRAVERSE_EXIT. Never treat MOVE_TO alone as crossing an exit.',
  'TRAVERSE_EXIT is always the final physical step of a plan because scene transfer discards the remaining tail.',
  'Prefer COMMAND when a visible entity lists a suitable authored command; use USE only as fallback.',
  'Use THINK_STRATEGY only after repeatCount is 2 or more, or after terminal no-progress watchdog results such as repeated_without_progress, pattern_without_progress, or pattern_loop_sleep; do not use it for ordinary uncertainty or missing prerequisites while concrete supported actions remain.',
  'Hidden entities absent from context are unknown; inspect known anchors with LOOK or EXAMINE.',
  'EXAMINE is the deeper discovery mode: it may reveal both lookable and examinable contents. LOOK may reveal lookable contents but never examinable contents.',
  'An ok LOOK or EXAMINE means the anchor was inspected, not that any hidden item was found.',
  'Titled objects inside inactive Subscenes may be used through virtual NPC access without opening the player view.',
  'OPEN and CLOSE use real Switch rules, including keys held by the acting NPC.',
  'Do not claim a hidden item was found unless it appears in discoveredEntityIds, refreshed reachable/held context, inventory, or a successful TAKE/COMMAND result.',
  'If LOOK or EXAMINE returns worldChanged false with empty discoveredEntityIds, treat it as nothing new found there.',
  'Do not claim actions succeeded before a successful action_completed result.',
  'actionHistory is authoritative runtime history: do not repeat targets marked inspected with nothing new found unless conditions changed.',
  'Before speaking or planning, correct memory to match authoritative actionHistory when they conflict.',
  'Prefer a well-structured multi-step plan over a short plan when the steps are one coherent procedure and runtime interruptOn conditions can stop the chain to save LLM calls.',
  'Use short plans when the next step depends on an unknown result that cannot be expressed with interruptOn.',
  'inventory.available false means the Actor has no inventory, not that it is full.',
  'Do not store attempted actions as successful facts in memory.',
  'Plan-level memory is committed only after the physical plan completes and discarded after failure or interruption.',
  'Do not record a proposed trade or floor drop as a completed ownership transfer without runtime confirmation.',
  'Runtime may insert MOVE_TO before an explicit TAKE when the item has a route_available approach.',
  'If a plan is rejected for missing items, leading SAY and MEMORY_SET steps may already have executed once; replace unavailable references and do not repeat the same speech or physical plan.',
  'A player offer does not make an item reachable; negotiate or ask them to transfer it instead of using an unavailable item.',
  'Do not repeat an action when worldChanged is false and repeatCount is 2 or more.',
  'Repeated MOVE_TO failures include moveAttemptsRemaining. Retry the same target only while it is above zero; at zero, stop until conditions change.',
  'Assume all known entities can be inspected (LOOK, EXAMINE) and support relations in, on, under, behind unless explicitly stated otherwise.',
  'Assume entities are visible and in the current scene unless marked otherwise. Assume approach is already_reachable if interaction is reachable or held.',
].join('\n');

const STRATEGY_SYSTEM_PROMPT = [
  'You are the internal strategy analyst for one NPC in a retro adventure game.',
  'Return exactly one JSON object and no extra text.',
  'Return {"kind":"npc_strategy_response","npcId":"...","memory":"optional compact memory","objectives":["optional updated objectives"],"waitMs":30000}.',
  'Do not role-play speech. Do not produce SAY, MOVE_TO, LOOK, EXAMINE, OPEN, CLOSE, TAKE, PUT, COMMAND, USE, or any physical action.',
  'Analyze the current situation, confirmed facts, actionHistory, recent outcomes, inventory, visible entities, commands, objectives, and memory.',
  'Write compact memory only with confirmed facts and useful conclusions. Remove noisy or speculative details.',
  'Revise objectives if the current goal is impossible, blocked, already satisfied, or needs a different strategy.',
  'Choose waitMs between 1000 and 60000. Use 30000 unless a different rest interval is clearly better.',
].join('\n');

const PM_STRATEGY_DEFAULT_WAIT_MS = 30_000;
const PM_STRATEGY_MIN_WAIT_MS = 1_000;
const PM_STRATEGY_MAX_WAIT_MS = 60_000;

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
    }
  | {
      type: 'plan_interrupted';
      reason: NpcPlanInterruptCondition['type'];
      result: NpcPlanExecutionOutcome | ActorMoveResult;
      completedSteps: NpcPlanExecutionOutcome[];
      remainingSteps: NpcPlanStep[];
      itemId?: string;
    }
  | {
      type: 'plan_completed';
      results: NpcPlanExecutionOutcome[];
    }
  | {
      type: 'plan_rejected_missing_items';
      missingItems: Array<{ stepType: NpcPlanStep['type']; itemId: string }>;
      retryCount: number;
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

type NpcPatternLoopState = {
  signatures: string[];
  warned: boolean;
  cooldownUntil: number;
};

type NpcActionHistoryRecord = {
  signature: string;
  summary: string;
  count: number;
  updatedAt: number;
};

type NpcStrategyResponse = {
  kind: 'npc_strategy_response';
  npcId: string;
  memory?: string;
  objectives?: string[];
  waitMs?: number;
};

type PendingPlanContinuation = {
  npcId: string;
  barrierStep: NpcPlanStep;
  steps: NpcPlanStep[];
  memory?: string;
  interruptOn: NpcPlanInterruptCondition[];
  completedSteps: NpcPlanExecutionOutcome[];
  trackCompletion: boolean;
};

const PM_BATCH_DEBOUNCE_MS = (globalThis as any).process?.env?.NODE_ENV === 'test' ? 150 : 400;
// в режиме тестов PM_BATCH_DEBOUNCE_MS остается 150 мс
const PM_REPEAT_WARNING_COUNT = 2;
const PM_REPEAT_SUPPRESS_COUNT = 3;
const PM_LOOP_COOLDOWN_MS = 10_000;
const PM_RATE_WINDOW_MS = 10_000;
const PM_MAX_NPC_CALLS_PER_WINDOW = 6;
const PM_MAX_SCENE_CALLS_PER_WINDOW = 12;
const PM_MEMORY_CONTINUATION_LIMIT = 3;
const PM_PATTERN_LOOP_WINDOW = 6;
const PM_PATTERN_LOOP_UNIQUE_LIMIT = 3;
const PM_ACTION_HISTORY_LIMIT = 10;
const ANTHROPIC_HAIKU_45_MIN_CACHE_TOKENS = 4096;

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
  private patternLoopStates = new Map<string, NpcPatternLoopState>();
  private actionHistories = new Map<string, NpcActionHistoryRecord[]>();
  private pendingPlanContinuations = new Map<string, PendingPlanContinuation>();
  private memoryContinuationCounts = new Map<string, number>();
  private npcCallTimes = new Map<string, number[]>();
  private sceneCallTimes = new Map<string, number[]>();

  constructor(game: IGame, provider: ILlmProvider) {
    this.game = game;
    this.provider = provider;
    this.worldModelBuilder = new NpcWorldModelBuilder(game);
    this.executor = new ActorPlanExecutor(
      game,
      (npcId, ms) => {
        this.scheduleNpcWait(npcId, ms);
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
      },
      (npcId, reason) => {
        const scene = game.sceneManager.currentScene;
        if (scene) {
          void this.processNpcStrategy(scene, npcId, reason);
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
    this.patternLoopStates.clear();
    this.actionHistories.clear();
    this.pendingPlanContinuations.clear();
    this.memoryContinuationCounts.clear();
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
      this.patternLoopStates.delete(this.getNpcStateKey(scene, npcId));
      this.memoryContinuationCounts.delete(this.getNpcStateKey(scene, npcId));
      this.npcCallTimes.delete(this.getNpcStateKey(scene, npcId));
      completions.push(this.enqueueNpc(scene, npcId));
    }
    await Promise.all(completions);
  }

  scheduleNpc(scene: Scene, npcId: string, trigger: NpcIndividualTrigger): void {
    const stateKey = this.getNpcStateKey(scene, npcId);
    const loopState = this.loopStates.get(stateKey);
    const patternLoopState = this.patternLoopStates.get(stateKey);
    if (
      trigger.type === 'action_completed' &&
      patternLoopState?.cooldownUntil &&
      patternLoopState.cooldownUntil > Date.now()
    ) {
      return;
    }
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
        if (!this.shouldPreserveUnreadEventsForRetry(npc.id)) {
          scene.sceneLog.markProcessed(undefined, npc.id);
        }
      }
      if (!worldModel.npcs.some((npc) => this.shouldPreserveUnreadEventsForRetry(npc.id))) {
        scene.sceneLog.markProcessed();
      }
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
      if (!this.lastDebugInfo?.error && !this.shouldPreserveUnreadEventsForRetry(npcId)) {
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
    const staticPrefix = this.getStaticPrefixDebug(system);
    const dynamicPrompt = this.getDynamicPromptDebug(messages);
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
        staticPrefix,
        dynamicPrompt,
      };
      this.logPeekDebug();
      return [];
    }

    const extractedJson = this.extractJson(response.text);
    const parsed = this.parseJson(extractedJson);
    const normalized = this.normalizeResponse(parsed, worldModel);
    const expandedPlans = normalized.valid
      ? this.expandImplicitTakeApproaches(normalized.plans, worldModel)
      : normalized.plans;
    const itemValidation = normalized.valid
      ? this.validatePlanItems(expandedPlans, worldModel, trigger)
      : { plans: normalized.plans, rejectedPlans: [] };
    const itemValidatedPlans = itemValidation.plans;
    const acceptedPlans = normalized.valid
      ? this.removePrematureStrategySteps(
          this.removeRepeatedNoProgressSteps(
            this.removeUnsupportedDiscoveryClaims(
              this.removeUnavailableCommandSteps(itemValidatedPlans, worldModel),
              trigger
            ),
            trigger
          ),
          trigger
        )
      : itemValidatedPlans;
    this.lastDebugInfo = {
      matched: acceptedPlans.length > 0,
      provider: this.provider.getProviderName(),
      model: this.provider.getModelName(),
      prompt: { system, messages },
      rawResponse: response.text,
      extractedJson,
      reasoning: this.normalizeReasoning(parsed),
      acceptedPlans,
      rejectedPlans: itemValidation.rejectedPlans,
      filteredPlans: normalized.filteredPlans,
      error: normalized.valid ? undefined : 'invalid_response',
      durationMs: response.durationMs,
      inputTokens: response.inputTokens,
      tokensGenerated: response.tokensGenerated,
      cacheCreationInputTokens: response.cacheCreationInputTokens,
      cacheReadInputTokens: response.cacheReadInputTokens,
      staticPrefix,
      dynamicPrompt,
    };
    this.logPeekDebug();

    if (!normalized.valid) return [];

    for (const plan of acceptedPlans) {
      const outcomes = this.executePlanAndTrackContinuation(plan);
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
    return acceptedPlans;
  }

  private executePlanAndTrackContinuation(plan: NpcPlan): NpcPlanExecutionOutcome[] {
    const scene = this.game.sceneManager.currentScene;
    if (scene) {
      this.pendingPlanContinuations.delete(this.getNpcStateKey(scene, plan.npcId));
    }
    const outcomes = this.executor.executePlan(plan);
    if (scene) {
      this.storePendingContinuationAfterScheduledOutcome(scene, plan, outcomes);
    }
    return outcomes;
  }

  private validatePlanItems(
    plans: NpcPlan[],
    worldModel: NpcWorldModel,
    trigger?: NpcIndividualTrigger | NpcBatchTrigger
  ): {
    plans: NpcPlan[];
    rejectedPlans: NonNullable<NpcPuppetMasterDebugInfo['rejectedPlans']>;
  } {
    const scene = this.game.sceneManager.currentScene;
    const acceptedPlans: NpcPlan[] = [];
    const rejectedPlans: NonNullable<NpcPuppetMasterDebugInfo['rejectedPlans']> = [];
    for (const plan of plans) {
      const npc = worldModel.npcs.find((candidate) => candidate.id === plan.npcId);
      if (!npc) continue;
      const availableIds = new Set([
        ...(npc.inventory?.itemIds || []),
        ...(npc.entities || [])
          .filter((entity) => entity.interaction === 'held' || entity.interaction === 'reachable')
          .map((entity) => entity.id),
      ]);
      const knownItemIds = new Set(
        (npc.knownEntities || [])
          .filter((entity) => entity.kind === 'item')
          .map((entity) => entity.id)
      );
      const missing: Array<{ stepType: NpcPlanStep['type']; itemId: string }> = [];
      const entitiesById = new Map((npc.entities || []).map((entity) => [entity.id, entity]));
      const plannedAvailableIds = new Set(availableIds);
      for (let stepIndex = 0; stepIndex < plan.steps.length; stepIndex++) {
        const step = plan.steps[stepIndex];
        if ((step.type === 'PUT' || step.type === 'USE') && !availableIds.has(step.itemId)) {
          if (!plannedAvailableIds.has(step.itemId)) {
            missing.push({ stepType: step.type, itemId: step.itemId });
          }
        }
        if (step.type === 'TAKE') {
          const target = entitiesById.get(step.targetId);
          const hasPriorMove = plan.steps
            .slice(0, stepIndex)
            .some(
              (candidate) => candidate.type === 'MOVE_TO' && candidate.targetId === step.targetId
            );
          const canBecomeReachable = target?.approach === 'route_available' && hasPriorMove;
          if (!plannedAvailableIds.has(step.targetId) && !canBecomeReachable) {
            missing.push({ stepType: step.type, itemId: step.targetId });
          } else {
            plannedAvailableIds.add(step.targetId);
          }
        }
        if (step.type === 'COMMAND') {
          const command = (npc.entities || [])
            .flatMap((entity) => entity.commands || [])
            .find((candidate) => candidate.id === step.commandId);
          for (const requirement of command?.requires || []) {
            if (
              requirement.satisfied === false &&
              (knownItemIds.has(requirement.entityId) || requirement.scope.includes('held')) &&
              !plannedAvailableIds.has(requirement.entityId)
            ) {
              missing.push({ stepType: step.type, itemId: requirement.entityId });
            }
          }
        }
      }
      const uniqueMissing = Array.from(
        new Map(missing.map((entry) => [`${entry.stepType}:${entry.itemId}`, entry])).values()
      );
      if (!uniqueMissing.length) {
        acceptedPlans.push(plan);
        continue;
      }
      this.traceWake('plan_rejected_missing_items', {
        sceneId: worldModel.scene.id,
        npcId: plan.npcId,
        missingItems: uniqueMissing,
      });
      const previousRetryCount = this.getMissingItemRetryCount(trigger, plan.npcId);
      const retryScheduled = !!scene && previousRetryCount < 1;
      rejectedPlans.push({ plan, missingItems: uniqueMissing, retryScheduled });
      if (previousRetryCount === 0) {
        const safePrefix = this.getSafeRejectedPlanPrefix(plan);
        if (safePrefix.length > 0) {
          acceptedPlans.push({ npcId: plan.npcId, steps: safePrefix });
          this.traceWake('rejected_plan_safe_prefix_preserved', {
            sceneId: worldModel.scene.id,
            npcId: plan.npcId,
            stepTypes: safePrefix.map((step) => step.type),
          });
        }
      }
      if (retryScheduled && scene) {
        const currentGeneration = this.haltGenerationId;
        const currentScene = scene;
        globalThis.setTimeout(() => {
          if (
            this.haltGenerationId !== currentGeneration ||
            this.game.sceneManager.currentScene !== currentScene
          )
            return;
          this.scheduleNpc(scene, plan.npcId, {
            type: 'plan_rejected_missing_items',
            missingItems: uniqueMissing,
            retryCount: previousRetryCount + 1,
          });
        }, 0);
      } else {
        this.traceWake('plan_rejected_missing_items_retry_exhausted', {
          sceneId: worldModel.scene.id,
          npcId: plan.npcId,
        });
      }
    }
    return { plans: acceptedPlans, rejectedPlans };
  }

  private expandImplicitTakeApproaches(plans: NpcPlan[], worldModel: NpcWorldModel): NpcPlan[] {
    return plans.map((plan) => {
      const npc = worldModel.npcs.find((candidate) => candidate.id === plan.npcId);
      if (!npc) return plan;
      const entitiesById = new Map((npc.entities || []).map((entity) => [entity.id, entity]));
      const steps: NpcPlanStep[] = [];
      let changed = false;

      for (const step of plan.steps) {
        if (step.type === 'TAKE') {
          const target = entitiesById.get(step.targetId);
          const hasPriorMove = steps.some(
            (candidate) => candidate.type === 'MOVE_TO' && candidate.targetId === step.targetId
          );
          if (
            target?.interaction !== 'held' &&
            target?.interaction !== 'reachable' &&
            target?.approach === 'route_available' &&
            !hasPriorMove
          ) {
            steps.push({ type: 'MOVE_TO', targetId: step.targetId });
            changed = true;
            this.traceWake('take_auto_approach_inserted', {
              sceneId: worldModel.scene.id,
              npcId: plan.npcId,
              targetId: step.targetId,
            });
          }
        }
        steps.push(step);
      }

      return changed ? { ...plan, steps } : plan;
    });
  }

  private getSafeRejectedPlanPrefix(plan: NpcPlan): NpcPlanStep[] {
    const safePrefix: NpcPlanStep[] = [];
    for (const step of plan.steps) {
      if (step.type !== 'SAY' && step.type !== 'MEMORY_SET') break;
      safePrefix.push(step);
    }
    return safePrefix;
  }

  private shouldPreserveUnreadEventsForRetry(npcId: string): boolean {
    return !!this.lastDebugInfo?.rejectedPlans?.some(
      (entry) => entry.plan.npcId === npcId && entry.retryScheduled
    );
  }

  private getMissingItemRetryCount(
    trigger: NpcIndividualTrigger | NpcBatchTrigger | undefined,
    npcId: string
  ): number {
    const triggers =
      trigger?.type === 'batch' ? trigger.triggersByNpc[npcId] || [] : trigger ? [trigger] : [];
    return triggers.reduce(
      (count, candidate) =>
        candidate.type === 'plan_rejected_missing_items'
          ? Math.max(count, candidate.retryCount)
          : count,
      0
    );
  }

  private storePendingContinuationAfterScheduledOutcome(
    scene: Scene,
    plan: NpcPlan,
    outcomes: NpcPlanExecutionOutcome[],
    previousCompletedSteps: NpcPlanExecutionOutcome[] = []
  ): void {
    const scheduledIndex = outcomes.findIndex((outcome) => outcome.status === 'scheduled');
    if (scheduledIndex < 0) return;
    const remainingSteps = plan.steps.slice(scheduledIndex + 1);
    const barrierStep = plan.steps[scheduledIndex];
    if (!barrierStep) return;
    const hasPendingMemory = typeof plan.memory === 'string';
    const interruptOn = this.getPlanInterruptConditions(plan);
    const trackCompletion = this.shouldTrackPlanCompletion(plan, interruptOn);
    if (
      !remainingSteps.length &&
      !hasPendingMemory &&
      !interruptOn.length &&
      barrierStep.type !== 'MOVE_TO'
    ) {
      return;
    }
    this.pendingPlanContinuations.set(this.getNpcStateKey(scene, plan.npcId), {
      npcId: plan.npcId,
      barrierStep,
      steps: remainingSteps,
      ...(hasPendingMemory ? { memory: plan.memory } : {}),
      interruptOn,
      completedSteps: [...previousCompletedSteps, ...outcomes.slice(0, scheduledIndex)],
      trackCompletion,
    });
    this.traceWake('pending_plan_stored', {
      sceneId: scene.id,
      npcId: plan.npcId,
      remainingStepTypes: remainingSteps.map((step) => step.type),
      remainingStepCount: remainingSteps.length,
      hasMemory: hasPendingMemory,
      interruptOn: interruptOn.map((condition) => condition.type),
      trackCompletion,
    });
  }

  private tryExecutePendingContinuation(
    scene: Scene,
    npcId: string,
    triggers: NpcIndividualTrigger[]
  ): boolean {
    const stateKey = this.getNpcStateKey(scene, npcId);
    const pending = this.pendingPlanContinuations.get(stateKey);
    if (!pending) return false;

    const trigger = [...triggers]
      .reverse()
      .find(
        (candidate) =>
          candidate.type === 'move_completed' ||
          candidate.type === 'action_completed' ||
          candidate.type === 'wait_elapsed'
      );
    if (!trigger) return false;

    let barrierResult = this.getContinuationBarrierResult(trigger, npcId);
    if (trigger.type === 'move_completed' && pending.barrierStep.type === 'MOVE_TO') {
      const targetId = String(pending.barrierStep.targetId || '').trim();
      const didNotMove = trigger.result.status === 'arrived' && trigger.result.route.length === 0;
      if (didNotMove && targetId) {
        const moveProgress = this.recordActionProgress(scene, npcId, {
          status: 'ok',
          code: 'arrived',
          npcId,
          targetId,
          actionType: 'MOVE_TO',
          worldChanged: false,
          repeatKey: `MOVE_TO:${targetId}`,
        });
        if ((moveProgress.repeatCount || 0) >= 2) {
          const terminalResult: NpcPlanExecutionOutcome = {
            ...moveProgress,
            status: 'failed',
            code: 'repeated_without_progress',
            message: `Already at ${targetId}; repeating MOVE_TO cannot make progress.`,
          };
          this.recordActionHistory(scene, npcId, terminalResult);
          this.pendingPlanContinuations.delete(stateKey);
          this.traceWake('move_no_progress_loop', {
            sceneId: scene.id,
            npcId,
            targetId,
            repeatCount: terminalResult.repeatCount,
          });
          const currentGeneration = this.haltGenerationId;
          const currentScene = scene;
          globalThis.setTimeout(() => {
            if (
              this.haltGenerationId !== currentGeneration ||
              this.game.sceneManager.currentScene !== currentScene
            )
              return;
            this.scheduleNpc(scene, npcId, {
              type: 'action_completed',
              result: terminalResult,
            });
          }, 0);
          return true;
        }
      } else if (trigger.result.status === 'arrived') {
        this.clearLoopSuppression(scene, npcId);
      } else if (targetId) {
        const moveProgress = this.recordActionProgress(scene, npcId, {
          status: 'failed',
          code: trigger.result.code || 'route_unreachable',
          npcId,
          message: trigger.result.message,
          targetId,
          actionType: 'MOVE_TO',
          worldChanged: false,
          repeatKey: `MOVE_TO:${targetId}`,
        });
        const repeatCount = moveProgress.repeatCount || 1;
        const moveAttemptsRemaining = Math.max(0, PM_REPEAT_SUPPRESS_COUNT - repeatCount);
        barrierResult = {
          ...moveProgress,
          moveAttemptLimit: PM_REPEAT_SUPPRESS_COUNT,
          moveAttemptsRemaining,
          message:
            moveAttemptsRemaining > 0
              ? `${trigger.result.message || 'Destination is unreachable.'} MOVE_TO ${targetId} failed ${repeatCount}/${PM_REPEAT_SUPPRESS_COUNT}; ${moveAttemptsRemaining} attempt(s) remain before this loop is stopped.`
              : `MOVE_TO ${targetId} failed ${repeatCount}/${PM_REPEAT_SUPPRESS_COUNT}; retry limit reached. Do not retry this target without changed conditions.`,
        };
      }
    }
    const completedSteps =
      trigger.type === 'action_completed' || trigger.type === 'wait_elapsed'
        ? [...pending.completedSteps, barrierResult as NpcPlanExecutionOutcome]
        : pending.completedSteps;
    const interrupt = this.getPlanInterrupt(scene, pending, trigger, barrierResult);
    this.traceWake('plan_interrupt_check', {
      sceneId: scene.id,
      npcId,
      triggerType: trigger.type,
      code: barrierResult.code,
      matched: interrupt?.type,
    });

    if (interrupt) {
      this.pendingPlanContinuations.delete(stateKey);
      this.traceWake('plan_interrupted', {
        sceneId: scene.id,
        npcId,
        reason: interrupt.type,
        itemId: interrupt.type === 'ITEM_FOUND' ? interrupt.itemId : undefined,
        completedSteps: completedSteps.length,
        remainingSteps: pending.steps.length,
      });
      const currentGeneration = this.haltGenerationId;
      const currentScene = scene;
      globalThis.setTimeout(() => {
        if (
          this.haltGenerationId !== currentGeneration ||
          this.game.sceneManager.currentScene !== currentScene
        )
          return;
        this.scheduleNpc(scene, npcId, {
          type: 'plan_interrupted',
          reason: interrupt.type,
          result: barrierResult,
          completedSteps,
          remainingSteps: pending.steps,
          ...(interrupt.type === 'ITEM_FOUND' && interrupt.itemId
            ? { itemId: interrupt.itemId }
            : {}),
        });
      }, 0);
      return true;
    }

    if (trigger.type === 'action_completed' && barrierResult.code === 'exit_traversed') {
      this.pendingPlanContinuations.delete(stateKey);
      const completionOutcomes = this.executor.executePlan({
        npcId: pending.npcId,
        steps: [],
        ...(pending.memory !== undefined ? { memory: pending.memory } : {}),
      });
      const finalResults = [...completedSteps, ...completionOutcomes];
      const destinationScene = Array.from(this.game.sceneManager.scenes.values()).find(
        (candidate) => candidate.getObjectByName(npcId)
      );
      this.traceWake('plan_completed_after_scene_transfer', {
        sourceSceneId: scene.id,
        destinationSceneId: destinationScene?.id,
        npcId,
        discardedStepTypes: pending.steps.map((step) => step.type),
        steps: finalResults.length,
      });
      if (pending.trackCompletion && destinationScene) {
        this.scheduleNpc(destinationScene, npcId, {
          type: 'plan_completed',
          results: finalResults,
        });
      }
      return true;
    }

    this.pendingPlanContinuations.delete(stateKey);
    const continuationPlan: NpcPlan = {
      npcId: pending.npcId,
      steps: pending.steps,
      ...(pending.memory !== undefined ? { memory: pending.memory } : {}),
      interruptOn: pending.interruptOn,
    };
    const outcomes = this.executor.executePlan(continuationPlan);
    this.storePendingContinuationAfterScheduledOutcome(
      scene,
      continuationPlan,
      outcomes,
      completedSteps
    );
    const hasScheduled = outcomes.some((outcome) => outcome.status === 'scheduled');
    if (hasScheduled) return true;
    const finalResults = [...completedSteps, ...outcomes];
    if (!pending.trackCompletion) return false;
    this.traceWake('plan_completed', {
      sceneId: scene.id,
      npcId,
      steps: finalResults.length,
      worldChanged: finalResults.some((outcome) => outcome.worldChanged),
    });
    const currentGeneration = this.haltGenerationId;
    const currentScene = scene;
    globalThis.setTimeout(() => {
      if (
        this.haltGenerationId !== currentGeneration ||
        this.game.sceneManager.currentScene !== currentScene
      )
        return;
      this.scheduleNpc(scene, npcId, {
        type: 'plan_completed',
        results: finalResults,
      });
    }, 0);
    return true;
  }

  private getContinuationBarrierResult(
    trigger: Extract<
      NpcIndividualTrigger,
      { type: 'move_completed' | 'action_completed' | 'wait_elapsed' }
    >,
    npcId: string
  ): NpcPlanExecutionOutcome | ActorMoveResult {
    if (trigger.type === 'wait_elapsed') {
      return {
        status: 'ok',
        code: 'npc_wait_elapsed',
        npcId,
        actionType: 'WAIT',
        message: String(trigger.ms),
        worldChanged: false,
      };
    }
    return trigger.result;
  }

  private getPlanInterruptConditions(plan: NpcPlan): NpcPlanInterruptCondition[] {
    if (Array.isArray(plan.interruptOn)) return plan.interruptOn;
    const consequentialSteps = plan.steps.filter((step) => this.isPhysicalPlanStep(step));
    if (consequentialSteps.length <= 1) return [];
    return [{ type: 'ACTION_FAILED' }, { type: 'ITEM_FOUND' }, { type: 'WORLD_CHANGED' }];
  }

  private shouldTrackPlanCompletion(
    plan: NpcPlan,
    interruptOn: NpcPlanInterruptCondition[]
  ): boolean {
    return (
      interruptOn.length > 0 ||
      plan.steps.filter((step) => this.isPhysicalPlanStep(step)).length > 1
    );
  }

  private getPlanInterrupt(
    scene: Scene,
    pending: PendingPlanContinuation,
    trigger: NpcIndividualTrigger,
    result: NpcPlanExecutionOutcome | ActorMoveResult
  ): NpcPlanInterruptCondition | null {
    for (const condition of pending.interruptOn) {
      if (condition.type === 'ACTION_FAILED' && this.isFailedPlanBarrier(trigger, result)) {
        return condition;
      }
      if (
        condition.type === 'WORLD_CHANGED' &&
        'worldChanged' in result &&
        result.worldChanged === true
      ) {
        return condition;
      }
      if (condition.type === 'STATE_CHANGED' && this.didStateChange(condition, result)) {
        return condition;
      }
      if (condition.type === 'ITEM_FOUND') {
        const itemId = this.getFoundItemId(scene, pending.npcId, condition.itemId, result);
        if (itemId) return { ...condition, itemId };
      }
    }
    return null;
  }

  private isFailedPlanBarrier(
    trigger: NpcIndividualTrigger,
    result: NpcPlanExecutionOutcome | ActorMoveResult
  ): boolean {
    if (trigger.type === 'move_completed') return result.status !== 'arrived';
    if (trigger.type === 'action_completed') {
      return result.status === 'failed' || result.status === 'unsupported';
    }
    return false;
  }

  private didStateChange(
    condition: Extract<NpcPlanInterruptCondition, { type: 'STATE_CHANGED' }>,
    result: NpcPlanExecutionOutcome | ActorMoveResult
  ): boolean {
    if (!('worldChanged' in result) || result.worldChanged !== true) return false;
    if (condition.targetId && 'targetId' in result && result.targetId !== condition.targetId) {
      return false;
    }
    if (
      condition.stateId &&
      (!('stateId' in result) || (result as any).stateId !== condition.stateId)
    ) {
      return false;
    }
    return true;
  }

  private getFoundItemId(
    scene: Scene,
    npcId: string,
    itemId: string | undefined,
    result: NpcPlanExecutionOutcome | ActorMoveResult
  ): string | null {
    if ('discoveredEntityIds' in result && Array.isArray(result.discoveredEntityIds)) {
      const discovered = itemId
        ? result.discoveredEntityIds.find((candidate) => candidate === itemId)
        : result.discoveredEntityIds[0];
      if (discovered) return discovered;
    }

    if (
      'actionType' in result &&
      result.actionType === 'TAKE' &&
      result.status === 'ok' &&
      result.targetId &&
      (!itemId || result.targetId === itemId)
    ) {
      return result.targetId;
    }

    const worldModel = this.worldModelBuilder.build(scene);
    const npc = worldModel.npcs.find((candidate) => candidate.id === npcId);
    if (!npc) return null;
    if (itemId && Array.isArray(npc.inventory?.itemIds) && npc.inventory.itemIds.includes(itemId)) {
      return itemId;
    }

    if (!itemId) return null;
    const entity = itemId
      ? npc.entities.find(
          (candidate) =>
            candidate.id === itemId &&
            (candidate.interaction === 'held' || candidate.interaction === 'reachable')
        )
      : null;
    return entity?.id || null;
  }

  private isPhysicalPlanStep(step: NpcPlanStep): boolean {
    return (
      step.type === 'MOVE_TO' ||
      step.type === 'LOOK' ||
      step.type === 'EXAMINE' ||
      step.type === 'OPEN' ||
      step.type === 'CLOSE' ||
      step.type === 'TAKE' ||
      step.type === 'PUT' ||
      step.type === 'COMMAND' ||
      step.type === 'USE'
    );
  }

  private removeUnavailableCommandSteps(plans: NpcPlan[], worldModel: NpcWorldModel): NpcPlan[] {
    return plans
      .map((plan) => {
        const npcContext = worldModel.npcs.find((npc) => npc.id === plan.npcId);
        let removedCommand = false;
        const steps = plan.steps.filter((step) => {
          if (step.type !== 'COMMAND') return true;
          const available = this.isCommandAvailableForNpc(npcContext, step.commandId);
          if (available) return true;
          removedCommand = true;
          return false;
        });
        const memory = removedCommand ? undefined : plan.memory;
        if (!steps.length && memory === undefined) return null;
        return {
          npcId: plan.npcId,
          steps,
          ...(memory !== undefined ? { memory } : {}),
          ...(plan.interruptOn !== undefined ? { interruptOn: plan.interruptOn } : {}),
        };
      })
      .filter((plan): plan is NpcPlan => !!plan);
  }

  private isCommandAvailableForNpc(
    npcContext: NpcWorldModel['npcs'][number] | undefined,
    commandId: string
  ): boolean {
    if (!npcContext) return false;
    for (const entity of npcContext.entities) {
      const command = entity.commands?.find((candidate) => candidate.id === commandId);
      if (command) return command.available !== false;
    }
    return false;
  }

  private removeUnsupportedDiscoveryClaims(
    plans: NpcPlan[],
    trigger?: NpcIndividualTrigger | NpcBatchTrigger
  ): NpcPlan[] {
    return plans
      .map((plan) => {
        const hasUnsupportedClaims =
          !this.hasDiscoveryConfirmation(trigger, plan.npcId) && !this.hasPlanDiscoveryAction(plan);
        if (!hasUnsupportedClaims) return plan;
        const steps = plan.steps.filter((step) => {
          if (step.type === 'SAY') return !this.hasUnsupportedDiscoveryClaim(step.text);
          if (step.type === 'MEMORY_SET') return !this.hasUnsupportedDiscoveryClaim(step.memory);
          return true;
        });
        const memory =
          typeof plan.memory === 'string' && this.hasUnsupportedDiscoveryClaim(plan.memory)
            ? undefined
            : plan.memory;
        if (!steps.length && memory === undefined) return null;
        return {
          npcId: plan.npcId,
          steps,
          ...(memory !== undefined ? { memory } : {}),
          ...(plan.interruptOn !== undefined ? { interruptOn: plan.interruptOn } : {}),
        };
      })
      .filter((plan): plan is NpcPlan => !!plan);
  }

  private removeRepeatedNoProgressSteps(
    plans: NpcPlan[],
    trigger?: NpcIndividualTrigger | NpcBatchTrigger
  ): NpcPlan[] {
    const blockedByNpc = this.getBlockedNoProgressSignaturesByNpc(trigger);
    if (!blockedByNpc.size) return plans;

    return plans
      .map((plan) => {
        const blockedSignatures = blockedByNpc.get(plan.npcId);
        if (!blockedSignatures?.size) return plan;
        let removedBlockedAction = false;
        const steps = plan.steps.filter((step) => {
          const signature = this.getPlanStepPatternSignature(step);
          if (!signature || !blockedSignatures.has(signature)) return true;
          removedBlockedAction = true;
          return false;
        });
        if (!removedBlockedAction) return plan;
        if (!steps.some((step) => this.isConsequentialPlanStep(step))) {
          this.traceWake('strategy_auto_triggered', {
            npcId: plan.npcId,
            reason: 'terminal_no_progress_loop',
            blockedSignatures: [...blockedSignatures],
          });
          return {
            npcId: plan.npcId,
            steps: [{ type: 'THINK_STRATEGY', reason: 'terminal no-progress loop' }],
          };
        }
        return {
          npcId: plan.npcId,
          steps,
          ...(plan.interruptOn !== undefined ? { interruptOn: plan.interruptOn } : {}),
        };
      })
      .filter((plan): plan is NpcPlan => !!plan);
  }

  private removePrematureStrategySteps(
    plans: NpcPlan[],
    trigger?: NpcIndividualTrigger | NpcBatchTrigger
  ): NpcPlan[] {
    const allowedNpcIds = this.getStrategyAllowedNpcIds(trigger);
    return plans
      .map((plan) => {
        const hasStrategy = plan.steps.some((step) => step.type === 'THINK_STRATEGY');
        if (!hasStrategy || allowedNpcIds.has(plan.npcId)) return plan;
        const steps = plan.steps.filter((step) => step.type !== 'THINK_STRATEGY');
        if (!steps.some((step) => this.isConsequentialPlanStep(step))) return null;
        return {
          npcId: plan.npcId,
          steps,
          ...(plan.interruptOn !== undefined ? { interruptOn: plan.interruptOn } : {}),
        };
      })
      .filter((plan): plan is NpcPlan => !!plan);
  }

  private getStrategyAllowedNpcIds(trigger?: NpcIndividualTrigger | NpcBatchTrigger): Set<string> {
    const result = new Set<string>();
    const triggersByNpc =
      trigger?.type === 'batch'
        ? Object.entries(trigger.triggersByNpc)
        : trigger
          ? ([['', [trigger]]] as Array<[string, NpcIndividualTrigger[]]>)
          : [];
    for (const [npcIdFromBatch, triggers] of triggersByNpc) {
      for (const candidate of triggers) {
        if (candidate.type !== 'action_completed') continue;
        if (
          !this.isTerminalNoProgressCode(candidate.result.code) &&
          (candidate.result.repeatCount || 0) < PM_REPEAT_WARNING_COUNT
        ) {
          continue;
        }
        const npcId = candidate.result.npcId || npcIdFromBatch;
        if (npcId) result.add(npcId);
      }
    }
    return result;
  }

  private getBlockedNoProgressSignaturesByNpc(
    trigger?: NpcIndividualTrigger | NpcBatchTrigger
  ): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    let triggersByNpc: Array<[string, NpcIndividualTrigger[]]> = [];
    if (trigger?.type === 'batch') {
      triggersByNpc = Object.entries(trigger.triggersByNpc);
    } else if (trigger) {
      triggersByNpc = [['', [trigger]]];
    }
    for (const [npcIdFromBatch, triggers] of triggersByNpc) {
      for (const candidate of triggers) {
        if (candidate.type !== 'action_completed') continue;
        if (!this.isTerminalNoProgressCode(candidate.result.code)) continue;
        const signature = this.getPatternSignature(candidate.result);
        if (!signature) continue;
        const npcId = candidate.result.npcId || npcIdFromBatch;
        if (!npcId) continue;
        const signatures = result.get(npcId) || new Set<string>();
        signatures.add(signature);
        result.set(npcId, signatures);
      }
    }
    return result;
  }

  private isTerminalNoProgressCode(code?: string): boolean {
    return (
      code === 'repeated_without_progress' ||
      code === 'pattern_without_progress' ||
      code === 'pattern_loop_sleep'
    );
  }

  private getPlanStepPatternSignature(step: NpcPlanStep): string | null {
    if (
      step.type !== 'LOOK' &&
      step.type !== 'EXAMINE' &&
      step.type !== 'OPEN' &&
      step.type !== 'CLOSE' &&
      step.type !== 'MOVE_TO'
    ) {
      return null;
    }
    const target = step.type === 'MOVE_TO' ? step.targetId : step.targetId;
    const relation =
      (step.type === 'LOOK' || step.type === 'EXAMINE') && step.relation ? step.relation : null;
    return target ? `${step.type}:${target}${relation ? `:${relation}` : ''}` : null;
  }

  private isConsequentialPlanStep(step: NpcPlanStep): boolean {
    return (
      step.type === 'MOVE_TO' ||
      step.type === 'LOOK' ||
      step.type === 'EXAMINE' ||
      step.type === 'OPEN' ||
      step.type === 'CLOSE' ||
      step.type === 'TAKE' ||
      step.type === 'PUT' ||
      step.type === 'COMMAND' ||
      step.type === 'USE' ||
      step.type === 'WAIT' ||
      step.type === 'THINK_STRATEGY'
    );
  }

  private hasDiscoveryConfirmation(
    trigger: NpcIndividualTrigger | NpcBatchTrigger | undefined,
    npcId: string
  ): boolean {
    const triggers =
      trigger?.type === 'batch' ? trigger.triggersByNpc[npcId] || [] : trigger ? [trigger] : [];
    return triggers.some((candidate) => {
      if (candidate.type !== 'action_completed') return false;
      const result = candidate.result;
      if (result.status !== 'ok') return false;
      const discovered = Array.isArray(result.discoveredEntityIds)
        ? result.discoveredEntityIds
        : [];
      if (discovered.length > 0) return true;
      return result.actionType === 'TAKE' || result.actionType === 'COMMAND';
    });
  }

  private hasPlanDiscoveryAction(plan: NpcPlan): boolean {
    return plan.steps.some((step) => step.type === 'TAKE' || step.type === 'COMMAND');
  }

  private hasUnsupportedDiscoveryClaim(text: string): boolean {
    const normalized = text.toLowerCase();
    if (
      /\b(?:not|never)\s+found\b/.test(normalized) ||
      /\bdid(?:n't| not)\s+find\b/.test(normalized) ||
      /\bhave(?:n't| not)\s+found\b/.test(normalized) ||
      /\bhas(?:n't| not)\s+found\b/.test(normalized) ||
      /\bwithout\s+find(?:ing)?\b/.test(normalized) ||
      /\bfound\s+nothing\b/.test(normalized) ||
      /\bnothing\s+(?:new\s+)?(?:was\s+)?found\b/.test(normalized) ||
      /\bunfound\b/.test(normalized)
    ) {
      return false;
    }
    return (
      /\bfound\s+(?:it|the|that|a|my|your|tv remote|remote)\b/.test(normalized) ||
      /\bi\s+found\b/.test(normalized) ||
      /\bhere\s+it\s+is\b/.test(normalized) ||
      /\bthere\s+it\s+is\b/.test(normalized) ||
      /\bgot\s+(?:it|the\s+remote)\b/.test(normalized)
    );
  }

  private maybeScheduleContinuation(
    plans: NpcPlan[],
    trigger: NpcIndividualTrigger | undefined,
    hasScheduledStep: boolean
  ): void {
    if (hasScheduledStep || trigger?.type !== 'move_completed') return;

    for (const plan of plans) {
      const hasExplicitStateUpdate = plan.steps.some(
        (step) => step.type === 'MEMORY_SET' || step.type === 'OBJECTIVES_SET'
      );
      const hasPlanMemory = typeof plan.memory === 'string';
      if (!hasExplicitStateUpdate && !hasPlanMemory) continue;

      const scene = this.game.sceneManager.currentScene;
      const stateKey = scene ? this.getNpcStateKey(scene, plan.npcId) : plan.npcId;
      if (hasExplicitStateUpdate) {
        this.memoryContinuationCounts.delete(stateKey);
      } else {
        const count = this.memoryContinuationCounts.get(stateKey) || 0;
        if (count >= PM_MEMORY_CONTINUATION_LIMIT) continue;
        this.memoryContinuationCounts.set(stateKey, count + 1);
      }

      const currentGeneration = this.haltGenerationId;
      const currentScene = scene;
      globalThis.setTimeout(() => {
        const activeScene = this.game.sceneManager.currentScene;
        if (
          !activeScene ||
          this.haltGenerationId !== currentGeneration ||
          activeScene !== currentScene
        )
          return;
        this.scheduleNpc(activeScene, plan.npcId, {
          type: 'plan_continued',
          reason: 'previous_plan_updated_memory_or_objectives_without_scheduling_action',
        });
      }, 0);
    }
  }

  private scheduleNpcWait(npcId: string, ms: number): void {
    const existing = this.waitTimeouts.get(npcId);
    if (existing) {
      globalThis.clearTimeout(existing);
    }
    const currentGeneration = this.haltGenerationId;
    const currentScene = this.game.sceneManager.currentScene;
    const timeoutId = globalThis.setTimeout(() => {
      this.waitTimeouts.delete(npcId);
      const scene = this.game.sceneManager.currentScene;
      if (scene && this.haltGenerationId === currentGeneration && scene === currentScene) {
        this.scheduleNpc(scene, npcId, { type: 'wait_elapsed', ms });
      }
    }, ms);
    this.waitTimeouts.set(npcId, timeoutId);
  }

  private async processNpcStrategy(scene: Scene, npcId: string, reason?: string): Promise<void> {
    const processingKey = `strategy:${scene.id}:${npcId}`;
    if (this.processingScenes.has(processingKey)) return;
    const currentGeneration = this.haltGenerationId;
    this.processingScenes.add(processingKey);
    try {
      const fullWorldModel = this.worldModelBuilder.build(scene);
      const worldModel = {
        ...fullWorldModel,
        npcs: fullWorldModel.npcs.filter((npc) => npc.id === npcId),
      };
      if (!worldModel.npcs.length) return;

      this.traceWake('strategy_request_start', {
        sceneId: scene.id,
        npcId,
        reason,
        provider: this.provider.getProviderName(),
        model: this.provider.getModelName(),
      });

      const system = this.buildStrategySystemPrompt(worldModel);
      const messages = this.buildStrategyMessages(worldModel, npcId, reason);
      const staticPrefix = this.getStaticPrefixDebug(system);
      const response = this.provider.isAvailable()
        ? await this.provider.sendMessageStream(system, messages, () => {})
        : {
            ok: false as const,
            text: '',
            error: 'provider_unavailable',
            durationMs: 0,
          };

      if (this.haltGenerationId !== currentGeneration) return;

      const baseDebug: NpcPuppetMasterStrategyDebugInfo = {
        npcId,
        reason,
        prompt: { system, messages },
        rawResponse: response.text,
        memoryUpdated: false,
        waitMs: PM_STRATEGY_DEFAULT_WAIT_MS,
        fallback: true,
        durationMs: response.durationMs,
        inputTokens: response.inputTokens,
        tokensGenerated: response.tokensGenerated,
        cacheCreationInputTokens: response.cacheCreationInputTokens,
        cacheReadInputTokens: response.cacheReadInputTokens,
        staticPrefix,
      };

      if (!response.ok) {
        const debug = {
          ...baseDebug,
          error: response.error || response.reason || 'api_error',
        };
        this.finishStrategy(scene, npcId, debug);
        return;
      }

      const extractedJson = this.extractJson(response.text);
      const parsed = this.parseJson(extractedJson);
      const normalized = this.normalizeStrategyResponse(parsed, npcId);
      if (!normalized) {
        const debug = {
          ...baseDebug,
          extractedJson,
          error: 'invalid_response',
        };
        this.finishStrategy(scene, npcId, debug);
        return;
      }

      const actor = scene.getObjectByName(npcId);
      const memoryUpdated =
        typeof normalized.memory === 'string' && this.setNpcMemory(actor, normalized.memory);
      const objectivesUpdated = normalized.objectives
        ? this.setNpcObjectives(actor, normalized.objectives)
        : undefined;
      const waitMs = this.clampStrategyWaitMs(normalized.waitMs);
      const debug: NpcPuppetMasterStrategyDebugInfo = {
        ...baseDebug,
        extractedJson,
        memoryUpdated,
        objectivesUpdated,
        waitMs,
        fallback: false,
      };
      this.finishStrategy(scene, npcId, debug);
    } finally {
      this.processingScenes.delete(processingKey);
    }
  }

  private finishStrategy(
    _scene: Scene,
    npcId: string,
    debug: NpcPuppetMasterStrategyDebugInfo
  ): void {
    this.lastDebugInfo = {
      ...(this.lastDebugInfo || {
        matched: false,
        provider: this.provider.getProviderName(),
        model: this.provider.getModelName(),
      }),
      strategy: debug,
    };
    this.logStrategyDebug(debug);
    this.scheduleNpcWait(npcId, debug.waitMs);
  }

  private buildStrategySystemPrompt(worldModel: NpcWorldModel): LlmProviderContent {
    const staticContext = {
      projectionVersion: 'pm-entity-v1',
      scene: worldModel.scene,
      entities: this.worldModelBuilder.buildStaticEntityProjection(
        this.game.sceneManager.currentScene!
      ),
    };
    return [
      { type: 'text', text: STRATEGY_SYSTEM_PROMPT },
      {
        type: 'text',
        text: ['## Scene-Static NPC Strategy Context', this.stableStringify(staticContext)].join(
          '\n'
        ),
        cacheControl: { type: 'ephemeral', ttl: '5m' },
      },
    ];
  }

  private buildStrategyMessages(
    worldModel: NpcWorldModel,
    npcId: string,
    reason?: string
  ): LlmProviderMessage[] {
    const baseContext = this.buildDynamicPromptContext(worldModel);
    const dynamicContext = { reason, npcId, ...baseContext };
    return [
      {
        role: 'user',
        content: [
          'Strategy-only NPC context:',
          JSON.stringify(dynamicContext),
          '',
          `Return strictly valid JSON: {"kind":"npc_strategy_response","npcId":"${npcId}","memory":"...","objectives":[...],"waitMs":30000}`,
        ].join('\n'),
      },
    ];
  }

  private normalizeStrategyResponse(value: unknown, npcId: string): NpcStrategyResponse | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Partial<NpcStrategyResponse>;
    if (record.kind !== 'npc_strategy_response') return null;
    if (typeof record.npcId !== 'string' || record.npcId.trim() !== npcId) return null;
    const memory = typeof record.memory === 'string' ? record.memory.trim() : undefined;
    const objectives = Array.isArray(record.objectives)
      ? record.objectives
          .map((objective) => (typeof objective === 'string' ? objective.trim() : ''))
          .filter(Boolean)
      : undefined;
    const waitMs =
      typeof record.waitMs === 'number' && Number.isFinite(record.waitMs)
        ? record.waitMs
        : undefined;
    return {
      kind: 'npc_strategy_response',
      npcId,
      ...(memory ? { memory } : {}),
      ...(objectives ? { objectives } : {}),
      ...(waitMs !== undefined ? { waitMs } : {}),
    };
  }

  private clampStrategyWaitMs(ms?: number): number {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return PM_STRATEGY_DEFAULT_WAIT_MS;
    return Math.max(PM_STRATEGY_MIN_WAIT_MS, Math.min(PM_STRATEGY_MAX_WAIT_MS, ms));
  }

  private setNpcMemory(actor: unknown, memory: string): boolean {
    const component =
      actor instanceof Actor
        ? (actor.components?.find((candidate: any) => candidate?.type === 'NPC') as
            | { type: 'NPC'; memory?: string }
            | undefined)
        : undefined;
    if (!component) return false;
    component.memory = String(memory || '').trim();
    return true;
  }

  private setNpcObjectives(actor: unknown, objectives: string[]): string[] | undefined {
    const component =
      actor instanceof Actor
        ? (actor.components?.find((candidate: any) => candidate?.type === 'NPC') as
            | {
                type: 'NPC';
                objectives?: string[];
                objectivesInitializedFromTA?: boolean;
                objectivesTARevision?: string;
              }
            | undefined)
        : undefined;
    if (!component) return undefined;
    component.objectives = objectives
      .map((objective) => String(objective || '').trim())
      .filter(Boolean);
    component.objectivesInitializedFromTA = true;
    component.objectivesTARevision = this.game.textAssets.getResolvedObjectListRevision(
      actor as Actor,
      'objectives'
    );
    return component.objectives;
  }

  private async buildSystemPrompt(worldModel: NpcWorldModel): Promise<LlmProviderContent> {
    const systemPrompt = await this.loadSystemPrompt();
    const staticContext = {
      projectionVersion: 'pm-entity-v1',
      scene: worldModel.scene,
      entities: this.worldModelBuilder.buildStaticEntityProjection(
        this.game.sceneManager.currentScene!
      ),
    };

    return [
      { type: 'text', text: systemPrompt },
      {
        type: 'text',
        text: ['## Scene-Static NPC Context', this.stableStringify(staticContext)].join('\n'),
        cacheControl: { type: 'ephemeral', ttl: '5m' },
      },
    ];
  }

  private buildMessages(
    worldModel: NpcWorldModel,
    trigger?: NpcIndividualTrigger | NpcBatchTrigger
  ): LlmProviderMessage[] {
    const dynamicContext = this.buildDynamicPromptContext(worldModel, trigger);

    const activeNpcIds = worldModel.npcs.map((n) => n.id).join(', ');
    const firstNpcId = worldModel.npcs[0]?.id || 'NPC';

    return [
      {
        role: 'user',
        content: [
          'Per-call dynamic NPC context:',
          JSON.stringify(dynamicContext),
          '',
          `Generate plans ONLY for active NPCs: ${activeNpcIds}.`,
          'CRITICAL RULES:',
          '1. "npcId" MUST be the ID of the NPC (e.g. "NPC"), never an item ID.',
          '2. "steps.type" MUST be one of: SAY, MOVE_TO, TRAVERSE_EXIT, LOOK, EXAMINE, OPEN, CLOSE, TAKE, PUT, COMMAND, USE, WAIT, THINK_STRATEGY, OBJECTIVES_SET, MEMORY_SET.',
          '3. To run an entity command like "turn_tv_on", use: {"type":"COMMAND","commandId":"turn_tv_on","arguments":{}}.',
          `Return strictly valid JSON: {"kind":"pm_response","plans":[{"npcId":"${firstNpcId}","steps":[...]}]}`,
        ].join('\n'),
      },
    ];
  }

  private buildDynamicPromptContext(
    worldModel: NpcWorldModel,
    trigger?: NpcIndividualTrigger | NpcBatchTrigger
  ): Record<string, unknown> {
    const compactTrigger = trigger ? this.compactPromptTrigger(trigger) : undefined;
    return this.compactPromptRecord({
      trigger: compactTrigger,
      npcs: worldModel.npcs.map((npc) => {
        const entities = npc.entities || [];
        const knownEntities = npc.knownEntities || [];
        const newEvents = npc.newEvents || [];
        const recentEvents = npc.recentEvents || [];
        const currentEntityIds = new Set(entities.map((entity) => entity.id));
        const npcTrigger =
          trigger?.type === 'batch' ? trigger.triggersByNpc[npc.id]?.at(-1) : trigger;
        return this.compactPromptRecord({
          id: npc.id,
          objectives: npc.objectives,
          memory: npc.memory,
          inventory: npc.inventory,
          knownEntities: knownEntities.some(
            (entity) => entity.id !== npc.id && !currentEntityIds.has(entity.id)
          )
            ? knownEntities
                .filter((entity) => entity.id !== npc.id && !currentEntityIds.has(entity.id))
                .map((entity) =>
                  this.compactPromptRecord({
                    id: entity.id,
                    kind: entity.kind,
                    lastSeenSceneId: entity.lastSeenSceneId,
                    title:
                      entity.lastSeenSceneId !== worldModel.scene.id ? entity.title : undefined,
                  })
                )
            : undefined,
          actionHistory: this.getPromptActionHistory(worldModel.scene.id, npc.id, npcTrigger),
          newEvents: newEvents.length
            ? newEvents.map((event) => this.compactPromptEvent(event))
            : undefined,
          recentEvents: recentEvents.some(
            (event) => !this.eventDuplicatesTrigger(event, npc.id, npcTrigger)
          )
            ? recentEvents
                .filter((event) => !this.eventDuplicatesTrigger(event, npc.id, npcTrigger))
                .slice(-4)
                .map((event) => this.compactPromptEvent(event))
            : undefined,
          entities: this.buildDynamicEntities(entities),
        });
      }),
    });
  }

  private compactPromptTrigger(trigger: NpcIndividualTrigger | NpcBatchTrigger): unknown {
    if (trigger.type === 'batch') {
      return {
        type: 'batch',
        triggersByNpc: Object.fromEntries(
          Object.entries(trigger.triggersByNpc).map(([npcId, entries]) => [
            npcId,
            entries.map((entry) => this.compactPromptTrigger(entry)),
          ])
        ),
      };
    }
    if (trigger.type === 'action_completed' || trigger.type === 'move_completed') {
      const result = trigger.result;
      return this.compactPromptRecord({
        type: trigger.type,
        result: this.compactPromptRecord({
          status: result.status,
          code: result.code,
          message: 'message' in result ? result.message : undefined,
          actionType: 'actionType' in result ? result.actionType : undefined,
          targetId: 'targetId' in result ? result.targetId : undefined,
          itemId: 'itemId' in result ? result.itemId : undefined,
          commandId: 'commandId' in result ? result.commandId : undefined,
          relation: 'relation' in result ? result.relation : undefined,
          worldChanged: 'worldChanged' in result ? result.worldChanged : undefined,
          discoveredEntityIds:
            'discoveredEntityIds' in result ? result.discoveredEntityIds : undefined,
          repeatKey: 'repeatKey' in result ? result.repeatKey : undefined,
          repeatCount:
            'repeatCount' in result && result.repeatCount ? result.repeatCount : undefined,
          moveAttemptLimit: 'moveAttemptLimit' in result ? result.moveAttemptLimit : undefined,
          moveAttemptsRemaining:
            'moveAttemptsRemaining' in result ? result.moveAttemptsRemaining : undefined,
        }),
      });
    }
    if (trigger.type === 'plan_completed') {
      return {
        type: trigger.type,
        results: trigger.results
          .map((result) => this.compactPromptTrigger({ type: 'action_completed', result }))
          .map((entry: any) => entry.result),
      };
    }
    if (trigger.type === 'plan_interrupted') {
      return this.compactPromptRecord({
        type: trigger.type,
        reason: trigger.reason,
        result: (
          this.compactPromptTrigger({
            type: 'action_completed',
            result: trigger.result as NpcPlanExecutionOutcome,
          }) as any
        ).result,
        completedSteps: trigger.completedSteps.map(
          (result) =>
            (this.compactPromptTrigger({ type: 'action_completed', result }) as any).result
        ),
        remainingSteps: trigger.remainingSteps,
        itemId: trigger.itemId,
      });
    }
    return this.compactPromptRecord(trigger as unknown as Record<string, unknown>);
  }

  private compactPromptEvent(event: any): Record<string, unknown> {
    const payload = event.payload || {};
    return this.compactPromptRecord({
      kind: event.kind,
      actorId: event.actorId,
      text: event.text,
      payload: this.compactPromptRecord({
        action: payload.action,
        subjectId: payload.subjectId,
        targetId: payload.targetId,
        itemId: payload.itemId,
        commandId: payload.commandId,
        relation: payload.relation,
        state: payload.state,
        previousLocation: payload.previousLocation,
      }),
    });
  }

  private eventDuplicatesTrigger(
    event: any,
    npcId: string,
    trigger?: NpcIndividualTrigger
  ): boolean {
    if (!trigger || event.actorId !== npcId) return false;
    if (trigger.type !== 'action_completed' && trigger.type !== 'move_completed') return false;
    const result: any = trigger.result;
    const payload = event.payload || {};
    return [
      [payload.targetId, result.targetId],
      [payload.itemId, result.itemId],
      [payload.commandId, result.commandId],
    ].some(([eventValue, resultValue]) => !!eventValue && eventValue === resultValue);
  }

  private getPromptActionHistory(
    sceneId: string,
    npcId: string,
    trigger?: NpcIndividualTrigger
  ): string[] | undefined {
    const history = this.getNpcActionHistory(sceneId, npcId);
    if (!history || trigger?.type !== 'action_completed') return history;
    const result = trigger.result;
    const target = result.targetId || result.itemId || result.commandId;
    if (!target || !result.actionType) return history;
    return history.filter((entry) => !entry.startsWith(`${result.actionType} ${target}:`));
  }

  private compactPromptRecord<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => {
        if (entry === undefined || entry === null) return false;
        if (Array.isArray(entry) && entry.length === 0) return false;
        if (typeof entry === 'object' && !Array.isArray(entry) && Object.keys(entry).length === 0)
          return false;
        return true;
      })
    ) as T;
  }

  private getDynamicPromptDebug(
    messages: LlmProviderMessage[]
  ): NonNullable<NpcPuppetMasterDebugInfo['dynamicPrompt']> {
    const text = messages.map((message) => String(message.content || '')).join('\n');
    const jsonStart = text.indexOf('{');
    let jsonEnd = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = jsonStart; index >= 0 && index < text.length; index++) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        jsonEnd = index;
        break;
      }
    }
    let sections: Record<string, number> = {};
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = this.parseJson(text.slice(jsonStart, jsonEnd + 1)) as any;
      if (parsed && typeof parsed === 'object') {
        sections = Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [key, JSON.stringify(value).length])
        );
      }
    }
    return { characters: text.length, estimatedTokens: Math.ceil(text.length / 4), sections };
  }

  private normalizeReasoning(parsed: unknown): string | undefined {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const value = (parsed as Record<string, unknown>).reasoning;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private buildDynamicEntities(
    entities: NpcActorContext['entities'] | undefined
  ): Array<Record<string, unknown>> {
    return (entities || []).map((entity) => ({
      id: entity.id,
      lastSeenSceneId: entity.lastSeenSceneId,
      visibility: entity.visibility,
      ...(entity.location ? { location: entity.location } : {}),
      interaction: entity.interaction,
      approach: entity.approach,
      ...(entity.switch
        ? {
            switch: {
              state: entity.switch.state,
              canOpen: entity.switch.canOpen,
              canClose: entity.switch.canClose,
              locked: entity.switch.locked,
              keyHeld: entity.switch.keyHeld,
            },
          }
        : {}),
      ...(entity.states ? { states: entity.states } : {}),
      ...(entity.exit ? { exit: entity.exit } : {}),
      ...(entity.commands
        ? {
            commands: entity.commands.map((command) => ({
              id: command.id,
              ...(command.available !== undefined ? { available: command.available } : {}),
              ...(command.requires
                ? {
                    requires: command.requires.map((requirement) => ({
                      entityId: requirement.entityId,
                      ...(requirement.satisfied !== undefined
                        ? { satisfied: requirement.satisfied }
                        : {}),
                      ...(requirement.via ? { via: requirement.via } : {}),
                    })),
                  }
                : {}),
            })),
          }
        : {}),
    }));
  }

  private getStaticPrefixDebug(system: LlmProviderContent): NpcStaticPrefixDebugInfo {
    const text = typeof system === 'string' ? system : system.map((block) => block.text).join('');
    const estimatedTokens = Math.ceil(text.length / 4);
    return {
      hash: this.hashStableText(text),
      characters: text.length,
      estimatedTokens,
      cacheEligible: estimatedTokens >= ANTHROPIC_HAIKU_45_MIN_CACHE_TOKENS,
    };
  }

  private stableStringify(value: unknown): string {
    const normalize = (entry: unknown): unknown => {
      if (Array.isArray(entry)) return entry.map(normalize);
      if (!entry || typeof entry !== 'object') return entry;
      return Object.fromEntries(
        Object.entries(entry as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, normalize(nested)])
      );
    };
    return JSON.stringify(normalize(value));
  }

  private hashStableText(text: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
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
    const currentGeneration = this.haltGenerationId;
    batch.timeoutId = globalThis.setTimeout(() => {
      if (this.haltGenerationId !== currentGeneration) {
        if (this.pendingBatches.get(scene.id) === batch) {
          this.pendingBatches.delete(scene.id);
        }
        batch.completionResolvers.forEach((resolve) => resolve());
        return;
      }
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
    const continuationNpcIds = [...batch.npcIds].filter((npcId) =>
      this.tryExecutePendingContinuation(scene, npcId, batch.triggersByNpc.get(npcId) || [])
    );
    const providerCandidateNpcIds = [...batch.npcIds].filter(
      (npcId) => !continuationNpcIds.includes(npcId)
    );
    if (continuationNpcIds.length) {
      this.traceWake('pending_plan_continued', {
        sceneId,
        npcIds: continuationNpcIds,
        rateLimitBypassed: true,
      });
    }
    if (scene !== this.game.sceneManager.currentScene) {
      this.traceWake('batch_stopped', {
        sceneId,
        reason: 'scene_is_no_longer_current',
        continuationsExecuted: continuationNpcIds,
      });
      batch.completionResolvers.forEach((resolve) => resolve());
      return;
    }
    if (!providerCandidateNpcIds.length) {
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
        npcIds: providerCandidateNpcIds,
      });
      this.deferBatch(batch, providerCandidateNpcIds);
      batch.completionResolvers.forEach((resolve) => resolve());
      return;
    }
    const allowedNpcIds = providerCandidateNpcIds.filter((npcId) =>
      this.consumeNpcRateBudget(scene, npcId)
    );
    const deferredNpcIds = providerCandidateNpcIds.filter(
      (npcId) => !allowedNpcIds.includes(npcId)
    );
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

    const providerNpcIds = allowedNpcIds;

    const processingKey = `batch:${scene.id}`;
    if (this.processingScenes.has(processingKey)) {
      this.traceWake('batch_requeued', {
        sceneId,
        reason: 'scene_batch_already_processing',
        npcIds: providerNpcIds,
      });
      for (const npcId of providerNpcIds) {
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
        npcs: fullWorldModel.npcs.filter((npc) => providerNpcIds.includes(npc.id)),
      };
      if (!worldModel.npcs.length) {
        this.traceWake('batch_stopped', {
          sceneId,
          reason: 'selected_npcs_missing_from_world_model',
          npcIds: providerNpcIds,
        });
        return;
      }
      const triggersByNpc = Object.fromEntries(
        providerNpcIds
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
        for (const npcId of providerNpcIds) {
          if (!this.shouldPreserveUnreadEventsForRetry(npcId)) {
            scene.sceneLog.markProcessed(undefined, npcId);
          }
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
    this.recordActionHistory(scene, npcId, result);
    const repeatKey =
      result.repeatKey || `${result.actionType || 'ACTION'}:${result.targetId || ''}`;
    if (result.worldChanged || !repeatKey) {
      this.loopStates.delete(stateKey);
      this.patternLoopStates.delete(stateKey);
      return { ...result, repeatCount: 0 };
    }

    const previous = this.loopStates.get(stateKey);
    const count = previous?.repeatKey === repeatKey ? previous.count + 1 : 1;
    const cooldownUntil = count >= PM_REPEAT_SUPPRESS_COUNT ? Date.now() + PM_LOOP_COOLDOWN_MS : 0;
    this.loopStates.set(stateKey, { repeatKey, count, cooldownUntil });
    const repeatedResult =
      count < PM_REPEAT_WARNING_COUNT
        ? { ...result, repeatCount: count }
        : {
            ...result,
            status: count >= PM_REPEAT_SUPPRESS_COUNT ? 'failed' : result.status,
            code: count >= PM_REPEAT_SUPPRESS_COUNT ? 'repeated_without_progress' : result.code,
            repeatCount: count,
            message:
              count >= PM_REPEAT_SUPPRESS_COUNT
                ? 'The same action produced no new information or world change repeatedly.'
                : result.message,
          };
    return this.recordPatternProgress(scene, npcId, repeatedResult);
  }

  private recordPatternProgress(
    scene: Scene,
    npcId: string,
    result: NpcPlanExecutionOutcome
  ): NpcPlanExecutionOutcome {
    const stateKey = this.getNpcStateKey(scene, npcId);
    const signature = this.getPatternSignature(result);
    if (!signature) {
      this.patternLoopStates.delete(stateKey);
      return result;
    }

    const previous = this.patternLoopStates.get(stateKey);
    if (
      previous?.warned &&
      this.isMateriallyDifferentPatternTarget(previous.signatures, signature)
    ) {
      this.patternLoopStates.set(stateKey, {
        signatures: [signature],
        warned: false,
        cooldownUntil: 0,
      });
      return result;
    }
    const signatures = [...(previous?.signatures || []), signature].slice(-PM_PATTERN_LOOP_WINDOW);
    const uniqueCount = new Set(signatures).size;
    const isLoop =
      signatures.length >= PM_PATTERN_LOOP_WINDOW && uniqueCount <= PM_PATTERN_LOOP_UNIQUE_LIMIT;
    if (!isLoop) {
      this.patternLoopStates.set(stateKey, {
        signatures,
        warned: previous?.warned || false,
        cooldownUntil: 0,
      });
      return result;
    }

    if (!previous?.warned) {
      this.patternLoopStates.set(stateKey, { signatures, warned: true, cooldownUntil: 0 });
      return {
        ...result,
        status: 'failed',
        code: 'pattern_without_progress',
        message: `Cyclic no-progress behavior detected: ${[...new Set(signatures)].join(', ')} have already been tried and did not help. Do not continue this action pattern. Choose a materially different strategy, ask for help, WAIT/rest voluntarily, or reconsider current objectives with OBJECTIVES_SET if the goal is not currently achievable.`,
      };
    }

    this.patternLoopStates.set(stateKey, {
      signatures,
      warned: true,
      cooldownUntil: Date.now() + PM_LOOP_COOLDOWN_MS,
    });
    return {
      ...result,
      status: 'failed',
      code: 'pattern_loop_sleep',
      message: `Cyclic no-progress behavior continued after warning: ${[...new Set(signatures)].join(', ')}. These actions were already tried and still did not help. Puppet Master is putting this NPC to sleep briefly to avoid wasting LLM calls; next time, use a materially different plan, WAIT/rest, ask for help, or revise objectives instead of repeating this pattern.`,
    };
  }

  private getPatternSignature(result: NpcPlanExecutionOutcome): string | null {
    if (result.status === 'scheduled') return null;
    if (result.worldChanged) return null;
    const actionType = result.actionType || 'ACTION';
    if (
      actionType !== 'LOOK' &&
      actionType !== 'EXAMINE' &&
      actionType !== 'OPEN' &&
      actionType !== 'CLOSE' &&
      actionType !== 'MOVE_TO'
    ) {
      return null;
    }
    const target = result.targetId || result.commandId || result.itemId || '';
    const relation =
      (actionType === 'LOOK' || actionType === 'EXAMINE') && result.relation
        ? result.relation
        : null;
    return `${actionType}:${target}${relation ? `:${relation}` : ''}`;
  }

  private isMateriallyDifferentPatternTarget(
    previousSignatures: string[],
    nextSignature: string
  ): boolean {
    const nextTarget = this.getPatternTarget(nextSignature);
    if (!nextTarget) return false;
    const previousTargets = new Set(
      previousSignatures.map((signature) => this.getPatternTarget(signature)).filter(Boolean)
    );
    return !previousTargets.has(nextTarget);
  }

  private getPatternTarget(signature: string): string {
    const separatorIndex = signature.indexOf(':');
    return separatorIndex >= 0 ? signature.slice(separatorIndex + 1) : '';
  }

  private recordActionHistory(scene: Scene, npcId: string, result: NpcPlanExecutionOutcome): void {
    const stateKey = this.getNpcStateKey(scene, npcId);
    const target = result.targetId || result.commandId || result.itemId || '';
    if (!target) return;

    if (result.worldChanged) {
      this.removeActionHistoryForTarget(stateKey, target);
      this.upsertActionHistory(
        stateKey,
        this.getActionHistorySignature(result, target, 'changed'),
        `${result.actionType || 'ACTION'} ${target}${result.relation ? ` ${result.relation}` : ''}: changed world state`
      );
      return;
    }

    const summary = this.summarizeNoProgressAction(result);
    if (!summary) return;
    this.upsertActionHistory(stateKey, summary.signature, summary.text);
  }

  private summarizeNoProgressAction(
    result: NpcPlanExecutionOutcome
  ): { signature: string; text: string } | null {
    const actionType = result.actionType || 'ACTION';
    const target = result.targetId || result.commandId || result.itemId || '';
    if (!target) return null;

    if (
      result.status === 'ok' &&
      (actionType === 'LOOK' || actionType === 'EXAMINE') &&
      !result.worldChanged &&
      (!result.discoveredEntityIds || result.discoveredEntityIds.length === 0)
    ) {
      return {
        signature: this.getActionHistorySignature(result, target, 'nothing_new'),
        text: `${actionType} ${target}${result.relation ? ` ${result.relation}` : ''}: inspected, nothing new found`,
      };
    }

    if (result.code === 'switch_already_open') {
      return {
        signature: this.getActionHistorySignature(result, target, 'already_open'),
        text: `${actionType} ${target}: already open`,
      };
    }

    if (result.code === 'switch_already_closed') {
      return {
        signature: this.getActionHistorySignature(result, target, 'already_closed'),
        text: `${actionType} ${target}: already closed`,
      };
    }

    if (
      result.code === 'repeated_without_progress' ||
      result.code === 'pattern_without_progress' ||
      result.code === 'pattern_loop_sleep'
    ) {
      return {
        signature: this.getActionHistorySignature(result, target, 'repeated_no_progress'),
        text: `${actionType} ${target}${result.relation ? ` ${result.relation}` : ''}: repeated without progress`,
      };
    }

    return null;
  }

  private upsertActionHistory(stateKey: string, signature: string, summary: string): void {
    const now = Date.now();
    const records = this.actionHistories.get(stateKey) || [];
    const existing = records.find((record) => record.signature === signature);
    if (existing) {
      existing.count += 1;
      existing.summary = summary;
      existing.updatedAt = now;
    } else {
      records.push({ signature, summary, count: 1, updatedAt: now });
    }
    records.sort((a, b) => a.updatedAt - b.updatedAt);
    this.actionHistories.set(stateKey, records.slice(-PM_ACTION_HISTORY_LIMIT));
  }

  private getActionHistorySignature(
    result: NpcPlanExecutionOutcome,
    target: string,
    suffix: string
  ): string {
    const actionType = result.actionType || 'ACTION';
    const relation =
      (actionType === 'LOOK' || actionType === 'EXAMINE') && result.relation
        ? `:${result.relation}`
        : '';
    return `${actionType}:${target}${relation}:${suffix}`;
  }

  private removeActionHistoryForTarget(stateKey: string, target: string): void {
    const records = this.actionHistories.get(stateKey);
    if (!records?.length) return;
    this.actionHistories.set(
      stateKey,
      records.filter((record) => !record.signature.includes(`:${target}:`))
    );
  }

  private getNpcActionHistory(sceneId: string, npcId: string): string[] | undefined {
    const records = this.actionHistories.get(`${sceneId}:${npcId}`);
    if (!records?.length) return undefined;
    return records.map((record) =>
      record.count > 1 ? `${record.summary} x${record.count}` : record.summary
    );
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
    const currentGeneration = this.haltGenerationId;
    const currentScene = batch.scene;
    globalThis.setTimeout(() => {
      if (
        this.haltGenerationId !== currentGeneration ||
        this.game.sceneManager.currentScene !== currentScene
      )
        return;
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

  private logStrategyDebug(debug: NpcPuppetMasterStrategyDebugInfo): void {
    const console = (this.game as any).console;
    const isPmPeek = !!console?.parserPeekPmEnabled;
    const isLlmPeek = !!console?.parserPeekLlmEnabled;
    if (!isPmPeek && !isLlmPeek) return;

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

    if (isLlmPeek && debug.prompt) {
      logDebug(formatFullSection('strategy llm prompt', debug.prompt));
      logDebug(
        formatFullSection('strategy llm response', {
          rawResponse: debug.rawResponse || '',
          extractedJson: debug.extractedJson,
          error: debug.error,
          memoryUpdated: debug.memoryUpdated,
          objectivesUpdated: debug.objectivesUpdated,
          waitMs: debug.waitMs,
          fallback: debug.fallback,
          durationMs: debug.durationMs,
          inputTokens: debug.inputTokens,
          tokensGenerated: debug.tokensGenerated,
          cacheCreationInputTokens: debug.cacheCreationInputTokens,
          cacheReadInputTokens: debug.cacheReadInputTokens,
          staticPrefix: debug.staticPrefix,
        })
      );
    }

    if (isPmPeek) {
      const lines = [
        debug.error
          ? `--- PM STRATEGY RESPONSE (ERROR: ${debug.error}) ---`
          : '--- PM STRATEGY RESPONSE ---',
        `${debug.npcId}: memory updated: ${debug.memoryUpdated}`,
        `${debug.npcId}: objectives updated: ${JSON.stringify(debug.objectivesUpdated || [])}`,
        `${debug.npcId}: waitMs: ${debug.waitMs}`,
      ];
      if (debug.staticPrefix) {
        lines.push(this.formatStaticPrefixDebug(debug.staticPrefix));
      }
      if (debug.fallback) {
        lines.push(`fallback: WAIT ${debug.waitMs}`);
      }
      logDebug(lines.join('\n'));
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
          reasoning: debug.reasoning,
          acceptedPlans: debug.acceptedPlans,
          rejectedPlans: debug.rejectedPlans,
          filteredPlans: debug.filteredPlans,
          error: debug.error,
          provider: debug.provider,
          model: debug.model,
          durationMs: debug.durationMs,
          inputTokens: debug.inputTokens,
          tokensGenerated: debug.tokensGenerated,
          cacheCreationInputTokens: debug.cacheCreationInputTokens,
          cacheReadInputTokens: debug.cacheReadInputTokens,
          staticPrefix: debug.staticPrefix,
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
        if (debug.staticPrefix) {
          promptLines.push(this.formatStaticPrefixDebug(debug.staticPrefix));
        }
        if (debug.dynamicPrompt) {
          promptLines.push(
            `Dynamic prompt: ${debug.dynamicPrompt.characters} chars | ~${debug.dynamicPrompt.estimatedTokens} tokens | sections: ${JSON.stringify(debug.dynamicPrompt.sections)}`
          );
        }

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
            } else if (t.type === 'plan_interrupted') {
              triggerStr = `Plan interrupted (${t.reason})`;
            } else if (t.type === 'plan_completed') {
              triggerStr = `Plan completed (${Array.isArray(t.results) ? t.results.length : 0} results)`;
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
                  } else if (ev.kind === 'action') {
                    promptLines.push(`Action: ${ev.text}`);
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
              if (
                npc.inventory &&
                npc.inventory.available &&
                Array.isArray(npc.inventory.itemIds)
              ) {
                const itemNames = npc.inventory.itemIds.map((id: unknown) => String(id));
                if (itemNames.length > 0) {
                  invStr = ` | Inventory: [${itemNames.join(', ')}]`;
                }
              }
              promptLines.push(
                `  * ${npc.id} -> Objectives: ${objStr} | Memory: ${memStr}${invStr}`
              );
              const knownEntities = Array.isArray(npc.knownEntities)
                ? npc.knownEntities.map((entry: any) => ({
                    id: String(entry.id || ''),
                    kind: entry.kind,
                    lastSeenSceneId: entry.lastSeenSceneId,
                  }))
                : [];
              promptLines.push(`    knownEntities: ${JSON.stringify(knownEntities)}`);
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
        if (debug.reasoning) {
          responseLines.push(`Reasoning: ${debug.reasoning}`);
        }
        const acceptedPlans = debug.acceptedPlans || [];
        const rejectedPlans = debug.rejectedPlans || [];
        const hasAcceptedPlans = acceptedPlans.length > 0;
        const hasRejectedPlans = rejectedPlans.length > 0;
        if (hasAcceptedPlans) {
          for (const plan of acceptedPlans) {
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
            if (Array.isArray(plan.interruptOn) && plan.interruptOn.length > 0) {
              responseLines.push(`  * Interrupt On: ${JSON.stringify(plan.interruptOn)}`);
            }
          }
        }
        if (hasRejectedPlans) {
          responseLines.push('Plans rejected before execution:');
          for (const rejected of rejectedPlans) {
            responseLines.push(
              `  * ${rejected.plan.npcId}: ${JSON.stringify(rejected.missingItems)}`
            );
            responseLines.push(`    retryScheduled: ${rejected.retryScheduled}`);
          }
        }
        if (!hasAcceptedPlans && !hasRejectedPlans) {
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

  private formatStaticPrefixDebug(debug: NpcStaticPrefixDebugInfo): string {
    return `Static prefix: ${debug.hash} | ${debug.characters} chars | ~${debug.estimatedTokens} tokens | cache eligible: ${debug.cacheEligible ? 'yes' : 'no'}`;
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

    const normalizedSteps = Array.isArray(record.steps)
      ? record.steps
          .map((step) => this.normalizeStep(step))
          .filter((step): step is NpcPlanStep => !!step)
      : [];
    const traverseIndex = normalizedSteps.findIndex((step) => step.type === 'TRAVERSE_EXIT');
    const steps =
      traverseIndex >= 0 ? normalizedSteps.slice(0, traverseIndex + 1) : normalizedSteps;
    const memory = typeof record.memory === 'string' ? record.memory.trim() : undefined;
    if (!steps.length && memory === undefined) return null;
    const interruptOn = Array.isArray(record.interruptOn)
      ? record.interruptOn
          .map((condition) => this.normalizeInterruptCondition(condition))
          .filter((condition): condition is NpcPlanInterruptCondition => !!condition)
      : undefined;
    return {
      npcId,
      steps,
      ...(memory !== undefined ? { memory } : {}),
      ...(interruptOn !== undefined ? { interruptOn } : {}),
    };
  }

  private normalizeInterruptCondition(value: unknown): NpcPlanInterruptCondition | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.type === 'ITEM_FOUND') {
      const itemId = typeof record.itemId === 'string' ? record.itemId.trim() : '';
      return itemId ? { type: 'ITEM_FOUND', itemId } : { type: 'ITEM_FOUND' };
    }
    if (record.type === 'WORLD_CHANGED') return { type: 'WORLD_CHANGED' };
    if (record.type === 'ACTION_FAILED') return { type: 'ACTION_FAILED' };
    if (record.type === 'STATE_CHANGED') {
      const targetId = typeof record.targetId === 'string' ? record.targetId.trim() : '';
      const stateId = typeof record.stateId === 'string' ? record.stateId.trim() : '';
      return {
        type: 'STATE_CHANGED',
        ...(targetId ? { targetId } : {}),
        ...(stateId ? { stateId } : {}),
      };
    }
    return null;
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
    if (record.type === 'TRAVERSE_EXIT') {
      const targetId = typeof record.targetId === 'string' ? record.targetId.trim() : '';
      return targetId ? { type: 'TRAVERSE_EXIT', targetId } : null;
    }
    if (
      record.type === 'LOOK' ||
      record.type === 'EXAMINE' ||
      record.type === 'OPEN' ||
      record.type === 'CLOSE'
    ) {
      const targetId = typeof record.targetId === 'string' ? record.targetId.trim() : '';
      if (!targetId) return null;
      if (record.type === 'LOOK' || record.type === 'EXAMINE') {
        const relation = this.normalizeSpatialRelation(record.relation);
        return relation
          ? { type: record.type, targetId, relation }
          : { type: record.type, targetId };
      }
      return { type: record.type, targetId };
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
    if (record.type === 'THINK_STRATEGY') {
      const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
      return reason ? { type: 'THINK_STRATEGY', reason } : { type: 'THINK_STRATEGY' };
    }
    return null;
  }

  private normalizeSpatialRelation(value: unknown): 'in' | 'on' | 'under' | 'behind' | null {
    return value === 'in' || value === 'on' || value === 'under' || value === 'behind'
      ? value
      : null;
  }
}
