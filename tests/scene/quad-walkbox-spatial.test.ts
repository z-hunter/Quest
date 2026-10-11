import { describe, expect, it } from 'vitest';
import { QuadObject } from '../../src/entities/QuadObject';
import { createSceneFixture } from '../fixtures/sceneFactory';

function addWalkboxSurface(
  fixture: ReturnType<typeof createSceneFixture>,
  name: string,
  x: number
) {
  const quad = new QuadObject(fixture.game, name);
  quad.vertices = [
    { x, y: 0, p: 1 },
    { x: x + 100, y: 0, p: 1 },
    { x: x + 100, y: 100, p: 1 },
    { x, y: 100, p: 1 },
  ];
  quad.components = [{ type: 'WalkBox', mode: 'Invert' }];
  fixture.scene.addEntity(quad);
  return quad;
}

describe('Quad WalkBox spatial ownership', () => {
  it('assigns only Actors to a WalkBox Quad during scene updates', () => {
    const fixture = createSceneFixture();
    const floor = addWalkboxSurface(fixture, 'floor', 0);
    const actor = fixture.addPlayer('Hero', 50, 50);
    const prop = fixture.addEntity('prop');
    prop.x = 50;
    prop.y = 50;

    fixture.scene.update(0);

    expect(actor.spatial).toEqual({ parentNodeId: floor.name, relation: 'on' });
    expect(prop.spatial).toEqual({});
  });

  it('keeps the current surface at an edge, then transfers or clears ownership', () => {
    const fixture = createSceneFixture();
    const left = addWalkboxSurface(fixture, 'left', 0);
    const right = addWalkboxSurface(fixture, 'right', 100);
    const actor = fixture.addPlayer('Hero', 50, 50);

    fixture.scene.update(0);
    expect(actor.spatial.parentNodeId).toBe(left.name);

    actor.x = 101;
    fixture.scene.update(0);
    expect(actor.spatial.parentNodeId).toBe(left.name);

    actor.x = 103;
    fixture.scene.update(0);
    expect(actor.spatial.parentNodeId).toBe(right.name);

    actor.x = 250;
    fixture.scene.update(0);
    expect(actor.spatial).toEqual({});
  });
});
