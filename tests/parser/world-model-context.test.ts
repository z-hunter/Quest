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

  it('projects nested titled descendants relative to each semantic anchor', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addTriggerbox('Cabinet', {
      title: 'Cabinet',
      description: 'A cabinet.',
    });
    fixture.addEntity('BookA', {
      title: 'Book A',
      description: 'A book inside the cabinet.',
      spatial: { parentNodeId: 'Cabinet', relation: 'in' },
    });
    fixture.addEntity('BookB', {
      title: 'Book B',
      description: 'A book on another book.',
      spatial: { parentNodeId: 'BookA', relation: 'on' },
    });

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('look in cabinet', null);

    expect(model.context.spatialRelations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          anchorNodeId: 'Cabinet',
          relation: 'in',
          childNodeIds: expect.arrayContaining(['BookA', 'BookB']),
        }),
        expect.objectContaining({
          anchorNodeId: 'BookA',
          relation: 'on',
          childNodeIds: expect.arrayContaining(['BookB']),
        }),
      ])
    );
  });

  it('omits hidden semantic objects from parser world model until they are revealed', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A hidden key.',
      components: [{ type: 'Item' }],
    });
    key.hidden = 'lookable';

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const hiddenModel = builder.build('look key', null);
    expect(hiddenModel.context.entities?.some((entity) => entity.id === 'key')).toBe(false);
    expect(hiddenModel.context.knownEntities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'key',
          title: 'Key',
          visibility: 'hidden',
          accessibility: 'inaccessible',
          hiddenReason: 'lookable',
        }),
      ])
    );
    expect(hiddenModel.scope.visible.map((entity) => entity.name)).not.toContain('Key');
    expect(hiddenModel.scope.hiddenKnown.map((entity) => entity.name)).toContain('key');
    expect(hiddenModel.scope.worldKnown.map((entity) => entity.name)).toContain('key');

    fixture.scene.revealHiddenEntity(key);

    const revealedModel = builder.build('look key', null);
    const revealedEntity = revealedModel.context.entities?.find((entity) => entity.id === 'key');
    expect(revealedEntity?.title).toBe('Key');
    expect(revealedModel.scope.visible.map((entity) => entity.name)).toContain('key');
  });

  it('respects blocker blockedRelation for visibility and reachability', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addTriggerbox('Desk', {
      title: 'Desk',
      description: 'A desk.',
    });
    fixture.addEntity('OpaqueUnderBlocker', {
      title: null,
      components: [{ type: 'Blocker', blockedRelation: 'under' }],
      spatial: { parentNodeId: 'Desk', relation: 'under' },
    });
    fixture.addEntity('HiddenKey', {
      title: 'Hidden key',
      description: 'Hidden under the desk.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'OpaqueUnderBlocker', relation: 'under' },
    });
    fixture.addEntity('GlassBehindBlocker', {
      title: null,
      components: [{ type: 'Blocker', blockedRelation: 'behind', transparent: true }],
      spatial: { parentNodeId: 'Desk', relation: 'behind' },
    });
    fixture.addEntity('VisibleGem', {
      title: 'Visible gem',
      description: 'Visible but blocked.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'GlassBehindBlocker', relation: 'behind' },
    });

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('look desk', null);

    expect(model.context.entities?.some((entity) => entity.id === 'HiddenKey')).toBe(false);
    expect(model.context.entities?.some((entity) => entity.id === 'VisibleGem')).toBe(true);
    expect(model.scope.visible.map((entity) => entity.name)).toContain('VisibleGem');
    expect(model.scope.examinable.map((entity) => entity.name)).not.toContain('VisibleGem');
    expect(model.context.spatialRelations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          anchorNodeId: 'Desk',
          relation: 'behind',
          childNodeIds: expect.arrayContaining(['VisibleGem']),
        }),
      ])
    );
  });

  it('keeps titled inactive subscene objects visible to parser scope without making disabled objects operable', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addTriggerbox('DeskCloseup', {
      title: 'Desk close-up',
      disabled: false,
      components: [{ type: 'Subscene' }],
    });
    fixture.addEntity('DeskNote', {
      title: 'Desk note',
      description: 'A note in the close-up.',
      disabled: true,
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'DeskCloseup', relation: 'in' },
    });
    fixture.addEntity('DeskLabel', {
      title: 'Desk label',
      description: 'A label in the close-up.',
      disabled: true,
      spatial: { parentNodeId: 'DeskCloseup', relation: 'on' },
    });

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('look desk note', null);

    expect(model.context.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'DeskNote', title: 'Desk note', item: true }),
        expect.objectContaining({ id: 'DeskLabel', title: 'Desk label' }),
      ])
    );
    expect(model.scope.visible.map((entity) => entity.name)).toEqual(
      expect.arrayContaining(['DeskNote', 'DeskLabel'])
    );
    expect(model.scope.takable.map((entity) => entity.name)).not.toContain('DeskNote');
    expect(model.scope.reachable.map((entity) => entity.name)).not.toContain('DeskNote');
    expect(model.scope.reachable.map((entity) => entity.name)).not.toContain('DeskLabel');
    expect(model.scope.examinable.map((entity) => entity.name)).not.toContain('DeskNote');
    expect(model.scope.examinable.map((entity) => entity.name)).not.toContain('DeskLabel');
  });

  it('separates visible knowledge from currently actionable PUT sources', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    const nearCassette = fixture.addEntity('near_cassette', {
      title: 'Near cassette',
      description: 'A cassette nearby.',
      components: [{ type: 'Item' }],
    });
    const farCassette = fixture.addEntity('far_cassette', {
      title: 'Far cassette',
      description: 'A cassette far away.',
      components: [{ type: 'Item' }],
    });
    nearCassette.x = 5;
    farCassette.x = 200;

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('put cassette in box', null);

    expect(model.scope.visible.map((entity) => entity.name)).toEqual(
      expect.arrayContaining(['near_cassette', 'far_cassette'])
    );
    expect(model.scope.putSource.map((entity) => entity.name)).toContain('near_cassette');
    expect(model.scope.putSource.map((entity) => entity.name)).not.toContain('far_cassette');
  });

  it('uses surface item placement for actionable reachability', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    const floor = fixture.addWalkbox('Walk_main', 'in');
    floor.components = [
      {
        type: 'Surface',
        relation: 'in',
        capacity: 10,
        groups: [],
        items: [{ id: 'far_cassette', x: 200, y: 0 }],
      },
    ];
    const staleNearCassette = fixture.addEntity('far_cassette', {
      title: 'Far cassette',
      description: 'A cassette on the floor.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'Walk_main', relation: 'in' },
    });
    staleNearCassette.x = 5;
    staleNearCassette.y = 0;

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('put cassette under chair', null);

    expect(model.scope.visible.map((entity) => entity.name)).toContain('far_cassette');
    expect(model.scope.reachable.map((entity) => entity.name)).not.toContain('far_cassette');
    expect(model.scope.takable.map((entity) => entity.name)).not.toContain('far_cassette');
    expect(model.scope.putSource.map((entity) => entity.name)).not.toContain('far_cassette');
  });

  it('omits player inventory items from scene text layer but projects external inventory items by slot relation', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const heldKey = fixture.addEntity('held_key', {
      title: 'Held key',
      description: 'A held key.',
      components: [{ type: 'Item' }],
    });
    fixture.game.inventory.push(heldKey);
    fixture.game.inventoryManager.syncPlayerInventoryComponent();

    const cabinet = fixture.addEntity('cabinet', {
      title: 'Cabinet',
      description: 'A cabinet.',
      components: [
        {
          type: 'Inventory',
          relation: 'behind',
          capacity: 2,
          groups: [],
          protected: false,
          items: [],
        },
      ],
    });
    const book = fixture.addEntity('book', {
      title: 'Book',
      description: 'A book.',
      components: [{ type: 'Item' }],
    });
    fixture.game.inventoryManager.addInventoryEntity(cabinet as any, book as any, 'behind');

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('look cabinet', null);

    expect((heldKey as any).spatial).toEqual({ parentNodeId: player.name, relation: 'in' });
    expect(model.context.entities?.some((entity) => entity.id === 'held_key')).toBe(false);
    expect(model.context.entities?.some((entity) => entity.id === 'book')).toBe(true);
    expect(model.context.spatialRelations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          anchorNodeId: 'cabinet',
          relation: 'behind',
          childNodeIds: expect.arrayContaining(['book']),
        }),
      ])
    );
  });
});
