import { Actor } from '../entities/Actor';
import { QuadObject } from '../entities/QuadObject';
import type { ShadowComponent } from './ShadowSystem';

export interface ThreeDParallaxComponent {
    type: '3d-parallax';
}

export class ThreeDParallaxSystem {

    static update(quad: QuadObject, _comp: ThreeDParallaxComponent) {
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
}
