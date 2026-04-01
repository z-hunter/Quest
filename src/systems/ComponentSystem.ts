import { SceneObject } from '../entities/SceneObject';
import { QuadObject } from '../entities/QuadObject';
// We use 'any' for Actor/Entity imports inside methods to avoid circular dependency at top level if possible,
// or just import them. Circular imports are handled by webpack/vite usually, but let's be careful.
// Actually, using them as Types is fine.
import type { Actor } from '../entities/Actor';

import { ShadowSystem, type ShadowComponent } from './ShadowSystem';

import { BackfaceSystem, type BackfaceComponent } from './BackfaceSystem';

export interface SubsceneComponent {
  type: 'Subscene';
  targetGroupId: string;
  title?: string;
  description?: string | null;
}

export interface SwitchComponent {
  type: 'Switch';
  idKey?: string;
  state?: number;
  sound1?: string;
  sound2?: string;
  groupId1?: string;
  groupId2?: string;
  transparent?: boolean;
  clearlyOpenable?: boolean;
}

export interface SubtriggerComponent {
  type: 'Subtrigger';
  target: string;
}

export interface ItemComponent {
  type: 'Item';
  ignoreDistance?: boolean;
}

import { ThreeDParallaxSystem, type ThreeDParallaxComponent } from './ThreeDParallaxSystem';
import type { ActivationSceneContext } from './types';

export interface WalkBoxComponent {
  type: 'WalkBox';
  mode?: 'Invert' | 'Add' | 'Subtract';
}

import type { IGame } from '../core/IGame';

export class ComponentSystem {
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

  private static getPlayerFacingTitle(game: IGame | undefined, entity: SceneObject): string | null {
    const title = game?.textAssets.getResolvedObjectField(entity, 'title');
    return title && title.trim() ? title.trim() : null;
  }

  static update(entity: any, _dt: number) {
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
    depth: number = 0
  ): boolean {
    if (!entity.components) return false;

    for (const comp of entity.components) {
      if (comp.type === 'Subtrigger') {
        return this.handleSubtrigger(entity, comp as SubtriggerComponent, scene, depth);
      } else if (comp.type === 'Subscene') {
        return this.handleSubscene(entity, comp as SubsceneComponent, scene);
      } else if (comp.type === 'Switch') {
        return this.handleSwitch(entity, comp as SwitchComponent, scene);
      }
    }
    return false;
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

    if (
      Array.isArray((entity as any).poly) &&
      (entity as any).poly.length > 0
    ) {
      const poly = (entity as any).poly as Array<{ x: number; y: number }>;
      targetX = poly.reduce((sum, point) => sum + point.x, 0) / poly.length;
      targetY = poly.reduce((sum, point) => sum + point.y, 0) / poly.length;
    } else {
      const e = entity as unknown as { x?: number; y?: number };
      targetX = e.x || 0;
      targetY = e.y || 0;
    }

    const dist = Math.hypot(player.x - targetX, player.y - targetY);
    const allowedDist = (player.width || 30) * 4;

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

  static canTakeItem(entity: SceneObject, player: Actor | null): string | null {
    const game = (entity as any).game as IGame | undefined;
    if (!entity.components) return game?.text('parser.take_cannot') || 'You cannot take that.';

    const itemComp = entity.components.find((c: any) => c.type === 'Item') as
      | ItemComponent
      | undefined;
    // Legacy fallback: entity.isTakeable? We'll assume caller checked legacy flags if this returns 'not an item'.
    // But here we strictly check component.

    if (!itemComp) return null; // Not an item component, let caller handle legacy or fail

    const distanceError = this.getInteractionDistanceError(entity, player, {
      ignoreDistance: !!itemComp.ignoreDistance,
    });
    if (distanceError) return distanceError;

    return null; // OK
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
      const allowedDist = (player.width || 30) * 4;

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
    const spatialTargets = this.getDirectSpatialChildren(spatialRootIds, scene);
    const groupTargets = targetStr ? scene.resolveTarget(targetStr) : [];
    const targets = Array.from(new Set([...groupTargets, ...spatialTargets]));
    const activeSubsceneId = entity.name || targetStr;

    scene.activeSubscene = activeSubsceneId;
    scene.subsceneEntities.clear();
    targets.forEach((t) => {
      t.disabled = false;
      scene.subsceneEntities.add(t);
    });
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
    nextState: 1 | 2
  ): void {
    sw.state = nextState;

    const game = scene.game as unknown as IGame;
    if (nextState === 1 && sw.sound1) game?.playSound(sw.sound1);
    if (nextState === 2 && sw.sound2) game?.playSound(sw.sound2);

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
