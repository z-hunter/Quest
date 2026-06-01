import type { ILlmProvider, LlmProviderContent, LlmProviderMessage } from './llm/ILlmProvider';
import { ActorPlanExecutor } from './ActorPlanExecutor';
import { NpcWorldModelBuilder } from './NpcWorldModelBuilder';
import type { IGame } from '../core/IGame';
import type { Scene } from '../scene/Scene';
import type { ActorMoveResult } from '../entities/Actor';
import type {
  NpcPlan,
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
  'Reliable steps are SAY, MEMORY_SET, OBJECTIVES_SET, WAIT, and MOVE_TO.',
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
      type: 'move_completed';
      result: ActorMoveResult;
    };

export class NpcPuppetMaster {
  private provider: ILlmProvider;
  private readonly worldModelBuilder: NpcWorldModelBuilder;
  private readonly executor: ActorPlanExecutor;
  private readonly game: IGame;
  private systemPromptCache: string | null = null;
  private processingScenes = new Set<string>();
  private lastDebugInfo: NpcPuppetMasterDebugInfo | null = null;

  constructor(game: IGame, provider: ILlmProvider) {
    this.game = game;
    this.provider = provider;
    this.worldModelBuilder = new NpcWorldModelBuilder(game);
    this.executor = new ActorPlanExecutor(
      game,
      (npcId, ms) => {
        globalThis.setTimeout(() => {
          const scene = game.sceneManager.currentScene;
          if (scene) {
            void this.processNpc(scene, npcId, { type: 'wait_elapsed', ms });
          }
        }, ms);
      },
      (npcId, result) => {
        const scene = game.sceneManager.currentScene;
        if (scene) {
          void this.processNpc(scene, npcId, { type: 'move_completed', result });
        }
      }
    );
  }

  setProvider(provider: ILlmProvider): void {
    this.provider = provider;
  }

  getLastDebugInfo(): NpcPuppetMasterDebugInfo | null {
    return this.lastDebugInfo;
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

    this.processingScenes.add(processingKey);
    try {
      const worldModel = this.worldModelBuilder.build(scene);
      const plans = await this.processWorldModel(worldModel);
      if (this.lastDebugInfo?.error) return [];
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

    this.processingScenes.add(processingKey);
    try {
      const fullWorldModel = this.worldModelBuilder.build(scene);
      const worldModel = {
        ...fullWorldModel,
        npcs: fullWorldModel.npcs.filter((npc) => npc.id === npcId),
      };
      if (!worldModel.npcs.length) return [];
      return await this.processWorldModel(worldModel, trigger);
    } finally {
      this.processingScenes.delete(processingKey);
    }
  }

  private async processWorldModel(
    worldModel: NpcWorldModel,
    trigger?: NpcIndividualTrigger
  ): Promise<NpcPlan[]> {
    const system = await this.buildSystemPrompt(worldModel);
    const messages = this.buildMessages(worldModel, trigger);
    const response = await this.provider.sendMessageStream(system, messages, () => {});

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
      this.executor.executePlan(plan);
    }
    return normalized.plans;
  }

  private async buildSystemPrompt(worldModel: NpcWorldModel): Promise<LlmProviderContent> {
    const systemPrompt = await this.loadSystemPrompt();
    const staticContext = {
      scene: worldModel.scene,
      npcs: worldModel.npcs.map((npc) => ({
        id: npc.id,
        title: npc.title,
        lore: npc.lore,
        objectives: npc.objectives,
        visibleEntities: npc.visibleEntities,
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
    trigger?: NpcIndividualTrigger
  ): LlmProviderMessage[] {
    const dynamicContext = {
      ...(trigger ? { trigger } : {}),
      unreadSceneLog: worldModel.unreadSceneLog,
      recentSceneLog: worldModel.recentSceneLog,
      npcs: worldModel.npcs.map((npc) => ({
        id: npc.id,
        memory: npc.memory,
        heardEntries: npc.heardEntries,
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
    if (!console?.parserPeekPmEnabled || typeof console.log !== 'function') return;
    const debug = this.lastDebugInfo;
    if (!debug) return;

    const formatSection = (title: string, value: unknown) => {
      const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      return `--- ${title.toUpperCase()} ---\n${body}`;
    };

    if (debug.prompt) {
      console.log(formatSection('pm prompt', debug.prompt), 'info', { showInClosed: false });
    }

    console.log(
      formatSection('pm response', {
        rawResponse: debug.rawResponse || '',
        extractedJson: debug.extractedJson,
        acceptedPlans: debug.acceptedPlans,
        filteredPlans: debug.filteredPlans,
        error: debug.error,
        provider: debug.provider,
        model: debug.model,
        matched: debug.matched,
        durationMs: debug.durationMs,
        inputTokens: debug.inputTokens,
        tokensGenerated: debug.tokensGenerated,
        cacheCreationInputTokens: debug.cacheCreationInputTokens,
        cacheReadInputTokens: debug.cacheReadInputTokens,
      }),
      'info',
      { showInClosed: false }
    );
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
    if (record.type === 'WAIT') {
      const ms = typeof record.ms === 'number' && Number.isFinite(record.ms) ? record.ms : 0;
      return ms > 0 ? { type: 'WAIT', ms } : null;
    }
    return null;
  }
}
