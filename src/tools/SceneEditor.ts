
import { Entity } from '../entities/Entity';
import { Actor } from '../entities/Actor';
import { SceneObject } from '../entities/SceneObject';
import { Walkbox } from '../entities/Walkbox';
import { Triggerbox } from '../entities/Triggerbox';
import { QuadObject } from '../entities/QuadObject';
import { DefaultActorData, DefaultEntityData } from '../entities/EntityPrefabs';
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
    undoBuffer: any = null; // Stores SceneData for Undo
    drawMode: boolean = false;

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
        document.removeEventListener('keydown', this.boundKeyHandler, { capture: true });

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
        document.addEventListener('keydown', this.boundKeyHandler, { capture: true });
    }

    /* Event Handlers extracted for cleanup */

    /* Legacy Event Handlers Removed */

    // Kept for F-Key shortcuts


    /* handleGlobalInput Removed */

    /* handleGlobalChange Removed */

    saveUndoState(): void {
        const scene = this.game.sceneManager.currentScene;
        if (!scene) return;
        this.undoBuffer = scene.toJSON();
        console.log('[Editor] Undo State Saved');
    }

    restoreSceneState(data: any): void {
        const scene = this.game.sceneManager.currentScene;
        if (!scene) return;

        // Clear existing
        scene.entities = [];
        scene.walkbox = [];
        scene.triggerboxes = [];
        scene.player = null;
        scene.activeSubscene = null;

        // Restore Entities
        if (data.entities) {
            data.entities.forEach((eData: any) => {
                this.createObjectFromData(eData);
            });
        }

        // Restore Walkboxes
        if (data.walkbox) {
            data.walkbox.forEach((wData: any) => {
                this.createObjectFromData({ ...wData, type: 'Walkbox' });
            });
        }

        // Restore Triggerboxes
        if (data.triggerboxes) {
            data.triggerboxes.forEach((tData: any) => {
                this.createObjectFromData({ ...tData, type: 'Triggerbox' });
            });
        }

        // Restore Scene Settings
        if (data.scaling) scene.scaling = { ...data.scaling };
        // We do NOT restore cameraX/Y to allow keeping view focused

        this.selectObject(null);
        this.drawMode = false;
        this.refreshHierarchy();
    }

    undo(): void {
        if (!this.undoBuffer) {
            console.log("[Editor] Nothing to undo.");
            return;
        }

        const scene = this.game.sceneManager.currentScene;
        if (!scene) return;

        console.log("[Editor] Performing Undo...");

        // 1. Capture CURRENT state
        const currentState = scene.toJSON();

        // 2. Restore BACKUP state
        const backupState = this.undoBuffer;
        this.restoreSceneState(backupState);

        // 3. Swap: Backup becomes what was 'Current'
        this.undoBuffer = currentState;

        console.log("[Editor] Undo Complete. State Swapped.");
    }

    handleGlobalKey(e: KeyboardEvent): void {
        // High Priority: Ctrl+D for Duplication (Overrides Chrome Bookmark & Input focus)
        if (this.enabled && e.ctrlKey && e.key.toLowerCase() === 'd') {
            e.preventDefault();
            this.duplicateSelectedObject();
            return;
        }

        // Ctrl+C: Copy Object
        if (this.enabled && e.ctrlKey && e.key.toLowerCase() === 'c') {
            // Only prevent default if we have an object selected, 
            // otherwise let normal copy work (e.g. text in inputs)
            if (this.selectedObject && !(document.activeElement instanceof HTMLInputElement)) {
                e.preventDefault();
                this.copySelectedObjectToClipboard();
                return;
            }
        }

        // Ctrl+V: Paste Object
        if (this.enabled && e.ctrlKey && e.key.toLowerCase() === 'v') {
            if (!(document.activeElement instanceof HTMLInputElement)) {
                // e.preventDefault(); // Don't prevent default, let 'paste' event fire
                // We rely on the global 'paste' event listener which calls handleGlobalPaste
                // But if we want to force it?
                // The 'paste' event is standard.
                return;
            }
        }

        // Ctrl+S: Save Object
        if (this.enabled && e.ctrlKey && e.key.toLowerCase() === 's') {
            e.preventDefault();
            this.saveObject();
            return;
        }

        // Ctrl+O: Load Object
        if (this.enabled && e.ctrlKey && e.key.toLowerCase() === 'o') {
            e.preventDefault();
            this.loadObject();
            return;
        }

        // Alt+D: Toggle Disabled State
        if (this.enabled && e.altKey && e.key.toLowerCase() === 'd') {
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
        if (this.enabled && e.altKey && e.key.toLowerCase() === 'l') {
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
        if (this.enabled && e.ctrlKey && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            this.undo();
            return;
        }


        // Insert: Assign Sprite (Static/Actor)
        if (this.enabled && e.key === 'Insert') {
            e.preventDefault();
            if (this.selectedObject && (this.selectedObject instanceof Entity || this.selectedObject instanceof Actor)) {
                // Check if method exists, else implement inline or warn
                this.promptSetSprite();
            }
            return;
        }



        // Allows opening editor with F1 or F5 even if disabled
        if (!this.enabled && e.key !== 'F1' && e.key !== 'F5') return;

        // F1: Toggle Scene Editor
        if (e.key === 'F1') {
            e.preventDefault();
            e.stopPropagation();

            // Ensure Sprite Editor is closed if switching
            if (this.game.spriteEditor && this.game.spriteEditor.active) {
                this.game.spriteEditor.toggle(false);
            }
            this.toggle();
        } else if (e.key === 'F5') {
            e.preventDefault();
            e.stopPropagation();
            this.game.spriteEditor.toggle();
        } else if (e.key === 'F9') {
            e.preventDefault();
            this.selectObject('SETTINGS');
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
                if (e.shiftKey) this.saveScene(true); // Save As
                else this.saveScene(false); // Quick Save
                break;
            case 'f3':
                e.preventDefault();
                this.promptLoadScene();
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

            case 'f5':
                e.preventDefault();
                this.game.spriteEditor.toggle(true);
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

    // Helper to get World Pos from last mouse pos if inside canvas
    getMouseWorldPosIfOverCanvas(): { x: number, y: number } | null {
        const mx = this.lastMousePos.x;
        const my = this.lastMousePos.y;

        // Basic check if inside canvas
        if (mx >= 0 && mx <= this.game.canvas.width && my >= 0 && my <= this.game.canvas.height) {
            const scene = this.game.sceneManager.currentScene;
            if (scene) {
                const camX = scene.camera.x;
                const camY = scene.camera.y;
                const zoom = scene.camera.zoom;
                const halfW = this.game.canvas.width / 2;
                const halfH = this.game.canvas.height / 2;

                return {
                    x: (mx - halfW) / zoom + camX,
                    y: (my - halfH) / zoom + camY
                };
            }
        }
        return null;
    }

    startCreating(type: string, x?: number, y?: number): void {
        if (!this.game.sceneManager.currentScene) return;

        this.saveUndoState(); // Save before creation

        const scene = this.game.sceneManager.currentScene;


        if (type === 'Static' || type === 'Actor' || type === 'Quad') {
            const nameInput = document.getElementById('new-object-name') as HTMLInputElement;
            let name = nameInput ? nameInput.value : '';

            if (!name) {
                name = type + '_' + Math.floor(Math.random() * 1000);
                if (nameInput) nameInput.value = name; // Feedback to user
            }

            let ent: Entity;
            if (type === 'Actor') {
                // Use Prefab Data
                const data = JSON.parse(JSON.stringify(DefaultActorData));
                data.name = name;
                data.x = x !== undefined ? x : 160;
                data.y = y !== undefined ? y : 100;
                // data.color = '#0000ff'; // Override removed
                ent = Actor.fromJSON(data);
            } else if (type === 'Quad') {
                ent = new QuadObject(name);
                if (x !== undefined && y !== undefined) {
                    // Offset vertices to position
                    (ent as QuadObject).vertices = [
                        { x: x, y: y, p: 1.0 },
                        { x: x + 100, y: y, p: 1.0 },
                        { x: x + 100, y: y + 100, p: 1.0 },
                        { x: x, y: y + 100, p: 1.0 }
                    ];
                    ent.x = x + 50; // Pivot center
                    ent.y = y + 100;
                }
            } else {
                // Use Prefab Data
                const data = JSON.parse(JSON.stringify(DefaultEntityData));
                data.name = name;
                data.x = x !== undefined ? x : 160;
                data.y = y !== undefined ? y : 100;
                // data.color = '#00ff00'; // Removed override, use prefab default
                ent = Entity.fromJSON(data);
            }

            scene.addEntity(ent);
            this.selectObject(ent);
            this.drawMode = false;
        } else if (type === 'Walkbox') {
            // New Flow: Create Object First
            if (!scene.walkbox) scene.walkbox = [];
            const newWalkbox = new Walkbox([], 'Walk_' + Math.floor(Math.random() * 1000));
            scene.walkbox.push(newWalkbox);
            console.log('Walkbox object added to scene (Empty)');
            this.selectObject(newWalkbox);

            // Now start drawing for this object
            this.redrawSelected();

        } else if (type === 'Triggerbox') {
            // New Flow: Create Object First
            if (!scene.triggerboxes) scene.triggerboxes = [];
            const newTrigger = new Triggerbox([], 'Trig_' + Math.floor(Math.random() * 1000));
            scene.triggerboxes.push(newTrigger);
            console.log('Triggerbox object added to scene (Empty)');
            this.selectObject(newTrigger);

            // Now start drawing for this object
            this.redrawSelected();
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
            useEditorStore.getState().setSceneInfo(scene.name, scene.filename || '');
            useEditorStore.getState().incrementObjectVersion();
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
        if (!this.enabled) return;

        // Right Click Panning
        if (e.button === 2) {
            this.isPanning = true;
            this.lastPanPos = { x: e.clientX, y: e.clientY };

            // Disable Auto-Center automatically
            if (this.game.sceneManager.currentScene) {
                this.game.sceneManager.currentScene.autoCenter = false;

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
        const scene = this.game.sceneManager.currentScene;

        if (scene) {
            const camX = scene.camera ? scene.camera.x : 0;
            const camY = scene.camera ? scene.camera.y : 0;
            const zoom = scene.camera ? scene.camera.zoom : 1.0;

            const halfW = this.game.canvas.width / 2;
            const halfH = this.game.canvas.height / 2;

            // 0. CHECK SELECTED POLYGON VERTICES (High Priority)
            if (this.selectedObject && (this.selectedObject instanceof Walkbox || this.selectedObject instanceof Triggerbox || (this.selectedObject as any).type === 'Quad')) {
                if (this.selectedObject.disabled) return; // Prevent interaction if disabled
                // Center-Based: World = (Screen - Center) / Zoom + Camera

                // For QuadObject, World Position of Vertex depends on Parallax.
                // We need to check against "Visible World Position" (P=1 space).

                const worldPos = {
                    x: (pos.x - halfW) / zoom + camX,
                    y: (pos.y - halfH) / zoom + camY
                };

                let poly;
                if ((this.selectedObject as any).type === 'Quad') {
                    // Project Quad Vertices to World P=1 for Hit Test
                    poly = (this.selectedObject as QuadObject).vertices.map((v: any) => ({
                        x: v.x - camX * (v.p - 1.0),
                        y: v.y - camY * (v.p - 1.0)
                    }));
                } else {
                    poly = (this.selectedObject as any).poly;
                }

                const vertexRadius = 6 / zoom; // Hit radius - Match Handle Size roughly (Visualization is hSize=6)

                // Calculate Centroid of Projected Poly for Quad "Inside" shift
                let cx = 0, cy = 0;
                // We need to calc centroid of VISUAL points for Quads
                if ((this.selectedObject as any).type === 'Quad') {
                    poly.forEach((p: any) => { cx += p.x; cy += p.y; });
                    cx /= poly.length;
                    cy /= poly.length;
                }

                // Check vertices
                for (let i = 0; i < poly.length; i++) {
                    let vx = poly[i].x;
                    let vy = poly[i].y;

                    // Apply Quad Shift for Hit Test
                    if ((this.selectedObject as any).type === 'Quad') {
                        const dx = cx - vx;
                        const dy = cy - vy;
                        const len = Math.sqrt(dx * dx + dy * dy);
                        if (len > 0) {
                            const shiftDist = (vertexRadius / 2) + (2 / zoom);
                            vx += (dx / len) * shiftDist;
                            vy += (dy / len) * shiftDist;
                        }
                    }

                    // Strict Hit Test on the Handle Box? 
                    // Visualization is a rect: x-h/2, y-h/2, w=h, h=h.
                    // Math.abs(worldPos.x - vx) < h/2
                    if (Math.abs(worldPos.x - vx) < vertexRadius / 2 && Math.abs(worldPos.y - vy) < vertexRadius / 2) {
                        if (!this.selectedObject.locked) {
                            this.saveUndoState();
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
                    if (!this.selectedObject.locked) {
                        this.saveUndoState();
                        this.isDragging = true;
                        this.draggingVertexIndex = -1; // Drag Whole Body

                        // For QuadObject, DragOffset should be relative to P=1 World Pos
                        this.dragOffset = { x: worldPos.x, y: worldPos.y };
                        useEditorStore.getState().selectVertex(-1); // Deselect vertex when body dragging
                        e.stopPropagation();
                        return;
                    }
                }
            }

            // 0.5 CHECK SELECTED ENTITY (High Priority - Exclusive Interaction)
            if (this.selectedObject && this.selectedObject instanceof Entity && (this.selectedObject as any).type !== 'Quad') {
                if (this.selectedObject.disabled) return; // Prevent interaction if disabled
                const entity = this.selectedObject;

                const p = entity.parallax !== undefined ? entity.parallax : 1.0;

                const vOx = entity.visualOffset ? entity.visualOffset.x : 0;
                const vOy = entity.visualOffset ? entity.visualOffset.y : 0;

                // Entity Screen Rect Calculation
                const screenX = (entity.x - camX * p + vOx) * zoom + halfW;
                const screenY = (entity.y - camY * p + vOy) * zoom + halfH;
                const screenW = entity.width * zoom;
                const screenH = entity.height * zoom;

                const sl = screenX - screenW / 2;
                const sr = screenX + screenW / 2;
                const st = screenY - screenH;
                const sb = screenY;

                // Check Handles (Screen Space)
                // Check Handles (Screen Space)

                const exactHSize = 6;
                let hitHandle = null;

                // NW: (sl, st)
                if (pos.x >= sl && pos.x <= sl + exactHSize && pos.y >= st && pos.y <= st + exactHSize) hitHandle = 'nw';
                // NE: (sr - size, st)
                else if (pos.x >= sr - exactHSize && pos.x <= sr && pos.y >= st && pos.y <= st + exactHSize) hitHandle = 'ne';
                // SW: (sl, sb - size)
                else if (pos.x >= sl && pos.x <= sl + exactHSize && pos.y >= sb - exactHSize && pos.y <= sb) hitHandle = 'sw';
                // SE: (sr - size, sb - size)
                else if (pos.x >= sr - exactHSize && pos.x <= sr && pos.y >= sb - exactHSize && pos.y <= sb) hitHandle = 'se';

                const hitBody = (pos.x >= sl && pos.x <= sr && pos.y >= st && pos.y <= sb);

                if (hitHandle || hitBody) {
                    if (!entity.locked) {
                        this.saveUndoState();
                        this.isDragging = true;
                        this.draggingVertexIndex = -1;

                        if (hitHandle) {
                            this.resizingHandle = hitHandle;
                        } else {
                            // Body Drag
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
            // Iterate reverse to select top-most
            for (let i = entities.length - 1; i >= 0; i--) {
                const entity = entities[i];
                if (entity.disabled) continue;
                if (entity.locked) continue;

                const p = entity.parallax !== undefined ? entity.parallax : 1.0;


                // Entity Screen Rect (With Zoom and Center Pivot)
                // Render Logic:
                // ctx.translate(halfW, halfH);
                // ctx.scale(zoom, zoom);
                // ctx.translate(-camX * p, -camY * p);
                // Entity draws at x, y

                // Entity Screen Rect (With Zoom and Center Pivot)
                // Render Logic:
                // ctx.translate(halfW, halfH);
                // ctx.scale(zoom, zoom);
                // ctx.translate(-camX * p, -camY * p);
                // Entity draws at x, y

                // So ScreenX = (EntityX - CamX*p) * Zoom + HalfW

                const vOx = (entity as any).visualOffset ? (entity as any).visualOffset.x : 0;
                const vOy = (entity as any).visualOffset ? (entity as any).visualOffset.y : 0;

                const screenX = (entity.x - camX * p + vOx) * zoom + halfW;
                const screenY = (entity.y - camY * p + vOy) * zoom + halfH;
                const screenW = entity.width * zoom;
                const screenH = entity.height * zoom;

                // Mouse World Pos for this entity layer
                const worldX = (pos.x - halfW) / zoom + camX * p - vOx;
                const worldY = (pos.y - halfH) / zoom + camY * p - vOy;

                if (entity.hitTest(worldX, worldY)) {

                    // HIT! Entity: ${entity.name}
                    this.selectObject(entity);

                    // Stop propagation to prevent deselection, but DO NOT start drag yet.
                    // User must click again on the selected object to drag.
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
                    if (wb.disabled) continue;
                    if (wb.locked) continue;
                    if (Geometry.isPointInPolygon(worldPos, wb.poly)) {
                        this.selectObject(wb);
                        // Selection Only
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
                        this.selectObject(tb);
                        // Selection Only
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

            // Disable Auto-Center on manual move
            // Disable Auto-Center on manual move
            if (s.autoCenter) {
                s.autoCenter = false;
                // Notify UI if we are viewing Scene properties (no selected object)
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

        if (!this.isDragging || !this.selectedObject) return;

        const pos = this.getMousePos(e);
        const scene = this.game.sceneManager.currentScene;
        const camX = scene && scene.camera ? scene.camera.x : 0;
        const camY = scene && scene.camera ? scene.camera.y : 0;
        const zoom = scene && scene.camera ? scene.camera.zoom : 1.0;

        const halfW = this.game.canvas.width / 2;
        const halfH = this.game.canvas.height / 2;

        // Polygon Dragging (Walkbox/Triggerbox/Rect)
        if (this.selectedObject instanceof Walkbox || this.selectedObject instanceof Triggerbox || (this.selectedObject as any).type === 'Quad') {
            const worldPos = {
                x: (pos.x - halfW) / zoom + camX,
                y: (pos.y - halfH) / zoom + camY
            };

            if (this.draggingVertexIndex >= 0) {
                // Drag Vertex (with Parallax compensation for Rects)
                if ((this.selectedObject as any).type === 'Quad') {
                    const verts = (this.selectedObject as any).vertices; // QuadObject
                    const v = verts[this.draggingVertexIndex];

                    // Basic Position
                    // For Quads, vertices store world pos directly (including parallax offset?)
                    // wait, render applies parallax: v.x + offX
                    // So v.x is the "base" world pos?
                    // Previous logic (not visible here but standard):
                    // We need to inverse the parallax to find the True World Pos?
                    // "QuadObject.ts": render uses: x = v.x - camX*(v.p-1).
                    // So if we are dragging at MouseWorldPos, we need to set v.x such that:
                    // MouseWorldPos = v.x - camX*(v.p-1)
                    // v.x = MouseWorldPos + camX*(v.p-1)

                    const p = v.p || 1.0;
                    const offX = -camX * (p - 1.0);
                    const offY = -camY * (p - 1.0);

                    // Inverse Logic: v.x = WorldPos - Offset
                    v.x = worldPos.x - offX;
                    v.y = worldPos.y - offY;

                    // SNAP Logic (Alt Key)
                    if (e.altKey) {
                        const snapDist = 50 / zoom; // 50 screen pixels? User said "50 pixels". Assuming screen or world? Usually screen makes sense for UI.
                        // Let's assume 50 "World Units" if zoom is 1? Or 50 screen pixels.
                        // "closer than 50 pixels" usually implies screen distance visually.

                        let closestDist = snapDist;
                        let snapTarget: { x: number, y: number, p?: number } | null = null;

                        // Check other Quads
                        // Check other Quads
                        const scene = this.game.sceneManager.currentScene;
                        if (scene) {
                            scene.entities.forEach((ent: any) => {
                                if (ent === this.selectedObject) return; // Skip self
                                if (ent.type === 'Quad') {
                                    const q = ent as any;
                                    // Quads usually store parallax per vertex or global? 
                                    // QuadObject.ts has 'parallax' property, but vertices have 'p'. 
                                    // Editor usually edits vertices[i].p. 
                                    // If we are snapping to a generated grid, that grid lies on the surface.
                                    // A bilinear patch interpolates World X, World Y, AND Parallax P.

                                    if (q.vertices) {
                                        // 1. Vertex Snapping
                                        q.vertices.forEach((qv: any) => {
                                            const vP = qv.p !== undefined ? qv.p : 1.0;
                                            const qOffX = -camX * (vP - 1.0);
                                            const qOffY = -camY * (vP - 1.0);
                                            const qVisualX = qv.x + qOffX;
                                            const qVisualY = qv.y + qOffY;

                                            const dist = Math.sqrt(Math.pow(qVisualX - worldPos.x, 2) + Math.pow(qVisualY - worldPos.y, 2));

                                            if (dist < closestDist) {
                                                closestDist = dist;
                                                snapTarget = { x: qVisualX, y: qVisualY };
                                            }
                                        });

                                        // 2. Retro Grid Snapping
                                        if (q.isGrid && q.gridLines > 0) {
                                            const STEPS = q.gridLines + 1;
                                            const v0 = q.vertices[0];
                                            const v1 = q.vertices[1];
                                            const v2 = q.vertices[2]; // BR
                                            const v3 = q.vertices[3]; // BL

                                            if (v0 && v1 && v2 && v3) {
                                                for (let i = 0; i <= STEPS; i++) {
                                                    const u = i / STEPS;
                                                    for (let j = 0; j <= STEPS; j++) {
                                                        const v = j / STEPS;

                                                        // Bilinear Interpolation
                                                        // Top: v0 -> v1
                                                        const tx = v0.x + (v1.x - v0.x) * u;
                                                        const ty = v0.y + (v1.y - v0.y) * u;
                                                        const tp = (v0.p || 1) + ((v1.p || 1) - (v0.p || 1)) * u;

                                                        // Bottom: v3 -> v2
                                                        const bx = v3.x + (v2.x - v3.x) * u;
                                                        const by = v3.y + (v2.y - v3.y) * u;
                                                        const bp = (v3.p || 1) + ((v2.p || 1) - (v3.p || 1)) * u;

                                                        // Surface
                                                        const px = tx + (bx - tx) * v;
                                                        const py = ty + (by - ty) * v;
                                                        const pp = tp + (bp - tp) * v;

                                                        // Visual Pos
                                                        const offX = -camX * (pp - 1.0);
                                                        const offY = -camY * (pp - 1.0);
                                                        const VisX = px + offX;
                                                        const VisY = py + offY;

                                                        const dist = Math.sqrt(Math.pow(VisX - worldPos.x, 2) + Math.pow(VisY - worldPos.y, 2));

                                                        if (dist < closestDist) {
                                                            closestDist = dist;
                                                            snapTarget = { x: VisX, y: VisY, p: pp };
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            });
                        }

                        if (snapTarget) {
                            // Apply Snapped Parallax (Z-Depth) if available
                            if (snapTarget.p !== undefined) {
                                v.p = snapTarget.p;
                            }

                            // Recalculate Offset with (possibly new) P to find correct Base World Pos
                            const newP = v.p || 1.0;
                            const newOffX = -camX * (newP - 1.0);
                            const newOffY = -camY * (newP - 1.0);

                            // v.x = VisualX - Offset
                            v.x = snapTarget.x - newOffX;
                            v.y = snapTarget.y - newOffY;
                        }

                    } else if (e.shiftKey) {
                        // ** Angle Snapping (Shift) **
                        const verts = (this.selectedObject as any).vertices; // We know it's a Quad
                        if (verts && verts.length > 0) {
                            const prevIndex = (this.draggingVertexIndex - 1 + verts.length) % verts.length;
                            const anchor = verts[prevIndex];

                            // Snap current v (Base Pos) to Anchor (Base Pos)
                            const snapped = this.getSnappedPos({ x: v.x, y: v.y }, anchor);

                            v.x = snapped.x;
                            v.y = snapped.y;
                        }
                    }

                    // Sync UI
                    useEditorStore.getState().incrementObjectVersion();

                } else {
                    // Walkbox/Triggerbox (Standard)
                    const poly = (this.selectedObject as any).poly || (this.selectedObject as any).vertices;


                    if (e.shiftKey) {
                        const prevIndex = (this.draggingVertexIndex - 1 + poly.length) % poly.length;
                        const anchor = poly[prevIndex];
                        const snapped = this.getSnappedPos(worldPos, anchor);
                        poly[this.draggingVertexIndex].x = snapped.x;
                        poly[this.draggingVertexIndex].y = snapped.y;
                    } else {
                        poly[this.draggingVertexIndex].x = Math.round(worldPos.x);
                        poly[this.draggingVertexIndex].y = Math.round(worldPos.y);
                    }
                }
            } else {
                // Drag Whole Body
                const dx = worldPos.x - this.dragOffset.x;
                const dy = worldPos.y - this.dragOffset.y;

                if (dx !== 0 || dy !== 0) {
                    if ((this.selectedObject as any).type === 'Quad') {
                        const quad = this.selectedObject as QuadObject;
                        for (const v of quad.vertices) {
                            v.x += dx;
                            v.y += dy;
                        }
                        quad.x += dx;
                        quad.y += dy;
                    } else {
                        // Cast to any to access poly
                        const obj = this.selectedObject as any;
                        if (obj.poly) {
                            for (const pt of obj.poly) {
                                pt.x += dx;
                                pt.y += dy;
                            }
                        }
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

            const vOx = (entity as any).visualOffset ? (entity as any).visualOffset.x : 0;
            const vOy = (entity as any).visualOffset ? (entity as any).visualOffset.y : 0;

            const mouseWorldX = (pos.x - halfW) / zoom + camX * p - vOx;
            const mouseWorldY = (pos.y - halfH) / zoom + camY * p - vOy;

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

            // 2. Proportional Scaling (Shift Key)
            if (e.shiftKey) {
                const startW = currentR - currentL;
                const startH = currentB - currentT;
                // Avoid division by zero
                if (startH !== 0) {
                    const aspect = startW / startH;

                    // Calculate proposed dimensions based on mouse move
                    let propW = Math.abs(newR - newL);
                    let propH = Math.abs(newB - newT);

                    // Use the larger relative change or just Width as master?
                    // Simple "Width drives Height" is predictable for corner drags.
                    // But if dragging more vertically, might feel weird.
                    // Let's use the larger dimension to drive.

                    if (propW > propH * aspect) {
                        // Width is dominant
                        propH = propW / aspect;
                    } else {
                        // Height is dominant
                        propW = propH * aspect;
                    }

                    // Re-apply to edges based on fixed corner
                    if (this.resizingHandle === 'nw') {
                        // Fixed: BR
                        newL = newR - propW;
                        newT = newB - propH;
                    } else if (this.resizingHandle === 'ne') {
                        // Fixed: BL
                        newR = newL + propW;
                        newT = newB - propH;
                    } else if (this.resizingHandle === 'sw') {
                        // Fixed: TR
                        newL = newR - propW;
                        newB = newT + propH;
                    } else if (this.resizingHandle === 'se') {
                        // Fixed: TL
                        newR = newL + propW;
                        newB = newT + propH;
                    }
                }
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

        if (obj === null || obj === undefined) {
            // Deselect
            type = null;
            id = null;
        } else if (obj === 'SCENE') {
            type = 'SCENE';
            id = 'SCENE';
        } else if (obj === 'SETTINGS') {
            type = 'SETTINGS';
            id = 'SETTINGS';
        } else if (obj.type === 'Quad') {
            type = 'Quad';
            id = obj.name;
        } else if (obj instanceof Actor) {
            type = 'Actor';
            id = obj.name;
        } else if (obj instanceof Entity) {
            type = 'Entity'; // Used for generic/static entities
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
                    div.innerText = `${typeChar}:${entity.name} `;

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
                        div.innerText = `W:${wb.name || 'Walkbox ' + i} `;
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
                        div.innerText = `T:${trigger.name || 'Trigger'} `;
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
        useEditorStore.getState().incrementObjectVersion();
    }

    updateEntityFromUI(triggerId?: string): void {
        if (!this.selectedObject || !(this.selectedObject instanceof Entity)) return;

        this.saveUndoState(); // Save before modification

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

        this.saveUndoState(); // Save before duplication

        let data: any;
        if (this.selectedObject.toJSON) {
            // Deep Clone to prevent reference mutation of Original Object components
            data = JSON.parse(JSON.stringify(this.selectedObject.toJSON()));
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

        // Fix Component References (Self-Targeting)
        if (data.components) {
            data.components.forEach((comp: any) => {
                // If Backface component targets the original object (self), update to new name
                if (comp.type === 'Backface' && comp.targetId === baseName) {
                    comp.targetId = newName;
                }
                // Handle Subscene references? Usually Subscene targets a GroupID or separate object.
                // If it targets THIS object's name (unlikely for Subscene), we might need to update.
            });
        }

        // Use unified creation
        const newObj = this.createObjectFromData(data);
        if (newObj) {
            console.log(`Duplicated: ${baseName} -> ${newName} `);
            this.selectObject(newObj);
            this.refreshHierarchy();
        }
    }


    setActorIsPlayer(actor: Actor, value: boolean): void {
        const scene = this.game.sceneManager.currentScene;
        if (!scene) return;

        console.log(`[Editor] Setting isPlayer for ${actor.name} to ${value} `);

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
            // Apply Overrides to data
            data.x = x;
            data.y = y;

            if (type === 'Walkbox') {
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
                if (data.mode) newObj.mode = data.mode;
                // Restore SceneObject properties
                if (data.groupID) newObj.groupID = data.groupID;
                if (data.locked) newObj.locked = data.locked;
                if (data.disabled) newObj.disabled = data.disabled;
                if (data.customName) newObj.customName = data.customName;
                if (data.interactions) newObj.interactions = data.interactions;
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
                // Restore SceneObject properties
                if (data.groupID) newObj.groupID = data.groupID;
                if (data.components) newObj.components = JSON.parse(JSON.stringify(data.components)); // Deep copy components
                if (data.locked) newObj.locked = data.locked;
                if (data.disabled) newObj.disabled = data.disabled;
                if (data.customName) newObj.customName = data.customName;
                if (data.interactions) newObj.interactions = data.interactions;

            } else if (type === 'Quad') {
                newObj = QuadObject.fromJSON(data);
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
                newObj = Actor.fromJSON(data);
            } else if (type === 'Player') {
                newObj = Actor.fromJSON({ ...data, type: 'Actor', isPlayer: true });
            } else if (type === 'Static' || type === 'Entity') {
                newObj = Entity.fromJSON(data);
            }
            // Fallback
            if (!newObj) {
                if (type !== 'Walkbox' && type !== 'Triggerbox') {
                    newObj = Entity.fromJSON(data);
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
            this.saveUndoState(); // Save before paste
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

                // Fix Component References (Self-Targeting)
                if (data.components) {
                    const baseName = match ? match[1] + '_' + match[2] : data.name; // Logic here is a bit tricky if we stripped suffix
                    // Wait, match was done on 'data.name' (Incoming 'Entity_1').
                    // match[1] = 'Entity'.
                    // baseName used above was 'Entity_1'.
                    // If we paste 'Entity_1', we generate 'Entity_2'.
                    // We need to check if component targets 'Entity_1'.

                    const srcName = (scene.entities.find((e: any) => e.name === data.name)) ? data.name : data.name;

                    data.components.forEach((comp: any) => {
                        if (comp.type === 'Backface') {
                            // Heuristic: If targetId equals the original name of the pasted data, update it.
                            if (comp.targetId === srcName || comp.targetId === data.name) {
                                comp.targetId = newName;
                            }
                        }
                    });
                }
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

            this.currentPolygon = [];
            this.creationType = type as any;
            this.drawMode = true;

            // UI Feedback
            const chk = document.getElementById('chk-draw-mode') as HTMLInputElement;
            if (chk) chk.checked = true;

            if (type === 'Walkbox') useEditorStore.getState().setMode('DRAW_WALKBOX');
            else useEditorStore.getState().setMode('DRAW_TRIGGER');

            console.log(`Redrawing ${type}: ${this.selectedObject.name} `);
        }
    }


    async saveScene(saveAs: boolean = false): Promise<void> {
        const scene = this.game.sceneManager.currentScene;
        if (!scene) return;

        // Smart Save (F2) Logic
        // 1. If SAVE AS (Shift+F2), always prompt.
        // 2. If Quick Save (F2):
        //    a. If ID is valid (not 'new_scene', not empty), save directly to <id>.json.
        //    b. If ID is 'new_scene' or empty, fallback to File Browser.

        const id = scene.id || '';
        // Allow backslashes for subfolders
        const isValidId = id && id !== 'new_scene';

        if (!saveAs && isValidId) {
            // Smart Save
            // Ensure filename property matches ID (normalized for file system)
            scene.filename = id.replace(/\\/g, '/');
            this.performSaveScene(scene.filename);
            return;
        }

        // Fallback / Save As
        this.game.openFileBrowser('save', 'public/scenes', (filename: string) => {
            // Update Filename from browser selection
            const name = filename.replace('.json', '');

            // Normalize slashes for ID: use backslash for subfolders
            const idFromName = name.replace(/\//g, '\\');

            scene.filename = name;
            scene.id = idFromName;

            this.syncUI(); // Refresh UI to show new Filename
            this.performSaveScene(scene.filename);
        });
    }

    async performSaveScene(filenameId: string): Promise<void> {
        const scene = this.game.sceneManager.currentScene;
        if (!scene) return;

        // Ensure filenameId uses forward slashes for URL/Path
        const normalizedPath = filenameId.replace(/\\/g, '/');

        const data = scene.toJSON();
        const json = JSON.stringify(data, null, 2);
        const filePath = `public/scenes/${normalizedPath}.json`;

        try {
            const response = await fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: filePath, content: json })
            });

            if (response.ok) {
                console.log('Scene saved to server:', filePath);
                // Use Toast Message
                this.game.showNotification(`Scene saved as ${normalizedPath}.json`);
            } else {
                throw new Error(await response.text());
            }
        } catch (e) {
            console.error('Failed to save scene:', e);
            this.game.showNotification(`Error saving scene: ${e}`);
        }
    }

    promptLoadScene(): void {
        this.game.openFileBrowser('load', 'public/scenes', async (filename: string) => {
            await this.game.sceneManager.loadScene(filename);
            this.syncUI();
            this.refreshHierarchy();
            this.selectObject(null);
        });
    }





    async saveObject(): Promise<void> {
        if (!this.selectedObject || !(this.selectedObject instanceof Entity)) {
            this.game.showNotification("Select an Object to Save");
            return;
        }

        this.game.openFileBrowser('save', 'public/prefabs', (filename: string) => {
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
                this.game.showNotification(`Prefab Saved: ${filename} `);
            } else {
                throw new Error(await response.text());
            }
        } catch (e) {
            console.error('Failed to save prefab:', e);
            this.game.showNotification(`Error: ${e} `);
        }
    }

    async loadObject(): Promise<void> {
        if (!this.game.sceneManager.currentScene) return;
        this.game.openFileBrowser('load', 'public/prefabs', (filename: string) => {
            this.performLoadObject(filename);
        });
    }

    promptSetSprite(): void {
        if (!this.selectedObject || !(this.selectedObject instanceof Entity)) return;

        this.game.openFileBrowser('load', 'public/sprites', (filename: string) => {
            // Logic to set sprite
            const ent = this.selectedObject as Entity;
            // Assume browser returns "chars/hero.json" or "folder/hero.json"
            // We want "folder/hero" or "chars/hero" for internal use? 
            // setSprite typically expects "path/name".

            const spriteName = filename.replace('.json', '');
            ent.setSprite(spriteName);
            this.updateUIFromObject();
        });
    }

    async performLoadObject(filename: string): Promise<void> {
        try {
            const response = await fetch(`/prefabs/${filename}?t=${Date.now()}`);
            if (!response.ok) throw new Error('File not found');
            const data = await response.json();

            // Validate data
            if (!data.type) data.type = 'Static'; // Default

            // Logic 2 & 3: ID Derivation & Collision
            // Filename: "folder/chair.json" -> ID: "folder\chair"
            const baseId = filename.replace('.json', '').replace(/\//g, '\\');

            // Check Collision against current scene objects
            const scene = this.game.sceneManager.currentScene;
            if (scene) {
                const allObjects = [
                    ...(scene.entities || []),
                    ...(scene.walkbox || []),
                    ...(scene.triggerboxes || [])
                ];

                // Override name in data to be the ID (or base it off ID)
                // Actually, objects have 'name', not 'id'. We treat 'name' as unique identifier in Editor.
                // So we format the name as "folder\chair".

                let newName = baseId;
                let counter = 1;

                const isNameTaken = (n: string) => allObjects.some((o: any) => o.name === n);

                if (isNameTaken(newName)) {
                    // Try name_1, name_2...
                    while (isNameTaken(`${baseId}_${counter}`)) {
                        counter++;
                    }
                    newName = `${baseId}_${counter}`;
                }

                data.name = newName;
            }

            const entity = this.createObjectFromData(data);

            if (entity) {
                this.selectObject(entity);
                this.refreshHierarchy();
            }

        } catch (e) {
            console.error(e);
            this.game.showNotification("Failed to load prefab");
        }
    }

    // Renamed from loadScene to loadSceneData to differentiate from file fetching


    onClick(x: number, y: number): boolean {
        console.log(`[Editor] onClick: ${x}, ${y}, Enabled: ${this.enabled}, DrawMode: ${this.drawMode} `);
        if (!this.enabled) return false;

        // If in Draw Mode, add points
        if (this.drawMode) {
            console.log(`OnClick in DrawMode: ${x}, ${y} `);

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

            // SNAP LOGIC
            let finalX = Math.round(worldX);
            let finalY = Math.round(worldY);

            if (this.game.input.isDown('Shift') && this.currentPolygon.length > 0) {
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

    finishPolygon(): void {
        console.log('finishPolygon called');
        if (this.currentPolygon && this.currentPolygon.length > 2) {
            // Instead of creating NEW object, assign to SELECTED object (if valid)
            if (this.selectedObject && (this.selectedObject instanceof Walkbox || this.selectedObject instanceof Triggerbox)) {
                this.selectedObject.poly = [...this.currentPolygon];
                console.log("Polygon updated for " + this.selectedObject.name);
            } else {
                // Fallback if somehow lost selection (shouldn't happen with new flow, but good safety)
                console.warn("No valid object selected for polygon completion!");
            }

            this.currentPolygon = [];
            this.drawMode = false;

            const chk = document.getElementById('chk-draw-mode') as HTMLInputElement;
            if (chk) chk.checked = false;

            // Reset Mode string
            useEditorStore.getState().setMode('SELECT');

            this.refreshHierarchy();
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
        if (scene.triggerboxes && this.selectedObject instanceof Triggerbox) {
            scene.triggerboxes.forEach((trigger: any) => {
                const poly = trigger.poly;
                if (!poly || poly.length === 0) return;
                if (trigger.disabled) return; // Skip disabled triggers

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
                            if (this.isDragging && this.draggingVertexIndex === i) {
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
