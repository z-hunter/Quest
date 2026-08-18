import { describe, it, expect, vi } from 'vitest';
import { createSceneFixture } from '../fixtures/sceneFactory';
import { Actor } from '../../src/entities/Actor';
import { QuadObject } from '../../src/entities/QuadObject';
import { SceneManager } from '../../src/scene/SceneManager';

describe('Scene Transitions (Exit/Entry)', () => {
  it('transitions an actor to another scene and places it at the Entry point', async () => {
    const fixture = createSceneFixture();
    const sceneA = fixture.scene;
    const game = fixture.game;
    const sceneManager = game.sceneManager;

    // 1. Setup Scene B (destination)
    const sceneB = fixture.addScene('scene-b', 'Scene B');

    // Switch manager's focus to Scene B temporarily to add trigger there
    sceneManager.currentScene = sceneB;
    const entryObj = fixture.addTriggerbox('entry-1', {
      components: [{ type: 'Entry', direction: 'right' }],
    });
    entryObj.poly = [
      { x: 100, y: 100 },
      { x: 120, y: 100 },
      { x: 120, y: 120 },
      { x: 100, y: 120 },
    ];

    // 2. Setup Scene A with Exit
    sceneManager.currentScene = sceneA;
    const exitObj = fixture.addTriggerbox('exit-1', {
      components: [{ type: 'Exit', targetSceneId: 'scene-b', targetEntryId: 'entry-1' }],
    });
    exitObj.poly = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];

    // 3. Add Actor to Scene A (as player so exit triggers scene switch)
    const actor = new Actor(game, 50, 50);
    (actor as any).game = game;
    actor.name = 'hero';
    actor.isPlayer = true;
    sceneA.entities.push(actor);
    sceneA.player = actor;

    // 4. Move Actor into Exit trigger
    actor.x = 10;
    actor.y = 10;

    // 5. Run update loop to trigger collision
    sceneA.update(16);

    // Assertions
    expect(sceneManager.currentScene?.id).toBe('scene-b');

    // Check placement at Entry center (110, 110)
    expect(actor.x).toBe(110);
    expect(actor.y).toBe(110);

    expect(actor.direction).toBe('right');
  });

  it('supports same-scene transition when targetSceneId is empty', () => {
    const fixture = createSceneFixture();
    const scene = fixture.scene;
    const game = fixture.game;
    const sceneManager = game.sceneManager;

    const player = fixture.addPlayer('player', 50, 50);
    (player as any).game = game;

    const entryObj = fixture.addTriggerbox('entry-1', {
      components: [{ type: 'Entry' }],
    });
    entryObj.poly = [
      { x: 200, y: 200 },
      { x: 210, y: 200 },
      { x: 210, y: 210 },
      { x: 200, y: 210 },
    ];

    const emitActorAction = vi.fn();
    (game as any).emitActorAction = emitActorAction;
    const exitObj = fixture.addTriggerbox('exit-1', {
      components: [
        { type: 'Exit', targetSceneId: '', targetEntryId: 'entry-1', navigationOnly: true },
      ],
    });
    exitObj.poly = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];

    player.x = 5;
    player.y = 5;
    scene.update(16);

    expect(sceneManager.currentScene?.id).toBe(scene.id);
    expect(player.x).toBe(205);
    expect(player.y).toBe(205);
    expect(emitActorAction).toHaveBeenCalledWith(player, 'left_immediate_area');
  });

  it('replans an active route after a same-scene Exit places an actor at its Entry', () => {
    const fixture = createSceneFixture();
    const scene = fixture.scene;
    const sceneManager = fixture.game.sceneManager;
    const player = fixture.addPlayer('player', 5, 5);

    const entryObj = fixture.addTriggerbox('entry-1', {
      components: [{ type: 'Entry' }],
    });
    entryObj.poly = [
      { x: 200, y: 200 },
      { x: 210, y: 200 },
      { x: 210, y: 210 },
      { x: 200, y: 210 },
    ];

    const exitObj = fixture.addTriggerbox('exit-1', {
      components: [{ type: 'Exit', targetSceneId: scene.id, targetEntryId: 'entry-1' }],
    });
    exitObj.poly = [
      { x: 40, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 20 },
      { x: 40, y: 20 },
    ];

    // This represents a worker route produced before the actor touched the Exit.
    player.startPlannedRoute({ x: 300, y: 205 }, [
      { x: 50, y: 5 },
      { x: 300, y: 205 },
    ]);

    expect(sceneManager.currentScene).toBe(scene);
    expect((player as any).plannedMoveTarget).toEqual({ x: 300, y: 205 });
    sceneManager.transferActorToScene(player, scene.id, { targetEntryId: 'entry-1' });

    expect(player.state).toBe('walk');
    expect(player.getMoveResult()).toMatchObject({ status: 'started', target: { x: 300, y: 205 } });
    expect(player.target).toEqual({ x: 300, y: 205 });
    expect(player.route).toEqual([{ x: 300, y: 205 }]);
  });

  it('works with Exit component on an Entity', () => {
    const fixture = createSceneFixture();
    const sceneA = fixture.scene;
    const game = fixture.game;
    const sceneManager = game.sceneManager;

    const sceneB = fixture.addScene('scene-b', 'Scene B');
    sceneManager.currentScene = sceneB;
    const entryObj = fixture.addTriggerbox('entry-1', {
      components: [{ type: 'Entry' }],
    });
    entryObj.poly = [
      { x: 100, y: 100 },
      { x: 110, y: 100 },
      { x: 110, y: 110 },
      { x: 100, y: 110 },
    ];

    sceneManager.currentScene = sceneA;
    const door = fixture.addEntity('door', {
      components: [{ type: 'Exit', targetSceneId: 'scene-b', targetEntryId: 'entry-1' }],
    });
    door.x = 10;
    door.y = 10;
    door.baseWidth = 20;
    door.baseHeight = 20;

    const actor = new Actor(game, 50, 50);
    (actor as any).game = game;
    actor.isPlayer = true;
    sceneA.entities.push(actor);
    sceneA.player = actor;

    // Collision
    actor.x = 10;
    actor.y = 10;
    sceneA.update(16);

    expect(sceneManager.currentScene?.id).toBe('scene-b');
    expect(actor.x).toBe(105);
    expect(actor.y).toBe(105);

    // VERIFY: The door entity should NOT have moved to sceneB
    expect(sceneB.entities).not.toContain(door);
    expect(sceneA.entities).toContain(door);
  });

  it('checks an Exit Quad against the actor visual collider under parallax', () => {
    const fixture = createSceneFixture();
    const sceneA = fixture.scene;
    const game = fixture.game;
    const sceneManager = game.sceneManager;

    sceneA.camera.x = 100;
    sceneA.camera.y = 0;

    const sceneB = fixture.addScene('scene-b', 'Scene B');
    sceneManager.currentScene = sceneB;
    const entryObj = fixture.addTriggerbox('entry-1', {
      components: [{ type: 'Entry' }],
    });
    entryObj.poly = [
      { x: 100, y: 100 },
      { x: 110, y: 100 },
      { x: 110, y: 110 },
      { x: 100, y: 110 },
    ];

    sceneManager.currentScene = sceneA;
    const exitQuad = new QuadObject(game, 'exit-quad');
    exitQuad.vertices = [
      { x: 0, y: 0, p: 1.5 },
      { x: 20, y: 0, p: 1.5 },
      { x: 20, y: 20, p: 1.5 },
      { x: 0, y: 20, p: 1.5 },
    ];
    exitQuad.components = [{ type: 'Exit', targetSceneId: 'scene-b', targetEntryId: 'entry-1' }];
    sceneA.addEntity(exitQuad);

    const actor = new Actor(game, -40, 10);
    actor.name = 'hero';
    actor.isPlayer = true;
    actor.parallax = 1.5;
    actor.colliderWidth = 4;
    actor.colliderHeight = 4;
    sceneA.addEntity(actor);
    sceneA.player = actor;

    sceneA.update(16);
    expect(sceneManager.currentScene?.id).toBe(sceneA.id);

    actor.x = 10;
    actor.y = 10;
    sceneA.update(16);

    expect(sceneManager.currentScene?.id).toBe('scene-b');
    expect(actor.x).toBe(105);
    expect(actor.y).toBe(105);
  });

  it('keeps Entry placement walkable after destination depth scaling changes the collider', () => {
    const fixture = createSceneFixture();
    const game = fixture.game;
    const scene = fixture.scene;
    const manager = new SceneManager(game);
    game.sceneManager = manager;
    manager.currentScene = scene;
    manager.scenes.set(scene.id, scene);

    const floor = new QuadObject(game, 'floor');
    floor.vertices = [
      { x: -158.78036469627548, y: -9.782594419843486, p: 0.6 },
      { x: 203.21963530372452, y: -10.782594419843486, p: 0.6 },
      { x: 450, y: 112, p: 1 },
      { x: -309, y: 112, p: 1 },
    ];
    floor.components = [
      { type: 'WalkBox', mode: 'Invert' },
      { type: 'Depth scaling controller', min: 0.5, max: 1 },
      { type: '3d-parallax' },
    ];
    scene.addEntity(floor);

    const entry = fixture.addTriggerbox('ex', {
      components: [{ type: 'Entry', direction: 'down' }],
    });
    entry.poly = [
      { x: 280.6394173477212, y: -6.72046583123894 },
      { x: 335, y: 41 },
      { x: 191.63941734772118, y: 37.27953416876106 },
    ];

    const sourceX = -229.17067976099196;
    const sourceY = -100.80698746858366;
    const targetX = 269.0929448984808;
    const targetY = 23.85302277917404;
    const actor = new Actor(game, targetX, targetY, 10, 10, 'Hero');
    actor.isPlayer = true;
    actor.modelScale = 0.84;
    actor.colliderWidth = 88;
    actor.colliderHeight = 4;
    actor.parallax = 1;
    actor.spatial = { parentNodeId: floor.name, relation: 'on' };
    scene.addEntity(actor);
    scene.player = actor;
    actor.update(0);
    scene.update(16);
    actor.x = sourceX;
    actor.y = sourceY;
    actor.update(0);
    expect((actor as any).__surfaceParallaxBinding).toBeDefined();

    manager.transferActorToScene(actor, scene.id, {
      targetEntryId: entry.name,
      activateScene: false,
    });

    expect(scene.isWalkable(actor.x, actor.y, actor)).toBe(true);
    scene.update(16);
    expect(scene.isWalkable(actor.x, actor.y, actor)).toBe(true);
  });
});
