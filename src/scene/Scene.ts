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
    camDeadzoneX?: number;
    camDeadzoneY?: number;
    camMinX?: number;
    camMaxX?: number;
    camMinY?: number;
    camMaxY?: number;
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
    camDeadzoneX: number = 50;
    camDeadzoneY: number = 30;

    // Camera Bounds (undefined = infinite)
    camMinX?: number;
    camMaxX?: number;
    camMinY?: number;
    camMaxY?: number;

    // Internal state for "Smart Deadzone" (Catch-up mode)
    private _isCenteringX: boolean = false;
    private _isCenteringY: boolean = false;

    // Default Camera (saved to scene file, restored on load/reset)
    defaultCamera: { x: number, y: number, zoom: number };

    // Subscene State
    private _activeSubscene: string | null = null;
    private subsceneEntities: Set<Entity | Triggerbox> = new Set();

    get activeSubscene(): string | null {
        return this._activeSubscene;
    }

    set activeSubscene(value: string | null) {
        // If changing from a valid subscene to something else (or null), perform cleanup
        if (this._activeSubscene && this._activeSubscene !== value) {
            console.log(`[Scene] Closing Subscene: '${this._activeSubscene}' -> '${value}'`);

            const closingSubsceneID = this._activeSubscene;

            // Strategy 1 (Robust): Scan ALL triggers for Switches belonging to this subscene
            if (this.triggerboxes) {
                this.triggerboxes.forEach(tb => {
                    const tbGID = tb.groupID ? tb.groupID.trim() : '';

                    if (tbGID === closingSubsceneID) {
                        if (tb.components) {
                            for (const comp of tb.components) {
                                if (comp.type === 'Switch') {
                                    const sw = comp as any;
                                    // Soft check for state (handle "2" vs 2)
                                    // @ts-ignore
                                    if (sw.state == 2) {
                                        console.log(`  -> [RobustScan] Resetting Switch in '${tb.name}' to State 1`);
                                        sw.state = 1;
                                        if (sw.sound1 && typeof window !== 'undefined') {
                                            // @ts-ignore
                                            if (window.game) window.game.playSound(sw.sound1);
                                        }
                                    }
                                }
                            }
                        }
                    }
                });
            }

            // Strategy 2: Reset Switches in tracked entities (Nested groups or non-triggered)
            this.subsceneEntities.forEach(e => {
                const tb = e as any;
                if (tb.components) {
                    for (const comp of tb.components) {
                        if (comp.type === 'Switch') {
                            const sw = comp as any;
                            // Check if ALREADY reset by strategy 1
                            // @ts-ignore
                            if (sw.state == 2) {
                                console.log(`  -> [TrackedScan] Resetting Switch in '${tb.name}' to State 1`);
                                sw.state = 1;
                                if (sw.sound1 && typeof window !== 'undefined') {
                                    // @ts-ignore
                                    if (window.game) window.game.playSound(sw.sound1);
                                }
                            }
                        }
                    }
                }
            });

            // 3. Disable All Tracked Entities
            console.log(`  -> Disabling ${this.subsceneEntities.size} subscene entities.`);
            this.subsceneEntities.forEach(e => {
                e.disabled = true;
            });
            this.subsceneEntities.clear();
        }

        this._activeSubscene = value;
    }

    // Offscreen canvas for walkbox visualization
    private _walkboxCanvas: HTMLCanvasElement | null = null;
    private _blurCanvas: HTMLCanvasElement | null = null;

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
        this.camDeadzoneX = 50;
        this.camDeadzoneY = 30;
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
        return this.entities.find(e =>
            e.name.toUpperCase() === name.toUpperCase() ||
            (e.customName && e.customName.toUpperCase() === name.toUpperCase())
        );
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

    isWalkable(x: number, y: number, sourceEntity?: Entity): boolean {
        // console.log(`[Scene] isWalkable(${x}, ${y}) source=${sourceEntity?.name} Collider=${sourceEntity?.colliderWidth}x${sourceEntity?.colliderHeight}`);

        // 0. Zero Collider / Check
        // If entity has explicitly 0 size collider, it's a ghost.
        if (sourceEntity && sourceEntity.colliderWidth === 0 && sourceEntity.colliderHeight === 0) {
            // console.log("  -> Ghost (Zero Collider)");
            return true;
        }

        let sourceRect = null;
        if (sourceEntity && sourceEntity.colliderWidth > 0 && sourceEntity.colliderHeight > 0) {
            sourceRect = {
                x: x - sourceEntity.colliderWidth / 2,
                y: y - sourceEntity.colliderHeight / 2,
                w: sourceEntity.colliderWidth,
                h: sourceEntity.colliderHeight
            };
            // console.log(`  -> SourceRect: ${sourceRect.x},${sourceRect.y} ${sourceRect.w}x${sourceRect.h}`);

            // 1. Entity vs Entity Collision
            for (const other of this.entities) {
                if (other === sourceEntity) continue; // Skip self
                if (other.disabled) continue; // Skip disabled
                if (other.colliderWidth === 0 || other.colliderHeight === 0) continue; // Skip ghosts

                const otherRect = {
                    x: other.x - other.colliderWidth / 2,
                    y: other.y - other.colliderHeight / 2,
                    w: other.colliderWidth,
                    h: other.colliderHeight
                };

                if (Geometry.rectIntersectsRect(sourceRect, otherRect)) {
                    // console.log(`  -> Collision with entity ${other.name}`);
                    return false;
                }
            }
        }

        // Filter out disabled walkboxes first
        const activeWalkboxes = this.walkbox ? this.walkbox.filter(wb => !wb.disabled) : [];

        // If no active walkboxes, everything is walkable
        if (activeWalkboxes.length === 0) return true;

        if (sourceRect) {
            // --- COLLIDER MODE ---

            // 2. Subtract (Holes) - High Priority
            for (const wb of activeWalkboxes) {
                if (wb.mode === 'Subtract') {
                    if (Geometry.rectIntersectsPolygon(sourceRect, wb.poly)) {
                        console.log(`  -> Blocked by Subtract '${wb.name}'`);
                        return false; // Hit a hole
                    }
                }
            }

            // 3. Positive Constraints (Add + Invert)
            // If ANY 'Invert' or 'Add' boxes exist, the default for the world becomes BLOCKED
            // unless we are inside at least one of them.
            const positives = activeWalkboxes.filter(wb => wb.mode === 'Add' || wb.mode === 'Invert' || !wb.mode);

            if (positives.length > 0) {
                let safe = false;

                // Check simple containment in ANY positive box
                for (const wb of positives) {
                    if (Geometry.rectInsidePolygon(sourceRect, wb.poly)) {
                        console.log(`  -> Safe in Positive Box '${wb.name}' (${wb.mode || 'Invert'})`);
                        safe = true;
                        break;
                    }
                }

                if (!safe) {
                    console.log('  -> Blocked: Not inside any active Invert/Add box');
                    return false;
                }
            }

            return true;

            return true;

        } else {
            // --- POINT MODE (Legacy/Mouse/ZeroCollider) ---

            // 1. Subtract
            for (const wb of activeWalkboxes) {
                if (wb.mode === 'Subtract') {
                    if (Geometry.isPointInPolygon({ x, y }, wb.poly)) {
                        return false;
                    }
                }
            }

            // 2. Add
            for (const wb of activeWalkboxes) {
                if (wb.mode === 'Add') {
                    if (Geometry.isPointInPolygon({ x, y }, wb.poly)) {
                        return true;
                    }
                }
            }

            // 3. Invert (Standard Even-Odd)
            let inclusionCount = 0;
            let hasInvert = false;
            for (const wb of activeWalkboxes) {
                if (!wb.mode || wb.mode === 'Invert') {
                    hasInvert = true;
                    if (Geometry.isPointInPolygon({ x, y }, wb.poly)) {
                        inclusionCount++;
                    }
                }
            }

            if (hasInvert) {
                return inclusionCount % 2 !== 0; // Odd = Inside
            } else {
                return false;
            }
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

        console.log(`[Scene] onClick World: ${worldX.toFixed(1)}, ${worldY.toFixed(1)} ActiveSubscene: '${this.activeSubscene}'`);

        // 1. Check Triggers FIRST
        // Triggers take precedence. If we hit a trigger (Switch, etc.), we process it and do NOT close the subscene yet.
        if (this.triggerboxes) {
            for (const tb of this.triggerboxes) {
                // if (tb.disabled) console.log(`  -> Skipping disabled trigger '${tb.name}'`);
                if (tb.disabled) continue;
                if (Geometry.isPointInPolygon({ x: worldX, y: worldY }, tb.poly)) {
                    console.log(`Hit Triggerbox: ${tb.name} `);

                    this.activateTrigger(tb);

                    // If we hit any trigger, consuming the click is usually safest to prevent "closing" immediately after.
                    return;
                }
            }
        }

        // 2. Subscene Logic (If NO trigger hit)
        if (this.activeSubscene) {
            // Check if we hit any object visible in the subscene?
            // User requested: "Close if clicking OUTSIDE all objects in the subscene"
            let hitSubsceneObj = false;

            for (const obj of this.subsceneEntities) {
                if (obj.disabled) continue;

                if (obj.hitTest(worldX, worldY)) {
                    hitSubsceneObj = true;
                    console.log(`[Subscene] Clicked on object '${obj.name}' (Keep Open)`);
                    break;
                }
            }

            if (hitSubsceneObj) {
                return;
            }

            // If we are here, we clicked outside any trigger.
            // Check if we hit a "background" interactive object? (Not implemented)
            // Default behavior: Close Subscene.

            console.log("  -> Clicked outside Subscene triggers/entities. Closing.");

            // Setting this to null will trigger the Setter, which handles cleanup (Switches, Entities)
            this.activeSubscene = null;
            return;
        }

        if (this.player) {
            // @ts-ignore
            if (typeof this.player.walkTo === 'function') {
                // @ts-ignore
                this.player.walkTo(worldX, worldY);
            } else if (typeof this.player.moveTo === 'function') {
                // @ts-ignore
                this.player.moveTo(worldX, worldY);
            }
        } else {
            console.log("Cannot walk there!");
        }
    }

    activateTrigger(tb: Triggerbox, depth: number = 0): void {
        if (depth > 5) {
            console.warn("[Scene] Subtrigger recursion limit reached.");
            return;
        }

        console.log(`[Scene] Activating Trigger: ${tb.name}`);

        // Check Components
        if (tb.components) {
            for (const comp of tb.components) {
                if (comp.type === 'Subtrigger') {
                    // Delegate to another trigger
                    const sub = comp as any;
                    const targetName = sub.target;
                    if (!targetName) {
                        console.warn(`[Subtrigger] No target specified for '${tb.name}'`);
                        continue;
                    }

                    // Find Target Triggerbox
                    const targetTb = this.triggerboxes.find(t => t.name === targetName || t.name === targetName);
                    if (targetTb) {
                        console.log(`  -> Delegating to '${targetTb.name}'`);
                        this.activateTrigger(targetTb, depth + 1);
                    } else {
                        console.warn(`[Subtrigger] Target '${targetName}' not found.`);
                    }
                    return; // Stop processing this trigger (delegated)

                } else if (comp.type === 'Subscene') {
                    const sub = comp as any;
                    const targetID = sub.targetGroupId ? sub.targetGroupId.trim() : '';
                    if (!targetID) continue;

                    // PROXIMITY CHECK
                    // We need worldX/Y for proximity check? 
                    // Wait, activateTrigger doesn't have world coords passed in.
                    // But we can check against player position vs Trigger Center? 
                    // Or we just skip proximity check for Subtriggers?
                    // Let's assume passed click was valid. Or use player distance to Trigger Center.

                    if (this.player) {
                        // Calculate Trigger Center
                        // Simple centroid
                        let cx = 0, cy = 0;
                        tb.poly.forEach(p => { cx += p.x; cy += p.y; });
                        cx /= tb.poly.length;
                        cy /= tb.poly.length;

                        const dist = Math.hypot(this.player.x - cx, this.player.y - cy);
                        const allowedDist = (this.player.width || 30) * 4; // Loose tolerance

                        if (dist > allowedDist) {
                            console.log(`[Scene] Trigger activation too far: ${dist.toFixed(1)} > ${allowedDist}`);
                            // @ts-ignore
                            if (typeof window.game?.showMessage === 'function') {
                                // @ts-ignore
                                window.game.showMessage("You are too far away.");
                            }
                            return;
                        }
                    }

                    console.log(`  -> Activating Subscene Group: '${targetID}'`);
                    this.activeSubscene = targetID;
                    this.subsceneEntities.clear(); // Reset tracking

                    // 1. Enable Objects in this Group
                    let count = 0;
                    this.entities.forEach(e => {
                        const eGID = e.groupID ? e.groupID.trim() : '';
                        if (eGID === targetID) {
                            e.disabled = false;
                            this.subsceneEntities.add(e);
                            count++;
                        }
                    });

                    // 2. Enable Triggerboxes in this Group (Switches, etc.)
                    if (this.triggerboxes) {
                        this.triggerboxes.forEach(t => {
                            const tbGID = t.groupID ? t.groupID.trim() : '';
                            if (tbGID === targetID) {
                                t.disabled = false;
                                this.subsceneEntities.add(t);
                                count++;
                            }
                        });
                    }
                    return;

                } else if (comp.type === 'Switch') {
                    const sw = comp as any;

                    // 1. Check Key
                    if (sw.idKey) {
                        // @ts-ignore
                        const game = window.game;
                        if (game && game.inventory) {
                            const hasKey = game.inventory.some((i: any) => i.name === sw.idKey || i.id === sw.idKey);
                            if (!hasKey) {
                                console.log(`[Switch] Access Denied. Missing key: ${sw.idKey}`);
                                game.showMessage(`Locked. Needs ${sw.idKey}`);
                                return;
                            }
                        }
                    }

                    // 2. Toggle State
                    const nextState = sw.state === 1 ? 2 : 1;
                    sw.state = nextState;
                    console.log(`[Switch] Toggling to State ${nextState}`);

                    // 3. Audio
                    // @ts-ignore
                    const game = window.game;
                    if (game) {
                        if (nextState === 1 && sw.sound1) game.playSound(sw.sound1);
                        if (nextState === 2 && sw.sound2) game.playSound(sw.sound2);
                    }

                    // 4. Update Groups
                    const groupToShow = nextState === 1 ? sw.groupId1 : sw.groupId2;
                    const groupToHide = nextState === 1 ? sw.groupId2 : sw.groupId1;

                    let count = 0;
                    this.entities.forEach(e => {
                        const eGID = e.groupID ? e.groupID.trim() : '';
                        if (eGID === groupToShow) {
                            e.disabled = false;
                            if (this.activeSubscene) this.subsceneEntities.add(e);
                            count++;
                        } else if (eGID === groupToHide) {
                            e.disabled = true;
                            if (this.activeSubscene) this.subsceneEntities.delete(e);
                        }
                    });

                    // 5. Update Triggerboxes
                    if (this.triggerboxes) {
                        this.triggerboxes.forEach(t => {
                            if (t === tb) return; // Don't disable self

                            const tGID = t.groupID ? t.groupID.trim() : '';
                            if (tGID === groupToShow) {
                                t.disabled = false;
                                if (this.activeSubscene) this.subsceneEntities.add(t);
                            } else if (tGID === groupToHide) {
                                t.disabled = true;
                                if (this.activeSubscene) this.subsceneEntities.delete(t);
                            }
                        });
                    }
                    console.log(`[Switch] Updated Groups. Enabled '${groupToShow}', Disabled '${groupToHide}'`);
                    return;
                }
            }
        }

        // Legacy Script check
        if (tb.script) {
            console.log("Run Script:", tb.script);
            // We need to actually RUN it. In Scene.ts we might not have the runner.
            // But checking previous code ... it just logged "Run Script".
            // Wait, previous code:
            // if (tb.script) { console.log("Run Script:", tb.script); }
            // Is it not implemented fully?
            // Ah, the Game class probably handles checking? No, this is onClick.

            // Let's assume for now we just keep the log, or try to run it if possible.
            // But looking at Game.ts might reveal more. 
            // For now, I'll stick to what was there: console.log.
        }

        // If we hit any trigger, consuming the click is usually safest to prevent "closing" immediately after.
        return;
    }

    update(deltaTime: number): void {
        // Update Camera
        // 0. Update Camera Auto-Center Target
        if (this.player && this.autoCenter) {

            // 1. Calculate Player Center

            // 1. Calculate Player Center
            // Entity Coords: x = Center X, y = Bottom Y (Feet)
            const pHeight = this.player.height || 0;
            const playerCenterX = this.player.x;
            const playerCenterY = this.player.y - pHeight / 2;

            // 2. Deadzone Logic (Hysteresis / Catch-up)
            // If outside deadzone, START centering (target = player).
            // Stop centering only when very close to player.

            let targetX = this.camera.x;
            let targetY = this.camera.y;

            const dx = playerCenterX - this.camera.x;
            const dy = playerCenterY - this.camera.y;

            // X Axis
            if (Math.abs(dx) > this.camDeadzoneX) this._isCenteringX = true;
            if (this._isCenteringX) {
                targetX = playerCenterX;
                if (Math.abs(dx) < 2) this._isCenteringX = false;
            }

            // Y Axis
            if (Math.abs(dy) > this.camDeadzoneY) this._isCenteringY = true;
            if (this._isCenteringY) {
                targetY = playerCenterY;
                if (Math.abs(dy) < 2) this._isCenteringY = false;
            }

            // 3. Clamping (Level Bounds)
            if (this.camMinX !== undefined) targetX = Math.max(this.camMinX, targetX);
            if (this.camMaxX !== undefined) targetX = Math.min(this.camMaxX, targetX);
            if (this.camMinY !== undefined) targetY = Math.max(this.camMinY, targetY);
            if (this.camMaxY !== undefined) targetY = Math.min(this.camMaxY, targetY);

            // 4. Smooth Lerp to Target
            const dt = deltaTime / 1000;
            const speed = this.cameraSpeed || 5.0;

            if (Math.abs(targetX - this.camera.x) < 0.5) this.camera.x = targetX;
            else this.camera.x += (targetX - this.camera.x) * speed * dt;

            if (Math.abs(targetY - this.camera.y) < 0.5) this.camera.y = targetY;
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

        // SPLIT RENDER: Background/Normal vs Subscene
        const subsceneLayer: Entity[] = [];
        const normalLayer: Entity[] = [];

        this.entities.forEach(entity => {
            // If we have an active subscene, and this entity belongs to it OR is tracked as part of it
            // Robust check: Trim both
            const gID = entity.groupID ? entity.groupID.trim() : null;
            const target = this.activeSubscene ? this.activeSubscene.trim() : null;

            if (target && (gID === target || this.subsceneEntities.has(entity))) {
                subsceneLayer.push(entity);
            } else {
                normalLayer.push(entity);
            }
        });

        // 1. Render Normal Layer
        normalLayer.forEach(entity => {
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

        // 2. Dimmer / Blur (if active)
        if (this.activeSubscene) {
            // Setup Blur Canvas if needed
            if (!this._blurCanvas) {
                this._blurCanvas = document.createElement('canvas');
            }

            // Downsample Factor: 0.1 = 1/10th resolution (Strong Blur)
            const downsample = 0.1;
            const targetW = Math.floor(ctx.canvas.width * downsample);
            const targetH = Math.floor(ctx.canvas.height * downsample);

            if (this._blurCanvas.width !== targetW || this._blurCanvas.height !== targetH) {
                this._blurCanvas.width = targetW;
                this._blurCanvas.height = targetH;
            }

            const bCtx = this._blurCanvas.getContext('2d');
            if (bCtx) {
                // 1. Draw current screen (Normal Layer) into tiny canvas
                // Note: 'ctx' currently has the full resolution normal layer rendered.
                bCtx.imageSmoothingEnabled = true; // Smooth during downsample?
                bCtx.drawImage(ctx.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height, 0, 0, targetW, targetH);

                // 2. Clear Screen and Draw Stretched result back
                ctx.save();
                ctx.globalAlpha = 1.0;
                ctx.imageSmoothingEnabled = true; // CRITICAL: Smooth pixelation to create blur
                ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform ensures we cover screen
                ctx.drawImage(this._blurCanvas, 0, 0, targetW, targetH, 0, 0, ctx.canvas.width, ctx.canvas.height);
                ctx.restore();
            }

            // Optional: Keep the Dimmer on top for contrast? User asked for "Blur", usually implies dimming too.
            // Let's keep a lighter dimmer (30%) to ensure text/foreground pops.
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        }

        // 3. Render Subscene Layer
        subsceneLayer.forEach(entity => {
            if (entity.disabled) return; // Should be enabled by onClick
            // Subscene objects usually don't parallax, or parallax relative to center?
            // Assuming normal camera transform for now, but they are "on top".
            const p = entity.parallax !== undefined ? entity.parallax : 1.0;

            ctx.save();
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
        // No, `renderWalkbox` is called inside a `ctx.save()...ctx.restore()` block where transform is applied.

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
            cameraSpeed: this.cameraSpeed,
            camDeadzoneX: this.camDeadzoneX,
            camDeadzoneY: this.camDeadzoneY,
            camMinX: this.camMinX,
            camMaxX: this.camMaxX,
            camMinY: this.camMinY,
            camMaxY: this.camMaxY
        };
    }
}
