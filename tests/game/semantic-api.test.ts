import { describe, expect, it, vi } from 'vitest';
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
    const emptyOutcome = fixture.game.showInventory();
    expect(emptyOutcome.message).toBe('You are not carrying anything.');

    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your ID.',
    });
    fixture.scene.removeEntity(idCard);
    fixture.game.inventory.push(idCard);

    const filledOutcome = fixture.game.showInventory();
    expect(filledOutcome.message).toBe('You are carrying: your ID card');
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
    expect((fixture.game as any).getInventoryPreviewText()).toBe('Your ID.');
    expect(player.direction).toBe('right');
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

  it('removeInventoryEntity succeeds only for held items', () => {
    const fixture = createGameSemanticFixture();
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
    expect(key.locked).toBe(true);
  });

  it('putEntity with IN can target a nested surface inside the object', () => {
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
      title: 'Tray',
      description: 'A tray inside the drawer.',
      spatial: { parentNodeId: 'drawer', relation: 'in' },
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
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
    expect(outcome.message).toBe('You are too far away from the Cassette.');
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
    expect(outcome.message).toBe('You are too far away from the Tray.');
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
    expect(outcome.message).toBe('There is no more room on the Tray.');
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
    expect(outcome.message).toBe('The ID card does not fit on the Box.');
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
    expect(outcome.message).toBe('There is no more room in the Drawer.');
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
    expect(outcome.message).toBe('You drop the Key.');
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
    expect(idCard.locked).toBe(true);

    const takeBack = fixture.game.takeEntity(idCard);
    expect(takeBack.status).toBe('ok');
    expect((floor.components[0] as { items: Array<{ id: string }> }).items).toEqual([]);
    expect(idCard.locked).toBe(false);
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

  it('takeEntity can pull an accessible item out of another entity inventory', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
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
    expect(fixture.scene.entities).not.toContain(cassette);

    const taken = fixture.game.takeEntity(cassette);

    expect(taken.status).toBe('ok');
    expect(fixture.game.inventory).toContain(cassette);
    expect(fixture.game.getInventoryEntities(recorder)).not.toContain(cassette);
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
    expect(opened.message).toBe('You open the Drawer.');
    expect((drawer.components[0] as { state: number }).state).toBe(2);
    expect(fixture.sounds).toContain('open.wav');

    const alreadyOpen = fixture.game.openEntity(drawer);
    expect(alreadyOpen.status).toBe('failed');
    expect(alreadyOpen.code).toBe('switch_already_open');

    const closed = fixture.game.closeEntity(drawer);
    expect(closed.status).toBe('ok');
    expect(closed.message).toBe('You close the Drawer.');
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
    expect(outcome.message).toBe("You can't reach it.");
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
    expect(look.message).toBe('The Drawer is closed.');

    const examine = fixture.game.examineEntity(note);
    expect(examine.status).toBe('failed');
    expect(examine.message).toBe('The Drawer is closed.');
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
    expect((note as any).spatial).toBeNull();

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
    expect(outcome.message).toBe("You can't reach that while it is inside something closed.");
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
    expect(outcome.message).toBe('You open the Drawer latch.');
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
