import { Entity } from '../entities/Entity';
import { Actor } from '../entities/Actor';
import type { EntityData } from '../entities/Entity';
import { Walkbox } from '../entities/Walkbox';
import { Triggerbox } from '../entities/Triggerbox';
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
    filename?: string;
    walkbox: { poly: { x: number, y: number }[], name: string }[];
    triggerboxes: { poly: { x: number, y: number }[], name: string, script: string }[];
    scaling: SceneScaling;
    entities: EntityData[];
    camera?: { x: number, y: number, zoom: number };
    autoCenter?: boolean;
    cameraSpeed?: number;
}

export class Scene {
    id: string;
    name: string;
    filename: string;
    background: HTMLImageElement | null;
    entities: Entity[];
    walkbox: Walkbox[];
    triggerboxes: Triggerbox[];
    scaling: SceneScaling;
    player: Actor | null;

    // Runtime Camera (used for rendering)
    camera: { x: number, y: number, zoom: number };
    autoCenter: boolean;
    cameraSpeed: number;

    // Default Camera (saved to scene file, restored on load/reset)
    defaultCamera: { x: number, y: number, zoom: number };

    constructor(id: string, name: string) {
        this.id = id;
        this.name = name;
        this.filename = ''; // Default empty
        this.background = null; // Image object
        this.entities = [];
        this.walkbox = [];
        this.triggerboxes = [];
        this.scaling = {
            enabled: true,
            min: 0.5,
            max: 1.0,
            horizon: 150, // Y coordinate for min scale
            front: 300    // Y coordinate for max scale
        };
        this.player = null;
        this.camera = { x: 0, y: 0, zoom: 1.0 };
        this.defaultCamera = { x: 0, y: 0, zoom: 1.0 };
        this.autoCenter = true; // Default to true
        this.cameraSpeed = 5.0; // Default speed
    }

    addEntity(entity: Entity): void {
        this.entities.push(entity);
        // @ts-ignore
        entity.scene = this;
        // If this entity is the player, store a reference
        if (entity instanceof Actor && entity.isPlayer) {
            this.player = entity;
        }
    }

    removeEntity(entity: Entity): void {
        const index = this.entities.indexOf(entity);
        if (index > -1) {
            this.entities.splice(index, 1);
            if (this.player === entity) {
                this.player = null;
            }
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
        for (const wb of this.walkbox) {
            if (Geometry.isPointInPolygon({ x, y }, wb.poly)) {
                inclusionCount++;
            }
        }

        // Odd count = Inside (Walkable)
        return inclusionCount % 2 !== 0;
    }

    onClick(x: number, y: number): void {
        // Transform Screen Coordinates to World Coordinates
        // Center-Based: World = (Screen - Center) / Zoom + Camera
        const screenW = 420; // Internal Resolution
        const screenH = 300;

        const halfW = screenW / 2;
        const halfH = screenH / 2;

        const worldX = (x - halfW) / this.camera.zoom + this.camera.x;
        const worldY = (y - halfH) / this.camera.zoom + this.camera.y;

        console.log(`[Scene] onClick Screen: ${Math.round(x)},${Math.round(y)} -> World: ${Math.round(worldX)},${Math.round(worldY)}`);

        if (this.player) {
            if (this.isWalkable(worldX, worldY)) {
                // @ts-ignore
                if (typeof this.player.moveTo === 'function') {
                    // @ts-ignore
                    this.player.moveTo(worldX, worldY);
                }
            } else {
                console.log("Cannot walk there!");
            }
        }
    }

    update(deltaTime: number): void {
        // ... existing update
        // ... existing update
        if (this.player && this.autoCenter) {
            // Center is simply the player's position
            const targetX = this.player.x;
            // Center on player's visual center (approx mid-height)
            const pHeight = this.player.height || 0;
            const targetY = this.player.y - pHeight / 2;

            // Smooth Lerp
            const dt = deltaTime / 1000; // Convert to seconds
            const speed = this.cameraSpeed || 5.0;

            if (Math.abs(targetX - this.camera.x) < 1) this.camera.x = targetX;
            else this.camera.x += (targetX - this.camera.x) * speed * dt;

            if (Math.abs(targetY - this.camera.y) < 1) this.camera.y = targetY;
            else this.camera.y += (targetY - this.camera.y) * speed * dt;
        }

        this.entities.forEach(entity => {
            // @ts-ignore
            entity.update(deltaTime, (x, y) => this.isWalkable(x, y));
        });
    }

    render(ctx: CanvasRenderingContext2D): void {
        // ... existing render start
        ctx.save();
        // ctx.fillStyle = '#000'; // Removed: Game.ts clears the screen.
        // ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        this.entities.sort((a, b) => {
            const pA = a.parallax !== undefined ? a.parallax : 1.0;
            const pB = b.parallax !== undefined ? b.parallax : 1.0;
            if (pA !== pB) return pA - pB;
            if (a.layer !== b.layer) return a.layer - b.layer;
            return a.y - b.y;
        });

        const halfW = ctx.canvas.width / 2;
        const halfH = ctx.canvas.height / 2;

        this.entities.forEach(entity => {
            const p = entity.parallax !== undefined ? entity.parallax : 1.0;
            ctx.save();

            // Center Pivot Transform
            ctx.translate(halfW, halfH);
            ctx.scale(this.camera.zoom, this.camera.zoom);
            ctx.translate(-this.camera.x * p, -this.camera.y * p);

            entity.render(ctx);
            ctx.restore();
        });

        // 4. Draw Walkbox (Debug)
        // Correctly apply Camera Zoom and Translate (Parallax 1.0)
        // @ts-ignore
        if (window.game && window.game.editor && window.game.editor.enabled) {
            ctx.save();
            // Center Pivot Transform
            ctx.translate(halfW, halfH);
            ctx.scale(this.camera.zoom, this.camera.zoom);
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
        this.walkbox.forEach(wb => {
            const poly = wb.poly;
            if (poly.length > 0) {
                ctx.moveTo(poly[0].x, poly[0].y);
                for (let i = 1; i < poly.length; i++) {
                    ctx.lineTo(poly[i].x, poly[i].y);
                }
                ctx.closePath();
            }
        });

        // Fill using Even-Odd rule
        ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
        ctx.fill('evenodd');

        // Stroke all
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
        ctx.lineWidth = 2; // Line width will be affected by scale, might want to inverse scale if we want constant 2px
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
            filename: this.filename,
            walkbox: this.walkbox,
            triggerboxes: this.triggerboxes,
            scaling: this.scaling,
            entities: savedEntities,
            camera: this.defaultCamera, // Save the DEFAULT settings, not the current runtime state
            autoCenter: this.autoCenter,
            cameraSpeed: this.cameraSpeed
        };
    }
}
