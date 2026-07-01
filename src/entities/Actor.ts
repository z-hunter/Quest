import { Entity, type EntityData } from './Entity';
import { Animator } from '../core/Animator';
import { useEditorStore } from '../store/editorStore';
import type { IGame } from '../core/IGame';
import { toWorldPosition } from '../utils/Parallax';

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
}

export class Actor extends Entity {
  direction: ActorDirection;
  state: ActorState;

  // Animation Sets
  animSets: Record<string, AnimationSet>;
  overrideAnimSet: string | null;

  speed: number;
  target: { x: number; y: number } | null;
  visualTarget: { x: number; y: number } | null;
  route: { x: number; y: number }[];
  routeIndex: number;
  lastMoveResult: ActorMoveResult;
  readonly type: string = 'Actor';

  isPlayer: boolean = false;

  /**
   * List of properties to be serialized to/from JSON.
   * Extends Entity.SERIALIZABLE_PROPS.
   */
  static override SERIALIZABLE_PROPS: string[] = [
    ...Entity.SERIALIZABLE_PROPS,
    'isPlayer',
    'speed',
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
    const target = { x, y };
    const route = this.planRouteTo(target);

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
    const route = this.planRouteTo(worldTarget);

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

  stop(): void {
    this.target = null;
    this.visualTarget = null;
    this.route = [];
    this.routeIndex = 0;
    this.setState('idle');
  }

  getMoveResult(): ActorMoveResult {
    return this.lastMoveResult;
  }

  previewRouteTo(x: number, y: number): { x: number; y: number }[] | null {
    const route = this.planRouteTo({ x, y });
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
        this.target = null;
        this.route = [];
        this.routeIndex = 0;
        this.setState('walk');
        if (this.overrideAnimSet) this.overrideAnimSet = null;

        const length = Math.sqrt(dx * dx + dy * dy);
        if (length > 0) {
          dx /= length;
          dy /= length;
        }

        const p = this.parallax !== undefined ? this.parallax : 1.0;
        const speedScale = 0.2 + 0.8 * p;
        const moveX = dx * this.speed * speedScale * deltaTime;
        const moveY = dy * this.speed * speedScale * deltaTime;

        const nextX = this.x + moveX;
        const nextY = this.y + moveY;

        // Update Direction
        if (Math.abs(dx) > Math.abs(dy)) {
          this.setDirection(dx > 0 ? 'right' : 'left');
        } else {
          this.setDirection(dy > 0 ? 'down' : 'up');
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

  private planRouteTo(target: { x: number; y: number }): { x: number; y: number }[] | null {
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
    const open = new Set<string>([startKey]);
    const cameFrom = new Map<string, string>();
    const gScore = new Map<string, number>([[startKey, 0]]);
    const fScore = new Map<string, number>([[startKey, this.cellDistance(startCell, targetCell)]]);
    const cells = new Map<string, { x: number; y: number }>([[startKey, startCell]]);
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
    const maxIterations = (bounds.cols + 1) * (bounds.rows + 1);
    let iterations = 0;

    while (open.size > 0 && iterations < maxIterations) {
      iterations += 1;
      const currentKey = this.getBestOpenCell(open, fScore);
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

      open.delete(currentKey);

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
        const currentPoint = this.cellToRoutePoint(
          current,
          currentKey,
          bounds,
          gridSize,
          startKey,
          targetKey,
          start,
          target
        );
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
        if (!this.isRouteSegmentClear(currentPoint, point, isWalkable)) continue;

        const tentativeG =
          (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) +
          this.cellDistance(current, neighbor);

        if (tentativeG < (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
          cameFrom.set(neighborKey, currentKey);
          cells.set(neighborKey, neighbor);
          gScore.set(neighborKey, tentativeG);
          fScore.set(neighborKey, tentativeG + this.cellDistance(neighbor, targetCell));
          open.add(neighborKey);
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

  private getBestOpenCell(open: Set<string>, fScore: Map<string, number>): string {
    let best = '';
    let bestScore = Number.POSITIVE_INFINITY;

    for (const key of open) {
      const score = fScore.get(key) ?? Number.POSITIVE_INFINITY;
      if (score < bestScore) {
        best = key;
        bestScore = score;
      }
    }

    return best;
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
