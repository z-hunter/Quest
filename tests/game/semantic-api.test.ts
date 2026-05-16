import { describe, expect, it, vi } from 'vitest';
import { Game } from '../../src/core/Game';
import { createGameSemanticFixture } from '../fixtures/gameSemanticFactory';
import { ComponentSystem } from '../../src/systems/ComponentSystem';

describe('Game semantic API', () => {
  it('lookScene returns the scene description', () => {
    const fixture = createGameSemanticFixture();

    const outcome = fixture.game.lookScene();

    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe('You are in Test Scene.');
  });

  it('lookEntity stays descriptive even when spatial parent context exists', () => {
    const fixture = createGameSemanticFixture();
    fixture.addEntity('Table', {
      title: 'Table',
      description: 'A sturdy table.',
    });
    const note = fixture.addEntity('note', {
      title: 'Piece of paper',
      description: 'A folded note.',
      spatial: { parentNodeId: 'Table', relation: 'under' },
    });

    const outcome = fixture.game.lookEntity(note);

    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe('A folded note.');
  });

  it('lookEntity reveals a lookable hidden object', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A hidden key.',
      components: [{ type: 'Item' }],
    });
    key.hidden = 'lookable';

    expect(fixture.scene.isHiddenEntityRevealed(key)).toBe(false);

    const outcome = fixture.game.lookEntity(key);

    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe('A hidden key.');
    expect(fixture.scene.isHiddenEntityRevealed(key)).toBe(true);
  });

  it('lookEntity turns the player toward a visible scene object', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    player.setDirection('down');
    const note = fixture.addEntity('note', {
      title: 'Note',
      description: 'A folded note.',
    });
    note.x = -40;
    note.y = 0;

    const outcome = fixture.game.lookEntity(note);

    expect(outcome.status).toBe('ok');
    expect(player.direction).toBe('left');
  });

  it('examineEntity prefers details and falls back to description', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer();
    const boombox = fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'Cassette recorder.',
    });
    fixture.textAssets.setObject('boombox', {
      title: 'Boombox',
      description: 'Cassette recorder.',
      details: 'Detailed boombox text.',
    });

    const detailed = fixture.game.examineEntity(boombox);

    expect(detailed.status).toBe('ok');
    expect(detailed.message).toBe('Detailed boombox text.');

    fixture.textAssets.setObject('boombox', {
      title: 'Boombox',
      description: 'Cassette recorder.',
    });

    const fallback = fixture.game.examineEntity(boombox);

    expect(fallback.status).toBe('ok');
    expect(fallback.message).toBe('Cassette recorder.');
  });

  it('resolves object text fields from arrays of lines', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer();
    const boombox = fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'Cassette recorder.',
    });
    fixture.textAssets.setObject('boombox', {
      title: 'Boombox',
      description: 'Cassette recorder.',
      details: ['Line one.', '', 'Line three.'],
    });

    const outcome = fixture.game.examineEntity(boombox);

    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe('Line one.\n\nLine three.');
  });

  it('examineEntity does not reveal a direct hidden examinable target', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const cache = fixture.addEntity('cache', {
      title: 'Secret cache',
      description: 'A concealed niche.',
      details: 'A concealed niche with a tiny latch.',
    } as any);
    fixture.textAssets.setObject('cache', {
      title: 'Secret cache',
      description: 'A concealed niche.',
      details: 'A concealed niche with a tiny latch.',
    });
    cache.hidden = 'examinable';

    expect(fixture.scene.isHiddenEntityRevealed(cache)).toBe(false);

    const outcome = fixture.game.examineEntity(cache);

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('hidden_semantic_target');
    expect(fixture.scene.isHiddenEntityRevealed(cache)).toBe(false);
  });

  it('examineEntity reveals examinable hidden descendants around the examined anchor', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const boombox = fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'Cassette recorder.',
      details: 'A dusty cassette recorder.',
    } as any);
    fixture.textAssets.setObject('boombox', {
      title: 'Boombox',
      description: 'Cassette recorder.',
      details: 'A dusty cassette recorder.',
    });
    const cables = fixture.addEntity('audio_cables', {
      title: 'audio cables',
      description: 'Two standard tape recorder cables.',
      spatial: { parentNodeId: 'boombox', relation: 'behind' },
    });
    cables.hidden = 'examinable';

    expect(fixture.scene.isHiddenEntityRevealed(cables)).toBe(false);

    const outcome = fixture.game.examineEntity(boombox);

    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe('A dusty cassette recorder.');
    expect(fixture.scene.isHiddenEntityRevealed(cables)).toBe(true);
  });

  it('examineEntity turns the player toward a visible scene object', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    player.setDirection('left');
    const boombox = fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'Cassette recorder.',
    });
    boombox.x = 0;
    boombox.y = -30;

    const outcome = fixture.game.examineEntity(boombox);

    expect(outcome.status).toBe('ok');
    expect(player.direction).toBe('up');
  });

  it('showInventory returns empty and filled inventory messages', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const emptyOutcome = fixture.game.showInventory();
    expect(emptyOutcome.message).toBe(fixture.game.text('parser.inventory_empty'));

    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your ID.',
    });
    fixture.scene.removeEntity(idCard);
    fixture.game.inventory.push(idCard);

    const filledOutcome = fixture.game.showInventory();
    expect(filledOutcome.message).toBe(
      fixture.game.text('parser.inventory_items', { items: 'your ID card' })
    );
  });

  it('hydrates the player inventory from loaded scene inventory components', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your ID.',
      components: [{ type: 'Item' }],
    });

    player.components = [
      {
        type: 'Inventory',
        relation: 'in',
        capacity: 4,
        groups: [],
        protected: false,
        items: [idCard.name],
      },
    ];

    fixture.game.inventoryManager.handleSceneChange();

    expect(fixture.game.inventory).toContain(idCard);
    expect(idCard.visible).toBe(false);
    expect((idCard as any).spatial).toEqual({ parentNodeId: player.name, relation: 'in' });
    expect(fixture.game.showInventory().message).toBe(
      fixture.game.text('parser.inventory_items', { items: 'your ID card' })
    );
  });

  it('treats only the player Inventory with relation IN as held inventory', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your ID.',
      components: [{ type: 'Item' }],
    });
    const hiddenNote = fixture.addEntity('hidden_note', {
      title: 'Hidden note',
      description: 'A hidden note.',
      components: [{ type: 'Item' }],
    });

    player.components = [
      {
        type: 'Inventory',
        relation: 'in',
        capacity: 4,
        groups: [],
        protected: false,
        items: [idCard.name],
      },
      {
        type: 'Inventory',
        relation: 'behind',
        capacity: 4,
        groups: [],
        protected: false,
        items: [hiddenNote.name],
      },
    ];

    fixture.game.inventoryManager.handleSceneChange();

    expect(fixture.game.inventory).toEqual([idCard]);
    expect(fixture.game.isEntityInInventory(idCard)).toBe(true);
    expect(fixture.game.isEntityInInventory(hiddenNote)).toBe(false);
    expect(fixture.game.getInventoryEntities(player as any, 'behind')).toEqual([hiddenNote]);
    expect(hiddenNote.visible).toBe(false);
    expect((hiddenNote as any).spatial).toEqual({ parentNodeId: player.name, relation: 'in' });
    expect(fixture.game.showInventory().message).toBe(
      fixture.game.text('parser.inventory_items', { items: 'your ID card' })
    );
  });

  it('taking an item keeps it in scene hierarchy as a hidden IN-child of the player inventory owner', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your ID.',
      components: [{ type: 'Item' }],
    });

    const outcome = fixture.game.takeEntity(idCard);

    expect(outcome.status).toBe('ok');
    expect(fixture.game.inventory).toContain(idCard);
    expect(fixture.scene.entities).toContain(idCard);
    expect(idCard.visible).toBe(false);
    expect((idCard as any).spatial).toEqual({ parentNodeId: player.name, relation: 'in' });
  });

  it('does not take a scene duplicate when an item with the same id is already held', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const heldCassette = fixture.addEntity('cassette', {
      title: 'Compact cassette',
      description: 'A held cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(heldCassette);
    fixture.game.inventory.push(heldCassette);
    const sceneDuplicate = fixture.addEntity('cassette', {
      title: 'Compact cassette',
      description: 'A stale scene duplicate.',
      components: [{ type: 'Item' }],
    });

    const outcome = fixture.game.takeEntity(sceneDuplicate);

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('item_already_held');
    expect(fixture.game.inventory).toEqual([heldCassette]);
  });

  it('does not treat same-name entities with different stable ids as the same held item', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const heldCassette = fixture.addEntity('cassette', {
      title: 'Compact cassette',
      description: 'A held cassette.',
      components: [{ type: 'Item' }],
    });
    (heldCassette as any).id = 'cassette-held';
    fixture.scene.removeEntity(heldCassette);
    fixture.game.inventory.push(heldCassette);
    const sceneCassette = fixture.addEntity('cassette', {
      title: 'Compact cassette',
      description: 'A different cassette.',
      components: [{ type: 'Item' }],
    });
    (sceneCassette as any).id = 'cassette-scene';

    expect(fixture.game.inventoryManager.hasEntityIdInInventory(sceneCassette)).toBe(false);
  });

  it('does not treat a scene duplicate as the held item for DROP', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const heldCassette = fixture.addEntity('cassette', {
      title: 'Compact cassette',
      description: 'A held cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(heldCassette);
    fixture.game.inventory.push(heldCassette);
    const sceneDuplicate = fixture.addEntity('cassette', {
      title: 'Compact cassette',
      description: 'A stale scene duplicate.',
      components: [{ type: 'Item' }],
    });

    const outcome = fixture.game.putEntity(sceneDuplicate, null, { relation: null });

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('put_item_not_held');
    expect(fixture.game.inventory).toEqual([heldCassette]);
  });

  it('does not create a player inventory implicitly when taking an item', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    player.components = [];
    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your ID.',
      components: [{ type: 'Item' }],
    });

    const outcome = fixture.game.takeEntity(idCard);

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('player_inventory_missing');
    expect(outcome.message).toBe(fixture.game.text('parser.inventory_missing'));
    expect(player.components).toEqual([]);
    expect(fixture.game.inventory).not.toContain(idCard);
    expect(idCard.spatial).toEqual({});
  });

  it('preflights missing player inventory for takeable items', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    player.components = [];
    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your ID.',
      components: [{ type: 'Item' }],
    });

    const outcome = Game.prototype.canTakeEntity.call(fixture.game, idCard);

    expect(outcome).toEqual({
      status: 'failed',
      code: 'player_inventory_missing',
      message: fixture.game.text('parser.inventory_missing'),
      data: { entityId: 'miles_id', ownerId: 'Hero' },
      recoverable: false,
    });
  });

  it('uses object TA takeFailure as a terminal not-takeable response', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const marbleColumn = fixture.addEntity('marble_column', {
      title: 'Marble column',
      description: 'A load-bearing marble column.',
      takeFailure: 'The column is doing important architectural work.',
    });

    const outcome = fixture.game.takeEntity(marbleColumn);
    const preflight = Game.prototype.canTakeEntity.call(fixture.game, marbleColumn);

    expect(outcome).toEqual({
      status: 'failed',
      code: 'not_takeable',
      message: 'The column is doing important architectural work.',
      data: { entityId: 'marble_column' },
      recoverable: false,
    });
    expect(preflight).toEqual(outcome);
    expect(fixture.game.inventory).not.toContain(marbleColumn);
  });

  it('requires an explicit player inventory for inventory commands', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    player.components = [];
    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your ID.',
      components: [{ type: 'Item' }],
    });
    fixture.game.inventory.push(idCard);

    const showOutcome = fixture.game.showInventory();
    const dropOutcome = fixture.game.removeInventoryEntity(idCard);

    expect(showOutcome.status).toBe('failed');
    expect(showOutcome.code).toBe('player_inventory_missing');
    expect(dropOutcome.status).toBe('failed');
    expect(dropOutcome.code).toBe('player_inventory_missing');
    expect(player.components).toEqual([]);
  });

  it('syncs a spatially reparented item into an external inventory slot for editor hierarchy workflows', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
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

    book.spatial = { parentNodeId: cabinet.name, relation: 'in' };
    fixture.game.inventoryManager.syncEntityStorageFromSpatialPlacement(book);

    expect(fixture.game.hasInventoryEntity(cabinet as any, book as any, 'behind')).toBe(true);
    expect(book.visible).toBe(false);
    expect((book as any).spatial).toEqual({ parentNodeId: 'cabinet', relation: 'in' });

    const relationOutcome = fixture.game.describeSpatialRelation('cabinet', 'behind');
    expect(relationOutcome.status).toBe('ok');
    expect(relationOutcome.message).toBe(
      fixture.game.text('parser.relation_contents', {
        Relation: 'Behind',
        target: 'Cabinet',
        items: 'Book',
      })
    );
  });

  it('removing a spatial child from an inventory owner also removes it from inventory storage', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
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
    expect(fixture.game.hasInventoryEntity(cabinet as any, book as any, 'behind')).toBe(true);

    book.spatial = null;
    fixture.game.inventoryManager.syncEntityStorageFromSpatialPlacement(book);

    expect(fixture.game.hasInventoryEntity(cabinet as any, book as any, 'behind')).toBe(false);
    expect(book.visible).toBe(true);
  });

  it('removing a held scene entity cleans the inventory store so editor delete cannot leave a phantom item', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const cassette = fixture.addEntity('test', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
    });

    expect(fixture.game.addInventoryEntity(player, cassette).status).toBe('ok');
    expect(fixture.game.inventory).toContain(cassette);

    fixture.scene.removeEntity(cassette);

    expect(fixture.scene.entities).not.toContain(cassette);
    expect(fixture.game.inventory).not.toContain(cassette);
    expect(fixture.game.getInventoryEntities(player)).toEqual([]);
    expect(
      player.components.find((candidate: any) => candidate?.type === 'Inventory')?.items
    ).toEqual([]);
  });

  it('examining an inventory item opens hi-res inventory preview state', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    player.setDirection('right');
    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your ID.',
    });
    fixture.scene.removeEntity(idCard);
    fixture.game.inventory.push(idCard);

    const outcome = fixture.game.examineEntity(idCard);

    expect(outcome.status).toBe('ok');
    expect((fixture.game as any).getInventoryPreviewEntity()).toBe(idCard);
    expect((fixture.game as any).getInventoryPreviewText()).toBe(null);
    expect(player.direction).toBe('right');
  });

  it('looking at an inventory item opens preview and reports description only as outcome text', () => {
    const fixture = createGameSemanticFixture();
    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Short ID description.',
    });
    fixture.scene.removeEntity(idCard);
    fixture.game.inventory.push(idCard);

    const outcome = fixture.game.lookEntity(idCard);

    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe('Short ID description.');
    expect((fixture.game as any).getInventoryPreviewEntity()).toBe(idCard);
    expect((fixture.game as any).getInventoryPreviewText()).toBe(null);
  });

  it('examining an inventory item reports details and opens preview without preview text', () => {
    const fixture = createGameSemanticFixture();
    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Short ID description.',
    });
    fixture.textAssets.setObject('miles_id', {
      title: 'your ID card',
      description: 'Short ID description.',
      details: 'Long ID details.',
    });
    fixture.scene.removeEntity(idCard);
    fixture.game.inventory.push(idCard);

    const outcome = fixture.game.examineEntity(idCard);

    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe('Long ID details.');
    expect((fixture.game as any).getInventoryPreviewEntity()).toBe(idCard);
    expect((fixture.game as any).getInventoryPreviewText()).toBe(null);
  });

  it('examineEntity does not turn the player toward objects inside subscenes', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    player.setDirection('down');
    fixture.scene.activeSubscene = 'desk_subscene';
    const note = fixture.addEntity('note', {
      title: 'Note',
      description: 'A folded note.',
      spatial: { parentNodeId: 'desk_subscene', relation: 'in' },
    });
    fixture.scene.subsceneEntities.add(note);
    note.x = 50;
    note.y = 0;

    const outcome = fixture.game.examineEntity(note);

    expect(outcome.status).toBe('ok');
    expect(player.direction).toBe('down');
  });

  it('moving a previewed inventory item out of the player inventory closes preview state', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A small key.',
      components: [{ type: 'Item' }],
    });
    const desk = fixture.addEntity('desk', {
      title: 'Desk',
      description: 'A desk.',
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);
    (fixture.game as any).openInventoryPreview(key);

    const outcome = fixture.game.putEntity(key, desk, { relation: 'on' });

    expect(outcome.status).toBe('ok');
    expect((fixture.game as any).getInventoryPreviewEntity()).toBe(null);
  });

  it('closeFocusedView closes the inventory preview before touching subscene state', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your ID.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(idCard);
    fixture.game.inventory.push(idCard);
    fixture.game.openInventoryPreview(idCard, 'Your ID.');
    fixture.scene.activeSubscene = 'desk_subscene';

    const outcome = fixture.game.closeFocusedView();

    expect(outcome.status).toBe('ok');
    expect(outcome.code).toBe('inventory_preview_closed');
    expect(fixture.game.getInventoryPreviewEntity()).toBe(null);
    expect(fixture.scene.activeSubscene).toBe('desk_subscene');
  });

  it('closeFocusedView closes the active subscene when no inventory preview is open', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.scene.activeSubscene = 'desk_subscene';

    const outcome = fixture.game.closeFocusedView();

    expect(outcome.status).toBe('ok');
    expect(outcome.code).toBe('subscene_closed');
    expect(fixture.scene.activeSubscene).toBe(null);
  });

  it('closeFocusedView escalates when there is nothing to close', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);

    const outcome = fixture.game.closeFocusedView();

    expect(outcome.status).toBe('escalate');
    expect(outcome.code).toBe('no_active_view_to_close');
  });

  it('removeInventoryEntity succeeds only for held items', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your ID.',
    });
    fixture.scene.removeEntity(idCard);
    fixture.game.inventory.push(idCard);

    const removed = fixture.game.removeInventoryEntity(idCard);
    expect(removed.status).toBe('ok');
    expect(fixture.game.inventory).toHaveLength(0);

    const missing = fixture.game.removeInventoryEntity(idCard);
    expect(missing.status).toBe('failed');
    expect(missing.code).toBe('inventory_item_not_found');
  });

  it('putEntity places a held item onto the nearest valid surface', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A small key.',
      components: [{ type: 'Item' }],
    });
    const desk = fixture.addEntity('desk', {
      title: 'Desk',
      description: 'A desk.',
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);

    const outcome = fixture.game.putEntity(key, desk, { relation: 'on' });

    expect(outcome.status).toBe('ok');
    expect(outcome.code).toBe('item_put_on_surface');
    expect(fixture.game.inventory).not.toContain(key);
    expect(fixture.scene.entities).toContain(key);
    expect((desk.components[0] as { items: Array<{ id: string }> }).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'key' })])
    );
    expect(key.layer).toBe(desk.layer);
    expect(fixture.scene.dropAnimations).toHaveLength(1);
    expect(key.opacity).toBe(0);
    expect(key.locked).toBe(false);
    expect(key.interactionLocked).toBe(true);
  });

  it('putEntity with IN can target an untitled nested surface inside the object', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A small key.',
      components: [{ type: 'Item' }],
    });
    const drawer = fixture.addEntity('drawer', {
      title: 'Drawer',
      description: 'A drawer.',
    });
    const tray = fixture.addEntity('tray', {
      title: null,
      description: 'A tray inside the drawer.',
      spatial: { parentNodeId: 'drawer', relation: 'in' },
      components: [{ type: 'Surface', relation: 'in', capacity: 2, groups: [], items: [] }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);

    const outcome = fixture.game.putEntity(key, drawer, { relation: 'in' });

    expect(outcome.status).toBe('ok');
    expect(outcome.code).toBe('item_put_on_surface');
    expect(fixture.game.inventory).not.toContain(key);
    expect((tray.components[0] as { items: Array<{ id: string }> }).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'key' })])
    );
    expect((key as any).spatial).toEqual({ parentNodeId: 'tray', relation: 'on' });
  });

  it('putEntity can move a nearby scene item into a nearby reachable container without taking it first', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const cassette = fixture.addEntity('cassette', {
      title: 'Cassette',
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
    });
    cassette.x = 10;
    cassette.y = 0;
    const recorder = fixture.addEntity('recorder', {
      title: 'Tape recorder',
      description: 'A tape recorder.',
      components: [{ type: 'Inventory', capacity: 2, groups: [], protected: false, items: [] }],
    });
    recorder.x = 20;
    recorder.y = 0;

    const outcome = fixture.game.putEntity(cassette, recorder, { relation: 'in' });

    expect(outcome.status).toBe('ok');
    expect(outcome.code).toBe('item_put_into_inventory');
    expect(fixture.game.inventory).not.toContain(cassette);
    expect(fixture.game.getInventoryEntities(recorder)).toContain(cassette);
  });

  it('putEntity does not use titled contents as storage extensions for the target anchor', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const musicCassette = fixture.addEntity('music_cassette', {
      title: "Cassette 'Music'",
      description: 'A music cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(musicCassette);
    fixture.game.inventory.push(musicCassette);
    const recorder = fixture.addEntity('recorder', {
      title: 'Tape recorder',
      description: 'A tape recorder.',
      components: [{ type: 'Inventory', relation: 'in', capacity: 1, groups: [], items: [] }],
    });
    const compactCassette = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      spatial: { parentNodeId: 'recorder', relation: 'in' },
      components: [
        { type: 'Item' },
        { type: 'Inventory', relation: 'in', capacity: 2, groups: [], items: [] },
      ],
    });
    fixture.game.addInventoryEntity(recorder, compactCassette, 'in');

    const outcome = fixture.game.putEntity(musicCassette, recorder, { relation: 'in' });

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('inventory_full');
    expect(outcome.message).toBe(
      fixture.game.text('parser.put_target_full_in', { target: 'Tape recorder' })
    );
    expect(fixture.game.getInventoryEntities(compactCassette)).not.toContain(musicCassette);
    expect(fixture.game.getInventoryEntities(recorder)).toEqual([compactCassette]);
  });

  it('putEntity does not treat a titled child container as storage for a non-container anchor', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A small key.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);
    const recorder = fixture.addEntity('recorder', {
      title: 'Tape recorder',
      description: 'A tape recorder.',
    });
    const compactCassette = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      spatial: { parentNodeId: 'recorder', relation: 'in' },
      components: [{ type: 'Inventory', relation: 'in', capacity: 2, groups: [], items: [] }],
    });

    const outcome = fixture.game.putEntity(key, recorder, { relation: 'in' });

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('put_target_not_found');
    expect(outcome.message).toBe(fixture.game.text('parser.put_no_place'));
    expect(fixture.game.getInventoryEntities(compactCassette)).not.toContain(key);
  });

  it('putEntity rejects putting an entity into itself', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const cassette = fixture.addEntity('cassette', {
      title: 'Cassette',
      description: 'A compact cassette.',
      components: [
        { type: 'Item' },
        { type: 'Inventory', relation: 'in', capacity: 2, groups: [], protected: false, items: [] },
      ],
    });

    const outcome = fixture.game.putEntity(cassette, cassette, { relation: 'in' });

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('put_target_is_source');
    expect(outcome.message).toBe(fixture.game.text('parser.put_no_place'));
    expect(fixture.game.getInventoryEntities(cassette)).not.toContain(cassette);
  });

  it('putEntity rejects moving a scene item when the source is too far away', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const cassette = fixture.addEntity('cassette', {
      title: 'Cassette',
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
    });
    cassette.x = 250;
    cassette.y = 0;
    const recorder = fixture.addEntity('recorder', {
      title: 'Tape recorder',
      description: 'A tape recorder.',
      components: [{ type: 'Inventory', capacity: 2, groups: [], protected: false, items: [] }],
    });
    recorder.x = 10;
    recorder.y = 0;

    const outcome = fixture.game.putEntity(cassette, recorder, { relation: 'in' });

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('put_source_not_accessible');
    expect(outcome.message).toBe(
      fixture.game.text('engine.too_far_from_entity', { target: 'Cassette' })
    );
  });

  it('putEntity reports a distance-specific error when the target is too far away', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A small key.',
      components: [{ type: 'Item' }],
    });
    const tray = fixture.addEntity('tray', {
      title: 'Tray',
      description: 'A tray.',
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    tray.x = 250;
    tray.y = 0;
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);

    const outcome = fixture.game.putEntity(key, tray, { relation: 'on' });

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('put_target_too_far');
    expect(outcome.message).toBe(
      fixture.game.text('engine.too_far_from_entity', { target: 'Tray' })
    );
  });

  it('putEntity reports missing storage before distance for a distant non-container target', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A small key.',
      components: [{ type: 'Item' }],
    });
    const cassette = fixture.addEntity('cassette', {
      title: "Cassette 'Music'",
      description: 'A cassette with no storage.',
      components: [{ type: 'Item' }],
    });
    cassette.x = 250;
    cassette.y = 0;
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);

    const outcome = fixture.game.putEntity(key, cassette, { relation: 'in' });

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('put_target_not_found');
    expect(outcome.message).toBe(fixture.game.text('parser.put_no_place'));
  });

  it('putEntity reports when a surface target is full', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A small key.',
      components: [{ type: 'Item' }],
    });
    const tray = fixture.addEntity('tray', {
      title: 'Tray',
      description: 'A tray.',
      components: [
        { type: 'Surface', capacity: 1, groups: [], items: [{ id: 'other', x: 0, y: 0 }] },
      ],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);

    const outcome = fixture.game.putEntity(key, tray, { relation: 'on' });

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('surface_full');
    expect(outcome.message).toBe(
      fixture.game.text('parser.put_target_full_on', { target: 'Tray' })
    );
  });

  it('putEntity reports when an item does not fit on the target surface', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const box = fixture.addEntity('box', {
      title: 'Box',
      description: 'A tiny box.',
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    box.width = 12;
    box.height = 12;
    const idCard = fixture.addEntity('id_card', {
      title: 'ID card',
      description: 'A card.',
      components: [{ type: 'Item' }],
    });
    idCard.baseWidth = 60;
    idCard.baseHeight = 40;
    idCard.width = 60;
    idCard.height = 40;
    fixture.scene.removeEntity(idCard);
    fixture.game.inventory.push(idCard);

    const outcome = fixture.game.putEntity(idCard, box, { relation: 'on' });

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('surface_no_fit');
    expect(outcome.message).toBe(
      fixture.game.text('parser.put_target_no_fit_on', { item: 'ID card', target: 'Box' })
    );
  });

  it('putEntity reports when a container inventory is full', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('other', {
      title: 'Other item',
      description: 'An existing item.',
      components: [{ type: 'Item' }],
    });
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A small key.',
      components: [{ type: 'Item' }],
    });
    const drawer = fixture.addEntity('drawer', {
      title: 'Drawer',
      description: 'A drawer.',
      components: [
        { type: 'Inventory', capacity: 1, groups: [], protected: false, items: ['other'] },
      ],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);

    const outcome = fixture.game.putEntity(key, drawer, { relation: 'in' });

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('inventory_full');
    expect(outcome.message).toBe(
      fixture.game.text('parser.put_target_full_in', { target: 'Drawer' })
    );
  });

  it('putEntity can target an untitled nested surface that extends a titled object relation', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A small key.',
      components: [{ type: 'Item' }],
    });
    const desk = fixture.addEntity('desk', {
      title: 'Desk',
      description: 'A desk.',
    });
    fixture.addEntity('tech_holder', {
      title: null,
      spatial: { parentNodeId: 'desk', relation: 'on' },
    });
    fixture.addEntity('tech_switch', {
      title: null,
      spatial: { parentNodeId: 'tech_holder', relation: 'in' },
    });
    const surface = fixture.addEntity('desk_surface_runtime', {
      title: null,
      spatial: { parentNodeId: 'tech_switch', relation: 'in' },
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);

    const outcome = fixture.game.putEntity(key, desk, { relation: 'on' });
    if (outcome.status !== 'ok') {
      throw new Error('DEBUG OUTCOME: ' + JSON.stringify(outcome));
    }

    expect(outcome.status).toBe('ok');
    expect(outcome.code).toBe('item_put_on_surface');
    expect((surface.components?.[0] as { items: Array<{ id: string }> }).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'key' })])
    );
  });

  it('putEntity can use a built-in titled surface with relation UNDER', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A small key.',
      components: [{ type: 'Item' }],
    });
    const desk = fixture.addEntity('desk', {
      title: 'Desk',
      description: 'A desk.',
      components: [{ type: 'Surface', relation: 'under', capacity: 2, groups: [], items: [] }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);

    const outcome = fixture.game.putEntity(key, desk, { relation: 'under' });

    expect(outcome.status).toBe('ok');
    expect(outcome.code).toBe('item_put_on_surface');
    expect(outcome.message).toBe(
      fixture.game.text('parser.put_success_under', { item: 'Key', target: 'Desk' })
    );
    expect((desk.components?.[0] as { items: Array<{ id: string }> }).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'key' })])
    );
    expect((key as any).spatial).toEqual({ parentNodeId: 'desk', relation: 'under' });
    expect(
      desk.components?.some((component: any) => component?.type === 'Inventory') ?? false
    ).toBe(false);
  });

  it('putEntity uses the first spatial relation for untitled nested surface extensions', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A small key.',
      components: [{ type: 'Item' }],
    });
    const chair = fixture.addEntity('chair', {
      title: 'Chair',
      description: 'A chair.',
    });
    const underChairSurface = fixture.addEntity('chair_under_surface', {
      title: null,
      spatial: { parentNodeId: 'chair', relation: 'under' },
      components: [{ type: 'Surface', relation: 'on', capacity: 2, groups: [], items: [] }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);

    const outcome = fixture.game.putEntity(key, chair, { relation: 'under' });

    expect(outcome.status).toBe('ok');
    expect(outcome.code).toBe('item_put_on_surface');
    expect(outcome.message).toBe(
      fixture.game.text('parser.put_success_under', { item: 'Key', target: 'Chair' })
    );
    expect((underChairSurface.components?.[0] as { items: Array<{ id: string }> }).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'key' })])
    );
    expect((key as any).spatial).toEqual({
      parentNodeId: 'chair_under_surface',
      relation: 'on',
    });
    expect(
      chair.components?.some((component: any) => component?.type === 'Inventory') ?? false
    ).toBe(false);
  });

  it('putEntity can use a built-in titled inventory with relation BEHIND', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const cassette = fixture.addEntity('cassette', {
      title: 'Cassette',
      description: 'A cassette.',
      components: [{ type: 'Item' }],
    });
    const shelf = fixture.addEntity('shelf', {
      title: 'Shelf',
      description: 'A shelf.',
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
    fixture.scene.removeEntity(cassette);
    fixture.game.inventory.push(cassette);

    const outcome = fixture.game.putEntity(cassette, shelf, { relation: 'behind' });

    expect(outcome.status).toBe('ok');
    expect(outcome.code).toBe('item_put_into_inventory');
    expect(outcome.message).toBe(
      fixture.game.text('parser.put_success_behind', { item: 'Cassette', target: 'Shelf' })
    );
    expect(fixture.game.getInventoryEntities(shelf, 'behind')).toContain(cassette);
    expect(fixture.game.getInventoryEntities(shelf, 'in')).not.toContain(cassette);
  });

  it('describeSpatialRelation projects built-in inventory contents through the inventory relation', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
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

    const moveOutcome = fixture.game.addInventoryEntity(cabinet, book, 'behind');
    expect(moveOutcome.status).toBe('ok');
    expect(book.visible).toBe(false);
    expect((book as any).spatial).toEqual({ parentNodeId: 'cabinet', relation: 'in' });

    const relationOutcome = fixture.game.describeSpatialRelation('cabinet', 'behind');

    expect(relationOutcome.status).toBe('ok');
    expect(relationOutcome.message).toBe(
      fixture.game.text('parser.relation_contents', {
        Relation: 'Behind',
        target: 'Cabinet',
        items: 'Book',
      })
    );
  });

  it('putEntity can place an item on a polygon desk surface with relation ON', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const idCard = fixture.addEntity('test', {
      title: 'Someone ID card',
      description: "You see someone's ID.",
      components: [{ type: 'Item' }],
    });
    idCard.baseWidth = 19.69986357435198;
    idCard.baseHeight = 27.994542974079128;
    idCard.width = idCard.baseWidth;
    idCard.height = idCard.baseHeight;
    idCard.modelScale = 1;
    const desk = fixture.addTriggerbox('Desk', {
      title: 'Desk',
      description: 'A desk.',
    });
    const deskSurface = fixture.addTriggerbox('desk_surface', {
      title: null,
      spatial: { parentNodeId: 'Desk', relation: 'on' },
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    deskSurface.poly = [
      { x: -29, y: 95 },
      { x: 7, y: 92 },
      { x: 46, y: 95 },
      { x: -13, y: 109 },
      { x: -117, y: 125 },
      { x: -156, y: 113 },
      { x: -132, y: 109 },
      { x: -103, y: 118 },
      { x: -32, y: 107 },
    ];
    fixture.scene.removeEntity(idCard);
    fixture.game.inventory.push(idCard);

    const outcome = fixture.game.putEntity(idCard, desk, { relation: 'on' });

    expect(outcome.status).toBe('ok');
    expect(outcome.code).toBe('item_put_on_surface');
    expect((deskSurface.components?.[0] as { items: Array<{ id: string }> }).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'test' })])
    );
  });

  it('surface with no valid group ids accepts any item', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const coin = fixture.addEntity('coin', {
      title: 'Coin',
      description: 'A coin.',
      components: [{ type: 'Item' }],
      groupID: '#currency',
    });
    const tray = fixture.addEntity('tray', {
      title: 'Tray',
      description: 'A tray.',
      components: [{ type: 'Surface', capacity: 2, groups: [''], items: [] }],
    });
    fixture.scene.removeEntity(coin);
    fixture.game.inventory.push(coin);

    const outcome = fixture.game.putEntity(coin, tray, { relation: 'on' });

    expect(outcome.status).toBe('ok');
    expect(outcome.code).toBe('item_put_on_surface');
  });

  it('drop onto an untitled non-walkbox surface uses a generic drop message', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A small key.',
      components: [{ type: 'Item' }],
    });
    const tray = fixture.addEntity('tray', {
      title: null,
      description: 'A tray.',
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);

    const outcome = fixture.game.putEntity(key, tray, { relation: 'on' });

    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe(fixture.game.text('parser.drop_success', { item: 'Key' }));
  });

  it('taking an item during drop animation settles it so it can be dropped again', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 20);
    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your ID.',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    const floor = fixture.addWalkbox('Walk_176');
    floor.poly = [
      { x: -120, y: -40 },
      { x: 120, y: -40 },
      { x: 120, y: 40 },
      { x: -120, y: 40 },
    ];
    floor.components = [{ type: 'Surface', capacity: 4, groups: [], items: [] }];

    fixture.scene.removeEntity(idCard);
    fixture.game.inventory.push(idCard);

    const firstDrop = fixture.game.putEntity(idCard, null, { relation: null });
    expect(firstDrop.status).toBe('ok');
    expect((floor.components[0] as { items: Array<{ id: string }> }).items).toEqual([
      expect.objectContaining({ id: 'miles_id' }),
    ]);
    expect(idCard.locked).toBe(false);
    expect(idCard.interactionLocked).toBe(true);

    const takeBack = fixture.game.takeEntity(idCard);
    expect(takeBack.status).toBe('ok');
    expect((floor.components[0] as { items: Array<{ id: string }> }).items).toEqual([]);
    expect(idCard.locked).toBe(false);
    expect(idCard.interactionLocked).toBe(false);
    expect(idCard.opacity).toBe(1);
    expect(fixture.scene.dropAnimations).toHaveLength(0);

    const secondDrop = fixture.game.putEntity(idCard, null, { relation: null });
    expect(secondDrop.status).toBe('ok');
    expect((floor.components[0] as { items: Array<{ id: string }> }).items).toEqual([
      expect.objectContaining({ id: 'miles_id' }),
    ]);
  });

  it('dropEntity finds a stable free spot on a surface that already has another item', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const firstCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your ID.',
      components: [{ type: 'Item' }],
    });
    const secondCard = fixture.addEntity('someone_id', {
      title: 'Someone ID card',
      description: 'Another ID.',
      components: [{ type: 'Item' }],
    });
    const floor = fixture.addWalkbox('Walk_176');
    floor.poly = [
      { x: -120, y: -40 },
      { x: 120, y: -40 },
      { x: 120, y: 40 },
      { x: -120, y: 40 },
    ];
    floor.components = [{ type: 'Surface', capacity: 4, groups: [], items: [] }];

    fixture.scene.removeEntity(firstCard);
    fixture.scene.removeEntity(secondCard);
    fixture.game.inventory.push(firstCard, secondCard);

    expect(fixture.game.putEntity(firstCard, null, { relation: null }).status).toBe('ok');
    expect(fixture.game.putEntity(secondCard, null, { relation: null }).status).toBe('ok');

    const placedIds = (floor.components[0] as { items: Array<{ id: string }> }).items.map(
      (item) => item.id
    );
    expect(placedIds).toContain('miles_id');
    expect(placedIds).toContain('someone_id');
  });

  it('dropEntity reports a full untitled auto-drop surface using its titled parent', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('desk', {
      title: 'Desk',
      description: 'A desk.',
      components: [],
    });
    fixture.addEntity('other', {
      title: 'Other item',
      description: 'An existing item.',
      components: [{ type: 'Item' }],
    });
    const deskSurface = fixture.addTriggerbox('desk_surface', {
      title: null,
      description: 'Desk surface.',
      spatial: { parentNodeId: 'desk', relation: 'on' },
      components: [
        {
          type: 'Surface',
          relation: 'on',
          capacity: 1,
          groups: [],
          items: [{ id: 'other', x: 0, y: 0 }],
        },
      ],
    });
    deskSurface.poly = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const cassette = fixture.addEntity('cassette', {
      title: 'Cassette',
      description: 'A tape.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(cassette);
    fixture.game.inventory.push(cassette);

    const outcome = fixture.game.putEntity(cassette, null, { relation: null });

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('surface_full');
    expect(outcome.message).toBe(
      fixture.game.text('parser.put_target_full_on', { target: 'Desk' })
    );
    expect(fixture.game.inventory).toContain(cassette);
  });

  it('dropEntity can use a walkbox floor surface even when its stored relation is IN', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A key.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);
    const floor = fixture.addWalkbox('Walk_main');
    floor.poly = [
      { x: -40, y: -40 },
      { x: 40, y: -40 },
      { x: 40, y: 40 },
      { x: -40, y: 40 },
    ];
    floor.components = [{ type: 'Surface', relation: 'in', capacity: 4, groups: [], items: [] }];

    const outcome = fixture.game.putEntity(key, floor, { relation: 'on' });

    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe(
      fixture.game.text('parser.put_success_surface', {
        item: 'Key',
        target: fixture.game.text('engine.floor_label'),
      })
    );
    expect(fixture.game.inventory).not.toContain(key);
  });

  it('allows dropping onto the current long walkbox floor from either end of the polygon', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 20, 20);
    const leftKey = fixture.addEntity('left_key', {
      title: 'Left key',
      description: 'A key.',
      components: [{ type: 'Item' }],
    });
    const rightKey = fixture.addEntity('right_key', {
      title: 'Right key',
      description: 'A key.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(leftKey);
    fixture.scene.removeEntity(rightKey);
    fixture.game.inventory.push(leftKey, rightKey);
    const floor = fixture.addWalkbox('Walk_main');
    floor.poly = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 80 },
      { x: 0, y: 80 },
    ];
    floor.components = [{ type: 'Surface', relation: 'on', capacity: 4, groups: [], items: [] }];

    expect(fixture.game.putEntity(leftKey, floor, { relation: 'on' }).status).toBe('ok');

    player.x = 980;
    player.y = 20;

    expect(fixture.game.putEntity(rightKey, floor, { relation: 'on' }).status).toBe('ok');
  });

  it('surface placement keeps randomness by choosing among valid samples', () => {
    const runPlacement = (randomValue: number) => {
      const fixture = createGameSemanticFixture();
      fixture.addPlayer('Hero', 0, 0);
      const idCard = fixture.addEntity('miles_id', {
        title: 'your ID card',
        description: 'Your ID.',
        components: [{ type: 'Item' }],
      });
      const floor = fixture.addWalkbox('Walk_176');
      floor.poly = [
        { x: -120, y: -40 },
        { x: 120, y: -40 },
        { x: 120, y: 40 },
        { x: -120, y: 40 },
      ];
      floor.components = [{ type: 'Surface', capacity: 8, groups: [], items: [] }];

      fixture.scene.removeEntity(idCard);
      fixture.game.inventory.push(idCard);

      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(randomValue);
      try {
        const outcome = fixture.game.addEntityToSurface(floor, idCard);
        expect(outcome.status).toBe('ok');
        const placement = (
          floor.components[0] as { items: Array<{ id: string; x: number; y: number }> }
        ).items[0];
        return { x: placement.x, y: placement.y };
      } finally {
        randomSpy.mockRestore();
      }
    };

    const firstPlacement = runPlacement(0);
    const lastPlacement = runPlacement(0.999);

    expect(firstPlacement).not.toEqual(lastPlacement);
  });

  it('addEntityToSurface fails without creating a missing surface component', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your ID.',
      components: [{ type: 'Item' }],
    });
    const chair = fixture.addEntity('chair', {
      title: 'Chair',
      description: 'A chair.',
    });
    fixture.scene.removeEntity(idCard);
    fixture.game.inventory.push(idCard);

    const outcome = fixture.game.addEntityToSurface(chair, idCard, 'under');

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('surface_missing');
    expect(chair.components?.some((component: any) => component?.type === 'Surface') ?? false).toBe(
      false
    );
    expect(fixture.game.inventory).toContain(idCard);
  });

  it('addInventoryEntity fails without creating a missing inventory component', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your ID.',
      components: [{ type: 'Item' }],
    });
    const chair = fixture.addEntity('chair', {
      title: 'Chair',
      description: 'A chair.',
    });
    fixture.scene.removeEntity(idCard);
    fixture.game.inventory.push(idCard);

    const outcome = fixture.game.addInventoryEntity(chair, idCard, 'in');

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('inventory_missing');
    expect(
      chair.components?.some((component: any) => component?.type === 'Inventory') ?? false
    ).toBe(false);
    expect(fixture.game.inventory).toContain(idCard);
  });

  it('inventory read helpers do not create missing inventory components', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your ID.',
      components: [{ type: 'Item' }],
    });
    const chair = fixture.addEntity('chair', {
      title: 'Chair',
      description: 'A chair.',
    });

    expect(fixture.game.hasInventoryEntity(chair, idCard, 'under')).toBe(false);
    expect(fixture.game.getInventoryEntities(chair, 'under')).toEqual([]);
    expect(
      chair.components?.some((component: any) => component?.type === 'Inventory') ?? false
    ).toBe(false);
  });

  it('takeEntity can pull an accessible item out of another entity inventory', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const recorder = fixture.addEntity('recorder', {
      title: 'Tape recorder',
      description: 'A recorder.',
      components: [{ type: 'Inventory', capacity: 2, groups: [], protected: false, items: [] }],
    });
    const cassette = fixture.addEntity('cassette', {
      title: 'Cassette',
      description: 'A cassette tape.',
      components: [{ type: 'Item' }],
    });

    const stored = fixture.game.addInventoryEntity(recorder, cassette);
    expect(stored.status).toBe('ok');
    expect(fixture.scene.entities).toContain(cassette);
    expect(cassette.visible).toBe(false);
    expect((cassette as any).spatial).toEqual({ parentNodeId: 'recorder', relation: 'in' });

    const taken = fixture.game.takeEntity(cassette);

    expect(taken.status).toBe('ok');
    expect(taken.message).toBe(
      fixture.game.text('parser.take_pickup_success_from', {
        item: 'Cassette',
        source: 'Tape recorder',
      })
    );
    expect(fixture.game.inventory).toContain(cassette);
    expect(fixture.game.getInventoryEntities(recorder)).not.toContain(cassette);
    expect(fixture.scene.entities).toContain(cassette);
    expect(cassette.visible).toBe(false);
    expect((cassette as any).spatial).toEqual({ parentNodeId: player.name, relation: 'in' });
  });

  it('takeEntity keeps the old success message for untitled technical parents', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('storage_pocket', {
      title: null,
      description: 'A technical holder.',
    });
    const note = fixture.addEntity('note', {
      title: 'Note',
      description: 'A note.',
      components: [{ type: 'Item', ignoreDistance: true }],
      spatial: { parentNodeId: 'storage_pocket', relation: 'in' },
    });

    const taken = fixture.game.takeEntity(note);

    expect(taken.status).toBe('ok');
    expect(taken.message).toBe(fixture.game.text('parser.take_pickup_success', { item: 'Note' }));
  });

  it('takeEntity checks distance to an external inventory owner, not stale item coordinates', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const recorder = fixture.addEntity('recorder', {
      title: 'Tape recorder',
      description: 'A recorder.',
      components: [{ type: 'Inventory', capacity: 2, groups: [], protected: false, items: [] }],
    });
    recorder.x = 10;
    const cassette = fixture.addEntity('cassette', {
      title: 'Cassette',
      description: 'A cassette tape.',
      components: [{ type: 'Item' }],
    });
    cassette.x = 250;
    cassette.y = 0;

    fixture.game.addInventoryEntity(recorder, cassette);

    expect((fixture.game as any).canTakeEntity(cassette)).toBeNull();
    const taken = fixture.game.takeEntity(cassette);

    expect(taken.status).toBe('ok');
    expect(fixture.game.inventory).toContain(cassette);
    expect((cassette as any).spatial).toEqual({ parentNodeId: player.name, relation: 'in' });
  });

  it('placing an item onto a surface inside the active subscene keeps it visible there', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const drawerZone = fixture.addTriggerbox('DrawerZone', {
      title: 'Drawer front',
      description: 'A drawer front.',
      components: [{ type: 'Subscene', targetGroupId: '' }],
    });
    const tray = fixture.addEntity('tray', {
      title: 'Tray',
      description: 'A tray.',
      disabled: true,
      spatial: { parentNodeId: 'DrawerZone', relation: 'in' },
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A key.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);

    ComponentSystem.handleActivation(drawerZone, fixture.scene);
    const outcome = fixture.game.putEntity(key, tray, { relation: 'on' });

    expect(outcome.status).toBe('ok');
    expect(fixture.scene.activeSubscene).toBe('DrawerZone');
    expect(fixture.scene.subsceneEntities.has(key)).toBe(true);
    expect(key.disabled).toBe(false);
  });

  it('putting an item onto a target inside the active subscene ignores world distance', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const drawerZone = fixture.addTriggerbox('DrawerZone', {
      title: 'Drawer front',
      description: 'A drawer front.',
      components: [{ type: 'Subscene', targetGroupId: '' }],
    });
    const tray = fixture.addEntity('tray', {
      title: 'Tray',
      description: 'A tray.',
      disabled: true,
      spatial: { parentNodeId: 'DrawerZone', relation: 'in' },
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    tray.x = 500;
    tray.y = 500;
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A key.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);

    ComponentSystem.handleActivation(drawerZone, fixture.scene);
    const outcome = fixture.game.putEntity(key, tray, { relation: 'on' });

    expect(outcome.status).toBe('ok');
    expect(fixture.scene.subsceneEntities.has(key)).toBe(true);
  });

  it('item placed into a subscene surface is restored after closing and reopening the subscene', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const drawerZone = fixture.addTriggerbox('DrawerZone', {
      title: 'Drawer front',
      description: 'A drawer front.',
      components: [{ type: 'Subscene', targetGroupId: '' }],
    });
    const tray = fixture.addEntity('tray', {
      title: 'Tray',
      description: 'A tray.',
      disabled: true,
      spatial: { parentNodeId: 'DrawerZone', relation: 'in' },
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A key.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);

    ComponentSystem.handleActivation(drawerZone, fixture.scene);
    expect(fixture.game.putEntity(key, tray, { relation: 'on' }).status).toBe('ok');

    fixture.scene.activeSubscene = null;
    expect(key.disabled).toBe(true);

    ComponentSystem.handleActivation(drawerZone, fixture.scene);
    expect(key.disabled).toBe(false);
    expect(fixture.scene.subsceneEntities.has(key)).toBe(true);
  });

  it('item placed onto a surface inside an open switch branch of the active subscene stays visible there', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const drawerZone = fixture.addTriggerbox('DrawerZone', {
      title: 'Drawer front',
      description: 'A drawer front.',
      components: [{ type: 'Subscene', targetGroupId: '' }],
    });
    fixture.addEntity('Drawer', {
      title: 'Drawer',
      description: 'A drawer.',
      disabled: true,
      spatial: { parentNodeId: 'DrawerZone', relation: 'in' },
      components: [
        { type: 'Switch', state: 2, groupId1: '#drawer_closed', groupId2: '#drawer_open' },
      ],
    });
    const tray = fixture.addEntity('tray', {
      title: 'Tray',
      description: 'A tray.',
      disabled: true,
      groupID: '#drawer_open',
      spatial: { parentNodeId: 'Drawer', relation: 'in' },
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A key.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);

    ComponentSystem.handleActivation(drawerZone, fixture.scene);
    expect(tray.disabled).toBe(false);
    expect(fixture.scene.subsceneEntities.has(tray)).toBe(true);

    expect(fixture.game.putEntity(key, tray, { relation: 'on' }).status).toBe('ok');
    expect(key.disabled).toBe(false);
    expect(fixture.scene.subsceneEntities.has(key)).toBe(true);
  });

  it('item placed onto a switch-controlled surface inherits the active switch group', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const drawer = fixture.addEntity('Drawer', {
      title: 'Drawer',
      description: 'A drawer.',
      components: [
        { type: 'Switch', state: 2, groupId1: '#drawer_closed', groupId2: '#drawer_open' },
      ],
    });
    const tray = fixture.addEntity('tray', {
      title: 'Tray',
      description: 'A tray.',
      disabled: false,
      groupID: '#drawer_open',
      spatial: { parentNodeId: 'Drawer', relation: 'in' },
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A key.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);

    expect(fixture.game.putEntity(key, tray, { relation: 'on' }).status).toBe('ok');
    expect(key.groupID).toContain('#drawer_open');

    const closed = fixture.game.closeEntity(drawer);
    expect(closed.status).toBe('ok');
    expect(key.disabled).toBe(true);

    const opened = fixture.game.openEntity(drawer);
    expect(opened.status).toBe('ok');
    expect(key.disabled).toBe(false);
  });

  it('placing onto a group-controlled subscene surface applies surface layer, subscene scale, and active switch group', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const drawerZone = fixture.addTriggerbox('DrawerZone', {
      title: 'Drawer front',
      description: 'A drawer front.',
      components: [{ type: 'Subscene', targetGroupId: '#drawer_zone', itemScale: 3 }],
    });
    const drawer = fixture.addTriggerbox('DrawerSwitch', {
      title: 'Drawer',
      description: 'A drawer.',
      disabled: true,
      groupID: '#drawer_zone',
      components: [{ type: 'Switch', state: 1, groupId1: 'nil', groupId2: '#drawer_open' }],
    });
    const surface = fixture.addTriggerbox('DrawerSurface', {
      title: null,
      disabled: true,
      groupID: '#drawer_open',
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    surface.layer = 7;
    surface.poly = [
      { x: -100, y: -100 },
      { x: 100, y: -100 },
      { x: 100, y: 100 },
      { x: -100, y: 100 },
    ];
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A key.',
      components: [{ type: 'Item' }],
    });
    key.ignoreScaling = true;
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);

    ComponentSystem.handleActivation(drawerZone, fixture.scene);
    expect(fixture.game.openEntity(drawer).status).toBe('ok');
    expect(fixture.scene.subsceneEntities.has(surface)).toBe(true);

    const outcome = fixture.game.putEntity(key, surface, { relation: 'on' });

    expect(outcome.status).toBe('ok');
    expect(key.layer).toBe(7);
    expect(key.subsceneItemScale).toBe(3);
    expect(key.groupID).toContain('#drawer_open');
    expect(fixture.scene.subsceneEntities.has(key)).toBe(true);

    fixture.scene.finishDropAnimation(key);
    expect(key.scale).toBeCloseTo(key.modelScale * 3);

    expect(fixture.game.closeEntity(drawer).status).toBe('ok');
    expect(surface.disabled).toBe(true);
    expect(key.disabled).toBe(true);
  });

  it('openEntity and closeEntity mirror switch state changes', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const drawer = fixture.addEntity('Drawer', {
      title: 'Drawer',
      description: 'A desk drawer.',
      components: [{ type: 'Switch', state: 1, sound2: 'open.wav', sound1: 'close.wav' }],
    });

    const opened = fixture.game.openEntity(drawer);
    expect(opened.status).toBe('ok');
    expect(opened.message).toBe(fixture.game.text('parser.open_success', { target: 'Drawer' }));
    expect((drawer.components[0] as { state: number }).state).toBe(2);
    expect(fixture.sounds).toContain('open.wav');

    const alreadyOpen = fixture.game.openEntity(drawer);
    expect(alreadyOpen.status).toBe('failed');
    expect(alreadyOpen.code).toBe('switch_already_open');

    const closed = fixture.game.closeEntity(drawer);
    expect(closed.status).toBe('ok');
    expect(closed.message).toBe(fixture.game.text('parser.close_success', { target: 'Drawer' }));
    expect((drawer.components[0] as { state: number }).state).toBe(1);
    expect(fixture.sounds).toContain('close.wav');
  });

  it('transparent closed contents use a generic blocked message unless clearly openable is set', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('Desk', {
      title: 'Desk',
      description: 'A desk.',
    });
    fixture.addEntity('GlassBox', {
      title: null,
      components: [{ type: 'Switch', state: 1, transparent: true }],
      spatial: { parentNodeId: 'Desk', relation: 'in' },
    });
    const gem = fixture.addEntity('Gem', {
      title: 'Gem',
      description: 'A gem behind glass.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'GlassBox', relation: 'in' },
    });

    const outcome = fixture.game.examineEntity(gem);

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('blocked_inside_closed');
    expect(outcome.message).toBe(fixture.game.text('engine.cant_reach_generic'));
  });

  it('hidden contents behind a clearly openable closed switch report the container as closed', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('Desk', {
      title: 'Desk',
      description: 'A desk.',
    });
    fixture.addEntity('Drawer', {
      title: 'Drawer',
      description: 'A desk drawer.',
      components: [{ type: 'Switch', state: 1, clearlyOpenable: true }],
      spatial: { parentNodeId: 'Desk', relation: 'in' },
    });
    const note = fixture.addEntity('Note', {
      title: 'Note',
      description: 'A folded note.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'Drawer', relation: 'in' },
    });

    const look = fixture.game.lookEntity(note);
    expect(look.status).toBe('failed');
    expect(look.message).toBe(fixture.game.text('engine.closed_container', { target: 'Drawer' }));

    const examine = fixture.game.examineEntity(note);
    expect(examine.status).toBe('failed');
    expect(examine.message).toBe(
      fixture.game.text('engine.closed_container', { target: 'Drawer' })
    );
  });

  it('held items no longer keep stale closed-container access state after pickup', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('Desk', {
      title: 'Desk',
      description: 'A desk.',
    });
    fixture.addEntity('Drawer', {
      title: 'Upper drawer',
      description: 'A desk drawer.',
      components: [{ type: 'Switch', state: 2, clearlyOpenable: true }],
      spatial: { parentNodeId: 'Desk', relation: 'in' },
    });
    const note = fixture.addEntity('Note', {
      title: 'Note',
      description: 'A folded note.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'Drawer', relation: 'in' },
    });

    const taken = fixture.game.takeEntity(note);
    expect(taken.status).toBe('ok');
    expect(fixture.game.inventory).toContain(note);
    expect((note as any).spatial).toEqual({ parentNodeId: 'Hero', relation: 'in' });
    expect(note.visible).toBe(false);

    const drawerSwitch = fixture.scene.getObjectByName('Drawer');
    if (drawerSwitch) {
      (
        drawerSwitch.components?.find((component: any) => component?.type === 'Switch') as {
          state?: number;
        }
      ).state = 1;
    }

    const look = fixture.game.lookEntity(note);
    expect(look.status).toBe('ok');
    expect(look.message).toBe('A folded note.');
  });

  it('transparent clearly openable switches keep the specific closed-container blocked message', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('Desk', {
      title: 'Desk',
      description: 'A desk.',
    });
    fixture.addEntity('GlassBox', {
      title: 'Glass Box',
      description: 'A glass display case.',
      components: [{ type: 'Switch', state: 1, transparent: true, clearlyOpenable: true }],
      spatial: { parentNodeId: 'Desk', relation: 'in' },
    });
    const gem = fixture.addEntity('Gem', {
      title: 'Gem',
      description: 'A gem behind glass.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'GlassBox', relation: 'in' },
    });

    const outcome = fixture.game.examineEntity(gem);

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('blocked_inside_closed');
    expect(outcome.message).toBe(fixture.game.text('engine.blocked_inside_closed'));
  });

  it('opaque blockers hide only the configured blocked relation', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('Desk', {
      title: 'Desk',
      description: 'A desk.',
    });
    fixture.addEntity('UnderDeskBlocker', {
      title: null,
      components: [{ type: 'Blocker', blockedRelation: 'under' }],
      spatial: { parentNodeId: 'Desk', relation: 'under' },
    });
    fixture.addEntity('UnderKey', {
      title: 'Key',
      description: 'A key under the desk.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'UnderDeskBlocker', relation: 'under' },
    });
    fixture.addEntity('DeskNote', {
      title: 'Note',
      description: 'A note on the desk.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'Desk', relation: 'on' },
    });

    const underOutcome = fixture.game.describeSpatialRelation('Desk', 'under');
    const onOutcome = fixture.game.describeSpatialRelation('Desk', 'on');

    expect(underOutcome.status).toBe('ok');
    expect(underOutcome.code).toBe('relation_empty');
    expect(onOutcome.status).toBe('ok');
    expect(onOutcome.message).toBe(
      fixture.game.text('parser.relation_contents', {
        Relation: 'On',
        target: 'Desk',
        items: 'Note',
      })
    );
  });

  it('transparent blockers keep objects visible but block interaction on the configured relation', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('Desk', {
      title: 'Desk',
      description: 'A desk.',
    });
    fixture.addEntity('UnderDeskGlass', {
      title: null,
      components: [{ type: 'Blocker', blockedRelation: 'under', transparent: true }],
      spatial: { parentNodeId: 'Desk', relation: 'under' },
    });
    const gem = fixture.addEntity('Gem', {
      title: 'Gem',
      description: 'A gem under glass.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'UnderDeskGlass', relation: 'under' },
    });

    const lookUnder = fixture.game.describeSpatialRelation('Desk', 'under');
    const examine = fixture.game.examineEntity(gem);

    expect(lookUnder.status).toBe('ok');
    expect(lookUnder.message).toBe(
      fixture.game.text('parser.relation_contents', {
        Relation: 'Under',
        target: 'Desk',
        items: 'Gem',
      })
    );
    expect(examine.status).toBe('failed');
    expect(examine.code).toBe('blocked_inside_closed');
    expect(examine.message).toBe(fixture.game.text('engine.cant_reach_generic'));
  });

  it('closed switches respect blockedRelation outside of IN', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('Desk', {
      title: 'Desk',
      description: 'A desk.',
      components: [{ type: 'Switch', state: 1, clearlyOpenable: true, blockedRelation: 'under' }],
    });
    fixture.addEntity('HiddenKey', {
      title: 'Key',
      description: 'A hidden key.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'Desk', relation: 'under' },
    });

    const outcome = fixture.game.describeSpatialRelation('Desk', 'under');

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('blocked_by_closed_container');
    expect(outcome.message).toBe(fixture.game.text('engine.closed_container', { target: 'Desk' }));
  });

  it('auto-opens inactive ancestor subscene before operating on a titled switch target', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const drawerZone = fixture.addTriggerbox('DrawerZone', {
      title: 'Drawer front',
      description: 'A drawer front.',
      components: [{ type: 'Subscene', targetGroupId: '' }],
    });
    const latch = fixture.addEntity('Latch', {
      title: 'Drawer latch',
      description: 'A small latch.',
      disabled: true,
      spatial: { parentNodeId: 'DrawerZone', relation: 'in' },
      components: [{ type: 'Switch', state: 1 }],
    });

    const outcome = fixture.game.openEntity(latch);

    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe(
      fixture.game.text('parser.open_success', { target: 'Drawer latch' })
    );
    expect(fixture.scene.activeSubscene).toBe('DrawerZone');
    expect(fixture.scene.subsceneEntities.has(latch)).toBe(true);
    expect((latch.components[0] as { state: number }).state).toBe(2);
    expect(drawerZone.disabled).toBe(false);
  });

  it('taking an item from an active subscene clears the temporary subscene item scale', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const item = fixture.addEntity('coin', {
      title: 'Coin',
      description: 'A small coin.',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    item.ignoreScaling = true;
    item.modelScale = 1.25;
    item.subsceneItemScale = 2;
    item.update(0);
    fixture.scene.activeSubscene = 'DeskSubscene';
    fixture.scene.subsceneEntities.add(item);

    const outcome = fixture.game.takeEntity(item);

    expect(outcome.status).toBe('ok');
    expect(item.subsceneItemScale).toBe(1);
    expect(item.scale).toBe(1.25);
    expect(fixture.scene.pickupAnimations).toHaveLength(1);
    expect(fixture.scene.pickupAnimations[0].entity.subsceneItemScale).toBe(2);
  });

  it('plays pickup animation from the item position after moving it into inventory', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const item = fixture.addEntity('coin', {
      title: 'Coin',
      description: 'A small coin.',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    item.x = 120;
    item.y = 80;
    item.update(0);

    const outcome = fixture.game.takeEntity(item);

    expect(outcome.status).toBe('ok');
    expect(item.x).toBe(0);
    expect(item.y).toBe(0);
    expect(fixture.scene.pickupAnimations).toHaveLength(1);
    expect(fixture.scene.pickupAnimations[0].entity.x).toBe(120);
    expect(fixture.scene.pickupAnimations[0].entity.y).toBe(80);
  });

  it('taking an item from an active subscene ignores world distance even without ignoreDistance flag', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const item = fixture.addEntity('coin', {
      title: 'Coin',
      description: 'A small coin.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'DeskSubscene', relation: 'in' },
    });
    item.x = 500;
    item.y = 500;
    fixture.scene.activeSubscene = 'DeskSubscene';
    fixture.scene.subsceneEntities.add(item);

    const outcome = fixture.game.takeEntity(item);

    expect(outcome.status).toBe('ok');
    expect(fixture.game.inventory).toContain(item);
  });

  it('taking a dynamically placed item from an active subscene also ignores world distance', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const tray = fixture.addEntity('tray', {
      title: 'Tray',
      description: 'A tray.',
      spatial: { parentNodeId: 'DeskSubscene', relation: 'in' },
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    const item = fixture.addEntity('note', {
      title: 'Note',
      description: 'A folded note.',
      components: [{ type: 'Item' }],
    });
    item.x = 600;
    item.y = 600;
    fixture.scene.removeEntity(item);
    fixture.game.inventory.push(item);
    fixture.scene.activeSubscene = 'DeskSubscene';
    fixture.scene.subsceneEntities.add(tray);

    expect(fixture.game.putEntity(item, tray, { relation: 'on' }).status).toBe('ok');
    expect(fixture.scene.subsceneEntities.has(item)).toBe(true);

    const outcome = fixture.game.takeEntity(item);

    expect(outcome.status).toBe('ok');
    expect(fixture.game.inventory).toContain(item);
  });

  it('item taken out of a subscene does not rejoin it on reopen after being dropped into the main scene', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 20);
    const drawerZone = fixture.addTriggerbox('DrawerZone', {
      title: 'Drawer front',
      description: 'A drawer front.',
      components: [{ type: 'Subscene', targetGroupId: '#drawer_items' }],
    });
    const note = fixture.addEntity('note', {
      title: 'Note',
      description: 'A folded note.',
      components: [{ type: 'Item', ignoreDistance: true }],
      groupID: '#drawer_items',
      spatial: { parentNodeId: 'DrawerZone', relation: 'in' },
    });
    const floor = fixture.addWalkbox('Walk_176');
    floor.poly = [
      { x: -120, y: -40 },
      { x: 120, y: -40 },
      { x: 120, y: 40 },
      { x: -120, y: 40 },
    ];
    floor.components = [{ type: 'Surface', capacity: 4, groups: [], items: [] }];

    ComponentSystem.handleActivation(drawerZone, fixture.scene);
    expect(fixture.scene.subsceneEntities.has(note)).toBe(true);

    expect(fixture.game.takeEntity(note).status).toBe('ok');
    expect(fixture.game.putEntity(note, null, { relation: null }).status).toBe('ok');
    expect(fixture.scene.subsceneEntities.has(note)).toBe(false);

    fixture.scene.activeSubscene = null;

    ComponentSystem.handleActivation(drawerZone, fixture.scene);

    expect(fixture.scene.subsceneEntities.has(note)).toBe(false);
  });

  it('taking an item out of a switch-controlled branch removes the active switch group from it', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('Drawer', {
      title: 'Drawer',
      description: 'A drawer.',
      components: [
        { type: 'Switch', state: 2, groupId1: '#drawer_closed', groupId2: '#drawer_open' },
      ],
    });
    const note = fixture.addEntity('note', {
      title: 'Note',
      description: 'A folded note.',
      components: [{ type: 'Item', ignoreDistance: true }],
      groupID: '#drawer_open,#quest_item',
      spatial: { parentNodeId: 'Drawer', relation: 'in' },
    });

    const outcome = fixture.game.takeEntity(note);

    expect(outcome.status).toBe('ok');
    expect(note.groupID).toBe('#quest_item');
  });
});
