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
});
