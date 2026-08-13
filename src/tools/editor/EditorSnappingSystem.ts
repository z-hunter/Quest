import { Entity } from '../../entities/Entity';
import { QuadObject, type QuadVertexBinding } from '../../entities/QuadObject';

export class EditorSnappingSystem {
  /**
   * Snap a Vertex being dragged (Polygon or Quad).
   * Handles:
   * 1. Shift Key: Angle Snapping relative to adjacent vertices.
   * 2. Alt Key: Snapping to other Quad Vertices or Grid Nodes.
   */
  static snapVertex(
    mouseWorldPos: { x: number; y: number },
    poly: any[],
    draggingIndex: number,
    scene: any,
    camX: number,
    camY: number,
    isQuad: boolean,
    selectedObject: Entity,
    shiftKey: boolean,
    altKey: boolean,
    zoom: number = 1.0,
    excludedVertexRefs?: ReadonlySet<string>
  ): { x: number; y: number; binding: QuadVertexBinding | null; p?: number } {
    const result = {
      x: mouseWorldPos.x,
      y: mouseWorldPos.y,
      binding: null as QuadVertexBinding | null,
      p: undefined as number | undefined,
    };

    // 1. ANGLE SNAPPING (Shift)
    if (shiftKey) {
      // ... (Existing Angle Snapping Logic - unchanged)
      const prevIndex = (draggingIndex - 1 + poly.length) % poly.length;
      const nextIndex = (draggingIndex + 1) % poly.length;

      const prevV = poly[prevIndex];
      const nextV = poly[nextIndex];

      const globalP = (selectedObject as any)?.parallax ?? 1.0;
      // Helper: Resolve effective parallax (Binding Lookup)
      const resolveParallax = (v: any) => {
        if (v.binding && v.binding.targetName) {
          const targetName = v.binding.targetName;
          const ent = scene.entities.find((e: any) => e.name === targetName);

          if (ent) {
            if ((ent as any).type === 'Quad') {
              const q = ent as QuadObject;
              if (v.binding.type === 'vertex' && v.binding.index !== undefined) {
                const targetV = q.vertices[v.binding.index];
                if (targetV) {
                  const qGlobalP = q.parallax !== undefined ? q.parallax : 1.0;
                  return (targetV.p ?? 1.0) * qGlobalP;
                }
              }
            }
            return ent.parallax ?? 1.0;
          }

          if (scene.triggerboxes) {
            const tb = scene.triggerboxes.find((t: any) => t.name === targetName);
            if (tb) return tb.parallax ?? 1.0;
          }
        }
        return (v.p ?? 1.0) * globalP;
      };

      const pPrev = resolveParallax(prevV);
      const pNext = resolveParallax(nextV);

      // Convert to Visual Space relative to selected object's parallax layer
      const toVisual = (raw: { x: number; y: number }, p: number) => ({
        x: raw.x - camX * (p - globalP),
        y: raw.y - camY * (p - globalP),
      });

      const prevVis = toVisual(prevV, pPrev);
      const nextVis = toVisual(nextV, pNext);

      // mousePos is already converted to worldPos (Visual/P=1 assumption in TransformManager)
      const mouseVis = { x: mouseWorldPos.x, y: mouseWorldPos.y };

      // Helper: Get angle
      const getAngle = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        Math.atan2(b.y - a.y, b.x - a.x);

      const rawAnglePrev = getAngle(prevVis, mouseVis);
      const rawAngleNext = getAngle(nextVis, mouseVis);

      // Snap angles to 22.5 deg (PI/8)
      const step = Math.PI / 8;
      const snapAnglePrev = Math.round(rawAnglePrev / step) * step;
      const snapAngleNext = Math.round(rawAngleNext / step) * step;

      // Construct Lines
      const getLine = (p: { x: number; y: number }, theta: number) => {
        const A = -Math.sin(theta);
        const B = Math.cos(theta);
        const C = A * p.x + B * p.y;
        return { A, B, C, p, theta };
      };

      const L1 = getLine(prevVis, snapAnglePrev);
      const L2 = getLine(nextVis, snapAngleNext);

      // Find Intersection
      const det = L1.A * L2.B - L2.A * L1.B;
      let targetVis = { x: mouseVis.x, y: mouseVis.y };

      const EPSILON = 0.0001;
      if (Math.abs(det) > EPSILON) {
        targetVis.x = (L2.B * L1.C - L1.B * L2.C) / det;
        targetVis.y = (L1.A * L2.C - L2.A * L1.C) / det;
      } else {
        // Parallel: Project onto closest
        const distToLine = (x: number, y: number, L: any) => Math.abs(L.A * x + L.B * y - L.C);
        const d1 = distToLine(mouseVis.x, mouseVis.y, L1);
        const d2 = distToLine(mouseVis.x, mouseVis.y, L2);

        const project = (
          start: { x: number; y: number },
          theta: number,
          p: { x: number; y: number }
        ) => {
          const ux = Math.cos(theta);
          const uy = Math.sin(theta);
          const v = { x: p.x - start.x, y: p.y - start.y };
          const t = v.x * ux + v.y * uy;
          return { x: start.x + t * ux, y: start.y + t * uy };
        };

        if (d1 < d2) targetVis = project(L1.p, L1.theta, mouseVis);
        else targetVis = project(L2.p, L2.theta, mouseVis);
      }

      result.x = targetVis.x;
      result.y = targetVis.y;
    }

    // 2. QUAD SNAP TO OTHER QUADS/GRIDS (Alt)
    if (altKey && isQuad) {
      let bestDist = 20 / zoom; // Threshold in World Units, scaled by zoom
      let snapTarget: { x: number; y: number } | null = null;
      let binding: QuadVertexBinding | null = null;
      let snapP: number | undefined = undefined;

      // 2a. Snap to Entity Corners (NEW)
      // Prioritize Quads/Grid usually, but let's check Entities first or equally?
      // "Users expect... possibility to snap to Entity corners"
      scene.entities.forEach((ent: Entity) => {
        if (ent === selectedObject) return;
        if ((ent as any).type === 'Quad') return; // Handled below
        if (ent.disabled || !ent.visible) return;

        const ep = ent.parallax ?? 1.0;
        // @ts-ignore
        const vOx = (ent as any).visualOffset ? (ent as any).visualOffset.x : 0;
        // @ts-ignore
        const vOy = (ent as any).visualOffset ? (ent as any).visualOffset.y : 0;

        const l = ent.x - ent.width / 2;
        const r = ent.x + ent.width / 2;
        const t = ent.y - ent.height;
        const b = ent.y;

        const corners = [
          { x: l, y: t },
          { x: r, y: t },
          { x: l, y: b },
          { x: r, y: b },
        ];

        corners.forEach((cp) => {
          // Convert Entity Corner to Visual Space (P=1) so we can compare with mouse/result
          // Visual = Raw - Cam*(P-1) + vOffset
          // Wait, result.x/y is currently in "World Visual Space" (P=1).
          // Correct formula:
          // VisualX = (Ex - CamX*(ep-1)) + vOx... wait.
          // Standard Render: draw at (x,y) translated by -camX*ep.
          // ScreenX = (x - camX*ep + vOx) * zoom + HW
          // Visual World X = x - camX*ep + vOx + camX
          // = x - camX*(ep - 1) + vOx. Correct.

          const vx = cp.x + vOx - camX * (ep - 1.0);
          const vy = cp.y + vOy - camY * (ep - 1.0);

          const dx = Math.abs(vx - result.x);
          const dy = Math.abs(vy - result.y);

          if (dx < bestDist && dy < bestDist) {
            snapTarget = { x: vx, y: vy };
            bestDist = Math.max(dx, dy);
            binding = null; // No binding for Entities
            snapP = ep; // Adopt Parallax
          }
        });
      });

      // 2b. Snap to Quads/Grids
      scene.entities.forEach((ent: Entity) => {
        if (ent === selectedObject) return;
        if ((ent as any).type === 'Quad') {
          const q = ent as QuadObject;
          if (q.disabled || !q.visible) return;

          const qGlobalP = q.parallax !== undefined ? q.parallax : 1.0;
          // Vertices
          q.vertices.forEach((qv, qIndex) => {
            if (excludedVertexRefs?.has(`${q.name}:${qIndex}`)) return;
            const effP = (qv.p !== undefined ? qv.p : 1.0) * qGlobalP;
            const vx = Math.round(qv.x - camX * (effP - qGlobalP));
            const vy = Math.round(qv.y - camY * (effP - qGlobalP));

            const dx = Math.abs(vx - result.x);
            const dy = Math.abs(vy - result.y);
            if (dx < bestDist && dy < bestDist) {
              snapTarget = { x: vx, y: vy };
              bestDist = Math.max(dx, dy);
              binding = {
                targetName: q.name,
                type: 'vertex',
                index: q.vertices.indexOf(qv),
              };
              snapP = effP;
            }
          });

          // Grid
          if (q.isGrid) {
            const selectedGlobalP = (selectedObject as any).parallax ?? 1.0;
            const gridPoint = (u: number, v: number) => {
              const point = q.getGridPointAt(u, v, true);
              return {
                x: point.x + camX * (selectedGlobalP - qGlobalP),
                y: point.y + camY * (selectedGlobalP - qGlobalP),
                p: q.getParallaxAtGrid(u, v),
              };
            };

            // Horizontal Cuts (Down the shape using GridLinesY)
            for (let i = 1; i <= q.gridLinesY; i++) {
              const rawV = i / (q.gridLinesY + 1);
              const v = rawV;

              // Left Edge (V0-V3)
              const left = gridPoint(0, v);
              const lx = left.x;
              const ly = left.y;

              let d = Math.abs(lx - result.x);
              let d2 = Math.abs(ly - result.y);
              if (d < bestDist && d2 < bestDist) {
                snapTarget = { x: lx, y: ly };
                // Grid snapping is positional only. The vertex must be free to
                // leave this node when the Quad or the vertex is edited later.
                binding = null;
                snapP = left.p;
              }

              // Right Edge (V1-V2)
              const right = gridPoint(1, v);
              const rx = right.x;
              const ry = right.y;

              d = Math.abs(rx - result.x);
              d2 = Math.abs(ry - result.y);
              if (d < bestDist && d2 < bestDist) {
                snapTarget = { x: rx, y: ry };
                binding = null;
                snapP = right.p;
              }
            }

            // Vertical Cuts (Across the shape using GridLinesX)
            for (let i = 1; i <= q.gridLinesX; i++) {
              const rawU = i / (q.gridLinesX + 1);
              const u = rawU;

              // Top Edge (V0-V1)
              const top = gridPoint(u, 0);
              const tx = top.x;
              const ty = top.y;

              let d = Math.abs(tx - result.x);
              let d2 = Math.abs(ty - result.y);
              if (d < bestDist && d2 < bestDist) {
                snapTarget = { x: tx, y: ty };
                binding = null;
                snapP = top.p;
              }

              // Bottom Edge (V3-V2)
              const bottom = gridPoint(u, 1);
              const bx = bottom.x;
              const by = bottom.y;

              d = Math.abs(bx - result.x);
              d2 = Math.abs(by - result.y);
              if (d < bestDist && d2 < bestDist) {
                snapTarget = { x: bx, y: by };
                binding = null;
                snapP = bottom.p;
              }

              // Internal Nodes
              for (let j = 1; j <= q.gridLinesY; j++) {
                const rawV = j / (q.gridLinesY + 1);
                const v = rawV;
                const node = gridPoint(u, v);
                const nx = node.x;
                const ny = node.y;

                const dx = Math.abs(nx - result.x);
                const dy = Math.abs(ny - result.y);
                if (dx < bestDist && dy < bestDist) {
                  snapTarget = { x: nx, y: ny };
                  binding = null;
                  snapP = node.p;
                }
              }
            }
          }
        }
      });

      if (snapTarget) {
        result.x = (snapTarget as any).x;
        result.y = (snapTarget as any).y;
        result.binding = binding;
        result.p = snapP;
      }
    }

    return result;
  }

  /**
   * Snap Entity during Resizing (Alt Key).
   */
  static snapEntity(
    mouseVisualPos: { x: number; y: number },
    currentEntity: Entity,
    scene: any,
    camX: number,
    camY: number,
    zoom: number
  ): { x: number; y: number } | null {
    let bestDist = 10 / zoom;
    let snapTargetVisual: { x: number; y: number } | null = null;

    // Check Corners of other Entities
    scene.entities.forEach((other: Entity) => {
      if (other === currentEntity) return;
      if (other.disabled || !other.visible) return;

      const op = other.parallax !== undefined ? other.parallax : 1.0;
      // @ts-ignore
      const ovOx = other.visualOffset ? other.visualOffset.x : 0;
      // @ts-ignore
      const ovOy = other.visualOffset ? other.visualOffset.y : 0;

      const l = other.x - other.width / 2;
      const r = other.x + other.width / 2;
      const t = other.y - other.height;
      const b = other.y;

      const rawPoints = [
        { x: l, y: t },
        { x: r, y: t },
        { x: l, y: b },
        { x: r, y: b },
      ];

      rawPoints.forEach((pt) => {
        const vx = pt.x + ovOx - camX * (op - 1.0);
        const vy = pt.y + ovOy - camY * (op - 1.0);

        const dx = Math.abs(vx - mouseVisualPos.x);
        const dy = Math.abs(vy - mouseVisualPos.y);
        if (dx < bestDist && dy < bestDist) {
          bestDist = Math.max(dx, dy);
          snapTargetVisual = { x: vx, y: vy };
        }
      });
    });

    // Check Quads
    const quads = scene.entities.filter((e: any) => e.type === 'Quad') as QuadObject[];
    quads.forEach((q) => {
      if (q.disabled || !q.visible) return;
      const qGlobalP = q.parallax !== undefined ? q.parallax : 1.0;

      q.vertices.forEach((v) => {
        const effP = (v.p !== undefined ? v.p : 1.0) * qGlobalP;
        const vx = v.x - camX * (effP - qGlobalP);
        const vy = v.y - camY * (effP - qGlobalP);
        const dx = Math.abs(vx - mouseVisualPos.x);
        const dy = Math.abs(vy - mouseVisualPos.y);
        if (dx < bestDist && dy < bestDist) {
          bestDist = Math.max(dx, dy);
          snapTargetVisual = { x: vx, y: vy };
        }
      });

      // Grid logic could be added here too similar to snapVertex
    });

    return snapTargetVisual;
  }
}
