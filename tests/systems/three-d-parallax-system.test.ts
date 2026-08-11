import { describe, expect, it } from 'vitest';
import { QuadObject } from '../../src/entities/QuadObject';
import { ThreeDParallaxSystem } from '../../src/systems/ThreeDParallaxSystem';
import { toVisualPosition } from '../../src/utils/Parallax';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('ThreeDParallaxSystem', () => {
  it('applies surface parallax to Static objects without moving their visual position', () => {
    const fixture = createSceneFixture();
    fixture.scene.camera.x = 20;
    fixture.scene.camera.y = 40;

    const floor = new QuadObject(fixture.game, 'floor');
    floor.vertices = [
      { x: 0, y: 0, p: 0.5 },
      { x: 100, y: 0, p: 0.5 },
      { x: 100, y: 100, p: 1 },
      { x: 0, y: 100, p: 1 },
    ];
    fixture.scene.addEntity(floor);

    const prop = fixture.addEntity('prop');
    prop.x = 50;
    prop.y = 60;
    const initialVisual = toVisualPosition(
      { x: prop.x, y: prop.y },
      fixture.scene.camera,
      prop.parallax
    );

    ThreeDParallaxSystem.update(floor, { type: '3d-parallax' });

    expect(prop.parallax).toBeCloseTo(0.75, 6);
    expect(toVisualPosition({ x: prop.x, y: prop.y }, fixture.scene.camera, prop.parallax)).toEqual(
      initialVisual
    );
  });

  it('follows the same perspective-corrected grid point after camera movement', () => {
    const fixture = createSceneFixture();
    const floor = new QuadObject(fixture.game, 'perspective-floor');
    floor.vertices = [
      { x: 40, y: 0, p: 0.5 },
      { x: 60, y: 0, p: 0.5 },
      { x: 100, y: 100, p: 1 },
      { x: 0, y: 100, p: 1 },
    ];
    floor.perspective = true;
    floor.perspectiveAmount = 1;
    fixture.scene.addEntity(floor);

    const prop = fixture.addEntity('prop');
    const u = 0.35;
    const v = 0.45;
    const initialPoint = floor.getGridPointAt(u, v, true);
    prop.x = initialPoint.x;
    prop.y = initialPoint.y;
    ThreeDParallaxSystem.update(floor, { type: '3d-parallax' });

    fixture.scene.camera.x = 80;
    fixture.scene.camera.y = 30;
    ThreeDParallaxSystem.update(floor, { type: '3d-parallax' });

    const expected = floor.getGridPointAt(u, v, true);
    const visual = toVisualPosition({ x: prop.x, y: prop.y }, fixture.scene.camera, prop.parallax);
    expect(visual.x).toBeCloseTo(expected.x, 5);
    expect(visual.y).toBeCloseTo(expected.y, 5);
  });

  it('keeps an Actor route target visually fixed when surface P changes', () => {
    const fixture = createSceneFixture();
    fixture.scene.camera.y = 40;
    const floor = new QuadObject(fixture.game, 'floor');
    floor.vertices = [
      { x: 0, y: 0, p: 0.5 },
      { x: 100, y: 0, p: 0.5 },
      { x: 100, y: 100, p: 1 },
      { x: 0, y: 100, p: 1 },
    ];
    fixture.scene.addEntity(floor);
    const actor = fixture.addPlayer('Hero', 50, 60);
    actor.target = { x: 80, y: 80 };
    actor.route = [{ x: 80, y: 80 }];
    const oldTargetVisual = toVisualPosition(actor.target, fixture.scene.camera, actor.parallax);

    ThreeDParallaxSystem.update(floor, { type: '3d-parallax' });

    expect(actor.parallax).toBeCloseTo(0.75, 5);
    expect(actor.target!.x).toBe(80);
    expect(actor.target!.y).toBe(70);
    expect(toVisualPosition(actor.target!, fixture.scene.camera, actor.parallax)).toEqual(
      oldTargetVisual
    );
    expect(toVisualPosition(actor.route[0], fixture.scene.camera, actor.parallax)).toEqual(
      oldTargetVisual
    );
  });

  it('does not resolve an interior lower-edge point as the P=1 boundary', () => {
    const fixture = createSceneFixture();
    fixture.scene.camera.y = 100;
    const floor = new QuadObject(fixture.game, 'floor');
    floor.vertices = [
      { x: 42, y: 5, p: 0.5 },
      { x: 62, y: 6, p: 0.5 },
      { x: 82, y: 112.5, p: 1 },
      { x: -20, y: 113, p: 1 },
    ];
    floor.perspective = true;
    floor.perspectiveAmount = 1;
    fixture.scene.addEntity(floor);
    const actor = fixture.addPlayer('Hero', 40, 95);
    actor.speed = 1;
    for (let i = 0; i < 7; i++) {
      actor.y += 1;
      ThreeDParallaxSystem.update(floor, { type: '3d-parallax' });
    }

    const visual = toVisualPosition(
      { x: actor.x, y: actor.y },
      fixture.scene.camera,
      actor.parallax
    );
    expect(visual.y).toBeCloseTo(102, 3);
    expect(actor.parallax).toBeGreaterThan(0.97);
    expect(actor.parallax).toBeLessThan(0.99);
  });
});
