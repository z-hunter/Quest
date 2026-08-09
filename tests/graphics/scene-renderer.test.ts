import { describe, expect, it } from 'vitest';

import { QuadObject } from '../../src/entities/QuadObject';
import { compareEntitiesForRender, getEntityRenderSortY } from '../../src/graphics/SceneRenderer';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('SceneRenderer Quad depth sorting', () => {
  it('orders same-layer objects around the selected Quad depth anchor using its rendered parallax', () => {
    const fixture = createSceneFixture();
    fixture.scene.camera.y = 200;

    const quad = new QuadObject(fixture.game, 'depth_quad');
    quad.layer = 0;
    quad.parallax = 0.5;
    quad.sortMode = 'v3';
    quad.vertices[3] = { x: 0, y: 200, p: 1 };

    const behind = fixture.addEntity('behind');
    behind.layer = 0;
    behind.parallax = 1;
    behind.y = 250;

    const inFront = fixture.addEntity('in_front');
    inFront.layer = 0;
    inFront.parallax = 1;
    inFront.y = 350;

    // The Quad's rendered anchor is 200 - 200 * (0.5 - 1) = 300.
    expect(getEntityRenderSortY(quad, fixture.scene.camera)).toBe(300);
    expect(compareEntitiesForRender(behind, quad, fixture.scene.camera)).toBeLessThan(0);
    expect(compareEntitiesForRender(quad, inFront, fixture.scene.camera)).toBeLessThan(0);
  });

  it('keeps manual Quad order behind sorted same-layer objects', () => {
    const fixture = createSceneFixture();
    const quad = new QuadObject(fixture.game, 'manual_quad');
    quad.layer = 0;
    quad.sortMode = 'ignore';
    const entity = fixture.addEntity('entity');
    entity.layer = 0;

    expect(getEntityRenderSortY(quad, fixture.scene.camera)).toBeNull();
    expect(compareEntitiesForRender(quad, entity, fixture.scene.camera)).toBeLessThan(0);
  });
});
