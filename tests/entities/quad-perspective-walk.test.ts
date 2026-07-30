import { describe, expect, it } from 'vitest';
import { QuadObject } from '../../src/entities/QuadObject';
import { getQuadPerspectiveMovementVector } from '../../src/entities/Actor';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('3D Perspective Walk on Quad Walkbox', () => {
  const trapezoidVerts = [
    { x: 40, y: 0 }, // v0: Top-Left
    { x: 60, y: 0 }, // v1: Top-Right
    { x: 100, y: 100 }, // v2: Bottom-Right
    { x: 0, y: 100 }, // v3: Bottom-Left
  ];

  it('moves along the left edge when standing on the left boundary', () => {
    // Left edge midpoint: (20, 50)
    const vec = getQuadPerspectiveMovementVector(trapezoidVerts, 20, 50, 0, -1);
    expect(vec).not.toBeNull();
    // Up vector from (0,100) to (40,0) is (40, -100).
    // dx should be positive (slanting right towards vanishing point)
    expect(vec!.dx).toBeGreaterThan(0);
    expect(vec!.dy).toBeLessThan(0);
    expect(vec!.dx / vec!.dy).toBeCloseTo(40 / -100, 2);
  });

  it('moves along the right edge when standing on the right boundary', () => {
    // Right edge midpoint: (80, 50)
    const vec = getQuadPerspectiveMovementVector(trapezoidVerts, 80, 50, 0, -1);
    expect(vec).not.toBeNull();
    // Up vector from (100,100) to (60,0) is (-40, -100).
    // dx should be negative (slanting left towards vanishing point)
    expect(vec!.dx).toBeLessThan(0);
    expect(vec!.dy).toBeLessThan(0);
    expect(vec!.dx / vec!.dy).toBeCloseTo(-40 / -100, 2);
  });

  it('moves straight up along the center line when standing in the middle', () => {
    // Center point: (50, 50)
    const vec = getQuadPerspectiveMovementVector(trapezoidVerts, 50, 50, 0, -1);
    expect(vec).not.toBeNull();
    expect(vec!.dx).toBeCloseTo(0, 3);
    expect(vec!.dy).toBeCloseTo(-1, 3);
  });

  it('applies 3D perspective movement to player input in Scene', () => {
    const fixture = createSceneFixture();
    // Place player on left edge of Quad
    const player = fixture.addPlayer('Hero', 20, 50);
    player.speed = 10;

    const quad = new QuadObject(fixture.game as any, 'TrapezoidQuad');
    quad.vertices = [
      { x: 40, y: 0, p: 1.0 },
      { x: 60, y: 0, p: 1.0 },
      { x: 100, y: 100, p: 1.0 },
      { x: 0, y: 100, p: 1.0 },
    ];
    quad.components = [{ type: 'WalkBox', mode: 'Invert', perspectiveWalk3D: true }];
    fixture.scene.addEntity(quad);

    // Simulate ArrowUp press
    fixture.game.input.isDown = (key: string) => key === 'ArrowUp';
    player.handlePlayerInput(1.0);

    // Player should have moved slanting right & up along left edge (x > 20, y < 50)
    expect(player.x).toBeGreaterThan(20);
    expect(player.y).toBeLessThan(50);
  });

  it('projects equal floor steps farther apart near the camera', () => {
    const fixture = createSceneFixture();
    fixture.scene.scaling = { enabled: true, min: 0.5, max: 1, horizon: 0, front: 100 };
    const player = fixture.addPlayer('Hero', 50, 80);
    player.speed = 10;
    const quad = new QuadObject(fixture.game as any, 'TrapezoidQuad');
    quad.vertices = [
      { x: 40, y: 0, p: 1.0 },
      { x: 60, y: 0, p: 1.0 },
      { x: 100, y: 100, p: 1.0 },
      { x: 0, y: 100, p: 1.0 },
    ];
    quad.components = [{ type: 'WalkBox', mode: 'Invert', perspectiveWalk3D: true }];
    fixture.scene.addEntity(quad);
    fixture.game.input.isDown = (key: string) => key === 'ArrowUp';

    player.handlePlayerInput(1.0);
    const nearScreenStep = Math.hypot(player.x - 50, player.y - 80);
    player.x = 50;
    player.y = 20;
    player.handlePlayerInput(1.0);
    const farScreenStep = Math.hypot(player.x - 50, player.y - 20);

    expect(nearScreenStep).toBeGreaterThan(farScreenStep);
  });

  it('keeps horizontal and vertical perspective steps equal at the same depth', () => {
    const fixture = createSceneFixture();
    fixture.scene.scaling = { enabled: true, min: 0.5, max: 1, horizon: 0, front: 100 };
    const player = fixture.addPlayer('Hero', 50, 80);
    player.speed = 10;
    const quad = new QuadObject(fixture.game as any, 'TrapezoidQuad');
    quad.vertices = [
      { x: 40, y: 0, p: 1.0 },
      { x: 60, y: 0, p: 1.0 },
      { x: 100, y: 100, p: 1.0 },
      { x: 0, y: 100, p: 1.0 },
    ];
    quad.components = [{ type: 'WalkBox', mode: 'Invert', perspectiveWalk3D: true }];
    fixture.scene.addEntity(quad);

    fixture.game.input.isDown = (key: string) => key === 'ArrowUp';
    player.handlePlayerInput(1.0);
    const verticalStep = Math.hypot(player.x - 50, player.y - 80);
    player.x = 50;
    player.y = 80;
    fixture.game.input.isDown = (key: string) => key === 'ArrowRight';
    player.handlePlayerInput(1.0);

    expect(Math.hypot(player.x - 50, player.y - 80)).toBeCloseTo(verticalStep, 6);
  });

  it('uses the legacy parallax speed scale to calibrate perspective floor movement', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 50, 80);
    player.speed = 10;
    player.parallax = 0.5;
    const quad = new QuadObject(fixture.game as any, 'TrapezoidQuad');
    quad.vertices = [
      { x: 40, y: 0, p: 1.0 },
      { x: 60, y: 0, p: 1.0 },
      { x: 100, y: 100, p: 1.0 },
      { x: 0, y: 100, p: 1.0 },
    ];
    quad.components = [{ type: 'WalkBox', mode: 'Invert', perspectiveWalk3D: true }];
    fixture.scene.addEntity(quad);
    fixture.game.input.isDown = (key: string) => key === 'ArrowUp';

    player.handlePlayerInput(1.0);
    const parallaxStep = Math.hypot(player.x - 50, player.y - 80);
    player.x = 50;
    player.y = 80;
    player.parallax = 1;
    player.handlePlayerInput(1.0);

    expect(parallaxStep).toBeLessThan(Math.hypot(player.x - 50, player.y - 80));
  });

  it('keeps vertical movement on one ray to the side-edge vanishing point', () => {
    const first = getQuadPerspectiveMovementVector(trapezoidVerts, 30, 50, 0, -1);
    const second = getQuadPerspectiveMovementVector(trapezoidVerts, 35.3333333333, 30, 0, -1);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.dx).toBeCloseTo(first!.dx, 6);
    expect(second!.dy).toBeCloseTo(first!.dy, 6);
  });

  it('uses camera-projected Quad sides and actor position for 3D-parallax walking', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 50, 50);
    player.speed = 10;
    player.parallax = 0.75;
    fixture.scene.camera = { x: 20, y: 0 } as any;

    const quad = new QuadObject(fixture.game as any, 'ParallaxTrapezoidQuad');
    quad.vertices = [
      { x: 40, y: 0, p: 0.5 },
      { x: 60, y: 0, p: 0.5 },
      { x: 100, y: 100, p: 1.0 },
      { x: 0, y: 100, p: 1.0 },
    ];
    quad.components = [{ type: 'WalkBox', mode: 'Invert', perspectiveWalk3D: true }];
    fixture.scene.addEntity(quad);
    fixture.game.input.isDown = (key: string) => key === 'ArrowUp';

    player.handlePlayerInput(1.0);

    // With camera X=20 the projected side lines converge at (62.5,-25).
    // Actor visual position starts at (55,50), so its upward movement must
    // point along the ray (7.5,-75) toward that moving vanishing point.
    expect((player.x - 50) / (player.y - 50)).toBeCloseTo(7.5 / -75, 5);
  });

  it('uses standard movement if perspectiveWalk3D is not enabled', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 20, 50);
    player.speed = 10;

    const quad = new QuadObject(fixture.game as any, 'StandardQuad');
    quad.vertices = [
      { x: 40, y: 0, p: 1.0 },
      { x: 60, y: 0, p: 1.0 },
      { x: 100, y: 100, p: 1.0 },
      { x: 0, y: 100, p: 1.0 },
    ];
    quad.components = [{ type: 'WalkBox', mode: 'Invert', perspectiveWalk3D: false }];
    fixture.scene.addEntity(quad);

    fixture.game.input.isDown = (key: string) => key === 'ArrowUp';
    player.handlePlayerInput(1.0);

    // Without perspectiveWalk3D, ArrowUp moves straight up (x remains 20, y decreases)
    expect(player.x).toBe(20);
    expect(player.y).toBeLessThan(50);
  });

  it('preserves up/down character direction when moving up/down on steep Quad angles', () => {
    const fixture = createSceneFixture();
    // Steep Quad where dx > dy when moving along left edge (e.g. v0=(180,0), v3=(0,100))
    const player = fixture.addPlayer('Hero', 90, 50);
    player.speed = 10;

    const quad = new QuadObject(fixture.game as any, 'SteepQuad');
    quad.vertices = [
      { x: 180, y: 0, p: 1.0 },
      { x: 200, y: 0, p: 1.0 },
      { x: 200, y: 100, p: 1.0 },
      { x: 0, y: 100, p: 1.0 },
    ];
    quad.components = [{ type: 'WalkBox', mode: 'Invert', perspectiveWalk3D: true }];
    fixture.scene.addEntity(quad);

    fixture.game.input.isDown = (key: string) => key === 'ArrowUp';
    player.handlePlayerInput(1.0);

    // Character direction should remain 'up', not turning profile ('right')
    expect(player.direction).toBe('up');
  });
});
