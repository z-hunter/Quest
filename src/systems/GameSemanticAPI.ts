import { Entity } from '../entities/Entity';
import type { Actor } from '../entities/Actor';
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
  getSceneTextRelationDirectAccessStates,
  getSceneTextRelationDirectDescendants,
  getSceneTextRelationDescendants,
  getSceneTextTargetDescriptor,
} from '../scene/SceneTextLayer';
import { ScriptRegistry } from '../core/ScriptRegistry';
import { Geometry } from '../utils/Geometry';

type EffectiveRelation = Exclude<SpatialRelationType, 'near'>;

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

  private isEffectiveRelation(
    relation: SpatialRelationType | null | undefined
  ): relation is EffectiveRelation {
    return relation === 'in' || relation === 'on' || relation === 'under' || relation === 'behind';
  }

  private getPlayerFacingObjectTitle(target: SceneObject): string | null {
    const title = this.game.textAssets.getResolvedObjectField(target as any, 'title');
    return title && title.trim() ? title.trim() : null;
  }

  private getAuthoredTakeFailure(target: SceneObject): string | null {
    const message = this.game.textAssets.getResolvedObjectField(target as any, 'takeFailure');
    return message && message.trim() ? message.trim() : null;
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
    anchor?: SceneObject | null,
    actor?: Actor | null
  ): GameActionOutcome | null {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return null;

    const distanceProbe = anchor || storageObject;
    if (this.game.inventoryManager.isObjectInsideActiveSubscene(distanceProbe)) return null;
    if (this.game.inventoryManager.isObjectInsideActiveSubscene(storageObject)) return null;

    const distanceError = ComponentSystem.getInteractionDistanceError(
      distanceProbe as any,
      actor || scene.player
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
    anchor?: SceneObject | null,
    actor?: Actor | null
  ): GameActionOutcome | null {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return null;

    const blockedOutcome = this.getBlockedAccessOutcome(storageObject, actor);
    if (blockedOutcome) return blockedOutcome;

    const distanceFailure = this.getPutDistanceFailure(storageObject, anchor, actor);
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
    slot: InventorySlotRef,
    actor?: Actor | null
  ): GameActionOutcome | null {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return null;
    if (
      actor ? slot.owner === actor : this.game.inventoryManager.isPlayerInventoryOwner(slot.owner)
    ) {
      return null;
    }

    if (slot.owner.disabled || !slot.component || slot.component.protected) {
      return {
        status: 'failed',
        code: 'inventory_not_accessible',
        message: this.game.text('parser.take_cannot'),
        data: { entityId: entity.name, ownerId: slot.owner.name },
        recoverable: true,
      };
    }

    const blockedOutcome = this.getBlockedAccessOutcome(slot.owner, actor);
    if (blockedOutcome) return blockedOutcome;

    if (scene.activeSubscene && scene.subsceneEntities.has(slot.owner as any)) {
      return null;
    }

    const accessProbe = this.getStorageAccessProbe(slot.owner);
    const distanceError = ComponentSystem.getInteractionDistanceError(
      accessProbe as any,
      actor || scene.player
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

  private getAutoDropUnavailableFailure(actor?: Actor | null): GameActionOutcome | null {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return null;

    const surfaces = scene
      .getAllSceneObjects()
      .filter((candidate) => !!ComponentSystem.getSurfaceComponent(candidate, 'on'))
      .sort((left, right) => {
        const a = this.game.inventoryManager.getSceneObjectReferencePoint(left);
        const b = this.game.inventoryManager.getSceneObjectReferencePoint(right);
        const dropActor = actor || scene.player;
        const aDistance = dropActor ? Math.hypot(dropActor.x - a.x, dropActor.y - a.y) : 0;
        const bDistance = dropActor ? Math.hypot(dropActor.x - b.x, dropActor.y - b.y) : 0;
        if (aDistance !== bDistance) return aDistance - bDistance;
        return left.name.localeCompare(right.name);
      });

    const dropActor = actor || scene.player;
    const actorPoint = dropActor ? { x: dropActor.x || 0, y: dropActor.y || 0 } : null;
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
      actorPoint && scene.activeSubscene
        ? surfaces.filter(
            (surface) =>
              surface.type === 'Walkbox' &&
              Array.isArray((surface as any).poly) &&
              Geometry.isPointInPolygon(actorPoint, (surface as any).poly)
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
      const blockedOutcome = this.getBlockedAccessOutcome(surface, actor);
      if (blockedOutcome) continue;

      const distanceFailure = this.getPutDistanceFailure(surface, null, actor);
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

  private revealHiddenDescendantsForExamine(anchor: SceneObject): string[] {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return [];
    const revealed: string[] = [];

    for (const relation of ['in', 'on', 'under', 'behind'] as const) {
      const revealableDescendants = getSceneTextRelationDirectAccessStates(
        scene,
        this.game,
        anchor.name,
        relation,
        { includeHidden: true }
      ).filter(
        (accessState) =>
          accessState.hiddenReason === 'lookable' || accessState.hiddenReason === 'examinable'
      );

      revealableDescendants.forEach((accessState) => {
        scene.revealHiddenEntity(accessState.object);
        revealed.push(accessState.object.name);
      });
    }
    return revealed;
  }

  private revealHiddenDescendantsForLook(anchor: SceneObject): string[] {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return [];
    const revealed: string[] = [];

    for (const relation of ['in', 'on', 'under', 'behind'] as const) {
      const revealableDescendants = getSceneTextRelationDirectAccessStates(
        scene,
        this.game,
        anchor.name,
        relation,
        { includeHidden: true }
      ).filter((accessState) => accessState.hiddenReason === 'lookable');

      revealableDescendants.forEach((accessState) => {
        scene.revealHiddenEntity(accessState.object);
        revealed.push(accessState.object.name);
      });
    }
    return revealed;
  }

  private shouldFaceActorTowardObservedObject(actor: Actor, entity: SceneObject): boolean {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return false;
    if (
      entity instanceof Entity &&
      this.game.inventoryManager.hasInventoryEntity(actor, entity, 'in')
    )
      return false;
    if (this.game.inventoryManager.isObjectInsideActiveSubscene(entity)) return false;
    if (getInactiveSubsceneAncestors(scene, entity).length > 0) return false;
    return true;
  }

  private faceActorTowardObservedObject(actor: Actor, entity: SceneObject): void {
    if (!this.shouldFaceActorTowardObservedObject(actor, entity)) return;
    if (typeof actor.setDirection !== 'function') return;

    const target = this.game.inventoryManager.getSceneObjectReferencePoint(entity);
    const dx = target.x - actor.x;
    const dy = target.y - actor.y;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;

    if (Math.abs(dx) >= Math.abs(dy)) {
      actor.setDirection(dx >= 0 ? 'right' : 'left');
      return;
    }

    actor.setDirection(dy >= 0 ? 'down' : 'up');
  }

  private canExamineObject(entity: SceneObject, actor?: Actor | null): GameActionOutcome | null {
    const scene = actor ? this.getActorScene(actor) : this.game.sceneManager.currentScene;
    const activeActor = actor || scene?.player || null;
    if (
      entity instanceof Entity &&
      activeActor instanceof Entity &&
      this.game.inventoryManager.hasInventoryEntity(activeActor, entity, 'in')
    )
      return null;

    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.game.text('parser.parse_unknown'),
        recoverable: false,
      };
    }

    const inactiveSubsceneAncestors = getInactiveSubsceneAncestors(scene, entity);
    const isVirtualNpcAccess =
      !!inactiveSubsceneAncestors.length && !!activeActor && activeActor !== scene.player;
    if (isVirtualNpcAccess) {
      for (const triggerbox of inactiveSubsceneAncestors) {
        const distanceError = ComponentSystem.getInteractionDistanceError(
          triggerbox as any,
          activeActor
        );
        if (distanceError) {
          return {
            status: 'failed',
            code: 'too_far_to_examine',
            message: distanceError,
            data: { entityId: entity.name, subsceneId: triggerbox.name },
            recoverable: true,
          };
        }
      }
      return null;
    }

    const blockedOutcome = this.getBlockedAccessOutcome(entity, activeActor);
    if (blockedOutcome) {
      return blockedOutcome;
    }

    if (scene.activeSubscene && scene.subsceneEntities.has(entity as any)) {
      return null;
    }

    const distanceError = ComponentSystem.getInteractionDistanceError(entity as any, activeActor);
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

  private isSwitchTargetInInactiveSubscene(entity: SceneObject, actor?: Actor | null): boolean {
    if (!this.getSwitchComponent(entity)) return false;
    const scene = actor ? this.getActorScene(actor) : this.game.sceneManager.currentScene;
    if (!scene) return false;
    return getInactiveSubsceneAncestors(scene, entity).length > 0;
  }

  private openInactiveAncestorSubscenes(
    entity: SceneObject,
    actor?: Actor | null
  ): GameActionOutcome | null {
    const scene = actor ? this.getActorScene(actor) : this.game.sceneManager.currentScene;
    if (!scene) return null;

    const ancestors = getInactiveSubsceneAncestors(scene, entity);
    for (const triggerbox of ancestors) {
      const accessError = this.canExamineObject(triggerbox, actor);
      if (accessError) return accessError;
      if (!actor || actor === scene.player) {
        scene.activateObject(triggerbox, 0, actor || undefined);
      }
    }

    return null;
  }

  private ensureSwitchTargetReady(
    entity: SceneObject,
    actor?: Actor | null
  ): GameActionOutcome | null {
    if (!this.isSwitchTargetInInactiveSubscene(entity, actor)) return null;
    return this.openInactiveAncestorSubscenes(entity, actor);
  }

  public getBlockedAccessOutcome(
    entity: SceneObject,
    actor?: Actor | null
  ): GameActionOutcome | null {
    const scene = actor ? this.getActorScene(actor) : this.game.sceneManager.currentScene;
    const activeActor = actor || scene?.player || null;
    if (
      entity instanceof Entity &&
      activeActor instanceof Entity &&
      this.game.inventoryManager.hasInventoryEntity(activeActor, entity, 'in')
    )
      return null;

    if (!scene) return null;

    const inactiveSubsceneAncestors = getInactiveSubsceneAncestors(scene, entity);
    const isVirtualNpcAccess =
      !!inactiveSubsceneAncestors.length && !!activeActor && activeActor !== scene.player;
    if (isVirtualNpcAccess) {
      for (const triggerbox of inactiveSubsceneAncestors) {
        const distanceError = ComponentSystem.getInteractionDistanceError(
          triggerbox as any,
          activeActor
        );
        if (distanceError) {
          return {
            status: 'failed',
            code: 'too_far_to_examine',
            message: distanceError,
            data: { entityId: entity.name, subsceneId: triggerbox.name },
            recoverable: true,
          };
        }
      }
      return null;
    }

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

  private executeSwitchStateChange(
    actor: Actor | null,
    entity: SceneObject,
    desiredState: 1 | 2
  ): GameActionOutcome {
    // NPCs may execute in a loaded background scene.  Semantic checks must
    // use that actor's scene; using currentScene makes a valid offscreen
    // drawer look inaccessible even when navigation reached its Subscene.
    const scene = actor ? this.getActorScene(actor) : this.game.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.game.text('parser.parse_unknown'),
        recoverable: false,
      };
    }

    const activeActor = actor || scene.player || null;
    const autoOpenOutcome = this.ensureSwitchTargetReady(entity, activeActor);
    if (autoOpenOutcome) return autoOpenOutcome;

    const switchComponent = this.getSwitchComponent(entity);
    if (!switchComponent) {
      return {
        status: 'escalate',
        code: 'target_is_not_switch',
        recoverable: true,
      };
    }

    const accessError = this.canExamineObject(entity, activeActor);
    if (accessError) return accessError;

    const title = this.getPlayerFacingObjectTitle(entity);
    if (!title) {
      return {
        status: 'escalate',
        code: 'switch_missing_title',
        recoverable: true,
      };
    }

    const blocked = ComponentSystem.getSwitchLockError(entity, switchComponent, scene, activeActor);
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

    const virtualSubsceneAccess =
      !!activeActor &&
      activeActor !== scene.player &&
      getInactiveSubsceneAncestors(scene, entity).length > 0;
    ComponentSystem.applySwitchState(entity, switchComponent, scene, desiredState, {
      updateVisualTargets: !virtualSubsceneAccess,
    });
    if (activeActor) {
      this.game.emitActorAction?.(activeActor, desiredState === 2 ? 'open' : 'close', entity, {
        targetId: entity.name,
        state: desiredState,
      });
    }

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

  private getPuttableSourceFailure(entity: Entity, actor?: Actor | null): GameActionOutcome | null {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.game.text('parser.parse_unknown'),
        recoverable: false,
      };
    }

    const autoOpenOutcome = this.ensureSwitchTargetReady(entity, actor);
    if (autoOpenOutcome) return autoOpenOutcome;

    const inventorySlot = this.game.inventoryManager.getInventorySlotForEntity(entity);
    const inventoryOwner = inventorySlot?.owner || null;
    if (inventorySlot && (!actor || inventoryOwner !== actor)) {
      const inventoryAccessFailure = this.getInventoryTakeAccessFailure(
        entity,
        inventorySlot,
        actor
      );
      if (inventoryAccessFailure) return inventoryAccessFailure;
    } else {
      const blockedOutcome = this.getBlockedAccessOutcome(entity, actor);
      if (blockedOutcome) return blockedOutcome;
    }

    if (
      !inventorySlot ||
      (!actor && this.game.inventoryManager.isPlayerInventoryOwner(inventoryOwner))
    ) {
      const errorMsg = ComponentSystem.canTakeItem(entity, actor || scene.player);
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
    const actor = this.game.sceneManager.currentScene?.player || null;
    return this.lookEntityForActor(actor, entity);
  }

  lookEntityForActor(
    actor: Actor | null,
    entity: SceneObject,
    options: { relation?: SpatialRelationType | null } = {}
  ): GameActionOutcome {
    const outcome = this.executeLookEntityForActor(actor, entity);
    if (outcome.status === 'ok' && actor) {
      this.game.emitActorAction?.(actor, 'look', entity, {
        targetId: entity.name,
        relation: options.relation || null,
      });
    }
    return outcome;
  }

  private executeLookEntityForActor(actor: Actor | null, entity: SceneObject): GameActionOutcome {
    const scene = this.game.sceneManager.currentScene;
    const activeActor = actor || scene?.player || null;
    const isPlayerPath = !actor || activeActor === scene?.player;
    this.revealHiddenEntityForIntent(entity, 'look');
    const autoOpenOutcome = this.ensureSwitchTargetReady(entity, activeActor);
    if (autoOpenOutcome) return autoOpenOutcome;

    const blockedOutcome = this.getBlockedAccessOutcome(entity, activeActor);
    if (blockedOutcome) return blockedOutcome;

    const discoveredEntityIds = this.revealHiddenDescendantsForLook(entity);
    if (activeActor) this.faceActorTowardObservedObject(activeActor, entity);

    const interactionId =
      entity.interactions && (entity.interactions.look || entity.interactions.LOOK);
    if (interactionId) {
      ScriptRegistry.execute(interactionId, { game: this.game, entity });
      return {
        status: 'ok',
        code: 'delegated_script',
        data: {
          targetType: 'entity',
          entityId: entity.name,
          scriptId: interactionId,
          discoveredEntityIds,
          worldChanged: true,
        },
        effects: ['script_executed'],
      };
    }

    const objectDescription = this.game.textAssets.getResolvedObjectField(entity, 'description');
    const runtimeDescription =
      typeof (entity as any).description === 'string' ? (entity as any).description : null;
    const description = objectDescription || runtimeDescription;
    if (description && description.trim()) {
      if (
        isPlayerPath &&
        entity instanceof Entity &&
        this.game.inventoryManager.isEntityInInventory(entity)
      ) {
        this.game.openInventoryPreview(entity, null);
      }
      return {
        status: 'ok',
        code: 'entity_description',
        message: description,
        data: {
          targetType: 'entity',
          entityId: entity.name,
          discoveredEntityIds,
          worldChanged: discoveredEntityIds.length > 0,
        },
      };
    }

    const targetTitle = this.getPlayerFacingObjectTitle(entity);
    if (targetTitle) {
      const genericMessage = this.game.text('parser.look_default_object', { target: targetTitle });
      if (
        isPlayerPath &&
        entity instanceof Entity &&
        this.game.inventoryManager.isEntityInInventory(entity)
      ) {
        this.game.openInventoryPreview(entity, null);
      }
      return {
        status: 'ok',
        code: 'entity_generic_description',
        message: genericMessage,
        data: {
          targetType: 'entity',
          entityId: entity.name,
          discoveredEntityIds,
          worldChanged: discoveredEntityIds.length > 0,
        },
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
    const actor = this.game.sceneManager.currentScene?.player || null;
    return this.examineEntityForActor(actor, entity);
  }

  examineEntityForActor(
    actor: Actor | null,
    entity: SceneObject,
    options: { relation?: SpatialRelationType | null } = {}
  ): GameActionOutcome {
    const outcome = this.executeExamineEntityForActor(actor, entity);
    if (outcome.status === 'ok' && actor) {
      this.game.emitActorAction?.(actor, 'examine', entity, {
        targetId: entity.name,
        relation: options.relation || null,
      });
    }
    return outcome;
  }

  private executeExamineEntityForActor(
    actor: Actor | null,
    entity: SceneObject
  ): GameActionOutcome {
    const scene = this.game.sceneManager.currentScene;
    const activeActor = actor || scene?.player || null;
    const isPlayerPath = !actor || activeActor === scene?.player;
    const autoOpenOutcome = this.ensureSwitchTargetReady(entity, activeActor);
    if (autoOpenOutcome) return autoOpenOutcome;

    const accessError = this.canExamineObject(entity, activeActor);
    if (accessError) return accessError;

    const discoveredEntityIds = this.revealHiddenDescendantsForExamine(entity);

    const subsceneComponent = entity.components?.find(
      (component: any) => component?.type === 'Subscene'
    );
    if (subsceneComponent && this.game.sceneManager.currentScene) {
      const isPlayerPath = !activeActor || activeActor === scene?.player;
      if (isPlayerPath) {
        this.game.sceneManager.currentScene.activateObject(entity, 0, activeActor || undefined);
      }
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
        data: {
          targetType: 'entity',
          entityId: entity.name,
          discoveredEntityIds,
          worldChanged: isPlayerPath,
        },
        effects: isPlayerPath ? ['subscene_opened'] : [],
      };
    }

    if (activeActor) this.faceActorTowardObservedObject(activeActor, entity);

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
        data: {
          targetType: 'entity',
          entityId: entity.name,
          scriptId: interactionId,
          discoveredEntityIds,
          worldChanged: true,
        },
        effects: ['script_executed'],
      };
    }

    const objectDescription = this.game.textAssets.getResolvedObjectField(entity, 'description');
    const runtimeDescription =
      typeof (entity as any).description === 'string' ? (entity as any).description : null;
    const description = objectDescription || runtimeDescription;

    const details = this.game.textAssets.getResolvedObjectField(entity, 'details');
    if (details && details.trim()) {
      if (
        isPlayerPath &&
        entity instanceof Entity &&
        this.game.inventoryManager.isEntityInInventory(entity)
      ) {
        this.game.openInventoryPreview(entity, null);
      }
      return {
        status: 'ok',
        code: 'entity_details',
        message: details,
        data: {
          targetType: 'entity',
          entityId: entity.name,
          discoveredEntityIds,
          worldChanged: discoveredEntityIds.length > 0,
        },
      };
    }

    if (description && description.trim()) {
      if (
        isPlayerPath &&
        entity instanceof Entity &&
        this.game.inventoryManager.isEntityInInventory(entity)
      ) {
        this.game.openInventoryPreview(entity, null);
      }
      return {
        status: 'ok',
        code: 'entity_description_fallback',
        message: description,
        data: {
          targetType: 'entity',
          entityId: entity.name,
          discoveredEntityIds,
          worldChanged: discoveredEntityIds.length > 0,
        },
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
    const anchorObject = scene.getObjectByName(anchorNodeId);
    const anchorTitle =
      textLayer.entryById.get(anchorNodeId)?.title?.trim() ||
      (anchorObject ? this.getPlayerFacingObjectTitle(anchorObject) : null);
    if (!anchorTitle) {
      return {
        status: 'escalate',
        code: 'spatial_node_missing_title',
        recoverable: true,
      };
    }

    const effectiveRelation = this.isEffectiveRelation(relation) ? relation : null;
    const blockingComponent = anchorObject
      ? getActiveBlockingComponentState(anchorObject, effectiveRelation)
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

    let childTitles = effectiveRelation
      ? getSceneTextRelationDirectDescendants(textLayer, anchorNodeId, effectiveRelation)
          ?.map((entry) => entry.title)
          .filter((title): title is string => !!title) || []
      : [];

    const revealableLookables = effectiveRelation
      ? getSceneTextRelationDirectAccessStates(scene, this.game, anchorNodeId, effectiveRelation, {
          includeHidden: true,
        }).filter((accessState) => accessState.hiddenReason === 'lookable')
      : [];
    const discoveredLookables = revealableLookables.length > 0;

    if (effectiveRelation && revealableLookables.length) {
      revealableLookables.forEach((accessState) => scene.revealHiddenEntity(accessState.object));
      const revealedTextLayer = buildSceneTextLayerSnapshot(scene, this.game);
      childTitles =
        getSceneTextRelationDirectDescendants(revealedTextLayer, anchorNodeId, effectiveRelation)
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
      message: this.game.text(
        discoveredLookables ? 'parser.relation_discovered_contents' : 'parser.relation_contents',
        {
          Relation: this.capitalize(this.getRelationDisplayText(relation)),
          relation: this.getRelationDisplayText(relation),
          target: anchorTitle,
          items: this.formatTitleList(childTitles),
        }
      ),
      data: {
        relation,
        anchorNodeId,
        discoveredEntityIds: effectiveRelation
          ? getSceneTextRelationDirectDescendants(
              buildSceneTextLayerSnapshot(scene, this.game),
              anchorNodeId,
              effectiveRelation
            ).map((entry) => entry.object.name)
          : [],
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
    const getRelationCandidates = (candidateRelation: EffectiveRelation) =>
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

      directCandidates = (['on', 'under', 'behind'] as EffectiveRelation[]).flatMap(
        (candidateRelation) => getRelationCandidates(candidateRelation)
      );
    }

    const semanticContents = getSceneTextRelationDescendants(textLayer, anchor.name, relation);
    const fallbackSemanticContents =
      relation === 'in' && !semanticContents.length
        ? (['on', 'under', 'behind'] as EffectiveRelation[]).flatMap((candidateRelation) =>
            getSceneTextRelationDescendants(textLayer, anchor.name, candidateRelation)
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
    const relations: EffectiveRelation[] = semanticRelation
      ? [semanticRelation]
      : ['in', 'on', 'under', 'behind'];

    return relations.some((candidateRelation) =>
      getSceneTextRelationDescendants(textLayer, target.name, candidateRelation).some(
        (entry) => entry.object === source
      )
    );
  }

  takeEntity(entity: Entity): GameActionOutcome {
    const actor = this.game.sceneManager.currentScene?.player || null;
    return this.takeEntityForActor(actor, entity);
  }

  takeEntityForActor(
    actor: Actor | null,
    entity: Entity,
    options: { emitAction?: boolean } = {}
  ): GameActionOutcome {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.game.text('parser.parse_unknown'),
        recoverable: false,
      };
    }
    const activeActor = actor || scene.player;
    if (!(activeActor instanceof Entity)) {
      return {
        status: 'failed',
        code: 'actor_not_found',
        message: this.game.text('parser.take_cannot'),
        data: { entityId: entity.name },
        recoverable: false,
      };
    }
    const isPlayerActor = activeActor === scene.player;

    if (
      this.game.inventoryManager.hasInventoryEntity(activeActor, entity, 'in') ||
      (isPlayerActor && this.game.inventoryManager.hasEntityIdInInventory(entity))
    ) {
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

    const autoOpenOutcome = this.ensureSwitchTargetReady(entity, activeActor);
    if (autoOpenOutcome) return autoOpenOutcome;

    const inventorySlot = this.game.inventoryManager.getInventorySlotForEntity(entity);
    const inventoryOwner = inventorySlot?.owner || null;
    if (inventorySlot && inventoryOwner !== activeActor) {
      const inventoryAccessFailure = this.getInventoryTakeAccessFailure(
        entity,
        inventorySlot,
        activeActor
      );
      if (inventoryAccessFailure) return inventoryAccessFailure;
    } else if (!inventorySlot) {
      const inactiveSubsceneAncestors = getInactiveSubsceneAncestors(scene, entity);
      const isVirtualNpcAccess = !!inactiveSubsceneAncestors.length && activeActor !== scene.player;
      if (isVirtualNpcAccess) {
        for (const triggerbox of inactiveSubsceneAncestors) {
          const distanceError = ComponentSystem.getInteractionDistanceError(
            triggerbox as any,
            activeActor
          );
          if (distanceError) {
            return {
              status: 'failed',
              code: 'too_far_to_examine',
              message: distanceError,
              data: { entityId: entity.name, subsceneId: triggerbox.name },
              recoverable: true,
            };
          }
        }
      } else {
        const blockedOutcome = this.getBlockedAccessOutcome(entity, activeActor);
        if (blockedOutcome) return blockedOutcome;
      }
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

    if (!inventorySlot) {
      const virtualSubsceneAccess =
        activeActor !== scene.player && getInactiveSubsceneAncestors(scene, entity).length > 0;
      const errorMsg = virtualSubsceneAccess
        ? null
        : ComponentSystem.canTakeItem(entity, activeActor);
      if (errorMsg) {
        const authoredTakeFailure = this.getAuthoredTakeFailure(entity);
        const genericTakeFailure = this.game.text('parser.take_cannot');
        const useAuthoredFailure = !!authoredTakeFailure && errorMsg === genericTakeFailure;
        return {
          status: 'failed',
          code: 'cannot_take',
          message: useAuthoredFailure ? authoredTakeFailure : errorMsg,
          data: { entityId: entity.name },
          recoverable: useAuthoredFailure ? false : true,
        };
      }
    }

    const isItem = entity.components && entity.components.find((c: any) => c.type === 'Item');
    if (isItem || entity.isTakeable) {
      if (!this.game.inventoryManager.hasMainInventory(activeActor)) {
        return {
          status: 'failed',
          code: isPlayerActor ? 'player_inventory_missing' : 'inventory_missing',
          message: this.game.text('parser.inventory_missing'),
          data: { entityId: entity.name, ownerId: activeActor.name },
          recoverable: true,
        };
      }

      scene.finishDropAnimation(entity);
      const takeSourceTitle = this.getTakeSourceTitle(entity);
      const containingSubsceneRootIds =
        this.game.inventoryManager.getContainingSubsceneRootIds(entity);
      const pickupAnimationState = isPlayerActor
        ? {
            x: entity.x,
            y: entity.y,
            spatial: entity.spatial ? { ...entity.spatial } : entity.spatial,
            visible: entity.visible,
            subsceneItemScale: entity.subsceneItemScale || 1,
          }
        : null;

      this.game.inventoryManager.clearInheritedSurfaceSwitchGroups(entity);
      this.game.inventoryManager.clearActiveContainerSwitchGroups(
        entity,
        this.getSwitchComponent.bind(this)
      );
      entity.subsceneItemScale = 1;
      const moveOutcome = this.game.inventoryManager.addInventoryEntity(activeActor, entity, 'in');
      if (moveOutcome.status !== 'ok') {
        return moveOutcome;
      }
      entity.hidden = false;
      entity.disabled = false;
      scene.subsceneEntities.delete(entity);
      if (pickupAnimationState) {
        const heldState = {
          spatial: entity.spatial ? { ...entity.spatial } : entity.spatial,
          visible: entity.visible,
          inventoryPositionOwner: entity.getInventoryPositionOwner(),
          subsceneItemScale: entity.subsceneItemScale || 1,
        };
        entity.setInventoryPositionOwner(null);
        entity.x = pickupAnimationState.x;
        entity.y = pickupAnimationState.y;
        entity.spatial = pickupAnimationState.spatial;
        entity.visible = pickupAnimationState.visible;
        entity.subsceneItemScale = pickupAnimationState.subsceneItemScale;
        scene.playPickupAnimation(entity);
        entity.spatial = heldState.spatial;
        entity.visible = heldState.visible;
        entity.setInventoryPositionOwner(heldState.inventoryPositionOwner);
        entity.subsceneItemScale = heldState.subsceneItemScale;
      }
      this.game.inventoryManager.markEntityDetachedFromSubscenes(entity, containingSubsceneRootIds);
      entity.update(0);
      if (isPlayerActor) {
        this.game.inventoryManager.notifyInventoryUiChange();
      }
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
      if (options.emitAction !== false) {
        this.game.emitActorAction?.(activeActor, 'take', null, {
          itemId: entity.name,
          previousLocation: takeSourceTitle || undefined,
        });
      }
      return {
        status: 'ok',
        code: 'item_taken',
        message: this.getTakeSuccessMessage(itemTitle, takeSourceTitle),
        data: { entityId: entity.name },
        effects: ['moved_to_inventory'],
      };
    }

    const authoredTakeFailure = this.getAuthoredTakeFailure(entity);
    return {
      status: 'failed',
      code: 'not_takeable',
      message: authoredTakeFailure || this.game.text('parser.take_cannot'),
      data: { entityId: entity.name },
      recoverable: authoredTakeFailure ? false : true,
    };
  }

  giveEntityForActor(actor: Actor | null, entity: Entity, targetActor: Actor): GameActionOutcome {
    const currentScene = this.game.sceneManager.currentScene;
    const activeActor = actor || currentScene?.player || null;
    const scene = activeActor ? this.getActorScene(activeActor) : currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.game.text('parser.parse_unknown'),
        recoverable: false,
      };
    }
    if (!(activeActor instanceof Entity) || activeActor.disabled) {
      return {
        status: 'failed',
        code: 'actor_not_found',
        message: this.game.text('parser.give_target_not_found'),
        recoverable: false,
      };
    }
    if (
      !(targetActor instanceof Entity) ||
      targetActor.disabled ||
      scene.getObjectByName(targetActor.name) !== targetActor
    ) {
      return {
        status: 'failed',
        code: 'give_target_not_found',
        message: this.game.text('parser.give_target_not_found'),
        data: { targetId: targetActor?.name },
        recoverable: true,
      };
    }
    if (targetActor === activeActor) {
      return {
        status: 'failed',
        code: 'give_target_is_source',
        message: this.game.text('parser.give_self'),
        data: { entityId: entity.name, targetId: targetActor.name },
        recoverable: true,
      };
    }

    const fail = (outcome: GameActionOutcome): GameActionOutcome => {
      this.game.emitActorAction?.(activeActor, 'give_failed', targetActor, {
        itemId: entity.name,
        targetId: targetActor.name,
        reason: outcome.message || outcome.code,
      });
      return outcome;
    };

    const targetAccessFailure = this.getPutAccessibilityFailure(
      targetActor,
      targetActor,
      activeActor
    );
    if (targetAccessFailure) return fail(targetAccessFailure);

    const destinationPreflight = this.game.inventoryManager.canAddInventoryEntity(
      targetActor,
      entity,
      'in'
    );
    if (destinationPreflight) {
      return fail(
        this.withPutFailureContext(destinationPreflight, entity, targetActor, 'in', targetActor)
      );
    }

    const sourceHeld = this.game.inventoryManager.hasInventoryEntity(activeActor, entity, 'in');
    if (!sourceHeld) {
      const takeOutcome = this.takeEntityForActor(activeActor, entity, { emitAction: false });
      if (takeOutcome.status !== 'ok') return fail(takeOutcome);
    }

    const moveOutcome = this.game.inventoryManager.addInventoryEntity(targetActor, entity, 'in');
    if (moveOutcome.status !== 'ok') {
      return fail(this.withPutFailureContext(moveOutcome, entity, targetActor, 'in', targetActor));
    }

    const itemTitle = this.getPlayerFacingObjectTitle(entity) || entity.name;
    const targetTitle = this.getPlayerFacingObjectTitle(targetActor) || targetActor.name;
    const actorTitle = this.getPlayerFacingObjectTitle(activeActor) || activeActor.name;
    this.game.emitActorAction?.(activeActor, 'give', targetActor, {
      itemId: entity.name,
      targetId: targetActor.name,
      outcome: 'item_given',
      worldChanged: true,
    });
    this.game.wakeNpc?.(targetActor, 'item_received');

    if (targetActor === scene.player) {
      const description = this.game.textAssets
        .getResolvedObjectField(entity as any, 'description')
        ?.trim();
      this.game.openInventoryPreview(
        entity,
        [
          this.game.text('parser.give_received_intro', { actor: actorTitle, item: itemTitle }),
          description,
        ]
          .filter((text): text is string => !!text?.trim())
          .join('\n\n')
      );
    }

    return {
      status: 'ok',
      code: 'item_given',
      message: this.game.text('parser.give_success', { item: itemTitle, target: targetTitle }),
      data: {
        actionType: 'GIVE',
        actorId: activeActor.name,
        recipientId: targetActor.name,
        entityId: entity.name,
        itemId: entity.name,
        ownerId: targetActor.name,
        targetId: targetActor.name,
        worldChanged: true,
      },
      effects: ['removed_from_inventory', 'moved_to_inventory', 'item_given'],
    };
  }

  private getActorScene(actor: Actor): ReturnType<typeof this.game.sceneManager.scenes.get> | null {
    const current = this.game.sceneManager.currentScene;
    if (current?.getObjectByName(actor.name) === actor) return current;
    return (
      Array.from(this.game.sceneManager.scenes.values()).find(
        (scene) => scene.getObjectByName(actor.name) === actor
      ) || null
    );
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

    if (this.game.inventoryManager.hasEntityIdInInventory(entity)) {
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
        const authoredTakeFailure = this.getAuthoredTakeFailure(entity);
        const genericTakeFailure = this.game.text('parser.take_cannot');
        const useAuthoredFailure = !!authoredTakeFailure && errorMsg === genericTakeFailure;
        return {
          status: 'failed',
          code: 'cannot_take',
          message: useAuthoredFailure ? authoredTakeFailure : errorMsg,
          data: { entityId: entity.name },
          recoverable: useAuthoredFailure ? false : true,
        };
      }
    }

    const isItem = entity.components && entity.components.find((c: any) => c.type === 'Item');
    if (!(isItem || entity.isTakeable)) {
      const authoredTakeFailure = this.getAuthoredTakeFailure(entity);
      return {
        status: 'failed',
        code: 'not_takeable',
        message: authoredTakeFailure || this.game.text('parser.take_cannot'),
        data: { entityId: entity.name },
        recoverable: authoredTakeFailure ? false : true,
      };
    }

    const player = scene.player instanceof Entity ? scene.player : null;
    if (!this.game.inventoryManager.hasMainInventory(player)) {
      return {
        status: 'failed',
        code: 'player_inventory_missing',
        message: this.game.text('parser.inventory_missing'),
        data: { entityId: entity.name, ownerId: player?.name },
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
    const actor = this.game.sceneManager.currentScene?.player || null;
    return this.putEntityForActor(actor, entity, target, options);
  }

  putEntityForActor(
    actor: Actor | null,
    entity: Entity,
    target?: SceneObject | null,
    options?: { relation?: SpatialRelationType | null }
  ): GameActionOutcome {
    const outcome = this.executePutEntityForActor(actor, entity, target, options);
    if (outcome.status === 'ok' && actor) {
      this.game.emitActorAction?.(actor, 'put', target || null, {
        itemId: entity.name,
        targetId: target?.name || null,
        relation: options?.relation || null,
      });
    }
    return outcome;
  }

  private executePutEntityForActor(
    actor: Actor | null,
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
    const sourceInInventory = actor
      ? this.game.inventoryManager.hasInventoryEntity(actor, entity, 'in')
      : this.game.inventoryManager.isEntityInInventory(entity);
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
      const sourceFailure = this.getPuttableSourceFailure(entity, actor);
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
        this.getBlockedAccessOutcome.bind(this),
        actor
      );
      destinationSurface = autoDropSurface
        ? {
            surface: autoDropSurface.surface,
            relation: autoDropSurface.relation,
          }
        : null;
      if (!destinationSurface) {
        const autoDropFailure = this.getAutoDropUnavailableFailure(actor);
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
      const targetDistanceFailure = this.getPutDistanceFailure(target, target, actor);
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
              destinationInventory.relation,
              actor
            )
          : this.game.inventoryManager.isInventoryAccessible(
              destinationInventory.owner,
              this.getBlockedAccessOutcome.bind(this),
              destinationInventory.relation,
              actor
            );
      if (!inventoryAccessible) {
        const accessFailure = this.getPutAccessibilityFailure(
          destinationInventory.owner,
          target,
          actor
        );
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
              this.getPlayerFacingObjectTitle.bind(this),
              actor
            )
          : this.game.inventoryManager.isSurfaceAccessible(
              destinationSurface.surface,
              this.getBlockedAccessOutcome.bind(this),
              actor
            );
      if (!surfaceAccessible) {
        const accessFailure = this.getPutAccessibilityFailure(
          destinationSurface.surface,
          target,
          actor
        );
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
          preferredPoint:
            actor && !target && destinationSurface.surface.type === 'Walkbox'
              ? { x: actor.x || 0, y: actor.y || 0 }
              : undefined,
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
    return this.openEntityForActor(this.game.sceneManager.currentScene?.player || null, entity);
  }

  openEntityForActor(actor: Actor | null, entity: SceneObject): GameActionOutcome {
    if (!this.getSwitchComponent(entity)) {
      const contentsOutcome = this.getOpenContainerContentsOutcome(actor, entity);
      if (contentsOutcome) return contentsOutcome;
    }
    return this.executeSwitchStateChange(actor, entity, 2);
  }

  closeEntity(entity: SceneObject): GameActionOutcome {
    return this.closeEntityForActor(this.game.sceneManager.currentScene?.player || null, entity);
  }

  closeEntityForActor(actor: Actor | null, entity: SceneObject): GameActionOutcome {
    return this.executeSwitchStateChange(actor, entity, 1);
  }

  /**
   * OPEN is also a convenient explicit inspection of an already accessible
   * inventory nested inside a titled semantic anchor (for example, batteries
   * inside a remote). It must not bypass a Switch or another access gate.
   */
  private getOpenContainerContentsOutcome(
    actor: Actor | null,
    entity: SceneObject
  ): GameActionOutcome | null {
    const scene = actor ? this.getActorScene(actor) : this.game.sceneManager.currentScene;
    if (!scene) return null;

    const activeActor = actor || scene.player || null;
    const accessError = this.canExamineObject(entity, activeActor);
    if (accessError) return accessError;

    const storageCandidates = this.game.inventoryManager.findStorageCandidatesForRelation(
      entity,
      'in',
      this.getBlockedAccessOutcome.bind(this),
      this.getPlayerFacingObjectTitle.bind(this),
      false
    );
    const hasAccessibleInventory = storageCandidates.inventoryOwners.some((storage) =>
      this.game.inventoryManager.isInventoryAccessibleFromAnchor(
        storage.owner,
        entity,
        this.getBlockedAccessOutcome.bind(this),
        this.getPlayerFacingObjectTitle.bind(this),
        storage.relation,
        activeActor
      )
    );
    if (!hasAccessibleInventory) return null;

    return this.describeSpatialRelation(entity.name, 'in');
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

  goToEntity(entity: SceneObject, options?: { traverseExit?: boolean }): GameActionOutcome {
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
      const moveResult = this.game.actorNavigation.moveActorToTarget(currentScene.player, entity);
      if (!moveResult) {
        if (entity.components?.some((component: any) => component?.type === 'Exit')) {
          this.game.showMessage(this.game.text('engine.too_far_generic'));
        }
        return {
          status: 'failed',
          code: 'route_unreachable',
          message: 'Destination is unreachable.',
          data: { targetType: 'entity', entityId: entity.name },
          recoverable: true,
        };
      }
      if (moveResult.status === 'unreachable' || moveResult.status === 'blocked') {
        if (entity.components?.some((component: any) => component?.type === 'Exit')) {
          this.game.showMessage(this.game.text('engine.too_far_generic'));
        }
        return {
          status: 'failed',
          code: moveResult.code,
          message: moveResult.message,
          data: { targetType: 'entity', entityId: entity.name },
          recoverable: true,
        };
      }
      const traverseExit = options?.traverseExit ?? false;
      if (traverseExit) {
        const exit = entity.components?.find((component: any) => component?.type === 'Exit') as
          | { portal?: boolean; collider?: boolean }
          | undefined;
        if (exit && (exit.portal === true || exit.collider !== false)) {
          if (moveResult.status === 'arrived') {
            currentScene.activateObject(entity, 0, currentScene.player);
          } else {
            this.activateExitAfterArrival(currentScene.player, entity);
          }
        }
      }
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

  private activateExitAfterArrival(actor: Actor, exitObject: SceneObject): void {
    const poll = () => {
      const result = actor.getMoveResult();
      if (result.status === 'started' && actor.state === 'walk') {
        globalThis.setTimeout(poll, 50);
        return;
      }
      if (result.status !== 'arrived') return;
      const scene = this.game.sceneManager.currentScene;
      if (scene?.getObjectByName(exitObject.name) === exitObject) {
        scene.activateObject(exitObject, 0, actor);
      }
    };
    globalThis.setTimeout(poll, 50);
  }

  playSound(name: string): void {
    this.game.playSound(name);
  }

  onSceneChange(sceneName: string): void {
    this.game.log(`Scene changed to: ${sceneName}`);
  }
}
