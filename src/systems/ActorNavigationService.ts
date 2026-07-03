import type { IGame } from '../core/IGame';
import { Actor, type ActorMoveResult } from '../entities/Actor';
import type { SceneObject } from '../entities/SceneObject';
import { getInactiveSubsceneAncestors } from '../scene/SceneTextLayer';
import { ComponentSystem } from './ComponentSystem';

export type ActorApproachStatus = 'already_reachable' | 'route_available' | 'unreachable';

export type ActorApproachPlan = {
  status: ActorApproachStatus;
  point: { x: number; y: number } | null;
  route: { x: number; y: number }[];
};

export class ActorNavigationService {
  private readonly game: IGame;

  constructor(game: IGame) {
    this.game = game;
  }

  isReachable(actor: Actor, target: SceneObject): boolean {
    return !ComponentSystem.getInteractionDistanceError(target as any, actor);
  }

  getFastApproachStatus(actor: Actor, target: SceneObject): ActorApproachStatus {
    const approachTarget = this.getApproachTarget(target);
    if (this.isReachable(actor, approachTarget)) return 'already_reachable';
    const center = this.getObjectCenter(approachTarget);
    const scene = this.game.sceneManager.currentScene;
    if (!center || !scene) return 'unreachable';

    const step = 16;
    const maxRadius = Math.max(
      240,
      actor.colliderWidth * 4,
      actor.colliderHeight * 12,
      this.getInteractionRange(actor, approachTarget) * 2
    );
    for (let radius = 0; radius <= maxRadius; radius += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        for (let dy = -radius; dy <= radius; dy += step) {
          if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          const point = { x: center.x + dx, y: center.y + dy };
          if (!scene.isWalkable(point.x, point.y, actor)) continue;
          const probe = Object.create(actor) as Actor;
          Object.defineProperty(probe, 'x', { value: point.x, configurable: true });
          Object.defineProperty(probe, 'y', { value: point.y, configurable: true });
          if (!ComponentSystem.getInteractionDistanceError(approachTarget as any, probe)) {
            return 'route_available';
          }
        }
      }
    }
    return 'unreachable';
  }

  planApproach(actor: Actor, target: SceneObject): ActorApproachPlan {
    const approachTarget = this.getApproachTarget(target);
    if (this.isReachable(actor, approachTarget)) {
      return {
        status: 'already_reachable',
        point: { x: actor.x, y: actor.y },
        route: [],
      };
    }

    const center = this.getObjectCenter(approachTarget);
    if (!center) return { status: 'unreachable', point: null, route: [] };
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return { status: 'unreachable', point: null, route: [] };

    const maxRadius = Math.max(
      240,
      actor.colliderWidth * 4,
      actor.colliderHeight * 12,
      this.getInteractionRange(actor, approachTarget) * 2
    );
    let best:
      | {
          point: { x: number; y: number };
          route: { x: number; y: number }[];
          distanceSq: number;
        }
      | undefined;

    const MAX_PATHFINDING_ATTEMPTS = 30;
    let attempts = 0;

    for (const step of [16, 4]) {
      for (let radius = 0; radius <= maxRadius; radius += step) {
        let foundAtCurrentRadius = false;
        for (let dx = -radius; dx <= radius; dx += step) {
          for (let dy = -radius; dy <= radius; dy += step) {
            if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
            const point = { x: center.x + dx, y: center.y + dy };
            if (!scene.isWalkable(point.x, point.y, actor)) continue;
            const probe = Object.create(actor) as Actor;
            Object.defineProperty(probe, 'x', { value: point.x, configurable: true });
            Object.defineProperty(probe, 'y', { value: point.y, configurable: true });
            const distanceError = ComponentSystem.getInteractionDistanceError(
              approachTarget as any,
              probe
            );
            if (distanceError) continue;

            if (attempts >= MAX_PATHFINDING_ATTEMPTS) {
              break;
            }
            attempts++;

            const route = actor.previewRouteTo(point.x, point.y);
            if (!route) continue;
            const distanceSq = (point.x - actor.x) ** 2 + (point.y - actor.y) ** 2;
            if (!best || distanceSq < best.distanceSq) {
              best = { point, route, distanceSq };
              foundAtCurrentRadius = true;
            }
          }
          if (attempts >= MAX_PATHFINDING_ATTEMPTS) break;
        }
        if (foundAtCurrentRadius || attempts >= MAX_PATHFINDING_ATTEMPTS) break;
      }
      if (best) break;
    }

    return best
      ? { status: 'route_available', point: best.point, route: best.route }
      : { status: 'unreachable', point: null, route: [] };
  }

  moveActorToTarget(actor: Actor, target: SceneObject): ActorMoveResult | null {
    const plan = this.planApproach(actor, target);
    if (plan.status === 'already_reachable') {
      return actor.moveTo(actor.x, actor.y);
    }
    if (!plan.point) {
      return null;
    }
    return actor.moveTo(plan.point.x, plan.point.y);
  }

  private getApproachTarget(target: SceneObject): SceneObject {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return target;
    return getInactiveSubsceneAncestors(scene, target)[0] || target;
  }

  private getObjectCenter(object: SceneObject): { x: number; y: number } | null {
    const point = this.game.inventoryManager.getSceneObjectReferencePoint(object);
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
  }

  private getInteractionRange(actor: Actor, target: SceneObject): number {
    const targetRecord = target as unknown as { interactionDistance?: number };
    const actorRecord = actor as unknown as { interactionDistance?: number };
    return Math.max(
      64,
      Number(targetRecord.interactionDistance) || 0,
      Number(actorRecord.interactionDistance) || 0
    );
  }
}
