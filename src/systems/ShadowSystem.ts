import { Actor } from '../entities/Actor';
import { QuadObject } from '../entities/QuadObject';

export interface ShadowComponent {
    type: 'Shadow';
    id: string;
    shadowQuadId: string;
    offsetX: number;
    offsetY: number;
    triggerId: string;
}

export class ShadowSystem {

    // Cache for Shadow Scale State to support delta scaling
    // Key: ShadowQuadID, Value: { lastScale: number }
    private static shadowCache = new Map<string, { lastScale: number }>();

    static update(actor: Actor, shadow: ShadowComponent) {
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

        const vOx = 0;
        const vOy = 0;

        const checkX = ax + shiftX + vOx;
        const checkY = ay + shiftY + vOy;

        let inside = false;

        for (const t of targets) {
            if (typeof t.hitTest === 'function') {
                const hit = t.hitTest(checkX, checkY);
                if (hit) {
                    inside = true;
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

                // 4. Move & Scale Shadow

                // Check Editing State
                let isEdited = false;
                // @ts-ignore
                if (scene.game && scene.game.editor && scene.game.editor.enabled) {
                    // @ts-ignore
                    const editor = scene.game.editor;
                    // @ts-ignore
                    if ((editor.selectedObject === qObj || qObj.selected) && editor.transformManager && editor.transformManager.isDragging) {
                        isEdited = true;
                    }
                }

                if (isEdited) {
                    // Reset Cache logic during editing to prevent interference
                    this.shadowCache.delete(qObj.name);
                    return;
                }

                // --- DELTA SCALING & DYNAMIC SHAPE LOGIC ---
                // We want to:
                // 1. Respect the current shape (which might be impacted by 3d-parallax).
                // 2. Scale it if the Actor's scale changed since last frame.
                // 3. Move it to follow the Actor.

                const currentScale = actor.scale || 1.0;
                let cache = this.shadowCache.get(qObj.name) as {
                    lastScale: number;
                    baseOffsets: { x: number, y: number }[];
                } | undefined;

                // Check Editing State/Cache Validity
                // @ts-ignore
                const isSelected = qObj.selected || (scene.game && scene.game.editor && scene.game.editor.selectedObject === qObj);

                // If no cache, or selected (potentially edited), regenerate cache
                if (!cache || isSelected) {
                    // Capture Base Shape (Visual Offsets from V0)
                    const v0 = qObj.vertices[0];
                    const v0p = v0.p !== undefined ? v0.p : 1.0;
                    const v0VisX = v0.x - camX * (v0p - 1.0);
                    const v0VisY = v0.y - camY * (v0p - 1.0);

                    const offsets = [];
                    for (let i = 1; i < qObj.vertices.length; i++) {
                        const v = qObj.vertices[i];
                        const vp = v.p !== undefined ? v.p : 1.0;
                        const visX = v.x - camX * (vp - 1.0);
                        const visY = v.y - camY * (vp - 1.0);

                        // Store Normalized Offset (descale by current scale)
                        // So BaseOffset represents "Scale 1.0" shape
                        const factor = currentScale !== 0 ? 1.0 / currentScale : 1.0;
                        offsets.push({
                            x: (visX - v0VisX) * factor,
                            y: (visY - v0VisY) * factor
                        });
                    }

                    cache = {
                        lastScale: currentScale,
                        baseOffsets: offsets
                    };
                    this.shadowCache.set(qObj.name, cache);
                } else {
                    // Update lastScale for tracking (if we needed delta, but we use absolute now)
                    cache.lastScale = currentScale;
                }

                // 2. Calculate BASE V0 Visual Position (Target)
                const actorVisX = actor.x - camX * (pFactor - 1.0);
                const actorVisY = actor.y - camY * (pFactor - 1.0);

                const scaledOffsetX = (shadow.offsetX || 0) * currentScale;
                const scaledOffsetY = (shadow.offsetY || 0) * currentScale;

                const targetVisX = actorVisX + scaledOffsetX;
                const targetVisY = actorVisY + scaledOffsetY;

                // 3. Position V0 (World)
                // Use current V0 P
                const v0p = qObj.vertices[0].p !== undefined ? qObj.vertices[0].p : 1.0;
                qObj.vertices[0].x = targetVisX + camX * (v0p - 1.0);
                qObj.vertices[0].y = targetVisY + camY * (v0p - 1.0);

                // 4. Position V1..V3 using CACHED OFFSETS
                for (let i = 0; i < cache.baseOffsets.length; i++) {
                    const vertexIndex = i + 1;
                    if (vertexIndex >= qObj.vertices.length) break;

                    const v = qObj.vertices[vertexIndex];
                    const vp = v.p !== undefined ? v.p : 1.0;
                    const baseOff = cache.baseOffsets[i];

                    // Apply Current Scale to Base Offset
                    const newOffX = baseOff.x * currentScale;
                    const newOffY = baseOff.y * currentScale;

                    const newVisX = targetVisX + newOffX;
                    const newVisY = targetVisY + newOffY;

                    v.x = newVisX + camX * (vp - 1.0);
                    v.y = newVisY + camY * (vp - 1.0);
                }

                // Update Entity Pos
                qObj.x = qObj.vertices[0].x;
                qObj.y = qObj.vertices[0].y;

            } else {
                // Outside
                if (qObj.visible) {
                    qObj.visible = false;
                    qObj.disabled = true;
                }
            }
        }
    }
}
