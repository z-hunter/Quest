import type { IGame } from '../core/IGame';
import { Actor, type ActorMoveResult } from '../entities/Actor';
import type { SceneObject } from '../entities/SceneObject';
import { getInactiveSubsceneAncestors } from '../scene/SceneTextLayer';
import { ComponentSystem } from './ComponentSystem';
import type { ExitComponent } from './ComponentSystem';
import { traceNavigation } from './navigation/navigationDebug';
import type {
  NavigationActorProfile,
  NavigationPlanRequest,
  NavigationPlanResult,
  NavigationRect,
  NavigationSnapshot,
  NavigationWalkbox,
} from './navigation/navigationPlanner';

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

export type NpcApproachResult = {
  plan: ActorApproachPlan;
  route?: { x: number; y: number }[];
  source: 'worker' | 'fallback';
};

export type NavigationDiagnostics = {
  queueDepth: number;
  active: boolean;
  snapshotHits: number;
  snapshotMisses: number;
  staleResults: number;
  retries: number;
  fallbacks: number;
  workerTimeouts: number;
  workerDurationMs: number;
};

export type NpcNavigationWorkerFactory = () => Worker;

type QueuedNpcApproach = {
  actor: Actor;
  target: SceneObject;
  request: NavigationPlanRequest;
  callback: (result: NpcApproachResult) => void;
};

const NPC_WORKER_TIMEOUT_MS = 1_500;

export class ActorNavigationService {
  private readonly game: IGame;
  private readonly npcWorkerFactory?: NpcNavigationWorkerFactory;
  private readonly pendingTeleportPlans = new WeakMap<
    Actor,
    { target: { x: number; y: number }; plan: ActorLocalTeleportPlan }
  >();
  private npcWorker: Worker | null | undefined;
  private npcRequestId = 0;
  private npcQueue: QueuedNpcApproach[] = [];
  private npcActive: QueuedNpcApproach | null = null;
  private npcWorkerTimeout: ReturnType<typeof globalThis.setTimeout> | null = null;
  private npcWorkerStartedAt: number | null = null;
  private snapshotFingerprint = '';
  private snapshotRevision = 0;
  private snapshot: NavigationSnapshot | null = null;
  private readonly sentSnapshotRevisions = new Set<number>();
  private readonly diagnostics: NavigationDiagnostics = {
    queueDepth: 0,
    active: false,
    snapshotHits: 0,
    snapshotMisses: 0,
    staleResults: 0,
    retries: 0,
    fallbacks: 0,
    workerTimeouts: 0,
    workerDurationMs: 0,
  };

  constructor(game: IGame, npcWorkerFactory?: NpcNavigationWorkerFactory) {
    this.game = game;
    this.npcWorkerFactory = npcWorkerFactory;
  }

  getNavigationDiagnostics(): NavigationDiagnostics {
    return { ...this.diagnostics, queueDepth: this.npcQueue.length, active: !!this.npcActive };
  }

  getNavigationSnapshotRevision(scene: {
    id: string;
    walkbox: Array<{ disabled?: boolean; mode?: string; poly?: Array<{ x: number; y: number }> }>;
    entities: SceneObject[];
  }): number {
    return this.getNavigationSnapshot(scene).revision;
  }

  cancelNpcApproach(actor: Actor): void {
    this.npcQueue = this.npcQueue.filter((entry) => entry.actor !== actor);
  }

  requestNpcApproach(
    actor: Actor,
    target: SceneObject,
    callback: (result: NpcApproachResult) => void
  ): void {
    const scene = actor.scene || this.game.sceneManager.currentScene;
    const worker = this.getNpcWorker();
    if (!scene || !worker) {
      this.deferFallback(actor, target, callback);
      return;
    }
    const snapshot = this.getNavigationSnapshot(scene);
    const reference = this.getObjectCenter(this.getApproachTarget(target));
    if (!reference) {
      this.deferFallback(actor, target, callback);
      return;
    }
    const request: NavigationPlanRequest = {
      requestId: ++this.npcRequestId,
      sceneId: scene.id,
      revision: snapshot.revision,
      actor: this.getActorProfile(actor),
      target: reference,
      interactionRadius: this.getInteractionRange(actor, target) * 2,
      dynamicBlockers: this.getDynamicBlockers(scene, actor),
    };
    this.npcQueue.push({ actor, target, request, callback });
    this.diagnostics.queueDepth = this.npcQueue.length;
    this.pumpNpcQueue();
  }

  private deferFallback(
    actor: Actor,
    target: SceneObject,
    callback: (result: NpcApproachResult) => void
  ): void {
    this.diagnostics.fallbacks += 1;
    callback({ plan: this.planApproach(actor, target), source: 'fallback' });
  }

  private getNpcWorker(): Worker | null {
    if (this.npcWorker !== undefined) return this.npcWorker;
    if (!this.npcWorkerFactory && typeof Worker === 'undefined') {
      this.npcWorker = null;
      return null;
    }
    try {
      const worker = this.npcWorkerFactory
        ? this.npcWorkerFactory()
        : new Worker(new URL('./navigation/navigation.worker.ts', import.meta.url), {
            type: 'module',
          });
      worker.onmessage = (
        event: MessageEvent<NavigationPlanResult & { missingSnapshot?: boolean }>
      ) => this.handleNpcWorkerResult(event.data);
      worker.onerror = () => {
        if (this.npcWorker !== worker) return;
        worker.terminate();
        this.npcWorker = null;
        this.clearNpcWorkerTimeout();
        const active = this.npcActive;
        this.npcActive = null;
        if (active) this.deferFallback(active.actor, active.target, active.callback);
        this.pumpNpcQueue();
      };
      this.npcWorker = worker;
      return worker;
    } catch {
      this.npcWorker = null;
      return null;
    }
  }

  private pumpNpcQueue(): void {
    if (this.npcActive || this.npcQueue.length === 0) return;
    const worker = this.getNpcWorker();
    const next = this.npcQueue.shift();
    this.diagnostics.queueDepth = this.npcQueue.length;
    if (!next) return;
    if (!worker) {
      this.deferFallback(next.actor, next.target, next.callback);
      this.pumpNpcQueue();
      return;
    }
    this.npcActive = next;
    this.diagnostics.active = true;
    const snapshot = this.snapshot;
    if (!snapshot || snapshot.revision !== next.request.revision) {
      this.npcActive = null;
      this.deferFallback(next.actor, next.target, next.callback);
      this.pumpNpcQueue();
      return;
    }
    if (!this.sentSnapshotRevisions.has(snapshot.revision)) {
      worker.postMessage({ type: 'snapshot', snapshot });
      this.sentSnapshotRevisions.add(snapshot.revision);
    }
    worker.postMessage({ type: 'plan', request: next.request });
    this.startNpcWorkerTimeout(next);
  }

  private startNpcWorkerTimeout(active: QueuedNpcApproach): void {
    this.clearNpcWorkerTimeout();
    this.npcWorkerStartedAt = Date.now();
    this.npcWorkerTimeout = globalThis.setTimeout(() => {
      if (this.npcActive?.request.requestId !== active.request.requestId) return;

      const elapsedMs = Date.now() - (this.npcWorkerStartedAt || Date.now());
      this.clearNpcWorkerTimeout();
      this.npcActive = null;
      this.diagnostics.active = false;
      this.diagnostics.workerTimeouts += 1;
      traceNavigation(this.game, 'navigation_worker_timeout', {
        actorId: active.actor.name,
        sceneId: active.request.sceneId,
        targetId: active.target.name,
        requestId: active.request.requestId,
        timeoutMs: NPC_WORKER_TIMEOUT_MS,
        elapsedMs,
      });

      // A worker occupied by a stuck route search cannot service the FIFO queue.
      // Replace it so later NPC routes are not stranded behind this request.
      this.npcWorker?.terminate();
      this.npcWorker = undefined;
      this.sentSnapshotRevisions.clear();
      this.deferFallback(active.actor, active.target, active.callback);
      this.pumpNpcQueue();
    }, NPC_WORKER_TIMEOUT_MS);
  }

  private clearNpcWorkerTimeout(): void {
    if (this.npcWorkerTimeout !== null) {
      globalThis.clearTimeout(this.npcWorkerTimeout);
      this.npcWorkerTimeout = null;
    }
    this.npcWorkerStartedAt = null;
  }

  private handleNpcWorkerResult(
    result: NavigationPlanResult & { missingSnapshot?: boolean }
  ): void {
    const active = this.npcActive;
    if (!active || active.request.requestId !== result.requestId) return;
    this.clearNpcWorkerTimeout();
    this.npcActive = null;
    this.diagnostics.active = false;
    this.diagnostics.workerDurationMs = result.durationMs;
    traceNavigation(this.game, 'navigation_worker_result', {
      actorId: active.actor.name,
      targetId: active.target.name,
      requestId: result.requestId,
      durationMs: result.durationMs,
      bitmapBuilt: result.bitmapBuilt,
      adaptiveUsed: result.adaptiveUsed,
      adaptiveFallback: result.adaptiveFallback,
      iterationsCount: result.iterationsCount,
      routeLength: result.route?.length ?? 0,
    });
    const scene = active.actor.scene || this.game.sceneManager.currentScene;
    const stale =
      result.missingSnapshot ||
      !scene ||
      scene.id !== result.sceneId ||
      this.getNavigationSnapshot(scene).revision !== result.revision;
    if (stale) {
      this.diagnostics.staleResults += 1;
      this.diagnostics.retries += 1;
      this.requestNpcApproach(active.actor, active.target, active.callback);
      this.pumpNpcQueue();
      return;
    }
    if (
      result.point &&
      this.isWorkerPlanValid(active.actor, active.target, result.point, result.route)
    ) {
      active.callback({
        plan: { status: 'route_available', point: result.point, route: result.route },
        route: result.route,
        source: 'worker',
      });
    } else {
      this.deferFallback(active.actor, active.target, active.callback);
    }
    this.pumpNpcQueue();
  }

  private isWorkerPlanValid(
    actor: Actor,
    target: SceneObject,
    point: { x: number; y: number },
    route: { x: number; y: number }[]
  ): boolean {
    const scene = actor.scene || this.game.sceneManager.currentScene;
    if (
      !scene ||
      route.length === 0 ||
      !route.every((routePoint) => scene.isWalkable(routePoint.x, routePoint.y, actor))
    ) {
      return false;
    }
    return !ComponentSystem.getInteractionDistanceError(
      target as any,
      this.createActorProbe(actor, point)
    );
  }

  private getActorProfile(actor: Actor): NavigationActorProfile {
    return {
      x: actor.x,
      y: actor.y,
      width: actor.width,
      height: actor.height,
      colliderWidth: actor.colliderWidth,
      colliderHeight: actor.colliderHeight,
    };
  }

  private getNavigationSnapshot(scene: {
    id: string;
    walkbox: Array<{ disabled?: boolean; mode?: string; poly?: Array<{ x: number; y: number }> }>;
    entities: SceneObject[];
  }): NavigationSnapshot {
    const walkboxes: NavigationWalkbox[] = [
      ...(scene.walkbox || [])
        .filter((walkbox) => !walkbox.disabled)
        .map((walkbox) => {
          const mode: NavigationWalkbox['mode'] =
            walkbox.mode === 'Subtract' || walkbox.mode === 'Add' ? walkbox.mode : 'Invert';
          return { mode, poly: (walkbox.poly || []).map((point) => ({ x: point.x, y: point.y })) };
        }),
      ...scene.entities.flatMap((entity) => {
        const component = entity.components?.find(
          (candidate: { type?: string }) => candidate.type === 'WalkBox'
        ) as { mode?: string } | undefined;
        const vertices = (entity as unknown as { vertices?: Array<{ x: number; y: number }> })
          .vertices;
        if (entity.disabled || !component || !vertices?.length) return [];
        const mode: NavigationWalkbox['mode'] =
          component.mode === 'Subtract' || component.mode === 'Add' ? component.mode : 'Invert';
        return [{ mode, poly: vertices.map((point) => ({ x: point.x, y: point.y })) }];
      }),
    ];
    const staticBlockers = scene.entities
      .filter((entity) => {
        const record = entity as unknown as { colliderWidth?: number; colliderHeight?: number };
        return (
          !(entity instanceof Actor) &&
          !entity.disabled &&
          (record.colliderWidth || 0) > 0 &&
          (record.colliderHeight || 0) > 0
        );
      })
      .map((entity) => this.getEntityRect(entity));
    const fingerprint = JSON.stringify({ sceneId: scene.id, walkboxes, staticBlockers });
    if (this.snapshot && this.snapshotFingerprint === fingerprint) {
      this.diagnostics.snapshotHits += 1;
      return this.snapshot;
    }
    this.diagnostics.snapshotMisses += 1;
    this.snapshotFingerprint = fingerprint;
    const nextSnapshot: NavigationSnapshot = {
      sceneId: scene.id,
      revision: ++this.snapshotRevision,
      walkboxes,
      staticBlockers,
    };
    this.snapshot = nextSnapshot;
    return nextSnapshot;
  }

  private getDynamicBlockers(scene: { entities: SceneObject[] }, actor: Actor): NavigationRect[] {
    return scene.entities
      .filter((entity) => {
        const record = entity as unknown as { colliderWidth?: number; colliderHeight?: number };
        return (
          entity instanceof Actor &&
          entity !== actor &&
          !entity.disabled &&
          (record.colliderWidth || 0) > 0 &&
          (record.colliderHeight || 0) > 0
        );
      })
      .map((entity) => this.getEntityRect(entity));
  }

  private getEntityRect(entity: SceneObject): NavigationRect {
    const record = entity as unknown as {
      x: number;
      y: number;
      colliderWidth: number;
      colliderHeight: number;
    };
    return {
      x: record.x - record.colliderWidth / 2,
      y: record.y - record.colliderHeight,
      w: record.colliderWidth,
      h: record.colliderHeight,
    };
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

    // Context/perception construction must never run the legacy synchronous A*
    // preview. A non-reachable, positioned target is therefore only a potential
    // route; ActorPlanExecutor asks requestNpcApproach (the worker path) for the
    // exact answer when an NPC actually chooses MOVE_TO.
    return 'route_available';
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

      const minPossibleCost =
        Math.hypot(exitObject.x - actor.x, exitObject.y - actor.y) +
        Math.hypot(target.x - entryPoint.x, target.y - entryPoint.y);
      if (best && minPossibleCost >= best.cost) continue;
      if (minPossibleCost >= directCost) continue;

      const firstLeg = this.planWalkingApproach(actor, exitObject);
      if (firstLeg.status === 'unreachable' || !firstLeg.point) continue;
      const probe = this.createActorProbe(actor, entryPoint);
      const distanceFromEntryToTarget = Math.hypot(
        target.x - entryPoint.x,
        target.y - entryPoint.y
      );
      const finalRoute =
        distanceFromEntryToTarget <= 64
          ? [target]
          : probe.previewWalkingRouteTo(target.x, target.y);
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
