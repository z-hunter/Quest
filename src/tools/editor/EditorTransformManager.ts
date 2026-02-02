
import { SceneEditor } from '../SceneEditor';
import { Entity } from '../../entities/Entity';
import { Actor } from '../../entities/Actor';
import { QuadObject } from '../../entities/QuadObject';
import { Walkbox } from '../../entities/Walkbox';
import { Triggerbox } from '../../entities/Triggerbox';

import { Geometry } from '../../utils/Geometry';
import { DefaultActorData, DefaultEntityData, DefaultQuadData } from '../../entities/EntityPrefabs';
import { useEditorStore } from '../../store/editorStore';

export class EditorTransformManager {
    private editor: SceneEditor;

    // State
    isDragging: boolean = false;
    dragOffset: { x: number, y: number } = { x: 0, y: 0 };
    isPanning: boolean = false;
    lastPanPos: { x: number, y: number } = { x: 0, y: 0 };
    lastMousePos: { x: number, y: number } = { x: 0, y: 0 };

    creationType: 'Walkbox' | 'Triggerbox' = 'Walkbox';
    draggingVertexIndex: number = -1;
    resizingHandle: string | null = null;
    drawMode: boolean = false;
    currentPolygon: { x: number, y: number }[] = [];

    constructor(editor: SceneEditor) {
        this.editor = editor;
    }

    // Helper: Screen -> World
    getMousePos(e: MouseEvent): { x: number, y: number } {
        const rect = this.editor.game.canvas.getBoundingClientRect();
        const scaleX = this.editor.game.canvas.width / rect.width;
        const scaleY = this.editor.game.canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    getSnappedPos(current: { x: number, y: number }, anchor: { x: number, y: number }): { x: number, y: number } {
        const dx = current.x - anchor.x;
        const dy = current.y - anchor.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist === 0) return anchor;

        const angle = Math.atan2(dy, dx);
        const snapAngle = Math.PI / 8; // 22.5 degrees
        const snappedAngle = Math.round(angle / snapAngle) * snapAngle;

        return {
            x: Math.round(anchor.x + Math.cos(snappedAngle) * dist),
            y: Math.round(anchor.y + Math.sin(snappedAngle) * dist)
        };
    }

    // Interaction Handlers

    onMouseDown(e: MouseEvent): void {
        const editor = this.editor;
        if (!editor.enabled) return;

        // Right Click Panning
        if (e.button === 2) {
            this.isPanning = true;
            this.lastPanPos = { x: e.clientX, y: e.clientY };

            // Disable Auto-Center automatically
            if (editor.game.sceneManager.currentScene) {
                editor.game.sceneManager.currentScene.autoCenter = false;

                // Notify UI immediately
                const store = useEditorStore.getState();
                if (!store.selectedObjectId || store.selectedObjectId === 'SCENE') {
                    store.incrementObjectVersion();
                }
            }
            e.preventDefault();
            return;
        }

        if (this.drawMode) return;

        const pos = this.getMousePos(e); // Screen Coords
        const scene = editor.game.sceneManager.currentScene;

        if (scene) {
            const camX = scene.camera ? scene.camera.x : 0;
            const camY = scene.camera ? scene.camera.y : 0;
            const zoom = scene.camera ? scene.camera.zoom : 1.0;

            const halfW = editor.game.canvas.width / 2;
            const halfH = editor.game.canvas.height / 2;

            // 0. CHECK SELECTED POLYGON VERTICES (High Priority)
            if (editor.selectedObject && (editor.selectedObject instanceof Walkbox || editor.selectedObject instanceof Triggerbox || (editor.selectedObject as any).type === 'Quad')) {
                if (editor.selectedObject.disabled) return; // Prevent interaction if disabled

                let poly: any[] = [];
                // Only Quads use projected vertices for Hit Test logic in original code
                if ((editor.selectedObject as any).type === 'Quad') {
                    // Project Quad Vertices to World P=1 for Hit Test
                    poly = (editor.selectedObject as QuadObject).vertices.map((v: any) => ({
                        x: v.x - camX * (v.p - 1.0),
                        y: v.y - camY * (v.p - 1.0)
                    }));
                } else {
                    poly = (editor.selectedObject as any).poly;
                }

                const vertexRadius = 6 / zoom; // Hit radius

                // Calculate Centroid...
                let cx = 0, cy = 0;
                if ((editor.selectedObject as any).type === 'Quad') {
                    poly.forEach((p: any) => { cx += p.x; cy += p.y; });
                    cx /= poly.length;
                    cy /= poly.length;
                }

                // Check vertices
                const worldPos = {
                    x: (pos.x - halfW) / zoom + camX,
                    y: (pos.y - halfH) / zoom + camY
                };

                for (let i = 0; i < poly.length; i++) {
                    let vx = poly[i].x;
                    let vy = poly[i].y;

                    // Apply Quad Shift
                    if ((editor.selectedObject as any).type === 'Quad') {
                        const dx = cx - vx;
                        const dy = cy - vy;
                        const len = Math.sqrt(dx * dx + dy * dy);
                        if (len > 0) {
                            const shiftDist = (vertexRadius / 2) + (2 / zoom);
                            vx += (dx / len) * shiftDist;
                            vy += (dy / len) * shiftDist;
                        }
                    }

                    if (Math.abs(worldPos.x - vx) < vertexRadius / 2 && Math.abs(worldPos.y - vy) < vertexRadius / 2) {
                        if (!editor.selectedObject.locked) {
                            editor.saveUndoState();
                            this.isDragging = true;
                            this.draggingVertexIndex = i;
                            useEditorStore.getState().selectVertex(i); // Sync UI
                            e.stopPropagation();
                            return;
                        }
                    }
                }

                // Check Polygon Body
                if (Geometry.isPointInPolygon(worldPos, poly)) {
                    if (!editor.selectedObject.locked) {
                        editor.saveUndoState();
                        this.isDragging = true;
                        this.draggingVertexIndex = -1; // Drag Whole Body

                        // For QuadObject, DragOffset should be relative to P=1 World Pos
                        this.dragOffset = { x: worldPos.x, y: worldPos.y };
                        useEditorStore.getState().selectVertex(-1);
                        e.stopPropagation();
                        return;
                    }
                }
            }

            // 0.5 CHECK SELECTED ENTITY (High Priority)
            if (editor.selectedObject && editor.selectedObject instanceof Entity && (editor.selectedObject as any).type !== 'Quad') {
                if (editor.selectedObject.disabled) return;
                const entity = editor.selectedObject;

                const p = entity.parallax !== undefined ? entity.parallax : 1.0;
                // @ts-ignore
                const vOx = entity.visualOffset ? entity.visualOffset.x : 0;
                // @ts-ignore
                const vOy = entity.visualOffset ? entity.visualOffset.y : 0;

                const screenX = (entity.x - camX * p + vOx) * zoom + halfW;
                const screenY = (entity.y - camY * p + vOy) * zoom + halfH;
                const screenW = entity.width * zoom;
                const screenH = entity.height * zoom;

                const sl = screenX - screenW / 2;
                const sr = screenX + screenW / 2;
                const st = screenY - screenH;
                const sb = screenY;

                const exactHSize = 6;
                let hitHandle = null;

                // Handles
                if (pos.x >= sl && pos.x <= sl + exactHSize && pos.y >= st && pos.y <= st + exactHSize) hitHandle = 'nw';
                else if (pos.x >= sr - exactHSize && pos.x <= sr && pos.y >= st && pos.y <= st + exactHSize) hitHandle = 'ne';
                else if (pos.x >= sl && pos.x <= sl + exactHSize && pos.y >= sb - exactHSize && pos.y <= sb) hitHandle = 'sw';
                else if (pos.x >= sr - exactHSize && pos.x <= sr && pos.y >= sb - exactHSize && pos.y <= sb) hitHandle = 'se';

                const hitBody = (pos.x >= sl && pos.x <= sr && pos.y >= st && pos.y <= sb);

                if (hitHandle || hitBody) {
                    if (!entity.locked) {
                        editor.saveUndoState();
                        this.isDragging = true;
                        this.draggingVertexIndex = -1;

                        if (hitHandle) {
                            this.resizingHandle = hitHandle;
                        } else {
                            this.resizingHandle = null;
                            this.dragOffset = { x: pos.x - screenX, y: pos.y - screenY };
                        }

                        e.stopPropagation();
                        return;
                    }
                }
            }

            // 1. Check Entities
            const entities = scene.entities;
            for (let i = entities.length - 1; i >= 0; i--) {
                const entity = entities[i];
                if (entity.disabled) continue;
                if (entity.locked) continue;

                const p = entity.parallax !== undefined ? entity.parallax : 1.0;

                // @ts-ignore
                const vOx = (entity as any).visualOffset ? (entity as any).visualOffset.x : 0;
                // @ts-ignore
                const vOy = (entity as any).visualOffset ? (entity as any).visualOffset.y : 0;

                // Mouse World Pos for this entity layer
                const worldX = (pos.x - halfW) / zoom + camX * p - vOx;
                const worldY = (pos.y - halfH) / zoom + camY * p - vOy;

                if (entity.hitTest(worldX, worldY)) {
                    this.editor.selectObject(entity);
                    e.stopPropagation();
                    return;
                }
            }

            // 2. Check Walkboxes
            const worldPos = {
                x: (pos.x - halfW) / zoom + camX,
                y: (pos.y - halfH) / zoom + camY
            };

            if (scene.walkbox) {
                for (const wb of scene.walkbox) {
                    if (wb.disabled) continue;
                    if (wb.locked) continue;
                    if (Geometry.isPointInPolygon(worldPos, wb.poly)) {
                        this.editor.selectObject(wb);
                        e.stopPropagation();
                        return;
                    }
                }
            }

            // 3. Check Triggerboxes
            if (scene.triggerboxes) {
                for (const tb of scene.triggerboxes) {
                    if (tb.disabled) continue;
                    if (tb.locked) continue;
                    if (Geometry.isPointInPolygon(worldPos, tb.poly)) {
                        this.editor.selectObject(tb);
                        e.stopPropagation();
                        return;
                    }
                }
            }
        }

        this.editor.selectObject(null);
    }

    onMouseMove(e: MouseEvent): void {
        const editor = this.editor;
        this.lastMousePos = this.getMousePos(e);
        // Sync Editor's lastMousePos too for Paste compatibility?
        editor.lastMousePos = this.lastMousePos;

        if (!editor.enabled) return;

        // PANNING
        if (this.isPanning && editor.game.sceneManager.currentScene) {
            const dx = e.clientX - this.lastPanPos.x;
            const dy = e.clientY - this.lastPanPos.y;
            this.lastPanPos = { x: e.clientX, y: e.clientY };

            const s = editor.game.sceneManager.currentScene;
            s.camera.x -= dx / s.camera.zoom;
            s.camera.y -= dy / s.camera.zoom;

            if (s.autoCenter) {
                s.autoCenter = false;
                const store = useEditorStore.getState();
                if (!store.selectedObjectId || store.selectedObjectId === 'SCENE') {
                    store.incrementObjectVersion();
                }
            }

            // Update UI
            const cx = document.getElementById('cam-x') as HTMLInputElement;
            const cy = document.getElementById('cam-y') as HTMLInputElement;
            if (cx) cx.value = Math.round(s.camera.x).toString();
            if (cy) cy.value = Math.round(s.camera.y).toString();
            return;
        }

        if (!this.isDragging || !editor.selectedObject) return;

        const pos = this.getMousePos(e);
        const scene = editor.game.sceneManager.currentScene;

        if (scene) {
            const camX = scene.camera ? scene.camera.x : 0;
            const camY = scene.camera ? scene.camera.y : 0;
            const zoom = scene.camera ? scene.camera.zoom : 1.0;
            const halfW = editor.game.canvas.width / 2;
            const halfH = editor.game.canvas.height / 2;
            const store = useEditorStore.getState();

            // POLYGON DRAGGING
            if (editor.selectedObject instanceof Walkbox || editor.selectedObject instanceof Triggerbox || (editor.selectedObject as any).type === 'Quad') {
                const worldPos = {
                    x: (pos.x - halfW) / zoom + camX,
                    y: (pos.y - halfH) / zoom + camY
                };

                let poly: any;
                if ((editor.selectedObject as any).type === 'Quad') {
                    poly = (editor.selectedObject as QuadObject).vertices;
                } else {
                    poly = (editor.selectedObject as any).poly;
                }

                if (this.draggingVertexIndex >= 0 && this.draggingVertexIndex < poly.length) {
                    // Moving a Vertex
                    const v = poly[this.draggingVertexIndex];

                    if ((editor.selectedObject as any).type === 'Quad') {
                        // Reverse Projection
                        // WorldPos = v
                        // v is stored in "P=1" space for Quads technically? 
                        // Wait, Quad vertices are relative to Quad X/Y? OR absolute?
                        // Original Editor: QuadObject creation sets vertices relative to something?
                        // "vertices: [ {x: x, y: y...}]" -> Absolute.

                        // Quad Hit Test used:
                        // x: v.x - camX * (v.p - 1.0)
                        // So v.x is storing absolute P=1 coord?
                        // If we move mouse to WorldPos, we need to solve for V.x
                        // WorldPos.x = V.x - camX * (V.p - 1.0)
                        // V.x = WorldPos.x + camX * (V.p - 1.0)

                        v.x = Math.round(worldPos.x + camX * (v.p - 1.0));
                        v.y = Math.round(worldPos.y + camY * (v.p - 1.0));

                    } else {
                        v.x = Math.round(worldPos.x);
                        v.y = Math.round(worldPos.y);
                    }
                    store.incrementObjectVersion();

                } else if (this.draggingVertexIndex === -1) {
                    // Moving Body (Quad/Polygon)
                    const dx = worldPos.x - this.dragOffset.x;
                    const dy = worldPos.y - this.dragOffset.y;

                    // Update DragOffset
                    this.dragOffset = { x: worldPos.x, y: worldPos.y };

                    if ((editor.selectedObject as any).type === 'Quad') {
                        const q = editor.selectedObject as QuadObject;
                        // Move all vertices
                        // And center x/y?
                        q.vertices.forEach(v => {
                            v.x += dx;
                            v.y += dy;
                        });
                        q.x += dx;
                        q.y += dy;
                    } else {
                        poly.forEach((p: any) => {
                            p.x += dx;
                            p.y += dy;
                        });
                    }
                    store.incrementObjectVersion();
                }
            }
            // ENTITY DRAGGING/RESIZING
            else if (editor.selectedObject instanceof Entity) {
                const entity = editor.selectedObject;
                const p = entity.parallax !== undefined ? entity.parallax : 1.0;

                // @ts-ignore
                const vOx = entity.visualOffset ? entity.visualOffset.x : 0;
                // @ts-ignore
                const vOy = entity.visualOffset ? entity.visualOffset.y : 0;

                if (this.resizingHandle) {
                    // RESIZING
                    // We need World Pos at entity parallax
                    const worldX = (pos.x - halfW) / zoom + camX * p - vOx;
                    const worldY = (pos.y - halfH) / zoom + camY * p - vOy;

                    // Snap to grid?
                    const wx = Math.round(worldX);
                    const wy = Math.round(worldY);

                    // Calc new bounding box based on handle
                    // Top-Left is entity.x - w/2, entity.y - h
                    // Bottom-Right is entity.x + w/2, entity.y

                    let newL = entity.x - entity.width / 2;
                    let newR = entity.x + entity.width / 2;
                    let newT = entity.y - entity.height;
                    let newB = entity.y;

                    if (this.resizingHandle === 'nw') {
                        newL = wx; newT = wy;
                    } else if (this.resizingHandle === 'ne') {
                        newR = wx; newT = wy;
                    } else if (this.resizingHandle === 'sw') {
                        newL = wx; newB = wy;
                    } else if (this.resizingHandle === 'se') {
                        newR = wx; newB = wy;
                    }

                    // Enforce Min Size
                    if (newR - newL < 10) newR = newL + 10;
                    if (newB - newT < 10) newB = newT + 10;

                    const newW = newR - newL;
                    const newH = newB - newT;
                    // Pivot is Bottom Center
                    // X = L + W/2
                    // Y = B
                    entity.width = Math.round(newW);
                    entity.height = Math.round(newH);
                    entity.x = Math.round(newL + newW / 2);
                    entity.y = Math.round(newB);

                    // Recalc Base Dims if scaling enabled
                    if (!entity.ignoreScaling && scene.scaling.enabled) {
                        const factor = scene.getScaling(entity.y) * entity.modelScale;
                        if (factor !== 0) {
                            entity.baseWidth = entity.width / factor;
                            entity.baseHeight = entity.height / factor;
                        }
                    } else if (entity.scale !== 0) {
                        entity.baseWidth = entity.width / entity.scale;
                        entity.baseHeight = entity.height / entity.scale;
                    }

                    editor.ui.updateUIFromObject();

                } else {
                    // MOVING
                    // Screen Space Drag Logic
                    const newScreenX = pos.x - this.dragOffset.x;
                    const newScreenY = pos.y - this.dragOffset.y;

                    // Back to World
                    // ScreenX = (EntityX - CamX*p + vOx) * Zoom + HalfW
                    // EntityX = ((ScreenX - HalfW) / Zoom - vOx) / p + CamX  <-- No.
                    // (ScreenX - HalfW)/Zoom = Ex - CamX*p + vOx
                    // (ScreenX - HalfW)/Zoom - vOx + CamX*p = Ex

                    // Simple:
                    const wx = (newScreenX - halfW) / zoom - vOx + camX * p;
                    const wy = (newScreenY - halfH) / zoom - vOy + camY * p;

                    entity.x = Math.round(wx);
                    entity.y = Math.round(wy);

                    // Update Scaling if Y changed
                    if (!entity.ignoreScaling && scene.scaling.enabled) {
                        const factor = scene.getScaling(entity.y) * entity.modelScale;
                        entity.scale = factor;
                        entity.width = entity.baseWidth * factor;
                        entity.height = entity.baseHeight * factor;
                    }

                    editor.ui.updateUIFromObject();
                }
            }
        }
    }

    onMouseUp(e: MouseEvent): void {
        this.isDragging = false;
        this.draggingVertexIndex = -1;
        this.resizingHandle = null;
        this.isPanning = false;

        const store = useEditorStore.getState();
        if (store.selectedVertexIndex !== -1) {
            store.selectVertex(-1);
        }
    }

    onClick(x: number, y: number): boolean {
        // console.log(`[Editor] onClick: ${x}, ${y}, Enabled: ${this.editor.enabled}, DrawMode: ${this.drawMode} `);
        if (!this.editor.enabled) return false;

        // If in Draw Mode, add points
        if (this.drawMode) {
            // Convert Screen X/Y to World X/Y for storage
            const scene = this.editor.game.sceneManager.currentScene;
            const camX = scene && scene.camera ? scene.camera.x : 0;
            const camY = scene && scene.camera ? scene.camera.y : 0;
            const zoom = scene && scene.camera ? scene.camera.zoom : 1.0;

            const halfW = this.editor.game.canvas.width / 2;
            const halfH = this.editor.game.canvas.height / 2;

            const worldX = (x - halfW) / zoom + camX;
            const worldY = (y - halfH) / zoom + camY;

            if (!this.currentPolygon) this.currentPolygon = [];

            // SNAP LOGIC
            let finalX = Math.round(worldX);
            let finalY = Math.round(worldY);

            if (this.editor.game.input.isDown('Shift') && this.currentPolygon.length > 0) {
                const anchor = this.currentPolygon[this.currentPolygon.length - 1];
                const snapped = this.getSnappedPos({ x: worldX, y: worldY }, anchor);
                finalX = snapped.x;
                finalY = snapped.y;
            }

            this.currentPolygon.push({ x: finalX, y: finalY });
            console.log(`Point Added: ${finalX},${finalY}.Total: ${this.currentPolygon.length} `);
        }

        // ALWAYS consume click if editor is enabled to prevent Game/Player interaction
        return true;
    }

    startCreating(type: string, x?: number, y?: number): void {
        const editor = this.editor;
        if (!editor.game.sceneManager.currentScene) return;

        // NOTE: SceneEditor.startCreating already calls saveUndoState()
        // editor.saveUndoState(); 

        const scene = editor.game.sceneManager.currentScene;

        if (type === 'Static' || type === 'Actor' || type === 'Quad') {
            const nameInput = document.getElementById('new-object-name') as HTMLInputElement;
            let name = nameInput ? nameInput.value : '';

            if (!name) {
                name = type + '_' + Math.floor(Math.random() * 1000);
                if (nameInput) nameInput.value = name;
            }

            let ent: Entity;
            if (type === 'Actor') {
                const data = JSON.parse(JSON.stringify(DefaultActorData));
                data.name = name;
                data.x = x !== undefined ? x : 160;
                data.y = y !== undefined ? y : 100;
                ent = Actor.fromJSON(editor.game, data);
            } else if (type === 'Quad') {
                const data = JSON.parse(JSON.stringify(DefaultQuadData));
                data.name = name;

                if (x !== undefined && y !== undefined) {
                    data.vertices = [
                        { x: x, y: y, p: 1.0 },
                        { x: x + 100, y: y, p: 1.0 },
                        { x: x + 100, y: y + 100, p: 1.0 },
                        { x: x, y: y + 100, p: 1.0 }
                    ];
                    data.x = x + 50;
                    data.y = y + 100;
                } else {
                    data.x = 160;
                    data.y = 100;
                }

                ent = QuadObject.fromJSON(editor.game, data);
            } else {
                const data = JSON.parse(JSON.stringify(DefaultEntityData));
                data.name = name;
                data.x = x !== undefined ? x : 160;
                data.y = y !== undefined ? y : 100;
                ent = Entity.fromJSON(editor.game, data);
            }

            scene.addEntity(ent);
            editor.selectObject(ent);
            this.drawMode = false;
        } else if (type === 'Walkbox') {
            if (!scene.walkbox) scene.walkbox = [];
            const newWalkbox = new Walkbox([], 'Walk_' + Math.floor(Math.random() * 1000));
            scene.walkbox.push(newWalkbox);
            console.log('Walkbox object added to scene (Empty)');
            editor.selectObject(newWalkbox);
            editor.redrawSelected();

        } else if (type === 'Triggerbox') {
            if (!scene.triggerboxes) scene.triggerboxes = [];
            const newTrigger = new Triggerbox([], 'Trig_' + Math.floor(Math.random() * 1000));
            scene.triggerboxes.push(newTrigger);
            console.log('Triggerbox object added to scene (Empty)');
            editor.selectObject(newTrigger);
            editor.redrawSelected();
        }
    }

    finishPolygon(): void {
        console.log('finishPolygon called');
        if (this.currentPolygon && this.currentPolygon.length > 2) {
            // Instead of creating NEW object, assign to SELECTED object
            if (this.editor.selectedObject && (this.editor.selectedObject instanceof Walkbox || this.editor.selectedObject instanceof Triggerbox)) {
                this.editor.selectedObject.poly = [...this.currentPolygon];
                console.log("Polygon updated for " + this.editor.selectedObject.name);
            } else {
                console.warn("No valid object selected for polygon completion!");
            }

            this.currentPolygon = [];
            this.drawMode = false;

            const chk = document.getElementById('chk-draw-mode') as HTMLInputElement;
            if (chk) chk.checked = false;

            useEditorStore.getState().setMode('SELECT');
            this.editor.refreshHierarchy();
        }
    }

    onWheel(e: WheelEvent): void {
        const editor = this.editor;
        if (!editor.enabled) return;
        if (editor.game.isMouseOverUI) return;

        e.preventDefault();

        const scene = editor.game.sceneManager.currentScene;
        if (scene && scene.camera) {
            if (e.deltaY < 0) {
                // Zoom In
                scene.camera.zoom *= 1.1;
                // Clamp max zoom? Optional but good practice.
                if (scene.camera.zoom > 10) scene.camera.zoom = 10;
            } else if (e.deltaY > 0) {
                // Zoom Out
                scene.camera.zoom *= 0.9;
                if (scene.camera.zoom < 0.1) scene.camera.zoom = 0.1;
            }
            // Notify UI if needed (though zoom usually doesn't need immediate inspector update unless we show zoom level)
            // But we might want to refresh if we add a zoom slider later.
        }
    }
}
