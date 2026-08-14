import { describe, expect, it } from 'vitest';
import { QuadObject } from '../../src/entities/QuadObject';
import { Actor } from '../../src/entities/Actor';
import { SceneEditor } from '../../src/tools/SceneEditor';
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

  it('materializes legacy grid bindings once and then leaves vertices independent', () => {
    const fixture = createSceneFixture();
    const target = new QuadObject(fixture.game, 'target-floor');
    target.parallax = 1;
    target.perspective = true;
    target.perspectiveAmount = 0.2;
    target.vertices = [
      { x: 40, y: 0, p: 0.5 },
      { x: 60, y: 0, p: 0.5 },
      { x: 100, y: 100, p: 1 },
      { x: 0, y: 100, p: 1 },
    ];

    const source = new QuadObject(fixture.game, 'bound-wall');
    source.parallax = 0.75;
    source.vertices[3].binding = {
      targetName: target.name,
      type: 'grid',
      gridU: 1,
      gridV: 0.4473684210526316,
    };
    fixture.scene.addEntity(target);
    fixture.scene.addEntity(source);

    const gridV = 0.4473684210526316;
    fixture.scene.camera.x = 20;
    fixture.scene.camera.y = 80;
    source.update(0);

    expect(source.vertices[3].binding).toBeUndefined();
    expect(source.vertices[3].p).toBeCloseTo(((1 - gridV) * 0.5 + gridV) / source.parallax, 6);
    const authoredPosition = { ...source.vertices[3] };

    target.vertices[2].x += 100;
    target.vertices[2].y += 100;
    fixture.scene.camera.x = 200;
    fixture.scene.camera.y = 200;
    source.update(0);

    expect(source.vertices[3]).toMatchObject(authoredPosition);
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

  it('does not bake scene scaling into a controller-managed object when toggled', () => {
    const fixture = createSceneFixture();
    fixture.scene.scaling = { enabled: true, min: 0.2, max: 0.4, horizon: 0, front: 100 };
    const controller = new QuadObject(fixture.game, 'controller');
    controller.vertices = [
      { x: 0, y: 0, p: 1 },
      { x: 100, y: 0, p: 1 },
      { x: 100, y: 100, p: 1 },
      { x: 0, y: 100, p: 1 },
    ];
    controller.components = [{ type: 'Depth scaling controller', min: 0.5, max: 1 }];
    fixture.scene.addEntity(controller);

    const prop = fixture.addEntity('prop');
    prop.x = 50;
    prop.y = 50;
    prop.modelScale = 1;
    prop.baseWidth = 100;
    prop.baseHeight = 100;
    prop.update(0);
    expect(prop.scale).toBeCloseTo(0.75, 6);

    SceneEditor.prototype.setScalingEnabled.call({ game: fixture.game }, false);
    prop.update(0);

    expect(prop.scale).toBeCloseTo(0.75, 6);
    expect(prop.width).toBeCloseTo(75, 6);
    expect(prop.baseWidth).toBeCloseTo(100, 6);
  });

  it('does not let camera movement assign an external object to a depth controller', () => {
    const fixture = createSceneFixture();
    fixture.scene.scaling.enabled = false;
    const controller = new QuadObject(fixture.game, 'controller');
    controller.vertices = [
      { x: -40, y: 0, p: 0.6 },
      { x: 75, y: 0, p: 0.6 },
      { x: 143, y: 74, p: 1 },
      { x: -110, y: 74, p: 1 },
    ];
    controller.components = [{ type: 'Depth scaling controller', min: 0.4, max: 1 }];
    fixture.scene.addEntity(controller);

    const prop = fixture.addEntity('external');
    prop.x = 19;
    prop.y = -1;
    prop.modelScale = 1;
    prop.update(0); // Establishes that the object is outside the controller.

    fixture.scene.camera.y = 190;
    prop.update(0);

    expect(prop.scale).toBe(1);

    prop.y = 75; // Actual movement may enter the inverted controller.
    prop.update(0);
    expect(prop.scale).not.toBe(1);

    prop.y = -1; // Leaving it releases the controller on the next update too.
    prop.update(0);
    expect(prop.scale).toBe(1);
    prop.update(0);
    expect(prop.scale).toBe(1);
  });

  it('keeps scene depth scaling in world space while a camera inverts a controller Quad', () => {
    const fixture = createSceneFixture();
    fixture.scene.scaling = { enabled: true, min: 0.5, max: 1, horizon: 150, front: 300 };
    const controller = new QuadObject(fixture.game, 'controller');
    controller.vertices = [
      { x: -40, y: 0, p: 0.6 },
      { x: 75, y: 0, p: 0.6 },
      { x: 143, y: 74, p: 1 },
      { x: -110, y: 74, p: 1 },
    ];
    controller.components = [{ type: 'Depth scaling controller', min: 0.4, max: 0.96 }];
    fixture.scene.addEntity(controller);

    const prop = fixture.addEntity('external');
    prop.x = 19;
    prop.y = -1;
    prop.parallax = 0.6;
    prop.update(0);
    expect(prop.scale).toBe(0.5);

    fixture.scene.camera.y = 647; // The controller is fully inverted here.
    prop.update(0);

    expect(prop.scale).toBe(0.5);
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

  it('applies the perspective derivative to routed movement on a 3d-parallax Quad', () => {
    const createRoutedActor = (y: number) => {
      const fixture = createSceneFixture();
      const actor = new Actor(fixture.game, 50, y, 0, 0, `NPC-${y}`);
      actor.speed = 10;
      fixture.scene.addEntity(actor);

      const quad = new QuadObject(fixture.game, 'perspective-floor');
      quad.vertices = [
        { x: 40, y: 0, p: 1 },
        { x: 60, y: 0, p: 1 },
        { x: 100, y: 100, p: 1 },
        { x: 0, y: 100, p: 1 },
      ];
      quad.components = [
        { type: 'WalkBox', mode: 'Invert', perspectiveWalk3D: true },
        { type: '3d-parallax' },
      ];
      fixture.scene.addEntity(quad);

      actor.moveTo(50, 90);
      actor.update(1);
      return Math.hypot(actor.x - 50, actor.y - y);
    };

    const farStep = createRoutedActor(20);
    const nearStep = createRoutedActor(50);
    expect(farStep).toBeLessThan(nearStep);
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
