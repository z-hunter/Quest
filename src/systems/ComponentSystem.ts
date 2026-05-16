import { SceneObject } from '../entities/SceneObject';
import { Entity } from '../entities/Entity';
import { PolygonObject } from '../entities/PolygonObject';
import { QuadObject } from '../entities/QuadObject';
import type { SpatialRelationType } from '../scene/spatialTypes';
import { Actor } from '../entities/Actor';
import { Geometry } from '../utils/Geometry';
import { toVisualPosition } from '../utils/Parallax';

import { ShadowSystem, type ShadowComponent } from './ShadowSystem';

import { BackfaceSystem, type BackfaceComponent } from './BackfaceSystem';

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

import { ThreeDParallaxSystem, type ThreeDParallaxComponent } from './ThreeDParallaxSystem';
import type { ActivationSceneContext } from './types';

export interface WalkBoxComponent {
  type: 'WalkBox';
  mode?: 'Invert' | 'Add' | 'Subtract';
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
  | InventoryComponent
  | SurfaceComponent
  | WalkBoxComponent
  | ShadowComponent
  | BackfaceComponent
  | ThreeDParallaxComponent
) & { mode?: string };

import type { IGame } from '../core/IGame';

export class ComponentSystem {
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
        return this.handleExit(comp as ExitComponent, scene, activator);
      } else if (comp.type === 'Subtrigger') {
        return this.handleSubtrigger(entity, comp as SubtriggerComponent, scene, depth);
      } else if (comp.type === 'Subscene') {
        return this.handleSubscene(entity, comp as SubsceneComponent, scene);
      } else if (comp.type === 'Switch') {
        return this.handleSwitch(entity, comp as SwitchComponent, scene);
      }
    }
    return false;
  }

  private static handleExit(
    exit: ExitComponent,
    scene: ActivationSceneContext,
    activator?: Actor
  ): boolean {
    const sceneManager = scene.game?.sceneManager;
    const targetSceneId = exit.targetSceneId?.trim() || scene.id;
    if (!sceneManager || !targetSceneId) return false;

    sceneManager.pendingEntryId = exit.targetEntryId?.trim() || null;
    sceneManager.switchTo(targetSceneId, activator);
    return true;
  }

  static checkTriggerboxCollisions(scene: ActivationSceneContext): void {
    const actors = scene.entities.filter(
      (entity): entity is Actor => entity instanceof Actor && !entity.disabled && entity.visible
    );
    if (actors.length === 0) return;

    const exitObjects = [...scene.entities, ...scene.triggerboxes].filter(
      (obj) => !obj.disabled && obj.components?.some((component) => component.type === 'Exit')
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
    options?: { ignoreDistance?: boolean }
  ): string | null {
    const game = (entity as any).game as IGame | undefined;
    if (!player || options?.ignoreDistance) return null;

    let targetX = 0;
    let targetY = 0;
    let dist: number | null = null;
    const surfacePlacement = this.getSurfacePlacementReferencePoint(entity);

    if (surfacePlacement) {
      targetX = surfacePlacement.x;
      targetY = surfacePlacement.y;
    } else if (Array.isArray((entity as any).poly) && (entity as any).poly.length > 0) {
      const poly = (entity as any).poly as Array<{ x: number; y: number }>;
      dist = this.getPointToPolygonDistance({ x: player.x || 0, y: player.y || 0 }, poly);
      targetX = poly.reduce((sum, point) => sum + point.x, 0) / poly.length;
      targetY = poly.reduce((sum, point) => sum + point.y, 0) / poly.length;
    } else {
      const e = entity as unknown as { x?: number; y?: number };
      targetX = e.x || 0;
      targetY = e.y || 0;
    }

    dist ??= Math.hypot(player.x - targetX, player.y - targetY);
    const allowedDist = (player.width || 30) * 3.3;

    if (dist > allowedDist) {
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
    depth: number
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
      scene.activateObject(targetObj, depth + 1);
    } else {
      console.warn(`[Subtrigger] Target '${targetName}' not found.`);
    }
    return true; // Hanlded
  }

  private static handleSubscene(
    entity: SceneObject,
    sub: SubsceneComponent,
    scene: ActivationSceneContext
  ): boolean {
    const targetStr = sub.targetGroupId ? sub.targetGroupId.trim() : '';
    if (!targetStr && !entity.name) return false;

    // Proximity Check (if player exists)
    const player = scene.player;
    if (player) {
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

      const dist = Math.hypot(player.x - cx, player.y - cy);
      const allowedDist = (player.width || 30) * 4.5;

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
    scene: ActivationSceneContext
  ): boolean {
    const blocked = this.getSwitchLockError(entity, sw, scene);
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
    scene: ActivationSceneContext
  ): { code: 'switch_locked'; message: string } | null {
    if (!sw.idKey) return null;

    const game = scene.game as unknown as IGame;
    if (!game?.inventory) return null;

    const hasKey = game.inventory.some(
      (i) => i.name === sw.idKey || (i as unknown as { id?: string }).id === sw.idKey
    );
    if (hasKey) return null;

    const keyEntity =
      game.inventory.find(
        (i) => i.name === sw.idKey || (i as unknown as { id?: string }).id === sw.idKey
      ) ||
      scene.entities.find(
        (i) => i.name === sw.idKey || (i as unknown as { id?: string }).id === sw.idKey
      ) ||
      scene.triggerboxes.find(
        (i) => i.name === sw.idKey || (i as unknown as { id?: string }).id === sw.idKey
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
    options?: { playSound?: boolean }
  ): void {
    sw.state = nextState;

    const game = scene.game as unknown as IGame;
    if (options?.playSound !== false) {
      if (nextState === 1 && sw.sound1) game?.playSound(sw.sound1);
      if (nextState === 2 && sw.sound2) game?.playSound(sw.sound2);
    }

    const targetStrShow = nextState === 1 ? sw.groupId1 : sw.groupId2;
    const targetStrHide = nextState === 1 ? sw.groupId2 : sw.groupId1;

    if (!scene.resolveTarget) return;

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
