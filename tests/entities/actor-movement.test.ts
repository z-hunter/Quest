import { describe, expect, it, vi } from 'vitest';
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

  it('routes through a same-scene Exit and Entry between disconnected walkboxes', () => {
    const fixture = createSceneFixture();
    const leftFloor = fixture.addWalkbox('LeftFloor');
    leftFloor.poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const rightFloor = fixture.addWalkbox('RightFloor');
    rightFloor.poly = [
      { x: 200, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 100 },
      { x: 200, y: 100 },
    ];
    const actor = fixture.addPlayer('Hero', 10, 50);
    actor.colliderWidth = 4;
    actor.colliderHeight = 4;
    actor.speed = 1;

    const entry = fixture.addTriggerbox('RightEntry', {
      components: [{ type: 'Entry' }],
    });
    entry.poly = [
      { x: 205, y: 45 },
      { x: 215, y: 45 },
      { x: 215, y: 55 },
      { x: 205, y: 55 },
    ];
    const exit = fixture.addTriggerbox('LeftExit', {
      components: [
        {
          type: 'Exit',
          targetSceneId: '',
          targetEntryId: 'RightEntry',
          collider: false,
          portal: true,
          navigationOnly: true,
        },
      ],
    });
    exit.poly = [
      { x: 80, y: 45 },
      { x: 90, y: 45 },
      { x: 90, y: 55 },
      { x: 80, y: 55 },
    ];
    const remoteTarget = fixture.addTriggerbox('RemoteTarget');
    remoteTarget.poly = [
      { x: 285, y: 45 },
      { x: 295, y: 45 },
      { x: 295, y: 55 },
      { x: 285, y: 55 },
    ];
    const teleportPlanning = vi.spyOn(fixture.game.actorNavigation, 'planLocalTeleportRoute');
    const exactApproachPlanning = vi.spyOn(fixture.game.actorNavigation, 'planApproach');
    const walkingApproachPlanning = vi.spyOn(fixture.game.actorNavigation, 'planWalkingApproach');

    expect(fixture.game.actorNavigation.getFastApproachStatus(actor, remoteTarget)).toBe(
      'route_available'
    );
    expect(teleportPlanning).not.toHaveBeenCalled();
    expect(exactApproachPlanning).not.toHaveBeenCalled();
    expect(walkingApproachPlanning).not.toHaveBeenCalled();

    const exactPlan = fixture.game.actorNavigation.planApproach(actor, remoteTarget);
    expect(exactPlan.status).toBe('route_available');
    expect(exactPlan.point).not.toBeNull();
    const walkingCallsAfterPlan = walkingApproachPlanning.mock.calls.length;
    const result = actor.moveTo(exactPlan.point!.x, exactPlan.point!.y);

    expect(result.status).toBe('started');
    expect(teleportPlanning).toHaveBeenCalledTimes(1);
    expect(walkingApproachPlanning).toHaveBeenCalledTimes(walkingCallsAfterPlan);
    updateActorUntilIdle(actor);
    expect(actor.getMoveResult().status).toBe('arrived');
    expect(actor.x).toBeCloseTo(exactPlan.point!.x);
    expect(actor.y).toBeCloseTo(exactPlan.point!.y);
  });

  it('does not expand teleport alternatives for an ordinary walkable approach', () => {
    const fixture = createSceneFixture();
    const floor = fixture.addWalkbox('Floor');
    floor.poly = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 100 },
      { x: 0, y: 100 },
    ];
    const actor = fixture.addPlayer('Hero', 10, 50);
    actor.colliderWidth = 4;
    actor.colliderHeight = 4;
    fixture.addTriggerbox('Entry', { components: [{ type: 'Entry' }] });
    fixture.addTriggerbox('LocalExit', {
      components: [{ type: 'Exit', targetSceneId: '', targetEntryId: 'Entry' }],
    });
    const target = fixture.addTriggerbox('Door');
    target.poly = [
      { x: 250, y: 45 },
      { x: 260, y: 45 },
      { x: 260, y: 55 },
      { x: 250, y: 55 },
    ];
    const teleportPlanning = vi.spyOn(fixture.game.actorNavigation, 'planLocalTeleportRoute');

    expect(fixture.game.actorNavigation.planApproach(actor, target).status).toBe('route_available');
    expect(actor.moveTo(240, 50).status).toBe('started');
    expect(teleportPlanning).not.toHaveBeenCalled();
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

  it('does not snap to a terminal route point that becomes unwalkable', () => {
    const fixture = createSceneFixture();
    const actor = fixture.addPlayer('Hero', 50, 90);
    actor.speed = 20;
    actor.target = { x: 50, y: 100 };
    actor.route = [{ x: 50, y: 100 }];
    actor.routeIndex = 0;
    actor.setState('walk');

    actor.update(1, (_x: number, y: number) => y < 100);

    expect(actor.getMoveResult().status).toBe('blocked');
    expect(actor.getMoveResult().code).toBe('route_blocked');
    expect(actor.x).toBe(50);
    expect(actor.y).toBe(90);
    expect(actor.getRouteBlockDiagnostic()).toMatchObject({
      attemptedPosition: { x: 50, y: 100 },
    });
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
