import { Entity } from '../entities/Entity';
import type { EntityData } from '../entities/Entity';
import { Geometry } from '../utils/Geometry';

export interface SceneScaling {
    enabled: boolean;
    min: number;
    max: number;
    horizon: number;
    front: number;
}

export interface SceneData {
    id: string;
    name: string;
    walkbox: { x: number, y: number }[][];
    scaling: SceneScaling;
    entities: EntityData[];
}

export class Scene {
    id: string;
    name: string;
    background: HTMLImageElement | null;
    entities: Entity[];
    walkbox: { x: number, y: number }[][];
    scaling: SceneScaling;
    player: Entity | null;
    camera: { x: number, y: number, zoom: number };

    constructor(id: string, name: string) {
        this.id = id;
        this.name = name;
        this.background = null; // Image object
        this.entities = [];
        this.walkbox = []; // Array of polygons
        this.scaling = {
            enabled: true,
            min: 0.5,
            max: 1.0,
            horizon: 150, // Y coordinate for min scale
            front: 300    // Y coordinate for max scale
        };
        this.player = null;
        this.camera = { x: 0, y: 0, zoom: 1.0 };
    }

    addEntity(entity: Entity): void {
        this.entities.push(entity);
        // @ts-ignore
        entity.scene = this;
        // If this entity is the player, store a reference
        if (entity.constructor.name === 'Player') {
            this.player = entity;
        }
    }

    removeEntity(entity: Entity): void {
        const index = this.entities.indexOf(entity);
        if (index > -1) {
            this.entities.splice(index, 1);
        }
    }

    findEntity(name: string): Entity | undefined {
        return this.entities.find(e => e.name.toUpperCase() === name.toUpperCase());
    }

    getScaling(y: number): number {
        if (!this.scaling.enabled) return 1.0;

        // Define horizon and front line from config
        const horizonY = this.scaling.horizon;
        const frontY = this.scaling.front;

        // Clamp Y
        const clampedY = Math.max(horizonY, Math.min(y, frontY));

        // Normalize Y (0.0 at horizon, 1.0 at front)
        const t = (clampedY - horizonY) / (frontY - horizonY);

        // Lerp scale
        return this.scaling.min + t * (this.scaling.max - this.scaling.min);
    }

    isWalkable(x: number, y: number): boolean {
        // If no walkbox, everything is walkable
        if (!this.walkbox || this.walkbox.length === 0) return true;

        let inclusionCount = 0;
        for (const poly of this.walkbox) {
            if (Geometry.isPointInPolygon({ x, y }, poly)) {
                inclusionCount++;
            }
        }

        // Odd count = Inside (Walkable)
        return inclusionCount % 2 !== 0;
    }

    onClick(x: number, y: number): void {
        // Convert screen X/Y to world X/Y
        // Note: The input x, y are likely screen coordinates (from mouse event)
        // We need to inverse transform them if the camera is active.
        // BUT: Scene.onClick usually takes logic coordinates?
        // Let's assume input is WORLD coordinates for now (transform happens in Input handler or before calling this).
        // Actually SceneEditor calculates logic coords.

        if (this.player) {
            if (this.isWalkable(x, y)) {
                // @ts-ignore - Player has moveTo, Entity base might not (yet)
                if (typeof this.player.moveTo === 'function') {
                    // @ts-ignore
                    this.player.moveTo(x, y);
                }
            } else {
                console.log("Cannot walk there!");
            }
        }
    }

    update(deltaTime: number): void {
        // 0. Update Camera to follow player
        if (this.player) {
            // Simple center follow for now
            // We can add smoothing later
            // Target is player position centered
            // We assume 320x200 resolution or similar. Center is w/2, h/2.
            // Let's assume window.game.width available or hardcode 320??
            // For now, let's keep camera at 0,0 or just center player

            // To center player: CameraX = PlayerX - ScreenW/2
            // Hardcoding 320x200 for typical retro resolution
            const screenW = 320;
            const screenH = 200;

            this.camera.x = this.player.x - screenW / 2;
            this.camera.y = this.player.y - screenH / 2;
        }

        this.entities.forEach(entity => {
            // Pass isWalkable callback to entity update (for Player collision)
            // @ts-ignore - Entity update signature might need adjustment or Player override
            entity.update(deltaTime, (x, y) => this.isWalkable(x, y));
        });
    }

    render(ctx: CanvasRenderingContext2D): void {
        // 1. Clear Screen
        ctx.save();
        ctx.fillStyle = '#000'; // Default black background
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        // 2. Sort Entities by Parallax (asc) -> Layer (asc) -> Y (asc)
        this.entities.sort((a, b) => {
            const pA = a.parallax !== undefined ? a.parallax : 1.0;
            const pB = b.parallax !== undefined ? b.parallax : 1.0;

            if (pA !== pB) return pA - pB;
            if (a.layer !== b.layer) return a.layer - b.layer;
            return a.y - b.y;
        });

        // 3. Draw Entities with Parallax Transform
        this.entities.forEach(entity => {
            const p = entity.parallax !== undefined ? entity.parallax : 1.0;

            ctx.save();

            // 1. Zoom
            ctx.scale(this.camera.zoom, this.camera.zoom);

            // 2. Parallax Translation
            // Moves the world coordinate system relative to the camera.
            // Entity.render draws at (entity.x, entity.y).
            // We want (entity.x - cam.x * p) to land at the drawing coordinate.
            // So we translate so that (x,y) -> (x - cam.x*p, y - cam.y*p)
            ctx.translate(-this.camera.x * p, -this.camera.y * p);

            entity.render(ctx); // Draws at (this.x, this.y)

            ctx.restore();
        });

        // 4. Draw Walkbox (Debug) - Affected by camera?
        // Walkbox is usually "world" coordinates, so it moves with parallax 1.0?
        // @ts-ignore
        if (window.game && window.game.editor && window.game.editor.enabled) {
            ctx.save();
            ctx.translate(-this.camera.x, -this.camera.y);
            this.renderWalkbox(ctx);
            ctx.restore();
        }

        ctx.restore();
    }

    renderWalkbox(ctx: CanvasRenderingContext2D): void {
        if (!this.walkbox || this.walkbox.length === 0) return;

        ctx.save();
        ctx.beginPath();

        // Create a single path with all polygons
        this.walkbox.forEach(poly => {
            if (poly.length > 0) {
                ctx.moveTo(poly[0].x, poly[0].y);
                for (let i = 1; i < poly.length; i++) {
                    ctx.lineTo(poly[i].x, poly[i].y);
                }
                ctx.closePath();
            }
        });

        // Fill using Even-Odd rule to handle holes correctly
        ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
        ctx.fill('evenodd');

        // Stroke all
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.restore();
    }

    toJSON(): SceneData {
        // We include Player in the entities list so state is saved (pos, etc)
        // Loader must handle 'Player' type specially to assign to scene.player
        const savedEntities = this.entities.map(e => e.toJSON());

        return {
            id: this.id,
            name: this.name,
            walkbox: this.walkbox,
            scaling: this.scaling,
            entities: savedEntities,
            // @ts-ignore
            camera: {
                x: this.camera.x,
                y: this.camera.y,
                zoom: this.camera.zoom
            }
        };
    }
}
