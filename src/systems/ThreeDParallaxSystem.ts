import { Actor } from '../entities/Actor';
import { Entity } from '../entities/Entity';
import { QuadObject } from '../entities/QuadObject';
import type { ShadowComponent } from './ShadowSystem';
import type { SceneSystemContext } from './types';
import { toVisualPosition, toWorldPosition } from '../utils/Parallax';

export interface ThreeDParallaxComponent {
  type: '3d-parallax';
}

interface SurfaceParallaxBinding {
  quadName: string;
  u: number;
  v: number;
  worldX: number;
  worldY: number;
  originalParallax: number;
}

const SURFACE_PARALLAX_BINDING = '__surfaceParallaxBinding';

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

      const existingBinding = (target as any)[SURFACE_PARALLAX_BINDING] as
        | SurfaceParallaxBinding
        | undefined;
      const pFactor = target.parallax !== undefined ? target.parallax : 1.0;

      const allQuads = scene.entities.filter(
        (e): e is QuadObject =>
          e.type === 'Quad' && !!e.components?.some((c) => c.type === '3d-parallax')
      );

      let topQuad: QuadObject | null = null;
      for (let i = allQuads.length - 1; i >= 0; i--) {
        const q = allQuads[i];
        let qVisual = toVisualPosition({ x: target.x, y: target.y }, { x: camX, y: camY }, pFactor);
        if (existingBinding?.quadName === q.name) {
          const surfacePoint = q.getGridPointAt(existingBinding.u, existingBinding.v, true);
          qVisual = {
            x: surfacePoint.x + (target.x - existingBinding.worldX),
            y: surfacePoint.y + (target.y - existingBinding.worldY),
          };
        }
        if (q.getSurfaceMetricsAt(qVisual.x, qVisual.y, true)) {
          topQuad = q;
          break;
        }
      }

      if (topQuad && topQuad.name !== quad.name) continue;

      let targetVisual = toVisualPosition(
        { x: target.x, y: target.y },
        { x: camX, y: camY },
        pFactor
      );

      // A P value alone cannot follow a perspective-corrected surface: grid
      // lines use its corrected local (u,v) coordinate. Recreate the prior
      // surface point first, then apply only world movement made since the
      // last reconciliation as the actor's intended displacement.
      if (existingBinding?.quadName === quad.name) {
        const surfacePoint = quad.getGridPointAt(existingBinding.u, existingBinding.v, true);
        targetVisual = {
          x: surfacePoint.x + (target.x - existingBinding.worldX),
          y: surfacePoint.y + (target.y - existingBinding.worldY),
        };
      }

      const metrics = quad.getSurfaceMetricsAt(targetVisual.x, targetVisual.y, true);
      if (metrics) {
        const newP = metrics.parallax;

        // Actor routes are authored in world coordinates. When P changes,
        // preserve their visual destinations too; otherwise the actor itself
        // stays on the surface while its stale raw target appears to jump
        // towards an edge.
        if (
          (target.type === 'Actor' || target.type === 'Player') &&
          Math.abs(newP - pFactor) > 0.000001
        ) {
          const actor = target as Actor;
          const preserveVisualPoint = (point: { x: number; y: number }) =>
            toWorldPosition(
              toVisualPosition(point, { x: camX, y: camY }, pFactor),
              { x: camX, y: camY },
              newP
            );
          if (actor.target) actor.target = preserveVisualPoint(actor.target);
          actor.route = actor.route.map(preserveVisualPoint);
          if ((actor as any).plannedMoveTarget) {
            (actor as any).plannedMoveTarget = preserveVisualPoint(
              (actor as any).plannedMoveTarget
            );
          }
        }

        // Apply new Parallax
        // Only if different?
        target.parallax = newP;

        // Update Actor World Position to maintain Visual Position
        // Wy = Vy + Cy * (P - 1)
        // Wx = Vx + Cx * (P - 1)
        const newWorld = toWorldPosition(targetVisual, { x: camX, y: camY }, newP);
        target.x = newWorld.x;
        target.y = newWorld.y;
        (target as any)[SURFACE_PARALLAX_BINDING] = {
          quadName: quad.name,
          u: metrics.u,
          v: metrics.v,
          worldX: newWorld.x,
          worldY: newWorld.y,
          originalParallax: existingBinding ? existingBinding.originalParallax : pFactor,
        } satisfies SurfaceParallaxBinding;
      } else if (existingBinding?.quadName === quad.name) {
        const restoredP = existingBinding.originalParallax ?? 1.0;
        target.parallax = restoredP;
        const restoredWorld = toWorldPosition(targetVisual, { x: camX, y: camY }, restoredP);
        target.x = restoredWorld.x;
        target.y = restoredWorld.y;
        delete (target as any)[SURFACE_PARALLAX_BINDING];
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
