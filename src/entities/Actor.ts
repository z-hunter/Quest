import { Entity, type EntityData } from './Entity';
import { Animator } from '../core/Animator';
import { useEditorStore } from '../store/editorStore';
import type { IGame } from '../core/IGame';
import { toWorldPosition } from '../utils/Parallax';
import { Geometry } from '../utils/Geometry';
import type { SceneObject } from './SceneObject';

export type ActorState = 'idle' | 'walk' | 'talk' | 'interact' | string;
export type ActorDirection = 'up' | 'down' | 'left' | 'right';

export type ActorMoveStatus = 'idle' | 'started' | 'arrived' | 'unreachable' | 'blocked';
export type ActorMoveCode =
  | 'idle'
  | 'route_started'
  | 'arrived'
  | 'route_unreachable'
  | 'route_blocked';

export interface ActorMoveResult {
  status: ActorMoveStatus;
  code: ActorMoveCode;
  message: string;
  target: { x: number; y: number } | null;
  route: { x: number; y: number }[];
}

export interface AnimationSet {
  id: string; // e.g. 'idle', 'walk'
  up: string | null; // Sprite Name
  down: string | null;
  left: string | null;
  right: string | null;
}

import { ComponentSystem } from '../systems/ComponentSystem';

// Interfaces for State/Anim are kept here or moved if generic.
// ShadowComponent interface moved to ComponentSystem.

export interface ActorData extends EntityData {
  direction: ActorDirection;
  animSets: Record<string, AnimationSet>;
  perceptionRadius?: number;
}

class MinHeap {
  private readonly values: Array<{ key: string; score: number }> = [];

  get size(): number {
    return this.values.length;
  }

  push(value: { key: string; score: number }): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent].score <= value.score) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }

  pop(): { key: string; score: number } | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last) return first;
    let index = 0;
    while (index * 2 + 1 < this.values.length) {
      let child = index * 2 + 1;
      if (
        child + 1 < this.values.length &&
        this.values[child + 1].score < this.values[child].score
      ) {
        child += 1;
      }
      if (this.values[child].score >= last.score) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

export class Actor extends Entity {
  direction: ActorDirection;
  state: ActorState;

  // Animation Sets
  animSets: Record<string, AnimationSet>;
  overrideAnimSet: string | null;

  speed: number;
  perceptionRadius: number;
  target: { x: number; y: number } | null;
  visualTarget: { x: number; y: number } | null;
  route: { x: number; y: number }[];
  routeIndex: number;
  lastMoveResult: ActorMoveResult;
  readonly type: string = 'Actor';
  private localTeleportTarget: { x: number; y: number } | null = null;
  private localTeleportExit: SceneObject | null = null;
  /** Final intent survives a same-scene Exit placement so its stale route can be rebuilt. */
  private plannedMoveTarget: { x: number; y: number } | null = null;
  /** Increments when a same-scene Exit relocates an in-progress movement. */
  private localTeleportRevision = 0;
  private lastRouteBlockDiagnostic: {
    position: { x: number; y: number };
    attemptedPosition: { x: number; y: number };
    target: { x: number; y: number } | null;
    routeIndex: number;
    routeLength: number;
  } | null = null;

  isPlayer: boolean = false;

  /**
   * List of properties to be serialized to/from JSON.
   * Extends Entity.SERIALIZABLE_PROPS.
   */
  static override SERIALIZABLE_PROPS: string[] = [
    ...Entity.SERIALIZABLE_PROPS,
    'isPlayer',
    'speed',
    'perceptionRadius',
    'direction',
    'animSets',
  ];

  constructor(
    game: IGame,
    x: number,
    y: number,
    width: number = 30,
    height: number = 30,
    name: string = 'Actor'
  ) {
    super(game, x, y, width, height, name);
    this.direction = 'down';
    this.state = 'idle';
    this.speed = 0.1;
    this.perceptionRadius = 600;
    this.target = null;
    this.visualTarget = null;
    this.route = [];
    this.routeIndex = 0;
    this.lastMoveResult = this.createMoveResult('idle', 'idle', null, []);
    this.isPlayer = false;

    this.animSets = {};
    this.overrideAnimSet = null;

    // Actors usually have animators
    this.animator = new Animator(this);
  }

  notifyEditor() {
    // If this object is currently selected in the editor, notify the UI to refresh
    if (this.game && this.game.editor && this.game.editor.selectedObject === this) {
      useEditorStore.getState().incrementObjectVersion();
    }
  }

  setDirection(dir: ActorDirection) {
    if (this.direction === dir) return;
    this.direction = dir;
    this.updateSpriteForState();
    this.notifyEditor();
  }

  playAnimSet(setName: string) {
    if (this.animSets[setName]) {
      this.overrideAnimSet = setName;
      this.updateSpriteForState();
      this.notifyEditor();
    } else {
      console.warn(`[Actor] Animation Set '${setName}' not found on actor '${this.name}'`);
    }
  }

  resetAnimSet() {
    this.overrideAnimSet = null;
    this.updateSpriteForState();
    this.notifyEditor();
  }

  addAnimSet(id: string) {
    if (this.animSets[id]) return;
    this.animSets[id] = { id, up: null, down: null, left: null, right: null };
    this.notifyEditor();
  }

  removeAnimSet(id: string) {
    delete this.animSets[id];
    this.notifyEditor();
  }

  getAnimSet(id: string): AnimationSet | undefined {
    return this.animSets[id];
  }

  walkTo(x: number, y: number): ActorMoveResult {
    // Validation: Check if destination is walkable using the Scene's logic
    if (this.scene && typeof this.scene.isWalkable === 'function') {
      if (!this.scene.isWalkable(x, y, this)) {
        console.warn(`[Actor] walkTo destination ${x},${y} is not walkable.`);
        this.stopWithMoveResult(
          this.createMoveResult('unreachable', 'route_unreachable', { x, y }, [])
        );
        return this.lastMoveResult;
      }
    }
    return this.moveTo(x, y);
  }

  moveTo(x: number, y: number): ActorMoveResult {
    this.lastRouteBlockDiagnostic = null;
    const target = { x, y };
    if (Math.abs(x - this.x) < 1.0 && Math.abs(y - this.y) < 1.0) {
      this.stopWithMoveResult(this.createMoveResult('arrived', 'arrived', target, []));
      return this.lastMoveResult;
    }

    this.plannedMoveTarget = { ...target };
    const isWalkable = (wx: number, wy: number) =>
      !this.scene || typeof this.scene.isWalkable !== 'function'
        ? true
        : this.scene.isWalkable(wx, wy, this);

    let walkingRoute: { x: number; y: number }[] | null = null;
    if (
      isWalkable(target.x, target.y) &&
      this.isRouteSegmentClear({ x: this.x, y: this.y }, target, isWalkable)
    ) {
      walkingRoute = [target];
    }

    const teleportPlan = walkingRoute
      ? null
      : this.game.actorNavigation?.planLocalTeleportRoute?.(this, target, null);

    if (!walkingRoute && !teleportPlan) {
      walkingRoute = this.planWalkingRouteTo(target);
    }
    if (
      teleportPlan?.firstLeg.status === 'already_reachable' &&
      teleportPlan.exits[0] &&
      this.scene
    ) {
      const activated = ComponentSystem.handleActivation(
        teleportPlan.exits[0],
        this.scene,
        0,
        this
      );
      if (activated) {
        const remainingDistance = Math.hypot(target.x - this.x, target.y - this.y);
        if (remainingDistance <= Math.max(2, this.getRouteGridSize() / 2)) {
          this.x = target.x;
          this.y = target.y;
          this.stopWithMoveResult(this.createMoveResult('arrived', 'arrived', target, []));
          return this.lastMoveResult;
        }
        return this.moveTo(target.x, target.y);
      }
    }
    const route = teleportPlan?.firstLeg.route || walkingRoute;

    if (!route) {
      this.stopWithMoveResult(
        this.createMoveResult('unreachable', 'route_unreachable', target, [])
      );
      return this.lastMoveResult;
    }

    this.route = route;
    this.routeIndex = 0;
    this.target = route[0] || target;
    this.visualTarget = null;
    this.localTeleportTarget = teleportPlan ? target : null;
    this.localTeleportExit = teleportPlan?.exits[0] || null;
    this.setState('walk');
    this.overrideAnimSet = null;
    this.lastMoveResult = this.createMoveResult('started', 'route_started', target, route);
    return this.lastMoveResult;
  }

  moveToVisual(x: number, y: number): ActorMoveResult {
    const worldTarget = toWorldPosition(
      { x, y },
      this.scene?.camera || { x: 0, y: 0 },
      this.parallax !== undefined ? this.parallax : 1.0
    );
    this.plannedMoveTarget = { ...worldTarget };
    const route = this.planWalkingRouteTo(worldTarget);

    if (!route) {
      this.stopWithMoveResult(
        this.createMoveResult('unreachable', 'route_unreachable', worldTarget, [])
      );
      return this.lastMoveResult;
    }

    this.route = route;
    this.routeIndex = 0;
    this.target = route[0] || worldTarget;
    this.visualTarget = null;
    this.setState('walk');
    this.overrideAnimSet = null;
    this.lastMoveResult = this.createMoveResult('started', 'route_started', worldTarget, route);
    return this.lastMoveResult;
  }

  /**
   * Starts a route prepared by the navigation worker. The caller has already
   * validated the route against the current Scene; this deliberately avoids
   * re-running synchronous A* in moveTo().
   */
  startPlannedRoute(
    target: { x: number; y: number },
    route: { x: number; y: number }[]
  ): ActorMoveResult {
    if (route.length === 0) {
      this.stopWithMoveResult(this.createMoveResult('arrived', 'arrived', target, []));
      return this.lastMoveResult;
    }
    this.plannedMoveTarget = { ...target };
    this.route = route.map((point) => ({ ...point }));
    this.routeIndex = 0;
    this.target = this.route[0];
    this.visualTarget = null;
    this.localTeleportTarget = null;
    this.localTeleportExit = null;
    this.setState('walk');
    this.overrideAnimSet = null;
    this.lastMoveResult = this.createMoveResult('started', 'route_started', target, this.route);
    return this.lastMoveResult;
  }

  stop(): void {
    this.target = null;
    this.visualTarget = null;
    this.route = [];
    this.routeIndex = 0;
    this.localTeleportTarget = null;
    this.localTeleportExit = null;
    this.plannedMoveTarget = null;
    this.setState('idle');
  }

  /**
   * A same-scene Exit can move an actor many screens away while it is walking.
   * Worker routes are expressed in the pre-teleport coordinate space, so they
   * must never be resumed from the Entry position.
   */
  resumePlannedMovementAfterLocalTeleport(): {
    target: { x: number; y: number };
    previousRouteLength: number;
    result: ActorMoveResult;
  } | null {
    const target = this.plannedMoveTarget;
    if (!target || this.state !== 'walk') return null;

    // If this teleport was NOT part of an intentional teleport plan (e.g., player clicking the floor
    // and accidentally pathing over a teleport), we stop the navigation to avoid bouncing back.
    if (!this.localTeleportTarget) {
      this.stopWithMoveResult(this.createMoveResult('arrived', 'arrived', target, []));
      return null;
    }

    const distanceToTarget = Math.hypot(target.x - this.x, target.y - this.y);
    if (distanceToTarget <= 48 || this.localTeleportRevision >= 3) {
      this.stopWithMoveResult(this.createMoveResult('arrived', 'arrived', target, []));
      return null;
    }

    const previousRouteLength = this.route.length;
    this.localTeleportRevision += 1;
    const result = this.moveTo(target.x, target.y);
    return { target: { ...target }, previousRouteLength, result };
  }

  getLocalTeleportRevision(): number {
    return this.localTeleportRevision;
  }

  getMoveResult(): ActorMoveResult {
    return this.lastMoveResult;
  }

  getRouteBlockDiagnostic(): {
    position: { x: number; y: number };
    attemptedPosition: { x: number; y: number };
    target: { x: number; y: number } | null;
    routeIndex: number;
    routeLength: number;
  } | null {
    if (!this.lastRouteBlockDiagnostic) return null;
    return {
      ...this.lastRouteBlockDiagnostic,
      position: { ...this.lastRouteBlockDiagnostic.position },
      attemptedPosition: { ...this.lastRouteBlockDiagnostic.attemptedPosition },
      target: this.lastRouteBlockDiagnostic.target
        ? { ...this.lastRouteBlockDiagnostic.target }
        : null,
    };
  }

  previewRouteTo(x: number, y: number): { x: number; y: number }[] | null {
    const target = { x, y };
    const walkingRoute = this.planWalkingRouteTo(target);
    const teleportPlan = walkingRoute
      ? null
      : this.game.actorNavigation?.planLocalTeleportRoute?.(this, target, null);
    const route = teleportPlan?.firstLeg.route || walkingRoute;
    return route ? route.map((point) => ({ ...point })) : null;
  }

  previewWalkingRouteTo(x: number, y: number): { x: number; y: number }[] | null {
    const route = this.planWalkingRouteTo({ x, y });
    return route ? route.map((point) => ({ ...point })) : null;
  }

  setState(state: ActorState) {
    if (this.state === state) return;
    this.state = state;
    this.updateSpriteForState();
    this.notifyEditor();
  }

  update(deltaTime: number, isWalkable?: (x: number, y: number) => boolean): void {
    // Call Entity update (handles scaling etc)
    super.update(deltaTime);

    // Update Components
    ComponentSystem.update(this, deltaTime);

    // console.log(`[Actor] update state=${this.state} target=${this.target ? 'YES' : 'NO'} isWalkable=${!!isWalkable}`);

    if (this.isPlayer) {
      this.handlePlayerInput(deltaTime, isWalkable);
    }

    if (this.state === 'walk' && (this.target || this.visualTarget)) {
      const currentTarget = this.visualTarget
        ? toWorldPosition(
            this.visualTarget,
            this.scene?.camera || { x: 0, y: 0 },
            this.parallax !== undefined ? this.parallax : 1.0
          )
        : this.target;

      if (!currentTarget) {
        this.stop();
        return;
      }

      const dx = currentTarget.x - this.x;
      const dy = currentTarget.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const p = this.parallax !== undefined ? this.parallax : 1.0;
      // Scale speed by parallax (dampened: 0.5 input -> 0.6 output)
      const speedScale = 0.2 + 0.8 * p;
      const step = this.speed * speedScale * deltaTime;

      if (dist <= step) {
        this.x = currentTarget.x;
        this.y = currentTarget.y;
        if (this.route.length > 0 && this.routeIndex < this.route.length - 1) {
          this.routeIndex += 1;
          this.target = this.route[this.routeIndex];
        } else {
          const completedTarget = this.visualTarget || this.target;
          const teleportExit = this.localTeleportExit;
          const teleportTarget = this.localTeleportTarget;
          if (teleportExit && teleportTarget && this.scene) {
            this.localTeleportExit = null;
            this.localTeleportTarget = null;
            const activated = ComponentSystem.handleActivation(teleportExit, this.scene, 0, this);
            if (activated) {
              this.moveTo(teleportTarget.x, teleportTarget.y);
              return;
            }
          }
          this.stopWithMoveResult(
            this.createMoveResult('arrived', 'arrived', completedTarget, this.route)
          );
        }
      } else {
        const moveX = (dx / dist) * step;
        const moveY = (dy / dist) * step;
        const nextX = this.x + moveX;
        const nextY = this.y + moveY;

        // Determine Direction
        if (Math.abs(dx) > Math.abs(dy)) {
          this.setDirection(dx > 0 ? 'right' : 'left');
        } else {
          this.setDirection(dy > 0 ? 'down' : 'up');
        }

        if (!isWalkable || isWalkable(nextX, nextY)) {
          this.x = nextX;
          this.y = nextY;
          if (this.overrideAnimSet) this.overrideAnimSet = null;
        } else if (isWalkable && this.trySlideTowardTarget(nextX, nextY, isWalkable)) {
          if (this.overrideAnimSet) this.overrideAnimSet = null;
        } else {
          this.lastRouteBlockDiagnostic = {
            position: { x: this.x, y: this.y },
            attemptedPosition: { x: nextX, y: nextY },
            target: this.target ? { ...this.target } : null,
            routeIndex: this.routeIndex,
            routeLength: this.route.length,
          };
          this.stopWithMoveResult(
            this.createMoveResult('blocked', 'route_blocked', this.target, this.route)
          );
        }
      }
    }

    // Ensure sprite is correct every frame (e.g. if direction changed)
    this.updateSpriteForState();
  }

  handlePlayerInput(deltaTime: number, isWalkable?: (x: number, y: number) => boolean) {
    const game = this.game;
    const input = game?.input;

    // Block input if mouse is over UI
    if (game?.isMouseOverUI) return;

    // Block input if Subscene is active
    if (this.scene && this.scene.activeSubscene) return;

    if (input) {
      // Prevent movement if Control is held (e.g. for Console History)
      if (input.isDown('Control')) return;

      let dx = 0;
      let dy = 0;

      if (input.isDown('ArrowUp')) dy -= 1;
      if (input.isDown('ArrowDown')) dy += 1;
      if (input.isDown('ArrowLeft')) dx -= 1;
      if (input.isDown('ArrowRight')) dx += 1;

      if (dx !== 0 || dy !== 0) {
        const rawDx = dx;
        const rawDy = dy;
        this.target = null;
        this.route = [];
        this.routeIndex = 0;
        this.setState('walk');
        if (this.overrideAnimSet) this.overrideAnimSet = null;

        const perspectiveVector = this.getPerspectiveWalkVector(dx, dy);
        if (perspectiveVector) {
          dx = perspectiveVector.dx;
          dy = perspectiveVector.dy;
        } else {
          const length = Math.sqrt(dx * dx + dy * dy);
          if (length > 0) {
            dx /= length;
            dy /= length;
          }
        }

        const p = this.parallax !== undefined ? this.parallax : 1.0;
        const speedScale = 0.2 + 0.8 * p;
        const moveX = dx * this.speed * speedScale * deltaTime;
        const moveY = dy * this.speed * speedScale * deltaTime;

        const nextX = this.x + moveX;
        const nextY = this.y + moveY;

        // Update Direction
        if (perspectiveVector) {
          if (rawDy !== 0) {
            this.setDirection(rawDy < 0 ? 'up' : 'down');
          } else {
            this.setDirection(rawDx > 0 ? 'right' : 'left');
          }
        } else {
          if (Math.abs(dx) > Math.abs(dy)) {
            this.setDirection(dx > 0 ? 'right' : 'left');
          } else {
            this.setDirection(dy > 0 ? 'down' : 'up');
          }
        }

        if (!isWalkable || isWalkable(nextX, nextY)) {
          this.x = nextX;
          this.y = nextY;
        } else {
          if (isWalkable && isWalkable(nextX, this.y)) {
            this.x = nextX;
          } else if (isWalkable && isWalkable(this.x, nextY)) {
            this.y = nextY;
          }
        }
      } else if (!this.target && !this.visualTarget) {
        this.setState('idle');
      }
    }
  }

  private getPerspectiveWalkVector(
    inputX: number,
    inputY: number
  ): { dx: number; dy: number } | null {
    if (!this.scene || !this.scene.entities) return null;

    const cam = this.scene.camera;

    for (const entity of this.scene.entities) {
      if (entity.disabled) continue;
      if ((entity as any).type !== 'Quad') continue;
      const quad = entity as any;
      if (!quad.vertices || quad.vertices.length < 4) continue;

      const wbComp = quad.components?.find(
        (c: any) =>
          c &&
          (c.type === 'WalkBox' || c.type === 'Walkbox') &&
          (c.perspectiveWalk3D === true || c.threeDPerspectiveWalk === true)
      );
      if (!wbComp) continue;

      const vertices = quad.vertices.map((v: any) => {
        const p = v.p !== undefined ? v.p : quad.parallax || 1.0;
        let vx = v.x;
        let vy = v.y;
        if (cam && p !== 1.0) {
          vx = v.x - cam.x * (p - 1.0);
          vy = v.y - cam.y * (p - 1.0);
        }
        return { x: vx, y: vy };
      });

      const dist = Geometry.getPointToPolygonDistance({ x: this.x, y: this.y }, vertices);
      if (dist < 10.0) {
        return getQuadPerspectiveMovementVector(vertices, this.x, this.y, inputX, inputY);
      }
    }

    return null;
  }

  updateSpriteForState() {
    let setId = this.state;
    if (this.overrideAnimSet) {
      setId = this.overrideAnimSet;
    }

    const animSet = this.animSets[setId];

    if (!animSet) {
      // Fallback to idle if not idle
      if (setId !== 'idle' && this.animSets['idle']) {
        this.applySpriteFromSet(this.animSets['idle']);
      }
      return;
    }

    this.applySpriteFromSet(animSet);
  }

  applySpriteFromSet(set: AnimationSet) {
    if (!set) return;

    let spriteName = set[this.direction];
    let doFlip = false;

    if (spriteName) {
      // 1. Current set has explicit direction
      doFlip = false;
    } else if (this.direction === 'left' && set['right']) {
      // 2. Current set has opposite direction (right -> left)
      spriteName = set['right'];
      doFlip = true;
    } else if (this.direction === 'right' && set['left']) {
      // 2. Current set has opposite direction (left -> right)
      spriteName = set['left'];
      doFlip = true;
    } else if (set.id !== 'idle' && this.animSets['idle']) {
      const idleSet = this.animSets['idle'];
      if (idleSet[this.direction]) {
        // 3. Fallback to idle's explicit direction
        spriteName = idleSet[this.direction];
        doFlip = false;
      } else if (this.direction === 'left' && idleSet['right']) {
        // 4. Fallback to idle's opposite direction (right -> left)
        spriteName = idleSet['right'];
        doFlip = true;
      } else if (this.direction === 'right' && idleSet['left']) {
        // 4. Fallback to idle's opposite direction (left -> right)
        spriteName = idleSet['left'];
        doFlip = true;
      }
    }

    // If still nothing, we might be empty (invisible or red box)

    if (spriteName) {
      this.flipX = doFlip;
      let normalized = spriteName;
      if (!normalized.toLowerCase().endsWith('.json')) normalized += '.json';

      if (
        this.spriteName &&
        (this.spriteName === normalized ||
          this.spriteName.endsWith('/' + normalized) ||
          normalized.endsWith('/' + this.spriteName))
      ) {
        // Match found (loose), skip
      } else if (normalized !== this.spriteName) {
        this.setSprite(spriteName);
      }
    }
  }

  stopAnimation() {
    this.resetAnimSet();
  }

  private createMoveResult(
    status: ActorMoveStatus,
    code: ActorMoveCode,
    target: { x: number; y: number } | null,
    route: { x: number; y: number }[]
  ): ActorMoveResult {
    return {
      status,
      code,
      message: this.getMoveMessage(code),
      target: target ? { ...target } : null,
      route: route.map((point) => ({ ...point })),
    };
  }

  private getMoveMessage(code: ActorMoveCode): string {
    switch (code) {
      case 'route_started':
        return 'Route started.';
      case 'arrived':
        return 'Arrived.';
      case 'route_unreachable':
        return 'Destination is unreachable.';
      case 'route_blocked':
        return 'Route is blocked and should be reconsidered.';
      case 'idle':
      default:
        return 'Idle.';
    }
  }

  private stopWithMoveResult(result: ActorMoveResult): void {
    this.stop();
    this.lastMoveResult = result;
  }

  private planWalkingRouteTo(target: { x: number; y: number }): { x: number; y: number }[] | null {
    const isWalkable = (x: number, y: number) =>
      !this.scene || typeof this.scene.isWalkable !== 'function'
        ? true
        : this.scene.isWalkable(x, y, this);

    if (!isWalkable(target.x, target.y)) return null;
    if (this.isRouteSegmentClear({ x: this.x, y: this.y }, target, isWalkable)) return [target];

    return this.findGridRoute(target, isWalkable);
  }

  private isRouteSegmentClear(
    from: { x: number; y: number },
    to: { x: number; y: number },
    isWalkable: (x: number, y: number) => boolean
  ): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const stepSize = Math.max(2, this.getRouteGridSize() / 2);
    const steps = Math.max(1, Math.ceil(dist / stepSize));

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!isWalkable(from.x + dx * t, from.y + dy * t)) return false;
    }

    return true;
  }

  private getRouteGridSize(): number {
    const colliderSize =
      this.colliderWidth > 0 && this.colliderHeight > 0
        ? Math.min(this.colliderWidth, this.colliderHeight)
        : 12;
    return Math.max(4, Math.min(24, colliderSize));
  }

  private trySlideTowardTarget(
    nextX: number,
    nextY: number,
    isWalkable: (x: number, y: number) => boolean
  ): boolean {
    const canChangeX = Math.abs(nextX - this.x) > 0.0001;
    const canChangeY = Math.abs(nextY - this.y) > 0.0001;
    const canMoveX = canChangeX && isWalkable(nextX, this.y);
    const canMoveY = canChangeY && isWalkable(this.x, nextY);

    if (canMoveX && canMoveY) {
      const target = this.target || { x: nextX, y: nextY };
      const xFirstDistance = this.cellDistance({ x: nextX, y: this.y }, target);
      const yFirstDistance = this.cellDistance({ x: this.x, y: nextY }, target);

      if (xFirstDistance <= yFirstDistance) {
        this.x = nextX;
      } else {
        this.y = nextY;
      }
      return true;
    }

    if (canMoveX) {
      this.x = nextX;
      return true;
    }

    if (canMoveY) {
      this.y = nextY;
      return true;
    }

    return false;
  }

  private findGridRoute(
    target: { x: number; y: number },
    isWalkable: (x: number, y: number) => boolean
  ): { x: number; y: number }[] | null {
    const gridSize = this.getRouteGridSize();
    const start = { x: this.x, y: this.y };
    const bounds = this.getRouteSearchBounds(start, target, gridSize);
    const startCell = this.pointToCell(start, bounds, gridSize);
    const targetCell = this.pointToCell(target, bounds, gridSize);
    const startKey = this.cellKey(startCell);
    const targetKey = this.cellKey(targetCell);
    const heap = new MinHeap();
    const cameFrom = new Map<string, string>();
    const gScore = new Map<string, number>([[startKey, 0]]);
    const cells = new Map<string, { x: number; y: number }>([[startKey, startCell]]);
    const closed = new Set<string>();
    heap.push({ key: startKey, score: this.cellDistance(startCell, targetCell) });
    const directions = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: 1, y: 1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: -1, y: -1 },
    ];
    const maxIterations = Math.min((bounds.cols + 1) * (bounds.rows + 1), 50000);
    let iterations = 0;

    while (heap.size > 0 && iterations < maxIterations) {
      iterations += 1;
      const next = heap.pop();
      if (!next || closed.has(next.key)) continue;
      const currentKey = next.key;
      const current = cells.get(currentKey);
      if (!current) return null;

      if (currentKey === targetKey) {
        return this.smoothRoute(
          this.reconstructRoute(
            cameFrom,
            cells,
            currentKey,
            target,
            bounds,
            gridSize,
            startKey,
            targetKey,
            start
          ),
          isWalkable
        );
      }

      closed.add(currentKey);

      for (const direction of directions) {
        const neighbor = { x: current.x + direction.x, y: current.y + direction.y };
        if (
          neighbor.x < 0 ||
          neighbor.y < 0 ||
          neighbor.x > bounds.cols ||
          neighbor.y > bounds.rows
        ) {
          continue;
        }

        const neighborKey = this.cellKey(neighbor);
        if (closed.has(neighborKey)) continue;

        const point = this.cellToRoutePoint(
          neighbor,
          neighborKey,
          bounds,
          gridSize,
          startKey,
          targetKey,
          start,
          target
        );
        if (!isWalkable(point.x, point.y)) continue;
        if (direction.x !== 0 && direction.y !== 0) {
          const card1 = this.cellToRoutePoint(
            { x: current.x + direction.x, y: current.y },
            '',
            bounds,
            gridSize,
            startKey,
            targetKey,
            start,
            target
          );
          const card2 = this.cellToRoutePoint(
            { x: current.x, y: current.y + direction.y },
            '',
            bounds,
            gridSize,
            startKey,
            targetKey,
            start,
            target
          );
          if (!isWalkable(card1.x, card1.y) || !isWalkable(card2.x, card2.y)) continue;
        }

        const tentativeG =
          (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) +
          this.cellDistance(current, neighbor);

        if (tentativeG < (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
          cameFrom.set(neighborKey, currentKey);
          cells.set(neighborKey, neighbor);
          gScore.set(neighborKey, tentativeG);
          heap.push({
            key: neighborKey,
            score: tentativeG + this.cellDistance(neighbor, targetCell),
          });
        }
      }
    }

    return null;
  }

  private getRouteSearchBounds(
    start: { x: number; y: number },
    target: { x: number; y: number },
    gridSize: number
  ): { minX: number; minY: number; cols: number; rows: number } {
    let minX = Math.min(start.x, target.x);
    let maxX = Math.max(start.x, target.x);
    let minY = Math.min(start.y, target.y);
    let maxY = Math.max(start.y, target.y);

    for (const entity of this.scene?.entities || []) {
      if (entity.disabled) continue;
      minX = Math.min(minX, entity.x - entity.colliderWidth - gridSize);
      maxX = Math.max(maxX, entity.x + entity.colliderWidth + gridSize);
      minY = Math.min(minY, entity.y - entity.colliderHeight - gridSize);
      maxY = Math.max(maxY, entity.y + gridSize);
    }

    for (const walkbox of this.scene?.walkbox || []) {
      if (walkbox.disabled) continue;
      for (const point of walkbox.poly || []) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
    }

    const padding = gridSize * 4;
    minX -= padding;
    maxX += padding;
    minY -= padding;
    maxY += padding;

    return {
      minX,
      minY,
      cols: Math.max(1, Math.ceil((maxX - minX) / gridSize)),
      rows: Math.max(1, Math.ceil((maxY - minY) / gridSize)),
    };
  }

  private pointToCell(
    point: { x: number; y: number },
    bounds: { minX: number; minY: number },
    gridSize: number
  ): { x: number; y: number } {
    return {
      x: Math.round((point.x - bounds.minX) / gridSize),
      y: Math.round((point.y - bounds.minY) / gridSize),
    };
  }

  private cellToPoint(
    cell: { x: number; y: number },
    bounds: { minX: number; minY: number },
    gridSize: number
  ): { x: number; y: number } {
    return {
      x: bounds.minX + cell.x * gridSize,
      y: bounds.minY + cell.y * gridSize,
    };
  }

  private cellToRoutePoint(
    cell: { x: number; y: number },
    key: string,
    bounds: { minX: number; minY: number },
    gridSize: number,
    startKey: string,
    targetKey: string,
    start: { x: number; y: number },
    target: { x: number; y: number }
  ): { x: number; y: number } {
    if (key === startKey) return start;
    if (key === targetKey) return target;
    return this.cellToPoint(cell, bounds, gridSize);
  }

  private cellKey(cell: { x: number; y: number }): string {
    return `${cell.x},${cell.y}`;
  }

  private cellDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private reconstructRoute(
    cameFrom: Map<string, string>,
    cells: Map<string, { x: number; y: number }>,
    currentKey: string,
    target: { x: number; y: number },
    bounds: { minX: number; minY: number },
    gridSize: number,
    startKey: string,
    targetKey: string,
    start: { x: number; y: number }
  ): { x: number; y: number }[] {
    const route: { x: number; y: number }[] = [];
    let key = currentKey;

    const visited = new Set<string>();
    while (cameFrom.has(key)) {
      if (visited.has(key)) break;
      visited.add(key);

      const cell = cells.get(key);
      if (cell) {
        route.unshift(
          this.cellToRoutePoint(cell, key, bounds, gridSize, startKey, targetKey, start, target)
        );
      }
      const nextKey = cameFrom.get(key);
      if (nextKey === undefined || nextKey === key) break;
      key = nextKey;
    }

    if (route.length === 0) return [target];
    route[route.length - 1] = target;
    return route;
  }

  private smoothRoute(
    route: { x: number; y: number }[],
    isWalkable: (x: number, y: number) => boolean
  ): { x: number; y: number }[] {
    if (route.length <= 2) return route;

    const smoothed: { x: number; y: number }[] = [];
    let anchor = { x: this.x, y: this.y };
    let index = 0;

    while (index < route.length) {
      let nextIndex = route.length - 1;
      while (nextIndex > index && !this.isRouteSegmentClear(anchor, route[nextIndex], isWalkable)) {
        nextIndex -= 1;
      }

      smoothed.push(route[nextIndex]);
      anchor = route[nextIndex];
      index = nextIndex + 1;
    }

    return smoothed;
  }

  toJSON() {
    const data = super.toJSON();
    data.type = 'Actor';
    const components = Array.isArray(data.components) ? data.components : [];
    if (!components.some((component: any) => component?.type === 'Actor')) {
      data.components = [{ type: 'Actor' }, ...components];
    }
    return data;
  }

  override load(data: any): void {
    this.startLoading();
    try {
      super.load(data);
      if (data.perceptionRadius === undefined) {
        const legacyNpc = Array.isArray(data.components)
          ? data.components.find((component: any) => component?.type === 'NPC')
          : null;
        if (
          typeof legacyNpc?.perceptionRadius === 'number' &&
          Number.isFinite(legacyNpc.perceptionRadius)
        ) {
          this.perceptionRadius = Math.max(0, legacyNpc.perceptionRadius);
        }
      }
      this.perceptionRadius = Number.isFinite(this.perceptionRadius)
        ? Math.max(0, this.perceptionRadius)
        : 600;
      for (const component of this.components || []) {
        if (component?.type === 'NPC' && 'perceptionRadius' in component) {
          delete (component as any).perceptionRadius;
        }
      }
      // Initial sprite update based on loaded state/direction
      this.updateSpriteForState();
    } finally {
      this.endLoading();
    }
  }

  static override fromJSON(game: IGame, data: ActorData): Actor {
    const actor = new Actor(game, data.x, data.y, data.width, data.height, data.name);
    actor.load(data);
    return actor;
  }
}

export function getQuadPerspectiveMovementVector(
  quadVertices: Array<{ x: number; y: number }>,
  px: number,
  py: number,
  inputX: number,
  inputY: number
): { dx: number; dy: number } | null {
  if (quadVertices.length < 4) return null;

  const v0 = quadVertices[0]; // Top-Left
  const v1 = quadVertices[1]; // Top-Right
  const v2 = quadVertices[2]; // Bottom-Right
  const v3 = quadVertices[3]; // Bottom-Left

  // Calculate distance from point P to Left edge (v0 -> v3) and Right edge (v1 -> v2)
  const dL = Geometry.getPointToSegmentDistance({ x: px, y: py }, v0, v3);
  const dR = Geometry.getPointToSegmentDistance({ x: px, y: py }, v1, v2);

  const totalHorizontalDist = dL + dR;
  const u = totalHorizontalDist > 0.0001 ? Math.max(0, Math.min(1, dL / totalHorizontalDist)) : 0.5;

  // Top point at ratio u (on top edge v0 -> v1)
  const TopU = {
    x: (1 - u) * v0.x + u * v1.x,
    y: (1 - u) * v0.y + u * v1.y,
  };

  // Bottom point at ratio u (on bottom edge v3 -> v2)
  const BottomU = {
    x: (1 - u) * v3.x + u * v2.x,
    y: (1 - u) * v3.y + u * v2.y,
  };

  // Up vector (from BottomU to TopU)
  let upX = TopU.x - BottomU.x;
  let upY = TopU.y - BottomU.y;
  const upLen = Math.hypot(upX, upY);
  if (upLen > 0.0001) {
    upX /= upLen;
    upY /= upLen;
  } else {
    upX = 0;
    upY = -1;
  }

  // Calculate distance from point P to Top edge (v0 -> v1) and Bottom edge (v3 -> v2)
  const dT = Geometry.getPointToSegmentDistance({ x: px, y: py }, v0, v1);
  const dB = Geometry.getPointToSegmentDistance({ x: px, y: py }, v3, v2);

  const totalVerticalDist = dT + dB;
  const v = totalVerticalDist > 0.0001 ? Math.max(0, Math.min(1, dT / totalVerticalDist)) : 0.5;

  // Left point at ratio v (on left edge v0 -> v3)
  const LeftV = {
    x: (1 - v) * v0.x + v * v3.x,
    y: (1 - v) * v0.y + v * v3.y,
  };

  // Right point at ratio v (on right edge v1 -> v2)
  const RightV = {
    x: (1 - v) * v1.x + v * v2.x,
    y: (1 - v) * v1.y + v * v2.y,
  };

  // Right vector (from LeftV to RightV)
  let rightX = RightV.x - LeftV.x;
  let rightY = RightV.y - LeftV.y;
  const rightLen = Math.hypot(rightX, rightY);
  if (rightLen > 0.0001) {
    rightX /= rightLen;
    rightY /= rightLen;
  } else {
    rightX = 1;
    rightY = 0;
  }

  // Input direction: inputY is -1 for UP, +1 for DOWN
  // Movement vector = inputX * RightVector - inputY * UpVector
  let dx = inputX * rightX - inputY * upX;
  let dy = inputX * rightY - inputY * upY;

  const len = Math.hypot(dx, dy);
  if (len > 0.0001) {
    dx /= len;
    dy /= len;
  }

  return { dx, dy };
}
