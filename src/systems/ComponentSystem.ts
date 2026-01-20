
import { SceneObject } from '../entities/SceneObject';
import { QuadObject } from '../entities/QuadObject';
// We use 'any' for Actor/Entity imports inside methods to avoid circular dependency at top level if possible,
// or just import them. Circular imports are handled by webpack/vite usually, but let's be careful.
// Actually, using them as Types is fine.
import type { Actor } from '../entities/Actor';

export interface ShadowComponent {
    type: 'Shadow';
    id: string;
    shadowQuadId: string;
    offsetX: number;
    offsetY: number;
    triggerId: string;
}

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
    idKey: string;
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

export class ComponentSystem {

    static update(entity: SceneObject, dt: number) {
        if (!entity.components) return;

        for (const comp of entity.components) {
            if (comp.type === 'Shadow') {
                // We assume Shadow is only on Actors for now, or entities with x/y/width/height
                // We logic relies on 'Actor' properties.
                // We can check type or cast.
                if (entity.type === 'Actor' || entity.type === 'Player') {
                    this.handleShadow(entity as unknown as Actor, comp as ShadowComponent);
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
            // Constraint: Only update if moving
            if (actor.state !== 'walk') continue;

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

                const rangeY = v2.y - v1.y;
                if (Math.abs(rangeY) > 1) {
                    // Interpolate
                    // t = 0 at V1 (Top), t = 1 at V2 (Bottom)
                    const t = (actor.y - v1.y) / rangeY;
                    const clampedT = Math.max(0, Math.min(1, t));

                    const newP = v1.p + (v2.p - v1.p) * clampedT;

                    // Apply
                    // Apply
                    actor.parallax = newP;

                    // Correction: Counteract horizontal drift caused by Parallax Perspective
                    // VisualX = WorldX - CamX * P. We want VisualX to mimic P=1 behavior (Orthographic X).
                    // Offset = CamX * (P - 1.0)
                    if (!actor.visualOffset) actor.visualOffset = { x: 0, y: 0 };
                    actor.visualOffset.x = camX * (newP - 1.0);
                    // console.log(`[3D-Parallax] Actor ${actor.name} P updated to ${newP.toFixed(3)} (T=${clampedT.toFixed(2)})`);
                }
            }
        }
    }

    private static handleShadow(actor: Actor, shadow: ShadowComponent) {
        // @ts-ignore
        const scene = actor.scene;
        if (!scene) return;

        if (!shadow.shadowQuadId || !shadow.triggerId) return;

        // 1. Resolve Targets (Triggers)
        // @ts-ignore
        const targets = scene.resolveTarget ? scene.resolveTarget(shadow.triggerId) : [];

        // 2. Check if Actor Center is inside any target (Visual/Parallax Corrected)
        // @ts-ignore
        const camX = scene.camera ? scene.camera.x : 0;
        // @ts-ignore
        const camY = scene.camera ? scene.camera.y : 0;

        // Actor Base World Pos
        const ax = actor.x;
        const ay = actor.y; // Feet

        // Actor Visual Pos (Shifted by its Parallax)
        const pFactor = actor.parallax !== undefined ? actor.parallax : 1.0;
        const shiftX = -camX * (pFactor - 1.0);
        const shiftY = -camY * (pFactor - 1.0);

        const vOx = actor.visualOffset ? actor.visualOffset.x : 0;
        const vOy = actor.visualOffset ? actor.visualOffset.y : 0;

        const checkX = ax + shiftX + vOx;
        const checkY = ay + shiftY + vOy;

        let inside = false;
        let hitTarget: QuadObject | undefined;

        for (const t of targets) {
            if (typeof t.hitTest === 'function') {
                const hit = t.hitTest(checkX, checkY);
                if (hit) {
                    inside = true;
                    // @ts-ignore
                    hitTarget = t.type === 'Quad' ? t : undefined;
                    break;
                }
            }
        }

        // 3. Find Shadow Quad
        let qObj: QuadObject | undefined;

        // @ts-ignore
        if (scene.findEntity) {
            // @ts-ignore
            qObj = scene.findEntity(shadow.shadowQuadId) as QuadObject;
        }

        if (!qObj) {
            // @ts-ignore
            if (scene.entities) {
                // @ts-ignore
                qObj = scene.entities.find((e: any) => e.name.toLowerCase() === shadow.shadowQuadId.toLowerCase());
            }
        }

        if (qObj && qObj.type === 'Quad') {
            if (inside) {
                if (!qObj.visible || qObj.disabled) {
                    qObj.visible = true;
                    qObj.disabled = false;
                }

                // 4. Parallax Sync & Dynamic Inclination
                let bottomParallax = pFactor;

                if (hitTarget && hitTarget.type === 'Quad') {
                    const tQuad = hitTarget as QuadObject;
                    const tv1 = tQuad.vertices[1]; // TR
                    const tv2 = tQuad.vertices[2]; // BR

                    const rangeY = tv2.y - tv1.y;
                    if (Math.abs(rangeY) > 1) {
                        const t = (actor.y - tv1.y) / rangeY;
                        const clampedT = Math.max(0, Math.min(1, t));

                        // Lerp Parallax
                        bottomParallax = tv1.p + (tv2.p - tv1.p) * clampedT;
                    }
                }

                // Apply Parallax
                if (qObj.vertices) {
                    qObj.vertices[0].p = pFactor;
                    qObj.vertices[1].p = pFactor;
                    qObj.vertices[2].p = bottomParallax;
                    qObj.vertices[3].p = bottomParallax;
                }

                // 5. Move Shadow
                const targetX = actor.x + (shadow.offsetX || 0);
                const targetY = actor.y + (shadow.offsetY || 0);

                const v0 = qObj.vertices[0];
                const dx = targetX - v0.x;
                const dy = targetY - v0.y;

                if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
                    qObj.vertices.forEach(v => {
                        v.x += dx;
                        v.y += dy;
                    });
                    qObj.x = targetX;
                    qObj.y = targetY;
                }

                // Sync Visual Offset (For 3D Parallax Correction)
                if (actor.visualOffset) {
                    if (!qObj.visualOffset) qObj.visualOffset = { x: 0, y: 0 };
                    qObj.visualOffset.x = actor.visualOffset.x;
                    qObj.visualOffset.y = actor.visualOffset.y;
                } else if (qObj.visualOffset) {
                    // Reset if actor has no offset
                    qObj.visualOffset.x = 0;
                    qObj.visualOffset.y = 0;
                }

            } else {
                // Outside
                if (qObj.visible) {
                    qObj.visible = false;
                    qObj.disabled = true;
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
            const dist = Math.hypot(player.x - entity.x, player.y - entity.y);
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
                cx = entity.x;
                cy = entity.y - (entity.height || 0) / 2;
            }

            const dist = Math.hypot(player.x - cx, player.y - cy);
            const allowedDist = (player.width || 30) * 4;

            if (dist > allowedDist) {
                console.log(`[Scene] Activation too far: ${dist.toFixed(1)} > ${allowedDist}`);
                // @ts-ignore
                const game = window.game;
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
        if (sw.idKey) {
            // @ts-ignore
            const game = window.game;
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
        return false; // Not blocked, proceed to activate children or normal interaction
    }
}
