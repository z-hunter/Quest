import { describe, expect, it } from 'vitest';
import { QuadObject } from '../../src/entities/QuadObject';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('QuadObject Global Parallax Multiplier', () => {
  it('treats global parallax as a multiplier for all vertex parallax values', () => {
    const fixture = createSceneFixture();
    const quad = new QuadObject(fixture.game, 'test_quad');
    quad.vertices = [
      { x: 0, y: 0, p: 2.0 },
      { x: 100, y: 0, p: 2.0 },
      { x: 100, y: 100, p: 2.0 },
      { x: 0, y: 100, p: 2.0 },
    ];
    quad.parallax = 0.5;
    fixture.scene.addEntity(quad);

    fixture.scene.camera.x = 100;
    fixture.scene.camera.y = 50;

    // Effective P = 2.0 * 0.5 = 1.0
    // getParallaxAt should return effective P = 1.0
    const effP = quad.getParallaxAt(50, 50, false);
    expect(effP).toBeCloseTo(1.0, 5);
  });

  it('keeps zero vertex offset relative to globalP layer when all v.p = 1.0', () => {
    const fixture = createSceneFixture();
    const quad = new QuadObject(fixture.game, 'test_quad');
    quad.vertices = [
      { x: 0, y: 0, p: 1.0 },
      { x: 100, y: 0, p: 1.0 },
      { x: 100, y: 100, p: 1.0 },
      { x: 0, y: 100, p: 1.0 },
    ];
    quad.parallax = 0.5; // Change global P to 0.5
    fixture.scene.addEntity(quad);

    fixture.scene.camera.x = 200;
    fixture.scene.camera.y = 150;

    // Relative offset to layer G = 0.5 should be -camX * (effP - G) = -200 * (0.5 - 0.5) = 0
    expect(quad.hitTest(50, 50)).toBe(true);
    expect(quad.hitTest(150, 150)).toBe(false);
  });
});
