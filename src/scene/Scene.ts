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
    walkbox: { poly: { x: number, y: number }[], name: string, mode?: 'Invert' | 'Add' | 'Subtract' }[];
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

    // Offscreen canvas for walkbox visualization
    private _walkboxCanvas: HTMLCanvasElement | null = null;

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
        // Filter out disabled walkboxes first
        const activeWalkboxes = this.walkbox ? this.walkbox.filter(wb => !wb.disabled) : [];

        // If no active walkboxes, everything is walkable
        if (activeWalkboxes.length === 0) return true;

        // 1. Subtract (High Priority: Holes)
        for (const wb of activeWalkboxes) {
            if (wb.mode === 'Subtract') {
                if (Geometry.isPointInPolygon({ x, y }, wb.poly)) {
                    return false; // Valid "Hole"
                }
            }
        }

        // 2. Add (Medium Priority: Bridges)
        for (const wb of activeWalkboxes) {
            if (wb.mode === 'Add') {
                if (Geometry.isPointInPolygon({ x, y }, wb.poly)) {
                    return true; // Forced Walkable
                }
            }
        }

        // 3. Invert (Low Priority: Standard Even-Odd)
        let inclusionCount = 0;
        let hasInvert = false;
        for (const wb of activeWalkboxes) {
            // Default to 'Invert' if mode is undefined or explicitly set
            if (!wb.mode || wb.mode === 'Invert') {
                hasInvert = true;
                if (Geometry.isPointInPolygon({ x, y }, wb.poly)) {
                    inclusionCount++;
                }
            }
        }

        // If there are NO Invert boxes, and we passed Subtract/Add checks,
        // it means we are in "open space" not covered by any base logic.
        // However, usually if we have *any* walkboxes, the default is "not walkable unless inside".
        // But if we ONLY have 'Subtract' boxes (and no Invert/Add), the check at the top
        // "if activeWalkboxes.length === 0" handles the "no walkboxes" case.
        // If we have ONLY 'Subtract' boxes, we implicitly have a "World is Walkable" base? 
        // Or "World is NOT Walkable"?
        // Standard Adventure Game Logic:
        // - If NO walkboxes defined -> Walkable everywhere.
        // - If ANY walkboxes defined -> Walkable ONLY inside them.

        if (hasInvert) {
            // Odd count = Inside (Walkable)
            return inclusionCount % 2 !== 0;
        } else {
            // If we have active walkboxes but NONE are 'Invert' (e.g. only Subtract or only Add),
            // What is the base state?
            // If we only have 'Subtract', it implies we started with "Walkable Everywhere".
            // If we only have 'Add', it implies we started with "Walkable Nowhere".

            // Simplest assumption: If there are ANY walkboxes, we assume "Walkable Nowhere" is the base,
            // UNLESS all walkboxes are 'Subtract', in which case maybe we want "Walkable Everywhere"?

            // Let's stick to the requested logic:
            // "Invert: works like current implementation" (which builds the walkable area from scratch).
            // "Subtract: cuts hole".

            // If I have 1 Subtract box and nothing else.
            // Step 1: Inside Subtract -> Return False.
            // Step 2: Outside Subtract.
            // Step 3: hasInvert = false.
            // Returns... False? That means the whole world is unwalkable except... nowhere?
            // That seems wrong if the user just wants to cut a hole in a default-walkable world.
            // BUT, the current engine logic is: "If walkbox exists, you can ONLY walk inside it".
            // So if you add a Subtract box, you need a Base Invert box to subtract FROM.
            // This is consistent. You can't just have a Subtract box.

            return false;
        }
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
            // @ts-ignore
            if (typeof this.player.moveTo === 'function') {
                // @ts-ignore
                this.player.moveTo(worldX, worldY);
            }
        } else {
            console.log("Cannot walk there!");
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
            if (entity.disabled) return;
            // @ts-ignore
            entity.update(deltaTime, (x, y) => this.isWalkable(x, y, entity));
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
            if (entity.disabled) return;
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
        const editor = window.game?.editor;
        if (editor && editor.enabled) {
            // Only draw if a Walkbox is selected
            if (editor.selectedObject && editor.selectedObject instanceof Walkbox) {
                ctx.save();
                // Center Pivot Transform
                ctx.translate(halfW, halfH);
                ctx.scale(this.camera.zoom, this.camera.zoom);
                ctx.translate(-this.camera.x, -this.camera.y);
                this.renderWalkbox(ctx);
                ctx.restore();
            }
        }

        ctx.restore();
    }

    renderWalkbox(ctx: CanvasRenderingContext2D): void {
        if (!this.walkbox || this.walkbox.length === 0) return;

        const activeBoxes = this.walkbox.filter(wb => !wb.disabled);
        if (activeBoxes.length === 0) return;

        // Initialize offscreen canvas
        if (!this._walkboxCanvas) {
            this._walkboxCanvas = document.createElement('canvas');
        }
        if (this._walkboxCanvas.width !== ctx.canvas.width || this._walkboxCanvas.height !== ctx.canvas.height) {
            this._walkboxCanvas.width = ctx.canvas.width;
            this._walkboxCanvas.height = ctx.canvas.height;
        }

        const wbCtx = this._walkboxCanvas.getContext('2d');
        if (!wbCtx) return;

        wbCtx.clearRect(0, 0, this._walkboxCanvas.width, this._walkboxCanvas.height);

        // Setup transform on offscreen canvas
        const halfW = ctx.canvas.width / 2;
        const halfH = ctx.canvas.height / 2;

        wbCtx.save();
        wbCtx.translate(halfW, halfH);
        wbCtx.scale(this.camera.zoom, this.camera.zoom);
        wbCtx.translate(-this.camera.x, -this.camera.y);

        // Group by mode
        const inverts = activeBoxes.filter(wb => !wb.mode || wb.mode === 'Invert');
        const adds = activeBoxes.filter(wb => wb.mode === 'Add');
        const subtracts = activeBoxes.filter(wb => wb.mode === 'Subtract');

        // 1. Draw Inverts (Green, Even-Odd)
        // We use opaque green here, handled by alpha later
        wbCtx.fillStyle = '#00FF00';

        if (inverts.length > 0) {
            wbCtx.beginPath();
            inverts.forEach(wb => {
                const poly = wb.poly;
                if (poly.length > 0) {
                    wbCtx.moveTo(poly[0].x, poly[0].y);
                    for (let i = 1; i < poly.length; i++) {
                        wbCtx.lineTo(poly[i].x, poly[i].y);
                    }
                    wbCtx.closePath();
                }
            });
            wbCtx.fill('evenodd');
        }

        // 2. Draw Adds (Green, simple fill, union)
        if (adds.length > 0) {
            wbCtx.beginPath();
            adds.forEach(wb => {
                const poly = wb.poly;
                if (poly.length > 0) {
                    wbCtx.moveTo(poly[0].x, poly[0].y);
                    for (let i = 1; i < poly.length; i++) {
                        wbCtx.lineTo(poly[i].x, poly[i].y);
                    }
                    wbCtx.closePath();
                }
            });
            wbCtx.fill(); // Non-zero winding
        }

        // 3. Draw Subtracts (Erase)
        if (subtracts.length > 0) {
            wbCtx.globalCompositeOperation = 'destination-out';
            wbCtx.beginPath();
            subtracts.forEach(wb => {
                const poly = wb.poly;
                if (poly.length > 0) {
                    wbCtx.moveTo(poly[0].x, poly[0].y);
                    for (let i = 1; i < poly.length; i++) {
                        wbCtx.lineTo(poly[i].x, poly[i].y);
                    }
                    wbCtx.closePath();
                }
            });
            wbCtx.fill();
            wbCtx.globalCompositeOperation = 'source-over';
        }

        wbCtx.restore();

        // 4. Draw Offscreen to Main Screen with Alpha
        ctx.save();
        // Since offscreen is already transformed/sized to screen, we draw it at 0,0 identity
        // But render() might have left us in a transformed state.
        // Checking Scene.render(), it wraps renderWalkbox in save/restore, but applies transform BEFORE calling.
        // Wait, renderWalkbox lines 221-222 in Scene.ts:
        // ctx.translate... ctx.scale...
        // renderWalkbox(ctx)

        // So 'ctx' is ALREADY transformed.
        // But our offscreen canvas was drawn using the transform on a 1:1 surface.
        // So if we draw the offscreen canvas now, we need to UNDO the current ctx transform
        // OR, better, renderWalkbox logic above was wrong about using ctx.canvas.width.

        // Correction: If we want to use an offscreen buffer matching screen size, we should draw it at Identity.
        // Since `ctx` passed to us is transformed, we should assume Identity for `drawImage`?
        // No, `renderWalkbox` is called inside a `ctx.save()... ctx.restore()` block where transform is applied.

        // To draw the screen-sized buffer, we need to invert the transform or reset it.
        // It's safer to just POP the transform, draw 1:1, then push it back? No, we can't pop what we didn't push.
        // We can just setTransform(1,0,0,1,0,0) if we want absolute coordinates.
        ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset to Identity
        ctx.globalAlpha = 0.2;
        ctx.drawImage(this._walkboxCanvas, 0, 0);
        ctx.globalAlpha = 1.0;

        // 5. Draw Outlines (Strokes) - We need the camera transform back for this!
        // We can re-apply it manually, or use `wbCtx` logic?
        // Actually, we can just use the same transform logic as before.

        ctx.translate(halfW, halfH);
        ctx.scale(this.camera.zoom, this.camera.zoom);
        ctx.translate(-this.camera.x, -this.camera.y);

        ctx.lineWidth = 2; // / this.camera.zoom; // Constant width?

        // Inverts/Adds = Green Stroke
        const positives = [...inverts, ...adds];
        if (positives.length > 0) {
            ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
            ctx.beginPath();
            positives.forEach(wb => {
                const poly = wb.poly;
                if (poly.length > 0) {
                    ctx.moveTo(poly[0].x, poly[0].y);
                    for (let i = 1; i < poly.length; i++) {
                        ctx.lineTo(poly[i].x, poly[i].y);
                    }
                    ctx.closePath();
                }
            });
            ctx.stroke();
        }

        // Subtracts = Red Stroke
        if (subtracts.length > 0) {
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
            ctx.beginPath();
            subtracts.forEach(wb => {
                const poly = wb.poly;
                if (poly.length > 0) {
                    ctx.moveTo(poly[0].x, poly[0].y);
                    for (let i = 1; i < poly.length; i++) {
                        ctx.lineTo(poly[i].x, poly[i].y);
                    }
                    ctx.closePath();
                }
            });
            ctx.stroke();
        }

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
