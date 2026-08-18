import { describe, expect, it, vi } from 'vitest';
import { createGameSemanticFixture } from '../fixtures/gameSemanticFactory';
import { Actor } from '../../src/entities/Actor';
import { Entity } from '../../src/entities/Entity';
import { Triggerbox } from '../../src/entities/Triggerbox';
import { Walkbox } from '../../src/entities/Walkbox';
import { QuadObject } from '../../src/entities/QuadObject';
import { ComponentSystem } from '../../src/systems/ComponentSystem';

describe('Game navigation and spatial API', () => {
  it('measures interaction distance from the center of an Actor', () => {
    const fixture = createGameSemanticFixture();
    const actor = fixture.addPlayer('Hero', 0, 100);
    actor.width = 40;
    actor.height = 100;
    actor.colliderWidth = 40;
    const headLevelTarget = fixture.addEntity('head_level_target', {
      title: 'Head-level target',
    });
    headLevelTarget.x = 40;
    headLevelTarget.y = 0;
    const floorLevelTarget = fixture.addEntity('floor_level_target', {
      title: 'Floor-level target',
    });
    floorLevelTarget.x = 40;
    floorLevelTarget.y = 100;

    expect(ComponentSystem.getInteractionDistanceError(headLevelTarget, actor)).toBeNull();
    expect(ComponentSystem.getInteractionDistanceError(floorLevelTarget, actor)).toBeNull();
  });

  it('measures interaction distance to Quad vertices instead of its editor anchor', () => {
    const fixture = createGameSemanticFixture();
    const actor = fixture.addPlayer('Hero', 1, 50);
    actor.width = 40;
    const door = new QuadObject(fixture.game, 'door');
    door.x = 1000;
    door.y = -500;
    door.vertices = [
      { x: 50, y: 0, p: 1 },
      { x: 100, y: 0, p: 1 },
      { x: 100, y: 100, p: 1 },
      { x: 50, y: 100, p: 1 },
    ];
    fixture.scene.addEntity(door);

    expect(ComponentSystem.getInteractionDistanceError(door, actor)).toBeNull();
    expect(fixture.game.actorNavigation.planApproach(actor, door).status).toBe('already_reachable');
  });

  it('resolves nested inventory item geometry through the outer scene owner', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 50);
    const cabinet = fixture.addEntity('cabinet', {
      title: 'Cabinet',
      components: [{ type: 'Inventory', capacity: 2, groups: [], protected: false, items: [] }],
    });
    cabinet.x = 20;
    cabinet.y = 50;
    const caseEntity = fixture.addEntity('case', {
      title: 'Case',
      components: [{ type: 'Inventory', capacity: 2, groups: [], protected: false, items: [] }],
    });
    caseEntity.x = 500;
    caseEntity.y = 500;
    const item = fixture.addEntity('item', {
      title: 'Item',
      components: [{ type: 'Item' }],
    });
    item.x = 900;
    item.y = 900;
    (item as any).vertices = [
      { x: 880, y: 880 },
      { x: 920, y: 880 },
      { x: 920, y: 920 },
      { x: 880, y: 920 },
    ];

    fixture.game.addInventoryEntity(cabinet, caseEntity, 'in');
    fixture.game.addInventoryEntity(caseEntity, item, 'in');

    expect(item.x).toBe(cabinet.x);
    expect(item.y).toBe(cabinet.y);
    expect(fixture.game.inventoryManager.getSceneObjectReferencePoint(item)).toEqual({
      x: cabinet.x,
      y: cabinet.y,
    });
    expect(ComponentSystem.getInteractionDistanceError(item, player)).toBeNull();
    expect(fixture.game.actorNavigation.planApproach(player, item).status).toBe(
      'already_reachable'
    );
  });

  it('treats nested inventory contents as held by any owning Actor', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 50);
    const npc = new Actor(fixture.game, 400, 50, 30, 60, 'NPC');
    npc.components = [
      { type: 'Inventory', relation: 'in', capacity: 2, groups: [], protected: false, items: [] },
    ];
    fixture.scene.addEntity(npc);
    const remote = fixture.addEntity('remote', {
      title: 'Remote',
      components: [{ type: 'Inventory', capacity: 2, groups: [], protected: false, items: [] }],
    });
    const batteries = fixture.addEntity('batteries', {
      title: 'AAA batteries',
      components: [{ type: 'Item' }],
    });

    fixture.game.addInventoryEntity(npc, remote, 'in');
    fixture.game.addInventoryEntity(remote, batteries, 'in');

    expect(fixture.game.inventoryManager.isEntityWithinActorInventory(npc, batteries)).toBe(true);
    expect(fixture.game.actorWorld.getObjectPerception(npc, batteries)).toMatchObject({
      interaction: 'held',
      approach: 'already_reachable',
    });
    expect(
      fixture.game.inventoryManager.isEntityWithinActorInventory(fixture.scene.player!, batteries)
    ).toBe(false);
  });

  it('hydrates editor-authored spatial inventory children when component items are empty', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 50);
    const remote = fixture.addEntity('tv_rc', {
      title: 'TV remote',
      components: [
        { type: 'Item' },
        { type: 'Inventory', relation: 'in', capacity: 1, groups: [], protected: false, items: [] },
      ],
    });
    const batteries = fixture.addEntity('batteryAAA', {
      title: 'AAA batteries',
      spatial: { parentNodeId: 'tv_rc', relation: 'in' },
      components: [{ type: 'Item' }],
    });
    batteries.x = 1019;
    batteries.y = 344;

    fixture.game.inventoryManager.handleSceneChange();
    expect(fixture.game.inventoryManager.getInventoryEntities(remote, 'in')).toContain(batteries);
    expect(batteries.getInventoryPositionOwner()).toBe(remote);

    fixture.game.addInventoryEntity(player, remote, 'in');

    expect(fixture.game.inventoryManager.isEntityWithinActorInventory(player, batteries)).toBe(
      true
    );
    expect(fixture.game.actorWorld.getObjectPerception(player, batteries)).toMatchObject({
      interaction: 'held',
      approach: 'already_reachable',
    });
  });

  it('keeps spatial IN children renderable when their parent has no Inventory', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 50);
    fixture.addEntity('window1', { title: 'Window', components: [] });
    const cityView = fixture.addEntity('CityView', {
      title: 'City view',
      visible: false,
      spatial: { parentNodeId: 'window1', relation: 'in' },
      components: [
        { type: 'Inventory', relation: 'in', capacity: 2, groups: [], protected: false, items: [] },
      ],
    });

    fixture.game.inventoryManager.handleSceneChange();

    expect(cityView.visible).toBe(true);
    expect(cityView.getInventoryPositionOwner()).toBeNull();
    expect(cityView.spatial).toEqual({ parentNodeId: 'window1', relation: 'in' });
  });

  it('does not derive interaction reach from visual width when an Actor collider is disabled', () => {
    const fixture = createGameSemanticFixture();
    const actor = fixture.addPlayer('Hero', 0, 50);
    actor.width = 150;
    actor.colliderWidth = 0;
    actor.colliderHeight = 0;
    const floor = new Walkbox(
      [
        { x: -50, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 100 },
        { x: -50, y: 100 },
      ],
      'Walk_main'
    );
    floor.mode = 'Add';
    fixture.scene.addWalkbox(floor);
    const target = fixture.addEntity('target', { title: 'Target' });
    target.x = 200;
    target.y = 50;

    expect(ComponentSystem.getInteractionDistanceError(target, actor)).not.toBeNull();
    expect(fixture.game.actorNavigation.planApproach(actor, target).status).toBe('route_available');
  });

  it('keeps fast approach status pathfinder-free for a target with no known route', () => {
    const fixture = createGameSemanticFixture();
    const actor = fixture.addPlayer('Hero', 0, 50);
    actor.colliderWidth = 8;
    actor.colliderHeight = 8;
    const floor = new Walkbox(
      [
        { x: -50, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: -50, y: 100 },
      ],
      'Floor'
    );
    floor.mode = 'Add';
    fixture.scene.addWalkbox(floor);
    const target = fixture.addEntity('remote_island', { title: 'Remote island' });
    target.x = 1000;
    target.y = 50;

    const previewRoute = vi.spyOn(actor, 'previewWalkingRouteTo');
    const planApproach = vi.spyOn(fixture.game.actorNavigation, 'planApproach');

    expect(fixture.game.actorNavigation.getFastApproachStatus(actor, target)).toBe(
      'route_available'
    );
    expect(previewRoute).not.toHaveBeenCalled();
    expect(planApproach).not.toHaveBeenCalled();
    expect(fixture.game.actorNavigation.planApproach(actor, target).status).toBe('unreachable');
  });

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
    player.colliderWidth = 8;
    player.colliderHeight = 8;
    const floor = new Walkbox(
      [
        { x: -20, y: -20 },
        { x: 300, y: -20 },
        { x: 300, y: 140 },
        { x: -20, y: 140 },
      ],
      'Floor'
    );
    floor.mode = 'Add';
    fixture.scene.addWalkbox(floor);
    chair.x = 220;
    chair.y = 80;
    chair.colliderWidth = 60;
    chair.colliderHeight = 30;

    const outcome = fixture.game.goToEntity(chair);

    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe(fixture.game.text('parser.go_to_success', { target: 'Chair' }));
    expect(player.getMoveResult().status).toBe('started');
    expect(player.getMoveResult().target).not.toEqual({ x: chair.x, y: chair.y });
    expect(
      fixture.scene.isWalkable(
        player.getMoveResult().target!.x,
        player.getMoveResult().target!.y,
        player
      )
    ).toBe(true);
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

  it('switchTo keeps the entity transform and ignores legacy surface coordinates', () => {
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
    expect(coin.x).toBe(999);
    expect(coin.y).toBe(999);
    expect(coin.layer).toBe(5);
    expect((coin as any).spatial).toEqual({ parentNodeId: 'table', relation: 'on' });
    expect(table.toJSON().components).toEqual([
      { type: 'Surface', relation: 'on', capacity: 2, groups: [], items: [{ id: 'coin' }] },
    ]);
  });

  it('transfers a player actor with inventory and nested spatial descendants to the target scene', () => {
    const fixture = createGameSemanticFixture('start');
    const player = fixture.addPlayer('Hero', 0, 0);
    const target = fixture.addScene('hall', 'Hall', 'A hall.');
    const stalePlayer = new Actor(fixture.game as any, 50, 50, 10, 10, 'OldHero');
    stalePlayer.isPlayer = true;
    target.addEntity(stalePlayer);
    fixture.game.inventoryManager.ensureInventoryComponent(stalePlayer, 'in');
    const staleCassette = new Entity(fixture.game as any, 0, 0, 10, 10, 'stale_cassette');
    staleCassette.components = [{ type: 'Item' }];
    staleCassette.spatial = { parentNodeId: stalePlayer.name, relation: 'in' };
    target.addEntity(staleCassette);
    fixture.game.inventoryManager.addInventoryEntity(stalePlayer, staleCassette, 'in');
    expect(staleCassette.getInventoryPositionOwner()).toBe(stalePlayer);
    expect(fixture.game.inventory).not.toContain(staleCassette);

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
    expect(target.entities).not.toContain(staleCassette);
    expect(target.player).toBe(player);
    fixture.game.sceneManager.currentScene = target;
    fixture.game.inventoryManager.handleSceneChange();
    expect(fixture.game.inventory).toContain(cassette);
    expect(fixture.game.inventory).not.toContain(staleCassette);
    expect(cassette.visible).toBe(false);
    expect((cassette as any).spatial).toEqual({ parentNodeId: 'Hero', relation: 'in' });
    expect((label as any).spatial).toEqual({ parentNodeId: 'cassette', relation: 'on' });
  });

  it('resets target camera zoom when transferring the current scene player actor', () => {
    const fixture = createGameSemanticFixture('start');
    const player = new Actor(fixture.game as any, 0, 0, 10, 10, 'Hero');
    fixture.scene.addEntity(player);
    fixture.scene.player = player;
    const target = fixture.addScene('zoom_target', 'Zoom Target', 'A room.');
    target.defaultCamera = { x: 10, y: 20, zoom: 0.55 };
    target.camera = { x: 99, y: 88, zoom: 2.5 };

    fixture.game.sceneManager.transferActorToScene(player, target.id);

    expect(target.camera.zoom).toBe(0.55);
  });

  it('nudges Entry placement to the nearest walkable actor-collider position', () => {
    const fixture = createGameSemanticFixture('start');
    const player = fixture.addPlayer('Hero', 0, 0);
    player.colliderWidth = 88;
    player.colliderHeight = 4;
    const target = fixture.addScene('edge_entry_target', 'Edge Entry Target', 'A room.');
    const walkbox = new Walkbox(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      'Walk_main'
    );
    walkbox.mode = 'Add';
    target.addWalkbox(walkbox);
    const entry = new Triggerbox(
      [
        { x: 90, y: 50 },
        { x: 96, y: 54 },
        { x: 96, y: 46 },
      ],
      'Entry',
      ''
    );
    entry.components = [{ type: 'Entry', direction: 'left' }];
    target.addTriggerbox(entry);

    fixture.game.sceneManager.transferActorToScene(player, target.id);

    expect(player.x).toBeLessThan(90);
    expect(target.isWalkable(player.x, player.y, player)).toBe(true);
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
    expect(fixture.scene.entities).not.toContain(npc);
    expect(fixture.scene.entities).not.toContain(badge);
    expect(npc.scene).toBe(target);
    expect(target.player).not.toBe(npc);
    expect(fixture.scene.player).toBe(player);

    // The player remains in `start`, but the NPC must still be transferred
    // from its actual offscreen scene rather than from `currentScene`.
    fixture.game.sceneManager.transferActorToScene(npc, fixture.scene.id);

    expect(fixture.scene.entities).toContain(npc);
    expect(fixture.scene.entities).toContain(badge);
    expect(target.entities).not.toContain(npc);
    expect(target.entities).not.toContain(badge);
    expect(npc.scene).toBe(fixture.scene);
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
    expect(note.x).toBe(400);
    expect(note.y).toBe(400);
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

  it('proportionally scales colliderWidth and colliderHeight with scale', () => {
    const fixture = createGameSemanticFixture('start');
    const entity = fixture.addEntity('test_object', {
      title: 'Test Object',
      description: 'A test object.',
    });

    // 1. Initial scale 1.0
    entity.scale = 1.0;
    entity.colliderWidth = 10;
    entity.colliderHeight = 20;

    expect(entity.colliderWidth).toBe(10);
    expect(entity.colliderHeight).toBe(20);

    // 2. Scale up to 2.0
    entity.scale = 2.0;
    expect(entity.colliderWidth).toBe(20);
    expect(entity.colliderHeight).toBe(40);

    // 3. Edit collider values when scale is 2.0
    entity.colliderWidth = 50; // should set base to 25
    entity.colliderHeight = 10; // should set base to 5

    expect(entity.colliderWidth).toBe(50);
    expect(entity.colliderHeight).toBe(10);

    // 4. Serialize to JSON
    const data = entity.toJSON();
    expect(data.colliderWidth).toBe(25); // serialized base value
    expect(data.colliderHeight).toBe(5); // serialized base value

    // 5. Load serialized data into another entity
    const loadedEntity = new Entity(fixture.game as any, 0, 0, 30, 30, 'loaded_object');
    loadedEntity.load(data);
    loadedEntity.scale = 1.0;

    // Now scale is 1.0, so should match serialized base value
    expect(loadedEntity.colliderWidth).toBe(25);
    expect(loadedEntity.colliderHeight).toBe(5);

    // Scale to 0.5
    loadedEntity.scale = 0.5;
    expect(loadedEntity.colliderWidth).toBe(12.5);
    expect(loadedEntity.colliderHeight).toBe(2.5);
  });

  it('allows an Actor to walk between bordering Walkbox objects and Quad Walkboxes', () => {
    const fixture = createGameSemanticFixture();
    const actor = fixture.addPlayer('Hero', 98, 50); // Standing near the border of two walkboxes
    actor.colliderWidth = 8;
    actor.colliderHeight = 8;

    // Standard walkbox from x = 0 to 100
    const floor = new Walkbox(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      'standard_floor'
    );
    floor.mode = 'Add';
    fixture.scene.addWalkbox(floor);

    // Quad walkbox from x = 101 to 201 (creating a 1px misalignment gap)
    const quad = new QuadObject(fixture.game, 'quad_floor');
    quad.vertices = [
      { x: 101, y: 0, p: 1 },
      { x: 201, y: 0, p: 1 },
      { x: 201, y: 100, p: 1 },
      { x: 101, y: 100, p: 1 },
    ];
    quad.components = [
      {
        id: 'quad-wb-comp',
        type: 'WalkBox',
        mode: 'Add',
      },
    ];
    fixture.scene.addEntity(quad);

    // Actor's collider spans from x = 94 to x = 102
    // It should be walkable because it is fully inside the union of positive walkboxes
    expect(fixture.scene.isWalkable(98, 50, actor)).toBe(true);

    // Verify it is also walkable at x = 100 (exactly inside the 1-pixel gap)
    expect(fixture.scene.isWalkable(100, 50, actor)).toBe(true);

    // Verify it is not walkable if we step completely out of bounds (e.g. x = 205)
    expect(fixture.scene.isWalkable(205, 50, actor)).toBe(false);

    // --- Strict Exterior Boundary Checks ---
    // Left edge of standard_floor is at x = 0.
    // Actor with colliderWidth = 8, at x = 3 has collider left at -1. Should be blocked.
    expect(fixture.scene.isWalkable(3, 50, actor)).toBe(false);
    // Actor at x = 4 has collider left at 0. Should be walkable.
    expect(fixture.scene.isWalkable(4, 50, actor)).toBe(true);

    // Right edge of quad_floor is at x = 201.
    // Actor at x = 197 has collider right at 201. Should be walkable.
    expect(fixture.scene.isWalkable(197, 50, actor)).toBe(true);
    // Actor at x = 198 has collider right at 202. Should be blocked.
    expect(fixture.scene.isWalkable(198, 50, actor)).toBe(false);
  });

  it('planApproach returns unreachable quickly without hanging when target is in a disconnected walkbox', () => {
    const fixture = createGameSemanticFixture();
    const actor = fixture.addPlayer('Hero', 0, 50);
    actor.colliderWidth = 8;
    actor.colliderHeight = 8;

    // Room 1 (Player is here)
    const floor1 = new Walkbox(
      [
        { x: -50, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: -50, y: 100 },
      ],
      'Floor1'
    );
    floor1.mode = 'Add';
    fixture.scene.addWalkbox(floor1);

    // Room 2 (Target is here, disconnected)
    const floor2 = new Walkbox(
      [
        { x: 200, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 100 },
        { x: 200, y: 100 },
      ],
      'Floor2'
    );
    floor2.mode = 'Add';
    fixture.scene.addWalkbox(floor2);

    const target = fixture.addEntity('target', { title: 'Target' });
    target.x = 300;
    target.y = 50;

    const startTime = Date.now();
    const plan = fixture.game.actorNavigation.planApproach(actor, target);
    const duration = Date.now() - startTime;

    expect(plan.status).toBe('unreachable');
    expect(duration).toBeLessThan(1000);
  });

  it('ranks actor-connected approach points ahead of nearer-to-target dead ends', () => {
    const fixture = createGameSemanticFixture();
    const actor = fixture.addPlayer('Hero', 0, 50);
    actor.colliderWidth = 8;
    actor.colliderHeight = 8;

    const actorFloor = new Walkbox(
      [
        { x: -50, y: 0 },
        { x: 230, y: 0 },
        { x: 230, y: 100 },
        { x: -50, y: 100 },
      ],
      'ActorFloor'
    );
    actorFloor.mode = 'Add';
    fixture.scene.addWalkbox(actorFloor);

    const target = fixture.addEntity('door', { title: 'Door' });
    target.x = 200;
    target.y = 50;
    target.interactionDistance = 100;
    vi.spyOn(actor, 'previewWalkingRouteTo').mockImplementation((x, y) =>
      x <= 190 ? [{ x, y }] : null
    );

    expect(fixture.game.actorNavigation.getFastApproachStatus(actor, target)).toBe(
      'route_available'
    );
    const plan = fixture.game.actorNavigation.planApproach(actor, target);
    expect(plan.status).toBe('route_available');
    expect(plan.point?.x).toBeLessThanOrEqual(190);
  });

  it('routes an NPC from the left test_room walkbox to the door approach', () => {
    const fixture = createGameSemanticFixture('test_room');
    const npc = fixture.addPlayer('NPC', -156, 271);
    npc.isPlayer = false;
    npc.width = 92.6065;
    npc.colliderWidth = 44;
    npc.colliderHeight = 8;
    npc.parallax = 1.0318;

    for (const [name, poly] of [
      [
        'Walk_left',
        [
          { x: -79, y: 346 },
          { x: -81, y: 272 },
          { x: 153, y: 272 },
          { x: 153, y: 346 },
        ],
      ],
      [
        'Walk_main',
        [
          { x: 82, y: 192 },
          { x: 407, y: 195 },
          { x: 408, y: 203 },
          { x: 470, y: 207 },
          { x: 596, y: 220 },
          { x: 624, y: 211 },
          { x: 1341, y: 210 },
          { x: 1405, y: 283 },
          { x: -234, y: 291 },
          { x: -210, y: 247 },
          { x: -111, y: 249 },
          { x: 77, y: 194 },
        ],
      ],
      [
        'Walk_door',
        [
          { x: 1397, y: 326 },
          { x: 1402, y: 256 },
          { x: 1135, y: 261 },
          { x: 1148, y: 338 },
          { x: 1377, y: 337 },
        ],
      ],
    ] as const) {
      const walkbox = new Walkbox(
        poly.map((point) => ({ ...point })),
        name
      );
      walkbox.mode = 'Add';
      fixture.scene.addWalkbox(walkbox);
    }

    const chair = new Entity(fixture.game, 100.56, 249.75, 10, 10, 'Chair');
    chair.colliderWidth = 78;
    chair.colliderHeight = 18;
    fixture.scene.addEntity(chair);

    expect(npc.previewRouteTo(1320, 220)).not.toBeNull();
    const door = new QuadObject(fixture.game, 'door');
    door.x = 1402.7035;
    door.y = -36.0563;
    door.vertices = [
      { x: 1352.7035, y: -136.0563, p: 1 },
      { x: 1396, y: -144, p: 1 },
      { x: 1396, y: 246, p: 1 },
      { x: 1354, y: 215, p: 1 },
    ];
    fixture.scene.addEntity(door);
    expect(fixture.game.actorNavigation.planApproach(npc, door).status).toBe('route_available');
  });
});
