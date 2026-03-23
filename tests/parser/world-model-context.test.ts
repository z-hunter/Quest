import { describe, expect, it } from 'vitest';
import { ParserWorldModelBuilder } from '../../src/mechanics/ParserWorldModelBuilder';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('Parser world model context', () => {
  it('omits technical scene object type and includes item flag only when Item component exists', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 12, 34);
    fixture.addEntity('note', {
      title: 'Piece of paper',
      description: 'A folded note.',
      components: [{ type: 'Item' }],
    });
    fixture.addEntity('drawer_note', {
      title: 'Nested note',
      description: 'Inside the drawer.',
      spatial: { parentNodeId: 'Desk', relation: 'in' },
    });
    fixture.addTriggerbox('Desk', {
      title: 'Desk',
      description: 'A large desk.',
    });

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('look note', null);
    const entities = model.context.entities || [];
    const player = model.context.player;

    expect(player).toEqual({ x: 12, y: 34 });
    expect(entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'note',
          title: 'Piece of paper',
          item: true,
          reachable: true,
          x: 0,
          y: 0,
        }),
        expect.objectContaining({
          id: 'Desk',
          title: 'Desk',
          reachable: true,
          x: 5,
          y: 5,
        }),
      ])
    );

    expect(entities.every((entity) => !('type' in entity))).toBe(true);
    const deskContext = entities.find((entity) => entity.id === 'Desk');
    expect(deskContext && 'item' in deskContext).toBe(false);
    const nestedContext = entities.find((entity) => entity.id === 'drawer_note');
    expect(nestedContext && 'x' in nestedContext).toBe(false);
    expect(nestedContext && 'y' in nestedContext).toBe(false);
    expect(nestedContext && 'reachable' in nestedContext).toBe(false);
  });
});
