import { Entity } from '../entities/Entity';
import { Actor } from '../entities/Actor';
import { SceneObject } from '../entities/SceneObject';
import { Walkbox } from '../entities/Walkbox';
import { Triggerbox } from '../entities/Triggerbox';
import { Geometry } from '../utils/Geometry';
import { Scene } from '../scene/Scene';
import { useEditorStore } from '../store/editorStore';

export class SceneEditor {
    game: any;
    enabled: boolean;
    // State Properties
    currentPolygon: { x: number, y: number }[];
    selectedObject: SceneObject | null;
    isDragging: boolean;
    dragOffset: { x: number, y: number };
    isPanning: boolean;
    lastMousePos: { x: number, y: number };
    lastPanPos: { x: number, y: number };
    creationType: 'Walkbox' | 'Triggerbox' = 'Walkbox';
    draggingVertexIndex: number = -1;
    drawMode: boolean;
    resizingHandle: string | null = null;

    // Callbacks
    // Callbacks
    // Refactored: Use this.game.openFileBrowser instead of local property

    // Event Handlers (Bound)
    private boundKeyHandler: (e: KeyboardEvent) => void;
    private boundMouseDownHandler: (e: MouseEvent) => void;
    private boundMouseMoveHandler: (e: MouseEvent) => void;
    private boundMouseUpHandler: (e: MouseEvent) => void;
    private boundPasteHandler: (e: ClipboardEvent) => void;

    constructor(game: any) {
        this.game = game;
        this.enabled = false;

        this.currentPolygon = [];
        this.selectedObject = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.isPanning = false;
        this.lastMousePos = { x: 0, y: 0 };
        this.lastPanPos = { x: 0, y: 0 };
        this.drawMode = false;

        // Bind handlers once for cleanup

        this.boundKeyHandler = this.handleGlobalKey.bind(this);
        this.boundMouseDownHandler = this.onMouseDown.bind(this);
        this.boundMouseMoveHandler = this.onMouseMove.bind(this);
        this.boundMouseUpHandler = this.onMouseUp.bind(this);
        this.boundPasteHandler = this.handleGlobalPaste.bind(this);
    }

    private uiInitialized = false;

    initUI(): void {
        if (this.uiInitialized) return;

        console.log('[SceneEditor] Initializing UI...');
        // Event delegation or static binding for non-React elements?
        // Note: React manages creation of elements, so we should bind events dynamically or use delegation.
        // However, for input fields, we can bind 'oninput' if we can find them.

        // We will bind 'change' / 'input' events to the document or specific container if possible, 
        // OR we just re-bind them when we find them (e.g. in setupUI, called once).
        // Since React might re-render, binding once in initUI is risky if elements are replaced.
        // But for unchecked inputs (Scene title, etc), they might persist.

        // Let's rely on setupUI to bind what it can find AT THAT MOMENT.
        // Ideally, we'd use event delegation on a static parent.
        this.setupListeners();
        this.setupUI();

        this.uiInitialized = true;
        console.log('[SceneEditor] UI Initialized');
    }



    onAddObjectClick(): void {
        const select = document.getElementById('add-object-type') as HTMLSelectElement;
        const type = select ? select.value : 'Static';
        this.startCreating(type);
    }

    destroy(): void {
        console.log('[SceneEditor] Destroying, removing listeners...');
        document.removeEventListener('keydown', this.boundKeyHandler);

        this.game.canvas.removeEventListener('mousedown', this.boundMouseDownHandler);
        window.removeEventListener('mousemove', this.boundMouseMoveHandler);
        window.removeEventListener('mouseup', this.boundMouseUpHandler);

        this.uiInitialized = false;
    }

    setupListeners(): void {
        // Canvas Interaction Listeners
        this.game.canvas.addEventListener('mousedown', this.boundMouseDownHandler);
        window.addEventListener('mousemove', this.boundMouseMoveHandler);
        window.addEventListener('mouseup', this.boundMouseUpHandler);
        window.addEventListener('paste', this.boundPasteHandler);

        // Global Key Handler (Shortcuts) - Still valid as it targets document body
        document.addEventListener('keydown', this.boundKeyHandler);
    }

    /* Event Handlers extracted for cleanup */

    /* Legacy Event Handlers Removed */

    // Kept for F-Key shortcuts


    /* handleGlobalInput Removed */

    /* handleGlobalChange Removed */

    handleGlobalKey(e: KeyboardEvent): void {
        // High Priority: Ctrl+D for Duplication (Overrides Chrome Bookmark & Input focus)
        if (this.enabled && e.ctrlKey && e.key.toLowerCase() === 'd') {
            e.preventDefault();
            this.duplicateSelectedObject();
            return;
        }

        // Ctrl+C for Copy JSON (Debug)
        if (this.enabled && e.ctrlKey && e.key.toLowerCase() === 'c') {
            // Only prevent default if we have an object selected, 
            // otherwise let normal copy work (e.g. text in inputs)
            if (this.selectedObject && !(document.activeElement instanceof HTMLInputElement)) {
                e.preventDefault();
                this.copySelectedObjectToClipboard();
                return;
            }
        }



        // Allows opening editor with F1 or F5 even if disabled
        if (!this.enabled && e.key !== 'F1' && e.key !== 'F5') return;

        if (e.key === 'F1') {
            e.preventDefault();
            this.toggle();
        } else if (e.key === 'F5') {
            e.preventDefault();
            this.game.spriteEditor.toggle(true);
        } else if (e.key === 'F9') {
            e.preventDefault();
            this.selectObject('SETTINGS');
        } else if (e.key === 'Delete') {
            if (this.selectedObject) {
                this.deleteSelectedObject();
            }
        }

        // Prevent default for F-keys and Editor keys when editor is open
        if (this.enabled) {
            if (['F2', 'F3', 'F4', 'F5', 's', 'a', 'w', 't', '+', '-', '*', '/'].includes(e.key.toLowerCase())) {
                // e.preventDefault(); 
            }
        }

        if (!this.enabled) return;

        // Ignore shortcuts if user is typing in an input
        if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) {
            return;
        }

        switch (e.key.toLowerCase()) {
            case 'f2':
                e.preventDefault();
                if (e.shiftKey) this.saveScene(true); // Save As
                else this.saveScene(false); // Quick Save
                break;
            case 'f3':
                e.preventDefault();
                this.promptLoadScene();
                break;
            case 'f4': e.preventDefault(); this.newScene(); break;
            case 'f5':
                e.preventDefault();
                this.game.spriteEditor.toggle(true);
                break;


            // Creation Hotkeys
            case 's': this.startCreating('Static'); break;
            case 'a': this.startCreating('Actor'); break;
            case 'w': this.startCreating('Walkbox'); break;
            case 't': this.startCreating('Triggerbox'); break;

            // Camera Hotkeys
            case '+': case '=':
                if (this.game.sceneManager.currentScene) this.game.sceneManager.currentScene.camera.zoom *= 1.1;
                break;
            case '-':
                if (this.game.sceneManager.currentScene) this.game.sceneManager.currentScene.camera.zoom *= 0.9;
                break;
            case '*':
                // Reset Camera Position
                if (this.game.sceneManager.currentScene) {
                    const s = this.game.sceneManager.currentScene;
                    if (s.player) {
                        s.camera.x = s.player.x - 320;
                        s.camera.y = s.player.y - 200;
                    } else {
                        s.camera.x = 0; s.camera.y = 0;
                    }
                }
                break;
            case '/':
                // Reset Zoom
                if (this.game.sceneManager.currentScene) this.game.sceneManager.currentScene.camera.zoom = 1.0;
                break;

            case 'enter':
                if (!e.ctrlKey) this.finishPolygon();
                break;

            case 'escape':
                this.drawMode = false;
                this.currentPolygon = [];
                const c = document.getElementById('chk-draw-mode') as HTMLInputElement;
                if (c) c.checked = false;
                console.log("[Editor] Draw Mode Cancelled");
                break;
        }
    }

    startCreating(type: string): void {
        if (!this.game.sceneManager.currentScene) return;
        const scene = this.game.sceneManager.currentScene;

        if (type === 'Static' || type === 'Actor') {
            const nameInput = document.getElementById('new-object-name') as HTMLInputElement;
            let name = nameInput ? nameInput.value : '';

            if (!name) {
                name = type + '_' + Math.floor(Math.random() * 1000);
                if (nameInput) nameInput.value = name; // Feedback to user
            }

            let ent: Entity;
            if (type === 'Actor') {
                ent = new Actor(160, 100, 30, 30, name);
                ent.color = '#0000ff';
            } else {
                ent = new Entity(160, 100, 30, 30, name);
                ent.color = '#00ff00';
            }

            scene.addEntity(ent);
            this.selectObject(ent);
            this.drawMode = false;
        } else if (type === 'Walkbox') {
            this.creationType = 'Walkbox';
            this.currentPolygon = []; // Reset any previous partial polygon
            this.drawMode = true;
            const chk = document.getElementById('chk-draw-mode') as HTMLInputElement;
            if (chk) chk.checked = true;
            this.selectObject(null);
            console.log("Draw Mode: Walkbox");
            useEditorStore.getState().setMode('DRAW_WALKBOX');
        } else if (type === 'Triggerbox') {
            this.creationType = 'Triggerbox';
            this.currentPolygon = [];
            this.drawMode = true;
            console.log("Draw Mode: Triggerbox");
            this.selectObject(null);
            useEditorStore.getState().setMode('DRAW_TRIGGER');
        }
    }

    setupUI(): void {
        console.log('[SceneEditor] Setting up UI Listeners (Delegation)');
        // All event listeners are now handled by the bound handlers in setupListeners()
        // This method remains for any initial UI setup that isn't event binding.
    }

    setScalingEnabled(isEnabled: boolean): void {
        const scene = this.game.sceneManager.currentScene;
        if (!scene) return;

        const s = scene.scaling;
        const wasEnabled = s.enabled;

        // Start Logic
        s.enabled = isEnabled;

        // Normalization Logic on Toggle
        if (wasEnabled !== isEnabled) {
            console.log(`[Editor] Scaling Toggled: ${wasEnabled} -> ${isEnabled}. Normalizing entities...`);
            const entities = scene.entities;
            for (const ent of entities) {
                if (ent.ignoreScaling) continue;

                const currentVisW = ent.width;
                const currentVisH = ent.height;

                if (isEnabled) {
                    // Turning ON: Scale = Model * Depth
                    const depthFactor = scene.getScaling(ent.y);
                    const totalScale = ent.modelScale * depthFactor;
                    ent.scale = totalScale;

                    if (totalScale !== 0) {
                        ent.baseWidth = currentVisW / totalScale;
                        ent.baseHeight = currentVisH / totalScale;
                    }
                } else {
                    // Turning OFF: Scale = Model * 1.0
                    const totalScale = ent.modelScale;
                    ent.scale = totalScale;

                    if (totalScale !== 0) {
                        ent.baseWidth = currentVisW / totalScale;
                        ent.baseHeight = currentVisH / totalScale;
                    } else {
                        ent.baseWidth = currentVisW; // Fallback
                        ent.baseHeight = currentVisH;
                    }

                    ent.width = currentVisW;
                    ent.height = currentVisH;
                }
            }
            // Refresh properties panel calls if needed (Store update handles it via objectVersion usually, 
            // but we might want to trigger a hierarchy/object version bump since ALL entities changed)
            useEditorStore.getState().incrementObjectVersion();
            useEditorStore.getState().incrementHierarchyVersion();
        }
    }

    toggle(): void {
        this.enabled = !this.enabled;

        const parserInput = document.getElementById('parser-input') as HTMLInputElement;
        const editorWrapper = document.getElementById('editor-wrapper');

        if (this.enabled) {
            if (editorWrapper) editorWrapper.classList.remove('hidden');
            this.syncUI();
            this.refreshHierarchy();
            this.selectObject('SCENE');

            // Block Parser
            if (parserInput) {
                parserInput.blur();
                parserInput.disabled = true;
            }
        } else {
            if (editorWrapper) editorWrapper.classList.add('hidden');
            // Restore Parser
            if (parserInput) {
                parserInput.disabled = false;
                parserInput.focus();
            }
        }
        // Update Store
        useEditorStore.getState().toggle(this.enabled);
    }

    syncUI(): void {
        const scene = this.game.sceneManager.currentScene;
        if (scene) {
            const titleInput = document.getElementById('editor-scene-title') as HTMLInputElement;
            if (titleInput) titleInput.value = scene.name;

            const idInput = document.getElementById('editor-scene-id') as HTMLInputElement;
            if (idInput) idInput.value = scene.filename || '';

            useEditorStore.getState().setSceneInfo(scene.name, scene.filename || '');

            // Sync Scaling
            const scaleEnabled = document.getElementById('scale-enabled') as HTMLInputElement;
            const scaleMin = document.getElementById('scale-min') as HTMLInputElement;
            const scaleMax = document.getElementById('scale-max') as HTMLInputElement;
            const scaleHorizon = document.getElementById('scale-horizon') as HTMLInputElement;
            const scaleFront = document.getElementById('scale-front') as HTMLInputElement;

            if (scene.scaling && scaleEnabled) {
                scaleEnabled.checked = scene.scaling.enabled;
                if (scaleMin) scaleMin.value = scene.scaling.min.toString();
                if (scaleMax) scaleMax.value = scene.scaling.max.toString();
                if (scaleHorizon) scaleHorizon.value = scene.scaling.horizon.toString();
                if (scaleFront) scaleFront.value = scene.scaling.front.toString();
            }

            // Sync to Store
            useEditorStore.getState().setSceneInfo(scene.name, scene.filename || '');
        }
    }


    getMousePos(e: MouseEvent): { x: number, y: number } {
        const rect = this.game.canvas.getBoundingClientRect();
        const scaleX = this.game.canvas.width / rect.width;
        const scaleY = this.game.canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    onMouseDown(e: MouseEvent): void {
        console.log(`[Editor] onMouseDown. Enabled: ${this.enabled}, DrawMode: ${this.drawMode}`);
        if (!this.enabled) return;

        // Right Click Panning
        if (e.button === 2) {
            console.log("[Editor] Start Panning");
            this.isPanning = true;
            this.lastPanPos = { x: e.clientX, y: e.clientY };

            // Disable Auto-Center automatically
            if (this.game.sceneManager.currentScene) {
                this.game.sceneManager.currentScene.autoCenter = false;
                const chk = document.getElementById('cam-auto-center') as HTMLInputElement;
                if (chk) chk.checked = false;
            }
            e.preventDefault();
            return;
        }

        if (this.drawMode) return;

        const pos = this.getMousePos(e); // Screen Coords
        console.log(`[Editor] MousePos: ${pos.x}, ${pos.y}`);
        const scene = this.game.sceneManager.currentScene;

        if (scene) {
            const camX = scene.camera ? scene.camera.x : 0;
            const camY = scene.camera ? scene.camera.y : 0;
            const zoom = scene.camera ? scene.camera.zoom : 1.0;

            const halfW = this.game.canvas.width / 2;
            const halfH = this.game.canvas.height / 2;

            // 0. CHECK SELECTED POLYGON VERTICES (High Priority)
            if (this.selectedObject && (this.selectedObject instanceof Walkbox || this.selectedObject instanceof Triggerbox)) {
                // Center-Based: World = (Screen - Center) / Zoom + Camera
                const worldPos = {
                    x: (pos.x - halfW) / zoom + camX,
                    y: (pos.y - halfH) / zoom + camY
                };
                const poly = this.selectedObject.poly;
                const vertexRadius = 6 / zoom; // Hit radius

                // Check vertices
                for (let i = 0; i < poly.length; i++) {
                    const vx = poly[i].x;
                    const vy = poly[i].y;
                    if (Math.abs(worldPos.x - vx) < vertexRadius && Math.abs(worldPos.y - vy) < vertexRadius) {
                        this.isDragging = true;
                        this.draggingVertexIndex = i;
                        e.stopPropagation();
                        return;
                    }
                }

                // Check Polygon Body
                if (Geometry.isPointInPolygon(worldPos, poly)) {
                    this.isDragging = true;
                    this.draggingVertexIndex = -1; // Drag Whole Body
                    this.dragOffset = { x: worldPos.x, y: worldPos.y };
                    e.stopPropagation();
                    return;
                }
            }


            // 1. Check Entities
            const entities = scene.entities;
            // Iterate reverse to select top-most
            for (let i = entities.length - 1; i >= 0; i--) {
                const entity = entities[i];
                const p = entity.parallax !== undefined ? entity.parallax : 1.0;

                // Entity Screen Rect (With Zoom and Center Pivot)
                // Render Logic:
                // ctx.translate(halfW, halfH);
                // ctx.scale(zoom, zoom);
                // ctx.translate(-camX * p, -camY * p);
                // Entity draws at x, y

                // So ScreenX = (EntityX - CamX*p) * Zoom + HalfW
                const screenX = (entity.x - camX * p) * zoom + halfW;
                const screenY = (entity.y - camY * p) * zoom + halfH;

                const screenW = entity.width * zoom;
                const screenH = entity.height * zoom;

                // Entity pivot is Bottom-Center. 
                // Rect: Left = screenX - W/2, Top = screenY - H
                // (Note: in Render we do ctx.strokeRect(entity.x - w/2...))

                if (pos.x >= screenX - screenW / 2 && pos.x <= screenX + screenW / 2 &&
                    pos.y >= screenY - screenH && pos.y <= screenY) {

                    // HIT! Entity: ${entity.name}
                    this.selectObject(entity);

                    // Check Handles logic ( Screen Space )
                    const hSize = 8; // Screen pixels tolerance
                    const sl = screenX - screenW / 2;
                    const sr = screenX + screenW / 2;
                    const st = screenY - screenH;
                    const sb = screenY;

                    if (Math.abs(pos.x - sl) < hSize && Math.abs(pos.y - st) < hSize) this.resizingHandle = 'nw';
                    else if (Math.abs(pos.x - sr) < hSize && Math.abs(pos.y - st) < hSize) this.resizingHandle = 'ne';
                    else if (Math.abs(pos.x - sl) < hSize && Math.abs(pos.y - sb) < hSize) this.resizingHandle = 'sw';
                    else if (Math.abs(pos.x - sr) < hSize && Math.abs(pos.y - sb) < hSize) this.resizingHandle = 'se';
                    else this.resizingHandle = null;

                    this.isDragging = true;
                    this.draggingVertexIndex = -1;

                    // Offset in Screen Space is easiest for Entities??
                    // Or maintain World Offset?
                    // Let's use Screen Offset to avoid complex reverse-projections during drag
                    this.dragOffset = { x: pos.x - screenX, y: pos.y - screenY };
                    e.stopPropagation();
                    return;
                }
            }

            // 2. Check Walkboxes (World Space, Parallax 1.0)
            const worldPos = {
                x: (pos.x - halfW) / zoom + camX,
                y: (pos.y - halfH) / zoom + camY
            };

            if (scene.walkbox) {
                for (const wb of scene.walkbox) {
                    if (Geometry.isPointInPolygon(worldPos, wb.poly)) {
                        this.selectObject(wb);
                        this.isDragging = true;
                        this.draggingVertexIndex = -1;
                        this.dragOffset = { x: worldPos.x, y: worldPos.y };
                        e.stopPropagation();
                        return;
                    }
                }
            }

            // 3. Check Triggerboxes
            if (scene.triggerboxes) {
                for (const tb of scene.triggerboxes) {
                    if (Geometry.isPointInPolygon(worldPos, tb.poly)) {
                        this.selectObject(tb);
                        this.isDragging = true;
                        this.draggingVertexIndex = -1;
                        this.dragOffset = { x: worldPos.x, y: worldPos.y };
                        e.stopPropagation();
                        return;
                    }
                }
            }
        }

        this.selectObject(null);
    }


    onMouseMove(e: MouseEvent): void {
        this.lastMousePos = this.getMousePos(e); // Track for Paste

        if (!this.enabled) return;

        // PANNING LOGIC
        if (this.isPanning && this.game.sceneManager.currentScene) {
            const dx = e.clientX - this.lastPanPos.x;
            const dy = e.clientY - this.lastPanPos.y;
            this.lastPanPos = { x: e.clientX, y: e.clientY };

            const s = this.game.sceneManager.currentScene;
            // Move camera opposite to mouse drag
            // Adjust for Zoom? Panning 10 screen pixels should move 10 screen pixels worth of world.
            // WorldDelta = ScreenDelta / Zoom.
            s.camera.x -= dx / s.camera.zoom;
            s.camera.y -= dy / s.camera.zoom;

            // Update UI
            const cx = document.getElementById('cam-x') as HTMLInputElement;
            const cy = document.getElementById('cam-y') as HTMLInputElement;
            if (cx) cx.value = Math.round(s.camera.x).toString();
            if (cy) cy.value = Math.round(s.camera.y).toString();
            return;
        }

        if (!this.isDragging || !this.selectedObject) return;

        const pos = this.getMousePos(e);
        const scene = this.game.sceneManager.currentScene;
        const camX = scene && scene.camera ? scene.camera.x : 0;
        const camY = scene && scene.camera ? scene.camera.y : 0;
        const zoom = scene && scene.camera ? scene.camera.zoom : 1.0;

        const halfW = this.game.canvas.width / 2;
        const halfH = this.game.canvas.height / 2;

        // Polygon Dragging (Walkbox/Triggerbox)
        if (this.selectedObject instanceof Walkbox || this.selectedObject instanceof Triggerbox) {
            const worldPos = {
                x: (pos.x - halfW) / zoom + camX,
                y: (pos.y - halfH) / zoom + camY
            };

            const poly = this.selectedObject.poly;

            if (this.draggingVertexIndex >= 0) {
                // Drag Vertex
                poly[this.draggingVertexIndex].x = Math.round(worldPos.x);
                poly[this.draggingVertexIndex].y = Math.round(worldPos.y);
            } else {
                // Drag Whole Body
                const dx = worldPos.x - this.dragOffset.x;
                const dy = worldPos.y - this.dragOffset.y;

                if (dx !== 0 || dy !== 0) {
                    for (const pt of poly) {
                        pt.x += dx;
                        pt.y += dy;
                    }
                    this.dragOffset = { x: worldPos.x, y: worldPos.y };
                }
            }
            return;
        }
        if (!(this.selectedObject instanceof Entity)) return;
        const entity = this.selectedObject as Entity;
        const p = entity.parallax !== undefined ? entity.parallax : 1.0;

        // ** ENTITY RESIZING LOGIC **
        if (this.resizingHandle) {
            // 1. Calculate Mouse World Position (at entity depth p)
            // WorldX = ((ScreenX - HalfW) / Zoom) + CamX * p
            const mouseWorldX = (pos.x - halfW) / zoom + camX * p;
            const mouseWorldY = (pos.y - halfH) / zoom + camY * p;

            // Current Edges
            const currentL = entity.x - entity.width / 2;
            const currentR = entity.x + entity.width / 2;
            const currentT = entity.y - entity.height;
            const currentB = entity.y;

            let newL = currentL;
            let newR = currentR;
            let newT = currentT;
            let newB = currentB;

            // Assume symmetric width resizing if dragging corners?
            // Actually, standard behavior is opposite corner fixed.

            if (this.resizingHandle === 'nw') {
                // Fixed: Bottom-Right
                newL = mouseWorldX;
                newT = mouseWorldY;
            } else if (this.resizingHandle === 'ne') {
                // Fixed: Bottom-Left
                newR = mouseWorldX;
                newT = mouseWorldY;
            } else if (this.resizingHandle === 'sw') {
                // Fixed: Top-Right
                newL = mouseWorldX;
                newB = mouseWorldY;
            } else if (this.resizingHandle === 'se') {
                // Fixed: Top-Left
                newR = mouseWorldX;
                newB = mouseWorldY;
            }

            // Enforce Min Size
            if (newR - newL < 5) {
                if (this.resizingHandle.includes('w')) newL = newR - 5;
                else newR = newL + 5;
            }
            if (newB - newT < 5) {
                if (this.resizingHandle.includes('n')) newT = newB - 5;
                else newB = newT + 5;
            }

            // Apply new dimensions
            const newW = newR - newL;
            const newH = newB - newT;
            const newX = newL + newW / 2; // Center
            const newY = newB; // Bottom

            // Update Visuals
            entity.x = Math.round(newX);
            entity.y = Math.round(newY);
            entity.width = newW;
            entity.height = newH;

            // Update Base Dimensions so this persists across scales
            // base = visual / scale. Scale is current (model * depth).
            if (entity.scale !== 0) {
                entity.baseWidth = entity.width / entity.scale;
                entity.baseHeight = entity.height / entity.scale;
            } else {
                entity.baseWidth = entity.width;
                entity.baseHeight = entity.height;
            }

            this.updateUIFromObject();
            return;
        }

        // Entity Drag Logic (Standard Move)

        // We stored dragOffset as (MouseScreen - EntityScreenCenter)
        // NewScreenX = MouseX - OffsetX
        // NewScreenY = MouseY - OffsetY

        const targetScreenX = pos.x - this.dragOffset.x;
        const targetScreenY = pos.y - this.dragOffset.y;

        // Reverse Project to World:
        // ScreenX = (WorldX - CamX*p) * Zoom + HalfW
        // WorldX = (ScreenX - HalfW) / Zoom + CamX*p   <-- Wait, +CamX*p?
        // (WorldX - CamX*p) = (ScreenX - HalfW) / Zoom
        // WorldX = ((ScreenX - HalfW) / Zoom) + CamX*p

        const unzoomedX = (targetScreenX - halfW) / zoom;
        const unzoomedY = (targetScreenY - halfH) / zoom;

        entity.x = Math.round(unzoomedX + camX * p);
        entity.y = Math.round(unzoomedY + camY * p);

        this.updateUIFromObject();
    }

    onMouseUp(): void {
        this.isDragging = false;
        this.resizingHandle = null;
        this.isPanning = false;
    }

    selectObject(obj: any): void {
        this.selectedObject = obj;

        // Sync to Store
        let type: string | null = null;
        let id: string | null = null;

        if (obj === 'SCENE') {
            type = 'SCENE';
            id = 'SCENE';
        } else if (obj === 'SETTINGS') {
            type = 'SETTINGS';
            id = 'SETTINGS';
        } else if (obj instanceof Entity) {
            type = 'Entity';
            id = obj.name;
        } else if (obj instanceof Walkbox) {
            type = 'Walkbox';
            id = obj.name || 'Walkbox';
        } else if (obj instanceof Triggerbox) {
            type = 'Triggerbox';
            id = obj.name || 'Triggerbox';
        }
        useEditorStore.getState().selectObject(id, type);

        const sectionSceneProps = document.getElementById('section-scene-props');
        const sectionEntityProps = document.getElementById('section-entity-props');
        const sectionWalkboxProps = document.getElementById('section-walkbox-props');
        const sectionSettingsProps = document.getElementById('section-settings');
        const propActorGroup = document.getElementById('prop-actor-group');

        // Reset all to hidden first
        if (sectionSceneProps) sectionSceneProps.classList.add('hidden');
        if (sectionEntityProps) sectionEntityProps.classList.add('hidden');
        if (sectionWalkboxProps) sectionWalkboxProps.classList.add('hidden');
        if (sectionSettingsProps) sectionSettingsProps.classList.add('hidden');

        // Visibility Toggles
        if ((this.selectedObject as any) === 'SCENE') {
            if (sectionSceneProps) sectionSceneProps.classList.remove('hidden');
            this.syncUI();
        } else if ((this.selectedObject as any) === 'SETTINGS') {
            if (sectionSettingsProps) sectionSettingsProps.classList.remove('hidden');
            this.syncSettingsUI();
        } else if (obj instanceof SceneObject) {
            // Unified Logic for all SceneObjects
            if (obj instanceof Entity) {
                // Entity Specifics
                if (sectionEntityProps) sectionEntityProps.classList.remove('hidden');

                if (propActorGroup) {
                    if (obj instanceof Actor) {
                        propActorGroup.classList.remove('hidden');
                    } else {
                        propActorGroup.classList.add('hidden');
                    }
                }
            } else if (obj instanceof Walkbox || obj instanceof Triggerbox) {
                // Walkbox/Triggerbox
                if (sectionWalkboxProps) sectionWalkboxProps.classList.remove('hidden');
            }

            this.updateUIFromObject();
        }

        this.refreshHierarchy();
    }

    syncSettingsUI(): void {
        const s = this.game.settings.crt;

        const enabled = document.getElementById('crt-enabled') as HTMLInputElement;
        const curve = document.getElementById('crt-curvature') as HTMLInputElement;
        const scan = document.getElementById('crt-scanlines') as HTMLInputElement;
        const inten = document.getElementById('crt-intensity') as HTMLInputElement;
        const abr = document.getElementById('crt-aberration') as HTMLInputElement;
        const vig = document.getElementById('crt-vignette') as HTMLInputElement;
        const phos = document.getElementById('crt-phosphor') as HTMLInputElement;
        const bloom = document.getElementById('crt-bloom') as HTMLInputElement;

        if (enabled) enabled.checked = s.enabled;
        if (curve) curve.value = s.curvature.toString();
        if (scan) scan.value = s.scanlineCount.toString();
        if (inten) inten.value = s.scanlineIntensity.toString();
        if (abr) abr.value = s.aberration.toString();
        if (vig) vig.value = s.vignette.toString();
        if (phos) phos.value = (s.phosphor || 0).toString();
        if (bloom) bloom.value = (s.bloom || 0).toString();
    }


    newScene(): void {
        const newScene = new Scene('new_scene', 'New Scene');
        // Add default scale
        newScene.scaling.enabled = true;
        this.game.sceneManager.addScene(newScene);
        this.game.sceneManager.switchTo(newScene.id);
        this.syncUI();
        this.refreshHierarchy();
        this.selectObject('SCENE');
        console.log('New Scene Created');
    }

    refreshHierarchy(): void {
        // Sync to Store
        useEditorStore.getState().incrementHierarchyVersion();

        // Sync static Scene Item selection state
        const scenePropertiesItem = document.getElementById('scene-properties-item');
        if (scenePropertiesItem) {
            if ((this.selectedObject as any) === 'SCENE') {
                scenePropertiesItem.classList.add('selected');
            } else {
                scenePropertiesItem.classList.remove('selected');
            }
        }

        const entityList = document.getElementById('entity-list');
        if (entityList) {
            entityList.innerHTML = '';
            const scene = this.game.sceneManager.currentScene;
            if (scene) {
                // Entities
                scene.entities.forEach((entity: Entity) => {
                    const div = document.createElement('div');
                    div.className = 'entity-item';

                    // Determine Type Char
                    let typeChar = 'S'; // Static
                    const isActor = entity instanceof Actor;
                    // @ts-ignore
                    const typeProp = entity.type;

                    if (isActor || typeProp === 'Actor') typeChar = 'A';

                    // [T] Name
                    div.innerText = `${typeChar}:${entity.name}`;

                    div.onclick = () => {
                        this.selectObject(entity);
                    };
                    if (this.selectedObject === entity) {
                        div.classList.add('selected');
                    }
                    entityList.appendChild(div);
                });

                // Walkboxes
                if (scene.walkbox) {
                    scene.walkbox.forEach((wb: any, i: number) => {
                        const div = document.createElement('div');
                        div.className = 'entity-item';
                        div.innerText = `W:${wb.name || 'Walkbox ' + i}`;
                        div.onclick = () => {
                            this.selectObject(wb);
                        };
                        if (this.selectedObject === wb) {
                            div.classList.add('selected');
                        }
                        entityList.appendChild(div);
                    });
                }

                // Triggerboxes
                if (scene.triggerboxes) {
                    scene.triggerboxes.forEach((trigger: any) => {
                        const div = document.createElement('div');
                        div.className = 'entity-item';
                        div.innerText = `T:${trigger.name || 'Trigger'}`;
                        div.onclick = () => {
                            this.selectObject(trigger);
                        };
                        if (this.selectedObject === trigger) {
                            div.classList.add('selected');
                        }
                        entityList.appendChild(div);
                    });
                }
            }
        }
    }



    updateUIFromObject(): void {
        const scenePropertiesItem = document.getElementById('scene-properties-item');
        if (scenePropertiesItem) {
            if ((this.selectedObject as any) === 'SCENE') {
                scenePropertiesItem.classList.add('selected');
            } else {
                scenePropertiesItem.classList.remove('selected');
            }
        }

        if (!this.selectedObject || typeof this.selectedObject === 'string') return;

        // Update Type Display
        const typeDisplay = document.getElementById('selected-entity-name');
        if (typeDisplay) {
            let typeStr = 'Object';
            if (this.selectedObject instanceof Actor) typeStr = 'Actor';
            else if (this.selectedObject instanceof Entity) typeStr = 'Static';
            else if (this.selectedObject instanceof Walkbox) typeStr = 'Walkbox';
            else if (this.selectedObject instanceof Triggerbox) typeStr = 'Triggerbox';
            typeDisplay.textContent = typeDisplay.textContent?.split(':')[0] ? typeStr : typeStr; // Preserve existing styling if any
            typeDisplay.textContent = typeStr;
        }

        const propName = document.getElementById('prop-name') as HTMLInputElement;

        // Universal Name Binding
        if (propName) propName.value = this.selectedObject.name || '';

        // Entity Specifics
        if (this.selectedObject instanceof Entity) {
            const ent = this.selectedObject as Entity;
            const propImage = document.getElementById('prop-image') as HTMLInputElement;
            const propX = document.getElementById('prop-x') as HTMLInputElement;
            const propY = document.getElementById('prop-y') as HTMLInputElement;
            const propWidth = document.getElementById('prop-width') as HTMLInputElement;
            const propHeight = document.getElementById('prop-height') as HTMLInputElement;
            const propScale = document.getElementById('prop-scale') as HTMLInputElement;
            const propLayer = document.getElementById('prop-layer') as HTMLInputElement;
            const propDirection = document.getElementById('prop-direction') as HTMLSelectElement;
            const propState = document.getElementById('prop-state') as HTMLInputElement;
            const propNoScale = document.getElementById('prop-no-scaling') as HTMLInputElement;
            const propParallax = document.getElementById('prop-parallax') as HTMLInputElement;

            if (propImage) propImage.value = ent.spriteName || '';
            if (propX) propX.value = ent.x.toString();
            if (propY) propY.value = ent.y.toString();
            if (propWidth) propWidth.value = ent.width.toString();
            if (propHeight) propHeight.value = ent.height.toString();
            if (propScale) propScale.value = (ent.modelScale || 1.0).toString();
            if (propLayer) propLayer.value = (ent.layer || 0).toString();
            if (propParallax) propParallax.value = (ent.parallax !== undefined ? ent.parallax : 1.0).toString();
            if (propNoScale) propNoScale.checked = ent.ignoreScaling || false;

            if (ent instanceof Actor) {
                if (propDirection) propDirection.value = ent.direction || 'down';
                if (propState) propState.value = ent.state || 'idle';

                const propActorSpeed = document.getElementById('prop-actor-speed') as HTMLInputElement;
                if (propActorSpeed) propActorSpeed.value = ent.speed.toString();

                const propActorIsPlayer = document.getElementById('prop-actor-isplayer') as HTMLInputElement;
                if (propActorIsPlayer) propActorIsPlayer.checked = ent.isPlayer;
            }
        } else if (this.selectedObject instanceof Walkbox || this.selectedObject instanceof Triggerbox) {
            const propWalkboxName = document.getElementById('prop-walkbox-name') as HTMLInputElement;
            if (propWalkboxName) {
                propWalkboxName.value = this.selectedObject.name;
                propWalkboxName.oninput = () => {
                    if (this.selectedObject) {
                        this.selectedObject.name = propWalkboxName.value;
                        this.refreshHierarchy();
                    }
                };
            }
        }
    }

    updateEntityFromUI(triggerId?: string): void {
        if (!this.selectedObject || !(this.selectedObject instanceof Entity)) return;
        const ent = this.selectedObject as Entity;

        const propName = document.getElementById('prop-name') as HTMLInputElement;
        const propX = document.getElementById('prop-x') as HTMLInputElement;
        const propY = document.getElementById('prop-y') as HTMLInputElement;
        const propWidth = document.getElementById('prop-width') as HTMLInputElement;
        const propHeight = document.getElementById('prop-height') as HTMLInputElement;
        const propScale = document.getElementById('prop-scale') as HTMLInputElement;
        const propLayer = document.getElementById('prop-layer') as HTMLInputElement;
        const propDirection = document.getElementById('prop-direction') as HTMLSelectElement;
        const propState = document.getElementById('prop-state') as HTMLInputElement;
        const propNoScale = document.getElementById('prop-no-scaling') as HTMLInputElement;
        const propParallax = document.getElementById('prop-parallax') as HTMLInputElement;

        if (propName) ent.name = propName.value || 'Unnamed';
        if (propX) ent.x = parseInt(propX.value) || 0;
        if (propY) ent.y = parseInt(propY.value) || 0;

        // SCALE & DIMENSIONS LOGIC
        // Case 1: Model Scale changed (multiplier for depth scaling)
        if (triggerId === 'prop-scale') {
            const newModelScale = parseFloat(propScale.value) || 1.0;
            ent.modelScale = newModelScale;

            // Note: final 'ent.scale' will be updated in next game loop tick based on depth.
            // But we can estimate it here for immediate visual feedback if we wanted, 
            // though it's safer to let the loop handle it to avoid drift.

            // However, we DO need to update the visual width/height in UI immediately to reflect the change?
            // Actually, if we change modelScale, the size on screen changes.
            // Let's force an update tick or manually calc:
            let depthFactor = 1.0;
            if (!ent.ignoreScaling) {
                // We can't easily access Scene.getScaling here without referencing scene
                // But we can trust the loop or just update the UI values on next frame.
                // For immediate feedback, let's try to grab current depth scale if possible.
                if (this.game.sceneManager.currentScene && this.game.sceneManager.currentScene.scaling.enabled) {
                    depthFactor = this.game.sceneManager.currentScene.getScaling(ent.y);
                }
            }

            ent.scale = ent.modelScale * depthFactor;
            ent.width = ent.baseWidth * ent.scale;
            ent.height = ent.baseHeight * ent.scale;

            // Sync UI Dims
            if (propWidth) propWidth.value = Math.round(ent.width).toString();
            if (propHeight) propHeight.value = Math.round(ent.height).toString();

        } else {
            // Case 2: Visual Width/Height changed.
            // We want to force the visual size to match input.
            // width = baseWidth * (modelScale * depthFactor)
            // so baseWidth = width / (modelScale * depthFactor) => width / ent.scale

            if (propWidth) {
                const requestedLocalW = parseInt(propWidth.value) || 1;
                ent.width = requestedLocalW;
                ent.baseWidth = (ent.scale !== 0) ? ent.width / ent.scale : ent.width;
            }
            if (propHeight) {
                const requestedLocalH = parseInt(propHeight.value) || 1;
                ent.height = requestedLocalH;
                ent.baseHeight = (ent.scale !== 0) ? ent.height / ent.scale : ent.height;
            }

            // In this case, ModelScale likely remains unchanged, we are changing the base sprite size/box size.
            // Ensure UI shows current Model Scale
            if (propScale) propScale.value = ent.modelScale.toString();
        }


        if (propLayer) ent.layer = parseInt(propLayer.value) || 0;
        // Allow parallax to be 0
        if (propParallax) {
            const val = parseFloat(propParallax.value);
            const newVal = isNaN(val) ? 1.0 : val;

            // Auto-adjust coordinates to keep object visually stationary if Parallax changed
            if (ent.parallax !== undefined && ent.parallax !== newVal) {
                const scene = this.game.sceneManager.currentScene;
                if (scene) {
                    const camX = scene.camera.x;
                    const camY = scene.camera.y;

                    const oldP = ent.parallax;
                    const dx = camX * (newVal - oldP);
                    const dy = camY * (newVal - oldP);

                    ent.x = Math.round(ent.x + dx);
                    ent.y = Math.round(ent.y + dy);

                    // Update UI inputs
                    if (propX) propX.value = ent.x.toString();
                    if (propY) propY.value = ent.y.toString();
                }
            }
            ent.parallax = newVal;
        }
        if (propNoScale) {
            const wasIgnored = ent.ignoreScaling;
            const isIgnored = propNoScale.checked;

            if (wasIgnored !== isIgnored) {
                // Toggle happened. We need to normalize dimensions to keep VISUAL size constant.
                // Current Visual Size is ent.width / ent.height (already up to date)
                const currentVisW = ent.width;
                const currentVisH = ent.height;

                // Calculate Target Factor
                let targetFactor = ent.modelScale; // If ignored, scale = modelScale

                if (!isIgnored) {
                    // We are ENABLING depth scaling.
                    // Scale will become: modelScale * depthFactor
                    let depthFactor = 1.0;
                    if (this.game.sceneManager.currentScene && this.game.sceneManager.currentScene.scaling.enabled) {
                        depthFactor = this.game.sceneManager.currentScene.getScaling(ent.y);
                    }
                    targetFactor = ent.modelScale * depthFactor;
                }

                // Recalculate Base Dimensions
                // Visual = Base * Factor
                // Base = Visual / Factor
                if (targetFactor !== 0) {
                    ent.baseWidth = currentVisW / targetFactor;
                    ent.baseHeight = currentVisH / targetFactor;
                } else {
                    ent.baseWidth = currentVisW;
                    ent.baseHeight = currentVisH;
                }

                // Apply new state
                ent.ignoreScaling = isIgnored;

                // Force immediate update of 'scale' prop so next render is correct right away
                ent.scale = targetFactor;
                // ent.width/height is technically derived, should match currentVisW/H exactly roughly
            }
        }

        if (ent instanceof Actor) {
            if (propDirection) ent.setDirection(propDirection.value as any);
            if (propState) ent.setState(propState.value as any);
            const propActorSpeed = document.getElementById('prop-actor-speed') as HTMLInputElement;
            if (propActorSpeed) ent.speed = parseFloat(propActorSpeed.value) || 0.1;
        }



        this.refreshHierarchy();
    }

    duplicateSelectedObject(): void {
        const scene = this.game.sceneManager.currentScene;
        if (!scene || !this.selectedObject) return;

        let data: any;
        if (this.selectedObject.toJSON) {
            data = this.selectedObject.toJSON();
        } else {
            return;
        }

        // Generate Unique Name for Duplicate
        const baseName = data.name;
        // Strip _\d+ suffix
        const match = baseName.match(/^(.*?)_\d+$/);
        const prefix = match ? match[1] : baseName;

        let counter = 1;
        let newName = `${prefix}_${counter}`;

        // Check collision in entire scene
        // We can reuse a helper or just do it here
        const allObjects = [
            ...(scene.entities || []),
            ...(scene.walkbox || []),
            ...(scene.triggerboxes || [])
        ];
        const isNameTaken = (n: string) => allObjects.some((o: any) => o.name === n);
        while (isNameTaken(newName)) {
            counter++;
            newName = `${prefix}_${counter}`;
        }
        data.name = newName;

        // Use unified creation
        const newObj = this.createObjectFromData(data);
        if (newObj) {
            console.log(`Duplicated: ${baseName} -> ${newName}`);
            this.selectObject(newObj);
            this.refreshHierarchy();
        }
    }


    setActorIsPlayer(actor: Actor, value: boolean): void {
        const scene = this.game.sceneManager.currentScene;
        if (!scene) return;

        console.log(`[Editor] Setting isPlayer for ${actor.name} to ${value}`);

        if (value) {
            // Unset others
            scene.entities.forEach((e: Entity) => {
                if (e instanceof Actor && e !== actor && e.isPlayer) {
                    e.isPlayer = false;
                    console.log(`[Editor] Unset isPlayer for ${e.name}`);
                }
            });
            actor.isPlayer = true;
            scene.player = actor;
        } else {
            actor.isPlayer = false;
            // If we are unchecking the current player, clear the reference
            if (scene.player === actor) {
                scene.player = null;
            }
        }
        // Force UI update to reflect changes on other objects (if selected, though usually only one selected)
        // But mainly to reflect THIS object's state correctly.
        this.updateUIFromObject();
    }

    // Unified Object Creation Logic
    createObjectFromData(data: any, overrideX?: number, overrideY?: number): any {
        const scene = this.game.sceneManager.currentScene;
        if (!scene) return null;

        // Determine Type (fallback to Static if missing)
        const type = data.type || 'Static';

        // Coordinates
        const x = overrideX !== undefined ? overrideX : (data.x || 0);
        const y = overrideY !== undefined ? overrideY : (data.y || 0);

        let newObj: any;

        try {
            if (type === 'Actor') {
                newObj = new Actor(x, y, data.width || 30, data.height || 30, data.name || 'Actor');
                // Restore Actor specifics if available in data
                if (data.direction) newObj.setDirection(data.direction);
                if (data.state) newObj.setState(data.state);
                if (data.speed) newObj.speed = data.speed;
                if (data.isPlayer) newObj.isPlayer = true; // Apply from JSON
            } else if (type === 'Player') {
                // Legacy Import Support: Convert Player to Actor + isPlayer
                newObj = new Actor(x, y, data.width || 30, data.height || 30, data.name || 'Player');
                newObj.isPlayer = true;
                if (data.direction) newObj.setDirection(data.direction);
            } else if (type === 'Static' || type === 'Entity') {
                newObj = new Entity(x, y, data.width || 30, data.height || 30, data.name || 'Static');
            } else if (type === 'Walkbox') {
                // For Walkboxes, we need to shift the polygon if position changed?
                // Walkboxes usually store absolute poly points.
                // If we paste at NEW mouse position, we should shift all points relative to center.
                // But data.poly is absolute.
                // Let's see... duplicate just copies poly.
                // If we Paste, we want to center it at mouse.

                let poly = data.poly || [];
                if (overrideX !== undefined && overrideY !== undefined) {
                    // Calculate centroid or top-left of original poly to detect offset
                    // Simple approach: Center of bounding box
                    if (poly.length > 0) {
                        const minX = Math.min(...poly.map((p: any) => p.x));
                        const minY = Math.min(...poly.map((p: any) => p.y));
                        const maxX = Math.max(...poly.map((p: any) => p.x));
                        const maxY = Math.max(...poly.map((p: any) => p.y));
                        const cx = (minX + maxX) / 2;
                        const cy = (minY + maxY) / 2;

                        const dx = overrideX - cx;
                        const dy = overrideY - cy;

                        poly = poly.map((p: any) => ({ x: p.x + dx, y: p.y + dy }));
                    }
                } else {
                    // Just copy
                    poly = poly.map((p: any) => ({ x: p.x, y: p.y }));
                }

                newObj = new Walkbox(poly, data.name);
            } else if (type === 'Triggerbox') {
                // Same logic as Walkbox for poly
                let poly = data.poly || [];
                if (overrideX !== undefined && overrideY !== undefined) {
                    if (poly.length > 0) {
                        const minX = Math.min(...poly.map((p: any) => p.x));
                        const minY = Math.min(...poly.map((p: any) => p.y));
                        const maxX = Math.max(...poly.map((p: any) => p.x));
                        const maxY = Math.max(...poly.map((p: any) => p.y));
                        const cx = (minX + maxX) / 2;
                        const cy = (minY + maxY) / 2;
                        const dx = overrideX - cx;
                        const dy = overrideY - cy;
                        poly = poly.map((p: any) => ({ x: p.x + dx, y: p.y + dy }));
                    }
                } else {
                    poly = poly.map((p: any) => ({ x: p.x, y: p.y }));
                }
                newObj = new Triggerbox(poly, data.name, data.script || '');
            } else {
                console.warn("Unknown object type:", type);
                return null;
            }

            // Common Entity Props
            if (newObj instanceof Entity) {
                newObj.color = data.color || '#ff0000';
                newObj.scale = data.scale || 1.0;
                newObj.layer = data.layer || 0;
                newObj.parallax = data.parallax !== undefined ? data.parallax : 1.0;
                newObj.ignoreScaling = !!data.ignoreScaling;

                // Base Dimensions
                if (data.baseWidth !== undefined) newObj.baseWidth = data.baseWidth;
                else newObj.baseWidth = newObj.width / newObj.scale; // Approx

                if (data.baseHeight !== undefined) newObj.baseHeight = data.baseHeight;
                else newObj.baseHeight = newObj.height / newObj.scale;

                // Restore Model Scale if present (from duplicate or save)
                if (data.modelScale !== undefined) newObj.modelScale = data.modelScale;
                // Otherwise derive/default?

                if (data.spriteName) newObj.setSprite(data.spriteName, false);
            }

            // ADD TO SCENE
            if (type === 'Walkbox') {
                if (!scene.walkbox) scene.walkbox = [];
                scene.walkbox.push(newObj);
            } else if (type === 'Triggerbox') {
                if (!scene.triggerboxes) scene.triggerboxes = [];
                scene.triggerboxes.push(newObj);
            } else {
                scene.addEntity(newObj);
            }

            return newObj;

        } catch (e) {
            console.error("Error creating object from data:", e);
            return null;
        }
    }

    handleGlobalPaste(e: ClipboardEvent): void {
        if (!this.enabled) return;
        if (document.activeElement instanceof HTMLInputElement) return;

        // Use clipboard data from event if available (Synchronous and reliable)
        const text = e.clipboardData?.getData('text');
        if (text) {
            e.preventDefault();
            console.log("Paste Event Captured. Text length:", text.length);
            this.processPasteData(text);
        } else {
            // Fallback to async read if needed, or just standard action
        }
    }

    async pasteObjectFromClipboard(): Promise<void> {
        // Kept for manual call if needed, but Event is preferred
        try {
            // This method previously contained the logic for reading from clipboard and processing.
            // Now, it should ideally call processPasteData after reading from clipboard.
            // However, the instruction implies it should be mostly empty or just a fallback.
            // The primary paste mechanism is now `handleGlobalPaste` which uses `e.clipboardData`.
            // If this method is still called, it would use `navigator.clipboard.readText()`.
            const text = await navigator.clipboard.readText();
            if (text) {
                console.log("pasteObjectFromClipboard (fallback) called. Text length:", text.length);
                this.processPasteData(text);
            }
        } catch (e) {
            console.error("Manual pasteObjectFromClipboard failed:", e);
        }
    }

    async processPasteData(text: string): Promise<void> {
        try {
            console.log("Processing Paste Data...");
            let data: any;
            try {
                data = JSON.parse(text);
                console.log("JSON Parsed:", data);
            } catch (e) {
                console.warn("Clipboard does not contain valid JSON");
                return;
            }

            // Basic Validation
            if (!data || typeof data !== 'object') {
                console.warn("Clipboard data is not an object");
                return;
            }

            // Check Mouse Pos
            if (!this.lastMousePos) {
                console.log("Mouse position unknown, cannot paste at cursor.");
                return;
            }
            console.log("Paste Position (Screen):", this.lastMousePos);

            // Helper to get World Coords
            const worldPos = this.convertScreenToWorld(this.lastMousePos.x, this.lastMousePos.y);
            console.log("Paste Position (World):", worldPos);

            // Ensure unique name for Paste as well
            const scene = this.game.sceneManager.currentScene;
            if (scene) {
                const baseName = data.name || 'Object';
                const match = baseName.match(/^(.*?)_\d+$/);
                const prefix = match ? match[1] : baseName;

                let counter = 1;
                let newName = `${prefix}_${counter}`;
                const allObjects = [
                    ...(scene.entities || []),
                    ...(scene.walkbox || []),
                    ...(scene.triggerboxes || [])
                ];
                const isNameTaken = (n: string) => allObjects.some((o: any) => o.name === n);
                while (isNameTaken(newName)) {
                    counter++;
                    newName = `${prefix}_${counter}`;
                }
                data.name = newName;
            }

            const newObj = this.createObjectFromData(data, worldPos.x, worldPos.y);
            if (newObj) {
                console.log("Pasted object successfully:", newObj.name);
                this.selectObject(newObj);
                this.refreshHierarchy();
            } else {
                console.warn("Failed to create object from data.");
            }

        } catch (e) {
            console.error("Paste failed:", e);
        }
    }

    // New Helper: Convert Screen to World
    convertScreenToWorld(x: number, y: number): { x: number, y: number } {
        const scene = this.game.sceneManager.currentScene;
        const camX = scene && scene.camera ? scene.camera.x : 0;
        const camY = scene && scene.camera ? scene.camera.y : 0;
        const zoom = scene && scene.camera ? scene.camera.zoom : 1.0;

        const halfW = this.game.canvas.width / 2;
        const halfH = this.game.canvas.height / 2;

        const worldX = (x - halfW) / zoom + camX;
        const worldY = (y - halfH) / zoom + camY;

        return { x: Math.round(worldX), y: Math.round(worldY) };
    }



    // Existing mouse move needs to update this

    getMouseWorldPos(): { x: number, y: number } {
        if (this.lastMousePos) return this.convertScreenToWorld(this.lastMousePos.x, this.lastMousePos.y);
        return { x: 0, y: 0 };
    }


    copySelectedObjectToClipboard(): void {
        if (!this.selectedObject) return;

        let data: any;
        if (this.selectedObject.toJSON) {
            data = this.selectedObject.toJSON();
        } else {
            return;
        }

        const json = JSON.stringify(data, null, 2);

        navigator.clipboard.writeText(json).then(() => {
            console.log('Object JSON copied to clipboard');
            // Silent success as requested
        }).catch(err => {
            console.error('Failed to copy object JSON: ', err);
        });
    }

    deleteSelectedObject(): void {
        if (!this.selectedObject) return;
        const scene = this.game.sceneManager.currentScene;
        if (scene) {
            if (this.selectedObject instanceof Walkbox) {
                const index = scene.walkbox.indexOf(this.selectedObject);
                if (index > -1) scene.walkbox.splice(index, 1);
            } else if (this.selectedObject instanceof Triggerbox) {
                const index = scene.triggerboxes.indexOf(this.selectedObject);
                if (index > -1) scene.triggerboxes.splice(index, 1);
            } else if (this.selectedObject instanceof Entity) {
                const index = scene.entities.indexOf(this.selectedObject);
                if (index > -1) scene.entities.splice(index, 1);
            } else if (this.selectedObject instanceof Actor) {
                const index = scene.entities.indexOf(this.selectedObject);
                if (index > -1) scene.entities.splice(index, 1);
            }
            console.log('Object deleted');
        }

        this.selectedObject = null;
        this.selectObject(null); // Ensure store updates
        this.refreshHierarchy();
    }

    redrawSelected(): void {
        if (!this.selectedObject) return;
        const type = this.selectedObject.type;
        if (type === 'Walkbox' || type === 'Triggerbox') {
            this.deleteSelectedObject();
            this.startCreating(type as any);
        }
    }


    async saveScene(saveAs: boolean = false): Promise<void> {
        const scene = this.game.sceneManager.currentScene;
        if (!scene) return;

        // Valid Filename check
        const needsName = !scene.filename;

        if (saveAs || needsName) {
            this.game.openFileBrowser('save', 'public/scenes', (filename) => {
                // Update Filename from browser selection
                const name = filename.replace('.json', '');
                scene.filename = name;
                // Also update ID if it was a new scene
                if (scene.id === 'new_scene') scene.id = name;

                this.syncUI(); // Refresh UI to show new Filename
                this.performSaveScene(scene.filename);
            });
        } else {
            // Quick Save with existing filename
            this.performSaveScene(scene.filename);
        }
    }

    async performSaveScene(filenameId: string): Promise<void> {
        const scene = this.game.sceneManager.currentScene;
        if (!scene) return;

        const data = scene.toJSON();
        const json = JSON.stringify(data, null, 2);
        const filePath = `public/scenes/${filenameId}.json`;

        try {
            const response = await fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: filePath, content: json })
            });

            if (response.ok) {
                console.log('Scene saved to server:', filePath);
                // this.game.showMessage(`Scene Saved: ${filenameId}`); // Removed per user request
            } else {
                throw new Error(await response.text());
            }
        } catch (e) {
            console.error('Failed to save scene:', e);
            this.game.showMessage(`Error saving scene: ${e}`);
        }
    }

    promptLoadScene(): void {
        this.game.openFileBrowser('load', 'public/scenes', (filename) => {
            this.loadSceneFromServer(filename);
        });
    }

    async loadSceneFromServer(filename: string): Promise<void> {
        try {
            const response = await fetch(`/scenes/${filename}?t=${Date.now()}`); // Burst cache
            if (!response.ok) throw new Error('File not found');
            const data = await response.json();
            this.loadSceneData(data, filename.replace('.json', ''));
        } catch (e) {
            console.error(e);
            this.game.showMessage("Failed to load scene");
        }
    }

    async saveObject(): Promise<void> {
        if (!this.selectedObject || !(this.selectedObject instanceof Entity)) {
            this.game.showMessage("Select an Object to Save");
            return;
        }

        this.game.openFileBrowser('save', 'public/prefabs', (filename) => {
            this.performSaveObject(filename);
        });
    }

    async performSaveObject(filename: string): Promise<void> {
        if (!this.selectedObject) return;
        const ent = this.selectedObject as Entity;

        // Use Entity.toJSON or basic properties
        const data = ent.toJSON ? ent.toJSON() : {
            type: (ent as any).type || (ent instanceof Actor ? 'Actor' : 'Static'),
            name: ent.name,
            x: 0,
            y: 0,
            width: ent.width,
            height: ent.height,
            color: ent.color,
            scale: ent.scale,
            layer: ent.layer,
            parallax: ent.parallax,
            spriteName: ent.spriteName,
            ignoreScaling: ent.ignoreScaling
        };

        const json = JSON.stringify(data, null, 2);
        const filePath = `public/prefabs/${filename}`;

        try {
            const response = await fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: filePath, content: json })
            });

            if (response.ok) {
                console.log('Prefab saved to server:', filePath);
                this.game.showMessage(`Prefab Saved: ${filename}`);
            } else {
                throw new Error(await response.text());
            }
        } catch (e) {
            console.error('Failed to save prefab:', e);
            this.game.showMessage(`Error: ${e}`);
        }
    }

    async loadObject(): Promise<void> {
        if (!this.game.sceneManager.currentScene) return;
        this.game.openFileBrowser('load', 'public/prefabs', (filename) => {
            this.performLoadObject(filename);
        });
    }

    async performLoadObject(filename: string): Promise<void> {
        try {
            const response = await fetch(`/prefabs/${filename}?t=${Date.now()}`);
            if (!response.ok) throw new Error('File not found');
            const data = await response.json();

            // Validate data
            if (!data.type) data.type = 'Static'; // Default

            const entity = this.createObjectFromData(data);

            if (entity) {
                this.selectObject(entity);
                this.refreshHierarchy();
            }

        } catch (e) {
            console.error(e);
            this.game.showMessage("Failed to load prefab");
        }
    }

    // Renamed from loadScene to loadSceneData to differentiate from file fetching
    loadSceneData(data: any, filename?: string): void {
        try {
            // const data = JSON.parse(jsonString); // Already parsed json
            const newScene = new Scene(data.id || 'loaded_scene', data.name || 'Untitled');
            if (filename) newScene.filename = filename;
            else if (data.filename) newScene.filename = data.filename;

            // Restore Camera
            if (data.camera) {
                newScene.defaultCamera = { ...data.camera };
                newScene.camera = { ...data.camera }; // Apply default to runtime immediately
            }

            if (data.autoCenter !== undefined) {
                newScene.autoCenter = data.autoCenter;
            }
            if (data.cameraSpeed !== undefined) {
                newScene.cameraSpeed = data.cameraSpeed;
            }

            // Restore Scaling
            if (data.scaling) {
                newScene.scaling = data.scaling;
            }

            // Restore Walkbox (New Structure)
            if (data.walkbox) {
                newScene.walkbox = (data.walkbox || []).map((wb: any) => ({
                    ...wb,
                    poly: wb.poly.map((p: any) => ({ x: Number(p.x), y: Number(p.y) }))
                }));
            }

            // Restore Triggerboxes
            if (data.triggerboxes) {
                newScene.triggerboxes = (data.triggerboxes || []).map((t: any) => ({
                    ...t,
                    poly: t.poly.map((p: any) => ({ x: Number(p.x), y: Number(p.y) }))
                }));
            }

            if (data.entities) {
                data.entities.forEach((entityData: any) => {
                    let entity: Entity;

                    if (entityData.type === 'Player') {
                        // Legacy: Convert Player to Actor
                        entity = new Actor(entityData.x, entityData.y, 30, 50, 'Player');
                        (entity as Actor).isPlayer = true;
                    } else if (entityData.type === 'Actor') {
                        entity = new Actor(entityData.x, entityData.y, entityData.width, entityData.height, entityData.name);
                        if (entityData.isPlayer) (entity as Actor).isPlayer = true;
                    } else {
                        entity = new Entity(entityData.x, entityData.y, entityData.width, entityData.height, entityData.name);
                    }

                    // Restore common properties
                    entity.color = entityData.color || entity.color;
                    entity.scale = entityData.scale || entity.scale;
                    entity.layer = entityData.layer || entity.layer;
                    entity.parallax = entityData.parallax !== undefined ? entityData.parallax : 1.0;
                    entity.ignoreScaling = !!entityData.ignoreScaling;

                    // Restore base dimensions
                    if (entityData.baseWidth !== undefined) {
                        entity.baseWidth = entityData.baseWidth;
                    } else {
                        entity.baseWidth = entity.scale > 0 ? entityData.width / entity.scale : entityData.width;
                    }

                    if (entityData.baseHeight !== undefined) {
                        entity.baseHeight = entityData.baseHeight;
                    } else {
                        entity.baseHeight = entity.scale > 0 ? entityData.height / entity.scale : entityData.height;
                    }

                    if (entityData.spriteName) {
                        entity.setSprite(entityData.spriteName, false);
                    }

                    // Restore Actor specific properties if needed (state, direction)
                    if (entity instanceof Actor && entityData.type === 'Actor') { // or Player
                        // If we saved state/direction, restore them here.
                        // Currently EntityData doesn't strictly track them, but strict serialization would.
                        // We can cast entityData to have random props for now
                        if ((entityData as any).state) entity.setState((entityData as any).state);
                        if ((entityData as any).direction) entity.setDirection((entityData as any).direction);
                    }

                    newScene.addEntity(entity);
                });
            }

            this.game.sceneManager.addScene(newScene);
            this.game.sceneManager.switchTo(newScene.id);
            this.syncUI();
            this.refreshHierarchy();
            console.log('Scene loaded successfully!');
        } catch (e) {
            console.error('Failed to load scene:', e);
            alert('Error loading JSON');
        }
    }

    onClick(x: number, y: number): boolean {
        console.log(`[Editor] onClick: ${x}, ${y}, Enabled: ${this.enabled}, DrawMode: ${this.drawMode}`);
        if (!this.enabled) return false;

        // If in Draw Mode, add points
        if (this.drawMode) {
            console.log(`OnClick in DrawMode: ${x}, ${y}`);

            // Convert Screen X/Y to World X/Y for storage
            const scene = this.game.sceneManager.currentScene;
            const camX = scene && scene.camera ? scene.camera.x : 0;
            const camY = scene && scene.camera ? scene.camera.y : 0;
            const zoom = scene && scene.camera ? scene.camera.zoom : 1.0;

            // Mouse (Screen) -> World
            // Center-Based: World = (Screen - Center) / Zoom + Camera
            const halfW = this.game.canvas.width / 2;
            const halfH = this.game.canvas.height / 2;

            const worldX = (x - halfW) / zoom + camX;
            const worldY = (y - halfH) / zoom + camY;

            if (!this.currentPolygon) this.currentPolygon = [];
            this.currentPolygon.push({ x: Math.round(worldX), y: Math.round(worldY) });
            console.log(`Point Added: ${Math.round(worldX)},${Math.round(worldY)}. Total: ${this.currentPolygon.length}`);
        }

        // ALWAYS consume click if editor is enabled to prevent Game/Player interaction
        return true;
    }

    finishPolygon(): void {
        console.log('finishPolygon called');
        if (this.currentPolygon && this.currentPolygon.length > 2) {
            const scene = this.game.sceneManager.currentScene;
            if (scene) {
                const newPoly = [...this.currentPolygon];

                if (this.creationType === 'Triggerbox') {
                    if (!scene.triggerboxes) scene.triggerboxes = []; // Init if missing
                    const newTrigger = new Triggerbox(newPoly, 'Trig_' + Math.floor(Math.random() * 1000));
                    scene.triggerboxes.push(newTrigger);
                    console.log('Triggerbox object added to scene');
                    this.selectObject(newTrigger);
                } else {
                    // Walkbox
                    if (!scene.walkbox) scene.walkbox = [];
                    const newWalkbox = new Walkbox(newPoly, 'Walk_' + Math.floor(Math.random() * 1000));
                    scene.walkbox.push(newWalkbox);
                    console.log('Walkbox object added to scene');
                    this.selectObject(newWalkbox);
                }

                this.currentPolygon = [];
                // UX Improvement: Auto-exit draw mode
                this.drawMode = false;
                const chk = document.getElementById('chk-draw-mode') as HTMLInputElement;
                if (chk) chk.checked = false;
                this.refreshHierarchy();
            }
        }
    }

    render(ctx: CanvasRenderingContext2D): void {
        if (!this.enabled) return;

        const scene = this.game.sceneManager.currentScene;
        let camX = 0;
        let camY = 0;
        if (scene && scene.camera) {
            camX = scene.camera.x;
            camY = scene.camera.y;
        }

        // Sync UI if Scene is selected (so coordinates update during auto-center)
        if (scene && (this.selectedObject as any) === 'SCENE') {
            const cx = document.getElementById('cam-x') as HTMLInputElement;
            const cy = document.getElementById('cam-y') as HTMLInputElement;
            const cz = document.getElementById('cam-zoom') as HTMLInputElement;
            const ac = document.getElementById('cam-auto-center') as HTMLInputElement;
            const cs = document.getElementById('cam-speed') as HTMLInputElement;

            const dx = document.getElementById('def-cam-x') as HTMLInputElement;
            const dy = document.getElementById('def-cam-y') as HTMLInputElement;
            const dz = document.getElementById('def-cam-zoom') as HTMLInputElement;

            // Always update runtime X/Y if auto-center is ON override inputs
            if (scene.autoCenter) {
                if (cx) cx.value = Math.round(camX).toString();
                if (cy) cy.value = Math.round(camY).toString();
            } else {
                // If auto-center is OFF, only update if not focused (allowing edit)
                if (cx && document.activeElement !== cx) cx.value = Math.round(camX).toString();
                if (cy && document.activeElement !== cy) cy.value = Math.round(camY).toString();
            }

            // Sync Zoom and AutoCenter checkbox
            if (cz && document.activeElement !== cz) cz.value = (scene.camera.zoom || 1.0).toFixed(2);
            if (ac) ac.checked = scene.autoCenter !== false;
            if (cs && document.activeElement !== cs) cs.value = (scene.cameraSpeed || 5.0).toString();

            // Sync Default Camera Settings
            if (scene.defaultCamera) {
                if (dx && document.activeElement !== dx) dx.value = Math.round(scene.defaultCamera.x).toString();
                if (dy && document.activeElement !== dy) dy.value = Math.round(scene.defaultCamera.y).toString();
                if (dz && document.activeElement !== dz) dz.value = (scene.defaultCamera.zoom || 1.0).toFixed(2);
            }
        }

        const halfW = this.game.canvas.width / 2;
        const halfH = this.game.canvas.height / 2;

        // Render current polygon (World Space)
        if (this.currentPolygon && this.currentPolygon.length > 0) {
            ctx.save();
            ctx.translate(halfW, halfH);
            ctx.scale(scene && scene.camera ? scene.camera.zoom : 1, scene && scene.camera ? scene.camera.zoom : 1);
            ctx.translate(-camX, -camY); // Apply Camera

            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 2 / (scene && scene.camera ? scene.camera.zoom : 1);
            ctx.beginPath();
            ctx.moveTo(this.currentPolygon[0].x, this.currentPolygon[0].y);
            for (let i = 1; i < this.currentPolygon.length; i++) {
                ctx.lineTo(this.currentPolygon[i].x, this.currentPolygon[i].y);
            }
            ctx.stroke();
            ctx.fillStyle = '#ffff00';
            this.currentPolygon.forEach(p => ctx.fillRect(p.x - 2, p.y - 2, 4, 4));
            ctx.restore();
        }

        // Check Triggerboxes
        if (scene.triggerboxes) {
            scene.triggerboxes.forEach((trigger: any) => {
                const poly = trigger.poly;
                if (!poly || poly.length === 0) return;

                // Draw Trigger (World Space)
                ctx.save();
                ctx.translate(halfW, halfH);
                ctx.scale(scene.camera.zoom, scene.camera.zoom); // Zoom
                ctx.translate(-camX, -camY); // Camera

                ctx.beginPath();
                ctx.moveTo(poly[0].x, poly[0].y);
                for (let i = 1; i < poly.length; i++) {
                    ctx.lineTo(poly[i].x, poly[i].y);
                }
                ctx.closePath();

                ctx.fillStyle = 'rgba(0, 255, 255, 0.2)'; // Cyan fill
                ctx.fill();
                ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)'; // Cyan stroke
                ctx.stroke();

                ctx.restore();
            });
        }

        // Highlight selected object
        if (this.selectedObject) {
            ctx.save();
            const zoom = scene && scene.camera ? scene.camera.zoom : 1.0;

            if (this.selectedObject instanceof Entity) {
                const entity = this.selectedObject as Entity;
                const p = entity.parallax !== undefined ? entity.parallax : 1.0;

                ctx.translate(halfW, halfH);
                ctx.scale(zoom, zoom);
                ctx.translate(-camX * p, -camY * p);

                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2 / zoom;
                ctx.setLineDash([4 / zoom, 4 / zoom]);

                // Entity Anchor is Bottom-Center
                // We draw the rect starting at Top-Left relative to that anchor
                const drawX = entity.x;
                const drawY = entity.y;

                ctx.strokeRect(
                    drawX - entity.width / 2,
                    drawY - entity.height,
                    entity.width,
                    entity.height
                );

                // Draw Resize Handles
                ctx.fillStyle = '#ffffff';
                const hSize = 6 / zoom; // Handle size

                const l = drawX - entity.width / 2;
                const r = drawX + entity.width / 2;
                const t = drawY - entity.height;
                const b = drawY;

                // NW
                ctx.fillRect(l - hSize / 2, t - hSize / 2, hSize, hSize);
                // NE
                ctx.fillRect(r - hSize / 2, t - hSize / 2, hSize, hSize);
                // SW
                ctx.fillRect(l - hSize / 2, b - hSize / 2, hSize, hSize);
                // SE
                ctx.fillRect(r - hSize / 2, b - hSize / 2, hSize, hSize);

                ctx.restore();
            } else if (this.selectedObject instanceof Walkbox || this.selectedObject instanceof Triggerbox) {
                // Triggerbox/Walkbox
                ctx.translate(halfW, halfH);
                ctx.scale(zoom, zoom);
                ctx.translate(-camX, -camY);

                const poly = this.selectedObject.poly;

                // If getting bounding box or drawing highlight
                if (this.selectedObject instanceof Walkbox) ctx.strokeStyle = '#ff0000';
                else ctx.strokeStyle = '#ff00ff';

                ctx.lineWidth = 3 / zoom;
                ctx.beginPath();

                if (poly.length > 0) {
                    ctx.moveTo(poly[0].x, poly[0].y);
                    for (let i = 1; i < poly.length; i++) {
                        ctx.lineTo(poly[i].x, poly[i].y);
                    }
                    ctx.closePath();
                    ctx.stroke();

                    // Draw Vertex Handles
                    if (this.selectedObject instanceof Walkbox) ctx.fillStyle = '#ff0000';
                    else ctx.fillStyle = '#ff00ff';

                    const handleSize = 6 / zoom;
                    for (const pt of poly) {
                        ctx.fillRect(pt.x - handleSize / 2, pt.y - handleSize / 2, handleSize, handleSize);
                    }
                }
            }
            ctx.restore();
        }

        // Draw Scaling Lines (Horizon and Front)
        // const scene = this.game.sceneManager.currentScene; // Already declared at top
        if (scene && scene.scaling && scene.scaling.enabled) {
            ctx.save();
            ctx.font = '10px monospace';

            const zoom = scene.camera ? scene.camera.zoom : 1;
            const camY = scene.camera ? scene.camera.y : 0;

            // Horizon Line (Min Scale)
            // Transform World Y -> Screen Y
            const horizonWorldY = scene.scaling.horizon;
            const horizonScreenY = (horizonWorldY - camY) * zoom + halfH;

            ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)'; // Cyan, semi-transparent
            ctx.setLineDash([5, 5]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, horizonScreenY);
            ctx.lineTo(this.game.canvas.width, horizonScreenY);
            ctx.stroke();
            ctx.fillStyle = 'rgba(0, 255, 255, 0.8)';
            ctx.fillText(`Horizon (${horizonWorldY})`, 5, horizonScreenY - 2);

            // Front Line (Max Scale)
            const frontWorldY = scene.scaling.front;
            const frontScreenY = (frontWorldY - camY) * zoom + halfH;

            ctx.strokeStyle = 'rgba(255, 0, 255, 0.5)'; // Magenta, semi-transparent
            ctx.beginPath();
            ctx.moveTo(0, frontScreenY);
            ctx.lineTo(this.game.canvas.width, frontScreenY);
            ctx.stroke();
            ctx.fillStyle = 'rgba(255, 0, 255, 0.8)';
            ctx.fillText(`Front (${frontWorldY})`, 5, frontScreenY - 2);

            ctx.restore();
        }
    }
}
