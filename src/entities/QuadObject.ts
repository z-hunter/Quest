import { Entity } from './Entity';
import type { IGame } from '../core/IGame';
import { ComponentSystem } from '../systems/ComponentSystem';
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

    constructor(game: IGame, name: string) {
        super(game, 0, 0, 100, 100, name);
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
    gridLinesX: number = 5;
    gridLinesY: number = 5;
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
            gridLinesX: this.gridLinesX,
            gridLinesY: this.gridLinesY,
            lineWidth: this.lineWidth,
            gridColor: this.gridColor,

            // Fill
            filled: this.filled,

            // Effects
            blur: this.blur
        };
    }

    static fromJSON(game: IGame, data: any): QuadObject {
        const obj = new QuadObject(game, data.name);
        // Standard Props
        if (data.x !== undefined) obj.x = data.x;
        if (data.y !== undefined) obj.y = data.y;
        obj.layer = (data.layer !== undefined && Number.isFinite(Number(data.layer))) ? Number(data.layer) : 0;
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

        // Migrate old gridLines
        if (data.gridLines !== undefined) {
            obj.gridLinesX = data.gridLines;
            obj.gridLinesY = data.gridLines;
        }

        if (data.gridLinesX !== undefined) obj.gridLinesX = data.gridLinesX;
        if (data.gridLinesY !== undefined) obj.gridLinesY = data.gridLinesY;

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

        // Update Components (via System)
        ComponentSystem.update(this, dt);
    }
}
