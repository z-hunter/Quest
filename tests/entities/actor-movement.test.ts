import { describe, expect, it } from 'vitest';
import { Entity } from '../../src/entities/Entity';
import { createSceneFixture } from '../fixtures/sceneFactory';

function updateActorUntilIdle(actor: any, maxFrames = 300): void {
  for (let i = 0; i < maxFrames && actor.state === 'walk'; i++) {
    actor.update(10, (x: number, y: number) => actor.scene.isWalkable(x, y, actor));
  }
}

describe('Actor route movement', () => {
  it('starts a direct route when the target is reachable in a straight line', () => {
    const fixture = createSceneFixture();
    const floor = fixture.addWalkbox('Floor');
    floor.poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const actor = fixture.addPlayer('Hero', 10, 50);
    actor.colliderWidth = 4;
    actor.colliderHeight = 4;

    const result = actor.moveTo(90, 50);

    expect(result.status).toBe('started');
    expect(result.code).toBe('route_started');
    expect(result.route).toEqual([{ x: 90, y: 50 }]);
  });

  it('builds a multi-point route around a blocking collider', () => {
    const fixture = createSceneFixture();
    const floor = fixture.addWalkbox('Floor');
    floor.poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const actor = fixture.addPlayer('Hero', 10, 30);
    actor.colliderWidth = 4;
    actor.colliderHeight = 4;
    actor.speed = 1;

    const obstacle = new Entity(fixture.game as any, 50, 50, 10, 10, 'Blocker');
    obstacle.colliderWidth = 20;
    obstacle.colliderHeight = 40;
    fixture.scene.addEntity(obstacle);

    const result = actor.moveTo(90, 30);

    expect(result.status).toBe('started');
    expect(result.route.length).toBeGreaterThan(1);

    updateActorUntilIdle(actor);

    expect(actor.getMoveResult().status).toBe('arrived');
    expect(actor.x).toBeCloseTo(90);
    expect(actor.y).toBeCloseTo(30);
  });

  it('returns unreachable immediately when no route can reach the destination', () => {
    const fixture = createSceneFixture();
    const floor = fixture.addWalkbox('Floor');
    floor.poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const actor = fixture.addPlayer('Hero', 10, 50);
    actor.colliderWidth = 4;
    actor.colliderHeight = 4;

    const result = actor.moveTo(150, 50);

    expect(result.status).toBe('unreachable');
    expect(result.code).toBe('route_unreachable');
    expect(actor.state).toBe('idle');
    expect(actor.target).toBeNull();
  });

  it('stops with a blocked result when the planned route becomes obstructed', () => {
    const fixture = createSceneFixture();
    const floor = fixture.addWalkbox('Floor');
    floor.poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const actor = fixture.addPlayer('Hero', 10, 50);
    actor.colliderWidth = 4;
    actor.colliderHeight = 4;
    actor.speed = 1;

    const result = actor.moveTo(90, 50);
    expect(result.status).toBe('started');

    const blocker = new Entity(fixture.game as any, 50, 50, 10, 10, 'DynamicBlocker');
    blocker.colliderWidth = 20;
    blocker.colliderHeight = 20;
    fixture.scene.addEntity(blocker);

    updateActorUntilIdle(actor);

    expect(actor.getMoveResult().status).toBe('blocked');
    expect(actor.getMoveResult().code).toBe('route_blocked');
    expect(actor.x).toBeLessThan(90);
  });

  it('slides along one axis when a diagonal route step is blocked', () => {
    const fixture = createSceneFixture();
    const actor = fixture.addPlayer('Hero', 0, 0);
    actor.colliderWidth = 4;
    actor.colliderHeight = 4;
    actor.speed = 1;

    const result = actor.moveTo(10, 10);
    expect(result.status).toBe('started');

    actor.update(10, (x: number, y: number) => x === actor.x || y === actor.y);

    expect(actor.getMoveResult().status).toBe('started');
    expect(actor.state).toBe('walk');
    expect(actor.x !== 0 || actor.y !== 0).toBe(true);
    expect(actor.x === 0 || actor.y === 0).toBe(true);
  });

  it('plans routes across large walkboxes without exhausting the search cap', () => {
    const fixture = createSceneFixture();
    const floor = fixture.addWalkbox('LargeFloor');
    floor.poly = [
      { x: -1000, y: -120 },
      { x: 1000, y: -120 },
      { x: 1000, y: 120 },
      { x: -1000, y: 120 },
    ];
    const actor = fixture.addPlayer('Hero', -900, 0);
    actor.colliderWidth = 4;
    actor.colliderHeight = 4;

    const obstacle = new Entity(fixture.game as any, 0, 80, 10, 10, 'WideBlocker');
    obstacle.colliderWidth = 40;
    obstacle.colliderHeight = 160;
    fixture.scene.addEntity(obstacle);

    const result = actor.moveTo(900, 0);

    expect(result.status).toBe('started');
    expect(result.route.length).toBeGreaterThan(1);
  });
});
