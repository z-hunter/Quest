import { Actor } from '../entities/Actor';
import { Entity } from '../entities/Entity';
import type { ActorMoveResult } from '../entities/Actor';
import type { IGame } from '../core/IGame';
import { ComponentSystem } from '../systems/ComponentSystem';
import { traceNavigation } from '../systems/navigation/navigationDebug';
import type { NpcPlan, NpcPlanExecutionOutcome, NpcPlanStep } from './npcTypes';
import {
  findNpcObjective,
  materializeNpcObjectives,
  normalizeNpcMemory,
  normalizeNpcObjectives,
  removeNpcObjective,
} from './npcState';

export type NpcWaitScheduler = (npcId: string, ms: number) => void;
export type NpcMoveCompletionScheduler = (npcId: string, result: ActorMoveResult) => void;
export type NpcActionCompletionScheduler = (
  npcId: string,
  result: NpcPlanExecutionOutcome,
  fromExecutor?: boolean
) => void;
export type NpcStrategyScheduler = (npcId: string, reason?: string) => void;

export class ActorPlanExecutor {
  private readonly game: IGame;
  private readonly waitScheduler?: NpcWaitScheduler;
  private readonly moveCompletionScheduler?: NpcMoveCompletionScheduler;
  private readonly actionCompletionScheduler?: NpcActionCompletionScheduler;
  private readonly strategyScheduler?: NpcStrategyScheduler;
  private moveWatchTokens = new Map<string, number>();
  private navigationTokens = new Map<string, number>();
  private pendingTimeouts = new Map<string, Set<any>>();
  private moveStartedAt = new Map<string, number>();
  private targetMoveStates = new Map<
    string,
    { targetId: string; localTeleportRevision: number; localTeleportReplans: number }
  >();

  clearState(npcId: string): void {
    const current = this.moveWatchTokens.get(npcId) || 0;
    this.moveWatchTokens.set(npcId, current + 1);
    this.navigationTokens.set(npcId, (this.navigationTokens.get(npcId) || 0) + 1);
    this.moveStartedAt.delete(npcId);
    this.targetMoveStates.delete(npcId);
    const actor = this.findActor(npcId);
    if (actor instanceof Actor) this.game.actorNavigation.cancelNpcApproach(actor);
    const timeouts = this.pendingTimeouts.get(npcId);
    if (timeouts) {
      for (const timeoutId of timeouts) {
        globalThis.clearTimeout(timeoutId);
      }
      this.pendingTimeouts.delete(npcId);
    }
  }

  clearAllPending(): void {
    this.moveWatchTokens.clear();
    this.navigationTokens.clear();
    this.moveStartedAt.clear();
    this.targetMoveStates.clear();
    for (const timeouts of this.pendingTimeouts.values()) {
      for (const timeoutId of timeouts) {
        globalThis.clearTimeout(timeoutId);
      }
    }
    this.pendingTimeouts.clear();
  }

  constructor(
    game: IGame,
    waitScheduler?: NpcWaitScheduler,
    moveCompletionScheduler?: NpcMoveCompletionScheduler,
    actionCompletionScheduler?: NpcActionCompletionScheduler,
    strategyScheduler?: NpcStrategyScheduler
  ) {
    this.game = game;
    this.waitScheduler = waitScheduler;
    this.moveCompletionScheduler = moveCompletionScheduler;
    this.actionCompletionScheduler = actionCompletionScheduler;
    this.strategyScheduler = strategyScheduler;
  }

  executePlan(plan: NpcPlan): NpcPlanExecutionOutcome[] {
    const actor = this.findActor(plan.npcId);
    if (!(actor instanceof Actor) || !ComponentSystem.isNpc(actor)) {
      return [
        {
          status: 'failed',
          code: 'npc_not_found',
          npcId: plan.npcId,
        },
      ];
    }

    const outcomes: NpcPlanExecutionOutcome[] = [];
    let completedSynchronously = true;
    for (const step of plan.steps) {
      const outcome = this.executeStep(actor, step);
      outcomes.push(outcome);
      if (outcome.status !== 'ok') {
        completedSynchronously = false;
        break;
      }
    }

    if (completedSynchronously && typeof plan.memory === 'string') {
      this.setLegacyNpcMemory(actor, plan.memory);
      outcomes.push({
        status: 'ok',
        code: 'npc_memory_updated',
        npcId: plan.npcId,
      });
    }

    return outcomes;
  }

  private executeStep(actor: Actor, step: NpcPlanStep): NpcPlanExecutionOutcome {
    if (step.type === 'SAY') {
      const text = String(step.text || '').trim();
      if (!text) {
        return { status: 'failed', code: 'say_empty', npcId: actor.name };
      }
      const sayAsActor = (this.game as any).sayAsActor;
      if (typeof sayAsActor === 'function') {
        sayAsActor.call(this.game, actor, text, { triggerPuppetMaster: true });
        return { status: 'ok', code: 'npc_said', npcId: actor.name, message: text };
      }
      return { status: 'failed', code: 'say_unavailable', npcId: actor.name };
    }

    if (step.type === 'MEMORY_SET') {
      this.setLegacyNpcMemory(actor, step.memory);
      return { status: 'ok', code: 'npc_memory_updated', npcId: actor.name };
    }

    if (step.type === 'MEMORY_ADD') {
      const memory = this.getNpcMemory(actor);
      if (!memory.includes(step.memory)) memory.push(step.memory);
      this.setNpcMemory(actor, memory);
      return { status: 'ok', code: 'npc_memory_added', npcId: actor.name };
    }

    if (step.type === 'MEMORY_REMOVE') {
      const next = this.getNpcMemory(actor).filter((memory) => memory !== step.memory);
      this.setNpcMemory(actor, next);
      return { status: 'ok', code: 'npc_memory_removed', npcId: actor.name };
    }

    if (step.type === 'OBJECTIVES_SET') {
      this.setLegacyNpcObjectives(actor, step.objectives);
      return { status: 'ok', code: 'npc_objectives_updated', npcId: actor.name };
    }

    if (step.type === 'OBJECTIVE_ADD') {
      const objectives = this.getNpcObjectives(actor);
      const additions = materializeNpcObjectives([step.objective]);
      const parent = step.parentId ? findNpcObjective(objectives, step.parentId) : null;
      if (step.parentId && !parent) {
        return { status: 'failed', code: 'objective_parent_not_found', npcId: actor.name };
      }
      (parent ? parent.subtasks : objectives).push(...additions);
      this.setNpcObjectives(actor, objectives);
      return { status: 'ok', code: 'npc_objective_added', npcId: actor.name };
    }

    if (step.type === 'OBJECTIVE_UPDATE') {
      const objectives = this.getNpcObjectives(actor);
      const objective = findNpcObjective(objectives, step.objectiveId);
      if (!objective) return { status: 'failed', code: 'objective_not_found', npcId: actor.name };
      objective.text = step.text;
      this.setNpcObjectives(actor, objectives);
      return { status: 'ok', code: 'npc_objective_updated', npcId: actor.name };
    }

    if (step.type === 'OBJECTIVE_REMOVE') {
      const objectives = this.getNpcObjectives(actor);
      if (!removeNpcObjective(objectives, step.objectiveId)) {
        return { status: 'failed', code: 'objective_not_found', npcId: actor.name };
      }
      this.setNpcObjectives(actor, objectives);
      return { status: 'ok', code: 'npc_objective_removed', npcId: actor.name };
    }

    if (step.type === 'OBJECTIVE_MARK_COMPLETED') {
      const objectives = this.getNpcObjectives(actor);
      const objective = findNpcObjective(objectives, step.objectiveId);
      if (!objective) return { status: 'failed', code: 'objective_not_found', npcId: actor.name };
      objective.completed = true;
      this.setNpcObjectives(actor, objectives);
      return { status: 'ok', code: 'npc_objective_marked_completed', npcId: actor.name };
    }

    if (step.type === 'WAIT') {
      if (!this.waitScheduler) {
        return { status: 'failed', code: 'wait_unavailable', npcId: actor.name };
      }
      this.waitScheduler(actor.name, step.ms);
      return {
        status: 'scheduled',
        code: 'npc_wait_scheduled',
        npcId: actor.name,
        message: String(step.ms),
      };
    }

    if (step.type === 'THINK_STRATEGY') {
      if (!this.strategyScheduler) {
        return { status: 'failed', code: 'strategy_unavailable', npcId: actor.name };
      }
      this.strategyScheduler(actor.name, step.reason);
      return {
        status: 'scheduled',
        code: 'npc_strategy_think_scheduled',
        npcId: actor.name,
        message: step.reason,
        actionType: 'THINK_STRATEGY',
      };
    }

    if (step.type === 'MOVE_TO') {
      return this.moveActor(actor, step);
    }

    if (step.type === 'TRAVERSE_EXIT') {
      return this.traverseExit(actor, step.targetId);
    }

    if (step.type === 'LOOK') {
      return this.executeTargetAction(actor, step.targetId, 'LOOK', step.relation);
    }

    if (step.type === 'EXAMINE') {
      return this.executeTargetAction(actor, step.targetId, 'EXAMINE', step.relation);
    }

    if (step.type === 'OPEN') {
      return this.executeTargetAction(actor, step.targetId, 'OPEN');
    }

    if (step.type === 'CLOSE') {
      return this.executeTargetAction(actor, step.targetId, 'CLOSE');
    }

    if (step.type === 'TAKE') {
      return this.takeEntity(actor, step.targetId);
    }

    if (step.type === 'GIVE') {
      return this.giveEntity(actor, step.itemId, step.targetId);
    }

    if (step.type === 'PUT') {
      return this.putEntity(actor, step.itemId, step.targetId, step.relation);
    }

    if (step.type === 'COMMAND') {
      return this.executeCommand(actor, step.commandId, step.arguments);
    }

    return {
      status: 'unsupported',
      code: 'unsupported_in_v1',
      npcId: actor.name,
    };
  }

  private getNpcMemory(actor: Actor): string[] {
    const component = actor.components?.find((candidate: any) => candidate?.type === 'NPC') as
      | { type: 'NPC'; memory?: unknown }
      | undefined;
    return normalizeNpcMemory(component?.memory);
  }

  private setNpcMemory(actor: Actor, memory: string[]): void {
    const component = actor.components?.find((candidate: any) => candidate?.type === 'NPC') as
      | {
          type: 'NPC';
          memory?: string[];
          memoryInitializedFromTA?: boolean;
          memoryTARevision?: string;
        }
      | undefined;
    if (component) {
      component.memory = normalizeNpcMemory(memory);
      component.memoryInitializedFromTA = true;
      const textAssets = this.game.textAssets as any;
      component.memoryTARevision =
        typeof textAssets.getResolvedNpcMemoryRevision === 'function'
          ? textAssets.getResolvedNpcMemoryRevision(actor)
          : JSON.stringify([]);
    }
  }

  /** Compatibility path for plans persisted before structured NPC cognition. */
  private setLegacyNpcMemory(actor: Actor, memory: string): void {
    const component = actor.components?.find((candidate: any) => candidate?.type === 'NPC') as
      | { type: 'NPC'; memory?: string }
      | undefined;
    if (component) component.memory = String(memory || '').trim();
  }

  private getNpcObjectives(actor: Actor) {
    const component = actor.components?.find((candidate: any) => candidate?.type === 'NPC') as
      | { type: 'NPC'; objectives?: unknown }
      | undefined;
    return normalizeNpcObjectives(component?.objectives);
  }

  private setNpcObjectives(
    actor: Actor,
    objectives: ReturnType<typeof normalizeNpcObjectives>
  ): void {
    const component = actor.components?.find((candidate: any) => candidate?.type === 'NPC') as
      | {
          type: 'NPC';
          objectives?: ReturnType<typeof normalizeNpcObjectives>;
          objectivesInitializedFromTA?: boolean;
          objectivesTARevision?: string;
        }
      | undefined;
    if (component) {
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

  /** Compatibility path for legacy OBJECTIVES_SET continuation steps. */
  private setLegacyNpcObjectives(actor: Actor, objectives: string[]): void {
    const component = actor.components?.find((candidate: any) => candidate?.type === 'NPC') as
      | {
          type: 'NPC';
          objectives?: string[];
          objectivesInitializedFromTA?: boolean;
          objectivesTARevision?: string;
        }
      | undefined;
    if (!component) return;
    component.objectives = objectives
      .map((objective) => String(objective || '').trim())
      .filter(Boolean);
    component.objectivesInitializedFromTA = true;
    const textAssets = this.game.textAssets as any;
    component.objectivesTARevision =
      typeof textAssets.getResolvedObjectListRevision === 'function'
        ? textAssets.getResolvedObjectListRevision(actor, 'objectives')
        : JSON.stringify([]);
  }

  private moveActor(
    actor: Actor,
    step: Extract<NpcPlanStep, { type: 'MOVE_TO' }>,
    preserveTargetMoveState: boolean = false
  ): NpcPlanExecutionOutcome {
    if (typeof step.x === 'number' && typeof step.y === 'number') {
      this.targetMoveStates.delete(actor.name);
      return this.startMove(actor, actor.moveTo(step.x, step.y));
    }

    const targetId = String(step.targetId || '').trim();
    const target = this.getActorScene(actor)?.getObjectByName(targetId);
    if (!target) {
      return { status: 'failed', code: 'move_target_not_found', npcId: actor.name };
    }

    if (!preserveTargetMoveState) {
      this.targetMoveStates.set(actor.name, {
        targetId,
        localTeleportRevision: actor.getLocalTeleportRevision(),
        localTeleportReplans: 0,
      });
    }

    const token = (this.navigationTokens.get(actor.name) || 0) + 1;
    this.navigationTokens.set(actor.name, token);
    this.game.actorNavigation.requestNpcApproach(actor, target, (navigation) => {
      if (this.navigationTokens.get(actor.name) !== token) return;
      this.navigationTokens.delete(actor.name);
      if (navigation.plan.status === 'already_reachable') {
        this.targetMoveStates.delete(actor.name);
        this.scheduleMoveCompletion(
          actor.name,
          {
            status: 'arrived',
            code: 'arrived',
            message: 'Already close enough to interact.',
            target: { x: actor.x, y: actor.y },
            route: [],
          },
          0
        );
        return;
      }
      if (!navigation.plan.point) {
        this.targetMoveStates.delete(actor.name);
        this.scheduleMoveCompletion(
          actor.name,
          {
            status: 'unreachable',
            code: 'route_unreachable',
            message: 'Destination is unreachable.',
            target: null,
            route: [],
          },
          0
        );
        return;
      }
      const result = navigation.route
        ? actor.startPlannedRoute(navigation.plan.point, navigation.route)
        : actor.moveTo(navigation.plan.point.x, navigation.plan.point.y);
      traceNavigation(this.game, 'move_route_ready', {
        actorId: actor.name,
        targetId: target.name,
        source: navigation.source,
        actorPosition: { x: actor.x, y: actor.y },
        approachPoint: navigation.plan.point,
        routeLength: result.route.length,
        result: result.status,
      });
      this.startMove(actor, result);
    });
    return {
      status: 'scheduled',
      code: 'npc_route_planning',
      npcId: actor.name,
      targetId,
      message: 'Navigation route is being planned.',
      actionType: 'MOVE_TO',
    };
  }

  private traverseExit(actor: Actor, targetId: string): NpcPlanExecutionOutcome {
    const normalizedTargetId = String(targetId || '').trim();
    const scene = this.getActorScene(actor);
    const target = scene?.getObjectByName(normalizedTargetId);
    const exit = target?.components?.find((component: any) => component?.type === 'Exit') as
      | { portal?: boolean; collider?: boolean }
      | undefined;
    if (!scene || !target || !exit) {
      return this.completeAction(actor.name, {
        status: 'failed',
        code: 'exit_target_not_found',
        npcId: actor.name,
        targetId: normalizedTargetId,
        actionType: 'TRAVERSE_EXIT',
      });
    }
    if (!this.game.actorNavigation.isReachable(actor, target)) {
      return this.completeAction(actor.name, {
        status: 'failed',
        code: 'exit_not_reachable',
        npcId: actor.name,
        targetId: target.name,
        actionType: 'TRAVERSE_EXIT',
      });
    }
    if (exit.portal !== true && exit.collider === false) {
      return this.completeAction(actor.name, {
        status: 'failed',
        code: 'exit_disabled',
        npcId: actor.name,
        targetId: target.name,
        actionType: 'TRAVERSE_EXIT',
      });
    }
    scene.activateObject(target, 0, actor);
    return this.completeAction(actor.name, {
      status: 'ok',
      code: 'exit_traversed',
      npcId: actor.name,
      targetId: target.name,
      actionType: 'TRAVERSE_EXIT',
      worldChanged: true,
    });
  }

  private startMove(actor: Actor, result: ActorMoveResult): NpcPlanExecutionOutcome {
    if (result.status === 'started') {
      this.moveStartedAt.set(actor.name, Date.now());
      traceNavigation(this.game, 'move_started', {
        actorId: actor.name,
        target: result.target,
        routeLength: result.route.length,
      });
      this.watchMoveCompletion(actor);
      return {
        status: 'scheduled',
        code: 'npc_move_started',
        npcId: actor.name,
        message: result.message,
      };
    }

    this.scheduleMoveCompletion(actor.name, result, 0);
    return {
      status: 'failed',
      code: result.code,
      npcId: actor.name,
      message: result.message,
    };
  }

  private watchMoveCompletion(actor: Actor): void {
    if (!this.moveCompletionScheduler) return;
    const token = (this.moveWatchTokens.get(actor.name) || 0) + 1;
    this.moveWatchTokens.set(actor.name, token);

    const poll = () => {
      if (this.moveWatchTokens.get(actor.name) !== token) return;
      const result = actor.getMoveResult();
      if (result.status !== 'started' || actor.state !== 'walk') {
        this.moveWatchTokens.delete(actor.name);
        const startedAt = this.moveStartedAt.get(actor.name);
        this.moveStartedAt.delete(actor.name);
        const targetMove = this.targetMoveStates.get(actor.name);
        if (
          result.status === 'arrived' &&
          targetMove &&
          targetMove.localTeleportReplans < 1 &&
          actor.getLocalTeleportRevision() > targetMove.localTeleportRevision
        ) {
          targetMove.localTeleportReplans += 1;
          targetMove.localTeleportRevision = actor.getLocalTeleportRevision();
          traceNavigation(this.game, 'move_replanned_after_local_teleport', {
            actorId: actor.name,
            targetId: targetMove.targetId,
            actorPosition: { x: actor.x, y: actor.y },
          });
          this.moveActor(actor, { type: 'MOVE_TO', targetId: targetMove.targetId }, true);
          return;
        }
        this.targetMoveStates.delete(actor.name);
        traceNavigation(this.game, 'move_completed', {
          actorId: actor.name,
          status: result.status,
          code: result.code,
          elapsedMs: startedAt === undefined ? null : Date.now() - startedAt,
          actorPosition: { x: actor.x, y: actor.y },
          target: result.target,
        });
        this.moveCompletionScheduler?.(actor.name, result);
        return;
      }
      globalThis.setTimeout(poll, 50);
    };

    globalThis.setTimeout(poll, 50);
  }

  private executeTargetAction(
    actor: Actor,
    targetId: string,
    action: 'LOOK' | 'EXAMINE' | 'OPEN' | 'CLOSE',
    relation?: 'in' | 'on' | 'under' | 'behind' | null
  ): NpcPlanExecutionOutcome {
    const normalizedTargetId = String(targetId || '').trim();
    const scene = this.getActorScene(actor);
    const target = scene?.getObjectByName(normalizedTargetId);
    if (!target) {
      const sceneTitle = scene
        ? this.game.textAssets.getResolvedSceneField(scene, 'title')?.trim()
        : '';
      const targetsScene =
        !!scene &&
        (normalizedTargetId.toLowerCase() === scene.id.toLowerCase() ||
          (!!sceneTitle && normalizedTargetId.toLowerCase() === sceneTitle.toLowerCase()));
      if (targetsScene && (action === 'LOOK' || action === 'EXAMINE')) {
        const description = this.game.textAssets.getResolvedSceneField(scene, 'description') || '';
        return this.completeAction(actor.name, {
          status: 'ok',
          code: action === 'LOOK' ? 'scene_looked' : 'scene_examined',
          npcId: actor.name,
          targetId: scene.id,
          message: description,
          actionType: action,
          relation: relation || undefined,
          worldChanged: false,
          discoveredEntityIds: [],
          repeatKey: `${action}:SCENE:${scene.id}:${relation || '*'}`,
        });
      }
      return this.completeAction(actor.name, {
        status: 'failed',
        code: `${action.toLowerCase()}_target_not_found`,
        npcId: actor.name,
        targetId: normalizedTargetId,
      });
    }
    const relationOptions = relation ? { relation } : undefined;
    const outcome =
      action === 'LOOK'
        ? this.game.lookEntityForActor(actor, target, relationOptions)
        : action === 'EXAMINE'
          ? this.game.examineEntityForActor(actor, target, relationOptions)
          : action === 'OPEN'
            ? this.game.openEntityForActor(actor, target)
            : this.game.closeEntityForActor(actor, target);
    const relationOutcomes =
      (action === 'LOOK' || action === 'EXAMINE') && outcome.status === 'ok'
        ? (relation
            ? [relation]
            : action === 'EXAMINE'
              ? (['in', 'on', 'under', 'behind'] as const)
              : []
          )
            .map((candidate) => this.game.describeSpatialRelation(target.name, candidate))
            .filter(
              (candidate) =>
                candidate.status === 'ok' &&
                (candidate.code === 'relation_contents' ||
                  (relation && candidate.code === 'relation_empty'))
            )
        : [];
    const discoveredFromContents = relationOutcomes.flatMap((candidate) =>
      Array.isArray(candidate.data?.discoveredEntityIds)
        ? candidate.data.discoveredEntityIds.filter(
            (value): value is string => typeof value === 'string'
          )
        : []
    );
    const messages = [
      outcome.message,
      ...relationOutcomes.map((candidate) => candidate.message),
    ].filter((value): value is string => typeof value === 'string' && !!value.trim());
    return this.completeAction(actor.name, {
      status: outcome.status === 'ok' ? 'ok' : 'failed',
      code: outcome.code,
      npcId: actor.name,
      targetId: target.name,
      message: messages.join('\n'),
      actionType: action,
      relation: relation || undefined,
      worldChanged: outcome.data?.worldChanged === true || (outcome.effects?.length || 0) > 0,
      discoveredEntityIds: Array.from(
        new Set([
          ...(Array.isArray(outcome.data?.discoveredEntityIds)
            ? outcome.data.discoveredEntityIds.filter(
                (value): value is string => typeof value === 'string'
              )
            : []),
          ...discoveredFromContents,
        ])
      ),
      repeatKey: relation ? `${action}:${target.name}:${relation}` : `${action}:${target.name}`,
    });
  }

  private scheduleMoveCompletion(npcId: string, result: ActorMoveResult, delayMs: number): void {
    if (!this.moveCompletionScheduler) return;
    const timeoutId = globalThis.setTimeout(() => {
      const timeouts = this.pendingTimeouts.get(npcId);
      if (timeouts) {
        timeouts.delete(timeoutId);
        if (timeouts.size === 0) this.pendingTimeouts.delete(npcId);
      }
      this.moveCompletionScheduler?.(npcId, result);
    }, delayMs);

    let timeouts = this.pendingTimeouts.get(npcId);
    if (!timeouts) {
      timeouts = new Set();
      this.pendingTimeouts.set(npcId, timeouts);
    }
    timeouts.add(timeoutId);
  }

  private takeEntity(actor: Actor, targetId: string): NpcPlanExecutionOutcome {
    const normalizedTargetId = String(targetId || '').trim();
    const scene = this.getActorScene(actor);
    const target = scene?.getObjectByName(normalizedTargetId);
    if (!(target instanceof Entity)) {
      return this.completeAction(actor.name, {
        status: 'failed',
        code: 'take_target_not_found',
        npcId: actor.name,
        targetId: normalizedTargetId,
      });
    }

    if (target === actor) {
      return this.completeAction(actor.name, {
        status: 'failed',
        code: 'take_self',
        npcId: actor.name,
        targetId: target.name,
      });
    }

    const outcome = this.game.takeEntityForActor(actor, target);
    return this.completeAction(actor.name, {
      status: outcome.status === 'ok' ? 'ok' : 'failed',
      code: outcome.code,
      npcId: actor.name,
      targetId: target.name,
      message: outcome.message,
      actionType: 'TAKE',
      worldChanged: outcome.status === 'ok',
      repeatKey: `TAKE:${target.name}`,
    });
  }

  private giveEntity(actor: Actor, itemId: string, targetId: string): NpcPlanExecutionOutcome {
    const scene = this.getActorScene(actor);
    const item = scene?.getObjectByName(String(itemId || '').trim());
    const target = scene?.getObjectByName(String(targetId || '').trim());
    if (!(item instanceof Entity)) {
      return this.completeAction(actor.name, {
        status: 'failed',
        code: 'give_item_not_found',
        npcId: actor.name,
        itemId,
        targetId,
      });
    }
    if (!(target instanceof Actor)) {
      return this.completeAction(actor.name, {
        status: 'failed',
        code: 'give_target_not_found',
        npcId: actor.name,
        itemId: item.name,
        targetId,
      });
    }
    const outcome = this.game.giveEntityForActor(actor, item, target);
    return this.completeAction(actor.name, {
      status: outcome.status === 'ok' ? 'ok' : 'failed',
      code: outcome.code,
      npcId: actor.name,
      itemId: item.name,
      targetId: target.name,
      message: outcome.message,
      actionType: 'GIVE',
      worldChanged: outcome.status === 'ok',
      repeatKey: `GIVE:${item.name}:${target.name}`,
    });
  }

  private executeCommand(
    actor: Actor,
    commandId: string,
    argumentsByName: Record<string, string | null> = {}
  ): NpcPlanExecutionOutcome {
    const outcome = this.game.actorCommands.executeCommand(actor, commandId, argumentsByName);
    return this.completeAction(actor.name, {
      status: outcome.status === 'ok' ? 'ok' : 'failed',
      code: outcome.code,
      npcId: actor.name,
      commandId,
      message: outcome.message || outcome.displayMessages?.join('\n'),
      actionType: 'COMMAND',
      worldChanged: outcome.status === 'ok',
      repeatKey: `COMMAND:${commandId}`,
    });
  }

  private putEntity(
    actor: Actor,
    itemId: string,
    targetId?: string | null,
    relation?: 'in' | 'on' | 'under' | 'behind' | null
  ): NpcPlanExecutionOutcome {
    const normalizedItemId = String(itemId || '').trim();
    const scene = this.getActorScene(actor);
    const item = scene?.getObjectByName(normalizedItemId);
    if (!(item instanceof Entity)) {
      return this.completeAction(actor.name, {
        status: 'failed',
        code: 'put_item_not_found',
        npcId: actor.name,
        itemId: normalizedItemId,
        targetId: targetId || undefined,
      });
    }

    const normalizedTargetId =
      typeof targetId === 'string' && targetId.trim() ? targetId.trim() : null;
    const target = normalizedTargetId ? scene?.getObjectByName(normalizedTargetId) || null : null;
    if (normalizedTargetId && !target) {
      return this.completeAction(actor.name, {
        status: 'failed',
        code: 'put_target_not_found',
        npcId: actor.name,
        itemId: item.name,
        targetId: normalizedTargetId,
      });
    }

    if (target === item) {
      return this.completeAction(actor.name, {
        status: 'failed',
        code: 'put_target_is_source',
        npcId: actor.name,
        itemId: item.name,
        targetId: target.name,
      });
    }

    const outcome = this.game.putEntityForActor(actor, item, target, {
      relation: relation || null,
    });
    return this.completeAction(actor.name, {
      status: outcome.status === 'ok' ? 'ok' : 'failed',
      code: outcome.code,
      npcId: actor.name,
      itemId: item.name,
      targetId: target?.name,
      message: outcome.message,
      actionType: 'PUT',
      worldChanged: outcome.status === 'ok',
      repeatKey: `PUT:${normalizedItemId}:${normalizedTargetId || 'floor'}:${relation || ''}`,
    });
  }

  private completeAction(npcId: string, outcome: NpcPlanExecutionOutcome): NpcPlanExecutionOutcome {
    if (!this.actionCompletionScheduler) return outcome;
    // The semantic action has already completed at this point. Enqueue its
    // outcome immediately; Puppet Master batching supplies the asynchronous
    // boundary before the continuation is consumed. Deferring this callback
    // through a zero-delay timer can strand a stored multi-step continuation
    // if that timer is throttled or lost by the host runtime.
    this.actionCompletionScheduler(npcId, outcome, true);
    return { ...outcome, status: 'scheduled' };
  }

  private findActor(npcId: string): Actor | null {
    const current = this.game.sceneManager.currentScene?.getObjectByName(npcId);
    if (current instanceof Actor) return current;
    return (
      Array.from(this.game.sceneManager.scenes.values())
        .map((scene) => scene.getObjectByName(npcId))
        .find((candidate): candidate is Actor => candidate instanceof Actor) || null
    );
  }

  private getActorScene(actor: Actor): ReturnType<typeof this.game.sceneManager.scenes.get> | null {
    const current = this.game.sceneManager.currentScene;
    if (current?.getObjectByName(actor.name) === actor) return current;
    return (
      Array.from(this.game.sceneManager.scenes.values()).find(
        (scene) => scene.getObjectByName(actor.name) === actor
      ) || null
    );
  }
}
