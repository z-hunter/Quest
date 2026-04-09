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

  it('flattens untitled ancestors and hides opaque switch descendants while keeping transparent ones visible-only', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addTriggerbox('Desk', {
      title: 'Desk',
      description: 'A desk.',
    });
    fixture.addEntity('HiddenHolder', {
      title: null,
      spatial: { parentNodeId: 'Desk', relation: 'in' },
    });
    fixture.addEntity('Note', {
      title: 'Note',
      description: 'A hidden note.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'HiddenHolder', relation: 'in' },
    });
    fixture.addEntity('FalseBottom', {
      title: null,
      components: [{ type: 'Switch', state: 1 }],
      spatial: { parentNodeId: 'Desk', relation: 'in' },
    });
    fixture.addEntity('SecretCoin', {
      title: 'Secret coin',
      description: 'A concealed coin.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'FalseBottom', relation: 'in' },
    });
    fixture.addEntity('GlassBox', {
      title: null,
      components: [{ type: 'Switch', state: 1, transparent: true }],
      spatial: { parentNodeId: 'Desk', relation: 'in' },
    });
    fixture.addEntity('VisibleGem', {
      title: 'Visible gem',
      description: 'A gem behind glass.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'GlassBox', relation: 'in' },
    });

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('look desk', null);

    expect(model.context.entities?.some((entity) => entity.id === 'Note')).toBe(true);
    expect(model.context.entities?.some((entity) => entity.id === 'SecretCoin')).toBe(false);
    expect(model.context.entities?.some((entity) => entity.id === 'VisibleGem')).toBe(true);

    expect(model.scope.visible.map((entity) => entity.name)).toContain('VisibleGem');
    expect(model.scope.takable.map((entity) => entity.name)).not.toContain('VisibleGem');
    expect(model.scope.examinable.map((entity) => entity.name)).not.toContain('VisibleGem');

    expect(model.context.spatialRelations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          anchorNodeId: 'Desk',
          relation: 'in',
          childNodeIds: expect.arrayContaining(['Note', 'VisibleGem']),
        }),
      ])
    );
  });

  it('uses the titled ancestor relation when flattening untitled surface-like intermediates', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addTriggerbox('Drawer', {
      title: 'Drawer',
      description: 'A drawer.',
    });
    fixture.addEntity('Tray', {
      title: null,
      spatial: { parentNodeId: 'Drawer', relation: 'in' },
    });
    fixture.addEntity('Key', {
      title: 'Key',
      description: 'A key on the tray.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'Tray', relation: 'on' },
    });

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('look key', null);

    expect(model.context.spatialRelations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          anchorNodeId: 'Drawer',
          relation: 'in',
          childNodeIds: expect.arrayContaining(['Key']),
        }),
      ])
    );
  });
});
