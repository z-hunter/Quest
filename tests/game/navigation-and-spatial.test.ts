import { describe, expect, it } from 'vitest';
import { createGameSemanticFixture } from '../fixtures/gameSemanticFactory';
import { Actor } from '../../src/entities/Actor';
import { Entity } from '../../src/entities/Entity';
import { ComponentSystem } from '../../src/systems/ComponentSystem';

describe('Game navigation and spatial API', () => {
  it('goToSceneTarget resolves scene by id and title', () => {
    const fixture = createGameSemanticFixture('start');
    const target = fixture.addScene('test1', 'New Scene', 'You are in New Scene.');

    const byId = fixture.game.goToSceneTarget('test1');
    expect(byId.status).toBe('ok');
    expect(fixture.game.sceneManager.currentScene).toBe(target);

    fixture.game.sceneManager.currentScene = fixture.scene;

    const byTitle = fixture.game.goToSceneTarget('New Scene');
    expect(byTitle.status).toBe('ok');
    expect(fixture.game.sceneManager.currentScene).toBe(target);
  });

  it('goToSceneTarget transfers the current player and inventory to the target scene', () => {
    const fixture = createGameSemanticFixture('start');
    const player = fixture.addPlayer('Hero', 0, 0);
    player.refScale = 0.5;
    const target = fixture.addScene('test1', 'New Scene', 'You are in New Scene.');
    target.scaling = { ...target.scaling, enabled: false, correctionalScale: 2 };
    target.defaultCamera = { x: 10, y: 20, zoom: 0.42 };
    target.camera = { x: 99, y: 88, zoom: 2 };
    const entry = fixture.addTriggerbox('DefaultEntry', {
      scene: target,
      components: [{ type: 'Entry', direction: 'left' }],
    });
    entry.layer = 7;
    entry.parallax = 0.4;
    entry.poly = [
      { x: 150, y: 80 },
      { x: 170, y: 80 },
      { x: 170, y: 100 },
      { x: 150, y: 100 },
    ];
    const cassette = fixture.addEntity('cassette', {
      title: 'Cassette',
      description: 'A cassette.',
      components: [{ type: 'Item' }],
    });
    expect(fixture.game.addInventoryEntity(player, cassette, 'in').status).toBe('ok');

    const outcome = fixture.game.goToSceneTarget('New Scene');

    expect(outcome.status).toBe('ok');
    expect(fixture.game.sceneManager.currentScene).toBe(target);
    expect(fixture.scene.entities).not.toContain(player);
    expect(fixture.scene.entities).not.toContain(cassette);
    expect(target.entities).toContain(player);
    expect(target.entities).toContain(cassette);
    expect(target.player).toBe(player);
    expect(player.x).toBe(160);
    expect(player.y).toBe(90);
    expect(player.layer).toBe(7);
    expect(player.parallax).toBe(0.4);
    expect(player.modelScale).toBe(0.5);
    expect(player.scale).toBe(0.5);
    expect(target.camera.zoom).toBe(0.42);
    expect(fixture.game.inventory).toContain(cassette);
    expect(cassette.visible).toBe(false);
    expect((cassette as any).spatial).toEqual({ parentNodeId: 'Hero', relation: 'in' });
  });

  it('goToSceneTarget fails for an unknown destination', () => {
    const fixture = createGameSemanticFixture();

    const outcome = fixture.game.goToSceneTarget('nowhere');

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('destination_not_found');
  });

  it('goToEntity starts player movement and returns the player-facing title', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const chair = fixture.addEntity('Chair', {
      title: 'Chair',
      description: 'A wooden chair.',
    });
    chair.x = 42;
    chair.y = 84;

    const outcome = fixture.game.goToEntity(chair);

    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe(fixture.game.text('parser.go_to_success', { target: 'Chair' }));
    expect(player.target).toEqual({ x: 42, y: 84 });
  });

  it('describeSpatialRelation returns populated and empty relation messages', () => {
    const fixture = createGameSemanticFixture();
    fixture.addEntity('Desk', {
      title: 'Desk',
      description: 'An office desk.',
    });
    fixture.addEntity('note', {
      title: 'Piece of paper',
      description: 'A folded note.',
      spatial: { parentNodeId: 'Desk', relation: 'in' },
    });

    const populated = fixture.game.describeSpatialRelation('Desk', 'in');
    expect(populated.status).toBe('ok');
    expect(populated.message).toBe(
      fixture.game.text('parser.relation_contents', {
        Relation: 'In',
        target: 'Desk',
        items: 'Piece of paper',
      })
    );

    const empty = fixture.game.describeSpatialRelation('Desk', 'under');
    expect(empty.status).toBe('ok');
    expect(empty.message).toBe(
      fixture.game.text('parser.relation_empty', { relation: 'under', target: 'Desk' })
    );
  });

  it('describeSpatialRelation uses the collapsed ancestor relation for untitled intermediates', () => {
    const fixture = createGameSemanticFixture();
    fixture.addEntity('Desk', {
      title: 'Desk',
      description: 'An office desk.',
    });
    fixture.addEntity('HiddenHolder', {
      title: null,
      spatial: { parentNodeId: 'Desk', relation: 'in' },
    });
    fixture.addEntity('note', {
      title: 'Piece of paper',
      description: 'A folded note.',
      spatial: { parentNodeId: 'HiddenHolder', relation: 'on' },
    });

    const populated = fixture.game.describeSpatialRelation('Desk', 'in');

    expect(populated.status).toBe('ok');
    expect(populated.message).toBe(
      fixture.game.text('parser.relation_contents', {
        Relation: 'In',
        target: 'Desk',
        items: 'Piece of paper',
      })
    );
  });

  it('describeSpatialRelation is relative to the queried semantic anchor', () => {
    const fixture = createGameSemanticFixture();
    fixture.addEntity('Cabinet', {
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

    const cabinetContents = fixture.game.describeSpatialRelation('Cabinet', 'in');
    const bookStack = fixture.game.describeSpatialRelation('BookA', 'on');

    expect(cabinetContents.status).toBe('ok');
    expect(cabinetContents.message).toBe(
      fixture.game.text('parser.relation_contents', {
        Relation: 'In',
        target: 'Cabinet',
        items: 'Book A',
      })
    );
    expect(bookStack.status).toBe('ok');
    expect(bookStack.message).toBe(
      fixture.game.text('parser.relation_contents', {
        Relation: 'On',
        target: 'Book A',
        items: 'Book B',
      })
    );
  });

  it('describeSpatialRelation treats items on untitled nested container extensions as lying on the titled object', () => {
    const fixture = createGameSemanticFixture();
    fixture.addEntity('Desk', {
      title: 'Desk',
      description: 'An office desk.',
    });
    fixture.addEntity('TechHolder', {
      title: null,
      spatial: { parentNodeId: 'Desk', relation: 'on' },
    });
    fixture.addEntity('TechSwitch', {
      title: null,
      spatial: { parentNodeId: 'TechHolder', relation: 'in' },
    });
    fixture.addEntity('SurfaceNode', {
      title: null,
      spatial: { parentNodeId: 'TechSwitch', relation: 'in' },
    });
    fixture.addEntity('note', {
      title: 'Piece of paper',
      description: 'A folded note.',
      spatial: { parentNodeId: 'SurfaceNode', relation: 'on' },
    });

    const populated = fixture.game.describeSpatialRelation('Desk', 'on');

    expect(populated.status).toBe('ok');
    expect(populated.message).toBe(
      fixture.game.text('parser.relation_contents', {
        Relation: 'On',
        target: 'Desk',
        items: 'Piece of paper',
      })
    );
  });

  it('describeSpatialRelation reveals only first-level hidden lookable children', () => {
    const fixture = createGameSemanticFixture();
    fixture.addEntity('Cabinet', {
      title: 'Cabinet',
      description: 'A cabinet.',
    });
    fixture.addEntity('BookA', {
      title: 'Book A',
      description: 'A book inside the cabinet.',
      spatial: { parentNodeId: 'Cabinet', relation: 'in' },
    });
    const bookB = fixture.addEntity('BookB', {
      title: 'Book B',
      description: 'A hidden book on another book.',
      spatial: { parentNodeId: 'BookA', relation: 'on' },
    });
    bookB.hidden = 'lookable';

    const populated = fixture.game.describeSpatialRelation('Cabinet', 'in');

    expect(populated.status).toBe('ok');
    expect(populated.message).toBe(
      fixture.game.text('parser.relation_contents', {
        Relation: 'In',
        target: 'Cabinet',
        items: 'Book A',
      })
    );
    expect(fixture.scene.isHiddenEntityRevealed(bookB)).toBe(false);

    const bookContents = fixture.game.describeSpatialRelation('BookA', 'on');
    expect(bookContents.status).toBe('ok');
    expect(bookContents.message).toBe(
      fixture.game.text('parser.relation_discovered_contents', {
        Relation: 'On',
        target: 'Book A',
        items: 'Book B',
      })
    );
    expect(fixture.scene.isHiddenEntityRevealed(bookB)).toBe(true);
  });

  it('switchTo hydrates external inventory contents from component items and projects their slot relation', () => {
    const fixture = createGameSemanticFixture('start');
    const target = fixture.addScene('storage', 'Storage', 'You are in Storage.');

    const player = new Actor(fixture.game as any, 0, 0, 10, 10, 'Hero');
    player.isPlayer = true;
    target.addEntity(player);
    fixture.textAssets.setObject('Hero', {
      title: 'Hero',
      description: 'Hero player',
    });

    const cabinet = new Entity(fixture.game as any, 10, 0, 10, 10, 'cabinet');
    cabinet.components = [
      {
        type: 'Inventory',
        relation: 'behind',
        capacity: 2,
        groups: [],
        protected: false,
        items: ['book'],
      },
    ];
    target.addEntity(cabinet);
    fixture.textAssets.setObject('cabinet', {
      title: 'Cabinet',
      description: 'A cabinet.',
    });

    const book = new Entity(fixture.game as any, 0, 0, 10, 10, 'book');
    book.components = [{ type: 'Item' }];
    target.addEntity(book);
    fixture.textAssets.setObject('book', {
      title: 'Book',
      description: 'A book.',
    });

    fixture.game.sceneManager.switchTo(target.id);

    expect(fixture.game.getInventoryEntities(cabinet as any, 'behind')).toContain(book);
    expect(book.visible).toBe(false);
    expect((book as any).spatial).toEqual({ parentNodeId: 'cabinet', relation: 'in' });

    const outcome = fixture.game.describeSpatialRelation('cabinet', 'behind');
    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe(
      fixture.game.text('parser.relation_contents', {
        Relation: 'Behind',
        target: 'Cabinet',
        items: 'Book',
      })
    );
  });

  it('switchTo hydrates surface item placements into entity scene state', () => {
    const fixture = createGameSemanticFixture('start');
    const target = fixture.addScene('gallery', 'Gallery', 'You are in Gallery.');

    const player = new Actor(fixture.game as any, 0, 0, 10, 10, 'Hero');
    player.isPlayer = true;
    target.addEntity(player);
    fixture.textAssets.setObject('Hero', {
      title: 'Hero',
      description: 'Hero player',
    });

    const table = new Entity(fixture.game as any, 0, 0, 10, 10, 'table');
    table.layer = 5;
    table.components = [
      {
        type: 'Surface',
        relation: 'on',
        capacity: 2,
        groups: [],
        items: [{ id: 'coin', x: 42, y: 24 }],
      },
    ];
    target.addEntity(table);
    fixture.textAssets.setObject('table', {
      title: 'Table',
      description: 'A table.',
    });

    const coin = new Entity(fixture.game as any, 999, 999, 10, 10, 'coin');
    coin.components = [{ type: 'Item' }];
    target.addEntity(coin);
    fixture.textAssets.setObject('coin', {
      title: 'Coin',
      description: 'A coin.',
    });

    fixture.game.sceneManager.switchTo(target.id);

    expect(fixture.game.getSurfaceEntities(table, 'on')).toContain(coin);
    expect(coin.visible).toBe(true);
    expect(coin.x).toBe(42);
    expect(coin.y).toBe(24);
    expect(coin.layer).toBe(5);
    expect((coin as any).spatial).toEqual({ parentNodeId: 'table', relation: 'on' });
  });

  it('transfers a player actor with inventory and nested spatial descendants to the target scene', () => {
    const fixture = createGameSemanticFixture('start');
    const player = fixture.addPlayer('Hero', 0, 0);
    const target = fixture.addScene('hall', 'Hall', 'A hall.');
    const stalePlayer = new Actor(fixture.game as any, 50, 50, 10, 10, 'OldHero');
    stalePlayer.isPlayer = true;
    target.addEntity(stalePlayer);

    const cassette = fixture.addEntity('cassette', {
      title: 'Cassette',
      description: 'A cassette.',
      components: [{ type: 'Item' }],
    });
    const label = fixture.addEntity('cassette_label', {
      title: 'Cassette label',
      description: 'A label.',
      spatial: { parentNodeId: 'cassette', relation: 'on' },
    });

    expect(fixture.game.addInventoryEntity(player, cassette, 'in').status).toBe('ok');

    const moved = fixture.game.sceneManager.transferActorToScene(player, target.id);

    expect(moved).toBe(target);
    expect(fixture.scene.entities).not.toContain(player);
    expect(fixture.scene.entities).not.toContain(cassette);
    expect(fixture.scene.entities).not.toContain(label);
    expect(target.entities).toContain(player);
    expect(target.entities).toContain(cassette);
    expect(target.entities).toContain(label);
    expect(target.entities).not.toContain(stalePlayer);
    expect(target.player).toBe(player);
    fixture.game.sceneManager.currentScene = target;
    fixture.game.inventoryManager.handleSceneChange();
    expect(fixture.game.inventory).toContain(cassette);
    expect(cassette.visible).toBe(false);
    expect((cassette as any).spatial).toEqual({ parentNodeId: 'Hero', relation: 'in' });
    expect((label as any).spatial).toEqual({ parentNodeId: 'cassette', relation: 'on' });
  });

  it('same-scene actor transfer applies Entry placement without detaching inventory children', () => {
    const fixture = createGameSemanticFixture('start');
    const player = fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A key.',
      components: [{ type: 'Item' }],
    });
    const entry = fixture.addEntity('EntryA', {
      title: null,
      components: [{ type: 'Entry', direction: 'right' }],
    });
    entry.x = 120;
    entry.y = 80;

    expect(fixture.game.addInventoryEntity(player, key, 'in').status).toBe('ok');

    fixture.game.sceneManager.transferActorToScene(player, fixture.scene.id, {
      targetEntryId: 'EntryA',
    });

    expect(fixture.scene.entities).toContain(player);
    expect(fixture.scene.entities).toContain(key);
    expect(player.x).toBe(120);
    expect(player.y).toBe(80);
    expect(key.visible).toBe(false);
    expect((key as any).spatial).toEqual({ parentNodeId: 'Hero', relation: 'in' });
  });

  it('Exit activation transfers the actor through the centralized path and applies Entry placement', () => {
    const fixture = createGameSemanticFixture('start');
    const player = fixture.addPlayer('Hero', 0, 0);
    const target = fixture.addScene('exit_target', 'Exit Target', 'A room.');
    const entry = new Entity(fixture.game as any, 200, 120, 10, 10, 'EntryA');
    entry.components = [{ type: 'Entry', direction: 'left' }];
    target.addEntity(entry);
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A key.',
      components: [{ type: 'Item' }],
    });
    expect(fixture.game.addInventoryEntity(player, key, 'in').status).toBe('ok');
    const exit = fixture.addTriggerbox('ExitA', {
      components: [{ type: 'Exit', targetSceneId: target.id, targetEntryId: 'EntryA' }],
    });

    const handled = ComponentSystem.handleActivation(exit as any, fixture.scene as any, 0, player);

    expect(handled).toBe(true);
    expect(fixture.game.sceneManager.currentScene).toBe(target);
    expect(target.entities).toContain(player);
    expect(target.entities).toContain(key);
    expect(player.x).toBe(200);
    expect(player.y).toBe(120);
    expect((key as any).spatial).toEqual({ parentNodeId: 'Hero', relation: 'in' });
  });

  it('transfers an NPC actor with inventory without making it the scene player', () => {
    const fixture = createGameSemanticFixture('start');
    const player = fixture.addPlayer('Hero', 0, 0);
    const target = fixture.addScene('npc_target', 'NPC Target', 'A room.');
    const npc = new Actor(fixture.game as any, 10, 10, 10, 10, 'NPC');
    npc.components = [
      { type: 'Inventory', relation: 'in', capacity: 2, groups: [], protected: false, items: [] },
    ];
    fixture.scene.addEntity(npc);
    const badge = fixture.addEntity('badge', {
      title: 'Badge',
      description: 'A badge.',
      components: [{ type: 'Item' }],
    });

    expect(fixture.game.addInventoryEntity(npc, badge, 'in').status).toBe('ok');

    fixture.game.sceneManager.transferActorToScene(npc, target.id);

    expect(target.entities).toContain(npc);
    expect(target.entities).toContain(badge);
    expect(target.player).not.toBe(npc);
    expect(fixture.scene.player).toBe(player);
  });

  it('switchTo hydrates untitled nested surface extensions and projects them through the titled anchor', () => {
    const fixture = createGameSemanticFixture('start');
    const target = fixture.addScene('library', 'Library', 'You are in Library.');

    const player = new Actor(fixture.game as any, 0, 0, 10, 10, 'Hero');
    player.isPlayer = true;
    target.addEntity(player);
    fixture.textAssets.setObject('Hero', {
      title: 'Hero',
      description: 'Hero player',
    });

    const desk = new Entity(fixture.game as any, 0, 0, 10, 10, 'desk');
    target.addEntity(desk);
    fixture.textAssets.setObject('desk', {
      title: 'Desk',
      description: 'A desk.',
    });

    const hiddenShelf = new Entity(fixture.game as any, 0, 0, 10, 10, 'hidden_shelf');
    hiddenShelf.spatial = { parentNodeId: 'desk', relation: 'behind' };
    hiddenShelf.components = [
      {
        type: 'Surface',
        relation: 'on',
        capacity: 2,
        groups: [],
        items: [{ id: 'note', x: 11, y: 12 }],
      },
    ];
    target.addEntity(hiddenShelf);
    fixture.textAssets.setObject('hidden_shelf', {
      description: 'Untitled hidden shelf.',
    });

    const note = new Entity(fixture.game as any, 400, 400, 10, 10, 'note');
    note.components = [{ type: 'Item' }];
    target.addEntity(note);
    fixture.textAssets.setObject('note', {
      title: 'Note',
      description: 'A note.',
    });

    fixture.game.sceneManager.switchTo(target.id);

    expect(fixture.game.getSurfaceEntities(hiddenShelf, 'on')).toContain(note);
    expect(note.x).toBe(11);
    expect(note.y).toBe(12);
    expect((note as any).spatial).toEqual({ parentNodeId: 'hidden_shelf', relation: 'on' });

    const outcome = fixture.game.describeSpatialRelation('desk', 'behind');
    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe(
      fixture.game.text('parser.relation_contents', {
        Relation: 'Behind',
        target: 'Desk',
        items: 'Note',
      })
    );
  });

  it('switchTo hydrates untitled nested inventory extensions and projects them through the titled anchor', () => {
    const fixture = createGameSemanticFixture('start');
    const target = fixture.addScene('workshop', 'Workshop', 'You are in Workshop.');

    const player = new Actor(fixture.game as any, 0, 0, 10, 10, 'Hero');
    player.isPlayer = true;
    target.addEntity(player);
    fixture.textAssets.setObject('Hero', {
      title: 'Hero',
      description: 'Hero player',
    });

    const desk = new Entity(fixture.game as any, 0, 0, 10, 10, 'desk');
    target.addEntity(desk);
    fixture.textAssets.setObject('desk', {
      title: 'Desk',
      description: 'A desk.',
    });

    const hiddenHolder = new Entity(fixture.game as any, 0, 0, 10, 10, 'hidden_holder');
    hiddenHolder.spatial = { parentNodeId: 'desk', relation: 'behind' };
    hiddenHolder.components = [
      {
        type: 'Inventory',
        relation: 'behind',
        capacity: 2,
        groups: [],
        protected: false,
        items: ['book'],
      },
    ];
    target.addEntity(hiddenHolder);
    fixture.textAssets.setObject('hidden_holder', {
      description: 'Untitled holder.',
    });

    const book = new Entity(fixture.game as any, 0, 0, 10, 10, 'book');
    book.components = [{ type: 'Item' }];
    target.addEntity(book);
    fixture.textAssets.setObject('book', {
      title: 'Book',
      description: 'A hidden book.',
    });

    fixture.game.sceneManager.switchTo(target.id);

    expect(fixture.game.getInventoryEntities(hiddenHolder as any, 'behind')).toContain(book);
    expect(book.visible).toBe(false);

    const outcome = fixture.game.describeSpatialRelation('desk', 'behind');
    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe(
      fixture.game.text('parser.relation_contents', {
        Relation: 'Behind',
        target: 'Desk',
        items: 'Book',
      })
    );
  });
});
