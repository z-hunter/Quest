import { Actor } from '../entities/Actor';
import { Entity } from '../entities/Entity';
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

    // Actors and Static objects are both positioned by their ground point.
    // Keep that point fixed in visual space while adapting its parallax to the Quad.
    const parallaxTargets = scene.entities.filter(
      (e): e is Entity => e.type === 'Actor' || e.type === 'Player' || e.type === 'Static'
    );

    const camX = scene.camera.x;
    const camY = scene.camera.y;

    for (const target of parallaxTargets) {
      // Constraint: Only update if moving? No, update always to handle Editor dragging / Teleport / Idle on moving platform
      // if (actor.state !== 'walk') continue;

      // Check if Actor is ON this Quad
      // Use Visual Position for hitTest
      const pFactor = target.parallax !== undefined ? target.parallax : 1.0;
      const targetVisual = toVisualPosition(
        { x: target.x, y: target.y },
        { x: camX, y: camY },
        pFactor
      );
      const checkX = targetVisual.x;
      const checkY = targetVisual.y;

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
        target.parallax = newP;

        // Update Actor World Position to maintain Visual Position
        // Wy = Vy + Cy * (P - 1)
        // Wx = Vx + Cx * (P - 1)
        const newWorld = toWorldPosition({ x: checkX, y: checkY }, { x: camX, y: camY }, newP);
        target.x = newWorld.x;
        target.y = newWorld.y;
      }

      // --- Shadow Logic ---
      // Shadows are an Actor-only component; Static objects intentionally stop here.
      if (target.type !== 'Actor' && target.type !== 'Player') continue;
      const actor = target as Actor;
      // Check if actor has a Shadow component
      // We need to update the Shadow Vertices to also respect the Parallax Layer they are on.
      if (actor.components) {
        const shadowComp = actor.components.find((c) => c.type === 'Shadow') as
          | ShadowComponent
          | undefined;
        if (shadowComp && shadowComp.shadowQuadId) {
          const shadowQuad = scene.findEntity(shadowComp.shadowQuadId) as QuadObject | undefined;

          if (shadowQuad && shadowQuad.type === 'Quad') {
            const sqGlobalP = shadowQuad.parallax !== undefined ? shadowQuad.parallax : 1.0;
            // Iterate Vertices of the Shadow
            for (const sv of shadowQuad.vertices) {
              // Calculate Visual Pos of Shadow Vertex
              const svEffP = (sv.p !== undefined ? sv.p : 1.0) * sqGlobalP;
              const shadowVisual = toVisualPosition(
                { x: sv.x, y: sv.y },
                { x: camX, y: camY },
                svEffP
              );
              const svVisX = shadowVisual.x;
              const svVisY = shadowVisual.y;

              // Hit Test against the Parallax Floor (quad) using Visual Coordinates
              if (quad.hitTest(svVisX, svVisY)) {
                // Interpolate Parallax for this vertex
                const newP = quad.getParallaxAt(svVisX, svVisY, true);

                // Only update if changed (epsilon check?)
                if (Math.abs(newP - svEffP) > 0.0001) {
                  // Apply Correction
                  sv.p = sqGlobalP !== 0 ? newP / sqGlobalP : newP;
                  // Fix World Position to keep Visual Position constant
                  const newWorld = toWorldPosition(
                    { x: svVisX, y: svVisY },
                    { x: camX, y: camY },
                    newP
                  );
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
