import { describe, expect, it } from 'vitest';
import {
  isSnapshotWalkable,
  planSnapshotApproach,
  type NavigationActorProfile,
  type NavigationSnapshot,
} from '../../src/systems/navigation/navigationPlanner';

const actor: NavigationActorProfile = {
  x: 10,
  y: 50,
  width: 12,
  height: 12,
  colliderWidth: 4,
  colliderHeight: 4,
};

function snapshot(overrides: Partial<NavigationSnapshot> = {}): NavigationSnapshot {
  return {
    sceneId: 'room',
    revision: 1,
    walkboxes: [
      {
        mode: 'Add',
        poly: [
          { x: 0, y: 0 },
          { x: 120, y: 0 },
          { x: 120, y: 100 },
          { x: 0, y: 100 },
        ],
      },
    ],
    staticBlockers: [],
    ...overrides,
  };
}

describe('navigation worker planner', () => {
  it('honours Add, Subtract, and Invert walkbox semantics for an Actor collider', () => {
    const addSubtract = snapshot({
      walkboxes: [
        ...snapshot().walkboxes,
        {
          mode: 'Subtract',
          poly: [
            { x: 40, y: 30 },
            { x: 60, y: 30 },
            { x: 60, y: 70 },
            { x: 40, y: 70 },
          ],
        },
      ],
    });
    expect(isSnapshotWalkable(addSubtract, { x: 20, y: 50 }, actor)).toBe(true);
    expect(isSnapshotWalkable(addSubtract, { x: 50, y: 50 }, actor)).toBe(false);

    const invert = snapshot({
      walkboxes: [{ mode: 'Invert', poly: snapshot().walkboxes[0].poly }],
    });
    expect(isSnapshotWalkable(invert, { x: 20, y: 50 }, actor)).toBe(true);
    expect(isSnapshotWalkable(invert, { x: 130, y: 50 }, actor)).toBe(false);
  });

  it('finds a multi-point route around a serialized blocking collider', () => {
    const result = planSnapshotApproach(
      snapshot({ staticBlockers: [{ x: 54, y: 20, w: 12, h: 60 }] }),
      {
        requestId: 1,
        sceneId: 'room',
        revision: 1,
        actor,
        target: { x: 105, y: 50 },
        interactionRadius: 4,
        dynamicBlockers: [],
      }
    );

    expect(result.point).not.toBeNull();
    expect(result.route.length).toBeGreaterThan(1);
  });

  it('returns no route for a disconnected target and preserves request identity', () => {
    const result = planSnapshotApproach(
      snapshot({
        sceneId: 'disconnected',
        revision: 7,
        walkboxes: [
          {
            mode: 'Add',
            poly: [
              { x: 0, y: 0 },
              { x: 30, y: 0 },
              { x: 30, y: 100 },
              { x: 0, y: 100 },
            ],
          },
          {
            mode: 'Add',
            poly: [
              { x: 80, y: 0 },
              { x: 120, y: 0 },
              { x: 120, y: 100 },
              { x: 80, y: 100 },
            ],
          },
        ],
      }),
      {
        requestId: 42,
        sceneId: 'disconnected',
        revision: 7,
        actor,
        target: { x: 100, y: 50 },
        interactionRadius: 4,
        dynamicBlockers: [],
      }
    );

    expect(result).toMatchObject({
      requestId: 42,
      sceneId: 'disconnected',
      revision: 7,
      point: null,
      route: [],
    });
  });
});
