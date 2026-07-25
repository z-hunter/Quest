import { SceneObject } from '../entities/SceneObject';
import { Entity } from '../entities/Entity';
import { PolygonObject } from '../entities/PolygonObject';
import { QuadObject } from '../entities/QuadObject';
import type { SpatialRelationType } from '../scene/spatialTypes';
import { Actor } from '../entities/Actor';
import { Geometry } from '../utils/Geometry';
import { toVisualPosition } from '../utils/Parallax';
import {
  normalizeNpcMemory,
  normalizeNpcObjectives,
  type NpcObjective,
} from '../mechanics/npcState';

import { ShadowSystem, type ShadowComponent } from './ShadowSystem';

import { BackfaceSystem, type BackfaceComponent } from './BackfaceSystem';
import { traceNavigation } from './navigation/navigationDebug';

export interface SubsceneComponent {
  type: 'Subscene';
  targetGroupId: string;
  itemScale?: number;
  title?: string;
  description?: string | null;
}

export interface SwitchComponent {
  type: 'Switch';
  idKey?: string;
  keyId?: string;
  state?: number;
  sound1?: string;
  sound2?: string;
  groupId1?: string;
  groupId2?: string;
  transparent?: boolean;
  clearlyOpenable?: boolean;
  blockedRelation?: Exclude<SpatialRelationType, 'near'> | 'none';
}

export interface BlockerComponent {
  type: 'Blocker';
  transparent?: boolean;
  blockedRelation?: Exclude<SpatialRelationType, 'near'> | 'none';
}

export interface SubtriggerComponent {
  type: 'Subtrigger';
  target: string;
}

export interface ExitComponent {
  type: 'Exit';
  targetSceneId: string;
  targetEntryId: string;
  collider?: boolean;
  portal?: boolean;
  /** Keeps a local Exit available to navigation without exposing it to text systems. */
  navigationOnly?: boolean;
}

export interface EntryComponent {
  type: 'Entry';
  direction?: 'up' | 'down' | 'left' | 'right';
}

export interface ItemComponent {
  type: 'Item';
  ignoreDistance?: boolean;
}

export interface ActorComponent {
  type: 'Actor';
}

export interface NpcComponent {
  type: 'NPC';
  enabled?: boolean;
  /** Legacy scalar/string-list values are accepted at the persisted-scene boundary. */
  memory?: string[] | string;
  /** Runtime-only one-turn facts, such as a just-completed scene arrival. */
  transientMemory?: string[] | string;
  objectives?: NpcObjective[] | string[];
  memoryInitializedFromTA?: boolean;
  memoryTARevision?: string;
  objectivesInitializedFromTA?: boolean;
  objectivesTARevision?: string;
  knownEntities?: Record<string, NpcKnownEntityMemory>;
}

export interface NpcKnownEntityMemory {
  id: string;
  title: string;
  kind: 'item' | 'actor' | 'object';
  lastSeenSceneId: string;
  lastSeenAt: number;
  lastSeenLocation?: {
    sceneId: string;
    relation: Exclude<SpatialRelationType, 'near'>;
    targetId: string;
    targetTitle?: string;
  };
}

export interface InventoryComponent {
  type: 'Inventory';
  relation?: Exclude<SpatialRelationType, 'near'>;
  capacity?: number;
  groups?: string[];
  protected?: boolean;
  items?: string[];
}

export interface SurfaceItemPlacement {
  id: string;
  x: number;
  y: number;
}

export interface SurfaceComponent {
  type: 'Surface';
  relation?: Exclude<SpatialRelationType, 'near'>;
  capacity?: number;
  groups?: string[];
  items?: SurfaceItemPlacement[];
}

export type StateValueType = 'string' | 'number' | 'boolean';
export type StateValue = string | number | boolean;

export interface StateComponent {
  type: 'State';
  id: string;
  valueType: StateValueType;
  initialValue: StateValue;
  value?: StateValue;
  parserNoteTextAssets?: Record<string, string>;
}

import { ThreeDParallaxSystem, type ThreeDParallaxComponent } from './ThreeDParallaxSystem';
import type { ActivationSceneContext } from './types';

export interface WalkBoxComponent {
  type: 'WalkBox';
  mode?: 'Invert' | 'Add' | 'Subtract';
  perspectiveWalk3D?: boolean;
}

export type AnyComponent = (
  | SubsceneComponent
  | SwitchComponent
  | BlockerComponent
  | SubtriggerComponent
  | ExitComponent
  | EntryComponent
  | ItemComponent
  | ActorComponent
  | NpcComponent
  | InventoryComponent
  | SurfaceComponent
  | StateComponent
  | WalkBoxComponent
  | ShadowComponent
  | BackfaceComponent
  | ThreeDParallaxComponent
) & { mode?: string };

import type { IGame } from '../core/IGame';

export class ComponentSystem {
  static isNavigationOnlyExit(object: SceneObject | null | undefined): boolean {
    if (!object) return false;
    const hasExit = object.components?.some((c: any) => c?.type === 'Exit');
    if (!hasExit) return false;
    // An Exit without a customName/title is a technical (navigation-only) exit.
    if (object.customName && object.customName.trim() !== '') return false;

    const game = object.scene?.game as IGame | undefined;
    if (game && game.textAssets) {
      const title = game.textAssets.getResolvedObjectField(object as any, 'title');
      if (title && title.trim() !== '') return false;
    }

    return true;
  }

  static isStateValueType(value: unknown): value is StateValueType {
    return value === 'string' || value === 'number' || value === 'boolean';
  }

  static isStateValueOfType(value: unknown, valueType: StateValueType): value is StateValue {
    if (valueType === 'string') return typeof value === 'string';
    if (valueType === 'number') return typeof value === 'number' && Number.isFinite(value);
    return typeof value === 'boolean';
  }

  static getDefaultStateValue(valueType: StateValueType): StateValue {
    if (valueType === 'string') return '';
    if (valueType === 'number') return 0;
    return false;
  }

  static normalizeStateValue(value: unknown, valueType: StateValueType): StateValue {
    return this.isStateValueOfType(value, valueType) ? value : this.getDefaultStateValue(valueType);
  }

  static isStateInteractionKey(key: string): boolean {
    return /^state:/i.test(String(key || '').trim());
  }

  static hasClickInteractionKeys(entity: SceneObject | null | undefined): boolean {
    const interactions = (entity as any)?.interactions;
    if (!interactions || typeof interactions !== 'object') return false;
    return Object.keys(interactions).some((key) => !this.isStateInteractionKey(key));
  }

  static normalizeStateComponent(component: any): StateComponent | null {
    if (!component || typeof component !== 'object' || component.type !== 'State') return null;

    const valueType = this.isStateValueType(component.valueType) ? component.valueType : 'boolean';
    const initialValue = this.normalizeStateValue(component.initialValue, valueType);
    const normalized: StateComponent = {
      type: 'State',
      id: typeof component.id === 'string' ? component.id.trim() : '',
      valueType,
      initialValue,
    };

    if (component.value !== undefined) {
      normalized.value = this.normalizeStateValue(component.value, valueType);
    } else {
      normalized.value = initialValue;
    }

    const parserNoteTextAssets =
      component.parserNoteTextAssets && typeof component.parserNoteTextAssets === 'object'
        ? Object.entries(component.parserNoteTextAssets).reduce<Record<string, string>>(
            (acc, [rawValue, rawField]) => {
              const valueKey = String(rawValue || '').trim();
              const field = typeof rawField === 'string' ? rawField.trim() : '';
              if (valueKey && field) acc[valueKey] = field;
              return acc;
            },
            {}
          )
        : {};
    if (Object.keys(parserNoteTextAssets).length > 0) {
      normalized.parserNoteTextAssets = parserNoteTextAssets;
    }

    return normalized;
  }

  static normalizeInventoryRelation(
    component: InventoryComponent | null | undefined
  ): Exclude<SpatialRelationType, 'near'> {
    const relation = component?.relation;
    return relation === 'in' || relation === 'on' || relation === 'under' || relation === 'behind'
      ? relation
      : 'in';
  }

  static normalizeSurfaceRelation(
    component: SurfaceComponent | null | undefined
  ): Exclude<SpatialRelationType, 'near'> {
    const relation = component?.relation;
    return relation === 'in' || relation === 'on' || relation === 'under' || relation === 'behind'
      ? relation
      : 'on';
  }

  static getInventoryComponents(entity: SceneObject | null | undefined): InventoryComponent[] {
    if (!entity?.components) return [];
    return entity.components.filter(
      (component: any): component is InventoryComponent => component?.type === 'Inventory'
    );
  }

  static getSurfaceComponents(entity: SceneObject | null | undefined): SurfaceComponent[] {
    if (!entity?.components) return [];
    return entity.components.filter(
      (component: any): component is SurfaceComponent => component?.type === 'Surface'
    );
  }

  static getStateComponents(entity: SceneObject | null | undefined): StateComponent[] {
    if (!entity?.components) return [];
    return entity.components
      .filter((component: any): component is StateComponent => component?.type === 'State')
      .map((component) => this.normalizeStateComponent(component))
      .filter((component): component is StateComponent => !!component && !!component.id);
  }

  static getNpcComponent(entity: SceneObject | null | undefined): NpcComponent | null {
    if (!entity?.components) return null;
    const component = entity.components.find(
      (candidate: any): candidate is NpcComponent => candidate?.type === 'NPC'
    );
    if (!component) return null;
    // Migrate persisted v1 cognition lazily at the component boundary so saves and
    // authored scenes may still contain scalar memory or string-list objectives.
    if (component.memory !== undefined) component.memory = normalizeNpcMemory(component.memory);
    if (component.transientMemory !== undefined) {
      component.transientMemory = normalizeNpcMemory(component.transientMemory);
    }
    if (Array.isArray(component.objectives)) {
      component.objectives = normalizeNpcObjectives(component.objectives);
    }
    return {
      type: 'NPC',
      enabled: component.enabled !== false,
      memory: normalizeNpcMemory(component.memory),
      transientMemory: normalizeNpcMemory(component.transientMemory),
      objectives: component.objectives,
      memoryInitializedFromTA: component.memoryInitializedFromTA === true,
      memoryTARevision:
        typeof component.memoryTARevision === 'string' ? component.memoryTARevision : undefined,
      objectivesInitializedFromTA: component.objectivesInitializedFromTA === true,
      objectivesTARevision:
        typeof component.objectivesTARevision === 'string'
          ? component.objectivesTARevision
          : undefined,
      knownEntities: (() => {
        if (!component.knownEntities || typeof component.knownEntities !== 'object') {
          return undefined;
        }
        const cleaned: Record<string, NpcKnownEntityMemory> = {};
        for (const [key, entry] of Object.entries(component.knownEntities)) {
          if (entry && typeof entry === 'object') {
            const rawId = (entry as any).id;
            const rawTitle = (entry as any).title;
            const rawKind = (entry as any).kind;
            const id = typeof rawId === 'string' ? rawId.trim() : '';
            const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
            const kind =
              rawKind === 'item' || rawKind === 'actor' || rawKind === 'object'
                ? rawKind
                : 'object';

            const rawSceneId = (entry as any).lastSeenSceneId;
            const rawAt = (entry as any).lastSeenAt;
            const lastSeenSceneId = typeof rawSceneId === 'string' ? rawSceneId : '';
            const lastSeenAt = typeof rawAt === 'number' ? rawAt : 0;
            const rawLocation = (entry as any).lastSeenLocation;
            const relation = rawLocation?.relation;
            const targetId =
              typeof rawLocation?.targetId === 'string' ? rawLocation.targetId.trim() : '';
            const locationSceneId =
              typeof rawLocation?.sceneId === 'string'
                ? rawLocation.sceneId.trim()
                : lastSeenSceneId;
            const targetTitle =
              typeof rawLocation?.targetTitle === 'string' ? rawLocation.targetTitle.trim() : '';
            const lastSeenLocation =
              rawLocation &&
              (relation === 'in' ||
                relation === 'on' ||
                relation === 'under' ||
                relation === 'behind') &&
              targetId &&
              locationSceneId
                ? {
                    sceneId: locationSceneId,
                    relation,
                    targetId,
                    ...(targetTitle ? { targetTitle } : {}),
                  }
                : undefined;

            if (id && title) {
              cleaned[key] = {
                id,
                title,
                kind,
                lastSeenSceneId,
                lastSeenAt,
                ...(lastSeenLocation ? { lastSeenLocation } : {}),
              };
            }
          }
        }
        return Object.keys(cleaned).length > 0 ? cleaned : undefined;
      })(),
    };
  }

  static getSwitchComponent(entity: SceneObject | null | undefined): SwitchComponent | null {
    if (!entity?.components) return null;
    const component = entity.components.find(
      (candidate: any): candidate is SwitchComponent => candidate?.type === 'Switch'
    );
    return component || null;
  }

  static isNpc(entity: SceneObject | null | undefined): boolean {
    return !!this.getNpcComponent(entity)?.enabled;
  }

  static getStateComponent(
    entity: SceneObject | null | undefined,
    stateId: string
  ): StateComponent | null {
    const normalizedId = String(stateId || '').trim();
    if (!normalizedId) return null;
    const component = entity?.components?.find(
      (candidate: any) =>
        candidate?.type === 'State' && String(candidate?.id || '').trim() === normalizedId
    );
    return this.normalizeStateComponent(component);
  }

  static getStateValue(
    entity: SceneObject | null | undefined,
    stateId: string
  ): StateValue | undefined {
    const component = this.getStateComponent(entity, stateId);
    if (!component) return undefined;
    return component.value !== undefined ? component.value : component.initialValue;
  }

  static setStateValue(
    entity: SceneObject | null | undefined,
    stateId: string,
    value: unknown
  ): boolean {
    const normalizedId = String(stateId || '').trim();
    if (!normalizedId || !entity?.components) return false;
    const component = entity.components.find(
      (candidate: any) =>
        candidate?.type === 'State' && String(candidate?.id || '').trim() === normalizedId
    ) as StateComponent | undefined;
    if (!component) return false;

    const normalized = this.normalizeStateComponent(component);
    if (!normalized || !this.isStateValueOfType(value, normalized.valueType)) return false;

    component.id = normalized.id;
    component.valueType = normalized.valueType;
    component.initialValue = normalized.initialValue;
    component.value = value;
    if (normalized.parserNoteTextAssets) {
      component.parserNoteTextAssets = normalized.parserNoteTextAssets;
    } else {
      delete component.parserNoteTextAssets;
    }
    return true;
  }

  private static getDirectSpatialChildren(
    rootIds: string[],
    scene: ActivationSceneContext
  ): SceneObject[] {
    const roots = new Set(
      rootIds.map((value) => String(value || '').trim()).filter((value) => !!value)
    );
    if (roots.size === 0) return [];

    const allObjects: SceneObject[] = [
      ...scene.entities,
      ...(scene.walkbox || []),
      ...scene.triggerboxes,
    ];
    const result = new Set<SceneObject>();

    for (const obj of allObjects) {
      const objectParentId =
        typeof (obj as any).spatial?.parentNodeId === 'string'
          ? (obj as any).spatial.parentNodeId.trim()
          : '';

      if (objectParentId && roots.has(objectParentId)) {
        result.add(obj);
        continue;
      }
    }

    return Array.from(result);
  }

  private static collectSubsceneSpatialTargets(
    rootIds: string[],
    scene: ActivationSceneContext
  ): SceneObject[] {
    const result = new Set<SceneObject>();
    const visitedParentIds = new Set<string>();
    const queue = rootIds.map((value) => String(value || '').trim()).filter((value) => !!value);

    while (queue.length > 0) {
      const parentId = queue.shift();
      if (!parentId || visitedParentIds.has(parentId)) continue;
      visitedParentIds.add(parentId);

      const children = this.getDirectSpatialChildren([parentId], scene);
      for (const child of children) {
        if (!result.has(child)) {
          result.add(child);
        }

        const isNestedSubscene = child.components?.some(
          (component: any) => component?.type === 'Subscene'
        );
        if (!isNestedSubscene) {
          queue.push(child.name);
        }
      }
    }

    return Array.from(result);
  }

  private static syncSubsceneSwitchStates(
    targets: SceneObject[],
    scene: ActivationSceneContext
  ): void {
    for (const target of targets) {
      const switchComponent = target.components?.find(
        (component: any) => component?.type === 'Switch'
      ) as SwitchComponent | undefined;
      if (!switchComponent) continue;
      const currentState = switchComponent.state === 2 ? 2 : 1;
      this.applySwitchState(target, switchComponent, scene, currentState, { playSound: false });
    }
  }

  private static isDetachedFromSubsceneRoot(
    target: SceneObject,
    subsceneRootId: string | null | undefined
  ): boolean {
    const normalizedRoot = String(subsceneRootId || '').trim();
    if (!normalizedRoot) return false;
    const detached = Array.isArray((target as any).__detachedSubsceneRootIds)
      ? ((target as any).__detachedSubsceneRootIds as string[])
      : [];
    return detached.includes(normalizedRoot);
  }

  private static getPlayerFacingTitle(game: IGame | undefined, entity: SceneObject): string | null {
    const title = game?.textAssets.getResolvedObjectField(entity, 'title');
    return title && title.trim() ? title.trim() : null;
  }

  static update(context: ActivationSceneContext | SceneObject, dt: number) {
    if ((context as ActivationSceneContext).entities) {
      const scene = context as ActivationSceneContext;
      const allObjects: SceneObject[] = [
        ...scene.entities,
        ...(scene.walkbox || []),
        ...scene.triggerboxes,
      ];
      for (const entity of allObjects) {
        this.updateSingleObject(entity, dt);
      }
      return;
    }

    this.updateSingleObject(context as SceneObject, dt);
  }

  private static updateSingleObject(entity: SceneObject, _dt: number) {
    if (!entity.components) return;

    for (const comp of entity.components) {
      if (comp.type === 'Shadow') {
        // We assume Shadow is only on Actors for now, or entities with x/y/width/height
        // We logic relies on 'Actor' properties.
        // We can check type or cast.
        if (entity.type === 'Actor' || entity.type === 'Player') {
          ShadowSystem.update(entity as unknown as Actor, comp as ShadowComponent);
        }
      } else if (comp.type === 'Backface') {
        if (entity.type === 'Quad') {
          BackfaceSystem.update(entity as unknown as QuadObject, comp as BackfaceComponent);
        }
      } else if (comp.type === '3d-parallax') {
        if (entity.type === 'Quad') {
          ThreeDParallaxSystem.update(
            entity as unknown as QuadObject,
            comp as ThreeDParallaxComponent
          );
        }
      }
    }
  }

  // Called on Interaction/Activation (Click or Trigger)
  // Returns TRUE if component handled the activation (blocking default)
  static handleActivation(
    entity: SceneObject,
    scene: ActivationSceneContext,
    depth: number = 0,
    activator?: Actor
  ): boolean {
    if (!entity.components) return false;

    for (const comp of entity.components) {
      if (comp.type === 'Exit') {
        return this.handleExit(entity, comp as ExitComponent, scene, activator);
      } else if (comp.type === 'Subtrigger') {
        return this.handleSubtrigger(entity, comp as SubtriggerComponent, scene, depth, activator);
      } else if (comp.type === 'Subscene') {
        return this.handleSubscene(entity, comp as SubsceneComponent, scene, activator);
      } else if (comp.type === 'Switch') {
        return this.handleSwitch(entity, comp as SwitchComponent, scene, activator);
      }
    }
    return false;
  }

  private static handleExit(
    exitObject: SceneObject,
    exit: ExitComponent,
    scene: ActivationSceneContext,
    activator?: Actor
  ): boolean {
    const sceneManager = scene.game?.sceneManager;
    const targetSceneId = exit.targetSceneId?.trim() || scene.id;
    if (!sceneManager || !targetSceneId) return false;
    if (!sceneManager.scenes.has(targetSceneId) && !sceneManager.sceneRegistry.has(targetSceneId)) {
      return false;
    }

    if (activator) {
      traceNavigation(scene.game, 'exit_activated', {
        actorId: activator.name,
        exitId: exitObject.name,
        sourceSceneId: scene.id,
        targetSceneId,
        targetEntryId: exit.targetEntryId?.trim() || null,
        navigationOnly: ComponentSystem.isNavigationOnlyExit(exitObject),
        actorPosition: { x: activator.x, y: activator.y },
      });
      if (ComponentSystem.isNavigationOnlyExit(exitObject)) {
        scene.game?.emitActorAction?.(activator, 'left_immediate_area');
      } else {
        scene.game?.emitActorAction?.(activator, 'traverse_exit', exitObject, {
          targetId: exitObject.name,
        });
      }
      sceneManager.transferActorToScene(activator, targetSceneId, {
        targetEntryId: exit.targetEntryId?.trim() || null,
        activateScene: activator === sceneManager.currentScene?.player,
      });
      return true;
    }

    sceneManager.switchTo(targetSceneId);
    return true;
  }

  static checkTriggerboxCollisions(scene: ActivationSceneContext): void {
    const actors = scene.entities.filter(
      (entity): entity is Actor => entity instanceof Actor && !entity.disabled && entity.visible
    );
    if (actors.length === 0) return;

    const exitObjects = [...scene.entities, ...scene.triggerboxes].filter(
      (obj) =>
        !obj.disabled &&
        obj.components?.some(
          (component) =>
            component.type === 'Exit' && (component as ExitComponent).collider !== false
        )
    );
    if (exitObjects.length === 0) return;

    for (const actor of actors) {
      for (const exitObject of exitObjects) {
        if (!this.exitObjectIntersectsActor(exitObject, actor, scene)) continue;
        scene.activateObject(exitObject, 0, actor);
        return;
      }
    }
  }

  private static exitObjectIntersectsActor(
    exitObject: SceneObject,
    actor: Actor,
    scene: ActivationSceneContext
  ): boolean {
    const actorRect = this.getActorVisualColliderRect(actor, scene);
    if (!actorRect) {
      const point = this.getActorVisualPoint(actor, scene);
      return exitObject.containsPoint(point.x, point.y);
    }

    if (exitObject instanceof QuadObject) {
      const poly = this.getQuadVisualPolygon(exitObject, scene);
      return Geometry.rectIntersectsPolygon(actorRect, poly);
    }

    if (exitObject instanceof PolygonObject) {
      const poly = this.getPolygonVisualPolygon(exitObject, scene);
      return Geometry.rectIntersectsPolygon(actorRect, poly);
    }

    if (exitObject instanceof Entity) {
      const targetRect = this.getEntityVisualRect(exitObject, scene);
      return Geometry.rectIntersectsRect(actorRect, targetRect);
    }

    return this.getRectProbePoints(actorRect).some((point) =>
      exitObject.containsPoint(point.x, point.y)
    );
  }

  private static getActorVisualPoint(
    actor: Actor,
    scene: ActivationSceneContext
  ): { x: number; y: number } {
    const p = actor.parallax !== undefined ? actor.parallax : 1.0;
    const visualOffset = (actor as any).visualOffset || { x: 0, y: 0 };
    return toVisualPosition({ x: actor.x, y: actor.y }, scene.camera, p, visualOffset);
  }

  private static getActorVisualColliderRect(
    actor: Actor,
    scene: ActivationSceneContext
  ): { x: number; y: number; w: number; h: number } | null {
    if (actor.colliderWidth <= 0 || actor.colliderHeight <= 0) return null;

    const visual = this.getActorVisualPoint(actor, scene);
    return {
      x: visual.x - actor.colliderWidth / 2,
      y: visual.y - actor.colliderHeight,
      w: actor.colliderWidth,
      h: actor.colliderHeight,
    };
  }

  private static getQuadVisualPolygon(
    quad: QuadObject,
    scene: ActivationSceneContext
  ): { x: number; y: number }[] {
    return quad.vertices.map((v) => {
      const p = v.p !== undefined ? v.p : quad.parallax !== undefined ? quad.parallax : 1.0;
      return toVisualPosition({ x: v.x, y: v.y }, scene.camera, p);
    });
  }

  private static getPolygonVisualPolygon(
    polygon: PolygonObject,
    scene: ActivationSceneContext
  ): { x: number; y: number }[] {
    const p = polygon.parallax !== undefined ? polygon.parallax : 1.0;
    return polygon.poly.map((v) => toVisualPosition(v, scene.camera, p));
  }

  private static getEntityVisualRect(
    entity: Entity,
    scene: ActivationSceneContext
  ): { x: number; y: number; w: number; h: number } {
    const p = entity.parallax !== undefined ? entity.parallax : 1.0;
    const visualOffset = (entity as any).visualOffset || { x: 0, y: 0 };
    const visual = toVisualPosition({ x: entity.x, y: entity.y }, scene.camera, p, visualOffset);
    return {
      x: visual.x - entity.width / 2,
      y: visual.y - entity.height,
      w: entity.width,
      h: entity.height,
    };
  }

  private static getRectProbePoints(rect: {
    x: number;
    y: number;
    w: number;
    h: number;
  }): { x: number; y: number }[] {
    return [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.w, y: rect.y },
      { x: rect.x + rect.w, y: rect.y + rect.h },
      { x: rect.x, y: rect.y + rect.h },
      { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
    ];
  }

  private static getPointToSegmentDistance(
    point: { x: number; y: number },
    start: { x: number; y: number },
    end: { x: number; y: number }
  ): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= 0) return Math.hypot(point.x - start.x, point.y - start.y);

    const t = Math.max(
      0,
      Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq)
    );
    return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
  }

  private static getPointToPolygonDistance(
    point: { x: number; y: number },
    polygon: Array<{ x: number; y: number }>
  ): number {
    if (Geometry.isPointInPolygon(point, polygon)) return 0;
    return polygon.reduce((closest, start, index) => {
      const end = polygon[(index + 1) % polygon.length];
      return Math.min(closest, this.getPointToSegmentDistance(point, start, end));
    }, Number.POSITIVE_INFINITY);
  }

  // Called when trying to TAKE an item
  // Returns string (error message) or null (success)
  static getInteractionDistanceError(
    entity: SceneObject,
    player: Actor | null,
    options?: { ignoreDistance?: boolean; ignoreSpatialAncestors?: boolean }
  ): string | null {
    const game = (entity as any).game as IGame | undefined;
    if (!player || options?.ignoreDistance) return null;

    const actorCenter = {
      x: player.x || 0,
      y: (player.y || 0) - (player.height || 0) / 2,
    };

    let distanceTarget = entity;
    const visitedInventoryOwners = new Set<Entity>();
    while (distanceTarget instanceof Entity) {
      if (visitedInventoryOwners.has(distanceTarget)) break;
      visitedInventoryOwners.add(distanceTarget);
      const owner = distanceTarget.getInventoryPositionOwner();
      if (!owner) break;
      distanceTarget = owner;
    }

    let targetX = 0;
    let targetY = 0;
    let dist: number | null = null;
    const surfacePlacement = this.getSurfacePlacementReferencePoint(distanceTarget);

    if (surfacePlacement) {
      targetX = surfacePlacement.x;
      targetY = surfacePlacement.y;
    } else if (
      (Array.isArray((distanceTarget as any).poly) && (distanceTarget as any).poly.length > 0) ||
      (Array.isArray((distanceTarget as any).vertices) &&
        (distanceTarget as any).vertices.length > 0)
    ) {
      const rawPoints = (
        Array.isArray((distanceTarget as any).poly)
          ? (distanceTarget as any).poly
          : (distanceTarget as any).vertices
      ) as Array<{ x: number; y: number; p?: number }>;
      const camera = game?.sceneManager?.currentScene?.camera;
      const poly = rawPoints.map((vertex) => {
        const parallax = vertex.p ?? (distanceTarget as any).parallax ?? 1;
        return camera
          ? toVisualPosition({ x: vertex.x, y: vertex.y }, camera, parallax)
          : { x: vertex.x, y: vertex.y };
      });
      dist = this.getPointToPolygonDistance(actorCenter, poly);
      targetX = poly.reduce((sum, point) => sum + point.x, 0) / poly.length;
      targetY = poly.reduce((sum, point) => sum + point.y, 0) / poly.length;
    } else {
      const e = distanceTarget as unknown as { x?: number; y?: number };
      targetX = e.x || 0;
      targetY = e.y || 0;
    }

    dist ??= Math.hypot(actorCenter.x - targetX, actorCenter.y - targetY);
    // A zero collider disables collision, but must not grant interaction range
    // based on an arbitrarily large visual sprite.
    const interactionWidth = player.colliderWidth === 0 ? 30 : player.width || 30;
    const allowedDist = interactionWidth * 2;

    if (dist > allowedDist) {
      if (!options?.ignoreSpatialAncestors) {
        const scene = game?.sceneManager?.currentScene;
        const visited = new Set<string>([String(entity.name || '')]);
        let parentId = String((entity as any).spatial?.parentNodeId || '').trim();
        for (let depth = 0; scene && parentId && depth < 16; depth++) {
          if (visited.has(parentId)) break;
          visited.add(parentId);
          const parent = scene.getObjectByName(parentId);
          if (!parent) break;
          // A walkbox is the floor/navigation mesh, not a physical parent that
          // can put a distant item within arm's reach.
          if (parent.type === 'Walkbox') break;
          if (
            !this.getInteractionDistanceError(parent, player, {
              ignoreSpatialAncestors: true,
            })
          ) {
            return null;
          }
          parentId = String((parent as any).spatial?.parentNodeId || '').trim();
        }
      }
      const title = this.getPlayerFacingTitle(game, entity);
      if (title) {
        return (
          game?.text('engine.too_far_from_entity', { target: title }) ||
          `You are too far away from the ${title}.`
        );
      }
      return game?.text('engine.too_far_generic') || 'You are too far away.';
    }

    return null;
  }

  private static getSurfacePlacementReferencePoint(
    entity: SceneObject
  ): { x: number; y: number } | null {
    const game = (entity as any).game as IGame | undefined;
    const scene = game?.sceneManager?.currentScene;
    if (!scene) return null;

    const entityId = String(entity.name || '').trim();
    const parentId =
      typeof (entity as any).spatial?.parentNodeId === 'string'
        ? (entity as any).spatial.parentNodeId.trim()
        : '';
    if (!entityId || !parentId) return null;

    for (const candidate of scene.getAllSceneObjects?.() || []) {
      if (candidate.name !== parentId) continue;
      for (const component of this.getSurfaceComponents(candidate)) {
        const placement = component.items?.find((item: any) => item?.id === entityId);
        const x = Number((placement as any)?.x);
        const y = Number((placement as any)?.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          return { x, y };
        }
      }
    }
    return null;
  }

  static canTakeItem(entity: SceneObject, player: Actor | null): string | null {
    const game = (entity as any).game as IGame | undefined;
    if (!entity.components) return game?.text('parser.take_cannot') || 'You cannot take that.';

    const itemComp = entity.components.find((c: any) => c.type === 'Item') as
      | ItemComponent
      | undefined;
    // Legacy fallback: entity.isTakeable? We'll assume caller checked legacy flags if this returns 'not an item'.
    // But here we strictly check component.

    if (!itemComp) return null; // Not an item component, let caller handle legacy or fail

    const scene = game?.sceneManager?.currentScene as ActivationSceneContext | undefined | null;
    const ignoreDistanceForActiveSubscene =
      !!scene?.activeSubscene && !!scene.subsceneEntities?.has(entity);

    const distanceError = this.getInteractionDistanceError(entity, player, {
      ignoreDistance: !!itemComp.ignoreDistance || ignoreDistanceForActiveSubscene,
    });
    if (distanceError) return distanceError;

    return null; // OK
  }

  static getInventoryComponent(
    entity: SceneObject | null | undefined,
    relation?: Exclude<SpatialRelationType, 'near'> | null
  ): InventoryComponent | null {
    const components = this.getInventoryComponents(entity);
    if (!components.length) return null;
    if (!relation) {
      return components[0] || null;
    }
    return (
      components.find((component) => this.normalizeInventoryRelation(component) === relation) ||
      null
    );
  }

  static getSurfaceComponent(
    entity: SceneObject | null | undefined,
    relation?: Exclude<SpatialRelationType, 'near'> | null
  ): SurfaceComponent | null {
    const components = this.getSurfaceComponents(entity);
    if (!components.length) return null;
    if (!relation) {
      return components[0] || null;
    }
    const exact = components.find(
      (component) => this.normalizeSurfaceRelation(component) === relation
    );
    if (exact) return exact;
    if (entity?.type === 'Walkbox' && relation === 'on') {
      return components[0] || null;
    }
    return null;
  }

  static getGroupIds(entity: SceneObject | null | undefined): string[] {
    const raw = String(entity?.groupID || '').trim();
    if (!raw) return [];
    return Array.from(
      new Set(
        raw
          .split(/[,\s]+/)
          .map((value) => value.trim())
          .filter((value) => value.startsWith('#'))
      )
    );
  }

  private static handleSubtrigger(
    entity: SceneObject,
    sub: SubtriggerComponent,
    scene: ActivationSceneContext,
    depth: number,
    activator?: Actor
  ): boolean {
    const targetName = sub.target;
    if (!targetName) {
      console.warn(`[Subtrigger] No target specified for '${entity.name}'`);
      return false;
    }

    const targetObj =
      scene.triggerboxes.find((t) => t.name === targetName) ||
      scene.entities.find((e) => e.name === targetName);

    if (targetObj) {
      scene.activateObject(targetObj, depth + 1, activator);
    } else {
      console.warn(`[Subtrigger] Target '${targetName}' not found.`);
    }
    return true; // Hanlded
  }

  private static handleSubscene(
    entity: SceneObject,
    sub: SubsceneComponent,
    scene: ActivationSceneContext,
    activator?: Actor
  ): boolean {
    const targetStr = sub.targetGroupId ? sub.targetGroupId.trim() : '';
    if (!targetStr && !entity.name) return false;

    // Proximity Check (if player exists)
    const actor = activator || scene.player;
    if (actor) {
      let cx = 0,
        cy = 0;
      if (entity.type === 'Triggerbox') {
        const poly = (entity as unknown as { poly?: { x: number; y: number }[] }).poly;
        if (poly) {
          poly.forEach((p) => {
            cx += p.x;
            cy += p.y;
          });
          cx /= poly.length;
          cy /= poly.length;
        }
      } else {
        const e = entity as unknown as { x?: number; y?: number; height?: number };
        cx = e.x || 0;
        cy = (e.y || 0) - (e.height || 0) / 2;
      }

      const actorCenterY = actor.y - (actor.height || 0) / 2;
      const dist = Math.hypot(actor.x - cx, actorCenterY - cy);
      const allowedDist = (actor.width || 30) * 4.5;

      if (dist > allowedDist) {
        const game = scene.game as unknown as IGame;
        if (game && typeof game.showMessage === 'function') {
          game.showMessage(game.text('engine.too_far_generic'));
        }
        return true; // Blocked
      }
    }

    const spatialRootIds = Array.from(
      new Set(
        [targetStr, entity.name]
          .map((value) => String(value || '').trim())
          .filter((value) => !!value)
      )
    );
    const spatialTargets = this.collectSubsceneSpatialTargets(spatialRootIds, scene);
    const groupTargets = targetStr ? scene.resolveTarget(targetStr) : [];
    const activeSubsceneId = entity.name || targetStr;
    const targets = Array.from(new Set([...groupTargets, ...spatialTargets])).filter(
      (target) => !this.isDetachedFromSubsceneRoot(target, activeSubsceneId)
    );

    scene.activeSubscene = activeSubsceneId;
    scene.subsceneEntities.clear();
    targets.forEach((t) => {
      t.disabled = false;
      scene.subsceneEntities.add(t);
    });
    this.syncSubsceneSwitchStates(targets, scene);
    return true; // Handled
  }

  private static handleSwitch(
    entity: SceneObject,
    sw: SwitchComponent,
    scene: ActivationSceneContext,
    activator?: Actor
  ): boolean {
    const blocked = this.getSwitchLockError(entity, sw, scene, activator);
    if (blocked) {
      (scene.game as unknown as IGame).showMessage(blocked.message);
      return true;
    }

    const currentState = sw.state === 2 ? 2 : 1;
    const nextState = currentState === 1 ? 2 : 1;
    this.applySwitchState(entity, sw, scene, nextState);
    return true;
  }

  static getSwitchLockError(
    _entity: SceneObject,
    sw: SwitchComponent,
    scene: ActivationSceneContext,
    actor?: Actor | null
  ): { code: 'switch_locked'; message: string } | null {
    const requiredKeyId = String(sw.idKey || sw.keyId || '').trim();
    if (!requiredKeyId) return null;

    const game = scene.game as unknown as IGame;
    const activeActor = actor || scene.player || null;
    if (!game?.inventoryManager || !(activeActor instanceof Entity)) return null;
    const hasKey = game.inventoryManager
      .getInventoryEntities(activeActor, 'in')
      .some(
        (i) => i.name === requiredKeyId || (i as unknown as { id?: string }).id === requiredKeyId
      );
    if (hasKey) return null;

    const keyEntity =
      scene.entities.find(
        (i) => i.name === requiredKeyId || (i as unknown as { id?: string }).id === requiredKeyId
      ) ||
      scene.triggerboxes.find(
        (i) => i.name === requiredKeyId || (i as unknown as { id?: string }).id === requiredKeyId
      );
    const keyTitle = keyEntity ? this.getPlayerFacingTitle(game, keyEntity as SceneObject) : null;

    return {
      code: 'switch_locked',
      message: keyTitle
        ? game.text('engine.locked_needs', { item: keyTitle })
        : game.text('engine.locked_generic'),
    };
  }

  static applySwitchState(
    entity: SceneObject,
    sw: SwitchComponent,
    scene: ActivationSceneContext,
    nextState: 1 | 2,
    options?: { playSound?: boolean; updateVisualTargets?: boolean }
  ): void {
    sw.state = nextState;

    const game = scene.game as unknown as IGame;
    if (options?.playSound !== false) {
      if (nextState === 1 && sw.sound1) game?.playSound(sw.sound1);
      if (nextState === 2 && sw.sound2) game?.playSound(sw.sound2);
    }

    const targetStrShow = nextState === 1 ? sw.groupId1 : sw.groupId2;
    const targetStrHide = nextState === 1 ? sw.groupId2 : sw.groupId1;

    if (!scene.resolveTarget || options?.updateVisualTargets === false) return;

    const toShow = scene.resolveTarget(targetStrShow || '');
    const toHide = scene.resolveTarget(targetStrHide || '');

    toShow.forEach((target) => {
      target.disabled = false;
      if (scene.activeSubscene && scene.subsceneEntities) scene.subsceneEntities.add(target);
    });

    toHide.forEach((target) => {
      if (target === entity) return;
      target.disabled = true;
      if (scene.activeSubscene && scene.subsceneEntities) scene.subsceneEntities.delete(target);
    });
  }
}
