import { SceneObject } from '../entities/SceneObject';
import { QuadObject } from '../entities/QuadObject';
// We use 'any' for Actor/Entity imports inside methods to avoid circular dependency at top level if possible,
// or just import them. Circular imports are handled by webpack/vite usually, but let's be careful.
// Actually, using them as Types is fine.
import type { Actor } from '../entities/Actor';
import type { SpatialPlacement } from '../scene/spatialTypes';

import { ShadowSystem, type ShadowComponent } from './ShadowSystem';

import { BackfaceSystem, type BackfaceComponent } from './BackfaceSystem';

export interface SubsceneComponent {
  type: 'Subscene';
  targetGroupId: string;
  name?: string;
  nodeId?: string;
  title?: string;
  description?: string | null;
  spatial?: SpatialPlacement;
}

export interface SwitchComponent {
  type: 'Switch';
  idKey?: string;
  state?: number;
  sound1?: string;
  sound2?: string;
  groupId1?: string;
  groupId2?: string;
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

    const e = entity as unknown as { x: number; y: number };
    const dist = Math.hypot(player.x - e.x, player.y - e.y);
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
    if (!targetStr) return false;

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

    scene.activeSubscene = targetStr;
    scene.subsceneEntities.clear();

    const targets = scene.resolveTarget(targetStr);
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
    // 1. Check Key
    if (sw.idKey) {
      const game = scene.game as unknown as IGame;
      if (game && game.inventory) {
        const hasKey = game.inventory.some(
          (i) => i.name === sw.idKey || (i as unknown as { id?: string }).id === sw.idKey
        );
        if (!hasKey) {
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
          const keyTitle = keyEntity
            ? this.getPlayerFacingTitle(game, keyEntity as SceneObject)
            : null;
          game.showMessage(
            keyTitle
              ? game.text('engine.locked_needs', { item: keyTitle })
              : game.text('engine.locked_generic')
          );
          return true; // Handled (Blocked)
        }
      }
    }

    // 2. Toggle State
    // Default to state 1 if undefined
    const currentState = sw.state || 1;
    const nextState = currentState === 1 ? 2 : 1;
    sw.state = nextState;

    // 3. Audio
    const game = scene.game as unknown as IGame;
    if (game) {
      if (nextState === 1 && sw.sound1) game.playSound(sw.sound1);
      if (nextState === 2 && sw.sound2) game.playSound(sw.sound2);
    }

    // 4. Update Targets
    const targetStrShow = nextState === 1 ? sw.groupId1 : sw.groupId2;
    const targetStrHide = nextState === 1 ? sw.groupId2 : sw.groupId1;

    // Resolve
    if (scene.resolveTarget) {
      const toShow = scene.resolveTarget(targetStrShow || '');
      const toHide = scene.resolveTarget(targetStrHide || '');

      toShow.forEach((t) => {
        t.disabled = false;
        if (scene.activeSubscene && scene.subsceneEntities) scene.subsceneEntities.add(t);
      });

      toHide.forEach((t) => {
        // Don't disable self if self is in target list (safety)
        if (t === entity) return;

        t.disabled = true;
        if (scene.activeSubscene && scene.subsceneEntities) scene.subsceneEntities.delete(t);
      });
    }

    return true; // Handled
  }
}
