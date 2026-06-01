import { Actor } from '../entities/Actor';
import type { ActorMoveResult } from '../entities/Actor';
import type { IGame } from '../core/IGame';
import type { SceneObject } from '../entities/SceneObject';
import { ComponentSystem } from '../systems/ComponentSystem';
import type { NpcPlan, NpcPlanExecutionOutcome, NpcPlanStep } from './npcTypes';

export type NpcWaitScheduler = (npcId: string, ms: number) => void;
export type NpcMoveCompletionScheduler = (npcId: string, result: ActorMoveResult) => void;

export class ActorPlanExecutor {
  private readonly game: IGame;
  private readonly waitScheduler?: NpcWaitScheduler;
  private readonly moveCompletionScheduler?: NpcMoveCompletionScheduler;
  private moveWatchTokens = new Map<string, number>();

  constructor(
    game: IGame,
    waitScheduler?: NpcWaitScheduler,
    moveCompletionScheduler?: NpcMoveCompletionScheduler
  ) {
    this.game = game;
    this.waitScheduler = waitScheduler;
    this.moveCompletionScheduler = moveCompletionScheduler;
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
    for (const step of plan.steps) {
      outcomes.push(this.executeStep(actor, step));
    }

    if (typeof plan.memory === 'string') {
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
        sayAsActor.call(this.game, actor, text, { triggerPuppetMaster: false });
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

    if (step.type === 'MOVE_TO') {
      return this.moveActor(actor, step);
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
    const target = this.resolveMoveTarget(actor, step);
    if (!target) {
      return { status: 'failed', code: 'move_target_not_found', npcId: actor.name };
    }

    const result = actor.moveTo(target.x, target.y);
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

  private resolveMoveTarget(
    actor: Actor,
    step: Extract<NpcPlanStep, { type: 'MOVE_TO' }>
  ): { x: number; y: number } | null {
    if (typeof step.x === 'number' && typeof step.y === 'number') {
      return { x: step.x, y: step.y };
    }

    const targetId = String(step.targetId || '').trim();
    if (!targetId) return null;
    const object = this.game.sceneManager.currentScene?.getObjectByName(targetId) as
      | SceneObject
      | undefined;
    if (!object) return null;
    const center = this.getObjectCenter(object);
    return center ? this.findNearestWalkableTarget(actor, center.x, center.y) : null;
  }

  private getObjectCenter(object: SceneObject): { x: number; y: number } | null {
    const record = object as unknown as {
      x?: number;
      y?: number;
      poly?: Array<{ x: number; y: number }>;
      vertices?: Array<{ x: number; y: number }>;
    };
    if (typeof record.x === 'number' && typeof record.y === 'number') {
      return { x: record.x, y: record.y };
    }

    const points = Array.isArray(record.poly) && record.poly.length ? record.poly : record.vertices;
    if (!Array.isArray(points) || !points.length) return null;
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
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

  private findNearestWalkableTarget(
    actor: Actor,
    targetX: number,
    targetY: number
  ): { x: number; y: number } | null {
    const scene = this.game.sceneManager.currentScene;
    if (!scene || typeof scene.isWalkable !== 'function') return { x: targetX, y: targetY };
    if (scene.isWalkable(targetX, targetY, actor)) return { x: targetX, y: targetY };

    const step = 4;
    const maxRadius = Math.max(160, actor.colliderWidth * 2, actor.colliderHeight * 8);
    let best: { x: number; y: number; distanceSq: number } | null = null;

    for (let radius = step; radius <= maxRadius; radius += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        for (let dy = -radius; dy <= radius; dy += step) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          const x = targetX + dx;
          const y = targetY + dy;
          if (!scene.isWalkable(x, y, actor)) continue;
          const distanceSq = dx * dx + dy * dy;
          if (!best || distanceSq < best.distanceSq) {
            best = { x, y, distanceSq };
          }
        }
      }
      const nearest = best;
      if (nearest !== null) return { x: nearest.x, y: nearest.y };
    }

    return null;
  }

  private scheduleMoveCompletion(npcId: string, result: ActorMoveResult, delayMs: number): void {
    if (!this.moveCompletionScheduler) return;
    globalThis.setTimeout(() => this.moveCompletionScheduler?.(npcId, result), delayMs);
  }
}
