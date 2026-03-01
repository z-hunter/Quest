import { Actor } from '../entities/Actor';
import { QuadObject } from '../entities/QuadObject';
import type { ShadowComponent } from './ShadowSystem';
import type { SceneSystemContext } from './types';
import { toVisualPosition, toWorldPosition } from '../utils/Parallax';

export interface ThreeDParallaxComponent {
    type: '3d-parallax';
}

export class ThreeDParallaxSystem {

    static update(quad: QuadObject, _comp: ThreeDParallaxComponent) {
        const scene = quad.scene as SceneSystemContext | null;
        if (!scene || !scene.entities) return;

        // Iterate over all Actors in the scene
        const actors = scene.entities.filter((e) => e.type === 'Actor' || e.type === 'Player') as Actor[];

        const camX = scene.camera.x;
        const camY = scene.camera.y;

        for (const actor of actors) {
            // Constraint: Only update if moving? No, update always to handle Editor dragging / Teleport / Idle on moving platform
            // if (actor.state !== 'walk') continue;

            // Check if Actor is ON this Quad
            // Use Visual Position for hitTest
            const pFactor = actor.parallax !== undefined ? actor.parallax : 1.0;
            const actorVisual = toVisualPosition({ x: actor.x, y: actor.y }, { x: camX, y: camY }, pFactor);
            const checkX = actorVisual.x;
            const checkY = actorVisual.y;

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
                const newWorld = toWorldPosition({ x: checkX, y: checkY }, { x: camX, y: camY }, newP);
                actor.x = newWorld.x;
                actor.y = newWorld.y;
            }

            // --- Shadow Logic ---
            // Check if actor has a Shadow component
            // We need to update the Shadow Vertices to also respect the Parallax Layer they are on.
            if (actor.components) {
                const shadowComp = actor.components.find(c => c.type === 'Shadow') as ShadowComponent | undefined;
                if (shadowComp && shadowComp.shadowQuadId) {
                    const shadowQuad = scene.findEntity(shadowComp.shadowQuadId) as QuadObject | undefined;

                    if (shadowQuad && shadowQuad.type === 'Quad') {
                        // Iterate Vertices of the Shadow
                        for (const sv of shadowQuad.vertices) {
                            // Calculate Visual Pos of Shadow Vertex
                            const svP = sv.p !== undefined ? sv.p : 1.0;
                            const shadowVisual = toVisualPosition({ x: sv.x, y: sv.y }, { x: camX, y: camY }, svP);
                            const svVisX = shadowVisual.x;
                            const svVisY = shadowVisual.y;

                            // Hit Test against the Parallax Floor (quad) using Visual Coordinates
                            if (quad.hitTest(svVisX, svVisY)) {
                                // Interpolate Parallax for this vertex
                                const newP = quad.getParallaxAt(svVisX, svVisY, true);

                                // Only update if changed (epsilon check?)
                                if (Math.abs(newP - svP) > 0.0001) {

                                    // Apply Correction
                                    sv.p = newP;
                                    // Fix World Position to keep Visual Position constant
                                    const newWorld = toWorldPosition({ x: svVisX, y: svVisY }, { x: camX, y: camY }, newP);
                                    sv.x = newWorld.x;
                                    sv.y = newWorld.y;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
