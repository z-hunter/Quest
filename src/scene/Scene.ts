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
    player: Entity | null; // Using Entity for now, will be Player

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
        this.entities.forEach(entity => {
            // Pass isWalkable callback to entity update (for Player collision)
            // @ts-ignore - Entity update signature might need adjustment or Player override
            entity.update(deltaTime, (x, y) => this.isWalkable(x, y));
        });
    }

    render(ctx: CanvasRenderingContext2D): void {
        // 1. Draw Background
        if (this.background) {
            ctx.drawImage(this.background, 0, 0);
        } else {
            // Debug background
            ctx.fillStyle = '#333';
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        }

        // 3. Sort Entities by Layer then Y (Depth Sorting)
        this.entities.sort((a, b) => {
            if (a.layer !== b.layer) {
                return a.layer - b.layer;
            }
            return a.y - b.y;
        });

        // 4. Draw Entities
        this.entities.forEach(entity => entity.render(ctx));

        // 5. Debug: Draw Walkbox (Only if Editor is enabled)
        // @ts-ignore
        if (window.game && window.game.editor && window.game.editor.enabled) {
            this.renderWalkbox(ctx);
        }
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
        // Filter out Player from saved entities
        const savedEntities = this.entities
            .filter(e => e.constructor.name !== 'Player')
            .map(e => e.toJSON());

        return {
            id: this.id,
            name: this.name,
            walkbox: this.walkbox,
            scaling: this.scaling,
            entities: savedEntities
        };
    }
}
