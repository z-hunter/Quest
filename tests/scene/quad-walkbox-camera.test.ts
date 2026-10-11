import { describe, expect, it } from 'vitest';
import { QuadObject } from '../../src/entities/QuadObject';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('Quad WalkBox camera consistency', () => {
  it('uses the render camera for a parallaxed Actor against a Quad WalkBox', () => {
    const fixture = createSceneFixture();
    const floor = new QuadObject(fixture.game, 'floor');
    floor.vertices = [
      { x: 0, y: 0, p: 0.5 },
      { x: 100, y: 0, p: 0.5 },
      { x: 100, y: 100, p: 1 },
      { x: 0, y: 100, p: 1 },
    ];
    floor.components = [{ type: 'WalkBox', mode: 'Invert' }];
    fixture.scene.addEntity(floor);

    const actor = fixture.addPlayer('Hero', 50, 80);
    actor.parallax = 0.9;
    actor.colliderWidth = 0;
    actor.colliderHeight = 0;
    fixture.scene.camera.y = 100;
    fixture.scene.collisionCamera = { x: 0, y: 200 };

    // Render-camera visual point: 80 - 100 * (0.9 - 1) = 90, inside the Quad.
    // The stale collision-camera calculation would place it at 100, on the edge.
    expect(fixture.scene.isWalkable(actor.x, actor.y, actor)).toBe(true);
  });
});
