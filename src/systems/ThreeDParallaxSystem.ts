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
                // Calculate new Parallax using centralized Barycentric Interpolation
                // We use Visual Coordinates because the hitTest was done in Visual Space (implied by the shiftX/Y usage which simulates P=1 for checking)
                // Actually wait, checkX/Y above are: actor.x + shiftX.
                // shiftX = -camX * (pFactor - 1.0).
                // checkX = actor.x - camX * (p - 1.0) => This IS the Visual Coordinate of the actor!

                // So we pass checkX, checkY and true (isVisual)
                const newP = quad.getParallaxAt(checkX, checkY, true);

                // Apply new Parallax
                // Only if different?
                actor.parallax = newP;

                // Update Actor World Position to maintain Visual Position
                // Wy = Vy + Cy * (P - 1)
                // Wx = Vx + Cx * (P - 1)
                const newWorldX = checkX + camX * (newP - 1.0);
                const newWorldY = checkY + camY * (newP - 1.0);

                actor.x = newWorldX;
                actor.y = newWorldY;
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
                                const newP = quad.getParallaxAt(svVisX, svVisY, true);

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
