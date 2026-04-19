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
    zoom: number = 1.0
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
                if (targetV) return targetV.p;
              }
            }
            return ent.parallax ?? 1.0;
          }

          if (scene.triggerboxes) {
            const tb = scene.triggerboxes.find((t: any) => t.name === targetName);
            if (tb) return tb.parallax ?? 1.0;
          }
        }
        return v.p ?? 1.0;
      };

      const pPrev = resolveParallax(prevV);
      const pNext = resolveParallax(nextV);

      // Convert to Visual Space (P=1)
      const toVisual = (raw: { x: number; y: number }, p: number) => ({
        x: raw.x - camX * (p - 1.0),
        y: raw.y - camY * (p - 1.0),
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

          // Vertices
          q.vertices.forEach((qv) => {
            const vx = Math.round(qv.x - camX * (qv.p - 1.0));
            const vy = Math.round(qv.y - camY * (qv.p - 1.0));

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
              snapP = qv.p;
            }
          });

          // Grid
          if (q.isGrid) {
            const visualVerts = q.vertices.map((v) => ({
              x: Math.round(v.x - camX * (v.p - 1.0)),
              y: Math.round(v.y - camY * (v.p - 1.0)),
              p: v.p,
            }));

            const v0 = visualVerts[0];
            const v1 = visualVerts[1];
            const v2 = visualVerts[2]; // BR
            const v3 = visualVerts[3]; // BL

            // Horizontal Cuts (Down the shape using GridLinesY)
            for (let i = 1; i <= q.gridLinesY; i++) {
              const v = i / (q.gridLinesY + 1);

              // Left Edge (V0-V3)
              const lx = v0.x + (v3.x - v0.x) * v;
              const ly = v0.y + (v3.y - v0.y) * v;
              const lp = v0.p + (v3.p - v0.p) * v;

              let d = Math.abs(lx - result.x);
              let d2 = Math.abs(ly - result.y);
              if (d < bestDist && d2 < bestDist) {
                snapTarget = { x: lx, y: ly };
                binding = { targetName: q.name, type: 'grid', gridU: 0, gridV: v };
                snapP = lp;
              }

              // Right Edge (V1-V2)
              const rx = v1.x + (v2.x - v1.x) * v;
              const ry = v1.y + (v2.y - v1.y) * v;
              const rp = v1.p + (v2.p - v1.p) * v;

              d = Math.abs(rx - result.x);
              d2 = Math.abs(ry - result.y);
              if (d < bestDist && d2 < bestDist) {
                snapTarget = { x: rx, y: ry };
                binding = { targetName: q.name, type: 'grid', gridU: 1, gridV: v };
                snapP = rp;
              }
            }

            // Vertical Cuts (Across the shape using GridLinesX)
            for (let i = 1; i <= q.gridLinesX; i++) {
              const u = i / (q.gridLinesX + 1);

              // Top Edge (V0-V1)
              const tx = v0.x + (v1.x - v0.x) * u;
              const ty = v0.y + (v1.y - v0.y) * u;
              const tp = v0.p + (v1.p - v0.p) * u;

              let d = Math.abs(tx - result.x);
              let d2 = Math.abs(ty - result.y);
              if (d < bestDist && d2 < bestDist) {
                snapTarget = { x: tx, y: ty };
                binding = { targetName: q.name, type: 'grid', gridU: u, gridV: 0 };
                snapP = tp;
              }

              // Bottom Edge (V3-V2)
              const bx = v3.x + (v2.x - v3.x) * u;
              const by = v3.y + (v2.y - v3.y) * u;
              const bp = v3.p + (v2.p - v3.p) * u;

              d = Math.abs(bx - result.x);
              d2 = Math.abs(by - result.y);
              if (d < bestDist && d2 < bestDist) {
                snapTarget = { x: bx, y: by };
                binding = { targetName: q.name, type: 'grid', gridU: u, gridV: 1 };
                snapP = bp;
              }

              // Internal Nodes
              for (let j = 1; j <= q.gridLinesY; j++) {
                const v = j / (q.gridLinesY + 1);
                const nx =
                  (1 - u) * (1 - v) * v0.x + u * (1 - v) * v1.x + (1 - u) * v * v3.x + u * v * v2.x;
                const ny =
                  (1 - u) * (1 - v) * v0.y + u * (1 - v) * v1.y + (1 - u) * v * v3.y + u * v * v2.y;
                const np =
                  (1 - u) * (1 - v) * v0.p + u * (1 - v) * v1.p + (1 - u) * v * v3.p + u * v * v2.p;

                const dx = Math.abs(nx - result.x);
                const dy = Math.abs(ny - result.y);
                if (dx < bestDist && dy < bestDist) {
                  snapTarget = { x: nx, y: ny };
                  binding = { targetName: q.name, type: 'grid', gridU: u, gridV: v };
                  snapP = np;
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

      q.vertices.forEach((v) => {
        const vx = v.x - camX * (v.p - 1.0);
        const vy = v.y - camY * (v.p - 1.0);
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
