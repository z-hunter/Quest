import { describe, expect, it } from 'vitest';
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
});
