import { describe, expect, it } from 'vitest';
import { createGameSemanticFixture } from '../fixtures/gameSemanticFactory';

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
