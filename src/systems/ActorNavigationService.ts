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

    const maxRadius = this.getMaxApproachRadius(actor, approachTarget);
    return this.findRoutedApproach(actor, approachTarget, center, maxRadius, 16, 12) ||
      this.findRoutedApproach(actor, approachTarget, center, maxRadius, 4, 12)
      ? 'route_available'
      : 'unreachable';
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

    const maxRadius = this.getMaxApproachRadius(actor, approachTarget);
    const best =
      this.findRoutedApproach(actor, approachTarget, center, maxRadius, 16, 30) ||
      this.findRoutedApproach(actor, approachTarget, center, maxRadius, 4, 30);

    return best
      ? { status: 'route_available', point: best.point, route: best.route }
      : { status: 'unreachable', point: null, route: [] };
  }

  private findRoutedApproach(
    actor: Actor,
    target: SceneObject,
    center: { x: number; y: number },
    maxRadius: number,
    step: number,
    maxPathfindingAttempts: number
  ):
    | {
        point: { x: number; y: number };
        route: { x: number; y: number }[];
        distanceSq: number;
      }
    | undefined {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return undefined;
    const candidates: Array<{
      point: { x: number; y: number };
      distanceSq: number;
      targetDistanceSq: number;
    }> = [];

    for (let radius = 0; radius <= maxRadius; radius += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        for (let dy = -radius; dy <= radius; dy += step) {
          if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          const point = { x: center.x + dx, y: center.y + dy };
          if (!scene.isWalkable(point.x, point.y, actor)) continue;
          const probe = Object.create(actor) as Actor;
          Object.defineProperty(probe, 'x', { value: point.x, configurable: true });
          Object.defineProperty(probe, 'y', { value: point.y, configurable: true });
          if (ComponentSystem.getInteractionDistanceError(target as any, probe)) continue;
          candidates.push({
            point,
            distanceSq: (point.x - actor.x) ** 2 + (point.y - actor.y) ** 2,
            targetDistanceSq: (point.x - center.x) ** 2 + (point.y - center.y) ** 2,
          });
        }
      }
    }

    candidates.sort((a, b) => a.distanceSq - b.distanceSq);
    let best:
      | {
          point: { x: number; y: number };
          route: { x: number; y: number }[];
          distanceSq: number;
          targetDistanceSq: number;
        }
      | undefined;
    for (const candidate of candidates.slice(0, maxPathfindingAttempts)) {
      const route = actor.previewRouteTo(candidate.point.x, candidate.point.y);
      if (
        route &&
        (!best ||
          candidate.targetDistanceSq < best.targetDistanceSq ||
          (candidate.targetDistanceSq === best.targetDistanceSq &&
            candidate.distanceSq < best.distanceSq))
      ) {
        best = { ...candidate, route };
      }
    }
    return best;
  }

  private getMaxApproachRadius(actor: Actor, target: SceneObject): number {
    return Math.max(
      240,
      actor.colliderWidth * 4,
      actor.colliderHeight * 12,
      this.getInteractionRange(actor, target) * 2
    );
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
