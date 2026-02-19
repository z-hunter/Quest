
import { Entity } from '../entities/Entity';
import { Actor } from '../entities/Actor';
import { SceneObject } from '../entities/SceneObject';
import { Walkbox } from '../entities/Walkbox';
import { Triggerbox } from '../entities/Triggerbox';
import { QuadObject } from '../entities/QuadObject';
import { Scene } from '../scene/Scene';
import { useEditorStore } from '../store/editorStore';

import { EditorUndoManager } from './editor/EditorUndoManager';
import { EditorSelectionManager } from './editor/EditorSelectionManager';
import { EditorTransformManager } from './editor/EditorTransformManager';
import { EditorPersistenceManager } from './editor/EditorPersistenceManager';
import { EditorUI } from './editor/EditorUI';

export class SceneEditor {
    undoManager: EditorUndoManager;
    selectionManager: EditorSelectionManager;
    transformManager: EditorTransformManager;
    persistenceManager: EditorPersistenceManager;
    ui: EditorUI;

    game: any;
    enabled: boolean;
    // State Properties
    get selectedObject(): SceneObject | null { return this.selectionManager.selectedObject; }
    set selectedObject(val: SceneObject | null) { this.selectionManager.selectedObject = val; }
    lastMousePos: { x: number, y: number };

    // Callbacks
    // Refactored: Use this.game.openFileBrowser instead of local property

    // Event Handlers (Bound)
    public boundKeyHandler: (e: KeyboardEvent) => void;
    public boundMouseDownHandler: (e: MouseEvent) => void;
    public boundMouseMoveHandler: (e: MouseEvent) => void;
    public boundMouseUpHandler: (e: MouseEvent) => void;
    public boundPasteHandler: (e: ClipboardEvent) => void;
    public boundWheelHandler: (e: WheelEvent) => void;

    constructor(game: any) {
        this.game = game;
        this.undoManager = new EditorUndoManager(this);
        this.selectionManager = new EditorSelectionManager(this);
        this.transformManager = new EditorTransformManager(this);
        this.persistenceManager = new EditorPersistenceManager(this);
        this.ui = new EditorUI(this);
        this.enabled = false;

        this.selectionManager.selectedObject = null;
        this.lastMousePos = { x: 0, y: 0 };

        // Bind handlers once for cleanup

        this.boundKeyHandler = this.handleGlobalKey.bind(this);
        this.boundMouseDownHandler = this.onMouseDown.bind(this);
        this.boundMouseMoveHandler = this.onMouseMove.bind(this);
        this.boundMouseUpHandler = this.onMouseUp.bind(this);
        this.boundPasteHandler = this.handleGlobalPaste.bind(this);
        this.boundWheelHandler = this.onWheel.bind(this);

        this.ui.initUI();
    }

    initUI(): void {
        this.ui.initUI();
    }




    destroy(): void {
        this.ui.destroy();
    }

    lastCameraPos: { x: number, y: number } = { x: 0, y: 0 };

    update(_deltaTime?: number): void {
        // Check for Camera changes to update UI
        if (this.game.sceneManager.currentScene) {
            const cam = this.game.sceneManager.currentScene.camera;
            if (cam) {
                if (cam.x !== this.lastCameraPos.x || cam.y !== this.lastCameraPos.y) {
                    this.lastCameraPos.x = cam.x;
                    this.lastCameraPos.y = cam.y;

                    // Only update UI if Scene is selected (showing Camera Props)
                    // Or if we decide to show camera Pos elsewhere
                    if (useEditorStore.getState().selectedObjectId === 'SCENE') {
                        useEditorStore.getState().incrementObjectVersion();
                    }
                }
            }
        }
    }

    setupListeners(): void {
        this.ui.setupListeners();
    }

    /* Event Handlers extracted for cleanup */

    /* Legacy Event Handlers Removed */

    // Kept for F-Key shortcuts


    /* handleGlobalInput Removed */

    /* handleGlobalChange Removed */

    saveUndoState(): void {
        this.undoManager.saveUndoState();
    }

    // Keep public for compatibility if needed, but implementation is in manager
    restoreSceneState(data: any): void {
        this.undoManager.restoreSceneState(data);
    }

    undo(): void {
        this.undoManager.undo();
    }

    redo(): void {
        this.undoManager.redo();
    }

    handleGlobalKey(e: KeyboardEvent): void {
        // High Priority: Ctrl+D for Duplication (Overrides Chrome Bookmark & Input focus)
        if (this.enabled && e.ctrlKey && (e.key.toLowerCase() === 'd' || e.code === 'KeyD')) {
            e.preventDefault();
            this.duplicateSelectedObject();
            return;
        }

        // Ctrl+C: Copy Object
        if (this.enabled && e.ctrlKey && (e.key.toLowerCase() === 'c' || e.code === 'KeyC')) {
            // Only prevent default if we have an object selected, 
            // otherwise let normal copy work (e.g. text in inputs)
            if (this.selectedObject && !(document.activeElement instanceof HTMLInputElement)) {
                e.preventDefault();
                this.copySelectedObjectToClipboard();
                return;
            }
        }

        // Ctrl+V: Paste Object
        if (this.enabled && e.ctrlKey && (e.key.toLowerCase() === 'v' || e.code === 'KeyV')) {
            if (!(document.activeElement instanceof HTMLInputElement)) {
                // e.preventDefault(); // Don't prevent default, let 'paste' event fire
                // We rely on the global 'paste' event listener which calls handleGlobalPaste
                return;
            }
        }

        // Ctrl+S: Save Object
        if (this.enabled && e.ctrlKey && (e.key.toLowerCase() === 's' || e.code === 'KeyS')) {
            e.preventDefault();
            this.persistenceManager.saveObject();
            return;
        }

        // Ctrl+O: Load Object
        if (this.enabled && e.ctrlKey && (e.key.toLowerCase() === 'o' || e.code === 'KeyO')) {
            e.preventDefault();
            this.persistenceManager.loadObject();
            return;
        }

        // Alt+D: Toggle Disabled State
        if (this.enabled && e.altKey && (e.key.toLowerCase() === 'd' || e.code === 'KeyD')) {
            e.preventDefault();
            if (this.selectedObject) {
                this.selectedObject.disabled = !this.selectedObject.disabled;
                console.log(`[Editor] Object ${this.selectedObject.name} disabled: ${this.selectedObject.disabled}`);

                // Force UI Update
                useEditorStore.getState().incrementObjectVersion();
                useEditorStore.getState().incrementHierarchyVersion();
            }
            return;
        }

        // Alt+L: Toggle Locked State
        if (this.enabled && e.altKey && (e.key.toLowerCase() === 'l' || e.code === 'KeyL')) {
            e.preventDefault();
            if (this.selectedObject) {
                this.selectedObject.locked = !this.selectedObject.locked;
                console.log(`[Editor] Object ${this.selectedObject.name} locked: ${this.selectedObject.locked}`);

                // Force UI Update
                useEditorStore.getState().incrementObjectVersion();
                useEditorStore.getState().incrementHierarchyVersion();
            }
            return;
        }

        // Ctrl+Z: Undo
        if (this.enabled && e.ctrlKey && (e.key.toLowerCase() === 'z' || e.code === 'KeyZ') && !e.shiftKey) { // Ensure Shift not held for Redo in some apps
            e.preventDefault();
            this.undo();
            return;
        }

        // Ctrl+Y or Ctrl+Shift+Z: Redo
        if (this.enabled && e.ctrlKey && ((e.key.toLowerCase() === 'y' || e.code === 'KeyY') || (e.shiftKey && (e.key.toLowerCase() === 'z' || e.code === 'KeyZ')))) {
            e.preventDefault();
            this.redo();
            return;
        }


        // Insert: Assign Sprite (Static/Actor)
        if (this.enabled && e.key === 'Insert') {
            e.preventDefault();
            if (this.selectedObject && (this.selectedObject instanceof Entity || this.selectedObject instanceof Actor)) {
                // Check if method exists, else implement inline or warn
                this.persistenceManager.promptSetSprite();
            }
            return;
        }



        // Allows opening editor with F1 or F5 even if disabled
        if (!this.enabled && e.key !== 'F1' && e.key !== 'F5') return;

        // F1: Toggle Scene Editor
        if (e.key === 'F1') {
            e.preventDefault();
            e.stopImmediatePropagation();

            // Ensure Sprite Editor is closed if switching
            if (this.game.spriteEditor && this.game.spriteEditor.active) {
                this.game.spriteEditor.toggle(false);
            }
            this.toggle();
            return;
        } else if (e.key === 'F5') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.game.spriteEditor.toggle();
            return;
        } else if (e.key === 'F9') {
            e.preventDefault();
            this.selectObject('SETTINGS');
            return;
        } else if (e.key === 'Delete') {
            // Prevent if user is typing or Mouse is over UI
            if (document.activeElement instanceof HTMLInputElement ||
                document.activeElement instanceof HTMLTextAreaElement ||
                this.game.isMouseOverUI) {
                return;
            }

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
                if (e.shiftKey) this.persistenceManager.saveScene(true); // Save As
                else this.persistenceManager.saveScene(false); // Quick Save
                break;
            case 'f3':
                e.preventDefault();
                this.persistenceManager.promptLoadScene();
                break;
            case 'f4': e.preventDefault(); this.newScene(); break;

            case ' ':
                // Spacebar: Select Scene if mouse is over canvas
                const mx = this.lastMousePos.x;
                const my = this.lastMousePos.y;
                if (mx >= 0 && mx <= this.game.canvas.width && my >= 0 && my <= this.game.canvas.height) {
                    e.preventDefault();
                    this.selectObject('SCENE');
                }
                break;




            // Creation Hotkeys
            case 's':
                {
                    const pos = this.getMouseWorldPosIfOverCanvas();
                    this.startCreating('Static', pos?.x, pos?.y);
                }
                break;
            case 'a':
                {
                    const pos = this.getMouseWorldPosIfOverCanvas();
                    this.startCreating('Actor', pos?.x, pos?.y);
                }
                break;
            case 'w': this.startCreating('Walkbox'); break;
            case 't': this.startCreating('Triggerbox'); break;
            case 'q':
                {
                    const pos = this.getMouseWorldPosIfOverCanvas();
                    this.startCreating('Quad', pos?.x, pos?.y);
                }
                break;

            // Camera Hotkeys
            case '+': case '=':
                if (this.game.sceneManager.currentScene) {
                    this.game.sceneManager.currentScene.camera.zoom *= 1.1;
                    useEditorStore.getState().incrementObjectVersion();
                }
                break;
            case '-':
                if (this.game.sceneManager.currentScene) {
                    this.game.sceneManager.currentScene.camera.zoom *= 0.9;
                    useEditorStore.getState().incrementObjectVersion();
                }
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
                    useEditorStore.getState().incrementObjectVersion();
                }
                break;
            case '/':
                // Reset Zoom
                if (this.game.sceneManager.currentScene) {
                    this.game.sceneManager.currentScene.camera.zoom = 1.0;
                    useEditorStore.getState().incrementObjectVersion();
                }
                break;

            case 'enter':
                if (!e.ctrlKey) this.transformManager.finishPolygon();
                break;

            case 'escape':
                this.transformManager.drawMode = false;
                this.transformManager.currentPolygon = [];
                const c = document.getElementById('chk-draw-mode') as HTMLInputElement;
                if (c) c.checked = false;
                console.log("[Editor] Draw Mode Cancelled");
                break;
        }
    }

    // Helper to get World Pos from last mouse pos if inside canvas
    getMouseWorldPosIfOverCanvas(): { x: number, y: number } | null {
        const mx = this.lastMousePos.x;
        const my = this.lastMousePos.y;

        // Basic check if inside canvas
        if (mx >= 0 && mx <= this.game.canvas.width && my >= 0 && my <= this.game.canvas.height) {
            return this.convertScreenToWorld(mx, my);
        }
        return null;
    }

    convertScreenToWorld(screenX: number, screenY: number): { x: number, y: number } {
        const scene = this.game.sceneManager.currentScene;
        const camX = scene && scene.camera ? scene.camera.x : 0;
        const camY = scene && scene.camera ? scene.camera.y : 0;
        const zoom = scene && scene.camera ? scene.camera.zoom : 1.0;

        const halfW = this.game.canvas.width / 2;
        const halfH = this.game.canvas.height / 2;

        return {
            x: (screenX - halfW) / zoom + camX,
            y: (screenY - halfH) / zoom + camY
        };
    }

    startCreating(type: string, x?: number, y?: number): void {
        if (!this.game.sceneManager.currentScene) return;

        this.saveUndoState(); // Save before creation
        this.transformManager.startCreating(type, x, y);
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
            useEditorStore.getState().incrementHierarchyVersion();
        }
    }


    toggle(): void {
        this.ui.toggle();
    }

    syncUI(): void {
        // Legacy: UI is now reactive.
        useEditorStore.getState().incrementObjectVersion();
        useEditorStore.getState().incrementHierarchyVersion();
    }

    updateUIFromObject(): void {
        this.ui.updateUIFromObject();
    }

    saveObject(): Promise<void> {
        return this.persistenceManager.saveObject();
    }

    loadObject(): Promise<void> {
        return this.persistenceManager.loadObject();
    }

    saveScene(saveAs: boolean = false): Promise<void> {
        return this.persistenceManager.saveScene(saveAs);
    }

    promptLoadScene(): void {
        this.persistenceManager.promptLoadScene();
    }



    onMouseDown(e: MouseEvent): void {
        this.transformManager.onMouseDown(e);
    }


    onMouseMove(e: MouseEvent): void {
        this.lastMousePos = this.getMousePos(e);
        this.transformManager.onMouseMove(e);
    }

    onMouseUp(e: MouseEvent): void {
        this.transformManager.onMouseUp(e);
    }

    onWheel(e: WheelEvent): void {
        this.transformManager.onWheel(e);
    }

    selectObject(obj: any): void {
        this.selectionManager.selectObject(obj);
    }




    newScene(): void {
        const newScene = new Scene(this.game, 'new_scene', 'New Scene');
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
        // Sync to Store: Signal React to re-render the hierarchy
        useEditorStore.getState().incrementHierarchyVersion();
    }


    // Unified Object Creation Logic
    createObjectFromData(data: any, overrideX?: number, overrideY?: number, options?: { preserveBindings?: boolean }): any {
        const scene = this.game.sceneManager.currentScene;
        if (!scene) return null;

        // Determine Type (fallback to Static if missing)
        const type = data.type || 'Static';


        // Coordinates
        const x = overrideX !== undefined ? overrideX : (data.x || 0);
        const y = overrideY !== undefined ? overrideY : (data.y || 0);

        let newObj: any;

        try {
            // Apply Overrides to data
            data.x = x;
            data.y = y;

            if (type === 'Walkbox') {
                // ... (Walkbox logic remains) ...
                let poly = data.poly || [];
                if (overrideX !== undefined && overrideY !== undefined) {
                    // ... (Walkbox position logic) ...
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

                newObj = new Walkbox(poly, data.name);
                if (data.mode) newObj.mode = data.mode;
                if (data.groupID) newObj.groupID = data.groupID;
                if (data.locked) newObj.locked = data.locked;
                if (data.disabled) newObj.disabled = data.disabled;
                if (data.customName) newObj.customName = data.customName;
                if (data.interactions) newObj.interactions = data.interactions;

            } else if (type === 'Triggerbox') {
                // ... (Triggerbox logic remains) ...
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
                if (data.groupID) newObj.groupID = data.groupID;
                if (data.components) newObj.components = JSON.parse(JSON.stringify(data.components));
                if (data.locked) newObj.locked = data.locked;
                if (data.disabled) newObj.disabled = data.disabled;
                if (data.customName) newObj.customName = data.customName;
                if (data.interactions) newObj.interactions = data.interactions;

            } else if (type === 'Quad') {
                newObj = QuadObject.fromJSON(this.game, data);

                // Clear Bindings for New Objects (Paste/Duplicate/Load)
                // BUT preserve if explicitly requested (Undo/Redo)
                if (!options?.preserveBindings && newObj.vertices) {
                    newObj.vertices.forEach((v: any) => delete v.binding);
                }

                // Handle Paste Position Override
                if (overrideX !== undefined && overrideY !== undefined) {
                    const oldX = data.x || 0;
                    const oldY = data.y || 0;
                    const dx = overrideX - oldX;
                    const dy = overrideY - oldY;

                    newObj.x = overrideX;
                    newObj.y = overrideY;

                    if (newObj.vertices) {
                        newObj.vertices.forEach((v: any) => {
                            v.x += dx;
                            v.y += dy;
                        });
                    }
                }
            } else if (type === 'Actor') {
                newObj = Actor.fromJSON(this.game, data);
            } else if (type === 'Player') {
                newObj = Actor.fromJSON(this.game, { ...data, type: 'Actor', isPlayer: true });
            } else if (type === 'Static' || type === 'Entity') {
                newObj = Entity.fromJSON(this.game, data);
            }
            // Fallback
            if (!newObj) {
                if (type !== 'Walkbox' && type !== 'Triggerbox') {
                    newObj = Entity.fromJSON(this.game, data);
                }
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

            // Ensure new object is available in console
            this.game.sceneManager.exposeEntitiesToWindow();

            return newObj;


        } catch (e) {
            console.error("Error creating object from data:", e);
            return null;
        }
    }

    handleGlobalPaste(e: ClipboardEvent): void {
        this.selectionManager.handleGlobalPaste(e);
    }

    async pasteObjectFromClipboard(): Promise<void> {
        const text = await navigator.clipboard.readText();
        if (text) {
            this.selectionManager.processPasteData(text);
        }
    }

    getMousePos(e: MouseEvent): { x: number, y: number } {
        const rect = this.game.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (this.game.canvas.width / rect.width),
            y: (e.clientY - rect.top) * (this.game.canvas.height / rect.height)
        };
    }





    // Existing mouse move needs to update this



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

    duplicateSelectedObject(): void {
        this.selectionManager.duplicateSelectedObject();
    }

    deleteSelectedObject(): void {
        if (!this.selectedObject) return;
        this.saveUndoState(); // Save before deletion
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
            // Keep object, just clear points
            if ((this.selectedObject as any).poly) {
                (this.selectedObject as any).poly = [];
            }

            this.transformManager.currentPolygon = [];
            this.transformManager.creationType = type as any;
            this.transformManager.drawMode = true;

            // UI Feedback
            const chk = document.getElementById('chk-draw-mode') as HTMLInputElement;
            if (chk) chk.checked = true;

            if (type === 'Walkbox') useEditorStore.getState().setMode('DRAW_WALKBOX');
            else useEditorStore.getState().setMode('DRAW_TRIGGER');

            console.log(`Redrawing ${type}: ${this.selectedObject.name} `);
        }
    }




    // Renamed from loadScene to loadSceneData to differentiate from file fetching


    onClick(x: number, y: number): boolean {
        return this.transformManager.onClick(x, y);
    }

    finishPolygon(): void {
        this.transformManager.finishPolygon();
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

        const halfW = this.game.canvas.width / 2;
        const halfH = this.game.canvas.height / 2;

        // Render current polygon (World Space)
        if (this.transformManager.currentPolygon && this.transformManager.currentPolygon.length > 0) {
            ctx.save();
            ctx.translate(halfW, halfH);
            ctx.scale(scene && scene.camera ? scene.camera.zoom : 1, scene && scene.camera ? scene.camera.zoom : 1);
            ctx.translate(-camX, -camY); // Apply Camera

            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 2 / (scene && scene.camera ? scene.camera.zoom : 1);
            ctx.beginPath();
            ctx.moveTo(this.transformManager.currentPolygon[0].x, this.transformManager.currentPolygon[0].y);
            for (let i = 1; i < this.transformManager.currentPolygon.length; i++) {
                ctx.lineTo(this.transformManager.currentPolygon[i].x, this.transformManager.currentPolygon[i].y);
            }
            ctx.stroke();
            ctx.fillStyle = '#ffff00';
            this.transformManager.currentPolygon.forEach(p => ctx.fillRect(p.x - 2, p.y - 2, 4, 4));
            ctx.restore();
        }


        // Highlight selected object
        if (this.selectedObject) {
            ctx.save();
            const zoom = scene && scene.camera ? scene.camera.zoom : 1.0;

            if (this.selectedObject instanceof Entity) {
                if ((this.selectedObject as any).type === 'Quad') {
                    // ** QUAD SELECTION RENDERING **
                    const quad = this.selectedObject as QuadObject;

                    ctx.save();
                    ctx.translate(halfW, halfH);
                    ctx.scale(zoom, zoom);
                    // Do NOT apply global camera translate here the same way, 
                    // because each vertex has its own parallax.
                    // We need to project each vertex to "Screen Space relative to Zoom Center"
                    // ScreenX = (Vx - CamX * Vp) * Zoom + HalfW
                    // Here we are in "Zoom Space" (Scale applied).
                    // So we draw at (Vx - CamX * Vp)

                    ctx.beginPath();
                    // Draw Outline
                    const verts = quad.vertices;
                    if (verts.length > 0) {
                        // V_visual = V_world - Cam * (p - 1) - Cam <-- Wait.
                        // Standard Entity: ctx.translate(-camX * p, -camY * p). Draw at 0,0 relative to entity.
                        // Entity Pos on Screen: (Ex - CamX * p)

                        // Quad Vertex:
                        // VisualPos = Vx - CamX * (p - 1)  (This IS the visual world position at P=1 plane)
                        // Then we apply standard Camera P=1 offset: - CamX
                        // Total: Vx - CamX*p + CamX - CamX = Vx - CamX * p

                        const getDrawPos = (v: any) => ({
                            x: v.x - camX * v.p,
                            y: v.y - camY * v.p
                        });

                        const p0 = getDrawPos(verts[0]);
                        ctx.moveTo(p0.x, p0.y);
                        for (let i = 1; i < verts.length; i++) {
                            const pi = getDrawPos(verts[i]);
                            ctx.lineTo(pi.x, pi.y);
                        }
                        ctx.closePath();

                        ctx.strokeStyle = '#00ff00';
                        ctx.lineWidth = 2 / zoom;
                        ctx.stroke();

                        // Draw Vertices
                        ctx.fillStyle = '#00ff00';
                        const handleSize = 6 / zoom;
                        verts.forEach((v: any, i: number) => {
                            const p = getDrawPos(v);
                            // Highlight dragging vertex
                            if (this.transformManager.isDragging && this.transformManager.draggingVertexIndex === i) {
                                ctx.fillStyle = '#ffff00';
                            } else if (v.binding) {
                                ctx.fillStyle = '#00FFFF'; // Bound = Cyan
                            } else if (useEditorStore.getState().selectedVertexIndex === i) {
                                ctx.fillStyle = '#ffff00';
                            } else {
                                ctx.fillStyle = '#00ff00';
                            }

                            // Calculate Centroid for Quad "Inside" shift
                            // Simple average
                            let cx = 0, cy = 0;
                            verts.forEach((vv: any) => {
                                const vp = getDrawPos(vv);
                                cx += vp.x;
                                cy += vp.y;
                            });
                            cx /= verts.length;
                            cy /= verts.length;

                            // Vector from Vertex to Centroid
                            const dx = cx - p.x;
                            const dy = cy - p.y;
                            const len = Math.sqrt(dx * dx + dy * dy);

                            let shiftX = 0;
                            let shiftY = 0;

                            if (len > 0) {
                                // Shift by half handle size + padding?
                                // handleSize is 6. We want to be "inside".
                                const shiftDist = (handleSize / 2) + (2 / zoom); // Slight offset
                                shiftX = (dx / len) * shiftDist;
                                shiftY = (dy / len) * shiftDist;
                            }

                            // Draw Handle Centered at Shifted Pos
                            // ctx.fillRect(p.x - handleSize/2 + shiftX, p.y - handleSize/2 + shiftY, handleSize, handleSize);

                            // Actually, let's just draw it.
                            ctx.fillRect(p.x - handleSize / 2 + shiftX, p.y - handleSize / 2 + shiftY, handleSize, handleSize);
                        });
                    }
                    ctx.restore();

                } else {
                    // ** STANDARD ENTITY SELECTION **
                    const entity = this.selectedObject as Entity;
                    const p = entity.parallax !== undefined ? entity.parallax : 1.0;

                    const vOx = (entity as any).visualOffset ? (entity as any).visualOffset.x : 0;
                    const vOy = (entity as any).visualOffset ? (entity as any).visualOffset.y : 0;

                    ctx.translate(halfW, halfH);
                    ctx.scale(zoom, zoom);
                    ctx.translate(-camX * p + vOx, -camY * p + vOy);

                    if (entity.locked) {
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                        ctx.lineWidth = 1 / zoom;
                        ctx.setLineDash([4 / zoom, 4 / zoom]); // Dashed, thin line
                    } else {
                        ctx.strokeStyle = '#fff';
                        ctx.lineWidth = 2 / zoom;
                        ctx.setLineDash([4 / zoom, 4 / zoom]);
                    }

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

                    // Draw Resize Handles (Only if NOT locked)
                    if (!entity.locked) {
                        ctx.fillStyle = '#ffffff';
                        const hSize = 6 / zoom; // Handle size

                        const l = drawX - entity.width / 2;
                        const r = drawX + entity.width / 2;
                        const t = drawY - entity.height;
                        const b = drawY;

                        // NW - Top Left Corner -> Draw Inside (Top-Left of Rect is top-left of handle)
                        ctx.fillRect(l, t, hSize, hSize);

                        // NE - Top Right Corner -> Draw Inside (Shift Left)
                        ctx.fillRect(r - hSize, t, hSize, hSize);

                        // SW - Bottom Left Corner -> Draw Inside (Shift Up - wait, bottom is positive Y)
                        // b is bottom Y. we want to draw above it.
                        ctx.fillRect(l, b - hSize, hSize, hSize);

                        // SE - Bottom Right Corner -> Draw Inside
                        ctx.fillRect(r - hSize, b - hSize, hSize, hSize);
                    }
                }

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

                if (this.selectedObject.locked) {
                    // Locked Style
                    ctx.lineWidth = 1.5 / zoom;
                    ctx.setLineDash([]);
                } else {
                    ctx.lineWidth = 3 / zoom;
                    ctx.setLineDash([]);
                }

                ctx.beginPath();

                if (poly.length > 0) {
                    ctx.moveTo(poly[0].x, poly[0].y);
                    for (let i = 1; i < poly.length; i++) {
                        ctx.lineTo(poly[i].x, poly[i].y);
                    }
                    ctx.closePath();
                    ctx.stroke();

                    // Draw Vertex Handles (Only if NOT locked)
                    if (!this.selectedObject.locked) {
                        if (this.selectedObject instanceof Walkbox) ctx.fillStyle = '#ff0000';
                        else ctx.fillStyle = '#ff00ff';

                        const handleSize = 6 / zoom;
                        for (const pt of poly) {
                            ctx.fillRect(pt.x - handleSize / 2, pt.y - handleSize / 2, handleSize, handleSize);
                        }
                    }
                }
            }
            ctx.restore();
        }

        // Draw Scaling Lines (Horizon and Front)
        // const scene = this.game.sceneManager.currentScene; // Already declared at top
        if (scene && scene.scaling && scene.scaling.enabled && (this.selectedObject as any) === 'SCENE') {
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
            ctx.fillText(`Horizon(${horizonWorldY})`, 5, horizonScreenY - 2);

            // Front Line (Max Scale)
            const frontWorldY = scene.scaling.front;
            const frontScreenY = (frontWorldY - camY) * zoom + halfH;

            ctx.strokeStyle = 'rgba(255, 0, 255, 0.5)'; // Magenta, semi-transparent
            ctx.beginPath();
            ctx.moveTo(0, frontScreenY);
            ctx.lineTo(this.game.canvas.width, frontScreenY);
            ctx.stroke();
            ctx.fillStyle = 'rgba(255, 0, 255, 0.8)';
            ctx.fillText(`Front(${frontWorldY})`, 5, frontScreenY - 2);

            ctx.restore();
        }
    }
}
