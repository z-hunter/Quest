import { Entity } from './Entity';
import { SceneObject } from './SceneObject';
import type { IGame } from '../core/IGame';
import { ComponentSystem } from '../systems/ComponentSystem';
import { Geometry } from '../utils/Geometry';

export interface QuadVertexBinding {
  targetName: string;
  type: 'vertex' | 'grid';
  index?: number; // 0-3 for vertex
  gridU?: number; // 0-1 for grid
  gridV?: number; // 0-1 for grid
}

export interface QuadVertex {
  x: number;
  y: number;
  p: number; // Parallax Factor (1.0 = standard, <1 = far, >1 = near)
  binding?: QuadVertexBinding;
}

export type QuadSortMode = 'ignore' | 'v0' | 'v1' | 'v2' | 'v3';

export class QuadObject extends Entity {
  vertices: QuadVertex[];
  color: string;

  constructor(game: IGame, name: string) {
    super(game, 0, 0, 100, 100, name);
    this.type = 'Quad';
    this.color = '#888888'; // Default Gray

    // Default 100x100 Square
    this.vertices = [
      { x: 0, y: 0, p: 1.0 },
      { x: 100, y: 0, p: 1.0 },
      { x: 100, y: 100, p: 1.0 },
      { x: 0, y: 100, p: 1.0 },
    ];
    this.sortMode = 'ignore';
  }

  sortMode: QuadSortMode = 'ignore';
  opacity: number = 1.0;
  blendMode: GlobalCompositeOperation = 'source-over';

  // Retro Grid Props
  isGrid: boolean = false;
  gridLinesX: number = 5;
  gridLinesY: number = 5;
  lineWidth: number = 1.0;
  gridColor: string = '#ffffff';

  // Fill Props
  filled: boolean = true;

  // Effects
  blur: number = 0;

  /**
   * List of properties to be serialized to/from JSON.
   * Note: We don't extend Entity.SERIALIZABLE_PROPS because Quad uses vertices instead of width/height/sprite.
   */
  static override SERIALIZABLE_PROPS: string[] = [
    ...SceneObject.SERIALIZABLE_PROPS,
    'x',
    'y',
    'parallax',
    'ignoreScaling',
    'vertices',
    'color',
    'sortMode',
    'opacity',
    'blendMode',
    'isGrid',
    'gridLinesX',
    'gridLinesY',
    'lineWidth',
    'gridColor',
    'filled',
    'blur',
  ];

  // Override render to handle per-vertex parallax
  render(ctx: CanvasRenderingContext2D): void {
    // Need access to Camera Position
    // @ts-ignore
    const scene = this.scene;
    if (!scene) return;

    const camX = scene.camera.x;
    const camY = scene.camera.y;

    ctx.save();
    ctx.globalAlpha = this.opacity;

    // Apply Blur
    if (this.blur > 0) {
      ctx.filter = `blur(${this.blur}px)`;
    }

    // Calculate Screen Positions of Vertices
    // Apply parallax offset relative to P=1.0 base
    // Offset = -Cam * (V.p - 1.0)
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    const screenVerts = this.vertices.map((v) => {
      const offX = -camX * (v.p - 1.0);
      const offY = -camY * (v.p - 1.0);
      const vx = v.x + offX;
      const vy = v.y + offY;

      if (vx < minX) minX = vx;
      if (vx > maxX) maxX = vx;
      if (vy < minY) minY = vy;
      if (vy > maxY) maxY = vy;

      return { x: vx, y: vy };
    });

    // VIEWPORT CULLING
    // Visual World Space Viewport Calculation
    // Context is transformed such that (CamX, CamY) is at Center
    // Viewport is [CamX - HW, CamX + HW]
    if (ctx.canvas) {
      const zoom = scene.camera.zoom;
      const vHW = ctx.canvas.width / 2 / zoom;
      const vHH = ctx.canvas.height / 2 / zoom;

      const viewL = camX - vHW;
      const viewR = camX + vHW;
      const viewT = camY - vHH;
      const viewB = camY + vHH;

      // Padding for Line Width and Blur
      const pad = (this.lineWidth || 1) + (this.blur || 0) * 3;

      if (maxX + pad < viewL || minX - pad > viewR || maxY + pad < viewT || minY - pad > viewB) {
        ctx.restore();
        return; // Culled
      }
    }

    // 1. Draw Fill (Solid Mode)
    if (this.filled) {
      ctx.globalCompositeOperation = this.blendMode;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      screenVerts.forEach((v, i) => {
        if (i === 0) ctx.moveTo(v.x, v.y);
        else ctx.lineTo(v.x, v.y);
      });
      ctx.closePath();
      ctx.fill();
    }

    // 2. Draw Grid (Overlay)
    if (this.isGrid) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = this.gridColor;
      ctx.lineWidth = this.lineWidth;

      // Draw Outline
      ctx.beginPath();
      screenVerts.forEach((v, i) => {
        if (i === 0) ctx.moveTo(v.x, v.y);
        else ctx.lineTo(v.x, v.y);
      });
      ctx.closePath();
      ctx.stroke();

      // Draw Internal Lines
      const v0 = screenVerts[0]; // TL
      const v1 = screenVerts[1]; // TR
      const v2 = screenVerts[2]; // BR
      const v3 = screenVerts[3]; // BL

      ctx.beginPath();

      // Horizontal Cuts (Down the shape using Y count)
      for (let i = 1; i <= this.gridLinesY; i++) {
        const t = i / (this.gridLinesY + 1);

        // Left Point
        const lx = v0.x + (v3.x - v0.x) * t;
        const ly = v0.y + (v3.y - v0.y) * t;

        // Right Point
        const rx = v1.x + (v2.x - v1.x) * t;
        const ry = v1.y + (v2.y - v1.y) * t;

        ctx.moveTo(lx, ly);
        ctx.lineTo(rx, ry);
      }

      // Vertical Cuts (Across the shape using X count)
      for (let i = 1; i <= this.gridLinesX; i++) {
        const t = i / (this.gridLinesX + 1);

        // Top Point
        const tx = v0.x + (v1.x - v0.x) * t;
        const ty = v0.y + (v1.y - v0.y) * t;

        // Bottom Point
        const bx = v3.x + (v2.x - v3.x) * t;
        const by = v3.y + (v2.y - v3.y) * t;

        ctx.moveTo(tx, ty);
        ctx.lineTo(bx, by);
      }

      ctx.stroke();
    }

    ctx.restore(); // Restore context state

    // Draw Collider if active AND Editor is enabled
    // @ts-ignore
    if (this.game && this.game.editor && this.game.editor.enabled && this.selected) {
      // Selection outline? Handled by Editor usually?
      // Editor draws handles. We don't need to draw extra stuff here.
    }
  }

  hitTest(x: number, y: number): boolean {
    // @ts-ignore
    const scene = this.scene;
    if (!scene) return false;

    const camX = scene.camera.x;
    const camY = scene.camera.y;

    const projectedPoly = this.vertices.map((v) => ({
      x: v.x - camX * (v.p - 1.0),
      y: v.y - camY * (v.p - 1.0),
    }));

    return Geometry.isPointInPolygon({ x, y }, projectedPoly);
  }

  /**
   * Get the interpolated Parallax (P) value at a specific point (x,y).
   * @param x Point X
   * @param y Point Y
   * @param isVisual If true, treats (x,y) as visual coordinates and projects Quad vertices to visual space before interpolation.
   */
  getParallaxAt(x: number, y: number, isVisual: boolean = false): number {
    // @ts-ignore
    const scene = this.scene;
    if (!scene || this.vertices.length < 3) return 1.0;

    const camX = scene.camera.x;
    const camY = scene.camera.y;

    // Helper to prepare vertex
    const prep = (v: QuadVertex) => {
      if (!isVisual) return { x: v.x, y: v.y, p: v.p };
      // Project to Visual
      return {
        x: v.x - camX * (v.p - 1.0),
        y: v.y - camY * (v.p - 1.0),
        p: v.p,
      };
    };

    const v0 = prep(this.vertices[0]); // TL
    const v1 = prep(this.vertices[1]); // TR
    const v2 = prep(this.vertices[2]); // BR
    const v3 = prep(this.vertices[3]); // BL (if exists)

    // Helper: Barycentric weights for Triangle (a, b, c) vs Point p
    const barycentric = (a: any, b: any, c: any, px: number, py: number) => {
      const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
      const subW1 = (b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y);
      const subW2 = (c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y);

      const w1 = subW1 / det;
      const w2 = subW2 / det;
      const w3 = 1 - w1 - w2;
      return { w1, w2, w3 };
    };

    // Check Triangle 1: 0-1-3 (TL-TR-BL)
    if (v3) {
      const { w1, w2, w3 } = barycentric(v0, v1, v3, x, y);
      if (w1 >= 0 && w2 >= 0 && w3 >= 0) {
        return v0.p * w1 + v1.p * w2 + v3.p * w3;
      }
    }

    // Check Triangle 2: 1-2-3 (TR-BR-BL)
    if (v3) {
      const { w1, w2, w3 } = barycentric(v1, v2, v3, x, y);
      if (w1 >= 0 && w2 >= 0 && w3 >= 0) {
        return v1.p * w1 + v2.p * w2 + v3.p * w3;
      }
    } else {
      // Just one triangle 0-1-2?
      const { w1, w2, w3 } = barycentric(v0, v1, v2, x, y);
      if (w1 >= 0 && w2 >= 0 && w3 >= 0) {
        return v0.p * w1 + v1.p * w2 + v2.p * w3;
      }
    }

    // Fallback: If outside, return simple average or closest edge?
    // Maybe just return 1.0 or the P of closest vertex?
    // For strictly on-quad logic, calling code checks hitTest first.
    // But hitTest uses generic polygon.
    // Let's return average P for safety.
    let sumP = 0;
    this.vertices.forEach((v) => (sumP += v.p));
    return sumP / this.vertices.length;
  }

  // Serialization
  toJSON(): any {
    const data = super.toJSON();
    data.type = 'Quad';
    return data;
  }

  override load(data: any): void {
    // Backwards compatibility for ignoreYSorting
    if (data.sortMode === undefined && data.ignoreYSorting !== undefined) {
      data.sortMode = data.ignoreYSorting ? 'ignore' : 'v3';
    }

    // Migrate old gridLines
    if (data.gridLines !== undefined) {
      if (data.gridLinesX === undefined) data.gridLinesX = data.gridLines;
      if (data.gridLinesY === undefined) data.gridLinesY = data.gridLines;
    }

    super.load(data);
  }

  static fromJSON(game: IGame, data: any): QuadObject {
    const obj = new QuadObject(game, data.name);
    obj.load(data);
    return obj;
  }

  update(dt: number): void {
    super.update(dt);

    // Resolve Bindings
    // Only if Editor is actively moving things?
    // Or always? Always ensures game logic works if moving platforms exist.
    this.resolveBindings();

    if (!this.components) return;

    // Update Components (via System)
    ComponentSystem.update(this, dt);
  }

  private resolveBindings() {
    // @ts-ignore
    const scene = this.scene;
    if (!scene) return;

    let hasChanges = false;

    this.vertices.forEach((v) => {
      const binding = v.binding;
      if (binding) {
        // Find Target
        // @ts-ignore
        const target = scene.findEntity
          ? scene.findEntity(binding.targetName)
          : scene.entities.find((e: any) => e.name === binding.targetName);
        if (target && target.type === 'Quad') {
          const q = target as QuadObject;
          if (binding.type === 'vertex') {
            const idx = binding.index || 0;
            if (q.vertices[idx]) {
              const tv = q.vertices[idx];
              if (v.x !== tv.x || v.y !== tv.y || v.p !== tv.p) {
                v.x = tv.x;
                v.y = tv.y;
                v.p = tv.p;
                hasChanges = true;
              }
            }
          } else if (binding.type === 'grid') {
            const u = binding.gridU || 0;
            const v_param = binding.gridV || 0;

            const tv0 = q.vertices[0];
            const tv1 = q.vertices[1];
            const tv2 = q.vertices[2];
            const tv3 = q.vertices[3];

            // Bilinear Interpolation
            const nx =
              (1 - u) * (1 - v_param) * tv0.x +
              u * (1 - v_param) * tv1.x +
              (1 - u) * v_param * tv3.x +
              u * v_param * tv2.x;
            const ny =
              (1 - u) * (1 - v_param) * tv0.y +
              u * (1 - v_param) * tv1.y +
              (1 - u) * v_param * tv3.y +
              u * v_param * tv2.y;

            // Parallax Interpolation
            const np =
              (1 - u) * (1 - v_param) * tv0.p +
              u * (1 - v_param) * tv1.p +
              (1 - u) * v_param * tv3.p +
              u * v_param * tv2.p;

            if (
              Math.abs(v.x - nx) > 0.01 ||
              Math.abs(v.y - ny) > 0.01 ||
              Math.abs(v.p - np) > 0.001
            ) {
              v.x = nx;
              v.y = ny;
              v.p = np;
              hasChanges = true;
            }
          }
        }
      }
    });

    // Trigger Editor Refresh if in Editor and values changed
    if (hasChanges) {
      this.notifyChange();
    }
  }

  /**
   * Updates a specific vertex of the Quad.
   * @param index Vertex index (0-3)
   * @param x New X position (optional)
   * @param y New Y position (optional)
   * @param p New Parallax factor (optional)
   */
  public setVertex(index: number, x?: number, y?: number, p?: number): boolean {
    const v = this.vertices[index];
    if (!v) {
      console.warn(`[QuadObject] Vertex ${index} not found on '${this.name}'.`);
      return false;
    }

    // If Vertex is Bound, propagate changes to the entire group
    if (v.binding) {
      // Calculate delta
      const dx = x !== undefined ? x - v.x : 0;
      const dy = y !== undefined ? y - v.y : 0;
      const dp = p !== undefined ? p - v.p : 0;

      // @ts-ignore
      const scene = this.scene;
      if (scene) {
        const group = QuadObject.getConnectedVertices(scene, this, index);

        let anyChanged = false;
        group.forEach((ref) => {
          if (dx !== 0) {
            ref.v.x += dx;
            anyChanged = true;
          }
          if (dy !== 0) {
            ref.v.y += dy;
            anyChanged = true;
          }
          if (dp !== 0) {
            // Parallax logic: Adjust pos to avoid jump?
            // If script is setting P, it likely wants to change P.
            // Auto-correcting Pos might be unexpected for a raw setter.
            // But for consistency with UI, maybe?
            // "setVertex" implies setting raw values.
            // Let's just set P for now.
            ref.v.p += dp;
            anyChanged = true;
          }
        });

        if (anyChanged) {
          this.notifyChange();
          // Also notify others? They will update on their own draw/update cycle or via editor?
          // getConnectedVertices returns Refs. We modified them in place.
          // If they are on other objects, those objects might need notification if in Editor.
          if (group.length > 1) {
            // @ts-ignore
            if (this.game.editor && this.game.editor.enabled) {
              // Force refresh of scene or selection?
              // Individual object notification is hard here without iterating.
              group.forEach((g) => {
                if (g.quad !== this) {
                  // @ts-ignore
                  this.game.editor.selectionManager.notifyObjectChanged(g.quad);
                }
              });
            }
          }
        }
        return true;
      }
    }

    let changed = false;
    if (x !== undefined && v.x !== x) {
      v.x = x;
      changed = true;
    }
    if (y !== undefined && v.y !== y) {
      v.y = y;
      changed = true;
    }
    if (p !== undefined && v.p !== p) {
      v.p = p;
      changed = true;
    }

    if (changed) {
      this.notifyChange();
    }

    return true;
  }

  private notifyChange() {
    // @ts-ignore
    if (this.game.editor && this.game.editor.enabled) {
      // @ts-ignore
      this.game.editor.selectionManager.notifyObjectChanged(this);
    }
  }

  /**
   * Finds all vertices connected to a specific vertex via bindings (Mutual/Graph Traversal).
   * Used for moving groups of bound vertices together.
   */
  static getConnectedVertices(
    scene: any,
    startQuad: QuadObject,
    startIndex: number
  ): { quad: QuadObject; index: number; v: QuadVertex }[] {
    const group: { quad: QuadObject; index: number; v: QuadVertex }[] = [];
    const visited = new Set<string>();
    const queue: { quad: QuadObject; index: number; v: QuadVertex }[] = [];

    if (!startQuad || !startQuad.vertices[startIndex]) return [];

    const startRef = { quad: startQuad, index: startIndex, v: startQuad.vertices[startIndex] };
    queue.push(startRef);
    visited.add(`${startRef.quad.name}_${startRef.index}`);
    group.push(startRef);

    while (queue.length > 0) {
      const current = queue.shift()!;

      // 1. Check OUTGOING binding (Who I am bound to)
      if (current.v.binding && current.v.binding.type === 'vertex') {
        const targetName = current.v.binding.targetName;
        const targetIdx = current.v.binding.index || 0;

        if (!visited.has(`${targetName}_${targetIdx}`)) {
          const tEnt = scene.entities.find((e: any) => e.name === targetName);
          if (tEnt && (tEnt as any).type === 'Quad') {
            const tQuad = tEnt as QuadObject;
            if (tQuad.vertices[targetIdx]) {
              const nextRef = { quad: tQuad, index: targetIdx, v: tQuad.vertices[targetIdx] };
              visited.add(`${targetName}_${targetIdx}`);
              group.push(nextRef);
              queue.push(nextRef);
            }
          }
        }
      }

      // 2. Check INCOMING bindings (Who is bound to me)
      scene.entities.forEach((e: any) => {
        if ((e as any).type === 'Quad') {
          const q = e as QuadObject;
          q.vertices.forEach((qv, qIdx) => {
            if (qv.binding && qv.binding.type === 'vertex') {
              if (
                qv.binding.targetName === current.quad.name &&
                qv.binding.index === current.index
              ) {
                if (!visited.has(`${q.name}_${qIdx}`)) {
                  const nextRef = { quad: q, index: qIdx, v: qv };
                  visited.add(`${q.name}_${qIdx}`);
                  group.push(nextRef);
                  queue.push(nextRef);
                }
              }
            }
          });
        }
      });
    }

    return group;
  }
}
