import { describe, expect, it, vi } from 'vitest';
import { ParserWorldModelBuilder } from '../../src/mechanics/ParserWorldModelBuilder';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('Parser world model context', () => {
  it('includes the inventory preview item as focusedTarget for LLM default target resolution', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    const book = fixture.addEntity('book', {
      title: 'Book',
      description: 'A thumbed paperback.',
      components: [{ type: 'Item' }],
    });
    fixture.textAssets.setObject('book', {
      title: 'Book',
      description: 'A thumbed paperback.',
      details: 'Someone has underlined every pessimistic sentence.',
    });
    fixture.scene.removeEntity(book);
    fixture.game.inventory.push(book);
    fixture.game.openInventoryPreview(book, null);

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('examine', null);

    expect(model.context.focusedTarget).toEqual({
      id: 'book',
      title: 'Book',
      source: 'inventoryPreview',
      description: 'A thumbed paperback.',
      details: 'Someone has underlined every pessimistic sentence.',
    });
  });

  it('includes scene and object lore in LLM context without replacing player-facing text', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.textAssets.setScene(fixture.scene.id, {
      title: 'Test Scene',
      description: 'A room with a humming light.',
      lore: ['This was once a copy shop.', 'All visible props lean toward the back wall.'],
    });
    fixture.addEntity('clerk', {
      title: 'Clerk',
      description: 'A tired clerk watches the counter.',
      lore: 'The clerk is Miles, an underpaid night-shift worker in a borrowed jacket.',
    });

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('talk to clerk', null);
    const clerk = model.context.entities?.find((entity) => entity.id === 'clerk');

    expect(model.context.scene).toEqual(
      expect.objectContaining({
        title: 'Test Scene',
        description: 'A room with a humming light.',
        lore: 'This was once a copy shop.\nAll visible props lean toward the back wall.',
      })
    );
    expect(clerk).toEqual(
      expect.objectContaining({
        title: 'Clerk',
        description: 'A tired clerk watches the counter.',
        lore: 'The clerk is Miles, an underpaid night-shift worker in a borrowed jacket.',
      })
    );
  });

  it('includes runtime Parser Notes for scene, visible entities, and inventory items', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    const radio = fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'A radio and cassette recorder.',
    });
    const badge = fixture.addEntity('badge', {
      title: 'Badge',
      description: 'A laminated badge.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(badge);
    fixture.game.inventory.push(badge);

    fixture.scene.setParserNote('The room power is unreliable.');
    fixture.scene.setEntityParserNote(radio.name, 'The radio currently receives only static.');
    fixture.scene.setEntityParserNote(badge.name, 'The badge clip is bent.');
    fixture.scene.markParserNoteNeedsCheck();
    fixture.scene.markEntityParserNoteNeedsCheck(radio.name);
    fixture.scene.markEntityParserNoteNeedsCheck(badge.name);

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('listen radio', null);

    expect(model.context.scene?.parserNote).toBe('The room power is unreliable.');
    expect(model.context.scene?.parserNoteNeedsCheck).toBe(true);
    expect(model.context.entities?.find((entity) => entity.id === 'boombox')?.parserNote).toBe(
      'The radio currently receives only static.'
    );
    expect(
      model.context.entities?.find((entity) => entity.id === 'boombox')?.parserNoteNeedsCheck
    ).toBe(true);
    expect(model.context.inventory?.find((entity) => entity.id === 'badge')?.parserNote).toBe(
      'The badge clip is bent.'
    );
    expect(
      model.context.inventory?.find((entity) => entity.id === 'badge')?.parserNoteNeedsCheck
    ).toBe(true);
  });

  it('omits empty Parser Notes from LLM context', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'A radio and cassette recorder.',
    });
    fixture.scene.setParserNote('   ');
    fixture.scene.setEntityParserNote('boombox', '');

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('listen radio', null);

    expect(model.context.scene && 'parserNote' in model.context.scene).toBe(false);
    const radio = model.context.entities?.find((entity) => entity.id === 'boombox');
    expect(radio && 'parserNote' in radio).toBe(false);
    expect(radio && 'parserNoteNeedsCheck' in radio).toBe(false);
  });

  it('includes scene-local parser recent turns in LLM context', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.scene.addParserRecentTurn('look radio', 'The radio hisses.');
    fixture.scene.addParserRecentTurn('listen again', 'Static rolls across the room.');

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('try the dial', null);

    expect(model.context.scene?.recentTurns).toEqual([
      { command: 'look radio', response: 'The radio hisses.' },
      { command: 'listen again', response: 'Static rolls across the room.' },
    ]);
  });

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

  it('exposes explicit entity location and contents for LLM context', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'A tape recorder.',
      semanticTags: ['device', 'audio_device', 'media_player'],
      relationFacts: [
        {
          relation: 'in',
          childTags: ['media', 'audio_media'],
          fact: '{self} already has {child} loaded.',
        },
      ],
      components: [
        { type: 'Inventory', relation: 'in', capacity: 2, groups: [], protected: false, items: [] },
      ],
    });
    fixture.addEntity('cassette', {
      title: 'Compact cassette',
      description: 'A cassette.',
      semanticTags: ['media', 'audio_media', 'cassette'],
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'boombox', relation: 'in' },
    });

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('play cassette', null);
    const boombox = model.context.entities?.find((entity) => entity.id === 'boombox');
    const cassette = model.context.entities?.find((entity) => entity.id === 'cassette');

    expect(boombox?.contents).toEqual(
      expect.arrayContaining([
        {
          relation: 'in',
          id: 'cassette',
          title: 'Compact cassette',
        },
      ])
    );
    expect(cassette?.location).toEqual({
      relation: 'in',
      parentId: 'boombox',
      parentTitle: 'Boombox',
    });
    expect(model.context.worldFacts).toEqual(
      expect.arrayContaining([
        'Boombox contains Compact cassette.',
        'Compact cassette is inside Boombox.',
        'Boombox already has Compact cassette loaded.',
      ])
    );
  });

  it('generates semantic relation facts from text assets without media-specific rules', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('car', {
      title: 'Car',
      description: 'A tired sedan.',
      semanticTags: ['vehicle'],
      relationFacts: [
        {
          relation: 'in',
          childTags: ['fuel'],
          fact: '{self} has {child} in the tank.',
        },
      ],
      components: [
        { type: 'Inventory', relation: 'in', capacity: 2, groups: [], protected: false, items: [] },
      ],
    });
    fixture.addEntity('gasoline', {
      title: 'Gasoline',
      description: 'A mean little promise of motion.',
      semanticTags: ['fuel', 'liquid'],
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'car', relation: 'in' },
    });

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('drive car', null);

    expect(model.context.worldFacts).toEqual(
      expect.arrayContaining([
        'Car contains Gasoline.',
        'Gasoline is inside Car.',
        'Car has Gasoline in the tank.',
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

  it('does not run route planning while summarizing inactive subscene objects for parser context', () => {
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

    const planApproach = vi.spyOn(fixture.game.actorWorld.navigation, 'planApproach');
    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('look desk note', null);

    expect(model.context.entities?.some((entity) => entity.id === 'DeskNote')).toBe(true);
    expect(planApproach).not.toHaveBeenCalled();
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

  it('omits scene duplicates whose stable id is already held from takable scope', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    const heldCassette = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A held cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(heldCassette);
    fixture.game.inventory.push(heldCassette);
    fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A stale scene duplicate.',
      components: [{ type: 'Item' }],
    });

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('take cassette', null);

    expect(model.scope.takable.map((entity) => entity.name)).not.toContain('compact_cassette');
  });

  it('omits player inventory items from scene text layer but projects external inventory items by slot relation', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 12, 34);
    const heldKey = fixture.addEntity('held_key', {
      title: 'Held key',
      description: 'A held key.',
      components: [{ type: 'Item' }],
    });
    heldKey.x = 100;
    heldKey.y = 200;
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
    cabinet.x = 56;
    cabinet.y = 78;
    const book = fixture.addEntity('book', {
      title: 'Book',
      description: 'A book.',
      components: [{ type: 'Item' }],
    });
    book.x = 300;
    book.y = 400;
    fixture.game.inventoryManager.addInventoryEntity(cabinet as any, book as any, 'behind');

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('look cabinet', null);

    expect((heldKey as any).spatial).toEqual({ parentNodeId: player.name, relation: 'in' });
    expect(heldKey.x).toBe(player.x);
    expect(heldKey.y).toBe(player.y);
    expect(book.x).toBe(cabinet.x);
    expect(book.y).toBe(cabinet.y);
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

  it('includes object State components in parser context and world facts', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    const door = fixture.addEntity('door', {
      title: 'Door',
      description: 'A metal door.',
      components: [
        { type: 'State', id: 'open', valueType: 'boolean', initialValue: false, value: false },
      ],
    });
    const hiddenKey = fixture.addEntity('hidden_key', {
      title: 'Hidden key',
      description: 'A concealed key.',
      components: [
        { type: 'State', id: 'found', valueType: 'boolean', initialValue: false, value: true },
      ],
    });
    hiddenKey.hidden = 'lookable';

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    let model = builder.build('look door', null);

    expect(model.context.entities?.find((entity) => entity.id === 'door')?.states).toEqual([
      { id: 'open', type: 'boolean', value: false },
    ]);
    expect(
      model.context.knownEntities?.find((entity) => entity.id === 'hidden_key')?.states
    ).toEqual([{ id: 'found', type: 'boolean', value: true }]);
    expect(model.context.worldFacts).toEqual(
      expect.arrayContaining(['Door state open is false.', 'Hidden key state found is true.'])
    );

    door.components[0] = { ...door.components[0], value: true } as any;
    model = builder.build('look door again', null);
    expect(model.context.entities?.find((entity) => entity.id === 'door')?.states).toEqual([
      { id: 'open', type: 'boolean', value: true },
    ]);
    expect(model.context.worldFacts).toEqual(expect.arrayContaining(['Door state open is true.']));
  });

  it('includes inventory item State components in parser context and world facts', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    const battery = fixture.addEntity('battery', {
      title: 'Battery',
      description: 'A small battery.',
      components: [
        { type: 'Item' },
        { type: 'State', id: 'charge', valueType: 'number', initialValue: 0, value: 75 },
      ],
    });
    fixture.scene.removeEntity(battery);
    fixture.game.inventory.push(battery);
    fixture.game.openInventoryPreview(battery, null);

    const builder = new ParserWorldModelBuilder(fixture.game as any);
    const model = builder.build('inspect battery', null);

    expect(model.context.inventory?.find((entity) => entity.id === 'battery')?.states).toEqual([
      { id: 'charge', type: 'number', value: 75 },
    ]);
    expect(model.context.focusedTarget?.states).toEqual([
      { id: 'charge', type: 'number', value: 75 },
    ]);
    expect(model.context.worldFacts).toEqual(
      expect.arrayContaining(['Battery state charge is 75.'])
    );
  });
});
