import { describe, it, expect } from 'vitest';
import { createSceneFixture } from '../fixtures/sceneFactory';
import { Actor } from '../../src/entities/Actor';
import { SceneManager } from '../../src/scene/SceneManager';

describe('Scene Cache Eviction', () => {
  it('preserves autonomous NPC scenes when over soft budget but under hard budget threshold', () => {
    const fixture = createSceneFixture('current_scene');
    const manager = new SceneManager(fixture.game);
    fixture.game.sceneManager = manager;
    manager.currentScene = fixture.scene;
    (manager as any).sceneCacheBudget = 100;

    // Normal scene (no autonomous NPCs)
    const normalScene = fixture.addScene('normal_scene', 'Normal Scene');
    (manager as any).cacheScene(normalScene, false);
    const normalMeta = (manager as any).sceneCacheMeta.get('normal_scene');
    if (normalMeta) {
      normalMeta.graphWeightUnits = 60;
      normalMeta.totalWeightUnits = 60;
      normalMeta.lastAccessed = Date.now() - 2000;
    }

    // Autonomous NPC scene
    const autoScene = fixture.addScene('auto_scene', 'Auto Scene');
    const autoNpc = new Actor(fixture.game, 0, 0, 10, 10, 'npc_1');
    autoNpc.disabled = false;
    autoNpc.isPlayer = false;
    autoNpc.components = [{ type: 'NPC', enabled: true }];
    autoScene.addEntity(autoNpc);

    (manager as any).cacheScene(autoScene, false);
    const autoMeta = (manager as any).sceneCacheMeta.get('auto_scene');
    if (autoMeta) {
      autoMeta.graphWeightUnits = 60;
      autoMeta.totalWeightUnits = 60;
      autoMeta.lastAccessed = Date.now() - 1000;
    }

    // Total memory = 60 + 60 = 120 (budget = 100, hard limit = 150)
    (manager as any).evictScenesIfNeeded();

    // normalScene should be evicted, autoScene should remain cached
    expect(manager.scenes.has('normal_scene')).toBe(false);
    expect(manager.scenes.has('auto_scene')).toBe(true);
  });

  it('evicts eligible autonomous NPC scenes in LRU order when exceeding hard over-budget threshold', () => {
    const fixture = createSceneFixture('current_scene');
    const manager = new SceneManager(fixture.game);
    fixture.game.sceneManager = manager;
    manager.currentScene = fixture.scene;
    (manager as any).sceneCacheBudget = 100;

    // Older autonomous scene
    const autoSceneOld = fixture.addScene('auto_scene_old', 'Auto Scene Old');
    const npcOld = new Actor(fixture.game, 0, 0, 10, 10, 'npc_old');
    npcOld.disabled = false;
    npcOld.isPlayer = false;
    npcOld.components = [{ type: 'NPC', enabled: true }];
    autoSceneOld.addEntity(npcOld);

    (manager as any).cacheScene(autoSceneOld, false);
    const oldMeta = (manager as any).sceneCacheMeta.get('auto_scene_old');
    if (oldMeta) {
      oldMeta.graphWeightUnits = 100;
      oldMeta.totalWeightUnits = 100;
      oldMeta.lastAccessed = Date.now() - 5000;
    }

    // Newer autonomous scene
    const autoSceneNew = fixture.addScene('auto_scene_new', 'Auto Scene New');
    const npcNew = new Actor(fixture.game, 0, 0, 10, 10, 'npc_new');
    npcNew.disabled = false;
    npcNew.isPlayer = false;
    npcNew.components = [{ type: 'NPC', enabled: true }];
    autoSceneNew.addEntity(npcNew);

    (manager as any).cacheScene(autoSceneNew, false);
    const newMeta = (manager as any).sceneCacheMeta.get('auto_scene_new');
    if (newMeta) {
      newMeta.graphWeightUnits = 100;
      newMeta.totalWeightUnits = 100;
      newMeta.lastAccessed = Date.now() - 1000;
    }

    // Total memory = 200 (budget = 100, hard limit = 150) -> Exceeds hard limit
    (manager as any).evictScenesIfNeeded();

    // Older autonomous scene should be evicted first (LRU), newer auto scene remains
    expect(manager.scenes.has('auto_scene_old')).toBe(false);
    expect(manager.scenes.has('auto_scene_new')).toBe(true);
    expect((manager as any).sceneRuntimeSnapshots.has('auto_scene_old')).toBe(true);
  });

  it('never evicts current or pinned scenes even when exceeding hard over-budget threshold', () => {
    const fixture = createSceneFixture('current_scene');
    const manager = new SceneManager(fixture.game);
    fixture.game.sceneManager = manager;
    manager.currentScene = fixture.scene;
    (manager as any).sceneCacheBudget = 50;

    (manager as any).cacheScene(fixture.scene, false);
    const currentMeta = (manager as any).sceneCacheMeta.get('current_scene');
    if (currentMeta) {
      currentMeta.graphWeightUnits = 100;
      currentMeta.totalWeightUnits = 100;
      currentMeta.lastAccessed = Date.now();
      currentMeta.pinned = false;
    }

    // Pinned autonomous scene
    const pinnedScene = fixture.addScene('pinned_scene', 'Pinned Scene');
    const npcPinned = new Actor(fixture.game, 0, 0, 10, 10, 'npc_pinned');
    npcPinned.disabled = false;
    npcPinned.isPlayer = false;
    npcPinned.components = [{ type: 'NPC', enabled: true }];
    pinnedScene.addEntity(npcPinned);

    (manager as any).cacheScene(pinnedScene, true);
    const pinnedMeta = (manager as any).sceneCacheMeta.get('pinned_scene');
    if (pinnedMeta) {
      pinnedMeta.graphWeightUnits = 100;
      pinnedMeta.totalWeightUnits = 100;
      pinnedMeta.lastAccessed = Date.now() - 10000;
      pinnedMeta.pinned = true;
    }

    // Total memory = 200 (budget = 50, hard limit = 75)
    (manager as any).evictScenesIfNeeded();

    // Current and pinned scenes must be protected
    expect(manager.scenes.has('current_scene')).toBe(true);
    expect(manager.scenes.has('pinned_scene')).toBe(true);
  });
});
