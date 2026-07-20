import type { IGame } from '../core/IGame';
import { Actor } from '../entities/Actor';
import { Entity } from '../entities/Entity';
import type { SceneObject } from '../entities/SceneObject';
import type { Scene } from '../scene/Scene';
import {
  getSceneTextLayerAccessState,
  type SceneTextLayerAccessState,
} from '../scene/SceneTextLayer';
import type { SpatialRelationType } from '../scene/spatialTypes';
import { ComponentSystem } from './ComponentSystem';
import { ActorNavigationService, type ActorApproachStatus } from './ActorNavigationService';

type EffectiveRelation = Exclude<SpatialRelationType, 'near'>;

export type ActorObjectPerception = {
  visibility: 'visible' | 'hidden' | 'unknown';
  interaction: 'held' | 'reachable' | 'blocked';
  approach: ActorApproachStatus;
  hiddenReason?: 'switch' | 'blocker' | 'lookable' | 'examinable';
  location?: {
    relation: EffectiveRelation;
    targetId: string;
    targetTitle?: string;
  };
};

export type ActorSwitchAffordance = {
  state: 'open' | 'closed';
  canOpen: boolean;
  canClose: boolean;
  locked: boolean;
  keyHeld: boolean;
  requiredKeyId?: string;
};

export type ActorInventoryItemKnowledge = {
  id: string;
  title: string;
  containerId: string;
  relation: EffectiveRelation;
  groupIds?: string[];
  states?: Array<{ id: string; value: string | number | boolean }>;
};

export type ActorInventoryKnowledge = {
  available: boolean;
  itemIds: string[];
  items?: ActorInventoryItemKnowledge[];
};

export class ActorWorldQuery {
  readonly navigation: ActorNavigationService;
  private readonly game: IGame;

  constructor(game: IGame) {
    this.game = game;
    this.navigation = new ActorNavigationService(game);
  }

  getKnownObjects(
    actor: Actor,
    scene: Scene | null = actor.scene || this.game.sceneManager.currentScene
  ): SceneObject[] {
    if (!scene) return [];
    return scene
      .getAllSceneObjects()
      .filter((object) => object !== actor)
      .filter(
        (object) => this.getObjectPerception(actor, object, true, scene).visibility === 'visible'
      );
  }

  getActionObservers(source: Actor, subject?: SceneObject | null): Actor[] {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return [];
    const focus = subject || source;
    const focusPoint = this.game.inventoryManager.getSceneObjectReferencePoint(focus);
    if (!focusPoint || !Number.isFinite(focusPoint.x) || !Number.isFinite(focusPoint.y)) {
      return [];
    }
    return scene.entities.filter((entity): entity is Actor => {
      if (
        !(entity instanceof Actor) ||
        entity === source ||
        entity.disabled ||
        entity.visible === false
      ) {
        return false;
      }
      const radius = Number.isFinite(entity.perceptionRadius)
        ? Math.max(0, entity.perceptionRadius)
        : 600;
      const distance = Math.hypot(entity.x - focusPoint.x, entity.y - focusPoint.y);
      if (distance > radius) return false;
      return this.getObjectPerception(entity, focus, true).visibility === 'visible';
    });
  }

  getActorListeners(
    source: Actor,
    scene: Scene | null = this.game.sceneManager.currentScene
  ): Actor[] {
    if (!scene) return [];
    return scene.entities.filter((entity): entity is Actor => {
      if (
        !(entity instanceof Actor) ||
        entity === source ||
        entity.disabled ||
        !ComponentSystem.isNpc(entity)
      ) {
        return false;
      }
      return this.getObjectPerception(entity, source, true, scene).visibility === 'visible';
    });
  }

  getObjectPerception(
    actor: Actor,
    object: SceneObject,
    fast: boolean = false,
    sceneOverride?: Scene | null
  ): ActorObjectPerception {
    const scene = sceneOverride || actor.scene || this.game.sceneManager.currentScene;
    if (!scene) {
      return { visibility: 'unknown', interaction: 'blocked', approach: 'unreachable' };
    }

    const inventorySlot =
      object instanceof Entity
        ? this.game.inventoryManager.getInventorySlotForEntity(object)
        : null;
    const held =
      object instanceof Entity &&
      this.game.inventoryManager.isEntityWithinActorInventory(actor, object);
    if (inventorySlot && inventorySlot.owner !== actor && inventorySlot.component.protected) {
      return { visibility: 'unknown', interaction: 'blocked', approach: 'unreachable' };
    }

    const accessState = getSceneTextLayerAccessState(scene, this.game, object);
    const location = this.getLocation(accessState, scene);
    if (held) {
      const visibility = accessState.hidden ? 'hidden' : 'visible';
      return {
        visibility,
        interaction: 'held',
        approach: 'already_reachable',
        ...(accessState.hiddenReason ? { hiddenReason: accessState.hiddenReason } : {}),
        ...(location ? { location } : {}),
      };
    }
    if (object.disabled && !accessState.inInactiveSubscene) {
      return { visibility: 'unknown', interaction: 'blocked', approach: 'unreachable' };
    }
    if (object.visible === false && !accessState.inInactiveSubscene) {
      return { visibility: 'unknown', interaction: 'blocked', approach: 'unreachable' };
    }
    const visibility = accessState.hidden ? 'hidden' : 'visible';
    if (visibility !== 'visible' || accessState.blocked) {
      return {
        visibility,
        interaction: 'blocked',
        approach: 'unreachable',
        ...(accessState.hiddenReason ? { hiddenReason: accessState.hiddenReason } : {}),
        ...(location ? { location } : {}),
      };
    }

    if (accessState.inInactiveSubscene) {
      const approachPlan = fast
        ? {
            status: this.navigation.getFastApproachStatus(actor, object),
          }
        : this.navigation.planApproach(actor, object);
      return {
        visibility,
        interaction: approachPlan.status === 'already_reachable' ? 'reachable' : 'blocked',
        approach: approachPlan.status,
        ...(location ? { location } : {}),
      };
    }

    if (object.disabled) {
      return {
        visibility: 'unknown',
        interaction: 'blocked',
        approach: 'unreachable',
        ...(location ? { location } : {}),
      };
    }

    if (fast) {
      const reachable = this.navigation.isReachable(actor, object);
      return {
        visibility,
        interaction: reachable ? 'reachable' : 'blocked',
        approach: reachable ? 'already_reachable' : 'route_available',
        ...(location ? { location } : {}),
      };
    }

    const approachPlan = this.navigation.planApproach(actor, object);
    return {
      visibility,
      interaction: approachPlan.status === 'already_reachable' ? 'reachable' : 'blocked',
      approach: approachPlan.status,
      ...(location ? { location } : {}),
    };
  }

  getInventoryKnowledge(actor: Actor): ActorInventoryKnowledge {
    const topLevelItems = this.game.inventoryManager
      .getInventoryEntities(actor, 'in')
      .filter((item) => !item.disabled);
    const items: ActorInventoryItemKnowledge[] = [];
    const visited = new Set<string>();
    const visit = (container: Entity) => {
      for (const component of ComponentSystem.getInventoryComponents(container)) {
        const relation = ComponentSystem.normalizeInventoryRelation(component);
        for (const item of this.game.inventoryManager.getInventoryEntities(container, relation)) {
          if (item.disabled || visited.has(item.name)) continue;
          visited.add(item.name);
          const groupIds = this.getObjectGroupIds(item);
          const states = ComponentSystem.getStateComponents(item).map((state) => ({
            id: state.id,
            value: ComponentSystem.getStateValue(item, state.id) ?? state.initialValue,
          }));
          items.push({
            id: item.name,
            title: this.game.textAssets.getResolvedObjectField(item, 'title') || item.name,
            containerId: container.name,
            relation,
            ...(groupIds.length ? { groupIds } : {}),
            ...(states.length ? { states } : {}),
          });
          visit(item);
        }
      }
    };
    visit(actor);
    return {
      available: this.game.inventoryManager.hasMainInventory(actor),
      itemIds: topLevelItems.map((item) => item.name),
      ...(items.length ? { items } : {}),
    };
  }

  private getObjectGroupIds(object: SceneObject): string[] {
    const rawGroupIds = [
      ...(Array.isArray((object as any).groupIds) ? (object as any).groupIds : []),
      (object as any).groupID,
    ];
    return Array.from(
      new Set(
        rawGroupIds
          .flatMap((value) => String(value || '').split(','))
          .map((value) => value.trim())
          .filter(Boolean)
      )
    );
  }

  getInspectionAffordance(object: SceneObject): {
    look: boolean;
    examine: boolean;
    possibleRelations: EffectiveRelation[];
  } {
    const titled = !!this.game.textAssets.getResolvedObjectField(object as any, 'title')?.trim();
    return {
      look: titled,
      examine: titled,
      possibleRelations: ['in', 'on', 'under', 'behind'],
    };
  }

  getSwitchAffordance(
    actor: Actor,
    object: SceneObject,
    scene: Scene | null = actor.scene || this.game.sceneManager.currentScene
  ): ActorSwitchAffordance | undefined {
    const component = this.game.getSwitchComponent(object);
    if (!component) return undefined;
    const state = component.state === 2 ? 'open' : 'closed';
    const keyId = String(component.idKey || component.keyId || '').trim();
    const key = keyId ? scene?.getObjectByName(keyId) : null;
    const keyHeld =
      key instanceof Entity && this.game.inventoryManager.hasInventoryEntity(actor, key, 'in');
    const keyKnown =
      key instanceof Entity &&
      this.getObjectPerception(actor, key, true, scene).visibility === 'visible';
    const locked = !!keyId && !keyHeld;
    return {
      state,
      canOpen: state === 'closed' && !locked,
      canClose: state === 'open',
      locked,
      keyHeld,
      ...(keyKnown ? { requiredKeyId: keyId } : {}),
    };
  }

  private getLocation(
    accessState: SceneTextLayerAccessState,
    scene: Scene
  ): ActorObjectPerception['location'] | undefined {
    if (!accessState.effectiveParentId || !accessState.effectiveRelation) return undefined;
    const target = scene.getObjectByName(accessState.effectiveParentId);
    const targetTitle = target
      ? this.game.textAssets.getResolvedObjectField(target as any, 'title')?.trim()
      : undefined;
    return {
      relation: accessState.effectiveRelation,
      targetId: accessState.effectiveParentId,
      ...(targetTitle ? { targetTitle } : {}),
    };
  }
}
