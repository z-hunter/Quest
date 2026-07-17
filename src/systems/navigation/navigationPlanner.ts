import { Geometry } from '../../utils/Geometry';

export type NavigationPoint = { x: number; y: number };

export type NavigationWalkbox = {
  mode: 'Add' | 'Subtract' | 'Invert';
  poly: NavigationPoint[];
};

export type NavigationRect = { x: number; y: number; w: number; h: number };

export type NavigationSnapshot = {
  sceneId: string;
  revision: number;
  walkboxes: NavigationWalkbox[];
  staticBlockers: NavigationRect[];
};

export type NavigationActorProfile = {
  x: number;
  y: number;
  width: number;
  height: number;
  colliderWidth: number;
  colliderHeight: number;
};

export type NavigationPlanRequest = {
  requestId: number;
  sceneId: string;
  revision: number;
  actor: NavigationActorProfile;
  target: NavigationPoint;
  interactionRadius: number;
  dynamicBlockers: NavigationRect[];
};

export type NavigationPlanResult = {
  requestId: number;
  sceneId: string;
  revision: number;
  point: NavigationPoint | null;
  route: NavigationPoint[];
  durationMs: number;
};

type Cell = { x: number; y: number };

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

function gridSize(actor: NavigationActorProfile): number {
  const collider =
    actor.colliderWidth > 0 && actor.colliderHeight > 0
      ? Math.min(actor.colliderWidth, actor.colliderHeight)
      : 12;
  return Math.max(4, Math.min(24, collider));
}

function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

function distance(a: Cell, b: Cell): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sourceRect(point: NavigationPoint, actor: NavigationActorProfile): NavigationRect | null {
  if (actor.colliderWidth <= 0 || actor.colliderHeight <= 0) return null;
  return {
    x: point.x - actor.colliderWidth / 2,
    y: point.y - actor.colliderHeight,
    w: actor.colliderWidth,
    h: actor.colliderHeight,
  };
}

export function isSnapshotWalkable(
  snapshot: NavigationSnapshot,
  point: NavigationPoint,
  actor: NavigationActorProfile,
  dynamicBlockers: NavigationRect[] = []
): boolean {
  const rect = sourceRect(point, actor);
  if (rect) {
    for (const blocker of [...snapshot.staticBlockers, ...dynamicBlockers]) {
      if (Geometry.rectIntersectsRect(rect, blocker)) return false;
    }
  }
  if (snapshot.walkboxes.length === 0) return true;
  if (!rect) {
    for (const walkbox of snapshot.walkboxes) {
      if (
        walkbox.mode === 'Subtract' &&
        Geometry.isPointInPolygonWithEpsilon(point, walkbox.poly)
      ) {
        return false;
      }
    }
    const adds = snapshot.walkboxes.filter((walkbox) => walkbox.mode === 'Add');
    if (adds.some((walkbox) => Geometry.isPointInPolygonWithEpsilon(point, walkbox.poly)))
      return true;
    const invertCount = snapshot.walkboxes.filter(
      (walkbox) =>
        walkbox.mode === 'Invert' && Geometry.isPointInPolygonWithEpsilon(point, walkbox.poly)
    ).length;
    return invertCount % 2 === 1;
  }
  for (const walkbox of snapshot.walkboxes) {
    if (walkbox.mode === 'Subtract' && Geometry.rectIntersectsPolygon(rect, walkbox.poly))
      return false;
  }
  const positives = snapshot.walkboxes.filter(
    (walkbox) => walkbox.mode === 'Add' || walkbox.mode === 'Invert'
  );
  return (
    positives.length === 0 ||
    positives.some((walkbox) => Geometry.rectInsidePolygon(rect, walkbox.poly))
  );
}

function boundsFor(
  snapshot: NavigationSnapshot,
  actor: NavigationActorProfile,
  target: NavigationPoint,
  size: number
): { minX: number; minY: number; cols: number; rows: number } {
  const points = [
    { x: actor.x, y: actor.y },
    target,
    ...snapshot.walkboxes.flatMap((walkbox) => walkbox.poly),
    ...snapshot.staticBlockers.flatMap((rect) => [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.w, y: rect.y + rect.h },
    ]),
  ];
  let minX = Math.min(...points.map((point) => point.x)) - size * 4;
  let maxX = Math.max(...points.map((point) => point.x)) + size * 4;
  let minY = Math.min(...points.map((point) => point.y)) - size * 4;
  let maxY = Math.max(...points.map((point) => point.y)) + size * 4;
  // Keep malformed/empty snapshots bounded to the requested route.
  if (!Number.isFinite(minX + maxX + minY + maxY)) {
    minX = Math.min(actor.x, target.x) - size * 4;
    maxX = Math.max(actor.x, target.x) + size * 4;
    minY = Math.min(actor.y, target.y) - size * 4;
    maxY = Math.max(actor.y, target.y) + size * 4;
  }
  return {
    minX,
    minY,
    cols: Math.max(1, Math.ceil((maxX - minX) / size)),
    rows: Math.max(1, Math.ceil((maxY - minY) / size)),
  };
}

function routeFor(
  snapshot: NavigationSnapshot,
  actor: NavigationActorProfile,
  target: NavigationPoint,
  dynamicBlockers: NavigationRect[]
): NavigationPoint[] | null {
  if (!isSnapshotWalkable(snapshot, target, actor, dynamicBlockers)) return null;
  const size = gridSize(actor);
  const bounds = boundsFor(snapshot, actor, target, size);
  const toCell = (point: NavigationPoint): Cell => ({
    x: Math.round((point.x - bounds.minX) / size),
    y: Math.round((point.y - bounds.minY) / size),
  });
  const toPoint = (cell: Cell): NavigationPoint => ({
    x: bounds.minX + cell.x * size,
    y: bounds.minY + cell.y * size,
  });
  const start = toCell(actor);
  const finish = toCell(target);
  const startKey = cellKey(start);
  const targetKey = cellKey(finish);
  const heap = new MinHeap();
  const cameFrom = new Map<string, string>();
  const cells = new Map<string, Cell>([[startKey, start]]);
  const gScore = new Map<string, number>([[startKey, 0]]);
  const closed = new Set<string>();
  heap.push({ key: startKey, score: distance(start, finish) });
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
  for (let iterations = 0; heap.size > 0 && iterations < maxIterations; iterations += 1) {
    const next = heap.pop();
    if (!next || closed.has(next.key)) continue;
    const current = cells.get(next.key);
    if (!current) continue;
    if (next.key === targetKey) {
      const route: NavigationPoint[] = [];
      let key = next.key;
      while (key !== startKey) {
        const cell = cells.get(key);
        if (!cell) return null;
        route.unshift(key === targetKey ? target : toPoint(cell));
        const previous = cameFrom.get(key);
        if (!previous) return null;
        key = previous;
      }
      return route.length ? route : [target];
    }
    closed.add(next.key);
    for (const direction of directions) {
      const neighbor = { x: current.x + direction.x, y: current.y + direction.y };
      if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x > bounds.cols || neighbor.y > bounds.rows)
        continue;
      const key = cellKey(neighbor);
      if (closed.has(key)) continue;
      const point = key === targetKey ? target : toPoint(neighbor);
      if (!isSnapshotWalkable(snapshot, point, actor, dynamicBlockers)) continue;
      const tentative =
        (gScore.get(next.key) ?? Number.POSITIVE_INFINITY) + distance(current, neighbor);
      if (tentative >= (gScore.get(key) ?? Number.POSITIVE_INFINITY)) continue;
      cameFrom.set(key, next.key);
      cells.set(key, neighbor);
      gScore.set(key, tentative);
      heap.push({ key, score: tentative + distance(neighbor, finish) });
    }
  }
  return null;
}

export function planSnapshotApproach(
  snapshot: NavigationSnapshot,
  request: NavigationPlanRequest
): NavigationPlanResult {
  const startedAt = performance.now();
  const radius = Math.max(32, request.interactionRadius);
  const steps = [16, 4];
  let best: {
    point: NavigationPoint;
    route: NavigationPoint[];
    targetDistance: number;
    actorDistance: number;
  } | null = null;
  for (const step of steps) {
    for (let r = 0; r <= radius; r += step) {
      for (let dx = -r; dx <= r; dx += step) {
        for (let dy = -r; dy <= r; dy += step) {
          if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const point = { x: request.target.x + dx, y: request.target.y + dy };
          const targetDistance = Math.hypot(dx, dy);
          if (targetDistance > radius) continue;
          const route = routeFor(snapshot, request.actor, point, request.dynamicBlockers);
          if (!route) continue;
          const actorDistance = Math.hypot(point.x - request.actor.x, point.y - request.actor.y);
          if (
            !best ||
            targetDistance < best.targetDistance ||
            (targetDistance === best.targetDistance && actorDistance < best.actorDistance)
          ) {
            best = { point, route, targetDistance, actorDistance };
          }
        }
      }
      if (best) break;
    }
    if (best) break;
  }
  const selected = best as {
    point: NavigationPoint;
    route: NavigationPoint[];
    targetDistance: number;
    actorDistance: number;
  } | null;
  return {
    requestId: request.requestId,
    sceneId: request.sceneId,
    revision: request.revision,
    point: selected?.point || null,
    route: selected?.route || [],
    durationMs: performance.now() - startedAt,
  };
}
