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
  bitmapBuilt?: boolean;
  adaptiveUsed?: boolean;
  adaptiveFallback?: boolean;
  iterationsCount?: number;
};

export type WalkabilityBitmap = {
  revision: number;
  actorKey: string;
  minX: number;
  minY: number;
  cols: number;
  rows: number;
  size: number;
  bitmap: Uint8Array;
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
  size: number,
  radiusPadding = 0
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
  let minX = Math.min(...points.map((point) => point.x), target.x - radiusPadding) - size * 4;
  let maxX = Math.max(...points.map((point) => point.x), target.x + radiusPadding) + size * 4;
  let minY = Math.min(...points.map((point) => point.y), target.y - radiusPadding) - size * 4;
  let maxY = Math.max(...points.map((point) => point.y), target.y + radiusPadding) + size * 4;
  // Keep malformed/empty snapshots bounded to the requested route.
  if (!Number.isFinite(minX + maxX + minY + maxY)) {
    minX = Math.min(actor.x, target.x - radiusPadding) - size * 4;
    maxX = Math.max(actor.x, target.x + radiusPadding) + size * 4;
    minY = Math.min(actor.y, target.y - radiusPadding) - size * 4;
    maxY = Math.max(actor.y, target.y + radiusPadding) + size * 4;
  }
  return {
    minX,
    minY,
    cols: Math.max(1, Math.ceil((maxX - minX) / size)),
    rows: Math.max(1, Math.ceil((maxY - minY) / size)),
  };
}

export function buildWalkabilityBitmap(
  snapshot: NavigationSnapshot,
  actor: NavigationActorProfile,
  target: NavigationPoint,
  radiusPadding = 0,
  sizeOverride?: number
): WalkabilityBitmap {
  const size = sizeOverride ?? gridSize(actor);
  const bounds = boundsFor(snapshot, actor, target, size, radiusPadding);
  const bitmap = new Uint8Array(bounds.cols * bounds.rows);
  const actorKey = `${actor.colliderWidth}x${actor.colliderHeight}`;

  for (let r = 0; r < bounds.rows; r++) {
    for (let c = 0; c < bounds.cols; c++) {
      const point = {
        x: bounds.minX + c * size,
        y: bounds.minY + r * size,
      };
      if (isSnapshotWalkable(snapshot, point, actor, [])) {
        bitmap[r * bounds.cols + c] = 1;
      }
    }
  }

  return {
    revision: snapshot.revision,
    actorKey,
    minX: bounds.minX,
    minY: bounds.minY,
    cols: bounds.cols,
    rows: bounds.rows,
    size,
    bitmap,
  };
}

function isCellWalkableCached(
  bitmap: WalkabilityBitmap,
  cell: Cell,
  actor: NavigationActorProfile,
  dynamicBlockers: NavigationRect[]
): boolean {
  if (cell.x < 0 || cell.y < 0 || cell.x >= bitmap.cols || cell.y >= bitmap.rows) {
    return false;
  }
  const idx = cell.y * bitmap.cols + cell.x;
  if (!bitmap.bitmap[idx]) {
    return false;
  }
  if (dynamicBlockers.length === 0) {
    return true;
  }
  const point = {
    x: bitmap.minX + cell.x * bitmap.size,
    y: bitmap.minY + cell.y * bitmap.size,
  };
  const rect = sourceRect(point, actor);
  if (!rect) return true;
  for (const blocker of dynamicBlockers) {
    if (Geometry.rectIntersectsRect(rect, blocker)) return false;
  }
  return true;
}

function routeFor(
  snapshot: NavigationSnapshot,
  actor: NavigationActorProfile,
  target: NavigationPoint,
  dynamicBlockers: NavigationRect[],
  bitmap?: WalkabilityBitmap,
  sizeOverride?: number,
  boundsOverride?: { minX: number; minY: number; cols: number; rows: number }
): { route: NavigationPoint[] | null; iterations: number } {
  if (!isSnapshotWalkable(snapshot, target, actor, dynamicBlockers)) {
    return { route: null, iterations: 0 };
  }
  const size = sizeOverride ?? gridSize(actor);
  const bounds =
    boundsOverride ??
    (bitmap
      ? { minX: bitmap.minX, minY: bitmap.minY, cols: bitmap.cols, rows: bitmap.rows }
      : boundsFor(snapshot, actor, target, size));
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
  let iterations = 0;
  for (; heap.size > 0 && iterations < maxIterations; iterations += 1) {
    const next = heap.pop();
    if (!next || closed.has(next.key)) continue;
    const current = cells.get(next.key);
    if (!current) continue;
    if (next.key === targetKey) {
      const route: NavigationPoint[] = [];
      let key = next.key;
      while (key !== startKey) {
        const cell = cells.get(key);
        if (!cell) return { route: null, iterations };
        route.unshift(key === targetKey ? target : toPoint(cell));
        const previous = cameFrom.get(key);
        if (!previous) return { route: null, iterations };
        key = previous;
      }
      return { route: route.length ? route : [target], iterations };
    }
    closed.add(next.key);
    for (const direction of directions) {
      const neighbor = { x: current.x + direction.x, y: current.y + direction.y };
      if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x > bounds.cols || neighbor.y > bounds.rows)
        continue;
      const key = cellKey(neighbor);
      if (closed.has(key)) continue;
      const isWalkable = bitmap
        ? isCellWalkableCached(bitmap, neighbor, actor, dynamicBlockers)
        : isSnapshotWalkable(
            snapshot,
            key === targetKey ? target : toPoint(neighbor),
            actor,
            dynamicBlockers
          );
      if (!isWalkable) continue;
      const tentative =
        (gScore.get(next.key) ?? Number.POSITIVE_INFINITY) + distance(current, neighbor);
      if (tentative >= (gScore.get(key) ?? Number.POSITIVE_INFINITY)) continue;
      cameFrom.set(key, next.key);
      cells.set(key, neighbor);
      gScore.set(key, tentative);
      heap.push({ key, score: tentative + distance(neighbor, finish) });
    }
  }
  return { route: null, iterations };
}

function computeCorridorBounds(
  route: NavigationPoint[],
  actor: NavigationActorProfile,
  target: NavigationPoint,
  buffer: number,
  fineSize: number
): { minX: number; minY: number; cols: number; rows: number } {
  const points = [{ x: actor.x, y: actor.y }, target, ...route];
  const minX = Math.min(...points.map((p) => p.x)) - buffer;
  const maxX = Math.max(...points.map((p) => p.x)) + buffer;
  const minY = Math.min(...points.map((p) => p.y)) - buffer;
  const maxY = Math.max(...points.map((p) => p.y)) + buffer;
  return {
    minX,
    minY,
    cols: Math.max(1, Math.ceil((maxX - minX) / fineSize)),
    rows: Math.max(1, Math.ceil((maxY - minY) / fineSize)),
  };
}

export function routeForAdaptive(
  snapshot: NavigationSnapshot,
  actor: NavigationActorProfile,
  target: NavigationPoint,
  dynamicBlockers: NavigationRect[],
  fineBitmap?: WalkabilityBitmap,
  coarseBitmap?: WalkabilityBitmap
): {
  route: NavigationPoint[] | null;
  iterations: number;
  adaptiveUsed: boolean;
  adaptiveFallback: boolean;
} {
  const fineSize = gridSize(actor);
  const coarseSize = fineSize * 4;

  const coarseResult = routeFor(snapshot, actor, target, dynamicBlockers, coarseBitmap, coarseSize);
  if (coarseResult.route) {
    const buffer = coarseSize * 2;
    const corridorBounds = computeCorridorBounds(
      coarseResult.route,
      actor,
      target,
      buffer,
      fineSize
    );

    const fineResult = routeFor(
      snapshot,
      actor,
      target,
      dynamicBlockers,
      fineBitmap,
      fineSize,
      corridorBounds
    );

    if (fineResult.route) {
      return {
        route: fineResult.route,
        iterations: coarseResult.iterations + fineResult.iterations,
        adaptiveUsed: true,
        adaptiveFallback: false,
      };
    }
  }

  const fallbackResult = routeFor(snapshot, actor, target, dynamicBlockers, fineBitmap, fineSize);
  return {
    route: fallbackResult.route,
    iterations: coarseResult.iterations + fallbackResult.iterations,
    adaptiveUsed: true,
    adaptiveFallback: true,
  };
}

export function planSnapshotApproach(
  snapshot: NavigationSnapshot,
  request: NavigationPlanRequest
): NavigationPlanResult {
  const startedAt = performance.now();
  const radius = Math.max(32, request.interactionRadius);
  const steps = [16, 4];

  const fineBitmap = buildWalkabilityBitmap(snapshot, request.actor, request.target, radius);
  const fineSize = gridSize(request.actor);
  const coarseSize = fineSize * 4;
  const coarseBitmap = buildWalkabilityBitmap(
    snapshot,
    request.actor,
    request.target,
    radius,
    coarseSize
  );
  const bitmapBuilt = true;

  let best: {
    point: NavigationPoint;
    route: NavigationPoint[];
    targetDistance: number;
    actorDistance: number;
  } | null = null;

  let totalIterations = 0;
  let usedAdaptive = false;
  let usedFallback = false;

  for (const step of steps) {
    for (let r = 0; r <= radius; r += step) {
      for (let dx = -r; dx <= r; dx += step) {
        for (let dy = -r; dy <= r; dy += step) {
          if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const point = { x: request.target.x + dx, y: request.target.y + dy };
          const targetDistance = Math.hypot(dx, dy);
          if (targetDistance > radius) continue;

          const adaptiveRes = routeForAdaptive(
            snapshot,
            request.actor,
            point,
            request.dynamicBlockers,
            fineBitmap,
            coarseBitmap
          );
          totalIterations += adaptiveRes.iterations;
          if (adaptiveRes.adaptiveUsed) usedAdaptive = true;
          if (adaptiveRes.adaptiveFallback) usedFallback = true;

          const route = adaptiveRes.route;
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
    bitmapBuilt,
    adaptiveUsed: usedAdaptive,
    adaptiveFallback: usedFallback,
    iterationsCount: totalIterations,
  };
}
