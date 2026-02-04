
import { SceneObject } from '../entities/SceneObject';
import { QuadObject } from '../entities/QuadObject';
// We use 'any' for Actor/Entity imports inside methods to avoid circular dependency at top level if possible,
// or just import them. Circular imports are handled by webpack/vite usually, but let's be careful.
// Actually, using them as Types is fine.
import type { Actor } from '../entities/Actor';

import { ShadowSystem, type ShadowComponent } from './ShadowSystem';

export interface BackfaceComponent {
    type: 'Backface';
    vertexA?: number;
    vertexB?: number;
    axis?: 'x' | 'y';
    op?: '>' | '<';
    targetId?: string;
    cullingType?: 'layer' | 'render';
}

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

export interface ThreeDParallaxComponent {
    type: '3d-parallax';
}

export interface WalkBoxComponent {
    type: 'WalkBox';
    mode?: 'Invert' | 'Add' | 'Subtract';
}

import type { IGame } from '../core/IGame';

export class ComponentSystem {

    static update(entity: SceneObject, dt: number) {
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
                    this.handleBackface(entity as unknown as QuadObject, comp as BackfaceComponent);
                }
            } else if (comp.type === '3d-parallax') {
                if (entity.type === 'Quad') {
                    this.handleThreeDParallax(entity as unknown as QuadObject, comp as ThreeDParallaxComponent);
                }
            }
        }
    }

    private static handleThreeDParallax(quad: QuadObject, comp: ThreeDParallaxComponent) {
        // @ts-ignore
        const scene = quad.scene;
        if (!scene || !scene.entities) return;

        // Iterate over all Actors in the scene
        // @ts-ignore
        const actors = scene.entities.filter((e: any) => e.type === 'Actor' || e.type === 'Player') as Actor[];

        // @ts-ignore
        const camX = scene.camera ? scene.camera.x : 0;
        // @ts-ignore
        const camY = scene.camera ? scene.camera.y : 0;

        for (const actor of actors) {
            // Constraint: Only update if moving? No, update always to handle Editor dragging / Teleport / Idle on moving platform
            // if (actor.state !== 'walk') continue;

            // Check if Actor is ON this Quad
            // Use Visual Position for hitTest
            const pFactor = actor.parallax !== undefined ? actor.parallax : 1.0;
            const shiftX = -camX * (pFactor - 1.0);
            const shiftY = -camY * (pFactor - 1.0);

            const checkX = actor.x + shiftX;
            const checkY = actor.y + shiftY;

            if (quad.hitTest(checkX, checkY)) {
                // Calculate new Parallax based on Right Edge (V1 -> V2)
                // V1: Top-Right, V2: Bottom-Right
                if (!quad.vertices || quad.vertices.length < 3) continue;

                const v1 = quad.vertices[1];
                const v2 = quad.vertices[2];

                // Visual Interpolation to prevent Feedback Loop
                // Calculate Visual Y of vertices and Actor
                const p1 = v1.p !== undefined ? v1.p : 1.0;
                const p2 = v2.p !== undefined ? v2.p : 1.0;

                const visY1 = v1.y - camY * (p1 - 1.0);
                const visY2 = v2.y - camY * (p2 - 1.0);

                const actorP = actor.parallax !== undefined ? actor.parallax : 1.0;
                const actorVisY = actor.y - camY * (actorP - 1.0);

                const visRangeY = visY2 - visY1;

                if (Math.abs(visRangeY) > 1) {
                    // Interpolate t in Visual Space (Stable)
                    const t = (actorVisY - visY1) / visRangeY;
                    const clampedT = Math.max(0, Math.min(1, t));

                    const newP = p1 + (p2 - p1) * clampedT;

                    // Apply new Parallax
                    actor.parallax = newP;

                    // Update Actor World Y to maintain this Visual Position with new Parallax
                    // Vy = Wy - Cy * (P - 1)  ->  Wy = Vy + Cy * (P - 1)
                    // We use the SAME actorVisY, but now with newP.
                    // This ensures the actor doesn't visually jump.

                    // However, we also need to ensure World Y is consistent with the Quad's slope?
                    // If we just stabilize Visual Y, we might drift off the quad in World Space if we iterate.
                    // But "Being on the Quad" is a Visual concept for the player.
                    // Let's rely on the stability of Vy.

                    const newWorldY = actorVisY + camY * (newP - 1.0);

                    // Also stabilize X?
                    // Visual X should be constant.
                    const actorVisX = actor.x - camX * (actorP - 1.0);
                    const newWorldX = actorVisX + camX * (newP - 1.0);

                    actor.x = newWorldX;
                    actor.y = newWorldY;
                }
            }

            // --- Shadow Logic ---
            // Check if actor has a Shadow component
            // We need to update the Shadow Vertices to also respect the Parallax Layer they are on.
            if (actor.components) {
                const shadowComp = actor.components.find(c => c.type === 'Shadow') as ShadowComponent | undefined;
                if (shadowComp && shadowComp.shadowQuadId) {
                    // Find Shadow Quad
                    // @ts-ignore
                    const shadowQuad = scene.findEntity ? scene.findEntity(shadowComp.shadowQuadId) : scene.entities.find((e: any) => e.name === shadowComp.shadowQuadId);

                    if (shadowQuad && shadowQuad.type === 'Quad') {
                        // Iterate Vertices of the Shadow
                        for (const sv of shadowQuad.vertices) {
                            // Calculate Visual Pos of Shadow Vertex
                            const svP = sv.p !== undefined ? sv.p : 1.0;
                            const svVisX = sv.x - camX * (svP - 1.0);
                            const svVisY = sv.y - camY * (svP - 1.0);

                            // Hit Test against the Parallax Floor (quad) using Visual Coordinates
                            if (quad.hitTest(svVisX, svVisY)) {
                                // Interpolate Parallax for this vertex
                                // Reuse logic from above
                                if (quad.vertices.length >= 3) {
                                    const v1 = quad.vertices[1];
                                    const v2 = quad.vertices[2];

                                    const p1 = v1.p !== undefined ? v1.p : 1.0;
                                    const p2 = v2.p !== undefined ? v2.p : 1.0;

                                    const visY1 = v1.y - camY * (p1 - 1.0);
                                    const visY2 = v2.y - camY * (p2 - 1.0);
                                    const visRangeY = visY2 - visY1;

                                    if (Math.abs(visRangeY) > 1) {
                                        const t = (svVisY - visY1) / visRangeY;
                                        const clampedT = Math.max(0, Math.min(1, t));

                                        const newP = p1 + (p2 - p1) * clampedT;

                                        // Only update if changed (epsilon check?)
                                        if (Math.abs(newP - svP) > 0.0001) {
                                            // Debug Log
                                            if (Math.random() < 0.01) console.log(`[3dParallax] Updating Shadow Vertex P: ${svP.toFixed(3)} -> ${newP.toFixed(3)}`);

                                            // Apply Correction
                                            sv.p = newP;
                                            // Fix World Position to keep Visual Position constant
                                            sv.x = svVisX + camX * (newP - 1.0);
                                            sv.y = svVisY + camY * (newP - 1.0);
                                        }
                                    }
                                }
                            }
                        }
                    }


                }
            }
        }
    }

    private static handleBackface(quad: QuadObject, bf: BackfaceComponent) {
        // @ts-ignore
        const scene = quad.scene;
        if (!scene) return;

        // Props: vertexA (0-3), vertexB (0-3), axis ('x'|'y'), op ('>'|'<'), targetId (opt)
        const idxA = bf.vertexA || 0;
        const idxB = bf.vertexB || 1;
        const axis = bf.axis || 'x'; // 'x' or 'y'
        const op = bf.op || '>'; // '>' or '<'

        const vA = quad.vertices[idxA];
        const vB = quad.vertices[idxB];

        if (!vA || !vB) return;

        const pA = vA.p !== undefined ? vA.p : 1.0;
        const pB = vB.p !== undefined ? vB.p : 1.0;

        // @ts-ignore
        const camX = scene.camera.x;
        // @ts-ignore
        const camY = scene.camera.y;

        // Calculate Visual Coordinate
        const valA = (axis === 'x' ? vA.x : vA.y) - (axis === 'x' ? camX : camY) * pA;
        const valB = (axis === 'x' ? vB.x : vB.y) - (axis === 'x' ? camX : camY) * pB;

        let match = false;
        if (op === '>') match = valA > valB;
        else if (op === '<') match = valA < valB;

        // Resolve Targets (Unified)
        let targets: any[] = [];
        if (!bf.targetId) {
            targets.push(quad);
        } else {
            // @ts-ignore
            if (scene.resolveTarget) {
                // @ts-ignore
                targets = scene.resolveTarget(bf.targetId);
            } else {
                // @ts-ignore
                const found = scene.entities.find((e: any) => e.name === bf.targetId.trim());
                if (found) targets.push(found);
            }
        }

        if (targets.length > 0) {
            const cullingType = bf.cullingType || 'layer';

            targets.forEach(target => {
                if (match) {
                    if (cullingType === 'render') {
                        target.visible = false;
                        // @ts-ignore
                        target.renderLayer = undefined;
                    } else {
                        // Layer Mode
                        // @ts-ignore
                        target.renderLayer = target.layer - 1;
                        target.visible = true;
                    }
                } else {
                    target.visible = true;
                    // @ts-ignore
                    target.renderLayer = undefined;
                }
            });
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
