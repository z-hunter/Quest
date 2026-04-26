import type { IGame } from '../../src/core/IGame';
import type { Scene } from '../../src/scene/Scene';
import type { SceneObject } from '../../src/entities/SceneObject';
import type { SpatialRelationType } from '../../src/scene/spatialTypes';
import { Actor } from '../../src/entities/Actor';
import type { Entity } from '../../src/entities/Entity';
import type { GameActionOutcome } from '../../src/core/GameActionTypes';
import { InventoryManager } from '../../src/systems/InventoryManager';
import { GameSemanticAPI } from '../../src/systems/GameSemanticAPI';
import { createTestTextAssets } from './textAssetFactory';
import { ComponentSystem } from '../../src/systems/ComponentSystem';

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

  const sceneManager: any = {
    currentScene: null,
    scenes: new Map(),
    sceneRegistry: new Map(),
    pendingEntryId: null,
    switchTo(sceneId: string, activator?: Actor) {
      const targetScene = this.scenes.get(sceneId);
      if (!targetScene) return;

      const oldScene = this.currentScene;
      if (activator && oldScene && oldScene !== targetScene) {
        oldScene.removeEntity(activator);
        targetScene.addEntity(activator);
        if (activator.isPlayer) {
          targetScene.player = activator;
        }
      }

      this.currentScene = targetScene;

      if (this.pendingEntryId) {
        const entryObj = targetScene.getObjectByName(this.pendingEntryId);
        const entryComp = entryObj?.components?.find(
          (component: any) => component.type === 'Entry'
        );
        const poly = (entryObj as any)?.poly as { x: number; y: number }[] | undefined;
        if (activator && entryComp && Array.isArray(poly) && poly.length > 0) {
          activator.x = poly.reduce((sum, point) => sum + point.x, 0) / poly.length;
          activator.y = poly.reduce((sum, point) => sum + point.y, 0) / poly.length;
          if (entryComp.direction && typeof (activator as any).setDirection === 'function') {
            (activator as any).setDirection(entryComp.direction);
          }
        }
        this.pendingEntryId = null;
      }

      game.inventoryManager?.handleSceneChange?.();
    },
  };

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
    sceneManager: sceneManager as any,
    editor: {
      enabled: false,
      selectionManager: {
        notifyObjectChanged() {},
      },
    } as any,
    inventoryManager: {} as any,
    semantic: {} as any,
    get inventory() {
      return (this.inventoryManager as any)?.inventory || [];
    },
    getInventoryPreviewEntity() {
      return (this.inventoryManager as any)?.getInventoryPreviewEntity?.() || null;
    },
    getInventoryPreviewText() {
      return (this.inventoryManager as any)?.getInventoryPreviewText?.() || null;
    },
    openInventoryPreview(entity: Entity, previewText?: string | null) {
      (this.inventoryManager as any)?.openInventoryPreview?.(entity, previewText);
    },
    closeInventoryPreview() {
      (this.inventoryManager as any)?.closeInventoryPreview?.();
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
    isEntityInInventory(entity: Entity) {
      return this.inventoryManager.isEntityInInventory(entity);
    },
    getBlockedAccessOutcome(entity: SceneObject) {
      return this.semantic.getBlockedAccessOutcome(entity);
    },
    getSurfacePutMessage(
      surface: SceneObject,
      item: Entity,
      relation: SpatialRelationType | null,
      target?: SceneObject | null
    ) {
      return this.semantic.getSurfacePutMessage(surface, item, relation, target);
    },
    getSwitchComponent(entity: SceneObject) {
      return this.semantic.getSwitchComponent(entity);
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
    closeFocusedView() {
      const previewEntity = (this.inventoryManager as any)?.getInventoryPreviewEntity?.() || null;
      if (previewEntity) {
        (this.inventoryManager as any)?.closeInventoryPreview?.();
        return {
          status: 'ok',
          code: 'inventory_preview_closed',
          data: { entityId: previewEntity.name },
          effects: ['inventory_preview_closed'],
        };
      }
      const activeSubscene = this.sceneManager.currentScene?.activeSubscene || null;
      if (activeSubscene) {
        this.sceneManager.currentScene!.activeSubscene = null;
        return {
          status: 'ok',
          code: 'subscene_closed',
          data: { subsceneId: activeSubscene },
          effects: ['subscene_closed'],
        };
      }
      return {
        status: 'escalate',
        code: 'no_active_view_to_close',
        recoverable: true,
      };
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
    goToScene(sceneId: string) {
      this.sceneManager.switchTo(sceneId);
      return {
        status: 'ok',
        code: 'scene_changed',
        data: { sceneId },
        effects: ['scene_changed'],
      };
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
    input: {
      mouse: { x: 0, y: 0, clicked: false },
      isDown: () => false,
    },
    isMouseOverUI: false,
    canvas: {} as HTMLCanvasElement,
    ctx: null,
    bufferCanvas: {} as HTMLCanvasElement,
  };

  sceneManager.game = game;

  game.inventoryManager = new InventoryManager(
    game.sceneManager as any,
    textAssets as any,
    game.text.bind(game)
  );
  game.semantic = new GameSemanticAPI(game);

  (game as any).canTakeEntity = (entity: Entity): GameActionOutcome | null => {
    const scene = game.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: textAssets.getServiceText('parser.parse_unknown'),
        recoverable: false,
      };
    }

    if (game.inventoryManager.isEntityInInventory(entity)) {
      return {
        status: 'failed',
        code: 'item_already_held',
        message: textAssets.getServiceText('parser.take_already_held', {
          item: textAssets.getResolvedObjectField(entity, 'title') || entity.name,
        }),
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    const inventoryOwner = (game.inventoryManager as any).findInventoryOwnerForEntity?.(entity);
    const errorMsg = ComponentSystem.canTakeItem(entity, scene.player);
    if (errorMsg) {
      return {
        status: 'failed',
        code: 'cannot_take',
        message: errorMsg,
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    const isItem = entity.components?.some((component: any) => component?.type === 'Item');
    if (!isItem && !entity.isTakeable) {
      return {
        status: 'failed',
        code: 'not_takeable',
        message: textAssets.getServiceText('parser.take_cannot'),
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    if (
      inventoryOwner &&
      !(game.inventoryManager as any).isInventoryAccessible?.(inventoryOwner, () => null)
    ) {
      return {
        status: 'failed',
        code: 'inventory_not_accessible',
        message: textAssets.getServiceText('parser.take_cannot'),
        data: { entityId: entity.name, ownerId: inventoryOwner.name },
        recoverable: true,
      };
    }

    return null;
  };

  (game as any).canPutSourceEntity = (entity: Entity): GameActionOutcome | null => {
    if (game.inventoryManager.isEntityInInventory(entity)) return null;
    return (game as any).canTakeEntity(entity);
  };

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
