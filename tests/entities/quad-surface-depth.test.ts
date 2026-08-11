import { describe, expect, it } from 'vitest';
import { QuadObject } from '../../src/entities/QuadObject';
import { Actor } from '../../src/entities/Actor';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('Quad surface depth', () => {
  it('interpolates parallax through the same perspective-corrected coordinate as the grid', () => {
    const fixture = createSceneFixture();
    const quad = new QuadObject(fixture.game, 'floor');
    quad.vertices = [
      { x: 40, y: 0, p: 0.5 },
      { x: 60, y: 0, p: 0.5 },
      { x: 100, y: 100, p: 1 },
      { x: 0, y: 100, p: 1 },
    ];
    quad.perspective = true;
    quad.perspectiveAmount = 1;
    fixture.scene.addEntity(quad);

    const correctedMidpoint = quad.getGridPointAt(0.5, 0.5, true);
    expect(quad.getParallaxAt(correctedMidpoint.x, correctedMidpoint.y, true)).toBeCloseTo(0.75, 4);

    quad.perspective = false;
    const flatMidpoint = quad.getGridPointAt(0.5, 0.5, true);
    expect(quad.getParallaxAt(flatMidpoint.x, flatMidpoint.y, true)).toBeCloseTo(0.75, 4);
    expect(correctedMidpoint.y).not.toBeCloseTo(flatMidpoint.y, 4);
  });

  it('lets the last matching controller override scene depth scaling', () => {
    const fixture = createSceneFixture();
    fixture.scene.scaling = { enabled: false, min: 0.1, max: 0.1, horizon: 0, front: 100 };
    const first = new QuadObject(fixture.game, 'first-controller');
    first.vertices = [
      { x: 0, y: 0, p: 1 },
      { x: 100, y: 0, p: 1 },
      { x: 100, y: 100, p: 1 },
      { x: 0, y: 100, p: 1 },
    ];
    first.components = [{ type: 'Depth scaling controller', min: 0.2, max: 0.6 }];
    const last = new QuadObject(fixture.game, 'last-controller');
    last.vertices = first.vertices.map((vertex) => ({ ...vertex }));
    last.components = [{ type: 'Depth scaling controller', min: 0.4, max: 1.2 }];
    fixture.scene.addEntity(first);
    fixture.scene.addEntity(last);

    const prop = fixture.addEntity('prop');
    prop.x = 50;
    prop.y = 50;
    prop.modelScale = 1;
    prop.update(0);

    expect(prop.scale).toBeCloseTo(0.8, 6);
    prop.ignoreScaling = true;
    prop.update(0);
    expect(prop.scale).toBeCloseTo(1, 6);
  });

  it('uses the same P-based step for Player and routed Actor movement', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 50, 20);
    player.speed = 10;
    player.parallax = 1;
    const floor = new QuadObject(fixture.game, 'floor');
    floor.vertices = [
      { x: 0, y: 0, p: 1 },
      { x: 100, y: 0, p: 1 },
      { x: 100, y: 100, p: 1 },
      { x: 0, y: 100, p: 1 },
    ];
    floor.components = [{ type: 'WalkBox', mode: 'Invert', perspectiveWalk3D: true }];
    fixture.scene.addEntity(floor);

    fixture.game.input.isDown = (key: string) => key === 'ArrowUp';
    player.handlePlayerInput(1);
    expect(Math.hypot(player.x - 50, player.y - 20)).toBeCloseTo(10, 6);

    const npc = new Actor(fixture.game, 10, 50, 10, 10, 'NPC');
    npc.speed = 10;
    npc.parallax = 0.5;
    fixture.scene.addEntity(npc);
    npc.moveTo(90, 50);
    fixture.game.input.isDown = () => false;
    npc.update(1);
    expect(npc.x).toBeCloseTo(16, 6);
  });

  it('scales Quad runtime geometry without mutating authored vertices', () => {
    const fixture = createSceneFixture();
    const controller = new QuadObject(fixture.game, 'controller');
    controller.vertices = [
      { x: 0, y: 0, p: 1 },
      { x: 100, y: 0, p: 1 },
      { x: 100, y: 100, p: 1 },
      { x: 0, y: 100, p: 1 },
    ];
    controller.components = [{ type: 'Depth scaling controller', min: 0.5, max: 1 }];
    const target = new QuadObject(fixture.game, 'target');
    target.vertices = [
      { x: 40, y: 40, p: 1 },
      { x: 60, y: 40, p: 1 },
      { x: 60, y: 60, p: 1 },
      { x: 40, y: 60, p: 1 },
    ];
    target.ignoreScaling = false;
    fixture.scene.addEntity(controller);
    fixture.scene.addEntity(target);

    target.update(0);

    expect(target.scale).toBeCloseTo(0.75, 6);
    expect(target.vertices[0]).toMatchObject({ x: 40, y: 40 });
    expect(target.getEffectiveVertices()[0]).toMatchObject({ x: 42.5, y: 42.5 });
  });

  it('preserves legacy Quad geometry even when old data stored ignoreScaling as false', () => {
    const fixture = createSceneFixture();
    const legacy = QuadObject.fromJSON(fixture.game, {
      type: 'Quad',
      name: 'legacy-floor',
      ignoreScaling: false,
      vertices: [
        { x: 0, y: 0, p: 1 },
        { x: 100, y: 0, p: 1 },
        { x: 100, y: 100, p: 1 },
        { x: 0, y: 100, p: 1 },
      ],
    });

    expect(legacy.ignoreScaling).toBe(true);
    expect(legacy.toJSON().depthScalingVersion).toBe(1);
  });

  it('keeps an explicit depth-scaling opt-in in the new Quad format', () => {
    const fixture = createSceneFixture();
    const quad = QuadObject.fromJSON(fixture.game, {
      type: 'Quad',
      name: 'new-floor',
      depthScalingVersion: 1,
      ignoreScaling: false,
      vertices: [
        { x: 0, y: 0, p: 1 },
        { x: 100, y: 0, p: 1 },
        { x: 100, y: 100, p: 1 },
        { x: 0, y: 100, p: 1 },
      ],
    });

    expect(quad.ignoreScaling).toBe(false);
  });
});
