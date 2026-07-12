import type { IGame } from '../core/IGame';
import { Actor, type ActorMoveResult } from '../entities/Actor';
import type { SceneObject } from '../entities/SceneObject';
import { getInactiveSubsceneAncestors } from '../scene/SceneTextLayer';
import { ComponentSystem } from './ComponentSystem';
import type { ExitComponent } from './ComponentSystem';

export type ActorApproachStatus = 'already_reachable' | 'route_available' | 'unreachable';

export type ActorApproachPlan = {
  status: ActorApproachStatus;
  point: { x: number; y: number } | null;
  route: { x: number; y: number }[];
};

export type ActorLocalTeleportPlan = {
  exits: SceneObject[];
  firstLeg: ActorApproachPlan;
  cost: number;
};

export class ActorNavigationService {
  private readonly game: IGame;
  private readonly pendingTeleportPlans = new WeakMap<
    Actor,
    { target: { x: number; y: number }; plan: ActorLocalTeleportPlan }
  >();

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
    if (this.getLocalTeleportExits(scene).length > 0) {
      return 'route_available';
    }

    const maxRadius = this.getMaxApproachRadius(actor, approachTarget);
    const walkingApproach =
      this.findRoutedApproach(actor, approachTarget, center, maxRadius, 16, 12) ||
      this.findRoutedApproach(actor, approachTarget, center, maxRadius, 4, 12);
    if (walkingApproach) return 'route_available';
    return this.planApproach(actor, target).status;
  }

  planApproach(actor: Actor, target: SceneObject): ActorApproachPlan {
    const scene = actor.scene || this.game.sceneManager.currentScene;
    const hasLocalTeleports = !!scene && this.getLocalTeleportExits(scene).length > 0;
    const walkingPlan = this.planWalkingApproach(actor, target, hasLocalTeleports ? 1 : 30);
    if (walkingPlan.status !== 'unreachable') return walkingPlan;
    return this.planTeleportApproach(actor, target);
  }

  planWalkingApproach(
    actor: Actor,
    target: SceneObject,
    maxPathfindingAttempts: number = 30
  ): ActorApproachPlan {
    return this.planApproachWith(
      actor,
      target,
      (x, y) => actor.previewWalkingRouteTo(x, y),
      maxPathfindingAttempts
    );
  }

  private planApproachWith(
    actor: Actor,
    target: SceneObject,
    previewRoute: (x: number, y: number) => { x: number; y: number }[] | null,
    maxPathfindingAttempts: number = 30
  ): ActorApproachPlan {
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
      this.findRoutedApproach(
        actor,
        approachTarget,
        center,
        maxRadius,
        16,
        maxPathfindingAttempts,
        previewRoute
      ) ||
      this.findRoutedApproach(
        actor,
        approachTarget,
        center,
        maxRadius,
        4,
        maxPathfindingAttempts,
        previewRoute
      );

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
    maxPathfindingAttempts: number,
    previewRoute: (x: number, y: number) => { x: number; y: number }[] | null = (x, y) =>
      actor.previewWalkingRouteTo(x, y)
  ):
    | {
        point: { x: number; y: number };
        route: { x: number; y: number }[];
        distanceSq: number;
      }
    | undefined {
    const candidates = this.collectApproachCandidates(actor, target, center, maxRadius, step);

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
      const route = previewRoute(candidate.point.x, candidate.point.y);
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

  private collectApproachCandidates(
    actor: Actor,
    target: SceneObject,
    center: { x: number; y: number },
    maxRadius: number,
    step: number
  ): Array<{
    point: { x: number; y: number };
    distanceSq: number;
    targetDistanceSq: number;
  }> {
    const scene = actor.scene || this.game.sceneManager.currentScene;
    if (!scene) return [];
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
          const probe = this.createActorProbe(actor, point);
          if (ComponentSystem.getInteractionDistanceError(target as any, probe)) continue;
          candidates.push({
            point,
            distanceSq: (point.x - actor.x) ** 2 + (point.y - actor.y) ** 2,
            targetDistanceSq: dx * dx + dy * dy,
          });
        }
      }
    }
    candidates.sort((a, b) => a.distanceSq - b.distanceSq);
    return candidates;
  }

  private planTeleportApproach(actor: Actor, target: SceneObject): ActorApproachPlan {
    const approachTarget = this.getApproachTarget(target);
    const center = this.getObjectCenter(approachTarget);
    const scene = actor.scene || this.game.sceneManager.currentScene;
    if (!center || !scene) return { status: 'unreachable', point: null, route: [] };
    const maxRadius = this.getMaxApproachRadius(actor, approachTarget);
    const candidates = [
      ...this.collectApproachCandidates(actor, approachTarget, center, maxRadius, 16),
      ...this.collectApproachCandidates(actor, approachTarget, center, maxRadius, 4),
    ];
    const exits = this.sortLocalTeleportExits(actor, this.getLocalTeleportExits(scene));

    for (const exitObject of exits) {
      const entryPoint = this.getLocalTeleportEntryPoint(actor, exitObject);
      if (!entryPoint) continue;
      const firstLeg = this.planWalkingApproach(actor, exitObject);
      if (firstLeg.status === 'unreachable' || !firstLeg.point) continue;
      const probe = this.createActorProbe(actor, entryPoint);
      const destinationCandidates = [...candidates]
        .sort(
          (a, b) =>
            (a.point.x - entryPoint.x) ** 2 +
            (a.point.y - entryPoint.y) ** 2 -
            ((b.point.x - entryPoint.x) ** 2 + (b.point.y - entryPoint.y) ** 2)
        )
        .slice(0, 12);
      for (const candidate of destinationCandidates) {
        if (probe.previewWalkingRouteTo(candidate.point.x, candidate.point.y)) {
          this.pendingTeleportPlans.set(actor, {
            target: { ...candidate.point },
            plan: { exits: [exitObject], firstLeg, cost: 0 },
          });
          return { status: 'route_available', point: candidate.point, route: firstLeg.route };
        }
      }
    }
    return { status: 'unreachable', point: null, route: [] };
  }

  planLocalTeleportRoute(
    actor: Actor,
    target: { x: number; y: number },
    directRoute: { x: number; y: number }[] | null
  ): ActorLocalTeleportPlan | null {
    const pending = this.pendingTeleportPlans.get(actor);
    if (
      pending &&
      Math.abs(pending.target.x - target.x) < 0.001 &&
      Math.abs(pending.target.y - target.y) < 0.001
    ) {
      this.pendingTeleportPlans.delete(actor);
      return pending.plan;
    }
    const scene = actor.scene || this.game.sceneManager.currentScene;
    if (!scene) return null;
    const exits = this.sortLocalTeleportExits(actor, this.getLocalTeleportExits(scene));
    if (exits.length === 0) return null;

    const routeLength = (from: { x: number; y: number }, route: { x: number; y: number }[]) => {
      let total = 0;
      let previous = from;
      for (const point of route) {
        total += Math.hypot(point.x - previous.x, point.y - previous.y);
        previous = point;
      }
      return total;
    };
    const directCost = directRoute
      ? routeLength({ x: actor.x, y: actor.y }, directRoute)
      : Number.POSITIVE_INFINITY;
    let best: ActorLocalTeleportPlan | null = null;

    for (const exitObject of exits) {
      const entryPoint = this.getLocalTeleportEntryPoint(actor, exitObject);
      if (!entryPoint) continue;

      const firstLeg = this.planWalkingApproach(actor, exitObject);
      if (firstLeg.status === 'unreachable' || !firstLeg.point) continue;
      const probe = this.createActorProbe(actor, entryPoint);
      const finalRoute = probe.previewWalkingRouteTo(target.x, target.y);
      if (!finalRoute) continue;
      const cost =
        routeLength({ x: actor.x, y: actor.y }, firstLeg.route) +
        routeLength(entryPoint, finalRoute);
      if (cost >= directCost || (best && cost >= best.cost)) continue;
      best = { exits: [exitObject], firstLeg, cost };
    }

    return best;
  }

  private getLocalTeleportExits(scene: {
    entities: SceneObject[];
    triggerboxes: SceneObject[];
  }): SceneObject[] {
    return [...scene.entities, ...scene.triggerboxes].filter((object) => {
      const exit = object.components?.find(
        (component: { type: string }) => component.type === 'Exit'
      ) as ExitComponent | undefined;
      return (
        !object.disabled && !!exit && !exit.targetSceneId?.trim() && !!exit.targetEntryId?.trim()
      );
    });
  }

  private sortLocalTeleportExits(actor: Actor, exits: SceneObject[]): SceneObject[] {
    return [...exits].sort((a, b) => {
      const aPoint = this.getObjectCenter(a);
      const bPoint = this.getObjectCenter(b);
      const aDistance = aPoint
        ? (aPoint.x - actor.x) ** 2 + (aPoint.y - actor.y) ** 2
        : Number.POSITIVE_INFINITY;
      const bDistance = bPoint
        ? (bPoint.x - actor.x) ** 2 + (bPoint.y - actor.y) ** 2
        : Number.POSITIVE_INFINITY;
      return aDistance - bDistance;
    });
  }

  private getLocalTeleportEntryPoint(
    actor: Actor,
    exitObject: SceneObject
  ): { x: number; y: number } | null {
    const scene = actor.scene || this.game.sceneManager.currentScene;
    if (!scene) return null;
    const exit = exitObject.components?.find(
      (component: { type: string }) => component.type === 'Exit'
    ) as ExitComponent | undefined;
    if (!exit?.targetEntryId?.trim()) return null;
    const entry = scene.getObjectByName(exit.targetEntryId.trim());
    if (!entry?.components?.some((component: { type: string }) => component.type === 'Entry')) {
      return null;
    }
    const rawEntryPoint = this.getObjectCenter(entry);
    if (!rawEntryPoint) return null;
    const resolveEntryPlacement = this.game.sceneManager.resolveEntryPlacementPosition;
    const entryPoint =
      typeof resolveEntryPlacement === 'function'
        ? resolveEntryPlacement.call(
            this.game.sceneManager,
            scene,
            actor,
            rawEntryPoint.x,
            rawEntryPoint.y
          )
        : rawEntryPoint;
    return scene.isWalkable(entryPoint.x, entryPoint.y, actor) ? entryPoint : null;
  }

  private createActorProbe(actor: Actor, point: { x: number; y: number }): Actor {
    const probe = Object.create(actor) as Actor;
    Object.defineProperty(probe, 'x', { value: point.x, configurable: true });
    Object.defineProperty(probe, 'y', { value: point.y, configurable: true });
    return probe;
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
