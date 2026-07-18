import type { IGame } from '../../src/core/IGame';
import type { Scene } from '../../src/scene/Scene';
import type { SceneObject } from '../../src/entities/SceneObject';
import type { SpatialRelationType } from '../../src/scene/spatialTypes';
import { Actor } from '../../src/entities/Actor';
import type { Entity } from '../../src/entities/Entity';
import type { GameActionOutcome } from '../../src/core/GameActionTypes';
import { InventoryManager } from '../../src/systems/InventoryManager';
import { GameSemanticAPI } from '../../src/systems/GameSemanticAPI';
import { ActorNavigationService } from '../../src/systems/ActorNavigationService';
import { ActorWorldQuery } from '../../src/systems/ActorWorldQuery';
import { ActorCommandExecutor } from '../../src/mechanics/ActorCommandExecutor';
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
    getInventoryRelations(entity: Actor) {
      return Array.from(
        new Set(
          (entity.components || [])
            .filter((component: any) => component?.type === 'Inventory')
            .map((component: any) =>
              component?.relation === 'on' ||
              component?.relation === 'under' ||
              component?.relation === 'behind' ||
              component?.relation === 'in'
                ? component.relation
                : 'in'
            )
        )
      );
    },
    collectActorTransferEntities(actor: Actor, sourceScene: Scene | null) {
      const collected = new Set<any>([actor]);
      const queue: any[] = [actor];
      const enqueue = (entity: any) => {
        if (!entity || collected.has(entity)) return;
        collected.add(entity);
        queue.push(entity);
      };

      for (const relation of this.getInventoryRelations(actor)) {
        for (const entity of game.inventoryManager?.getInventoryEntities?.(
          actor as any,
          relation as any
        ) || []) {
          enqueue(entity);
        }
      }

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || !sourceScene) continue;
        for (const candidate of sourceScene.entities) {
          const parentId =
            typeof (candidate as any).spatial?.parentNodeId === 'string'
              ? (candidate as any).spatial.parentNodeId.trim()
              : '';
          if (parentId === current.name) {
            enqueue(candidate);
          }
        }
      }

      return Array.from(collected);
    },
    transferActorToScene(actor: Actor, sceneId: string, options: any = {}) {
      const targetScene = this.scenes.get(sceneId);
      if (!targetScene) return null;

      const oldScene = this.currentScene;
      const removeExistingPlayer = options.removeExistingPlayer ?? !!actor.isPlayer;
      const setAsScenePlayer = options.setAsScenePlayer ?? !!actor.isPlayer;
      const transfersPlayerActor =
        setAsScenePlayer || !!actor.isPlayer || oldScene?.player === actor;
      const activateScene = options.activateScene ?? setAsScenePlayer;
      const entities =
        options.preserveSpatialChildren === false
          ? [actor]
          : this.collectActorTransferEntities(actor, oldScene);

      if (removeExistingPlayer) {
        const existingPlayer = targetScene.entities.find(
          (entity: any) => entity.isPlayer && entity !== actor
        );
        if (existingPlayer) {
          const discard = new Set<any>();
          const queue = [existingPlayer];
          while (queue.length > 0) {
            const current = queue.shift();
            if (!current || discard.has(current)) continue;
            discard.add(current);
            for (const candidate of targetScene.entities) {
              const parentId =
                typeof (candidate as any).spatial?.parentNodeId === 'string'
                  ? (candidate as any).spatial.parentNodeId.trim()
                  : '';
              if (
                parentId === current.name ||
                (typeof (candidate as any).getInventoryPositionOwner === 'function' &&
                  (candidate as any).getInventoryPositionOwner() === current)
              ) {
                queue.push(candidate);
              }
            }
          }
          targetScene.entities = targetScene.entities.filter((entity: any) => !discard.has(entity));
          for (const entity of discard) {
            targetScene.subsceneEntities.delete(entity);
            if (targetScene.player === entity) targetScene.player = null;
            if (typeof entity.setInventoryPositionOwner === 'function') {
              entity.setInventoryPositionOwner(null);
            }
            delete entity.__inventoryRelation;
          }
        }
      }

      if (oldScene && oldScene !== targetScene) {
        for (const entity of entities) {
          const index = oldScene.entities.indexOf(entity);
          if (index >= 0) oldScene.entities.splice(index, 1);
          oldScene.subsceneEntities.delete(entity);
          if (oldScene.player === entity) oldScene.player = null;
        }
        for (const entity of entities) {
          if (!targetScene.entities.includes(entity)) targetScene.entities.push(entity);
          (entity as any).scene = targetScene;
          entity.applySceneCorrectionalScale?.(targetScene);
        }
      } else if (!targetScene.entities.includes(actor)) {
        targetScene.entities.push(actor);
        (actor as any).scene = targetScene;
      }

      if (setAsScenePlayer) {
        targetScene.player = actor;
      }

      const targetEntryId =
        options.targetEntryId ??
        (oldScene !== targetScene
          ? targetScene
              .getAllSceneObjects()
              .find((object: any) =>
                object.components?.some((component: any) => component.type === 'Entry')
              )?.name || null
          : null);
      let placedAtEntry = false;
      if (targetEntryId) {
        const entryObj = targetScene.getObjectByName(targetEntryId);
        const entryComp = entryObj?.components?.find(
          (component: any) => component.type === 'Entry'
        );
        const poly = (entryObj as any)?.poly as { x: number; y: number }[] | undefined;
        if (entryComp && Array.isArray(poly) && poly.length > 0) {
          actor.x = poly.reduce((sum, point) => sum + point.x, 0) / poly.length;
          actor.y = poly.reduce((sum, point) => sum + point.y, 0) / poly.length;
        } else if (entryComp && entryObj && 'x' in entryObj && 'y' in entryObj) {
          actor.x = (entryObj as any).x;
          actor.y = (entryObj as any).y;
        }
        if (entryComp) {
          placedAtEntry = true;
          actor.layer = entryObj.layer;
          actor.parallax = entryObj.parallax;
          if (!targetScene.isWalkable(actor.x, actor.y, actor)) {
            const startX = actor.x;
            const startY = actor.y;
            const step = 4;
            const maxRadius = Math.max(128, actor.colliderWidth * 2, actor.colliderHeight * 8);
            let placed = false;
            for (let radius = step; radius <= maxRadius && !placed; radius += step) {
              for (let dx = -radius; dx <= radius && !placed; dx += step) {
                for (let dy = -radius; dy <= radius; dy += step) {
                  if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
                  const x = startX + dx;
                  const y = startY + dy;
                  if (targetScene.isWalkable(x, y, actor)) {
                    actor.x = x;
                    actor.y = y;
                    placed = true;
                    break;
                  }
                }
              }
            }
          }
          if (entryComp.direction && typeof (actor as any).setDirection === 'function') {
            (actor as any).setDirection(entryComp.direction);
          }
          actor.update?.(0);
        }
      }
      if (oldScene === targetScene && placedAtEntry) {
        actor.resumePlannedMovementAfterLocalTeleport?.();
      }
      if (transfersPlayerActor && oldScene !== targetScene && targetScene.defaultCamera) {
        targetScene.camera.zoom = targetScene.defaultCamera.zoom;
      }
      if (activateScene) {
        this.currentScene = targetScene;
        if (oldScene !== targetScene) {
          targetScene.clearParserRecentTurns?.();
        }
        game.inventoryManager?.handleSceneChange?.();
      }
      return targetScene;
    },
    switchTo(sceneId: string, activator?: Actor) {
      const targetScene = this.scenes.get(sceneId);
      if (!targetScene) return;

      const oldScene = this.currentScene;
      if (activator) {
        this.transferActorToScene(activator, sceneId, {
          targetEntryId: this.pendingEntryId,
          activateScene: false,
        });
      }
      this.pendingEntryId = null;

      this.currentScene = targetScene;
      if (oldScene !== targetScene) {
        targetScene.clearParserRecentTurns?.();
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
    actorNavigation: {} as any,
    actorWorld: {} as any,
    actorCommands: {} as any,
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
    lookEntityForActor(actor: Actor | null, entity: SceneObject, options?: any) {
      return (this as any).semantic.lookEntityForActor(actor, entity, options);
    },
    describeSpatialRelation(_anchorNodeId: string, _relation: SpatialRelationType) {
      return notImplementedOutcome('not_implemented_describe_spatial_relation');
    },
    examineEntity(_entity: Entity) {
      return notImplementedOutcome('not_implemented_examine_entity');
    },
    examineEntityForActor(actor: Actor | null, entity: SceneObject, options?: any) {
      return (this as any).semantic.examineEntityForActor(actor, entity, options);
    },
    openEntity(_entity: Entity) {
      return notImplementedOutcome('not_implemented_open_entity');
    },
    openEntityForActor(actor: Actor | null, entity: SceneObject) {
      return (this as any).semantic.openEntityForActor(actor, entity);
    },
    closeEntity(_entity: Entity) {
      return notImplementedOutcome('not_implemented_close_entity');
    },
    closeEntityForActor(actor: Actor | null, entity: SceneObject) {
      return (this as any).semantic.closeEntityForActor(actor, entity);
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
    takeEntityForActor(actor: Actor | null, entity: Entity) {
      return (this as any).semantic.takeEntityForActor(actor, entity);
    },
    putEntity(entity: Entity, target?: SceneObject | null, options?: any) {
      return (this as any).semantic.putEntity(entity, target, options);
    },
    putEntityForActor(
      actor: Actor | null,
      entity: Entity,
      target?: SceneObject | null,
      options?: any
    ) {
      return (this as any).semantic.putEntityForActor(actor, entity, target, options);
    },
    addInventoryEntity(owner: Entity, entity: Entity, relation: any = 'in') {
      return this.inventoryManager.addInventoryEntity(owner, entity, relation);
    },
    removeEntityFromInventory(owner: Entity, entity: Entity, relation: any = 'in') {
      return this.inventoryManager.removeEntityFromInventory(owner, entity, relation);
    },
    hasInventoryEntity(owner: Entity, entity: Entity, relation: any = 'in') {
      return this.inventoryManager.hasInventoryEntity(owner, entity, relation);
    },
    getInventoryEntities(owner: Entity, relation: any = 'in') {
      return this.inventoryManager.getInventoryEntities(owner, relation);
    },
    addEntityToSurface(
      surface: SceneObject,
      entity: Entity,
      relation: any = 'on',
      options: any = {}
    ) {
      return this.inventoryManager.addEntityToSurface(
        surface,
        entity,
        relation,
        this.getSwitchComponent.bind(this),
        options
      );
    },
    removeEntityFromSurface(surface: SceneObject, entity: Entity, relation: any = 'on') {
      return this.inventoryManager.removeEntityFromSurface(surface, entity, relation);
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
      this.sceneManager.switchTo(sceneId, this.sceneManager.currentScene?.player);
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
    wakeNpc(_actor: Actor, _reason?: string) {},
    openFileBrowser() {},
    setCommandInput() {},
    getCommandInput() {
      return null;
    },
    focusCommandInput() {},
    revealCommandCursor() {},
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
  game.actorNavigation = new ActorNavigationService(game);
  game.actorWorld = new ActorWorldQuery(game);
  game.actorCommands = new ActorCommandExecutor(game);
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

    if (game.inventoryManager.hasEntityIdInInventory(entity)) {
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
      const authoredTakeFailure = textAssets.getResolvedObjectField(entity, 'takeFailure')?.trim();
      const genericTakeFailure = textAssets.getServiceText('parser.take_cannot');
      const useAuthoredFailure = !!authoredTakeFailure && errorMsg === genericTakeFailure;
      return {
        status: 'failed',
        code: 'cannot_take',
        message: useAuthoredFailure ? authoredTakeFailure : errorMsg,
        data: { entityId: entity.name },
        recoverable: useAuthoredFailure ? false : true,
      };
    }

    const isItem = entity.components?.some((component: any) => component?.type === 'Item');
    if (!isItem && !entity.isTakeable) {
      const authoredTakeFailure = textAssets.getResolvedObjectField(entity, 'takeFailure')?.trim();
      return {
        status: 'failed',
        code: 'not_takeable',
        message: authoredTakeFailure || textAssets.getServiceText('parser.take_cannot'),
        data: { entityId: entity.name },
        recoverable: authoredTakeFailure ? false : true,
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
