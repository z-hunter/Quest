
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

export interface WalkBoxComponent {
    type: 'WalkBox';
    mode?: 'Invert' | 'Add' | 'Subtract';
}

import type { IGame } from '../core/IGame';

export class ComponentSystem {

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
                    ThreeDParallaxSystem.update(entity as unknown as QuadObject, comp as ThreeDParallaxComponent);
                }
            }
        }
    }





    // Called on Interaction/Activation (Click or Trigger)
    // Returns TRUE if component handled the activation (blocking default)
    static handleActivation(entity: SceneObject, scene: any): boolean {
        if (!entity.components) return false;

        for (const comp of entity.components) {
            if (comp.type === 'Subtrigger') {
                return this.handleSubtrigger(entity, comp as SubtriggerComponent, scene);
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
    static canTakeItem(entity: SceneObject, player: Actor): string | null {
        if (!entity.components) return 'You cannot take that.';

        const itemComp = entity.components.find((c: any) => c.type === 'Item') as ItemComponent | undefined;
        // Legacy fallback: entity.isTakeable? We'll assume caller checked legacy flags if this returns 'not an item'.
        // But here we strictly check component.

        if (!itemComp) return null; // Not an item component, let caller handle legacy or fail

        // Check Proximity
        if (!itemComp.ignoreDistance && player) {
            const e = entity as any;
            const dist = Math.hypot(player.x - e.x, player.y - e.y);
            const allowedDist = (player.width || 30) * 4; // Tolerance

            if (dist > allowedDist) {
                return `You are too far away from the ${entity.name}.`;
            }
        }

        return null; // OK
    }

    private static handleSubtrigger(entity: SceneObject, sub: SubtriggerComponent, scene: any): boolean {
        const targetName = sub.target;
        if (!targetName) {
            console.warn(`[Subtrigger] No target specified for '${entity.name}'`);
            return false;
        }

        // Find Target Object (Entity or Triggerbox)
        // @ts-ignore
        const targetObj = (scene.triggerboxes || []).find(t => t.name === targetName) || (scene.entities || []).find(e => e.name === targetName);

        if (targetObj) {
            console.log(`  -> Delegating to '${targetObj.name}'`);
            // Recursive call to scene activation
            if (scene.activateObject) {
                scene.activateObject(targetObj, (scene._depth || 0) + 1);
            }
        } else {
            console.warn(`[Subtrigger] Target '${targetName}' not found.`);
        }
        return true; // Hanlded
    }

    private static handleSubscene(entity: SceneObject, sub: SubsceneComponent, scene: any): boolean {
        const targetStr = sub.targetGroupId ? sub.targetGroupId.trim() : '';
        if (!targetStr) return false;

        // Proximity Check (if player exists)
        // @ts-ignore
        const player = scene.player;
        if (player) {
            let cx = 0, cy = 0;
            if (entity.type === 'Triggerbox') {
                // @ts-ignore
                const poly = (entity as any).poly;
                if (poly) {
                    // @ts-ignore
                    poly.forEach(p => { cx += p.x; cy += p.y; });
                    cx /= poly.length;
                    cy /= poly.length;
                }
            } else {
                const e = entity as any;
                cx = e.x || 0;
                cy = (e.y || 0) - (e.height || 0) / 2;
            }

            const dist = Math.hypot(player.x - cx, player.y - cy);
            const allowedDist = (player.width || 30) * 4;

            if (dist > allowedDist) {
                console.log(`[Scene] Activation too far: ${dist.toFixed(1)} > ${allowedDist}`);
                // @ts-ignore
                const game = scene.game as IGame;
                if (game && typeof game.showMessage === 'function') {
                    game.showMessage("You are too far away.");
                }
                return true; // Blocked
            }
        }

        console.log(`  -> Activating Subscene Target: '${targetStr}'`);
        // We need to manipulate scene state. 
        // Ideally ComponentSystem shouldn't mutate Scene direct internals if possible, but here we must.
        // @ts-ignore
        scene.activeSubscene = targetStr;
        // @ts-ignore
        if (scene.subsceneEntities) scene.subsceneEntities.clear();

        // @ts-ignore
        if (scene.resolveTarget) {
            // @ts-ignore
            const targets = scene.resolveTarget(targetStr);
            // @ts-ignore
            targets.forEach(t => {
                t.disabled = false;
                // @ts-ignore
                if (scene.subsceneEntities) scene.subsceneEntities.add(t);
            });
        }
        return true; // Handled
    }

    private static handleSwitch(entity: SceneObject, sw: SwitchComponent, scene: any): boolean {
        // 1. Check Key
        if (sw.idKey) {
            // @ts-ignore
            const game = scene.game as IGame;
            // @ts-ignore
            if (game && game.inventory) {
                // @ts-ignore
                const hasKey = game.inventory.some((i: any) => i.name === sw.idKey || i.id === sw.idKey);
                if (!hasKey) {
                    console.log(`[Switch] Access Denied. Missing key: ${sw.idKey}`);
                    game.showMessage(`Locked. Needs ${sw.idKey}`);
                    return true; // Handled (Blocked)
                }
            }
        }

        // 2. Toggle State
        // Default to state 1 if undefined
        const currentState = sw.state || 1;
        const nextState = currentState === 1 ? 2 : 1;
        sw.state = nextState;
        console.log(`[Switch] Toggling to State ${nextState}`);

        // 3. Audio
        // @ts-ignore
        const game = scene.game as IGame;
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

            // Apply
            // @ts-ignore
            toShow.forEach((t: any) => {
                t.disabled = false;
                if (scene.activeSubscene && scene.subsceneEntities) scene.subsceneEntities.add(t);
            });

            // @ts-ignore
            toHide.forEach((t: any) => {
                // Don't disable self if self is in target list (safety)
                if (t === entity) return;

                t.disabled = true;
                if (scene.activeSubscene && scene.subsceneEntities) scene.subsceneEntities.delete(t);
            });

            console.log(`[Switch] Updated Targets. Enabled '${targetStrShow}', Disabled '${targetStrHide}'`);
        }

        return true; // Handled
    }
}
