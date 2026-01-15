import { Entity } from './Entity';
import { Geometry } from '../utils/Geometry';

export interface QuadVertex {
    x: number;
    y: number;
    p: number; // Parallax Factor (1.0 = standard, <1 = far, >1 = near)
}

export type QuadSortMode = 'ignore' | 'v0' | 'v1' | 'v2' | 'v3';

export class QuadObject extends Entity {
    vertices: QuadVertex[];
    color: string;

    constructor(name: string) {
        super(0, 0, 100, 100, name);
        this.type = 'Quad';
        this.color = '#888888'; // Default Gray

        // Default 100x100 Square
        this.vertices = [
            { x: 0, y: 0, p: 1.0 },
            { x: 100, y: 0, p: 1.0 },
            { x: 100, y: 100, p: 1.0 },
            { x: 0, y: 100, p: 1.0 }
        ];
        this.sortMode = 'ignore';
    }

    sortMode: QuadSortMode = 'ignore';
    opacity: number = 1.0;
    blendMode: GlobalCompositeOperation = 'source-over';

    // Retro Grid Props
    isGrid: boolean = false;
    gridLines: number = 5;
    lineWidth: number = 1.0;
    gridColor: string = '#ffffff';

    // Fill Props
    filled: boolean = true;

    // Effects
    blur: number = 0;

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
        ctx.globalCompositeOperation = this.blendMode;

        // Apply Blur
        if (this.blur > 0) {
            ctx.filter = `blur(${this.blur}px)`;
        }

        // Calculate Screen Positions of Vertices
        // Apply parallax offset relative to P=1.0 base
        // Offset = -Cam * (V.p - 1.0)
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        const screenVerts = this.vertices.map(v => {
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
            const vHW = (ctx.canvas.width / 2) / zoom;
            const vHH = (ctx.canvas.height / 2) / zoom;

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

            // Horizontal Cuts (Down the shape)
            for (let i = 1; i <= this.gridLines; i++) {
                const t = i / (this.gridLines + 1);

                // Left Point
                const lx = v0.x + (v3.x - v0.x) * t;
                const ly = v0.y + (v3.y - v0.y) * t;

                // Right Point
                const rx = v1.x + (v2.x - v1.x) * t;
                const ry = v1.y + (v2.y - v1.y) * t;

                ctx.moveTo(lx, ly);
                ctx.lineTo(rx, ry);
            }

            // Vertical Cuts (Across the shape)
            for (let i = 1; i <= this.gridLines; i++) {
                const t = i / (this.gridLines + 1);

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
        if (window.game?.editor?.enabled && this.selected) {
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

        const projectedPoly = this.vertices.map(v => ({
            x: v.x - camX * (v.p - 1.0),
            y: v.y - camY * (v.p - 1.0)
        }));

        return Geometry.isPointInPolygon({ x, y }, projectedPoly);
    }

    // Serialization
    toJSON(): any {
        const data = super.toJSON() as any;

        // Remove redundant Entity fields for Quad
        delete data.width;
        delete data.height;
        delete data.baseWidth;
        delete data.baseHeight;
        delete data.colliderWidth;
        delete data.colliderHeight;
        delete data.spriteName;
        delete data.scale;
        delete data.modelScale;
        delete data.animationSpeed;

        return {
            ...data,
            type: 'Quad', // Force Type
            vertices: this.vertices.map(v => ({ ...v })),
            color: this.color,
            sortMode: this.sortMode,
            opacity: this.opacity,
            blendMode: this.blendMode,

            // Retro Grid
            isGrid: this.isGrid,
            gridLines: this.gridLines,
            lineWidth: this.lineWidth,
            gridColor: this.gridColor,

            // Fill
            filled: this.filled,

            // Effects
            blur: this.blur
        };
    }

    static fromJSON(data: any): QuadObject {
        const obj = new QuadObject(data.name);
        // Standard Props
        if (data.x !== undefined) obj.x = data.x;
        if (data.y !== undefined) obj.y = data.y;
        if (data.layer !== undefined) obj.layer = data.layer;
        if (data.locked) obj.locked = data.locked;
        if (data.disabled) obj.disabled = data.disabled;
        if (data.visible !== undefined) obj.visible = data.visible;
        if (data.groupID) obj.groupID = data.groupID;

        // Custom Props
        if (data.vertices) obj.vertices = data.vertices.map((v: any) => ({ ...v }));
        if (data.color) obj.color = data.color;

        // Backwards compatibility for ignoreYSorting
        if (data.sortMode) {
            obj.sortMode = data.sortMode;
        } else if (data.ignoreYSorting !== undefined) {
            // Standard sorting uses this.y. v0 is roughly top-left?
            // Actually, if ignoreYSorting was false, it fell back to Entity.y.
            // QuadObject usually has y=0? No, checking SceneEditor, we might set y?
            // To be safe, let's map false to 'v3' (Bottom-Left) or 'v2' (Bottom-Right) which are usually lower?
            // Actually, for a floor, closest to camera is usually bottom.
            // Let's mimic standard behavior: Sort by "Y". 
            // If we pick a vertex, which one is "Y"?
            // Standard sorting checks min Y? Max Y?
            // In Scene.ts: return a.y - b.y.
            // So it uses the object's y property.
            // If we choose 'v2' (bottom right) or 'v3' (bottom left), it's consistent with "feet" position.
            // Let's use 'v3' (Bottom Left) for now if explicit sorting was requested.
            obj.sortMode = data.ignoreYSorting ? 'ignore' : 'v3';
        }

        if (data.opacity !== undefined) obj.opacity = data.opacity;
        if (data.blendMode !== undefined) obj.blendMode = data.blendMode;

        if (data.isGrid !== undefined) obj.isGrid = data.isGrid;
        if (data.gridLines !== undefined) obj.gridLines = data.gridLines;
        if (data.lineWidth !== undefined) obj.lineWidth = data.lineWidth;
        if (data.gridColor !== undefined) obj.gridColor = data.gridColor;

        // Fill
        if (data.filled !== undefined) obj.filled = data.filled;

        // Effects
        if (data.blur !== undefined) obj.blur = data.blur;

        // Components
        if (data.components) {
            obj.components = JSON.parse(JSON.stringify(data.components));
        }

        return obj;
    }



    update(dt: number): void {
        super.update(dt);

        if (!this.components) return;

        // @ts-ignore
        const scene = this.scene;
        if (!scene) return;

        for (const comp of this.components) {
            if (comp.type === 'Backface') {
                const bf = comp as any;
                // Props: vertexA (0-3), vertexB (0-3), axis ('x'|'y'), op ('>'|'<'), targetId (opt)

                const idxA = bf.vertexA || 0;
                const idxB = bf.vertexB || 1;
                const axis = bf.axis || 'x'; // 'x' or 'y'
                const op = bf.op || '>'; // '>' or '<'

                const vA = this.vertices[idxA];
                const vB = this.vertices[idxB];

                if (!vA || !vB) continue;

                // Compare VISUAL (Screen) positions
                // Visual Pos = World Pos - Camera Pos * Parallax
                // (Ignoring Zoom and Center offset as they cancel out in comparison A > B)

                // Ensure Parallax is defined (Default 1.0)
                const pA = vA.p !== undefined ? vA.p : 1.0;
                const pB = vB.p !== undefined ? vB.p : 1.0;

                const camX = scene.camera.x;
                const camY = scene.camera.y;

                // Calculate Visual Coordinate
                const valA = (axis === 'x' ? vA.x : vA.y) - (axis === 'x' ? camX : camY) * pA;
                const valB = (axis === 'x' ? vB.x : vB.y) - (axis === 'x' ? camX : camY) * pB;

                // Condition
                let match = false;
                if (op === '>') match = valA > valB;
                else if (op === '<') match = valA < valB;

                // Debug Log (Throttle?)
                // console.log(`[Backface] A(${idxA}):${valA.toFixed(1)} vs B(${idxB}):${valB.toFixed(1)} match=${match}`);


                // Resolve Target
                let target: QuadObject | null = this;
                if (bf.targetId) {
                    const searchId = bf.targetId.trim();
                    if (searchId === this.name.trim()) {
                        target = this;
                    } else {
                        // Find by Name or GroupID
                        // @ts-ignore
                        const found = scene.entities.find(e => e.name.trim() === searchId && e.type === 'Quad');
                        target = found ? (found as QuadObject) : null;
                    }
                }

                if (target) {
                    const cullingType = bf.cullingType || 'layer';

                    // Debug Log
                    // console.log(`[Backface] Match:${match} Type:${cullingType} Visible:${target.visible}`);

                    if (match) {
                        // Hide (Backface Culling)
                        if (cullingType === 'render') {
                            target.visible = false;
                            // Ensure layer is reset if we switched modes
                            (target as any).renderLayer = undefined;
                        } else {
                            // Layer Mode
                            (target as any).renderLayer = target.layer - 1;
                            target.visible = true;
                        }
                    } else {
                        // Restore (Show)
                        target.visible = true;
                        (target as any).renderLayer = undefined;
                    }
                }
            }
        }
    }
}
