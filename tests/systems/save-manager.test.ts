import { describe, expect, it, vi } from 'vitest';
import { Console } from '../../src/core/Console';
import { Entity } from '../../src/entities/Entity';
import { Actor } from '../../src/entities/Actor';
import { Scene } from '../../src/scene/Scene';
import { SceneManager } from '../../src/scene/SceneManager';
import { SaveManager } from '../../src/systems/SaveManager';
import { createTestGame } from '../fixtures/gameFactory';

function createHarness() {
  const harness = createTestGame();
  const game = harness.game as any;
  const manager = Object.create(SceneManager.prototype) as SceneManager;
  Object.assign(manager as any, {
    game,
    currentScene: null,
    scenes: new Map(),
    sceneRegistry: new Map(),
    authoredSceneData: new Map(),
    sceneRuntimeSnapshots: new Map(),
    sceneCacheMeta: new Map(),
    sceneCacheBudget: 100000,
    pendingEntryId: null,
  });
  game.sceneManager = manager;
  (game.inventoryManager as any).sceneManager = manager;

  const room = new Scene(game, 'room', 'Room');
  const hall = new Scene(game, 'hall', 'Hall');
  const player = new Actor(game, 5, 6, 10, 10, 'hero');
  player.isPlayer = true;
  player.components = [{ type: 'Inventory', relation: 'in', items: [], capacity: 99, groups: [] }];
  room.addEntity(player);
  const npc = new Actor(game, 20, 30, 10, 10, 'guard');
  npc.components = [
    { type: 'Actor' },
    { type: 'NPC', memory: '', objectives: ['Patrol'], knownEntities: {} },
    { type: 'Inventory', relation: 'in', items: [], capacity: 4, groups: [] },
  ];
  room.addEntity(npc);
  const key = new Entity(game, 1, 1, 4, 4, 'key');
  key.components = [{ type: 'Item' }];
  room.addEntity(key);

  for (const scene of [room, hall]) {
    const data = scene.toJSON();
    (manager as any).authoredSceneData.set(scene.id, structuredClone(data));
    manager.sceneRegistry.set(scene.id, {
      id: scene.id,
      path: `${scene.id}.json`,
      name: scene.name,
      title: scene.name,
      sourceData: structuredClone(data),
      lastIndexed: Date.now(),
    });
    manager.scenes.set(scene.id, scene);
  }
  manager.currentScene = room;

  game.console = new Console(game);
  game.score = 0;
  game.parser = { pendingState: null };
  game.npcPuppetMaster = {
    haltAllNpcs: vi.fn(),
    exportSaveState: () => ({ actionHistories: {}, continuations: [] }),
    importSaveState: vi.fn(),
  };
  game.saveManager = new SaveManager(game);
  return { game, manager, room, hall, player, npc, key };
}

describe('SaveManager', () => {
  it('restores scene/NPC/item deltas, discoveries, parser and console runtime state', () => {
    const { game, manager, room, hall, npc, key } = createHarness();
    room.entities = room.entities.filter((entity) => entity !== npc && entity !== key);
    hall.addEntity(npc);
    hall.addEntity(key);
    npc.x = 77;
    const npcComponent = npc.components.find((component: any) => component.type === 'NPC') as any;
    npcComponent.memory = 'The key was found.';
    npcComponent.objectives = ['Deliver the key to the archive'];
    npcComponent.knownEntities = {
      key: {
        id: 'key',
        title: 'Brass key',
        kind: 'item',
        lastSeenSceneId: 'hall',
        lastSeenAt: 1234,
        lastSeenLocation: {
          sceneId: 'hall',
          relation: 'in',
          targetId: 'guard',
          targetTitle: 'Guard',
        },
      },
    };
    const inventory = npc.components.find(
      (component: any) => component.type === 'Inventory'
    ) as any;
    inventory.items = ['key'];
    key.spatial = { parentNodeId: 'guard', relation: 'in' };
    key.visible = false;
    room.revealedHiddenEntities.add('secret');
    room.setParserNote('Door checked');
    room.markParserNoteNeedsCheck();
    room.setEntityParserNote('secret', 'The hidden panel is unlocked.');
    room.markEntityParserNoteNeedsCheck('secret');
    room.addParserRecentTurn('look at wall', 'A hidden panel is visible.');
    hall.setEntityParserNote('guard', 'The guard intends to deliver the key.');
    hall.markEntityParserNoteNeedsCheck('guard');
    game.parser.pendingState = {
      intent: 'take',
      question: 'Which key?',
      originalInput: 'take key',
    };
    game.console.addHistory('TAKE KEY');
    game.console.parserLlmEnabled = true;
    game.score = 42;
    manager.currentScene = hall;
    (manager as any).evictScene('room');

    // Exercise the file boundary as well as the in-memory restore path.
    const state = JSON.parse(JSON.stringify(game.saveManager.createState('slot one')));

    npcComponent.memory = 'corrupted';
    game.console.history = [];
    game.console.parserLlmEnabled = false;
    game.parser.pendingState = null;
    game.score = 0;
    game.saveManager.restoreState(state);

    const restoredRoom = manager.scenes.get('room')!;
    const restoredHall = manager.scenes.get('hall')!;
    const restoredNpc = restoredHall.getObjectByName('guard') as Actor;
    const restoredKey = restoredHall.getObjectByName('key') as Entity;
    expect(restoredRoom.getObjectByName('guard')).toBeNull();
    expect(restoredNpc.x).toBe(77);
    expect(
      (restoredNpc.components.find((component: any) => component.type === 'NPC') as any).memory
    ).toBe('The key was found.');
    const restoredNpcComponent = restoredNpc.components.find(
      (component: any) => component.type === 'NPC'
    ) as any;
    expect(restoredNpcComponent.objectives).toEqual(['Deliver the key to the archive']);
    expect(restoredNpcComponent.knownEntities).toEqual({
      key: {
        id: 'key',
        title: 'Brass key',
        kind: 'item',
        lastSeenSceneId: 'hall',
        lastSeenAt: 1234,
        lastSeenLocation: {
          sceneId: 'hall',
          relation: 'in',
          targetId: 'guard',
          targetTitle: 'Guard',
        },
      },
    });
    expect(restoredKey.spatial).toEqual({ parentNodeId: 'guard', relation: 'in' });
    expect(restoredRoom.revealedHiddenEntities.has('secret')).toBe(true);
    expect(restoredRoom.getParserNote()).toBe('Door checked');
    expect(restoredRoom.getParserNoteNeedsCheck()).toBe(true);
    expect(restoredRoom.getEntityParserNote('secret')).toBe('The hidden panel is unlocked.');
    expect(restoredRoom.getEntityParserNoteNeedsCheck('secret')).toBe(true);
    expect(restoredRoom.getParserRecentTurns()).toEqual([
      { command: 'look at wall', response: 'A hidden panel is visible.' },
    ]);
    expect(restoredHall.getEntityParserNote('guard')).toBe('The guard intends to deliver the key.');
    expect(restoredHall.getEntityParserNoteNeedsCheck('guard')).toBe(true);
    expect(game.parser.pendingState?.question).toBe('Which key?');
    expect(game.console.history).toEqual(['TAKE KEY']);
    expect(game.console.parserLlmEnabled).toBe(true);
    expect(game.score).toBe(42);
  });

  it('normalizes safe save filenames and rejects traversal-like names', () => {
    expect(SaveManager.pathFor('slot one')).toBe('saves/slot_one.json');
    expect(() => SaveManager.pathFor('../slot')).toThrow('Save name');
  });

  it('rejects a save when its authored scene compatibility manifest no longer matches', () => {
    const { game } = createHarness();
    const state = game.saveManager.createState('slot');
    state.compatibility.authoredSceneHashes.room = 'fnv1a32:00000000';

    expect(() => game.saveManager.restoreState(state)).toThrow(
      "Save is incompatible with authored scene 'room'"
    );
  });
});
