import { Entity } from '../entities/Entity';
import { ComponentSystem } from '../systems/ComponentSystem';
import { SceneObject } from '../entities/SceneObject';
import { Actor } from '../entities/Actor';
import type { EntityData } from '../entities/Entity';
import { Walkbox } from '../entities/Walkbox';
import { Triggerbox } from '../entities/Triggerbox';
import { Geometry } from '../utils/Geometry';
import { SceneRenderer } from '../graphics/SceneRenderer';
import type { IGame } from '../core/IGame';

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
    game: IGame;
    renderer: SceneRenderer;

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
    public subsceneEntities: Set<SceneObject> = new Set();

    get activeSubscene(): string | null {
        return this._activeSubscene;
    }

    // Unified Target Resolution (Groups & Objects)
    resolveTarget(targetStr: string): SceneObject[] {
        if (!targetStr) return [];

        const targets = new Set<SceneObject>();
        const tokens = targetStr.split(',').map(t => t.trim()).filter(t => t.length > 0);

        tokens.forEach(token => {
            if (token.startsWith('#')) {
                // Group Target
                // Match: Object's groupID contains this token
                // NOTE: Object's groupID is now a CSV string.
                this.entities.forEach(e => {
                    if (e.groupID) {
                        const groups = e.groupID.split(',').map(g => g.trim());
                        if (groups.includes(token)) targets.add(e);
                    }
                });
                if (this.triggerboxes) {
                    this.triggerboxes.forEach(t => {
                        if (t.groupID) {
                            const groups = t.groupID.split(',').map(g => g.trim());
                            if (groups.includes(token)) targets.add(t);
                        }
                    });
                }
            } else {
                // Individual Object Target
                const obj = this.findEntity(token);
                if (obj) targets.add(obj);

                // Also check Triggerboxes by name
                if (this.triggerboxes) {
                    const tb = this.triggerboxes.find(t => t.name === token);
                    if (tb) targets.add(tb);
                }
            }
        });

        return Array.from(targets);
    }

    set activeSubscene(value: string | null) {
        // If changing from a valid subscene to something else (or null), perform cleanup
        if (this._activeSubscene && this._activeSubscene !== value) {
            console.log(`[Scene] Closing Subscene: '${this._activeSubscene}' -> '${value}'`);

            // 1. Reset Switches (Robust Scan)
            // We scan ALL triggers because any switch could have been part of the "State" of this subscene
            // Resolving *state* is tricky with mixed targets. 
            // Assumption: If a Switch was activated by this subscene, it should probably reset? 
            // OR: We only reset switches that are *literally* in the group?
            // Existing logic: "Scan ALL triggers for Switches belonging to this subscene"
            // With mixed targets, "belonging" is fuzzy.
            // Let's stick to: If a switch is IN the closing group (via resolveTarget), reset it?
            // Actually, the previous logic scanned triggers to see if their groupID matched the subscene.

            const closingTargets = this.resolveTarget(this._activeSubscene);

            // Check for switches within the closing targets
            closingTargets.forEach(obj => {
                if (obj.components) {
                    for (const comp of obj.components) {
                        if (comp.type === 'Switch') {
                            const sw = comp as any;
                            // @ts-ignore
                            if (sw.state == 2) {
                                console.log(`  -> [AutoReset] Resetting Switch in '${obj.name}' to State 1`);
                                sw.state = 1;
                                if (sw.sound1) {
                                    this.game.playSound(sw.sound1);
                                }
                            }
                        }
                    }
                }
            });

            // 2. Disable All Tracked Entities
            console.log(`  -> Disabling ${this.subsceneEntities.size} subscene entities.`);
            this.subsceneEntities.forEach(e => {
                e.disabled = true;
            });
            this.subsceneEntities.clear();
        }

        this._activeSubscene = value;
    }



    constructor(game: IGame, id: string, name: string) {
        this.game = game;
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
        this.renderer = new SceneRenderer(game);

        // Load Scene Data
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
            // Apply Source Parallax & Visual correction to Source Rect (Visual Collider)
            const sp = sourceEntity.parallax !== undefined ? sourceEntity.parallax : 1.0;
            const svOx = (sourceEntity as any).visualOffset ? (sourceEntity as any).visualOffset.x : 0;
            const svOy = (sourceEntity as any).visualOffset ? (sourceEntity as any).visualOffset.y : 0;

            // Source is currently at 'x, y' proposed world pos.
            // Effective Visual X = ProposedWorldX - CamX * (P - 1) + vOx
            let sEffX = x;
            let sEffY = y;

            if (sp !== 1.0 && this.camera) {
                sEffX = x - this.camera.x * (sp - 1.0) + svOx;
                sEffY = y - this.camera.y * (sp - 1.0) + svOy;
            } else {
                sEffX = x + svOx;
                sEffY = y + svOy;
            }

            sourceRect = {
                x: sEffX - sourceEntity.colliderWidth / 2,
                y: sEffY - sourceEntity.colliderHeight,
                w: sourceEntity.colliderWidth,
                h: sourceEntity.colliderHeight
            };
            // console.log(`  -> SourceRect: ${sourceRect.x},${sourceRect.y} ${sourceRect.w}x${sourceRect.h}`);

            // 1. Entity vs Entity Collision
            for (const other of this.entities) {
                if (other === sourceEntity) continue; // Skip self
                if (other.disabled) continue; // Skip disabled
                if (other.colliderWidth === 0 || other.colliderHeight === 0) continue; // Skip ghosts

                const p = other.parallax !== undefined ? other.parallax : 1.0;

                // Effective Collision Position (Visual Position)
                // If P != 1, the object is visually shifted by -Cam * (P - 1)
                // We collide with what we see.
                let effX = other.x;
                let effY = other.y;

                const vOx = (other as any).visualOffset ? (other as any).visualOffset.x : 0;
                const vOy = (other as any).visualOffset ? (other as any).visualOffset.y : 0;

                if (p !== 1.0 && this.camera) {
                    effX = other.x - this.camera.x * (p - 1.0) + vOx;
                    effY = other.y - this.camera.y * (p - 1.0) + vOy;
                } else {
                    effX = other.x + vOx;
                    effY = other.y + vOy;
                }

                const otherRect = {
                    x: effX - other.colliderWidth / 2,
                    y: effY - other.colliderHeight,
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

        // Integrated WalkBox Components (Quads)
        // We look for entities with 'WalkBox' component and treat them as walkboxes
        // Optimization: In a large scene, we might want to cache this list.
        this.entities.forEach(entity => {
            if (entity.disabled) return;
            if (entity.components) {
                const wbComp = entity.components.find((c: any) => c.type === 'WalkBox');
                if (wbComp && (entity as any).vertices) {
                    const vertices = (entity as any).vertices.map((v: any) => {
                        const p = v.p !== undefined ? v.p : ((entity as any).parallax || 1.0);
                        let vx = v.x;
                        let vy = v.y;
                        if (this.camera && p !== 1.0) {
                            vx = v.x - this.camera.x * (p - 1.0);
                            vy = v.y - this.camera.y * (p - 1.0);
                        }
                        return { x: vx, y: vy };
                    });

                    activeWalkboxes.push({
                        name: entity.name,
                        poly: vertices, // Corrected Visual Vertices
                        mode: wbComp.mode || 'Invert',
                        disabled: false
                    } as any);
                }
            }
        });

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

    /**
     * Finds the topmost interactive object at the given WORLD coordinates.
     * Uses the exact logic as onClick to determine what "blocks" a click.
     */
    getHitObject(worldX: number, worldY: number): SceneObject | null {
        // 1. Gather Candidates
        let candidates: SceneObject[] = [];
        this.entities.forEach(e => {
            if (!e.disabled) candidates.push(e);
        });
        if (this.triggerboxes) {
            this.triggerboxes.forEach(t => {
                if (!t.disabled) candidates.push(t);
            });
        }

        // 2. Sort Candidates (EXACT logic from user requirements / onClick)
        candidates.sort((a, b) => {
            const layerA = a.layer || 0;
            const layerB = b.layer || 0;
            if (layerA !== layerB) {
                return layerB - layerA; // Descending
            }

            const isEntityA = a instanceof Entity;
            const isEntityB = b instanceof Entity;

            if (isEntityA && !isEntityB) return -1;
            if (!isEntityA && isEntityB) return 1;

            return 0;
        });

        // 3. Iterate & Hit Test
        for (const obj of candidates) {
            if (obj.hitTest(worldX, worldY)) {
                // Check Interactivity
                const hasComponents = obj.components && obj.components.length > 0;

                // Unified Interactivity Check (Entity or Triggerbox)
                // Only Specific Components are considered "Interactive" (blocking clicks)
                // Items (pickups) are Passive for clicking - you walk to them.
                // WalkBox IS interactive because it must catch the click (layer blocking)
                const interactiveTypes = ['Switch', 'Subscene', 'Subtrigger', 'WalkBox'];
                let isComponentInteractive = false;

                if (hasComponents) {
                    isComponentInteractive = obj.components!.some(c => c && interactiveTypes.includes(c.type));
                }

                // Triggerboxes are also interactive if they have a script
                // Note: Triggerboxes with WalkBox ONLY should now NOT block (Fixed)
                const isScriptTrigger = (obj instanceof Triggerbox) && (obj.script && obj.script.length > 0);

                const hasInteractions = obj.interactions && Object.keys(obj.interactions).length > 0;
                const isInteractive = isComponentInteractive || isScriptTrigger || hasInteractions;

                if (isInteractive) {
                    return obj; // Found the blocking interactive object
                }

                // Debugging "Absorbed Click" false positives
                // if (hasComponents) {
                //    console.log(`[Scene] PASSTHROUGH ${obj.name} (${obj.type}). Components: ${obj.components.map(c=>c.type).join(',')}`);
                // }

                // Passive -> Continue
            }
        }
        return null;
    }

    checkHover(x: number, y: number): boolean {
        // Transform Screen Coordinates to World Coordinates
        const screenW = 420;
        const screenH = 300;
        const halfW = screenW / 2;
        const halfH = screenH / 2;
        const worldX = (x - halfW) / this.camera.zoom + this.camera.x;
        const worldY = (y - halfH) / this.camera.zoom + this.camera.y;

        const obj = this.getHitObject(worldX, worldY);

        if (obj && obj.components) {
            const sub = obj.components.find(c => c.type === 'Subscene') as any;
            if (sub) {
                // If this trigger opens the CURRENTLY active subscene, ignore it (cursor shouldn't change)
                if (this.activeSubscene && sub.targetGroupId === this.activeSubscene) {
                    return false;
                }
                return true;
            }
        }

        return false;
    }

    onClick(x: number, y: number): void {
        const screenW = 420;
        const screenH = 300;
        const halfW = screenW / 2;
        const halfH = screenH / 2;
        const worldX = (x - halfW) / this.camera.zoom + this.camera.x;
        const worldY = (y - halfH) / this.camera.zoom + this.camera.y;

        console.log(`[Scene] onClick World: ${worldX.toFixed(1)}, ${worldY.toFixed(1)} ActiveSubscene: '${this.activeSubscene}'`);

        const hitObj = this.getHitObject(worldX, worldY);

        if (hitObj) {
            console.log(`[Scene] Hit Interactive Object: ${hitObj.name}`);

            // Check if it's a WalkBox (Movement Command, not Interaction)
            const isWalkBox = hitObj.components && hitObj.components.some(c => c.type === 'WalkBox');
            // If it has OTHER interactive components (Switch, Subscene), they take precedence over WalkBox
            const isMechanism = hitObj.components && hitObj.components.some(c => ['Switch', 'Subscene', 'Subtrigger'].includes(c.type));
            const hasScript = (hitObj instanceof Triggerbox) && (hitObj.script && hitObj.script.length > 0);

            if (isWalkBox && !isMechanism && !hasScript) {
                // It's just a floor/walkbox. Treat as movement content.
                console.log(`  -> Object is WalkBox. Proceeding to WalkTo.`);
                // Fallthrough to movement logic below
            } else {
                this.activateObject(hitObj);
                return; // Consume Click
            }
        }

        // 4. Subscene Logic (If NO trigger/entity hit)
        if (this.activeSubscene) {
            // Check if we hit specific subscene entities to keep open?
            // The logic from previous impl:
            let clickedSubsceneObj = false;
            for (const obj of this.subsceneEntities) {
                if (obj.hitTest(worldX, worldY)) {
                    clickedSubsceneObj = true;
                    break;
                }
            }

            if (clickedSubsceneObj) {
                console.log(`[Subscene] Clicked on passive object (Keep Open)`);
                return;
            }

            console.log("  -> Clicked outside Subscene triggers/entities. Closing.");
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

    activateObject(obj: SceneObject, depth: number = 0): void {
        if (depth > 5) {
            console.warn("[Scene] Recursion limit reached.");
            return;
        }

        console.log(`[Scene] Activating Object: ${obj.name} (${obj.type})`);

        // Delegate Component Logic to System
        // Store depth on scene for ComponentSystem to access during recursion (Subtrigger)
        (this as any)._depth = depth;

        if (ComponentSystem.handleActivation(obj, this)) {
            return;
        }

        // Legacy Script check (Triggerbox specific usually)
        if (obj instanceof Triggerbox && obj.script) {
            console.log("Run Script:", obj.script);
            // Implement script running here if needed
        }

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

    // -----------------------------------------------------
    // RENDER LOOP
    // -----------------------------------------------------
    // -----------------------------------------------------

    render(ctx: CanvasRenderingContext2D): void {
        this.renderer.render(ctx, this);
    }


    toJSON(): SceneData {
        // We include Player in the entities list so state is saved (pos, etc)
        // Loader must handle 'Player' type specially to assign to scene.player
        const savedEntities = this.entities.map(e => e.toJSON());

        return {
            id: this.id,
            name: this.name,
            filename: this.filename,
            walkbox: this.walkbox.map(wb => wb.toJSON()),
            triggerboxes: this.triggerboxes.map(tb => tb.toJSON()),
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
