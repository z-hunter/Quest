import { Entity } from '../../src/entities/Entity';
import { Actor } from '../../src/entities/Actor';
import { Triggerbox } from '../../src/entities/Triggerbox';
import { Walkbox } from '../../src/entities/Walkbox';
import { Scene } from '../../src/scene/Scene';
import type { SpatialPlacement, SpatialRelationType } from '../../src/scene/spatialTypes';
import { createTestGame, type TestGameHarness } from './gameFactory';

type EntityOptions = {
  title?: string | null;
  description?: string;
  lore?: string | string[];
  objectives?: string[];
  takeFailure?: string;
  disabled?: boolean;
  groupID?: string | null;
  components?: any[];
  spatial?: SpatialPlacement;
  semanticTags?: string[];
  relationFacts?: Array<Record<string, unknown>>;
};

type TriggerboxOptions = {
  scene?: Scene;
  title?: string | null;
  description?: string;
  details?: string;
  lore?: string | string[];
  disabled?: boolean;
  groupID?: string | null;
  components?: any[];
  spatial?: SpatialPlacement;
};

export type SceneFixture = TestGameHarness & {
  scene: Scene;
  addScene(id: string, name?: string, description?: string): Scene;
  addEntity(name: string, options?: EntityOptions): Entity;
  addPlayer(name?: string, x?: number, y?: number): Actor;
  addTriggerbox(name: string, options?: TriggerboxOptions): Triggerbox;
  addWalkbox(name: string, relation?: SpatialRelationType): Walkbox;
};

const DEFAULT_POLY = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

export function createSceneFixture(sceneId: string = 'test_scene'): SceneFixture {
  const harness = createTestGame();
  const scene = new Scene(harness.game, sceneId, 'Test Scene');
  harness.game.sceneManager.currentScene = scene;
  harness.game.sceneManager.scenes.set(sceneId, scene);
  harness.game.sceneManager.sceneRegistry.set(sceneId, {
    id: sceneId,
    path: `${sceneId}.json`,
    name: scene.name,
    title: scene.name,
    sourceData: null,
    lastIndexed: Date.now(),
  });
  harness.textAssets.setScene(scene.id, {
    title: scene.name,
    description: scene.description,
  });

  return {
    ...harness,
    scene,
    addScene(id, name = id, description = '') {
      const nextScene = new Scene(harness.game, id, name);
      nextScene.description = description;
      harness.game.sceneManager.scenes.set(id, nextScene);
      harness.game.sceneManager.sceneRegistry.set(id, {
        id,
        path: `${id}.json`,
        name,
        title: name,
        sourceData: null,
        lastIndexed: Date.now(),
      });
      harness.textAssets.setScene(id, {
        title: name,
        description,
      });
      return nextScene;
    },
    addEntity(name, options = {}) {
      const entity = new Entity(harness.game, 0, 0, 10, 10, name);
      entity.description = options.description || `Description for ${name}`;
      entity.disabled = options.disabled ?? false;
      entity.groupID = options.groupID ?? null;
      entity.components = options.components || [];
      entity.spatial = options.spatial || {};
      scene.addEntity(entity);
      harness.textAssets.setObject(name, {
        ...(options.title === null
          ? {}
          : { title: options.title !== undefined ? options.title : name }),
        description: entity.description,
        lore: options.lore,
        objectives: options.objectives,
        takeFailure: options.takeFailure,
        semanticTags: options.semanticTags,
        relationFacts: options.relationFacts as any,
      });
      return entity;
    },
    addPlayer(name = 'Hero', x = 0, y = 0) {
      const player = new Actor(harness.game, x, y, 10, 10, name);
      player.isPlayer = true;
      player.components = [
        {
          type: 'Inventory',
          relation: 'in',
          capacity: Number.MAX_SAFE_INTEGER,
          groups: [],
          items: [],
        },
      ];
      scene.addEntity(player);
      harness.textAssets.setObject(name, {
        title: name,
        description: `${name} player`,
      });
      return player;
    },
    addTriggerbox(name, options = {}) {
      const targetScene = options.scene || harness.game.sceneManager.currentScene || scene;
      const triggerbox = new Triggerbox(DEFAULT_POLY, name, '');
      triggerbox.disabled = options.disabled ?? false;
      triggerbox.groupID = options.groupID ?? null;
      triggerbox.components = options.components || [];
      triggerbox.spatial = options.spatial || {};
      targetScene.triggerboxes.push(triggerbox);
      (triggerbox as any).scene = targetScene;
      harness.textAssets.setObject(name, {
        ...(options.title === null
          ? {}
          : { title: options.title !== undefined ? options.title : name }),
        description: options.description || `${name} triggerbox`,
        details: options.details,
        lore: options.lore,
      });
      return triggerbox;
    },
    addWalkbox(name, relation) {
      const walkbox = new Walkbox(DEFAULT_POLY, name);
      if (relation) {
        walkbox.spatial = { parentNodeId: scene.id, relation };
      }
      scene.walkbox.push(walkbox);
      return walkbox;
    },
  };
}
