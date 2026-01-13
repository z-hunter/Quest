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

    // Override render to handle per-vertex parallax
    render(ctx: CanvasRenderingContext2D): void {
        // Need access to Camera Position
        // @ts-ignore
        const scene = this.scene;
        if (!scene) return;

        const camX = scene.camera.x;
        const camY = scene.camera.y;

        ctx.save(); // Save context state
        ctx.globalAlpha = this.opacity;
        ctx.globalCompositeOperation = this.blendMode;

        ctx.fillStyle = this.color;

        ctx.beginPath();

        this.vertices.forEach((v, i) => {
            // Apply parallax offset relative to P=1.0 base
            // Offset = -Cam * (V.p - 1.0)
            const offX = -camX * (v.p - 1.0);
            const offY = -camY * (v.p - 1.0);

            if (i === 0) ctx.moveTo(v.x + offX, v.y + offY);
            else ctx.lineTo(v.x + offX, v.y + offY);
        });

        ctx.closePath();
        ctx.fill();
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
        return {
            ...super.toJSON(),
            type: 'Quad', // Force Type
            vertices: this.vertices.map(v => ({ ...v })),
            color: this.color,
            sortMode: this.sortMode,
            opacity: this.opacity,
            blendMode: this.blendMode
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
        if (data.groupID) obj.groupID = data.groupID;

        // Custom Props
        if (data.vertices) obj.vertices = data.vertices.map((v: any) => ({ ...v }));
        if (data.color) obj.color = data.color;

        // Backwards compatibility for ignoreYSorting
        if (data.sortMode) {
            obj.sortMode = data.sortMode;
        } else if (data.ignoreYSorting !== undefined) {
            obj.sortMode = data.ignoreYSorting ? 'ignore' : 'v0'; // Default to v0 if not ignoring? Or just 'ignore'? 
            // Previous logic: ignoreYSorting=false => use standard sorting. 
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
            // For Quads, do we update obj.y?
            // If we choose 'v2' (bottom right) or 'v3' (bottom left), it's consistent with "feet" position.
            // Let's use 'v3' (Bottom Left) for now if explicit sorting was requested.
            obj.sortMode = data.ignoreYSorting ? 'ignore' : 'v3';
        }

        if (data.opacity !== undefined) obj.opacity = data.opacity;
        if (data.blendMode !== undefined) obj.blendMode = data.blendMode;

        return obj;
    }
}
