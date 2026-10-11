import { Actor } from '../entities/Actor';
import { Entity } from '../entities/Entity';
import { QuadObject } from '../entities/QuadObject';
import {
  createBox3DSurfaceAnchor,
  isManagedBox3DFace,
  isSpatialDescendantOf,
} from '../entities/Box3DObject';
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
const SURFACE_PARALLAX_VERTEX_BINDINGS = '__surfaceParallaxVertexBindings';
const EPSILON = 0.000001;

export class ThreeDParallaxSystem {
  static clearTargetBinding(target: Entity): void {
    delete (target as any)[SURFACE_PARALLAX_BINDING];
    delete (target as any).__box3dSurfaceAnchor;
    delete (target as any).box3dDepth;
  }

  static update(quad: QuadObject, _comp: ThreeDParallaxComponent) {
    const scene = quad.scene as SceneSystemContext | null;
    if (!scene || !scene.entities) return;

    const camX = scene.camera.x;
    const camY = scene.camera.y;
    const targets = scene.entities.filter(
      (entity): entity is Entity =>
        entity.type === 'Actor' ||
        entity.type === 'Player' ||
        entity.type === 'Static' ||
        // Legacy scene files serialize Static objects as `Entity`.
        entity.type === 'Entity'
    );

    for (const target of targets) {
      const binding = (target as any)[SURFACE_PARALLAX_BINDING] as
        | SurfaceParallaxBinding
        | undefined;
      this.updateActorShadow(target, quad, scene, camX, camY);
      const owner =
        scene.getNearestSpatialQuadWithComponent(target, '3d-parallax') ||
        (isManagedBox3DFace(quad) && isSpatialDescendantOf(scene, target, quad.name) ? quad : null);

      if (owner?.name !== quad.name) {
        if (binding?.quadName === quad.name) {
          this.reconcileTarget(target, quad, camX, camY, null, binding);
        }
        continue;
      }

      this.reconcileTarget(target, quad, camX, camY, quad, binding);
    }

    this.updateQuadReceivers(quad, scene, camX, camY);
  }

  private static reconcileTarget(
    target: Entity,
    quad: QuadObject,
    camX: number,
    camY: number,
    owner: QuadObject | null,
    binding: SurfaceParallaxBinding | undefined
  ): void {
    const currentP = target.parallax !== undefined ? target.parallax : 1;
    const ownsBinding = binding?.quadName === quad.name;
    let targetVisual = toVisualPosition(
      { x: target.x, y: target.y },
      { x: camX, y: camY },
      currentP
    );
    let movedSinceBinding = false;

    if (ownsBinding) {
      const surfacePoint = quad.getGridPointAt(binding.u, binding.v, true);
      movedSinceBinding =
        Math.abs(target.x - binding.worldX) > EPSILON ||
        Math.abs(target.y - binding.worldY) > EPSILON;
      targetVisual = {
        x: surfacePoint.x + (target.x - binding.worldX),
        y: surfacePoint.y + (target.y - binding.worldY),
      };
    }

    const metrics =
      owner &&
      (ownsBinding && !movedSinceBinding
        ? { u: binding.u, v: binding.v, parallax: quad.getParallaxAtGrid(binding.u, binding.v) }
        : ownsBinding && quad.isVisualSurfaceUnstable()
          ? { u: binding.u, v: binding.v, parallax: quad.getParallaxAtGrid(binding.u, binding.v) }
          : quad.getSurfaceMetricsAt(targetVisual.x, targetVisual.y, true));

    if (metrics) {
      const side = target.spatial?.surfaceSide === 'back' ? 'back' : 'front';
      const anchor = isManagedBox3DFace(quad)
        ? createBox3DSurfaceAnchor(quad.scene, quad, target, metrics.u, metrics.v, side)
        : null;
      if (anchor) targetVisual = anchor.projected;
      const newP = anchor?.parallax ?? metrics.parallax;
      this.preserveActorRouteVisualPosition(target, currentP, newP, camX, camY);
      const newWorld = toWorldPosition(targetVisual, { x: camX, y: camY }, newP);
      target.parallax = newP;
      target.x = newWorld.x;
      target.y = newWorld.y;
      if (anchor) {
        (target as any).__box3dSurfaceAnchor = anchor;
        (target as any).box3dDepth = anchor.point.z;
      } else {
        delete (target as any).__box3dSurfaceAnchor;
        delete (target as any).box3dDepth;
      }
      (target as any)[SURFACE_PARALLAX_BINDING] = {
        quadName: quad.name,
        u: metrics.u,
        v: metrics.v,
        worldX: newWorld.x,
        worldY: newWorld.y,
        originalParallax: ownsBinding ? binding.originalParallax : currentP,
      } satisfies SurfaceParallaxBinding;
      return;
    }

    if (!ownsBinding) return;
    const restoredP = binding.originalParallax ?? 1;
    this.preserveActorRouteVisualPosition(target, currentP, restoredP, camX, camY);
    const restoredWorld = toWorldPosition(targetVisual, { x: camX, y: camY }, restoredP);
    target.parallax = restoredP;
    target.x = restoredWorld.x;
    target.y = restoredWorld.y;
    delete (target as any)[SURFACE_PARALLAX_BINDING];
    delete (target as any).__box3dSurfaceAnchor;
    delete (target as any).box3dDepth;
  }

  private static preserveActorRouteVisualPosition(
    target: Entity,
    previousP: number,
    nextP: number,
    camX: number,
    camY: number
  ): void {
    if (
      (target.type !== 'Actor' && target.type !== 'Player') ||
      Math.abs(nextP - previousP) <= EPSILON
    ) {
      return;
    }

    const actor = target as Actor;
    const preserveVisualPoint = (point: { x: number; y: number }) =>
      toWorldPosition(
        toVisualPosition(point, { x: camX, y: camY }, previousP),
        { x: camX, y: camY },
        nextP
      );
    if (actor.target) actor.target = preserveVisualPoint(actor.target);
    actor.route = actor.route.map(preserveVisualPoint);
    if ((actor as any).plannedMoveTarget) {
      (actor as any).plannedMoveTarget = preserveVisualPoint((actor as any).plannedMoveTarget);
    }
  }

  private static updateActorShadow(
    target: Entity,
    quad: QuadObject,
    scene: SceneSystemContext,
    camX: number,
    camY: number
  ): void {
    if (target.type !== 'Actor' && target.type !== 'Player') return;
    const actor = target as Actor;
    const shadow = actor.components?.find((component) => component.type === 'Shadow') as
      | ShadowComponent
      | undefined;
    if (!shadow?.shadowQuadId) return;

    const shadowQuad = scene.findEntity(shadow.shadowQuadId) as QuadObject | undefined;
    if (!shadowQuad || shadowQuad.type !== 'Quad') return;

    const globalP = shadowQuad.parallax !== undefined ? shadowQuad.parallax : 1;
    for (const vertex of shadowQuad.vertices) {
      const effectiveP = (vertex.p !== undefined ? vertex.p : 1) * globalP;
      const visual = toVisualPosition(
        { x: vertex.x, y: vertex.y },
        { x: camX, y: camY },
        effectiveP
      );
      if (!quad.hitTest(visual.x, visual.y)) continue;
      const nextP = quad.getParallaxAt(visual.x, visual.y, true);
      if (Math.abs(nextP - effectiveP) <= 0.0001) continue;
      vertex.p = globalP !== 0 ? nextP / globalP : nextP;
      const world = toWorldPosition(visual, { x: camX, y: camY }, nextP);
      vertex.x = world.x;
      vertex.y = world.y;
    }
  }

  private static updateQuadReceivers(
    parentQuad: QuadObject,
    scene: SceneSystemContext,
    camX: number,
    camY: number
  ): void {
    const children = scene
      .getDirectSpatialChildren(parentQuad.name)
      .filter(
        (object): object is QuadObject =>
          object.type === 'Quad' &&
          ((object as QuadObject).receive3DParallax ||
            !!(object as any)[SURFACE_PARALLAX_VERTEX_BINDINGS])
      );

    for (const child of children) {
      const bindings = ((child as any)[SURFACE_PARALLAX_VERTEX_BINDINGS] ||= {}) as Record<
        number,
        SurfaceParallaxBinding | undefined
      >;
      const childGlobalP = child.parallax !== undefined ? child.parallax : 1;
      const parentGlobalP = parentQuad.parallax !== undefined ? parentQuad.parallax : 1;
      const toParentVisual = (world: { x: number; y: number }, effectiveP: number) => {
        const visual = toVisualPosition(world, { x: camX, y: camY }, effectiveP);
        return {
          x: visual.x + camX * (parentGlobalP - 1),
          y: visual.y + camY * (parentGlobalP - 1),
        };
      };
      const toChildWorld = (visual: { x: number; y: number }, effectiveP: number) => ({
        x: visual.x + camX * (effectiveP - parentGlobalP),
        y: visual.y + camY * (effectiveP - parentGlobalP),
      });

      child.vertices.forEach((vertex, index) => {
        const binding = bindings[index];
        const ownsBinding = binding?.quadName === parentQuad.name;
        if (!child.receive3DParallax && !ownsBinding) return;

        const currentP = (vertex.p !== undefined ? vertex.p : 1) * childGlobalP;
        let targetVisual = toParentVisual({ x: vertex.x, y: vertex.y }, currentP);
        let movedSinceBinding = false;
        if (ownsBinding) {
          const surfacePoint = parentQuad.getGridPointAt(binding.u, binding.v, true);
          movedSinceBinding =
            Math.abs(vertex.x - binding.worldX) > EPSILON ||
            Math.abs(vertex.y - binding.worldY) > EPSILON;
          targetVisual = {
            x: surfacePoint.x + (vertex.x - binding.worldX),
            y: surfacePoint.y + (vertex.y - binding.worldY),
          };
        }

        const metrics = child.receive3DParallax
          ? ownsBinding && !movedSinceBinding
            ? {
                u: binding.u,
                v: binding.v,
                parallax: parentQuad.getParallaxAtGrid(binding.u, binding.v),
              }
            : ownsBinding && parentQuad.isVisualSurfaceUnstable()
              ? {
                  u: binding.u,
                  v: binding.v,
                  parallax: parentQuad.getParallaxAtGrid(binding.u, binding.v),
                }
              : parentQuad.getSurfaceMetricsAt(targetVisual.x, targetVisual.y, true)
          : null;

        if (metrics) {
          const nextWorld = toChildWorld(targetVisual, metrics.parallax);
          const nextLocalP =
            childGlobalP !== 0 ? metrics.parallax / childGlobalP : metrics.parallax;
          if (
            !ownsBinding ||
            Math.abs(vertex.x - nextWorld.x) > EPSILON ||
            Math.abs(vertex.y - nextWorld.y) > EPSILON ||
            Math.abs((vertex.p ?? 1) - nextLocalP) > EPSILON
          ) {
            vertex.x = nextWorld.x;
            vertex.y = nextWorld.y;
            vertex.p = nextLocalP;
            bindings[index] = {
              quadName: parentQuad.name,
              u: metrics.u,
              v: metrics.v,
              worldX: nextWorld.x,
              worldY: nextWorld.y,
              originalParallax: ownsBinding ? binding.originalParallax : currentP,
            };
          }
        } else if (ownsBinding) {
          const restoredP = binding.originalParallax ?? 1;
          const restoredWorld = toChildWorld(targetVisual, restoredP);
          vertex.p = childGlobalP !== 0 ? restoredP / childGlobalP : restoredP;
          vertex.x = restoredWorld.x;
          vertex.y = restoredWorld.y;
          delete bindings[index];
        }
      });

      if (Object.keys(bindings).length === 0) {
        delete (child as any)[SURFACE_PARALLAX_VERTEX_BINDINGS];
      }
    }
  }
}
