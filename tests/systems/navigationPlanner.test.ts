import { describe, expect, it } from 'vitest';
import {
  buildWalkabilityBitmap,
  isSnapshotWalkable,
  planSnapshotApproach,
  routeForAdaptive,
  type NavigationActorProfile,
  type NavigationSnapshot,
} from '../../src/systems/navigation/navigationPlanner';

describe('navigationPlanner optimizations', () => {
  const actor: NavigationActorProfile = {
    x: 0,
    y: 0,
    width: 20,
    height: 40,
    colliderWidth: 10,
    colliderHeight: 10,
  };

  const simpleSnapshot: NavigationSnapshot = {
    sceneId: 'test_scene',
    revision: 1,
    walkboxes: [
      {
        mode: 'Add',
        poly: [
          { x: -100, y: -100 },
          { x: 100, y: -100 },
          { x: 100, y: 100 },
          { x: -100, y: 100 },
        ],
      },
    ],
    staticBlockers: [{ x: 20, y: -10, w: 20, h: 20 }],
  };

  it('correctly evaluates isSnapshotWalkable', () => {
    expect(isSnapshotWalkable(simpleSnapshot, { x: 0, y: 0 }, actor)).toBe(true);
    // Inside static blocker
    expect(isSnapshotWalkable(simpleSnapshot, { x: 25, y: 0 }, actor)).toBe(false);
    // Outside walkbox
    expect(isSnapshotWalkable(simpleSnapshot, { x: 200, y: 200 }, actor)).toBe(false);
  });

  it('builds walkability bitmap matching isSnapshotWalkable for all grid cells', () => {
    const target = { x: 50, y: 50 };
    const bitmap = buildWalkabilityBitmap(simpleSnapshot, actor, target, 32);

    expect(bitmap.cols).toBeGreaterThan(0);
    expect(bitmap.rows).toBeGreaterThan(0);

    for (let r = 0; r < bitmap.rows; r++) {
      for (let c = 0; c < bitmap.cols; c++) {
        const point = {
          x: bitmap.minX + c * bitmap.size,
          y: bitmap.minY + r * bitmap.size,
        };
        const expected = isSnapshotWalkable(simpleSnapshot, point, actor, []);
        const actual = bitmap.bitmap[r * bitmap.cols + c] === 1;
        expect(actual).toBe(expected);
      }
    }
  });

  it('routes adaptively around obstacles', () => {
    const target = { x: 60, y: 0 };
    const fineBitmap = buildWalkabilityBitmap(simpleSnapshot, actor, target, 32);
    const coarseBitmap = buildWalkabilityBitmap(simpleSnapshot, actor, target, 32, 16);

    const result = routeForAdaptive(simpleSnapshot, actor, target, [], fineBitmap, coarseBitmap);

    expect(result.adaptiveUsed).toBe(true);
    expect(result.route).not.toBeNull();
    expect(result.route!.length).toBeGreaterThan(0);

    // The destination point should be close to or equal to target
    const lastPoint = result.route![result.route!.length - 1];
    expect(lastPoint).toEqual(target);
  });

  it('plans snapshot approach with bitmap and adaptive tracing metadata', () => {
    const request = {
      requestId: 1,
      sceneId: 'test_scene',
      revision: 1,
      actor,
      target: { x: 50, y: 50 },
      interactionRadius: 32,
      dynamicBlockers: [],
    };

    const planResult = planSnapshotApproach(simpleSnapshot, request);

    expect(planResult.requestId).toBe(1);
    expect(planResult.point).not.toBeNull();
    expect(planResult.route.length).toBeGreaterThan(0);
    expect(planResult.bitmapBuilt).toBe(true);
    expect(planResult.adaptiveUsed).toBe(true);
    expect(planResult.durationMs).toBeGreaterThanOrEqual(0);
    expect(planResult.iterationsCount).toBeGreaterThan(0);
  });

  it('evaluates dynamic blockers during routing while keeping static bitmap valid', () => {
    const target = { x: 80, y: 0 };
    const dynamicBlocker = { x: 45, y: -100, w: 20, h: 200 };
    const fineBitmap = buildWalkabilityBitmap(simpleSnapshot, actor, target, 32);
    const coarseBitmap = buildWalkabilityBitmap(simpleSnapshot, actor, target, 32, 16);

    const blockedCellX = Math.round((50 - fineBitmap.minX) / fineBitmap.size);
    const blockedCellY = Math.round((0 - fineBitmap.minY) / fineBitmap.size);
    const idx = blockedCellY * fineBitmap.cols + blockedCellX;
    expect(fineBitmap.bitmap[idx]).toBe(1);

    const blockedResult = routeForAdaptive(
      simpleSnapshot,
      actor,
      target,
      [dynamicBlocker],
      fineBitmap,
      coarseBitmap
    );
    expect(blockedResult.route).toBeNull();

    const clearResult = routeForAdaptive(
      simpleSnapshot,
      actor,
      target,
      [],
      fineBitmap,
      coarseBitmap
    );
    expect(clearResult.route).not.toBeNull();
  });

  it('returns null route for completely unreachable target', () => {
    const request = {
      requestId: 2,
      sceneId: 'test_scene',
      revision: 1,
      actor,
      target: { x: 500, y: 500 }, // outside walkbox
      interactionRadius: 16,
      dynamicBlockers: [],
    };

    const planResult = planSnapshotApproach(simpleSnapshot, request);

    expect(planResult.point).toBeNull();
    expect(planResult.route).toEqual([]);
  });
});
