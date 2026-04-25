import { Entity } from '../entities/Entity';
import { SceneObject } from '../entities/SceneObject';
import { Scene } from '../scene/Scene';
import type { SpatialRelationType } from '../scene/spatialTypes';
import type { GameActionOutcome } from '../core/GameActionTypes';
import type { IGame } from '../core/IGame';
import { ComponentSystem } from './ComponentSystem';
import type { SwitchComponent } from './ComponentSystem';
import type { InventorySlotRef } from './InventoryManager';
import {
  buildSceneTextLayerSnapshot,
  getActiveBlockingComponentState,
  getInactiveSubsceneAncestors,
  getSceneTextLayerAccessState,
  getSceneTextRelationAccessStates,
  getSceneTextRelationDescendants,
  getSceneTextTargetDescriptor,
} from '../scene/SceneTextLayer';
import { ScriptRegistry } from '../core/ScriptRegistry';
import { Geometry } from '../utils/Geometry';

export type PutTargetTextDescriptor = {
  title: string;
  relation: SpatialRelationType;
};

export type RelationScopedTakeCandidates =
  | { status: 'resolved'; candidates: Entity[]; hasStorage: boolean }
  | GameActionOutcome;

export class GameSemanticAPI {
  private game: IGame;

  constructor(game: IGame) {
    this.game = game;
  }

  // --- Helper Methods ---

  private getPlayerFacingObjectTitle(target: SceneObject): string | null {
    const title = this.game.textAssets.getResolvedObjectField(target as any, 'title');
    return title && title.trim() ? title.trim() : null;
  }

  private getRelationDisplayText(relation: SpatialRelationType): string {
    switch (relation) {
      case 'in':
        return 'in';
      case 'on':
        return 'on';
      case 'under':
        return 'under';
      case 'behind':
        return 'behind';
      default:
        return relation;
    }
  }

  private capitalize(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  }

  private formatTitleList(items: string[]): string {
    if (items.length <= 1) return items[0] || '';
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  }

  private getPutTargetDescriptor(
    target: SceneObject | null | undefined,
    fallbackRelation?: SpatialRelationType | null
  ): PutTargetTextDescriptor | null {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return null;
    return getSceneTextTargetDescriptor(scene, this.game, target, fallbackRelation);
  }

  private getPutSuccessMessage(
    itemTitle: string,
    targetTitle: string,
    relation: SpatialRelationType
  ): string {
    switch (relation) {
      case 'in':
        return this.game.text('parser.put_success_inventory', {
          item: itemTitle,
          target: targetTitle,
        });
      case 'under':
        return `You put the ${itemTitle} under the ${targetTitle}.`;
      case 'behind':
        return `You put the ${itemTitle} behind the ${targetTitle}.`;
      case 'on':
      default:
        return this.game.text('parser.put_success_surface', {
          item: itemTitle,
          target: targetTitle,
        });
    }
  }

  private getPutTargetTitle(target: SceneObject | null | undefined): string | null {
    return this.getPutTargetDescriptor(target)?.title || null;
  }

  private getTakeSourceTitle(entity: Entity): string | null {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return null;

    const sourceState = getSceneTextLayerAccessState(scene, this.game, entity);
    if (!sourceState.effectiveParentId) return null;

    const sourceObject = scene.getObjectByName(sourceState.effectiveParentId);
    if (sourceObject?.type === 'Walkbox') return null;
    return sourceObject ? this.getPlayerFacingObjectTitle(sourceObject) : null;
  }

  private getTakeSuccessMessage(itemTitle: string, sourceTitle: string | null): string {
    if (sourceTitle) {
      return this.game.text('parser.take_pickup_success_from', {
        item: itemTitle,
        source: sourceTitle,
      });
    }

    return this.game.text('parser.take_pickup_success', {
      item: itemTitle,
    });
  }

  private getPutDistanceFailure(
    storageObject: SceneObject,
    anchor?: SceneObject | null
  ): GameActionOutcome | null {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return null;

    const distanceProbe = anchor || storageObject;
    const distanceError = ComponentSystem.getInteractionDistanceError(
      distanceProbe as any,
      scene.player
    );
    if (!distanceError) return null;

    const targetTitle = this.getPutTargetTitle(distanceProbe);
    return {
      status: 'failed',
      code: 'put_target_too_far',
      message: targetTitle
        ? this.game.text('engine.too_far_from_entity', { target: targetTitle })
        : distanceError,
      data: { targetId: distanceProbe.name, storageId: storageObject.name },
      recoverable: true,
    };
  }

  private getPutAccessibilityFailure(
    storageObject: SceneObject,
    anchor?: SceneObject | null
  ): GameActionOutcome | null {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return null;

    const blockedOutcome = this.getBlockedAccessOutcome(storageObject);
    if (blockedOutcome) return blockedOutcome;

    const distanceFailure = this.getPutDistanceFailure(storageObject, anchor);
    if (distanceFailure) return distanceFailure;

    return null;
  }

  private getStorageAccessProbe(storageObject: SceneObject): SceneObject {
    if (this.getPlayerFacingObjectTitle(storageObject)) return storageObject;

    const scene = this.game.sceneManager.currentScene;
    let current: SceneObject | null = storageObject;
    const visited = new Set<string>();
    while (current) {
      const parentId: string =
        typeof (current as any).spatial?.parentNodeId === 'string'
          ? (current as any).spatial.parentNodeId.trim()
          : '';
      if (!parentId || visited.has(parentId)) break;
      visited.add(parentId);

      const parent: SceneObject | null = scene?.getObjectByName(parentId) || null;
      if (!parent) break;
      if (this.getPlayerFacingObjectTitle(parent)) return parent;
      current = parent;
    }

    return storageObject;
  }

  private getInventoryTakeAccessFailure(
    entity: Entity,
    slot: InventorySlotRef
  ): GameActionOutcome | null {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return null;
    if (this.game.inventoryManager.isPlayerInventoryOwner(slot.owner)) return null;

    if (slot.owner.disabled || !slot.component || slot.component.protected) {
      return {
        status: 'failed',
        code: 'inventory_not_accessible',
        message: this.game.text('parser.take_cannot'),
        data: { entityId: entity.name, ownerId: slot.owner.name },
        recoverable: true,
      };
    }

    const blockedOutcome = this.getBlockedAccessOutcome(slot.owner);
    if (blockedOutcome) return blockedOutcome;

    if (scene.activeSubscene && scene.subsceneEntities.has(slot.owner as any)) {
      return null;
    }

    const accessProbe = this.getStorageAccessProbe(slot.owner);
    const distanceError = ComponentSystem.getInteractionDistanceError(
      accessProbe as any,
      scene.player
    );
    if (!distanceError) return null;

    return {
      status: 'failed',
      code: 'cannot_take',
      message: distanceError,
      data: { entityId: entity.name, ownerId: slot.owner.name },
      recoverable: true,
    };
  }

  private getAutoDropUnavailableFailure(): GameActionOutcome | null {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return null;

    const surfaces = scene
      .getAllSceneObjects()
      .filter((candidate) => !!ComponentSystem.getSurfaceComponent(candidate, 'on'))
      .sort((left, right) => {
        const a = this.game.inventoryManager.getSceneObjectReferencePoint(left);
        const b = this.game.inventoryManager.getSceneObjectReferencePoint(right);
        const player = scene.player;
        const aDistance = player ? Math.hypot(player.x - a.x, player.y - a.y) : 0;
        const bDistance = player ? Math.hypot(player.x - b.x, player.y - b.y) : 0;
        if (aDistance !== bDistance) return aDistance - bDistance;
        return left.name.localeCompare(right.name);
      });

    const playerPoint = scene.player ? { x: scene.player.x || 0, y: scene.player.y || 0 } : null;
    const subsceneContained = scene.activeSubscene
      ? surfaces.filter(
          (surface) =>
            this.game.inventoryManager.isObjectInsideActiveSubscene(surface) &&
            surface.type !== 'Walkbox'
        )
      : [];
    const subsceneWalkboxes = scene.activeSubscene
      ? surfaces.filter(
          (surface) =>
            this.game.inventoryManager.isObjectInsideActiveSubscene(surface) &&
            surface.type === 'Walkbox'
        )
      : [];
    const containingWalkboxes =
      playerPoint && scene.activeSubscene
        ? surfaces.filter(
            (surface) =>
              surface.type === 'Walkbox' &&
              Array.isArray((surface as any).poly) &&
              Geometry.isPointInPolygon(playerPoint, (surface as any).poly)
          )
        : [];
    const orderedSurfaces = subsceneContained.length
      ? subsceneContained
      : subsceneWalkboxes.length
        ? subsceneWalkboxes
        : containingWalkboxes.length
          ? containingWalkboxes
          : surfaces;

    for (const surface of orderedSurfaces) {
      const blockedOutcome = this.getBlockedAccessOutcome(surface);
      if (blockedOutcome) continue;

      const distanceFailure = this.getPutDistanceFailure(surface);
      if (distanceFailure) return distanceFailure;
    }

    return null;
  }

  private getPutMoveFailureMessage(
    moveOutcome: GameActionOutcome,
    entity: Entity,
    storageObject: SceneObject,
    relation: SpatialRelationType | null,
    anchor?: SceneObject | null
  ): string | null {
    const itemTitle = this.getPlayerFacingObjectTitle(entity) || entity.name;
    const target = this.getPutTargetDescriptor(anchor || storageObject, relation);
    const targetTitle = target?.title || null;
    const targetRelation = target?.relation || (relation === 'in' ? 'in' : 'on');

    if (!targetTitle) {
      return moveOutcome.message || null;
    }

    if (moveOutcome.code === 'inventory_full') {
      return this.game.text('parser.put_target_full_in', { target: targetTitle });
    }

    if (moveOutcome.code === 'surface_full') {
      return this.game.text(
        targetRelation === 'in' ? 'parser.put_target_full_in' : 'parser.put_target_full_on',
        { target: targetTitle }
      );
    }

    if (moveOutcome.code === 'surface_no_fit') {
      return this.game.text(
        targetRelation === 'in' ? 'parser.put_target_no_fit_in' : 'parser.put_target_no_fit_on',
        { item: itemTitle, target: targetTitle }
      );
    }

    return moveOutcome.message || null;
  }

  private withPutFailureContext(
    moveOutcome: GameActionOutcome,
    entity: Entity,
    storageObject: SceneObject,
    relation: SpatialRelationType | null,
    anchor?: SceneObject | null
  ): GameActionOutcome {
    const contextualMessage = this.getPutMoveFailureMessage(
      moveOutcome,
      entity,
      storageObject,
      relation,
      anchor
    );
    return contextualMessage ? { ...moveOutcome, message: contextualMessage } : moveOutcome;
  }

  private getSpatialParentMessage(target: SceneObject): string | null {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return null;

    const textLayer = buildSceneTextLayerSnapshot(scene, this.game);
    const entry = textLayer.entryById.get(target.name);
    if (!entry?.effectiveParentId || !entry.effectiveRelation) return null;

    const itemTitle = entry.title || this.getPlayerFacingObjectTitle(target);
    const parentTitle = textLayer.entryById.get(entry.effectiveParentId)?.title?.trim() || null;
    if (!itemTitle || !parentTitle) return null;

    return this.game.text('parser.relation_contents', {
      Relation: this.capitalize(this.getRelationDisplayText(entry.effectiveRelation)),
      relation: this.getRelationDisplayText(entry.effectiveRelation),
      target: parentTitle,
      items: itemTitle,
    });
  }

  private getSemanticHiddenMode(target: SceneObject): false | 'lookable' | 'examinable' {
    return target.hidden === 'lookable' || target.hidden === 'examinable' ? target.hidden : false;
  }

  private revealHiddenEntityForIntent(entity: SceneObject, intent: 'look' | 'examine'): boolean {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return false;
    const hiddenMode = this.getSemanticHiddenMode(entity);
    if (!hiddenMode) return false;
    if (scene.isHiddenEntityRevealed(entity)) return false;
    if (intent === 'look' && hiddenMode !== 'lookable') return false;
    scene.revealHiddenEntity(entity);
    return true;
  }

  private shouldFacePlayerTowardObservedObject(entity: SceneObject): boolean {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return false;
    if (entity instanceof Entity && this.game.inventoryManager.isEntityInInventory(entity))
      return false;
    if (this.game.inventoryManager.isObjectInsideActiveSubscene(entity)) return false;
    if (getInactiveSubsceneAncestors(scene, entity).length > 0) return false;
    return true;
  }

  private facePlayerTowardObservedObject(entity: SceneObject): void {
    if (!this.shouldFacePlayerTowardObservedObject(entity)) return;

    const scene = this.game.sceneManager.currentScene;
    const player = scene?.player;
    if (!player || typeof (player as any).setDirection !== 'function') return;

    const target = this.game.inventoryManager.getSceneObjectReferencePoint(entity);
    const dx = target.x - (player as any).x;
    const dy = target.y - (player as any).y;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;

    if (Math.abs(dx) >= Math.abs(dy)) {
      (player as any).setDirection(dx >= 0 ? 'right' : 'left');
      return;
    }

    (player as any).setDirection(dy >= 0 ? 'down' : 'up');
  }

  private canExamineObject(entity: SceneObject): GameActionOutcome | null {
    if (entity instanceof Entity && this.game.inventoryManager.isEntityInInventory(entity))
      return null;

    const scene = this.game.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.game.text('parser.parse_unknown'),
        recoverable: false,
      };
    }

    const blockedOutcome = this.getBlockedAccessOutcome(entity);
    if (blockedOutcome) {
      return blockedOutcome;
    }

    if (scene.activeSubscene && scene.subsceneEntities.has(entity as any)) {
      return null;
    }

    const distanceError = ComponentSystem.getInteractionDistanceError(entity as any, scene.player);
    if (distanceError) {
      return {
        status: 'failed',
        code: 'too_far_to_examine',
        message: distanceError,
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    return null;
  }

  public getSwitchComponent(entity: SceneObject): SwitchComponent | null {
    const component = entity.components?.find((candidate: any) => candidate?.type === 'Switch');
    return (component as SwitchComponent | undefined) || null;
  }

  private isSwitchTargetInInactiveSubscene(entity: SceneObject): boolean {
    if (!this.getSwitchComponent(entity)) return false;
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return false;
    return getInactiveSubsceneAncestors(scene, entity).length > 0;
  }

  private openInactiveAncestorSubscenes(entity: SceneObject): GameActionOutcome | null {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return null;

    const ancestors = getInactiveSubsceneAncestors(scene, entity);
    for (const triggerbox of ancestors) {
      const accessError = this.canExamineObject(triggerbox);
      if (accessError) return accessError;
      scene.activateObject(triggerbox);
    }

    return null;
  }

  private ensureSwitchTargetReady(entity: SceneObject): GameActionOutcome | null {
    if (!this.isSwitchTargetInInactiveSubscene(entity)) return null;
    return this.openInactiveAncestorSubscenes(entity);
  }

  public getBlockedAccessOutcome(entity: SceneObject): GameActionOutcome | null {
    if (entity instanceof Entity && this.game.inventoryManager.isEntityInInventory(entity))
      return null;

    const scene = this.game.sceneManager.currentScene;
    if (!scene) return null;
    const accessState = getSceneTextLayerAccessState(scene, this.game, entity);
    if (!accessState.blocked && !accessState.hidden) return null;

    const closedMessage =
      accessState.gatingSwitchClearlyOpenable && accessState.gatingSwitchTitle
        ? this.game.text('engine.closed_container', { target: accessState.gatingSwitchTitle })
        : null;

    if (accessState.hidden) {
      if (accessState.hiddenReason === 'lookable' || accessState.hiddenReason === 'examinable') {
        return {
          status: 'failed',
          code: 'hidden_semantic_target',
          message: this.game.text('parser.look_not_found', {
            target: this.getPlayerFacingObjectTitle(entity) || entity.name,
          }),
          data: { entityId: entity.name },
          recoverable: true,
        };
      }
      return {
        status: 'failed',
        code: accessState.gatingSwitchClearlyOpenable
          ? 'blocked_by_closed_container'
          : 'cannot_reach_hidden_target',
        message: closedMessage || this.game.text('engine.cant_reach_generic'),
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    return {
      status: 'failed',
      code: 'blocked_inside_closed',
      message: accessState.gatingSwitchClearlyOpenable
        ? this.game.text('engine.blocked_inside_closed')
        : this.game.text('engine.cant_reach_generic'),
      data: { entityId: entity.name },
      recoverable: true,
    };
  }

  private executeSwitchStateChange(entity: SceneObject, desiredState: 1 | 2): GameActionOutcome {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.game.text('parser.parse_unknown'),
        recoverable: false,
      };
    }

    const autoOpenOutcome = this.ensureSwitchTargetReady(entity);
    if (autoOpenOutcome) return autoOpenOutcome;

    const switchComponent = this.getSwitchComponent(entity);
    if (!switchComponent) {
      return {
        status: 'escalate',
        code: 'target_is_not_switch',
        recoverable: true,
      };
    }

    const accessError = this.canExamineObject(entity);
    if (accessError) return accessError;

    const title = this.getPlayerFacingObjectTitle(entity);
    if (!title) {
      return {
        status: 'escalate',
        code: 'switch_missing_title',
        recoverable: true,
      };
    }

    const blocked = ComponentSystem.getSwitchLockError(entity, switchComponent, scene);
    if (blocked) {
      return {
        status: 'failed',
        code: blocked.code,
        message: blocked.message,
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    const currentState = switchComponent.state === 2 ? 2 : 1;
    if (currentState === desiredState) {
      return {
        status: 'failed',
        code: desiredState === 2 ? 'switch_already_open' : 'switch_already_closed',
        message: this.game.text(
          desiredState === 2 ? 'parser.open_already' : 'parser.close_already',
          {
            target: title,
          }
        ),
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    ComponentSystem.applySwitchState(entity, switchComponent, scene, desiredState);

    return {
      status: 'ok',
      code: desiredState === 2 ? 'switch_opened' : 'switch_closed',
      message: this.game.text(desiredState === 2 ? 'parser.open_success' : 'parser.close_success', {
        target: title,
      }),
      data: { entityId: entity.name, state: desiredState },
      effects: [desiredState === 2 ? 'switch_opened' : 'switch_closed'],
    };
  }

  private getPuttableSourceFailure(entity: Entity): GameActionOutcome | null {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.game.text('parser.parse_unknown'),
        recoverable: false,
      };
    }

    const autoOpenOutcome = this.ensureSwitchTargetReady(entity);
    if (autoOpenOutcome) return autoOpenOutcome;

    const inventorySlot = this.game.inventoryManager.getInventorySlotForEntity(entity);
    const inventoryOwner = inventorySlot?.owner || null;
    if (inventorySlot && !this.game.inventoryManager.isPlayerInventoryOwner(inventoryOwner)) {
      const inventoryAccessFailure = this.getInventoryTakeAccessFailure(entity, inventorySlot);
      if (inventoryAccessFailure) return inventoryAccessFailure;
    } else {
      const blockedOutcome = this.getBlockedAccessOutcome(entity);
      if (blockedOutcome) return blockedOutcome;
    }

    if (!inventorySlot || this.game.inventoryManager.isPlayerInventoryOwner(inventoryOwner)) {
      const errorMsg = ComponentSystem.canTakeItem(entity, scene.player);
      if (errorMsg) {
        return {
          status: 'failed',
          code: 'put_source_not_accessible',
          message: errorMsg,
          data: { entityId: entity.name },
          recoverable: true,
        };
      }
    }

    const isItem = entity.components?.some((component: any) => component?.type === 'Item');
    if (!isItem && !entity.isTakeable) {
      return {
        status: 'failed',
        code: 'not_takeable',
        message: this.game.text('parser.take_cannot'),
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    return null;
  }

  // --- Main Semantic API ---

  getSeeMessage(target: SceneObject): string | null {
    this.revealHiddenEntityForIntent(target, 'look');
    const scene = this.game.sceneManager.currentScene;
    if (
      scene &&
      this.getSemanticHiddenMode(target) === 'examinable' &&
      !scene.isHiddenEntityRevealed(target)
    ) {
      return null;
    }
    return this.getSpatialParentMessage(target) || null;
  }

  lookScene(scene?: Scene | null): GameActionOutcome {
    const targetScene = scene || this.game.sceneManager.currentScene;
    if (!targetScene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.game.text('parser.parse_unknown'),
        recoverable: false,
      };
    }

    const sceneDescription =
      this.game.textAssets.getResolvedSceneField(targetScene, 'description') ||
      targetScene.description ||
      this.game.text('parser.look_default_scene', { scene: targetScene.name });

    return {
      status: 'ok',
      code: 'scene_description',
      message: sceneDescription,
      data: { targetType: 'scene', sceneId: targetScene.id },
    };
  }

  lookEntity(entity: SceneObject): GameActionOutcome {
    this.revealHiddenEntityForIntent(entity, 'look');
    const autoOpenOutcome = this.ensureSwitchTargetReady(entity);
    if (autoOpenOutcome) return autoOpenOutcome;

    const blockedOutcome = this.getBlockedAccessOutcome(entity);
    if (blockedOutcome) return blockedOutcome;

    this.facePlayerTowardObservedObject(entity);

    const interactionId =
      entity.interactions && (entity.interactions.look || entity.interactions.LOOK);
    if (interactionId) {
      ScriptRegistry.execute(interactionId, { game: this.game, entity });
      return {
        status: 'ok',
        code: 'delegated_script',
        data: { targetType: 'entity', entityId: entity.name, scriptId: interactionId },
        effects: ['script_executed'],
      };
    }

    const objectDescription = this.game.textAssets.getResolvedObjectField(entity, 'description');
    const runtimeDescription =
      typeof (entity as any).description === 'string' ? (entity as any).description : null;
    const description = objectDescription || runtimeDescription;
    if (description && description.trim()) {
      return {
        status: 'ok',
        code: 'entity_description',
        message: description,
        data: { targetType: 'entity', entityId: entity.name },
      };
    }

    const targetTitle = this.getPlayerFacingObjectTitle(entity);
    if (targetTitle) {
      const genericMessage = this.game.text('parser.look_default_object', { target: targetTitle });
      return {
        status: 'ok',
        code: 'entity_generic_description',
        message: genericMessage,
        data: { targetType: 'entity', entityId: entity.name },
      };
    }

    return {
      status: 'escalate',
      code: 'missing_description',
      data: { targetType: 'entity', entityId: entity.name },
      recoverable: true,
    };
  }

  examineEntity(entity: SceneObject): GameActionOutcome {
    this.revealHiddenEntityForIntent(entity, 'examine');
    const autoOpenOutcome = this.ensureSwitchTargetReady(entity);
    if (autoOpenOutcome) return autoOpenOutcome;

    const accessError = this.canExamineObject(entity);
    if (accessError) return accessError;

    const subsceneComponent = entity.components?.find(
      (component: any) => component?.type === 'Subscene'
    );
    if (subsceneComponent && this.game.sceneManager.currentScene) {
      this.game.sceneManager.currentScene.activateObject(entity);
      const seeMessage = this.getSeeMessage(entity);
      const targetTitle = this.getPlayerFacingObjectTitle(entity);
      return {
        status: 'ok',
        code: 'subscene_activated',
        ...(seeMessage
          ? { message: seeMessage }
          : targetTitle
            ? { message: this.game.text('engine.click_you_see', { title: targetTitle }) }
            : {}),
        data: { targetType: 'entity', entityId: entity.name },
        effects: ['subscene_opened'],
      };
    }

    this.facePlayerTowardObservedObject(entity);

    const interactionId =
      entity.interactions &&
      (entity.interactions.examine ||
        entity.interactions.EXAMINE ||
        entity.interactions.inspect ||
        entity.interactions.INSPECT ||
        entity.interactions.check ||
        entity.interactions.CHECK);
    if (interactionId) {
      ScriptRegistry.execute(interactionId, { game: this.game, entity });
      return {
        status: 'ok',
        code: 'delegated_script',
        data: { targetType: 'entity', entityId: entity.name, scriptId: interactionId },
        effects: ['script_executed'],
      };
    }

    const details = this.game.textAssets.getResolvedObjectField(entity, 'details');
    if (details && details.trim()) {
      if (entity instanceof Entity && this.game.inventoryManager.isEntityInInventory(entity)) {
        this.game.openInventoryPreview(entity, details);
      }
      return {
        status: 'ok',
        code: 'entity_details',
        message: details,
        data: { targetType: 'entity', entityId: entity.name },
      };
    }

    const objectDescription = this.game.textAssets.getResolvedObjectField(entity, 'description');
    const runtimeDescription =
      typeof (entity as any).description === 'string' ? (entity as any).description : null;
    const description = objectDescription || runtimeDescription;
    if (description && description.trim()) {
      if (entity instanceof Entity && this.game.inventoryManager.isEntityInInventory(entity)) {
        this.game.openInventoryPreview(entity, description);
      }
      return {
        status: 'ok',
        code: 'entity_description_fallback',
        message: description,
        data: { targetType: 'entity', entityId: entity.name },
      };
    }

    return {
      status: 'escalate',
      code: 'missing_details',
      data: { targetType: 'entity', entityId: entity.name },
      recoverable: true,
    };
  }

  describeSpatialRelation(anchorNodeId: string, relation: SpatialRelationType): GameActionOutcome {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.game.text('parser.parse_unknown'),
        recoverable: false,
      };
    }

    const textLayer = buildSceneTextLayerSnapshot(scene, this.game);
    const anchorTitle = textLayer.entryById.get(anchorNodeId)?.title?.trim() || null;
    if (!anchorTitle) {
      return {
        status: 'escalate',
        code: 'spatial_node_missing_title',
        recoverable: true,
      };
    }

    const anchorObject = scene.getObjectByName(anchorNodeId);
    const blockingComponent = anchorObject
      ? getActiveBlockingComponentState(anchorObject, relation)
      : null;
    if (blockingComponent && !blockingComponent.transparent) {
      if (blockingComponent.clearlyOpenable) {
        return {
          status: 'failed',
          code: 'blocked_by_closed_container',
          message: this.game.text('engine.closed_container', { target: anchorTitle }),
          data: { relation, anchorNodeId },
          recoverable: true,
        };
      }
    }

    let childTitles =
      getSceneTextRelationDescendants(
        textLayer,
        anchorNodeId,
        relation as Exclude<SpatialRelationType, 'near'>
      )
        ?.map((entry) => entry.title)
        .filter((title): title is string => !!title) || [];

    const revealableLookables = getSceneTextRelationAccessStates(
      scene,
      this.game,
      anchorNodeId,
      relation as Exclude<SpatialRelationType, 'near'>,
      { includeHidden: true }
    ).filter((accessState) => accessState.hiddenReason === 'lookable');
    if (revealableLookables.length) {
      revealableLookables.forEach((accessState) => scene.revealHiddenEntity(accessState.object));
      const revealedTextLayer = buildSceneTextLayerSnapshot(scene, this.game);
      childTitles =
        getSceneTextRelationDescendants(
          revealedTextLayer,
          anchorNodeId,
          relation as Exclude<SpatialRelationType, 'near'>
        )
          ?.map((entry) => entry.title)
          .filter((title): title is string => !!title) || [];
    }

    if (!childTitles.length) {
      return {
        status: 'ok',
        code: 'relation_empty',
        message: this.game.text('parser.relation_empty', {
          relation: this.getRelationDisplayText(relation),
          target: anchorTitle,
        }),
        data: {
          relation,
          anchorNodeId,
        },
      };
    }

    return {
      status: 'ok',
      code: 'relation_contents',
      message: this.game.text('parser.relation_contents', {
        Relation: this.capitalize(this.getRelationDisplayText(relation)),
        relation: this.getRelationDisplayText(relation),
        target: anchorTitle,
        items: this.formatTitleList(childTitles),
      }),
      data: {
        relation,
        anchorNodeId,
      },
    };
  }

  getRelationScopedTakeCandidates(
    anchor: SceneObject,
    relation: SpatialRelationType | 'near'
  ): RelationScopedTakeCandidates {
    const scene = this.game.sceneManager.currentScene;
    if (!scene || relation === 'near') {
      return { status: 'resolved', candidates: [], hasStorage: false };
    }

    const storageCandidates = this.game.inventoryManager.findStorageCandidatesForRelation(
      anchor,
      relation,
      this.getBlockedAccessOutcome.bind(this),
      this.getPlayerFacingObjectTitle.bind(this),
      false
    );
    const accessibleInventories = storageCandidates.inventoryOwners.filter((storage) =>
      this.game.inventoryManager.isInventoryAccessibleFromAnchor(
        storage.owner,
        anchor,
        this.getBlockedAccessOutcome.bind(this),
        this.getPlayerFacingObjectTitle.bind(this),
        storage.relation
      )
    );
    const accessibleSurfaces = storageCandidates.surfaces.filter((storage) =>
      this.game.inventoryManager.isSurfaceAccessibleFromAnchor(
        storage.surface,
        anchor,
        this.getBlockedAccessOutcome.bind(this),
        this.getPlayerFacingObjectTitle.bind(this)
      )
    );

    const textLayer = buildSceneTextLayerSnapshot(scene, this.game);
    const getRelationCandidates = (candidateRelation: SpatialRelationType) =>
      getSceneTextRelationDescendants(textLayer, anchor.name, candidateRelation)
        .map((entry) => entry.object)
        .filter((candidate): candidate is Entity => candidate instanceof Entity)
        .filter((candidate) => !candidate.disabled)
        .filter(
          (candidate) =>
            candidate.components?.some((component: any) => component?.type === 'Item') ||
            candidate.isTakeable
        );
    let directCandidates = getRelationCandidates(relation);

    if (relation === 'in' && !directCandidates.length) {
      const relationOutcome = this.describeSpatialRelation(anchor.name, 'in');
      if (relationOutcome.status === 'failed') {
        return relationOutcome;
      }

      directCandidates = ['on', 'under', 'behind'].flatMap((candidateRelation) =>
        getRelationCandidates(candidateRelation as SpatialRelationType)
      );
    }

    const semanticContents = getSceneTextRelationDescendants(textLayer, anchor.name, relation);
    const fallbackSemanticContents =
      relation === 'in' && !semanticContents.length
        ? ['on', 'under', 'behind'].flatMap((candidateRelation) =>
            getSceneTextRelationDescendants(
              textLayer,
              anchor.name,
              candidateRelation as SpatialRelationType
            )
          )
        : [];

    if (accessibleInventories.length || accessibleSurfaces.length) {
      const candidates: Entity[] = [];
      for (const storage of accessibleInventories) {
        candidates.push(...this.game.getInventoryEntities(storage.owner, storage.relation));
      }
      for (const storage of accessibleSurfaces) {
        candidates.push(
          ...this.game.inventoryManager.getSurfaceEntities(storage.surface, storage.relation)
        );
      }
      candidates.push(...directCandidates);
      return {
        status: 'resolved',
        candidates: Array.from(new Set(candidates)),
        hasStorage: true,
      };
    }

    if (directCandidates.length) {
      return {
        status: 'resolved',
        candidates: directCandidates,
        hasStorage: true,
      };
    }

    for (const storage of [...storageCandidates.inventoryOwners, ...storageCandidates.surfaces]) {
      const storageObject = 'owner' in storage ? storage.owner : storage.surface;
      const blockedOutcome = this.getBlockedAccessOutcome(storageObject);
      if (blockedOutcome) return blockedOutcome;
    }

    return {
      status: 'resolved',
      candidates: [],
      hasStorage:
        semanticContents.length > 0 ||
        fallbackSemanticContents.length > 0 ||
        storageCandidates.inventoryOwners.length > 0 ||
        storageCandidates.surfaces.length > 0,
    };
  }

  isEntityInPutTarget(
    source: SceneObject,
    target: SceneObject,
    relation: SpatialRelationType | 'near' | null
  ): boolean {
    if (!(source instanceof Entity)) return false;

    if (relation === 'in' || relation === 'on' || relation === 'under' || relation === 'behind') {
      const storage = this.game.inventoryManager.findPreferredStorageForRelation(
        target,
        relation,
        this.getBlockedAccessOutcome.bind(this),
        this.getPlayerFacingObjectTitle.bind(this),
        false
      );
      if (
        storage.inventory &&
        this.game
          .getInventoryEntities(storage.inventory.owner, storage.inventory.relation)
          .includes(source)
      ) {
        return true;
      }
      if (
        storage.surface &&
        this.game.inventoryManager
          .getSurfaceEntities(storage.surface.surface, storage.surface.relation)
          .includes(source)
      ) {
        return true;
      }
    }

    const scene = this.game.sceneManager.currentScene;
    if (!scene) return false;
    const textLayer = buildSceneTextLayerSnapshot(scene, this.game);
    const semanticRelation =
      relation === 'in' || relation === 'on' || relation === 'under' || relation === 'behind'
        ? relation
        : null;
    const relations: SpatialRelationType[] = semanticRelation
      ? [semanticRelation]
      : ['in', 'on', 'under', 'behind'];

    return relations.some((candidateRelation) =>
      getSceneTextRelationDescendants(textLayer, target.name, candidateRelation).some(
        (entry) => entry.object === source
      )
    );
  }

  takeEntity(entity: Entity): GameActionOutcome {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.game.text('parser.parse_unknown'),
        recoverable: false,
      };
    }

    if (this.game.inventoryManager.isEntityInInventory(entity)) {
      return {
        status: 'failed',
        code: 'item_already_held',
        message: this.game.text('parser.take_already_held', {
          item: this.getPlayerFacingObjectTitle(entity) || entity.name,
        }),
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    const autoOpenOutcome = this.ensureSwitchTargetReady(entity);
    if (autoOpenOutcome) return autoOpenOutcome;

    const inventorySlot = this.game.inventoryManager.getInventorySlotForEntity(entity);
    const inventoryOwner = inventorySlot?.owner || null;
    if (inventorySlot && !this.game.inventoryManager.isPlayerInventoryOwner(inventoryOwner)) {
      const inventoryAccessFailure = this.getInventoryTakeAccessFailure(entity, inventorySlot);
      if (inventoryAccessFailure) return inventoryAccessFailure;
    } else {
      const blockedOutcome = this.getBlockedAccessOutcome(entity);
      if (blockedOutcome) return blockedOutcome;
    }

    const interactionId =
      entity.interactions && (entity.interactions.pickup || entity.interactions.PICKUP);
    if (interactionId) {
      ScriptRegistry.execute(interactionId, { game: this.game, entity });
      return {
        status: 'ok',
        code: 'delegated_script',
        data: { targetType: 'entity', entityId: entity.name, scriptId: interactionId },
        effects: ['script_executed'],
      };
    }

    if (!inventorySlot || this.game.inventoryManager.isPlayerInventoryOwner(inventoryOwner)) {
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
    }

    const isItem = entity.components && entity.components.find((c: any) => c.type === 'Item');
    if (isItem || entity.isTakeable) {
      const player = scene.player instanceof Entity ? scene.player : null;
      if (!this.game.inventoryManager.hasMainInventory(player)) {
        return {
          status: 'failed',
          code: 'player_inventory_missing',
          message: this.game.text('parser.inventory_missing'),
          data: { entityId: entity.name, ownerId: player?.name },
          recoverable: true,
        };
      }

      scene.finishDropAnimation(entity);
      const takeSourceTitle = this.getTakeSourceTitle(entity);
      const containingSubsceneRootIds =
        this.game.inventoryManager.getContainingSubsceneRootIds(entity);

      if (inventoryOwner) {
        this.game.removeEntityFromInventory(inventoryOwner, entity);
      }

      this.game.inventoryManager.removeEntityFromCurrentStorage(entity);

      this.game.inventoryManager.clearInheritedSurfaceSwitchGroups(entity);
      this.game.inventoryManager.clearActiveContainerSwitchGroups(
        entity,
        this.getSwitchComponent.bind(this)
      );
      scene.playPickupAnimation(entity);
      scene.subsceneEntities.delete(entity);
      this.game.inventoryManager.markEntityDetachedFromSubscenes(entity, containingSubsceneRootIds);
      entity.subsceneItemScale = 1;
      this.game.inventory.push(entity);
      this.game.inventoryManager.syncPlayerInventoryComponent();
      entity.update(0);
      this.game.inventoryManager.notifyInventoryUiChange();
      const itemTitle = this.getPlayerFacingObjectTitle(entity);
      if (!itemTitle) {
        return {
          status: 'escalate',
          code: 'taken_item_missing_title',
          data: { entityId: entity.name },
          effects: ['moved_to_inventory'],
          recoverable: true,
        };
      }
      return {
        status: 'ok',
        code: 'item_taken',
        message: this.getTakeSuccessMessage(itemTitle, takeSourceTitle),
        data: { entityId: entity.name },
        effects: ['moved_to_inventory'],
      };
    }

    return {
      status: 'failed',
      code: 'not_takeable',
      message: this.game.text('parser.take_cannot'),
      data: { entityId: entity.name },
      recoverable: true,
    };
  }

  canTakeEntity(entity: Entity): GameActionOutcome | null {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.game.text('parser.parse_unknown'),
        recoverable: false,
      };
    }

    if (this.game.inventoryManager.isEntityInInventory(entity)) {
      return {
        status: 'failed',
        code: 'item_already_held',
        message: this.game.text('parser.take_already_held', {
          item: this.getPlayerFacingObjectTitle(entity) || entity.name,
        }),
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    const inventorySlot = this.game.inventoryManager.getInventorySlotForEntity(entity);
    const inventoryOwner = inventorySlot?.owner || null;
    if (inventorySlot && !this.game.inventoryManager.isPlayerInventoryOwner(inventoryOwner)) {
      const inventoryAccessFailure = this.getInventoryTakeAccessFailure(entity, inventorySlot);
      if (inventoryAccessFailure) return inventoryAccessFailure;
    } else {
      const blockedOutcome = this.getBlockedAccessOutcome(entity);
      if (blockedOutcome) return blockedOutcome;
    }

    if (!inventorySlot || this.game.inventoryManager.isPlayerInventoryOwner(inventoryOwner)) {
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
    }

    const isItem = entity.components && entity.components.find((c: any) => c.type === 'Item');
    if (!(isItem || entity.isTakeable)) {
      return {
        status: 'failed',
        code: 'not_takeable',
        message: this.game.text('parser.take_cannot'),
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    if (!this.game.inventoryManager.hasMainInventory(scene.player)) {
      return {
        status: 'failed',
        code: 'player_inventory_missing',
        message: this.game.text('parser.inventory_missing'),
        data: { entityId: entity.name, ownerId: scene.player?.name },
        recoverable: false,
      };
    }
    return null;
  }

  canPutSourceEntity(entity: Entity): GameActionOutcome | null {
    if (this.game.inventoryManager.isEntityInInventory(entity)) return null;
    return this.getPuttableSourceFailure(entity);
  }

  getSurfaceDropMessage(
    surface: SceneObject,
    item: Entity,
    relation: SpatialRelationType | null
  ): string {
    const itemTitle = this.getPlayerFacingObjectTitle(item) || item.name;
    const target = this.getPutTargetDescriptor(surface, relation);
    if (target) {
      return this.getPutSuccessMessage(itemTitle, target.title, target.relation);
    }

    return this.game.text('parser.drop_success', { item: itemTitle });
  }

  getSurfacePutMessage(
    surface: SceneObject,
    item: Entity,
    relation: SpatialRelationType | null,
    target?: SceneObject | null
  ): string {
    if (!target) return this.getSurfaceDropMessage(surface, item, relation);

    const itemTitle = this.getPlayerFacingObjectTitle(item) || item.name;
    if (surface.type === 'Walkbox' || target.type === 'Walkbox') {
      return this.game.text('parser.put_success_surface', {
        item: itemTitle,
        target: this.game.text('engine.floor_label'),
      });
    }

    const textTarget =
      this.getPutTargetDescriptor(target, relation) ||
      this.getPutTargetDescriptor(surface, relation);

    if (!textTarget) return this.getSurfaceDropMessage(surface, item, relation);

    return this.getPutSuccessMessage(itemTitle, textTarget.title, textTarget.relation);
  }

  putEntity(
    entity: Entity,
    target?: SceneObject | null,
    options?: { relation?: SpatialRelationType | null }
  ): GameActionOutcome {
    if (target === entity) {
      return {
        status: 'failed',
        code: 'put_target_is_source',
        message: this.game.text('parser.put_no_place'),
        recoverable: true,
      };
    }
    const sourceInInventory = this.game.inventoryManager.isEntityInInventory(entity);
    if (!sourceInInventory && !target) {
      return {
        status: 'failed',
        code: 'put_item_not_held',
        message: this.game.text('parser.put_item_not_held', {
          item: this.getPlayerFacingObjectTitle(entity) || entity.name,
        }),
        recoverable: true,
      };
    }
    if (!sourceInInventory) {
      const sourceFailure = this.getPuttableSourceFailure(entity);
      if (sourceFailure) return sourceFailure;
    }

    const relation = options?.relation || null;
    let destinationSurface: {
      surface: SceneObject;
      relation: Exclude<SpatialRelationType, 'near'>;
    } | null = null;
    let destinationInventory: {
      owner: Entity;
      relation: Exclude<SpatialRelationType, 'near'>;
    } | null = null;

    if (!target) {
      const autoDropSurface = this.game.inventoryManager.getAutoDropSurface(
        this.getBlockedAccessOutcome.bind(this)
      );
      destinationSurface = autoDropSurface
        ? {
            surface: autoDropSurface.surface,
            relation: autoDropSurface.relation,
          }
        : null;
      if (!destinationSurface) {
        const autoDropFailure = this.getAutoDropUnavailableFailure();
        if (autoDropFailure) return autoDropFailure;
      }
    } else if (
      relation === 'in' ||
      relation === 'on' ||
      relation === 'under' ||
      relation === 'behind'
    ) {
      const storage = this.game.inventoryManager.findPreferredStorageForRelation(
        target,
        relation,
        this.getBlockedAccessOutcome.bind(this),
        this.getPlayerFacingObjectTitle.bind(this),
        false
      );
      destinationInventory = storage.inventory
        ? {
            owner: storage.inventory.owner,
            relation: storage.inventory.relation,
          }
        : null;
      destinationSurface = storage.surface
        ? {
            surface: storage.surface.surface,
            relation: storage.surface.relation,
          }
        : null;
    } else {
      const directInventory =
        target instanceof Entity ? ComponentSystem.getInventoryComponent(target) : null;
      if (target instanceof Entity && directInventory) {
        destinationInventory = {
          owner: target,
          relation: ComponentSystem.normalizeInventoryRelation(directInventory),
        };
      } else {
        const surfaceSlot = this.game.inventoryManager.findPreferredSurfaceForRelation(
          target,
          'on',
          this.getBlockedAccessOutcome.bind(this),
          this.getPlayerFacingObjectTitle.bind(this),
          false
        );
        destinationSurface = surfaceSlot
          ? {
              surface: surfaceSlot.surface,
              relation: surfaceSlot.relation,
            }
          : null;
      }
    }

    if (target && (destinationInventory || destinationSurface)) {
      const targetDistanceFailure = this.getPutDistanceFailure(target, target);
      if (targetDistanceFailure) return targetDistanceFailure;
    }

    if (destinationInventory) {
      const inventoryAccessible =
        relation && target
          ? this.game.inventoryManager.isInventoryAccessibleFromAnchor(
              destinationInventory.owner,
              target,
              this.getBlockedAccessOutcome.bind(this),
              this.getPlayerFacingObjectTitle.bind(this),
              destinationInventory.relation
            )
          : this.game.inventoryManager.isInventoryAccessible(
              destinationInventory.owner,
              this.getBlockedAccessOutcome.bind(this),
              destinationInventory.relation
            );
      if (!inventoryAccessible) {
        const accessFailure = this.getPutAccessibilityFailure(destinationInventory.owner, target);
        return {
          ...(accessFailure || {
            status: 'failed',
            code: 'put_target_not_accessible',
            message: this.game.text('parser.put_no_place'),
            recoverable: true,
          }),
        };
      }
      const moveOutcome = this.game.addInventoryEntity(
        destinationInventory.owner,
        entity,
        destinationInventory.relation
      );
      if (moveOutcome.status !== 'ok') {
        return this.withPutFailureContext(
          moveOutcome,
          entity,
          destinationInventory.owner,
          relation,
          target
        );
      }
      const textTarget =
        this.getPutTargetDescriptor(
          target || destinationInventory.owner,
          destinationInventory.relation
        ) ||
        ({
          title:
            this.getPlayerFacingObjectTitle(destinationInventory.owner) ||
            destinationInventory.owner.name,
          relation: destinationInventory.relation,
        } satisfies PutTargetTextDescriptor);
      return {
        status: 'ok',
        code: 'item_put_into_inventory',
        message: this.getPutSuccessMessage(
          this.getPlayerFacingObjectTitle(entity) || entity.name,
          textTarget.title,
          textTarget.relation
        ),
        data: { entityId: entity.name, ownerId: destinationInventory.owner.name },
        effects: sourceInInventory
          ? ['removed_from_inventory', 'moved_to_inventory']
          : ['moved_between_containers'],
      };
    }

    if (destinationSurface) {
      const surfaceAccessible =
        relation && target
          ? this.game.inventoryManager.isSurfaceAccessibleFromAnchor(
              destinationSurface.surface,
              target,
              this.getBlockedAccessOutcome.bind(this),
              this.getPlayerFacingObjectTitle.bind(this)
            )
          : this.game.inventoryManager.isSurfaceAccessible(
              destinationSurface.surface,
              this.getBlockedAccessOutcome.bind(this)
            );
      if (!surfaceAccessible) {
        const accessFailure = this.getPutAccessibilityFailure(destinationSurface.surface, target);
        return {
          ...(accessFailure || {
            status: 'failed',
            code: 'put_target_not_accessible',
            message: this.game.text('parser.put_no_place'),
            recoverable: true,
          }),
        };
      }
      const moveOutcome = this.game.addEntityToSurface(
        destinationSurface.surface,
        entity,
        destinationSurface.relation,
        {
          preferPlayerPoint: !target && destinationSurface.surface.type === 'Walkbox',
        }
      );
      if (moveOutcome.status !== 'ok') {
        return this.withPutFailureContext(
          moveOutcome,
          entity,
          destinationSurface.surface,
          relation,
          target
        );
      }
      return {
        status: 'ok',
        code: 'item_put_on_surface',
        message: this.game.getSurfacePutMessage(
          destinationSurface.surface,
          entity,
          relation || destinationSurface.relation,
          target
        ),
        data: { entityId: entity.name, targetId: destinationSurface.surface.name },
        effects: sourceInInventory
          ? ['removed_from_inventory', 'placed_on_surface']
          : ['moved_between_scene_targets'],
      };
    }

    return {
      status: 'failed',
      code: 'put_target_not_found',
      message: this.game.text('parser.put_no_place'),
      recoverable: true,
    };
  }

  showInventory(): GameActionOutcome {
    const scene = this.game.sceneManager.currentScene;
    const player = scene?.player instanceof Entity ? scene.player : null;
    if (!this.game.inventoryManager.hasMainInventory(player)) {
      return {
        status: 'failed',
        code: 'player_inventory_missing',
        message: this.game.text('parser.inventory_missing'),
        recoverable: true,
      };
    }

    const inventoryTitles = this.game.inventory
      .map((entity: any) => this.getPlayerFacingObjectTitle(entity))
      .filter((title): title is string => !!title);

    if (inventoryTitles.length !== this.game.inventory.length) {
      return {
        status: 'escalate',
        code: 'inventory_item_missing_title',
        data: {
          count: this.game.inventory.length,
        },
        recoverable: true,
      };
    }

    return {
      status: 'ok',
      code: 'inventory_list',
      message:
        this.game.inventory.length === 0
          ? this.game.text('parser.inventory_empty')
          : this.game.text('parser.inventory_items', {
              items: inventoryTitles.join(', '),
            }),
      data: {
        count: this.game.inventory.length,
      },
    };
  }

  openEntity(entity: SceneObject): GameActionOutcome {
    return this.executeSwitchStateChange(entity, 2);
  }

  closeEntity(entity: SceneObject): GameActionOutcome {
    return this.executeSwitchStateChange(entity, 1);
  }

  goToSceneTarget(target: string): GameActionOutcome {
    const normalized = String(target || '')
      .trim()
      .toUpperCase();
    if (!normalized) {
      return {
        status: 'failed',
        code: 'destination_not_found',
        recoverable: true,
      };
    }

    for (const descriptor of this.game.sceneManager.sceneRegistry.values()) {
      if (
        descriptor.id.toUpperCase() === normalized ||
        descriptor.name.toUpperCase() === normalized ||
        (!!descriptor.title && descriptor.title.toUpperCase() === normalized)
      ) {
        return this.game.goToScene(descriptor.id);
      }
    }

    return {
      status: 'failed',
      code: 'destination_not_found',
      recoverable: true,
    };
  }

  goToEntity(entity: Entity): GameActionOutcome {
    const currentScene = this.game.sceneManager.currentScene;
    if (currentScene?.player && 'x' in entity && 'y' in entity) {
      const entityTitle = this.getPlayerFacingObjectTitle(entity);
      if (!entityTitle) {
        return {
          status: 'escalate',
          code: 'destination_missing_title',
          data: { targetType: 'entity', entityId: entity.name },
          recoverable: true,
        };
      }
      currentScene.player.moveTo((entity as any).x, (entity as any).y);
      return {
        status: 'ok',
        code: 'player_moving',
        message: this.game.text('parser.go_to_success', {
          target: entityTitle,
        }),
        data: { targetType: 'entity', entityId: entity.name },
        effects: ['player_move_started'],
      };
    }

    return {
      status: 'failed',
      code: 'destination_not_found',
      recoverable: true,
    };
  }

  playSound(name: string): void {
    this.game.audio.playSound(name);
  }

  onSceneChange(sceneName: string): void {
    this.game.log(`Scene changed to: ${sceneName}`);
  }
}
