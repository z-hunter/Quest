import type { IGame } from '../../src/core/IGame';
import type { Scene } from '../../src/scene/Scene';
import type { SceneObject } from '../../src/entities/SceneObject';
import type { SpatialRelationType } from '../../src/scene/spatialTypes';
import type { Entity } from '../../src/entities/Entity';
import type { GameActionOutcome } from '../../src/core/GameActionTypes';
import { InventoryManager } from '../../src/core/InventoryManager';
import { createTestTextAssets } from './textAssetFactory';

export type TestGameHarness = {
  game: IGame;
  messages: string[];
  logs: string[];
  sounds: string[];
  notifications: string[];
  textAssets: ReturnType<typeof createTestTextAssets>;
};

function notImplementedOutcome(code: string): GameActionOutcome {
  return {
    status: 'failed',
    code,
    recoverable: false,
  };
}

export function createTestGame(): TestGameHarness {
  const messages: string[] = [];
  const logs: string[] = [];
  const sounds: string[] = [];
  const notifications: string[] = [];
  const textAssets = createTestTextAssets();

  const game: IGame = {
    assets: {
      setImageCacheBudget() {},
      markSceneSpriteRefs() {},
      syncSceneCacheState() {},
      renameSceneSpriteRefs() {},
      releaseSceneSpriteRefs() {},
      getImageCacheStats() {
        return { budgetBytes: 0, estimatedBytes: 0 };
      },
      estimateSpritesTextureBytes: async () => ({ bytes: 0 }),
    } as any,
    audio: {} as any,
    textAssets: textAssets as any,
    sceneManager: {
      currentScene: null,
      scenes: new Map(),
      sceneRegistry: new Map(),
      switchTo() {},
    } as any,
    editor: {
      enabled: false,
      selectionManager: {
        notifyObjectChanged() {},
      },
    } as any,
    inventoryManager: {} as any,
    get inventory() {
      return (this.inventoryManager as any)?.inventory || [];
    },
    showMessage(text: string) {
      messages.push(text);
    },
    log(text: string) {
      logs.push(text);
      messages.push(text);
    },
    text(key: string, params?: Record<string, string | number>) {
      return textAssets.getServiceText(key, params);
    },
    getSeeMessage(_target: SceneObject) {
      return null;
    },
    lookScene(_scene?: Scene | null) {
      return notImplementedOutcome('not_implemented_look_scene');
    },
    lookEntity(_entity: Entity) {
      return notImplementedOutcome('not_implemented_look_entity');
    },
    describeSpatialRelation(_anchorNodeId: string, _relation: SpatialRelationType) {
      return notImplementedOutcome('not_implemented_describe_spatial_relation');
    },
    examineEntity(_entity: Entity) {
      return notImplementedOutcome('not_implemented_examine_entity');
    },
    openEntity(_entity: Entity) {
      return notImplementedOutcome('not_implemented_open_entity');
    },
    closeEntity(_entity: Entity) {
      return notImplementedOutcome('not_implemented_close_entity');
    },
    takeEntity(_entity: Entity) {
      return notImplementedOutcome('not_implemented_take_entity');
    },
    putEntity(_entity: Entity, _target?: SceneObject | null) {
      return notImplementedOutcome('not_implemented_put_entity');
    },
    addInventoryEntity(_owner: Entity, _entity: Entity) {
      return notImplementedOutcome('not_implemented_add_inventory_entity');
    },
    removeEntityFromInventory(_owner: Entity, _entity: Entity) {
      return notImplementedOutcome('not_implemented_remove_entity_from_inventory');
    },
    hasInventoryEntity(_owner: Entity, _entity: Entity) {
      return false;
    },
    getInventoryEntities(_owner: Entity) {
      return [];
    },
    addEntityToSurface(_surface: SceneObject, _entity: Entity) {
      return notImplementedOutcome('not_implemented_add_entity_to_surface');
    },
    removeEntityFromSurface(_surface: SceneObject, _entity: Entity) {
      return notImplementedOutcome('not_implemented_remove_entity_from_surface');
    },
    removeInventoryEntity(_entity: Entity) {
      return notImplementedOutcome('not_implemented_remove_inventory_entity');
    },
    showInventory() {
      return notImplementedOutcome('not_implemented_show_inventory');
    },
    goToSceneTarget(_target: string) {
      return notImplementedOutcome('not_implemented_go_to_scene_target');
    },
    goToScene(_sceneId: string) {
      return notImplementedOutcome('not_implemented_go_to_scene');
    },
    goToEntity(_entity: Entity) {
      return notImplementedOutcome('not_implemented_go_to_entity');
    },
    showNotification(text: string) {
      notifications.push(text);
    },
    playSound(name: string) {
      sounds.push(name);
    },
    openFileBrowser() {},
    setCommandInput() {},
    getCommandInput() {
      return null;
    },
    focusCommandInput() {},
    input: {},
    isMouseOverUI: false,
    canvas: {} as HTMLCanvasElement,
    ctx: null,
    bufferCanvas: {} as HTMLCanvasElement,
  };

  game.inventoryManager = new InventoryManager(
    game.sceneManager as any,
    textAssets as any,
    game.text.bind(game)
  );

  (game as any).inventoryEntityStore = new Map();

  return {
    game,
    messages,
    logs,
    sounds,
    notifications,
    textAssets,
  };
}
