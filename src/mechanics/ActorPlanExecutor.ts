import { Actor } from '../entities/Actor';
import { Entity } from '../entities/Entity';
import type { ActorMoveResult } from '../entities/Actor';
import type { IGame } from '../core/IGame';
import { ComponentSystem } from '../systems/ComponentSystem';
import type { NpcPlan, NpcPlanExecutionOutcome, NpcPlanStep } from './npcTypes';

export type NpcWaitScheduler = (npcId: string, ms: number) => void;
export type NpcMoveCompletionScheduler = (npcId: string, result: ActorMoveResult) => void;
export type NpcActionCompletionScheduler = (npcId: string, result: NpcPlanExecutionOutcome) => void;
export type NpcStrategyScheduler = (npcId: string, reason?: string) => void;

export class ActorPlanExecutor {
  private readonly game: IGame;
  private readonly waitScheduler?: NpcWaitScheduler;
  private readonly moveCompletionScheduler?: NpcMoveCompletionScheduler;
  private readonly actionCompletionScheduler?: NpcActionCompletionScheduler;
  private readonly strategyScheduler?: NpcStrategyScheduler;
  private moveWatchTokens = new Map<string, number>();
  private pendingTimeouts = new Set<any>();

  clearState(npcId: string): void {
    const current = this.moveWatchTokens.get(npcId) || 0;
    this.moveWatchTokens.set(npcId, current + 1);
  }

  clearAllPending(): void {
    this.moveWatchTokens.clear();
    for (const timeoutId of this.pendingTimeouts) {
      globalThis.clearTimeout(timeoutId);
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
    const scene = this.game.sceneManager.currentScene;
    const actor = scene?.getObjectByName(plan.npcId);
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
      this.setNpcMemory(actor, plan.memory);
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
      this.setNpcMemory(actor, step.memory);
      return { status: 'ok', code: 'npc_memory_updated', npcId: actor.name };
    }

    if (step.type === 'OBJECTIVES_SET') {
      this.setNpcObjectives(actor, step.objectives);
      return { status: 'ok', code: 'npc_objectives_updated', npcId: actor.name };
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

    if (step.type === 'PUT') {
      return this.putEntity(actor, step.itemId, step.targetId, step.relation);
    }

    if (step.type === 'COMMAND') {
      return this.executeCommand(actor, step.commandId, step.arguments);
    }

    if (step.type === 'USE') {
      return this.useItemOn(actor, step.itemId, step.targetId);
    }

    return {
      status: 'unsupported',
      code: 'unsupported_in_v1',
      npcId: actor.name,
    };
  }

  private setNpcMemory(actor: Actor, memory: string): void {
    const component = actor.components?.find((candidate: any) => candidate?.type === 'NPC') as
      | { type: 'NPC'; memory?: string }
      | undefined;
    if (component) {
      component.memory = String(memory || '').trim();
    }
  }

  private setNpcObjectives(actor: Actor, objectives: string[]): void {
    const component = actor.components?.find((candidate: any) => candidate?.type === 'NPC') as
      | { type: 'NPC'; objectives?: string[]; objectivesInitializedFromTA?: boolean }
      | undefined;
    if (component) {
      component.objectives = objectives
        .map((objective) => String(objective || '').trim())
        .filter(Boolean);
      component.objectivesInitializedFromTA = true;
    }
  }

  private moveActor(
    actor: Actor,
    step: Extract<NpcPlanStep, { type: 'MOVE_TO' }>
  ): NpcPlanExecutionOutcome {
    if (typeof step.x === 'number' && typeof step.y === 'number') {
      return this.startMove(actor, actor.moveTo(step.x, step.y));
    }

    const targetId = String(step.targetId || '').trim();
    const target = this.game.sceneManager.currentScene?.getObjectByName(targetId);
    if (!target) {
      return { status: 'failed', code: 'move_target_not_found', npcId: actor.name };
    }

    const approach = this.game.actorNavigation.planApproach(actor, target);
    if (approach.status === 'already_reachable') {
      const result: ActorMoveResult = {
        status: 'arrived',
        code: 'arrived',
        message: 'Already close enough to interact.',
        target: { x: actor.x, y: actor.y },
        route: [],
      };
      this.scheduleMoveCompletion(actor.name, result, 0);
      return {
        status: 'scheduled',
        code: 'npc_already_reachable',
        npcId: actor.name,
        message: result.message,
      };
    }
    if (!approach.point) {
      const result: ActorMoveResult = {
        status: 'unreachable',
        code: 'route_unreachable',
        message: 'Destination is unreachable.',
        target: null,
        route: [],
      };
      this.scheduleMoveCompletion(actor.name, result, 0);
      return {
        status: 'failed',
        code: result.code,
        npcId: actor.name,
        message: result.message,
      };
    }

    return this.startMove(actor, actor.moveTo(approach.point.x, approach.point.y));
  }

  private startMove(actor: Actor, result: ActorMoveResult): NpcPlanExecutionOutcome {
    if (result.status === 'started') {
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
    const target = this.game.sceneManager.currentScene?.getObjectByName(normalizedTargetId);
    if (!target) {
      return this.completeAction(actor.name, {
        status: 'failed',
        code: `${action.toLowerCase()}_target_not_found`,
        npcId: actor.name,
        targetId: normalizedTargetId,
      });
    }
    const outcome =
      action === 'LOOK'
        ? this.game.lookEntityForActor(actor, target)
        : action === 'EXAMINE'
          ? this.game.examineEntityForActor(actor, target)
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
      this.pendingTimeouts.delete(timeoutId);
      this.moveCompletionScheduler?.(npcId, result);
    }, delayMs);
    this.pendingTimeouts.add(timeoutId);
  }

  private takeEntity(actor: Actor, targetId: string): NpcPlanExecutionOutcome {
    const normalizedTargetId = String(targetId || '').trim();
    const scene = this.game.sceneManager.currentScene;
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
    const scene = this.game.sceneManager.currentScene;
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

  private useItemOn(actor: Actor, itemId: string, targetId: string): NpcPlanExecutionOutcome {
    const outcome = this.game.actorCommands.useItemOn(actor, itemId, targetId);
    return this.completeAction(actor.name, {
      status: outcome.status === 'ok' ? 'ok' : 'failed',
      code: outcome.code,
      npcId: actor.name,
      itemId,
      targetId,
      message: outcome.message,
      actionType: 'USE',
      worldChanged: outcome.status === 'ok',
      repeatKey: `USE:${itemId}:${targetId}`,
    });
  }

  private completeAction(npcId: string, outcome: NpcPlanExecutionOutcome): NpcPlanExecutionOutcome {
    if (!this.actionCompletionScheduler) return outcome;
    const timeoutId = globalThis.setTimeout(() => {
      this.pendingTimeouts.delete(timeoutId);
      this.actionCompletionScheduler?.(npcId, outcome);
    }, 0);
    this.pendingTimeouts.add(timeoutId);
    return { ...outcome, status: 'scheduled' };
  }
}
