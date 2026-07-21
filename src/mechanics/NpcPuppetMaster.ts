import type { ILlmProvider, LlmProviderContent, LlmProviderMessage } from './llm/ILlmProvider';
import { ShadowLogger } from './slm/ShadowLogger';
import { SlmInferenceEngine } from './slm/SlmInferenceEngine';
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
  NpcContinuationState,
  NpcContinuationStateSnapshot,
  NpcStaticPrefixDebugInfo,
  NpcWorldModel,
} from './npcTypes';
import { assertNpcPlan } from '../contracts/runtimeSchemas';
import {
  findNpcObjective,
  normalizeNpcObjectiveDraft,
  normalizeNpcObjectives,
  type NpcObjective,
} from './npcState';
import type { NpcObjectiveCompletionEvidence } from './npcTypes';

const SYSTEM_PROMPT_URL = '/text/system/npc-pm-system.md';
const FALLBACK_SYSTEM_PROMPT = [
  'You are the Puppet Master for NPCs in a retro adventure game.',
  'Respond with exactly one JSON object and no extra text.',
  'Return {"kind":"pm_response","plans":[...]}.',
  'You may include a short top-level "reasoning" string for diagnostics; it never changes runtime behavior. Omit it for a plan consisting solely of SAY or one obvious MOVE_TO, unless explaining a genuinely appropriate silence.',
  'Each plan must target a real NPC id from context.',
  'The scene-static catalog describes authored identity and affordances only; catalog membership never proves current physical presence. Inventory items can leave with another actor while the catalog remains cached.',
  'Current presence is confirmed only by this NPC visible dynamic entities or visible inventory. knownEntities and lastSeenSceneId are historical knowledge.',
  'Speech is scene-local by default: an NPC hears and receives dialogue events only from its currentSceneId. Do not speak to or expect a reply from an actor absent from visible dynamic entities in this scene. Cross-scene communication requires an explicit future mechanic such as a radio; never assume it.',
  'Never target hidden, unknown, unseen, or merely remembered entities. If an item is absent from visible dynamic entities and visible inventory, inspect a visible known anchor instead of acting on the item directly.',
  'plan_rejected_missing_items means the item lacked valid current presence or scope, not that it exists nearby behind a blocked route.',
  'Observed action entries in newEvents/recentEvents are passive context. They do not require a reply or plan unless they materially affect this NPC, its objectives, or the current situation.',
  'For direct player speech received by a visible listening NPC, return a plan with a concise SAY response whenever the speech addresses, questions, accuses, greets, or otherwise materially concerns that NPC. Return an empty plans array only when silence is genuinely appropriate; then reasoning MUST explicitly state why this NPC should not respond. Never say in reasoning that the NPC should answer and then return no plan.',
  'Whenever an NPC decides, promises, volunteers, accepts responsibility, or otherwise commits to future work not already covered by an active objective, the same plan MUST first add a concrete OBJECTIVE_ADD. This is mandatory for work the NPC chose to do for another NPC as well as its own work; never leave a commitment only in dialogue, action history, or memory.',
  'Reliable steps are SAY, MEMORY_ADD, MEMORY_REMOVE, OBJECTIVE_ADD, OBJECTIVE_UPDATE, OBJECTIVE_MARK_COMPLETED, OBJECTIVE_REMOVE, WAIT, THINK_STRATEGY, MOVE_TO, TRAVERSE_EXIT, LOOK, EXAMINE, OPEN, CLOSE, TAKE, GIVE, PUT, and COMMAND.',
  'For an entity with exit metadata, MOVE_TO it first when needed, then use TRAVERSE_EXIT. Never treat MOVE_TO alone as crossing an exit.',
  'TRAVERSE_EXIT is always the final physical step of a plan because scene transfer discards the remaining tail.',
  'Use COMMAND only for an authored command listed on a visible entity; never invent a generic use action.',
  'For a listed command, available means its direct affordance is present; execute it only when executable is true. Read preconditions and inventory entries by stable id, containerId, relation, groups, and states; items with similar titles or groups are distinct instances. inventory.itemIds lists only the Actor main inventory; inventory.items is a recursive container map. TAKE on an accessible nested inventory item extracts it into the Actor main inventory, and PUT can then place a main-inventory item into a listed target relation.',
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
  'CURRENT OBJECTIVES and MEMORY are your durable working state for the NEXT PM turn. On EVERY call, silently audit every objective (including every subtask) and every memory note against current context and authoritative actionHistory before choosing the plan. This is primarily for your own benefit: stale memories and obsolete, completed, or misleading objectives make your next plans worse and obstruct goal completion. Make the necessary MEMORY_REMOVE, OBJECTIVE_MARK_COMPLETED, OBJECTIVE_REMOVE, OBJECTIVE_UPDATE, OBJECTIVE_ADD, or MEMORY_ADD operations in the same plan when the audit finds a change; do not emit no-op cognition steps when nothing needs changing. Whenever the NPC commits to future work, whether for itself or voluntarily for another NPC, add a concrete OBJECTIVE_ADD in that same plan unless an active objective already covers the commitment; never leave it only in dialogue, actionHistory, or memory. Add concrete new prerequisites, update changed plans, remove obsolete objectives and stale memory, and use OBJECTIVE_MARK_COMPLETED immediately after runtime-confirmed success. OBJECTIVE_MARK_COMPLETED only records an already completed task; it does not perform the task. An unconfirmed marker becomes [PENDING CONFIRMATION] for the next PM turn; repeat it only after checking runtime confirmation, otherwise continue the still-active objective. A marked objective appears once as [JUST COMPLETED] next turn and is then removed automatically, so do not write [COMPLETED] into objective text. A [JUST ARRIVED] memory note is temporary runtime context and will be removed after this turn. Always retain the parent goal until runtime evidence confirms completion or impossibility, and add an immediate concrete subgoal before dependent physical steps. MEMORY is factual only: add confirmed facts and remove stale facts.',
  'When you add a blocker objective, MUST include the first concrete non-state step toward it in the same plan (for example OPEN, EXAMINE, MOVE_TO, WAIT, or COMMAND). Do not return only OBJECTIVE_ADD plus SAY.',
  'To confirm an objective shown as [PENDING CONFIRMATION], repeat OBJECTIVE_MARK_COMPLETED with evidence copied exactly from a successful current action result, including actionType and a matching commandId, itemId, targetId, or code. Without that evidence the objective remains active.',
  'Prefer a well-structured multi-step plan over a short plan when the steps are one coherent procedure and runtime interruptOn conditions can stop the chain to save LLM calls.',
  'Use short plans when the next step depends on an unknown result that cannot be expressed with interruptOn.',
  'inventory.available false means the Actor has no inventory, not that it is full.',
  'Do not store attempted actions as successful facts in memory.',
  'Do not record a proposed trade or floor drop as a completed ownership transfer without runtime confirmation.',
  'A proposal, agreement, or a GIVE in the current response is not a completed transfer. Only item_given, refreshed inventory ownership, or authoritative actionHistory confirms it; recipients must not claim receipt or act on the item before then.',
  'Runtime may insert MOVE_TO before an explicit TAKE when the item has a route_available approach.',
  'If a plan is rejected for missing items, leading SAY and memory operations may already have executed once; replace unavailable references and do not repeat the same speech or physical plan.',
  'A player offer does not make an item reachable; negotiate or ask them to transfer it instead of using an unavailable item.',
  'Do not repeat an action when worldChanged is false and repeatCount is 2 or more.',
  'Repeated MOVE_TO failures include moveAttemptsRemaining. Retry the same target only while it is above zero; at zero, stop until conditions change.',
  'Only current visible dynamic entities can be inspected (LOOK, EXAMINE); their supported relations are in, on, under, behind unless explicitly stated otherwise.',
  'Dynamic entities are currently present. Omitted dynamic fields mean visibility visible, interaction reachable, and approach already_reachable; explicit fields override those defaults. Never infer presence or reachability from the static catalog.',
].join('\n');

const STRATEGY_SYSTEM_PROMPT = [
  'You are the internal strategy analyst for one NPC in a retro adventure game.',
  'Return exactly one JSON object and no extra text.',
  'Return {"kind":"npc_strategy_response","npcId":"...","updates":[memory/objective update steps],"waitMs":30000}.',
  'Do not role-play speech. Do not produce SAY, MOVE_TO, LOOK, EXAMINE, OPEN, CLOSE, TAKE, GIVE, PUT, COMMAND, or any physical action.',
  'updates may contain only MEMORY_ADD, MEMORY_REMOVE, OBJECTIVE_ADD, OBJECTIVE_UPDATE, OBJECTIVE_MARK_COMPLETED, or OBJECTIVE_REMOVE. OBJECTIVE_MARK_COMPLETED only records a task already confirmed complete by runtime; it never performs that task.',
  "On every strategy call, audit every objective (including subtasks) and every memory note against the current situation, confirmed facts, actionHistory, recent outcomes, inventory, visible entities, and commands before deciding updates. This keeps the NPC's own future planning reliable: stale memory and obsolete, completed, or misleading objectives obstruct goal completion.",
  'Write compact memory only with confirmed facts and useful conclusions. Remove noisy, obsolete, disproven, or speculative details.',
  'Revise objectives if any current goal is impossible, blocked, already satisfied, obsolete, or needs a different strategy. Return only the necessary updates; do not add no-op updates when the audit finds nothing to change.',
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
  sceneId: string;
  timestamp: number;
  actionType?: NpcPlanExecutionOutcome['actionType'];
  code?: string;
  status: NpcPlanExecutionOutcome['status'];
  targetId?: string;
  itemId?: string;
  commandId?: string;
  worldChanged: boolean;
  summary: string;
};

export type NpcPuppetMasterSaveState = {
  actionHistories: Record<string, NpcActionHistoryRecord[]>;
  continuations: Array<{
    stateKey: string;
    state: 'needs_replan';
    reason: 'save_restore';
  }>;
};

type NpcStrategyResponse = {
  kind: 'npc_strategy_response';
  npcId: string;
  updates?: NpcPlanStep[];
  waitMs?: number;
};

type PendingPlanContinuation = {
  state: 'awaiting_barrier';
  npcId: string;
  barrierStep: NpcPlanStep;
  steps: NpcPlanStep[];
  memory?: string;
  interruptOn: NpcPlanInterruptCondition[];
  completedSteps: NpcPlanExecutionOutcome[];
  trackCompletion: boolean;
  inventoryItemIds?: string[];
  observableItemIds?: string[];
};

const PM_BATCH_DEBOUNCE_MS = (globalThis as any).process?.env?.NODE_ENV === 'test' ? 150 : 400;
// в режиме тестов PM_BATCH_DEBOUNCE_MS остается 150 мс
const PM_REPEAT_WARNING_COUNT = 2;
const PM_REPEAT_SUPPRESS_COUNT = 3;
const PM_LOOP_COOLDOWN_MS = 10_000;
const PM_RATE_WINDOW_MS = 10_000;
const PM_MAX_NPC_CALLS_PER_WINDOW = 6;
const PM_MAX_SCENE_CALLS_PER_WINDOW = 12;
// State-only PM turns (for example OBJECTIVE_ADD + SAY) need one follow-up
// wake so the NPC can choose a concrete action. They must still be bounded:
// an unreliable provider must not be able to keep an NPC in an LLM-only loop.
const PM_STATE_ONLY_CONTINUATION_LIMIT = 3;
// A conversational-only reply is visible to the player. Give it a short
// beat before resuming autonomous goal pursuit instead of immediately making
// another provider request in the same turn.
const PM_SAY_ONLY_CONTINUATION_DELAY_MS = 2_000;
// Runtime barriers normally resolve immediately through ActorPlanExecutor's
// action-completion callback. Keep a recovery path nevertheless: a dropped
// host callback must not leave an NPC immune to all later scene events.
const PM_PENDING_CONTINUATION_TIMEOUT_MS = 15_000;
const PM_PATTERN_LOOP_WINDOW = 6;
const PM_PATTERN_LOOP_UNIQUE_LIMIT = 3;
const PM_ACTION_HISTORY_LIMIT = 20;
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
  private pendingContinuationTimeouts = new Map<string, any>();
  // Events that arrive while a runtime barrier is outstanding belong to the
  // next PM turn, not to a replacement plan.  Keeping them by continuation
  // key makes the hand-off explicit and prevents timer based requeue loops.
  private deferredContinuationTriggers = new Map<string, NpcIndividualTrigger[]>();
  private continuationStates = new Map<string, NpcContinuationStateSnapshot>();
  private restoredContinuationStates = new Map<string, 'needs_replan'>();
  private stateOnlyContinuationCounts = new Map<string, number>();
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
        const scene = this.getNpcScene(npcId);
        if (scene) {
          this.scheduleNpc(scene, npcId, { type: 'move_completed', result });
        }
      },
      (npcId, result, fromExecutor) => {
        const scene = this.getNpcScene(npcId);
        if (scene) {
          this.scheduleNpc(
            scene,
            npcId,
            {
              type: 'action_completed',
              result: this.recordActionProgress(scene, npcId, result),
            },
            fromExecutor === true
          );
        }
      },
      (npcId, reason) => {
        const scene = this.getNpcScene(npcId);
        if (scene) {
          void this.processNpcStrategy(scene, npcId, reason);
        }
      }
    );
  }

  setProvider(provider: ILlmProvider): void {
    this.provider = provider;
  }

  exportSaveState(): NpcPuppetMasterSaveState {
    const continuationKeys = new Set([
      ...this.pendingPlanContinuations.keys(),
      ...this.restoredContinuationStates.keys(),
    ]);
    return {
      actionHistories: Object.fromEntries(
        [...this.actionHistories.entries()].map(([key, records]) => [
          key,
          records.map((record) => ({ ...record })),
        ])
      ),
      continuations: [...continuationKeys].map((stateKey) => ({
        stateKey,
        state: 'needs_replan' as const,
        reason: 'save_restore' as const,
      })),
    };
  }

  importSaveState(state: Partial<NpcPuppetMasterSaveState> | null | undefined): void {
    this.haltAllNpcs();
    for (const [key, records] of Object.entries(state?.actionHistories || {})) {
      if (!Array.isArray(records)) continue;
      const legacySeparator = key.lastIndexOf(':');
      const legacySceneId = legacySeparator > 0 ? key.slice(0, legacySeparator) : '';
      const npcId = legacySceneId ? key.slice(legacySeparator + 1) : key;
      if (!npcId) continue;
      this.actionHistories.set(
        npcId,
        records
          .flatMap((record: any): NpcActionHistoryRecord[] => {
            if (
              record &&
              typeof record.sceneId === 'string' &&
              typeof record.timestamp === 'number' &&
              typeof record.summary === 'string' &&
              typeof record.status === 'string' &&
              typeof record.worldChanged === 'boolean'
            ) {
              return [record as NpcActionHistoryRecord];
            }
            // SaveState v1 used sceneId:npcId keys and aggregated summaries.
            // Preserve those factual records when loading an older save.
            if (!legacySceneId || !record || typeof record.summary !== 'string') return [];
            return [
              {
                sceneId: legacySceneId,
                timestamp: Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now(),
                status: 'ok',
                worldChanged: /changed world state/i.test(record.summary),
                summary: record.summary,
              },
            ];
          })
          .slice(-PM_ACTION_HISTORY_LIMIT)
          .map((record) => ({ ...record }))
      );
    }
    for (const continuation of state?.continuations || []) {
      if (
        continuation?.state === 'needs_replan' &&
        typeof continuation.stateKey === 'string' &&
        continuation.stateKey.trim()
      ) {
        this.restoredContinuationStates.set(continuation.stateKey, 'needs_replan');
        this.continuationStates.set(continuation.stateKey, {
          state: 'needs_replan',
          changedAt: Date.now(),
          reason: 'save_restore',
        });
      }
    }
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
    for (const timeoutId of this.pendingContinuationTimeouts.values()) {
      globalThis.clearTimeout(timeoutId);
    }
    this.pendingContinuationTimeouts.clear();
    this.deferredContinuationTriggers.clear();
    this.continuationStates.clear();
    this.restoredContinuationStates.clear();
    this.stateOnlyContinuationCounts.clear();
    this.npcCallTimes.clear();
    this.sceneCallTimes.clear();
    this.executor.clearAllPending();

    for (const scene of this.game.sceneManager.scenes.values()) {
      for (const entity of scene.entities) {
        if (entity instanceof Actor && ComponentSystem.isNpc(entity)) {
          entity.stop();
          this.executor.clearState(entity.name);
        }
      }
    }
  }

  getLastDebugInfo(): NpcPuppetMasterDebugInfo | null {
    return this.lastDebugInfo;
  }

  getContinuationState(sceneId: string, npcId: string): NpcContinuationStateSnapshot {
    return (
      this.continuationStates.get(`${sceneId}:${npcId}`) || {
        state: 'idle',
        changedAt: 0,
      }
    );
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
      this.stateOnlyContinuationCounts.delete(this.getNpcStateKey(scene, npcId));
      this.npcCallTimes.delete(this.getNpcStateKey(scene, npcId));
      completions.push(this.enqueueNpc(scene, npcId));
    }
    await Promise.all(completions);
  }

  scheduleNpc(
    scene: Scene,
    npcId: string,
    trigger: NpcIndividualTrigger,
    preserveTerminalCompletion: boolean = false
  ): void {
    const stateKey = this.getNpcStateKey(scene, npcId);
    const loopState = this.loopStates.get(stateKey);
    const patternLoopState = this.patternLoopStates.get(stateKey);
    if (
      trigger.type === 'action_completed' &&
      patternLoopState?.cooldownUntil &&
      patternLoopState.cooldownUntil > Date.now() &&
      // This is the terminal result that started the cooldown.  It still has
      // to resolve an already-scheduled runtime barrier; suppressing it here
      // strands the pending continuation permanently.
      !(preserveTerminalCompletion && this.isTerminalNoProgressCode(trigger.result.code))
    ) {
      return;
    }
    if (
      trigger.type === 'action_completed' &&
      loopState?.cooldownUntil &&
      loopState.cooldownUntil > Date.now() &&
      trigger.result.repeatKey === loopState.repeatKey &&
      (trigger.result.repeatCount || 0) > PM_REPEAT_SUPPRESS_COUNT &&
      !(preserveTerminalCompletion && this.isTerminalNoProgressCode(trigger.result.code))
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
      const plans = await this.processWorldModel(scene, worldModel);
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
      const worldModel = this.worldModelBuilder.build(scene, { npcIds: [npcId] });
      if (!worldModel.npcs.length) return [];
      const plans = await this.processWorldModel(scene, worldModel, trigger);
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
    scene: Scene,
    worldModel: NpcWorldModel,
    trigger?: NpcIndividualTrigger | NpcBatchTrigger
  ): Promise<NpcPlan[]> {
    const currentGeneration = this.haltGenerationId;

    // HYBRID ROUTER: Try fast in-engine SLM first for routine tasks
    if (worldModel.npcs && worldModel.npcs.length === 1 && SlmInferenceEngine.isReady()) {
      const npcContext = worldModel.npcs[0];
      const slmResult = await SlmInferenceEngine.infer(npcContext);
      if (slmResult.kind === 'success' && slmResult.plans.length > 0) {
        const normalized = this.normalizeResponse(
          { kind: 'pm_response', plans: slmResult.plans },
          worldModel
        );
        if (normalized.valid) {
          const expandedPlans = this.expandImplicitApproaches(normalized.plans, worldModel);
          const itemValidation = this.validatePlanItems(expandedPlans, worldModel, trigger);
          const filteredPlans = this.deferPlansDependingOnUnconfirmedGive(
            this.removePrematureGiveClaims(
              this.removePrematureStrategySteps(
                this.removeRepeatedNoProgressSteps(itemValidation.plans, trigger),
                trigger
              )
            )
          );
          const completionValidation = this.validateObjectiveCompletionConfirmations(
            filteredPlans,
            worldModel,
            trigger
          );
          const acceptedPlans = completionValidation.plans;
          if (acceptedPlans.length > 0) {
            this.settlePendingObjectiveConfirmations(worldModel, acceptedPlans);
            this.traceWake('slm_handled_routine', {
              sceneId: worldModel.scene.id,
              npcId: npcContext.id,
              steps: acceptedPlans[0].steps.length,
            });
            for (const plan of acceptedPlans) {
              const outcomes = this.executePlanAndTrackContinuation(
                plan,
                completionValidation.confirmedObjectiveIdsByNpc.get(plan.npcId)
              );
              const hasScheduled = outcomes.some((outcome) => outcome.status === 'scheduled');
              if (!hasScheduled) {
                ShadowLogger.commit(
                  plan.npcId,
                  'plan_completed',
                  outcomes.some((o) => o.worldChanged)
                );
              }
              const planTrigger =
                trigger?.type === 'batch'
                  ? [...(trigger.triggersByNpc[plan.npcId] || [])]
                      .reverse()
                      .find((candidate) => candidate.type === 'move_completed')
                  : trigger;
              this.maybeScheduleContinuation([plan], planTrigger, hasScheduled);
            }
            this.scheduleObjectiveConfirmationRetries(
              scene,
              completionValidation.rejectedNpcIds,
              acceptedPlans
            );
            return acceptedPlans;
          }
        }
      }
      this.traceWake('slm_escalated_to_llm', {
        sceneId: worldModel.scene.id,
        npcId: worldModel.npcs[0].id,
        reason: slmResult.kind === 'escalate' ? slmResult.reason : 'validation_failed',
      });
    }

    const system = await this.buildSystemPrompt(scene, worldModel);
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
      ? this.expandImplicitApproaches(normalized.plans, worldModel)
      : normalized.plans;
    const itemValidation = normalized.valid
      ? this.validatePlanItems(expandedPlans, worldModel, trigger)
      : { plans: normalized.plans, rejectedPlans: [] };
    const itemValidatedPlans = itemValidation.plans;
    const filteredPlans = normalized.valid
      ? this.deferPlansDependingOnUnconfirmedGive(
          this.removePrematureGiveClaims(
            this.removePrematureStrategySteps(
              this.removeRepeatedNoProgressSteps(
                this.removeUnsupportedDiscoveryClaims(
                  this.removeUnavailableCommandSteps(itemValidatedPlans, worldModel),
                  trigger
                ),
                trigger
              ),
              trigger
            )
          )
        )
      : itemValidatedPlans;
    const completionValidation = this.validateObjectiveCompletionConfirmations(
      filteredPlans,
      worldModel,
      trigger
    );
    const acceptedPlans = completionValidation.plans;
    acceptedPlans.forEach((plan, index) => assertNpcPlan(plan, `$.plans[${index}]`));
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

    // A pending marker is a one-turn claim. Keep it visible for the next PM
    // call only when the model repeats the marker; otherwise restore the
    // objective to active state so it can be planned again.
    this.settlePendingObjectiveConfirmations(worldModel, acceptedPlans);

    // Completed objectives were presented in this request as JUST COMPLETED.
    // Retire them only after that one PM turn, never by mutating their text.
    this.pruneObjectivesSeenAsCompleted(scene, worldModel);
    this.pruneTransientMemorySeenThisTurn(scene, worldModel);

    for (const plan of acceptedPlans) {
      const npcContext = worldModel.npcs.find((n) => n.id === plan.npcId);
      const planTrigger =
        trigger?.type === 'batch'
          ? [...(trigger.triggersByNpc[plan.npcId] || [])]
              .reverse()
              .find((candidate) => candidate.type === 'move_completed')
          : trigger;

      ShadowLogger.logWake(plan.npcId, planTrigger, staticPrefix.hash, npcContext, [plan]);
    }

    for (const plan of acceptedPlans) {
      const outcomes = this.executePlanAndTrackContinuation(
        plan,
        completionValidation.confirmedObjectiveIdsByNpc.get(plan.npcId)
      );
      const hasScheduled = outcomes.some((outcome) => outcome.status === 'scheduled');
      if (!hasScheduled) {
        ShadowLogger.commit(
          plan.npcId,
          'plan_completed',
          outcomes.some((o) => o.worldChanged)
        );
      }
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
    this.scheduleObjectiveConfirmationRetries(
      scene,
      completionValidation.rejectedNpcIds,
      acceptedPlans
    );
    return acceptedPlans;
  }

  private executePlanAndTrackContinuation(
    plan: NpcPlan,
    confirmedObjectiveIds?: ReadonlySet<string>
  ): NpcPlanExecutionOutcome[] {
    const scene = this.getNpcScene(plan.npcId);
    if (scene) {
      const stateKey = this.getNpcStateKey(scene, plan.npcId);
      if (this.pendingPlanContinuations.has(stateKey)) {
        // A caller may only replace a continuation through the formal
        // interrupt policy. Ordinary scene scans must wait for the barrier.
        this.traceWake('batch_deferred_pending_continuation', {
          sceneId: scene.id,
          npcId: plan.npcId,
          reason: 'replacement_plan_blocked',
        });
        return [];
      }
    }
    const observableItemIds = scene ? this.getNpcObservableItemIds(scene, plan.npcId) : [];
    const outcomes = this.executor.executePlan(plan, confirmedObjectiveIds);
    if (scene) {
      if (this.hasConcretePlanAction(plan)) {
        this.stateOnlyContinuationCounts.delete(this.getNpcStateKey(scene, plan.npcId));
      }
      this.storePendingContinuationAfterScheduledOutcome(
        scene,
        plan,
        outcomes,
        [],
        observableItemIds
      );
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
    const acceptedPlans: NpcPlan[] = [];
    const rejectedPlans: NonNullable<NpcPuppetMasterDebugInfo['rejectedPlans']> = [];
    for (const plan of plans) {
      const scene = this.getNpcScene(plan.npcId);
      const npc = worldModel.npcs.find((candidate) => candidate.id === plan.npcId);
      if (!npc) continue;
      const availableIds = new Set([
        ...(npc.inventory?.itemIds || []),
        ...(npc.entities || [])
          .filter((entity) => entity.interaction === 'held' || entity.interaction === 'reachable')
          .map((entity) => entity.id),
      ]);
      // `itemIds` intentionally contains only the Actor's main inventory.
      // Nested `inventory.items` are not already held at that level, but an
      // accessible child may be extracted with TAKE before a subsequent PUT.
      const nestedTakeableIds = new Set(
        (npc.inventory?.items || [])
          .filter((item) => item.containerId !== plan.npcId)
          .map((item) => item.id)
      );
      const knownItemIds = new Set(
        (npc.knownEntities || [])
          .filter((entity) => entity.kind === 'item')
          .map((entity) => entity.id)
      );
      const missing: Array<{ stepType: NpcPlanStep['type']; itemId: string }> = [];
      const entitiesById = new Map((npc.entities || []).map((entity) => [entity.id, entity]));
      const visibleActorIds = new Set((npc.actors || []).map((actor) => actor.id));
      const plannedAvailableIds = new Set(availableIds);
      for (let stepIndex = 0; stepIndex < plan.steps.length; stepIndex++) {
        const step = plan.steps[stepIndex];
        if ((step.type === 'PUT' || step.type === 'GIVE') && !availableIds.has(step.itemId)) {
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
          const canExtractFromNestedInventory = nestedTakeableIds.has(step.targetId);
          if (
            !plannedAvailableIds.has(step.targetId) &&
            !canBecomeReachable &&
            !canExtractFromNestedInventory
          ) {
            missing.push({ stepType: step.type, itemId: step.targetId });
          } else {
            plannedAvailableIds.add(step.targetId);
          }
        }
        if (step.type === 'GIVE') {
          const target = entitiesById.get(step.targetId);
          const hasPriorMove = plan.steps
            .slice(0, stepIndex)
            .some(
              (candidate) => candidate.type === 'MOVE_TO' && candidate.targetId === step.targetId
            );
          const canBecomeReachable = target?.approach === 'route_available' && hasPriorMove;
          if (
            !visibleActorIds.has(step.targetId) &&
            (!target || (!plannedAvailableIds.has(step.targetId) && !canBecomeReachable))
          ) {
            missing.push({ stepType: step.type, itemId: step.targetId });
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
      ShadowLogger.discard(plan.npcId);
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
        globalThis.setTimeout(() => {
          if (this.haltGenerationId !== currentGeneration || this.getNpcScene(plan.npcId) !== scene)
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

  private expandImplicitApproaches(plans: NpcPlan[], worldModel: NpcWorldModel): NpcPlan[] {
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
        if (step.type === 'GIVE') {
          const target = entitiesById.get(step.targetId);
          const hasPriorMove = steps.some(
            (candidate) => candidate.type === 'MOVE_TO' && candidate.targetId === step.targetId
          );
          if (
            target?.interaction !== 'reachable' &&
            target?.approach === 'route_available' &&
            !hasPriorMove
          ) {
            steps.push({ type: 'MOVE_TO', targetId: step.targetId });
            changed = true;
            this.traceWake('give_auto_approach_inserted', {
              sceneId: worldModel.scene.id,
              npcId: plan.npcId,
              targetId: step.targetId,
            });
          }
        }
        if (step.type === 'TRAVERSE_EXIT') {
          const target = entitiesById.get(step.targetId);
          const hasPriorMove = steps.some(
            (candidate) => candidate.type === 'MOVE_TO' && candidate.targetId === step.targetId
          );
          if (
            target?.interaction !== 'reachable' &&
            target?.approach === 'route_available' &&
            !hasPriorMove
          ) {
            steps.push({ type: 'MOVE_TO', targetId: step.targetId });
            changed = true;
            this.traceWake('exit_auto_approach_inserted', {
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
      if (
        step.type !== 'SAY' &&
        step.type !== 'MEMORY_SET' &&
        step.type !== 'MEMORY_ADD' &&
        step.type !== 'MEMORY_REMOVE' &&
        step.type !== 'OBJECTIVE_ADD' &&
        step.type !== 'OBJECTIVE_UPDATE' &&
        step.type !== 'OBJECTIVE_MARK_COMPLETED' &&
        step.type !== 'OBJECTIVE_REMOVE'
      )
        break;
      safePrefix.push(step);
    }
    return safePrefix;
  }

  /**
   * A single provider response is not a transaction: a recipient cannot act
   * on an item until the giver's semantic GIVE has emitted item_given.  Keep
   * such recipient plans out of this batch; a successful GIVE explicitly
   * wakes the recipient with refreshed inventory and SceneLog context. For a
   * closed cycle of GIVEs, one sender is retained to make the first confirmed
   * transfer possible.
   */
  private deferPlansDependingOnUnconfirmedGive(plans: NpcPlan[]): NpcPlan[] {
    const recipientIds = new Set(
      plans.flatMap((plan) =>
        plan.steps
          .filter((step): step is Extract<NpcPlanStep, { type: 'GIVE' }> => step.type === 'GIVE')
          .map((step) => step.targetId)
      )
    );
    if (!recipientIds.size) return plans;

    // A recipient normally must wait for item_given.  A cycle such as
    // A -> B and B -> A has no external first giver, though: deferring every
    // recipient would remove the entire response.  Keep one stable plan in
    // each strongly connected component to initiate the cycle; its runtime
    // item_given wake will refresh and safely resume the next recipient.
    const planNpcIds = new Set(plans.map((plan) => plan.npcId));
    const planOrder = new Map(plans.map((plan, index) => [plan.npcId, index]));
    const giveTargetsByNpcId = new Map<string, Set<string>>();
    for (const plan of plans) {
      const targets = giveTargetsByNpcId.get(plan.npcId) || new Set<string>();
      for (const step of plan.steps) {
        if (step.type === 'GIVE' && planNpcIds.has(step.targetId)) {
          targets.add(step.targetId);
        }
      }
      giveTargetsByNpcId.set(plan.npcId, targets);
    }

    const indexes = new Map<string, number>();
    const lowLinks = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const cycleStarters = new Map<string, string[]>();
    let nextIndex = 0;
    const visit = (npcId: string): void => {
      indexes.set(npcId, nextIndex);
      lowLinks.set(npcId, nextIndex);
      nextIndex += 1;
      stack.push(npcId);
      onStack.add(npcId);

      for (const targetId of giveTargetsByNpcId.get(npcId) || []) {
        if (!indexes.has(targetId)) {
          visit(targetId);
          lowLinks.set(npcId, Math.min(lowLinks.get(npcId)!, lowLinks.get(targetId)!));
        } else if (onStack.has(targetId)) {
          lowLinks.set(npcId, Math.min(lowLinks.get(npcId)!, indexes.get(targetId)!));
        }
      }

      if (lowLinks.get(npcId) !== indexes.get(npcId)) return;
      const component: string[] = [];
      let memberId: string;
      do {
        memberId = stack.pop()!;
        onStack.delete(memberId);
        component.push(memberId);
      } while (memberId !== npcId);

      const isSelfCycle = component.length === 1 && giveTargetsByNpcId.get(npcId)?.has(npcId);
      if (component.length < 2 && !isSelfCycle) return;
      component.sort((left, right) => planOrder.get(left)! - planOrder.get(right)!);
      cycleStarters.set(component[0], component);
    };
    for (const npcId of planNpcIds) {
      if (!indexes.has(npcId)) visit(npcId);
    }

    return plans.filter((plan) => {
      if (!recipientIds.has(plan.npcId)) return true;
      const cycle = cycleStarters.get(plan.npcId);
      if (cycle) {
        this.traceWake('recipient_plan_retained_to_break_give_cycle', {
          npcId: plan.npcId,
          cycleNpcIds: cycle,
        });
        return true;
      }
      this.traceWake('recipient_plan_deferred_pending_give', {
        npcId: plan.npcId,
        reason: 'unconfirmed_give_in_same_response',
        stepTypes: plan.steps.map((step) => step.type),
      });
      return false;
    });
  }

  /** Runtime confirmation is the only authority for completed ownership. */
  private removePrematureGiveClaims(plans: NpcPlan[]): NpcPlan[] {
    const completedTransferClaim = /\b(gave|given|traded|received|got|transferred)\b/i;
    return plans
      .map((plan) => {
        if (!plan.steps.some((step) => step.type === 'GIVE')) return plan;
        const steps = plan.steps.filter((step) => {
          if (step.type === 'SAY') return !completedTransferClaim.test(step.text);
          if (step.type === 'MEMORY_SET' || step.type === 'MEMORY_ADD') {
            return !completedTransferClaim.test(step.memory);
          }
          return true;
        });
        const memory =
          typeof plan.memory === 'string' && completedTransferClaim.test(plan.memory)
            ? undefined
            : plan.memory;
        if (steps.length === plan.steps.length && memory === plan.memory) return plan;
        this.traceWake('premature_give_claim_removed', {
          npcId: plan.npcId,
          removedStepCount: plan.steps.length - steps.length,
          removedPlanMemory: memory === undefined && plan.memory !== undefined,
        });
        return {
          npcId: plan.npcId,
          steps,
          ...(memory !== undefined ? { memory } : {}),
          ...(plan.interruptOn !== undefined ? { interruptOn: plan.interruptOn } : {}),
        };
      })
      .filter((plan) => plan.steps.length > 0 || plan.memory !== undefined);
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
    previousCompletedSteps: NpcPlanExecutionOutcome[] = [],
    observableItemIds: string[] = this.getNpcObservableItemIds(scene, plan.npcId)
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
      barrierStep.type !== 'MOVE_TO' &&
      // A scene transfer needs its completion hand-off even when it is the
      // whole plan.  Besides emitting plan completion in the destination,
      // that hand-off records the one-turn arrival fact used by the next PM
      // decision.  Without it, a bare TRAVERSE_EXIT loses the destination
      // context and the NPC can replan from stale travel history.
      barrierStep.type !== 'TRAVERSE_EXIT'
    ) {
      return;
    }
    const stateKey = this.getNpcStateKey(scene, plan.npcId);
    this.pendingPlanContinuations.set(stateKey, {
      state: 'awaiting_barrier',
      npcId: plan.npcId,
      barrierStep,
      steps: remainingSteps,
      ...(hasPendingMemory ? { memory: plan.memory } : {}),
      interruptOn,
      completedSteps: [...previousCompletedSteps, ...outcomes.slice(0, scheduledIndex)],
      trackCompletion,
      inventoryItemIds: this.getNpcInventoryItemIds(scene, plan.npcId),
      observableItemIds,
    });
    this.schedulePendingContinuationRecovery(scene, plan.npcId, stateKey, barrierStep);
    this.transitionContinuation(stateKey, 'awaiting_barrier', 'scheduled_step');
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

  private transitionContinuation(
    stateKey: string,
    state: NpcContinuationState,
    reason?: string
  ): void {
    const previous = this.continuationStates.get(stateKey)?.state || 'idle';
    const allowed: Record<NpcContinuationState, NpcContinuationState[]> = {
      idle: ['awaiting_barrier', 'needs_replan', 'completed'],
      awaiting_barrier: ['executing_tail', 'needs_replan', 'interrupted', 'completed'],
      executing_tail: ['awaiting_barrier', 'needs_replan', 'interrupted', 'completed'],
      needs_replan: ['awaiting_barrier', 'interrupted'],
      interrupted: ['awaiting_barrier'],
      completed: ['awaiting_barrier'],
    };
    if (!allowed[previous].includes(state)) {
      console.warn(`[NpcPuppetMaster] invalid continuation transition ${previous} -> ${state}`, {
        stateKey,
        reason,
      });
    }
    this.continuationStates.set(stateKey, {
      state,
      changedAt: Date.now(),
      ...(reason ? { reason } : {}),
    });
    if (state !== 'awaiting_barrier') {
      this.pendingPlanContinuations.delete(stateKey);
      const timeoutId = this.pendingContinuationTimeouts.get(stateKey);
      if (timeoutId) globalThis.clearTimeout(timeoutId);
      this.pendingContinuationTimeouts.delete(stateKey);
    }
    this.traceWake('continuation_state_changed', { stateKey, previous, state, reason });
  }

  private schedulePendingContinuationRecovery(
    scene: Scene,
    npcId: string,
    stateKey: string,
    barrierStep: NpcPlanStep
  ): void {
    const previousTimeout = this.pendingContinuationTimeouts.get(stateKey);
    if (previousTimeout) globalThis.clearTimeout(previousTimeout);
    const currentGeneration = this.haltGenerationId;
    const timeoutId = globalThis.setTimeout(() => {
      this.pendingContinuationTimeouts.delete(stateKey);
      if (this.haltGenerationId !== currentGeneration || this.getNpcScene(npcId) !== scene) return;
      const pending = this.pendingPlanContinuations.get(stateKey);
      if (!pending || pending.barrierStep !== barrierStep) return;

      const result: NpcPlanExecutionOutcome = {
        status: 'failed',
        code: 'continuation_timeout',
        npcId,
        targetId:
          'targetId' in barrierStep && typeof barrierStep.targetId === 'string'
            ? barrierStep.targetId
            : undefined,
        actionType: this.getBarrierActionType(barrierStep),
        message: `Timed out waiting for ${barrierStep.type} completion.`,
        worldChanged: false,
      };
      this.transitionContinuation(stateKey, 'needs_replan', 'barrier_timeout');
      this.traceWake('pending_continuation_timeout', {
        sceneId: scene.id,
        npcId,
        barrierStepType: barrierStep.type,
        timeoutMs: PM_PENDING_CONTINUATION_TIMEOUT_MS,
      });
      this.scheduleNpc(scene, npcId, {
        type: 'plan_interrupted',
        reason: 'ACTION_FAILED',
        result,
        completedSteps: pending.completedSteps,
        remainingSteps: pending.steps,
      });
      this.resumeDeferredContinuation(scene, npcId);
    }, PM_PENDING_CONTINUATION_TIMEOUT_MS);
    this.pendingContinuationTimeouts.set(stateKey, timeoutId);
  }

  private getBarrierActionType(barrierStep: NpcPlanStep): NpcPlanExecutionOutcome['actionType'] {
    return barrierStep.type === 'MOVE_TO' || barrierStep.type === 'WAIT'
      ? undefined
      : barrierStep.type;
  }

  private tryExecutePendingContinuation(
    scene: Scene,
    npcId: string,
    triggers: NpcIndividualTrigger[]
  ): boolean {
    const trigger = [...triggers]
      .reverse()
      .find(
        (candidate) =>
          candidate.type === 'move_completed' ||
          candidate.type === 'action_completed' ||
          candidate.type === 'wait_elapsed'
      );
    if (!trigger) return false;

    let stateKey = this.getNpcStateKey(scene, npcId);
    let pending = this.pendingPlanContinuations.get(stateKey);
    if (
      !pending &&
      trigger.type === 'action_completed' &&
      trigger.result.code === 'exit_traversed'
    ) {
      const sourceContinuation = [...this.pendingPlanContinuations.entries()].find(
        ([, candidate]) =>
          candidate.npcId === npcId && candidate.barrierStep.type === 'TRAVERSE_EXIT'
      );
      if (sourceContinuation) {
        [stateKey, pending] = sourceContinuation;
        this.traceWake('cross_scene_exit_continuation_matched', {
          sourceSceneId: stateKey.slice(0, stateKey.lastIndexOf(':')),
          destinationSceneId: scene.id,
          npcId,
        });
      }
    }
    if (!pending) return false;

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
          this.transitionContinuation(stateKey, 'needs_replan', 'move_without_progress');
          this.traceWake('move_no_progress_loop', {
            sceneId: scene.id,
            npcId,
            targetId,
            repeatCount: terminalResult.repeatCount,
          });
          const currentGeneration = this.haltGenerationId;
          globalThis.setTimeout(() => {
            if (this.haltGenerationId !== currentGeneration || this.getNpcScene(npcId) !== scene)
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

    if (trigger.type === 'action_completed' && barrierResult.code === 'exit_traversed') {
      this.transitionContinuation(stateKey, 'completed', 'scene_transfer');
      const destinationScene = Array.from(this.game.sceneManager.scenes.values()).find(
        (candidate) => candidate.getObjectByName(npcId)
      );
      const memory = pending.memory;
      const completionOutcomes = this.executor.executePlan({
        npcId: pending.npcId,
        steps: [],
        ...(memory !== undefined ? { memory } : {}),
      });
      if (destinationScene) {
        this.addTransientArrivalMemory(destinationScene, pending.npcId);
      }
      const finalResults = [...completedSteps, ...completionOutcomes];
      this.traceWake('plan_completed_after_scene_transfer', {
        sourceSceneId: scene.id,
        destinationSceneId: destinationScene?.id,
        npcId,
        discardedStepTypes: pending.steps.map((step) => step.type),
        steps: finalResults.length,
      });
      ShadowLogger.commit(
        npcId,
        'plan_completed',
        finalResults.some((outcome) => outcome.worldChanged)
      );
      if (pending.trackCompletion && destinationScene) {
        this.scheduleNpc(destinationScene, npcId, {
          type: 'plan_completed',
          results: finalResults,
        });
      }
      return true;
    }

    const interrupt = this.getPlanInterrupt(scene, pending, trigger, barrierResult);
    this.traceWake('plan_interrupt_check', {
      sceneId: scene.id,
      npcId,
      triggerType: trigger.type,
      code: barrierResult.code,
      matched: interrupt?.type,
    });

    if (interrupt) {
      this.transitionContinuation(stateKey, 'interrupted', interrupt.type);
      this.traceWake('pending_continuation_interrupted', {
        sceneId: scene.id,
        npcId,
        reason: interrupt.type,
      });
      this.traceWake('plan_interrupted', {
        sceneId: scene.id,
        npcId,
        reason: interrupt.type,
        itemId: interrupt.type === 'ITEM_FOUND' ? interrupt.itemId : undefined,
        completedSteps: completedSteps.length,
        remainingSteps: pending.steps.length,
      });
      ShadowLogger.discard(npcId);
      const currentGeneration = this.haltGenerationId;
      globalThis.setTimeout(() => {
        if (this.haltGenerationId !== currentGeneration || this.getNpcScene(npcId) !== scene)
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

    this.transitionContinuation(stateKey, 'executing_tail', 'barrier_resolved');
    const barrierFailed = this.isFailedPlanBarrier(trigger, barrierResult);
    if (barrierFailed && pending.memory !== undefined) {
      this.traceWake('pending_plan_memory_discarded_after_failure', {
        sceneId: scene.id,
        npcId,
        code: barrierResult.code,
      });
    }
    const continuationPlan: NpcPlan = {
      npcId: pending.npcId,
      steps: pending.steps,
      ...(!barrierFailed && pending.memory !== undefined ? { memory: pending.memory } : {}),
      interruptOn: pending.interruptOn,
    };
    const observableItemIds = this.getNpcObservableItemIds(scene, pending.npcId);
    const outcomes = this.executor.executePlan(continuationPlan);
    this.storePendingContinuationAfterScheduledOutcome(
      scene,
      continuationPlan,
      outcomes,
      completedSteps,
      observableItemIds
    );
    const hasScheduled = outcomes.some((outcome) => outcome.status === 'scheduled');
    if (hasScheduled) return true;
    this.transitionContinuation(stateKey, 'completed', 'tail_finished');
    const finalResults = [...completedSteps, ...outcomes];
    if (!pending.trackCompletion) return false;
    this.traceWake('plan_completed', {
      sceneId: scene.id,
      npcId,
      steps: finalResults.length,
      worldChanged: finalResults.some((outcome) => outcome.worldChanged),
    });
    ShadowLogger.commit(
      npcId,
      'plan_completed',
      finalResults.some((outcome) => outcome.worldChanged)
    );
    const currentGeneration = this.haltGenerationId;
    globalThis.setTimeout(() => {
      if (this.haltGenerationId !== currentGeneration || this.getNpcScene(npcId) !== scene) return;
      this.scheduleNpc(scene, npcId, {
        type: 'plan_completed',
        results: finalResults,
      });
    }, 0);
    return true;
  }

  private getSceneArrivalMemory(scene: Scene): string {
    const title = this.game.textAssets.getResolvedSceneField(scene, 'title')?.trim();
    const location = title || scene.id;
    return `Arrived in ${location}.`;
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
      plan.steps.filter((step) => this.isPhysicalPlanStep(step)).length > 1 ||
      // A terminal exit changes the NPC's scene.  Its destination needs a
      // fresh PM turn even when the exit is the only physical step.
      plan.steps.some((step) => step.type === 'TRAVERSE_EXIT')
    );
  }

  private getPlanInterrupt(
    scene: Scene,
    pending: PendingPlanContinuation,
    trigger: NpcIndividualTrigger,
    result: NpcPlanExecutionOutcome | ActorMoveResult
  ): NpcPlanInterruptCondition | null {
    // A MOVE_TO is a hard runtime barrier for everything after it. Continuing
    // with a tail such as TRAVERSE_EXIT after route_blocked can only turn one
    // actionable navigation failure into a misleading exit_not_reachable.
    // This must hold even when a model omitted ACTION_FAILED from interruptOn.
    if (pending.barrierStep.type === 'MOVE_TO' && this.isFailedPlanBarrier(trigger, result)) {
      return { type: 'ACTION_FAILED' };
    }
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
        const itemId = this.getFoundItemId(scene, pending, condition.itemId, result);
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
    pending: PendingPlanContinuation,
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

    const previousItemIds = new Set(pending.observableItemIds || pending.inventoryItemIds || []);
    const newlyObservableItemIds = this.getNpcObservableItemIds(scene, pending.npcId).filter(
      (candidate) => !previousItemIds.has(candidate)
    );
    return itemId
      ? newlyObservableItemIds.find((candidate) => candidate === itemId) || null
      : newlyObservableItemIds[0] || null;
  }

  private getNpcInventoryItemIds(scene: Scene, npcId: string): string[] {
    return (
      this.getNpcObservableContext(scene, npcId)?.inventory?.items?.map((item) => item.id) || []
    );
  }

  private getNpcObservableItemIds(scene: Scene, npcId: string): string[] {
    const npc = this.getNpcObservableContext(scene, npcId);
    if (!npc) return [];
    const reachableItemIds = (npc.entities || [])
      .filter((entity) => entity.interaction === 'held' || entity.interaction === 'reachable')
      .filter((entity) => {
        const object = scene.getObjectByName(entity.id);
        return object?.components?.some((component: any) => component?.type === 'Item');
      })
      .map((entity) => entity.id);
    return Array.from(
      new Set([
        ...(npc.inventory?.items?.map((item) => item.id) || []),
        ...(npc.visibleItemIds || []),
        ...reachableItemIds,
      ])
    );
  }

  private getNpcObservableContext(scene: Scene, npcId: string): NpcActorContext | undefined {
    const npc = scene.getObjectByName(npcId);
    if (!(npc instanceof Actor)) return undefined;
    return this.worldModelBuilder
      .build(scene, { npcIds: [npcId] })
      .npcs.find((candidate) => candidate.id === npcId);
  }

  private isPhysicalPlanStep(step: NpcPlanStep): boolean {
    return (
      step.type === 'MOVE_TO' ||
      step.type === 'LOOK' ||
      step.type === 'EXAMINE' ||
      step.type === 'OPEN' ||
      step.type === 'CLOSE' ||
      step.type === 'TAKE' ||
      step.type === 'GIVE' ||
      step.type === 'PUT' ||
      step.type === 'COMMAND'
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
          if (step.type === 'MEMORY_SET' || step.type === 'MEMORY_ADD') {
            return !this.hasUnsupportedDiscoveryClaim(step.memory);
          }
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
      step.type === 'GIVE' ||
      step.type === 'PUT' ||
      step.type === 'COMMAND' ||
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
    if (hasScheduledStep) return;

    for (const plan of plans) {
      const hasExplicitStateUpdate = plan.steps.some(
        (step) =>
          step.type === 'MEMORY_SET' ||
          step.type === 'OBJECTIVES_SET' ||
          step.type === 'MEMORY_ADD' ||
          step.type === 'MEMORY_REMOVE' ||
          step.type === 'OBJECTIVE_ADD' ||
          step.type === 'OBJECTIVE_UPDATE' ||
          step.type === 'OBJECTIVE_MARK_COMPLETED' ||
          step.type === 'OBJECTIVE_REMOVE'
      );
      const hasPlanMemory = typeof plan.memory === 'string';
      const isStateOnlyPlan = !this.hasConcretePlanAction(plan);
      if (!isStateOnlyPlan) continue;

      const scene = this.getNpcScene(plan.npcId);
      if (!scene) continue;

      const isSayOnlyPlan =
        plan.steps.length > 0 && plan.steps.every((step) => step.type === 'SAY');
      const shouldContinueSayOnlyPlan =
        isSayOnlyPlan && this.hasActiveNpcObjectives(scene, plan.npcId);
      if (!hasExplicitStateUpdate && !hasPlanMemory && !shouldContinueSayOnlyPlan) continue;

      if (plan.steps.some((step) => step.type === 'OBJECTIVE_ADD')) {
        this.traceWake('objective_add_without_concrete_action', {
          sceneId: scene.id,
          npcId: plan.npcId,
          stepTypes: plan.steps.map((step) => step.type),
        });
      }

      const stateKey = this.getNpcStateKey(scene, plan.npcId);
      const count = this.stateOnlyContinuationCounts.get(stateKey) || 0;
      if (count >= PM_STATE_ONLY_CONTINUATION_LIMIT) {
        this.traceWake('state_only_plan_continuation_suppressed', {
          sceneId: scene?.id,
          npcId: plan.npcId,
          count,
          limit: PM_STATE_ONLY_CONTINUATION_LIMIT,
          triggerType: trigger?.type,
        });
        continue;
      }
      this.stateOnlyContinuationCounts.set(stateKey, count + 1);
      const delayMs = shouldContinueSayOnlyPlan ? PM_SAY_ONLY_CONTINUATION_DELAY_MS : 0;

      if (shouldContinueSayOnlyPlan) {
        const actor = scene.getObjectByName(plan.npcId);
        this.traceWake('say_only_plan_continuation_scheduled', {
          sceneId: scene.id,
          npcId: plan.npcId,
          delayMs,
          objectives:
            ComponentSystem.getNpcComponent(actor instanceof Actor ? actor : null)?.objectives
              ?.length || 0,
        });
      }

      const currentGeneration = this.haltGenerationId;
      globalThis.setTimeout(() => {
        if (this.haltGenerationId !== currentGeneration || this.getNpcScene(plan.npcId) !== scene)
          return;
        this.scheduleNpc(scene, plan.npcId, {
          type: 'plan_continued',
          reason: 'previous_state_only_plan_completed_without_scheduling_action',
        });
      }, delayMs);
    }
  }

  private hasActiveNpcObjectives(scene: Scene, npcId: string): boolean {
    const actor = scene.getObjectByName(npcId);
    return (
      actor instanceof Actor &&
      (ComponentSystem.getNpcComponent(actor)?.objectives?.length || 0) > 0
    );
  }

  /**
   * A completion marker is deliberately a one-turn acknowledgement. The
   * world model is built before provider invocation, so removing flags here
   * cannot consume objectives marked by the response currently being run.
   */
  private pruneObjectivesSeenAsCompleted(scene: Scene, worldModel: NpcWorldModel): void {
    const hasCompleted = (objectives: NpcObjective[]): boolean =>
      objectives.some(
        (objective) => objective.completed === true || hasCompleted(objective.subtasks)
      );
    const prune = (objectives: NpcObjective[]): NpcObjective[] =>
      objectives
        .filter((objective) => objective.completed !== true)
        .map((objective) => ({ ...objective, subtasks: prune(objective.subtasks) }));

    for (const npc of worldModel.npcs) {
      if (!hasCompleted(npc.objectives || [])) continue;
      const npcScene = scene.entities.some((entity) => entity.name === npc.id)
        ? scene
        : this.getNpcScene(npc.id);
      const actor = npcScene?.entities.find((entity) => entity.name === npc.id);
      if (!actor) continue;
      // ComponentSystem returns a normalized snapshot; update the stored
      // component itself so this lifecycle state survives the next build.
      const component = actor.components.find((candidate: any) => candidate?.type === 'NPC') as
        | {
            objectives?: NpcObjective[];
            objectivesInitializedFromTA?: boolean;
            objectivesTARevision?: string;
          }
        | undefined;
      if (!component) continue;
      component.objectives = prune(normalizeNpcObjectives(component.objectives));
      component.objectivesInitializedFromTA = true;
      const textAssets = this.game.textAssets as any;
      component.objectivesTARevision =
        typeof textAssets.getResolvedNpcObjectivesRevision === 'function'
          ? textAssets.getResolvedNpcObjectivesRevision(actor)
          : typeof textAssets.getResolvedObjectListRevision === 'function'
            ? textAssets.getResolvedObjectListRevision(actor, 'objectives')
            : JSON.stringify([]);
    }
  }

  private addTransientArrivalMemory(scene: Scene, npcId: string): void {
    const actor = scene.entities.find((entity) => entity.name === npcId);
    const component = actor?.components.find((candidate: any) => candidate?.type === 'NPC') as
      | { transientMemory?: string[] | string }
      | undefined;
    if (!component) return;
    const arrival = this.getSceneArrivalMemory(scene);
    const transientMemory = Array.isArray(component.transientMemory)
      ? component.transientMemory
      : typeof component.transientMemory === 'string'
        ? [component.transientMemory]
        : [];
    if (!transientMemory.some((entry) => entry.trim() === arrival)) {
      component.transientMemory = [...transientMemory, arrival];
    }
  }

  private pruneTransientMemorySeenThisTurn(scene: Scene, worldModel: NpcWorldModel): void {
    for (const npc of worldModel.npcs) {
      if (!npc.transientMemory?.length) continue;
      const npcScene = scene.entities.some((entity) => entity.name === npc.id)
        ? scene
        : this.getNpcScene(npc.id);
      const actor = npcScene?.entities.find((entity) => entity.name === npc.id);
      const component = actor?.components.find((candidate: any) => candidate?.type === 'NPC') as
        | { transientMemory?: string[] | string }
        | undefined;
      if (!component) continue;
      component.transientMemory = [];
    }
  }

  private hasConcretePlanAction(plan: NpcPlan): boolean {
    return plan.steps.some(
      (step) =>
        ![
          'SAY',
          'MEMORY_SET',
          'OBJECTIVES_SET',
          'MEMORY_ADD',
          'MEMORY_REMOVE',
          'OBJECTIVE_ADD',
          'OBJECTIVE_UPDATE',
          'OBJECTIVE_MARK_COMPLETED',
          'OBJECTIVE_REMOVE',
        ].includes(step.type)
    );
  }

  private scheduleNpcWait(npcId: string, ms: number): void {
    const existing = this.waitTimeouts.get(npcId);
    if (existing) {
      globalThis.clearTimeout(existing);
    }
    const currentGeneration = this.haltGenerationId;
    const timeoutId = globalThis.setTimeout(() => {
      this.waitTimeouts.delete(npcId);
      const scene = this.getNpcScene(npcId);
      if (scene && this.haltGenerationId === currentGeneration) {
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
      const worldModel = this.worldModelBuilder.build(scene, { npcIds: [npcId] });
      if (!worldModel.npcs.length) return;

      this.traceWake('strategy_request_start', {
        sceneId: scene.id,
        npcId,
        reason,
        provider: this.provider.getProviderName(),
        model: this.provider.getModelName(),
      });

      const system = this.buildStrategySystemPrompt(scene, worldModel);
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
      const updateOutcomes = normalized.updates?.length
        ? this.executor.executePlan({ npcId, steps: normalized.updates })
        : [];
      const memoryUpdated = updateOutcomes.some((outcome) =>
        outcome.code.startsWith('npc_memory_')
      );
      const objectivesUpdated = updateOutcomes.some((outcome) =>
        outcome.code.startsWith('npc_objective')
      )
        ? normalizeNpcObjectives(
            ComponentSystem.getNpcComponent(actor instanceof Actor ? actor : null)?.objectives
          )
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

  private buildStrategySystemPrompt(scene: Scene, worldModel: NpcWorldModel): LlmProviderContent {
    const staticContext = {
      projectionVersion: 'pm-entity-v1',
      scene: worldModel.scene,
      entities: this.worldModelBuilder.buildStaticEntityProjection(scene),
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
          `Return strictly valid JSON: {"kind":"npc_strategy_response","npcId":"${npcId}","updates":[...],"waitMs":30000}`,
        ].join('\n'),
      },
    ];
  }

  private normalizeStrategyResponse(value: unknown, npcId: string): NpcStrategyResponse | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Partial<NpcStrategyResponse>;
    if (record.kind !== 'npc_strategy_response') return null;
    if (typeof record.npcId !== 'string' || record.npcId.trim() !== npcId) return null;
    const updates = Array.isArray((record as any).updates)
      ? (record as any).updates
          .map((step: unknown) => this.normalizeStep(step))
          .filter((step: NpcPlanStep | null): step is NpcPlanStep => !!step)
          .filter((step: NpcPlanStep) =>
            [
              'MEMORY_ADD',
              'MEMORY_REMOVE',
              'OBJECTIVE_ADD',
              'OBJECTIVE_UPDATE',
              'OBJECTIVE_MARK_COMPLETED',
              'OBJECTIVE_REMOVE',
            ].includes(step.type)
          )
      : (() => {
          // Older saves/queued providers may still return the previous strategy shape.
          const legacy: NpcPlanStep[] = [];
          if (typeof (record as any).memory === 'string' && (record as any).memory.trim()) {
            legacy.push({ type: 'MEMORY_SET', memory: (record as any).memory.trim() });
          }
          if (Array.isArray((record as any).objectives)) {
            const objectives = (record as any).objectives
              .filter((objective: unknown): objective is string => typeof objective === 'string')
              .map((objective: string) => objective.trim())
              .filter(Boolean);
            if (objectives.length) legacy.push({ type: 'OBJECTIVES_SET', objectives });
          }
          return legacy.length ? legacy : undefined;
        })();
    const waitMs =
      typeof record.waitMs === 'number' && Number.isFinite(record.waitMs)
        ? record.waitMs
        : undefined;
    return {
      kind: 'npc_strategy_response',
      npcId,
      ...(updates?.length ? { updates } : {}),
      ...(waitMs !== undefined ? { waitMs } : {}),
    };
  }

  private clampStrategyWaitMs(ms?: number): number {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return PM_STRATEGY_DEFAULT_WAIT_MS;
    return Math.max(PM_STRATEGY_MIN_WAIT_MS, Math.min(PM_STRATEGY_MAX_WAIT_MS, ms));
  }

  private async buildSystemPrompt(
    scene: Scene,
    worldModel: NpcWorldModel
  ): Promise<LlmProviderContent> {
    const systemPrompt = await this.loadSystemPrompt();
    const staticContext = {
      projectionVersion: 'pm-entity-v1',
      scene: worldModel.scene,
      entities: this.worldModelBuilder.buildStaticEntityProjection(scene),
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
          '2. "steps.type" MUST be one of: SAY, MOVE_TO, TRAVERSE_EXIT, LOOK, EXAMINE, OPEN, CLOSE, TAKE, GIVE, PUT, COMMAND, WAIT, THINK_STRATEGY, MEMORY_ADD, MEMORY_REMOVE, OBJECTIVE_ADD, OBJECTIVE_UPDATE, OBJECTIVE_MARK_COMPLETED, OBJECTIVE_REMOVE.',
          '3. To run an entity command like "turn_tv_on", use: {"type":"COMMAND","commandId":"turn_tv_on","arguments":{}}.',
          '4. currentSceneId is the authoritative current location for each NPC. Memory, actionHistory, and prior TRAVERSE_EXIT results are historical and must not override currentSceneId.',
          '5. CURRENT OBJECTIVES persist across scenes. Keep the parent goal and, after a confirmed blocker, use OBJECTIVE_ADD before dependent actions to add the concrete next prerequisite and its dependency chain. Use OBJECTIVE_MARK_COMPLETED only to record a task that runtime already confirmed; it never performs that task. To confirm a [PENDING CONFIRMATION] objective, repeat its marker with evidence copied exactly from a successful current trigger, for example {"type":"OBJECTIVE_MARK_COMPLETED","objectiveId":"...","evidence":{"actionType":"COMMAND","commandId":"turn_tv_on"}}. A repeated marker without matching current runtime evidence is rejected and the objective remains active. A [JUST COMPLETED] objective and [JUST ARRIVED] memory entry are informational runtime context and will be removed after this turn. Use OBJECTIVE_REMOVE for obsolete objectives. MEMORY_ADD/MEMORY_REMOVE maintain factual memory.',
          '6. Static catalog membership is not current presence. Target only this NPC dynamic entities or inventory; plan_rejected_missing_items means the item is not currently available, not merely route-blocked.',
          '7. Any newly accepted, promised, volunteered, or self-chosen future work MUST be represented by OBJECTIVE_ADD in the same plan before dependent action or speech, unless an active objective already covers it. This includes work undertaken to help another NPC.',
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
      currentTimestamp: Date.now(),
      // Description and lore are static and already present in the cacheable catalog.
      scene: this.compactPromptRecord({
        id: worldModel.scene.id,
        title: worldModel.scene.title,
      }),
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
          currentSceneId: worldModel.scene.id,
          currentSceneTitle: worldModel.scene.title,
          objectives: this.getPromptObjectives(npc.objectives),
          memory: this.getPromptMemory(npc.memory, npc.transientMemory),
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
                    lastSeenLocation: entity.lastSeenLocation,
                    title:
                      entity.lastSeenSceneId !== worldModel.scene.id ? entity.title : undefined,
                  })
                )
            : undefined,
          actionHistory: this.getPromptActionHistory(npc.id, npcTrigger),
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

  private getPromptObjectives(objectives: NpcObjective[] | undefined): NpcObjective[] {
    return (objectives || []).map((objective) => ({
      id: objective.id,
      text: objective.completed
        ? `${objective.text} [JUST COMPLETED]`
        : objective.pendingConfirmation
          ? `${objective.text} [PENDING CONFIRMATION]`
          : objective.text,
      subtasks: this.getPromptObjectives(objective.subtasks),
    }));
  }

  private validateObjectiveCompletionConfirmations(
    plans: NpcPlan[],
    worldModel: NpcWorldModel,
    trigger?: NpcIndividualTrigger | NpcBatchTrigger
  ): {
    plans: NpcPlan[];
    confirmedObjectiveIdsByNpc: Map<string, Set<string>>;
    rejectedNpcIds: Set<string>;
  } {
    const confirmedObjectiveIdsByNpc = new Map<string, Set<string>>();
    const rejectedNpcIds = new Set<string>();
    const objectivesByNpc = new Map(
      worldModel.npcs.map((npc) => [npc.id, normalizeNpcObjectives(npc.objectives)] as const)
    );

    const validatedPlans = plans
      .map((plan) => {
        const objectives = objectivesByNpc.get(plan.npcId) || [];
        const seenMarkers = new Set<string>();
        const steps = plan.steps.filter((step) => {
          if (step.type !== 'OBJECTIVE_MARK_COMPLETED') return true;
          if (seenMarkers.has(step.objectiveId)) {
            rejectedNpcIds.add(plan.npcId);
            return false;
          }
          seenMarkers.add(step.objectiveId);

          const objective = findNpcObjective(objectives, step.objectiveId);
          // A JUST COMPLETED objective is still shown for one PM turn, so the
          // model can easily repeat its marker. That repetition is a harmless
          // no-op and must not fail the whole plan before its physical tail.
          if (objective?.completed) {
            this.traceWake('objective_completion_already_recorded', {
              sceneId: worldModel.scene.id,
              npcId: plan.npcId,
              objectiveId: step.objectiveId,
            });
            return false;
          }
          // Missing IDs remain in the plan so the executor can produce its
          // normal deterministic failure outcome.
          if (!objective || !objective.pendingConfirmation) return true;
          if (
            !step.evidence ||
            !this.matchesCurrentCompletionEvidence(trigger, plan.npcId, step.evidence)
          ) {
            rejectedNpcIds.add(plan.npcId);
            this.traceWake('objective_completion_unconfirmed', {
              sceneId: worldModel.scene.id,
              npcId: plan.npcId,
              objectiveId: step.objectiveId,
              evidence: step.evidence,
            });
            return false;
          }
          const confirmed = confirmedObjectiveIdsByNpc.get(plan.npcId) || new Set<string>();
          confirmed.add(step.objectiveId);
          confirmedObjectiveIdsByNpc.set(plan.npcId, confirmed);
          return true;
        });
        return steps.length ? { ...plan, steps } : null;
      })
      .filter((plan): plan is NpcPlan => !!plan);

    return { plans: validatedPlans, confirmedObjectiveIdsByNpc, rejectedNpcIds };
  }

  private matchesCurrentCompletionEvidence(
    trigger: NpcIndividualTrigger | NpcBatchTrigger | undefined,
    npcId: string,
    evidence: NpcObjectiveCompletionEvidence
  ): boolean {
    const hasIdentity = !!(
      evidence.code ||
      evidence.targetId ||
      evidence.itemId ||
      evidence.commandId
    );
    if (!hasIdentity) return false;
    const triggers =
      trigger?.type === 'batch' ? trigger.triggersByNpc[npcId] || [] : trigger ? [trigger] : [];
    return triggers.some((candidate) => {
      const result =
        candidate.type === 'action_completed' || candidate.type === 'plan_interrupted'
          ? candidate.result
          : null;
      if (!result || result.status !== 'ok' || result.actionType !== evidence.actionType)
        return false;
      return (
        (!evidence.code || result.code === evidence.code) &&
        (!evidence.targetId || result.targetId === evidence.targetId) &&
        (!evidence.itemId || result.itemId === evidence.itemId) &&
        (!evidence.commandId || result.commandId === evidence.commandId)
      );
    });
  }

  private scheduleObjectiveConfirmationRetries(
    scene: Scene,
    rejectedNpcIds: Set<string>,
    acceptedPlans: NpcPlan[]
  ): void {
    for (const npcId of rejectedNpcIds) {
      const replacement = acceptedPlans.find((plan) => plan.npcId === npcId);
      // A retained plan is handled by the normal continuation policy below.
      // This fallback exists only for a response consisting solely of rejected
      // completion markers, which would otherwise leave an active objective idle.
      if (replacement) continue;
      const stateKey = this.getNpcStateKey(scene, npcId);
      const count = this.stateOnlyContinuationCounts.get(stateKey) || 0;
      if (count >= PM_STATE_ONLY_CONTINUATION_LIMIT) continue;
      this.stateOnlyContinuationCounts.set(stateKey, count + 1);
      const generation = this.haltGenerationId;
      globalThis.setTimeout(() => {
        if (generation !== this.haltGenerationId || this.getNpcScene(npcId) !== scene) return;
        this.scheduleNpc(scene, npcId, {
          type: 'plan_continued',
          reason: 'objective_completion_unconfirmed',
        });
      }, 0);
    }
  }

  private settlePendingObjectiveConfirmations(
    worldModel: NpcWorldModel,
    acceptedPlans: NpcPlan[]
  ): void {
    const markedByNpc = new Map<string, Set<string>>();
    for (const plan of acceptedPlans) {
      const marked = new Set(
        plan.steps
          .filter((step) => step.type === 'OBJECTIVE_MARK_COMPLETED')
          .map((step) => step.objectiveId)
      );
      if (marked.size) markedByNpc.set(plan.npcId, marked);
    }

    for (const npc of worldModel.npcs) {
      const actor = this.getNpcScene(npc.id)?.getObjectByName(npc.id);
      if (!(actor instanceof Actor)) continue;
      const component = actor.components.find((candidate: any) => candidate?.type === 'NPC') as
        | {
            objectives?: NpcObjective[] | string[];
            objectivesInitializedFromTA?: boolean;
            objectivesTARevision?: string;
          }
        | undefined;
      if (!component?.objectives) continue;
      const marked = markedByNpc.get(npc.id) || new Set<string>();
      let changed = false;
      const clearUnconfirmed = (objectives: NpcObjective[]): void => {
        for (const objective of objectives) {
          if (objective.pendingConfirmation && !marked.has(objective.id)) {
            delete objective.pendingConfirmation;
            changed = true;
          }
          clearUnconfirmed(objective.subtasks);
        }
      };
      const objectives = normalizeNpcObjectives(component.objectives);
      clearUnconfirmed(objectives);
      if (changed) {
        component.objectives = objectives;
        component.objectivesInitializedFromTA = true;
        const textAssets = this.game.textAssets as any;
        component.objectivesTARevision =
          typeof textAssets.getResolvedNpcObjectivesRevision === 'function'
            ? textAssets.getResolvedNpcObjectivesRevision(actor)
            : typeof textAssets.getResolvedObjectListRevision === 'function'
              ? textAssets.getResolvedObjectListRevision(actor, 'objectives')
              : JSON.stringify([]);
      }
    }
  }

  private getPromptMemory(
    memory: string[] | undefined,
    transientMemory: string[] | undefined
  ): string[] | undefined {
    const durable = memory || [];
    const transient = (transientMemory || []).map((entry) => `${entry} [JUST ARRIVED]`);
    const combined = [...durable, ...transient];
    return combined.length ? combined : undefined;
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
        itemId: payload.itemId,
        targetId: payload.targetId,
        reason: payload.reason,
        subjectId: payload.subjectId,
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
    npcId: string,
    trigger?: NpcIndividualTrigger
  ): Array<Record<string, unknown>> | undefined {
    const history = this.getNpcActionHistory(npcId);
    if (!history || trigger?.type !== 'action_completed') return history;
    const result = trigger.result;
    const target = result.targetId || result.itemId || result.commandId;
    if (!target || !result.actionType) return history;
    return history.filter(
      (entry) =>
        !(
          entry.actionType === result.actionType &&
          (entry.targetId || entry.itemId || entry.commandId) === target
        )
    );
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
      title: entity.title,
      lastSeenSceneId: entity.lastSeenSceneId,
      ...(entity.visibility !== 'visible' ? { visibility: entity.visibility } : {}),
      ...(entity.location ? { location: entity.location } : {}),
      ...(entity.interaction !== 'reachable' ? { interaction: entity.interaction } : {}),
      ...(entity.approach !== 'already_reachable' ? { approach: entity.approach } : {}),
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
              ...(command.executable !== undefined ? { executable: command.executable } : {}),
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
              ...(command.preconditions ? { preconditions: command.preconditions } : {}),
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
    // PM batches belong to the NPC's scene, not to the player's current scene.
    // Let an NPC keep acting after it has crossed an Exit and is now offscreen.
    const providerCandidateNpcIds = [...batch.npcIds].filter((npcId) => {
      if (continuationNpcIds.includes(npcId)) return false;
      const npcScene = this.getNpcScene(npcId);
      if (npcScene !== scene) {
        this.traceWake('batch_npc_skipped_scene_changed', {
          sceneId,
          npcId,
          destinationSceneId: npcScene?.id ?? null,
        });
        return false;
      }
      const stateKey = this.getNpcStateKey(scene, npcId);
      if (!this.pendingPlanContinuations.has(stateKey)) return true;
      const deferred = this.deferredContinuationTriggers.get(stateKey) || [];
      deferred.push(...(batch.triggersByNpc.get(npcId) || []));
      this.deferredContinuationTriggers.set(stateKey, deferred);
      this.traceWake('batch_deferred_pending_continuation', {
        sceneId,
        npcId,
        triggerTypes: (batch.triggersByNpc.get(npcId) || []).map((trigger) => trigger.type),
        deferredTriggerCount: deferred.length,
      });
      return false;
    });
    if (continuationNpcIds.length) {
      this.traceWake('pending_plan_continued', {
        sceneId,
        npcIds: continuationNpcIds,
        rateLimitBypassed: true,
      });
      for (const npcId of continuationNpcIds) {
        if (!this.pendingPlanContinuations.has(this.getNpcStateKey(scene, npcId))) {
          this.resumeDeferredContinuation(scene, npcId);
        }
      }
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
      this.deferBatch(batch, providerNpcIds);
      batch.completionResolvers.forEach((resolve) => resolve());
      return;
    }

    this.processingScenes.add(processingKey);
    try {
      const worldModel = this.worldModelBuilder.build(scene, { npcIds: providerNpcIds });
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
        scene,
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
        message: `Cyclic no-progress behavior detected: ${[...new Set(signatures)].join(', ')} have already been tried and did not help. Do not continue this action pattern. Choose a materially different strategy, ask for help, WAIT/rest voluntarily, or revise the relevant objective branch if the goal is not currently achievable.`,
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
    if (result.status === 'scheduled') return;
    const records = this.actionHistories.get(npcId) || [];
    records.push({
      sceneId: scene.id,
      timestamp: Date.now(),
      ...(result.actionType ? { actionType: result.actionType } : {}),
      ...(result.code ? { code: result.code } : {}),
      status: result.status,
      ...(result.targetId ? { targetId: result.targetId } : {}),
      ...(result.itemId ? { itemId: result.itemId } : {}),
      ...(result.commandId ? { commandId: result.commandId } : {}),
      worldChanged: result.worldChanged === true,
      summary: this.summarizeActionHistoryResult(result),
    });
    this.actionHistories.set(npcId, records.slice(-PM_ACTION_HISTORY_LIMIT));
  }

  private summarizeActionHistoryResult(result: NpcPlanExecutionOutcome): string {
    const actionType = result.actionType || 'ACTION';
    const target = result.targetId || result.commandId || result.itemId || '';
    const targetLabel = target ? ` ${target}` : '';

    if (
      result.status === 'ok' &&
      (actionType === 'LOOK' || actionType === 'EXAMINE') &&
      !result.worldChanged &&
      (!result.discoveredEntityIds || result.discoveredEntityIds.length === 0)
    ) {
      return `${actionType}${targetLabel}${result.relation ? ` ${result.relation}` : ''}: inspected, nothing new found`;
    }

    if (result.worldChanged) return `${actionType}${targetLabel}: changed world state`;
    if (result.status === 'failed' || result.status === 'unsupported') {
      return `${actionType}${targetLabel}: failed (${result.code || 'unknown_error'})`;
    }
    return `${actionType}${targetLabel}: ${result.code || result.status}`;
  }

  private getNpcActionHistory(npcId: string): Array<Record<string, unknown>> | undefined {
    const records = this.actionHistories.get(npcId);
    if (!records?.length) return undefined;
    const now = Date.now();
    return records.map((record) =>
      this.compactPromptRecord({
        sceneId: record.sceneId,
        ageMs: Math.max(0, now - record.timestamp),
        actionType: record.actionType,
        code: record.code,
        status: record.status,
        targetId: record.targetId,
        itemId: record.itemId,
        commandId: record.commandId,
        worldChanged: record.worldChanged,
        summary: record.summary,
      })
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
    globalThis.setTimeout(() => {
      for (const npcId of npcIds) {
        if (this.haltGenerationId !== currentGeneration || this.getNpcScene(npcId) !== batch.scene)
          continue;
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

  private getNpcScene(npcId: string): Scene | null {
    const current = this.game.sceneManager.currentScene;
    if (current?.getObjectByName(npcId) instanceof Actor) return current;
    return (
      Array.from(this.game.sceneManager.scenes.values()).find(
        (scene) => scene.getObjectByName(npcId) instanceof Actor
      ) || null
    );
  }

  private resumeDeferredContinuation(scene: Scene, npcId: string): void {
    const stateKey = this.getNpcStateKey(scene, npcId);
    const triggers = this.deferredContinuationTriggers.get(stateKey);
    if (!triggers?.length) return;
    this.deferredContinuationTriggers.delete(stateKey);
    this.traceWake('pending_continuation_resumed', {
      sceneId: scene.id,
      npcId,
      triggerTypes: triggers.map((trigger) => trigger.type),
    });
    for (const trigger of triggers) {
      void this.enqueueNpc(scene, npcId, trigger);
    }
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
          if (dynamicContext.scene) {
            promptLines.push(`Scene: ${JSON.stringify(dynamicContext.scene)}`);
          }
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
              const memStr = npc.memory ? JSON.stringify(npc.memory) : 'none';
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
                const nestedItems = Array.isArray(npc.inventory.items)
                  ? npc.inventory.items.filter((item: any) => item && item.containerId !== npc.id)
                  : [];
                if (nestedItems.length > 0) {
                  const nestedSummary = nestedItems.map((item: any) => {
                    const groups =
                      Array.isArray(item.groupIds) && item.groupIds.length
                        ? ` ${item.groupIds.join('/')}`
                        : '';
                    const states =
                      Array.isArray(item.states) && item.states.length
                        ? ` ${item.states.map((state: any) => `${state.id}=${state.value}`).join(',')}`
                        : '';
                    return `${item.id} in ${item.containerId}${groups}${states}`;
                  });
                  invStr += ` | Nested: [${nestedSummary.join('; ')}]`;
                }
              }
              promptLines.push(
                `  * ${npc.id} @ ${npc.currentSceneId || dynamicContext.scene?.id || 'unknown'} -> Objectives: ${objStr} | Memory: ${memStr}${invStr}`
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
    if (record.type === 'MEMORY_ADD' || record.type === 'MEMORY_REMOVE') {
      const memory = typeof record.memory === 'string' ? record.memory.trim() : '';
      return memory ? { type: record.type, memory } : null;
    }
    if (record.type === 'OBJECTIVE_ADD') {
      if (
        !record.objective ||
        typeof record.objective !== 'object' ||
        Array.isArray(record.objective)
      ) {
        return null;
      }
      const objective = normalizeNpcObjectiveDraft(record.objective);
      const parentId =
        record.parentId === null
          ? null
          : typeof record.parentId === 'string' && record.parentId.trim()
            ? record.parentId.trim()
            : undefined;
      return objective
        ? { type: 'OBJECTIVE_ADD', objective, ...(parentId !== undefined ? { parentId } : {}) }
        : null;
    }
    if (record.type === 'OBJECTIVE_UPDATE') {
      const objectiveId = typeof record.objectiveId === 'string' ? record.objectiveId.trim() : '';
      const text = typeof record.text === 'string' ? record.text.trim() : '';
      return objectiveId && text ? { type: 'OBJECTIVE_UPDATE', objectiveId, text } : null;
    }
    if (record.type === 'OBJECTIVE_REMOVE') {
      const objectiveId = typeof record.objectiveId === 'string' ? record.objectiveId.trim() : '';
      return objectiveId ? { type: 'OBJECTIVE_REMOVE', objectiveId } : null;
    }
    if (record.type === 'OBJECTIVE_MARK_COMPLETED') {
      const objectiveId = typeof record.objectiveId === 'string' ? record.objectiveId.trim() : '';
      const rawEvidence = record.evidence;
      const evidence =
        rawEvidence && typeof rawEvidence === 'object' && !Array.isArray(rawEvidence)
          ? (() => {
              const value = rawEvidence as Record<string, unknown>;
              const actionType =
                typeof value.actionType === 'string' ? value.actionType.trim() : '';
              if (
                !['TAKE', 'GIVE', 'PUT', 'COMMAND', 'OPEN', 'CLOSE', 'LOOK', 'EXAMINE'].includes(
                  actionType
                )
              ) {
                return undefined;
              }
              const text = (key: string) =>
                typeof value[key] === 'string' && value[key].trim() ? value[key].trim() : undefined;
              return {
                actionType: actionType as NpcObjectiveCompletionEvidence['actionType'],
                ...(text('code') ? { code: text('code') } : {}),
                ...(text('targetId') ? { targetId: text('targetId') } : {}),
                ...(text('itemId') ? { itemId: text('itemId') } : {}),
                ...(text('commandId') ? { commandId: text('commandId') } : {}),
              };
            })()
          : undefined;
      return objectiveId
        ? { type: 'OBJECTIVE_MARK_COMPLETED', objectiveId, ...(evidence ? { evidence } : {}) }
        : null;
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
    if (record.type === 'GIVE') {
      const itemId = typeof record.itemId === 'string' ? record.itemId.trim() : '';
      const targetId = typeof record.targetId === 'string' ? record.targetId.trim() : '';
      return itemId && targetId ? { type: 'GIVE', itemId, targetId } : null;
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
