import { Actor } from '../entities/Actor';
import { QuadObject } from '../entities/QuadObject';
import type { SceneSystemContext } from './types';
import { toVisualPosition, toWorldPosition } from '../utils/Parallax';

export interface ShadowComponent {
  type: 'Shadow';
  id?: string;
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
    const scene = actor.scene as SceneSystemContext | null;
    if (!scene) return;

    if (!shadow.shadowQuadId || !shadow.triggerId) return;

    // 1. Resolve Targets (Triggers)
    const targets = scene.resolveTarget(shadow.triggerId);

    // 2. Check if Actor Center is inside any target (Visual/Parallax Corrected)
    const camX = scene.camera.x;
    const camY = scene.camera.y;

    // Actor Base World Pos
    const ax = actor.x;
    const ay = actor.y; // Feet

    // Actor Visual Pos (Shifted by its Parallax)
    const pFactor = actor.parallax !== undefined ? actor.parallax : 1.0;
    const actorVisual = toVisualPosition({ x: ax, y: ay }, { x: camX, y: camY }, pFactor);
    const checkX = actorVisual.x;
    const checkY = actorVisual.y;

    let inside = false;

    for (const t of targets) {
      if (typeof t.containsPoint === 'function') {
        const hit = t.containsPoint(checkX, checkY);
        if (hit) {
          inside = true;
          break;
        }
      }
    }

    // 3. Find Shadow Quad
    let qObj: QuadObject | undefined;

    qObj = scene.findEntity(shadow.shadowQuadId) as QuadObject | undefined;

    if (!qObj) {
      qObj = scene.entities.find(
        (e) => e.name.toLowerCase() === shadow.shadowQuadId.toLowerCase()
      ) as QuadObject | undefined;
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
        if (scene.game && scene.game.editor && scene.game.editor.enabled) {
          const editor = scene.game.editor;
          if (
            (editor.selectedObject === qObj || (qObj as any).selected) &&
            editor.transformManager &&
            editor.transformManager.isDragging
          ) {
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
        let cache = this.shadowCache.get(qObj.name) as
          | {
              lastScale: number;
              baseOffsets: { x: number; y: number }[];
            }
          | undefined;

        // Check Editing State/Cache Validity
        const isSelected =
          (qObj as any).selected ||
          (scene.game && scene.game.editor && scene.game.editor.selectedObject === qObj);

        // If no cache, or selected (potentially edited), regenerate cache
        if (!cache || isSelected) {
          // Capture Base Shape (Visual Offsets from V0)
          const v0 = qObj.vertices[0];
          const v0p = v0.p !== undefined ? v0.p : 1.0;
          const v0Visual = toVisualPosition({ x: v0.x, y: v0.y }, { x: camX, y: camY }, v0p);

          const offsets = [];
          for (let i = 1; i < qObj.vertices.length; i++) {
            const v = qObj.vertices[i];
            const vp = v.p !== undefined ? v.p : 1.0;
            const visual = toVisualPosition({ x: v.x, y: v.y }, { x: camX, y: camY }, vp);

            // Store Normalized Offset (descale by current scale)
            // So BaseOffset represents "Scale 1.0" shape
            const factor = currentScale !== 0 ? 1.0 / currentScale : 1.0;
            offsets.push({
              x: (visual.x - v0Visual.x) * factor,
              y: (visual.y - v0Visual.y) * factor,
            });
          }

          cache = {
            lastScale: currentScale,
            baseOffsets: offsets,
          };
          this.shadowCache.set(qObj.name, cache);
        } else {
          // Update lastScale for tracking (if we needed delta, but we use absolute now)
          cache.lastScale = currentScale;
        }

        // 2. Calculate BASE V0 Visual Position (Target)
        const actorVisualPos = toVisualPosition(
          { x: actor.x, y: actor.y },
          { x: camX, y: camY },
          pFactor
        );

        const scaledOffsetX = (shadow.offsetX || 0) * currentScale;
        const scaledOffsetY = (shadow.offsetY || 0) * currentScale;

        const targetVisX = actorVisualPos.x + scaledOffsetX;
        const targetVisY = actorVisualPos.y + scaledOffsetY;

        // 3. Position V0 (World)
        // Use current V0 P
        const v0p = qObj.vertices[0].p !== undefined ? qObj.vertices[0].p : 1.0;
        const targetWorldV0 = toWorldPosition(
          { x: targetVisX, y: targetVisY },
          { x: camX, y: camY },
          v0p
        );
        qObj.vertices[0].x = targetWorldV0.x;
        qObj.vertices[0].y = targetWorldV0.y;

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

          const worldPos = toWorldPosition({ x: newVisX, y: newVisY }, { x: camX, y: camY }, vp);
          v.x = worldPos.x;
          v.y = worldPos.y;
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
