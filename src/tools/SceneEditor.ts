import { Entity } from '../entities/Entity';
import { Actor } from '../entities/Actor';
import { Player } from '../entities/Player';
import { SceneObject } from '../entities/SceneObject';
import { Walkbox } from '../entities/Walkbox';
import { Triggerbox } from '../entities/Triggerbox';
import { Geometry } from '../utils/Geometry';
import { Scene } from '../scene/Scene';

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
    creationType: 'Walkbox' | 'Triggerbox' = 'Walkbox';
    draggingVertexIndex: number = -1;
    drawMode: boolean;

    // Event Handlers (Bound)
    private boundClickHandler: (e: Event) => void;
    private boundInputHandler: (e: Event) => void;
    private boundChangeHandler: (e: Event) => void;
    private boundKeyHandler: (e: KeyboardEvent) => void;
    private boundMouseDownHandler: (e: MouseEvent) => void;
    private boundMouseMoveHandler: (e: MouseEvent) => void;
    private boundMouseUpHandler: (e: MouseEvent) => void;

    constructor(game: any) {
        this.game = game;
        this.enabled = false;

        this.currentPolygon = [];
        this.selectedObject = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.isPanning = false;
        this.lastMousePos = { x: 0, y: 0 };
        this.drawMode = false;

        // Bind handlers once for cleanup
        this.boundClickHandler = this.handleGlobalClick.bind(this);
        this.boundInputHandler = this.handleGlobalInput.bind(this);
        this.boundChangeHandler = this.handleGlobalChange.bind(this);
        this.boundKeyHandler = this.handleGlobalKey.bind(this);
        this.boundMouseDownHandler = this.onMouseDown.bind(this);
        this.boundMouseMoveHandler = this.onMouseMove.bind(this);
        this.boundMouseUpHandler = this.onMouseUp.bind(this);
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
        document.removeEventListener('click', this.boundClickHandler);
        document.removeEventListener('input', this.boundInputHandler);
        document.removeEventListener('change', this.boundChangeHandler);
        document.removeEventListener('keydown', this.boundKeyHandler);

        this.game.canvas.removeEventListener('mousedown', this.boundMouseDownHandler);
        window.removeEventListener('mousemove', this.boundMouseMoveHandler);
        window.removeEventListener('mouseup', this.boundMouseUpHandler);

        this.uiInitialized = false;
    }

    setupListeners(): void {
        // UI Interaction Listeners (Delegation)
        document.addEventListener('click', this.boundClickHandler);
        document.addEventListener('input', this.boundInputHandler);
        document.addEventListener('change', this.boundChangeHandler);
        document.addEventListener('keydown', this.boundKeyHandler);

        // Canvas Interaction Listeners
        this.game.canvas.addEventListener('mousedown', this.boundMouseDownHandler);
        window.addEventListener('mousemove', this.boundMouseMoveHandler);
        window.addEventListener('mouseup', this.boundMouseUpHandler);
    }

    /* Event Handlers extracted for cleanup */

    handleGlobalClick(e: Event): void {
        const target = e.target as HTMLElement;
        if (!target) return;

        // Buttons
        if (target.id === 'btn-close-editor') {
            this.toggle();
        } else if (target.id === 'btn-f2-save' || target.id === 'btn-save-json') {
            this.saveScene();
        } else if (target.id === 'btn-f3-load') {
            const f = document.getElementById('file-load-json');
            if (f) f.click();
        } else if (target.id === 'btn-f4-new') {
            this.newScene();
        } else if (target.id === 'btn-clear-walkbox') {
            if (this.game.sceneManager.currentScene && this.selectedObject) {
                const scene = this.game.sceneManager.currentScene;
                if (this.selectedObject instanceof Walkbox) {
                    const index = scene.walkbox.indexOf(this.selectedObject);
                    if (index > -1) scene.walkbox.splice(index, 1);
                    this.startCreating('Walkbox');
                } else if (this.selectedObject instanceof Triggerbox) {
                    const index = scene.triggerboxes.indexOf(this.selectedObject);
                    if (index > -1) scene.triggerboxes.splice(index, 1);
                    this.startCreating('Triggerbox');
                }
            }
        } else if (target.id === 'btn-add-sprite') {
            const spriteInput = document.getElementById('sprite-name-input') as HTMLInputElement;
            const name = spriteInput ? spriteInput.value : 'Sprite';
            if (this.game.sceneManager.currentScene) {
                const sprite = new Entity(160, 100, 30, 30, name || 'Sprite');
                if (name) sprite.setSprite(name);
                sprite.color = '#ffa500';
                this.game.sceneManager.currentScene.addEntity(sprite);

                this.drawMode = false;
                const chk = document.getElementById('chk-draw-mode') as HTMLInputElement;
                if (chk) chk.checked = false;
                this.selectObject(sprite);
                this.refreshHierarchy();
            }
        } else if (target.id === 'btn-camera-reset') {
            if (this.game.sceneManager.currentScene) {
                const s = this.game.sceneManager.currentScene;
                s.camera = { ...s.defaultCamera };
                // Update UI immediately
                const cx = document.getElementById('cam-x') as HTMLInputElement;
                const cy = document.getElementById('cam-y') as HTMLInputElement;
                const cz = document.getElementById('cam-zoom') as HTMLInputElement;
                if (cx) cx.value = Math.round(s.camera.x).toString();
                if (cy) cy.value = Math.round(s.camera.y).toString();
                if (cz) cz.value = s.camera.zoom.toFixed(2);
            }
        } else if (target.id === 'btn-f9-settings') {
            this.selectObject('SETTINGS');
        } else if (target.id === 'btn-save-settings') {
            this.game.saveSettings();
        }

        // Add Object Button
        if (target.id === 'btn-add-object') {
            this.onAddObjectClick(); // Ensure onAddObjectClick calls startCreating
        }
        if (target.id === 'btn-delete-object') {
            this.deleteSelectedObject();
        }
    }

    handleGlobalInput(e: Event): void {
        const target = e.target as HTMLInputElement;
        if (!target) return;

        // F9 Settings Bindings
        if (target.id.startsWith('crt-')) {
            const s = this.game.settings.crt;
            const val = parseFloat(target.value);
            const checked = target.checked;

            if (target.id === 'crt-enabled') s.enabled = checked;
            else if (target.id === 'crt-curvature') s.curvature = val;
            else if (target.id === 'crt-scanlines') s.scanlineCount = val;
            else if (target.id === 'crt-intensity') s.scanlineIntensity = val;
            else if (target.id === 'crt-aberration') s.aberration = val;
            else if (target.id === 'crt-vignette') s.vignette = val;
            else if (target.id === 'crt-phosphor') s.phosphor = val;
            else if (target.id === 'crt-glow') s.bezelGlow = checked;
            else if (target.id === 'crt-bloom') s.bloom = val;
        }

        // Property Inputs - Only update if focused and valid
        if (['prop-name', 'prop-width', 'prop-height', 'prop-x', 'prop-y', 'prop-scale', 'prop-layer', 'prop-state', 'prop-parallax'].includes(target.id)) {
            this.updateEntityFromUI();
        }

        // Scene Title
        if (target.id === 'editor-scene-title') {
            if (this.game.sceneManager.currentScene) {
                this.game.sceneManager.currentScene.name = target.value;
                const display = document.getElementById('scene-title-display');
                if (display) display.textContent = target.value;
            }
        }

        // Camera Inputs (Concurrent Update)
        if (this.game.sceneManager.currentScene) {
            const s = this.game.sceneManager.currentScene;
            if (target.id === 'cam-x') s.camera.x = parseFloat(target.value) || 0;
            if (target.id === 'cam-y') s.camera.y = parseFloat(target.value) || 0;
            if (target.id === 'cam-zoom') s.camera.zoom = parseFloat(target.value) || 1.0;
            if (target.id === 'cam-speed') s.cameraSpeed = parseFloat(target.value) || 5.0;

            if (target.id === 'def-cam-x') s.defaultCamera.x = parseFloat(target.value) || 0;
            if (target.id === 'def-cam-y') s.defaultCamera.y = parseFloat(target.value) || 0;
            if (target.id === 'def-cam-zoom') s.defaultCamera.zoom = parseFloat(target.value) || 1.0;
        }

        // Scaling Config
        if (['scale-min', 'scale-max', 'scale-horizon', 'scale-front'].includes(target.id)) {
            this.updateScalingConfig();
        }
    }

    handleGlobalChange(e: Event): void {
        const target = e.target as HTMLElement;
        if (!target) return;

        if (target.id === 'prop-direction' || target.id === 'prop-image' || target.id === 'prop-no-scaling') {
            this.updateEntityFromUI();
        }
        if (target.id === 'cam-auto-center') {
            if (this.game.sceneManager.currentScene) {
                this.game.sceneManager.currentScene.autoCenter = (target as HTMLInputElement).checked;
            }
        }
        if (target.id === 'cam-speed') {
            if (this.game.sceneManager.currentScene) {
                this.game.sceneManager.currentScene.cameraSpeed = parseFloat((target as HTMLInputElement).value) || 5.0;
            }
        }
        if (target.id === 'chk-draw-mode') {
            this.drawMode = (target as HTMLInputElement).checked;
            if (this.drawMode) this.selectObject(null);
        }
        if (target.id === 'scale-enabled') {
            this.updateScalingConfig();
        }

        if (target.id === 'file-load-json') {
            const input = target as HTMLInputElement;
            if (input.files && input.files[0]) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    if (ev.target) this.loadScene(ev.target.result as string);
                };
                reader.readAsText(input.files[0]);
                input.value = '';
            }
        }
    }

    handleGlobalKey(e: KeyboardEvent): void {
        // Allows opening editor with F1 even if disabled
        if (!this.enabled && e.key !== 'F1') return;

        if (e.key === 'F1') {
            e.preventDefault();
            this.toggle();
        } else if (e.key === 'F9') {
            e.preventDefault();
            this.selectObject('SETTINGS');
        } else if (e.key === 'Delete') {
            // Deletion logic handled in click handler mostly, but shortcut here
            if (this.selectedObject) {
                this.deleteSelectedObject();
            }
        }

        // Other Keys
        // Prevent default for F-keys and Editor keys when editor is open
        if (this.enabled) {
            if (['F2', 'F3', 'F4', 'F5', 's', 'a', 'w', 't', '+', '-', '*', '/'].includes(e.key.toLowerCase())) {
                // e.preventDefault(); // Be careful not to block typing in inputs
            }
        }


        if (!this.enabled) return;

        // Ignore shortcuts if user is typing in an input
        if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) {
            return;
        }

        switch (e.key.toLowerCase()) {
            case 'f2': e.preventDefault(); this.saveScene(); break;
            case 'f3':
                e.preventDefault();
                const f = document.getElementById('file-load-json');
                if (f) f.click();
                break;
            case 'f4': e.preventDefault(); this.newScene(); break;

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
        } else if (type === 'Triggerbox') {
            this.creationType = 'Triggerbox';
            this.currentPolygon = [];
            this.drawMode = true;
            console.log("Draw Mode: Triggerbox");
            this.selectObject(null);
        }
    }

    setupUI(): void {
        console.log('[SceneEditor] Setting up UI Listeners (Delegation)');
        // All event listeners are now handled by the bound handlers in setupListeners()
        // This method remains for any initial UI setup that isn't event binding.
    }

    updateScalingConfig(): void {
        if (this.game.sceneManager.currentScene) {
            const scaleEnabled = document.getElementById('scale-enabled') as HTMLInputElement;
            const scaleMin = document.getElementById('scale-min') as HTMLInputElement;
            const scaleMax = document.getElementById('scale-max') as HTMLInputElement;
            const scaleHorizon = document.getElementById('scale-horizon') as HTMLInputElement;
            const scaleFront = document.getElementById('scale-front') as HTMLInputElement;

            if (scaleEnabled) {
                const s = this.game.sceneManager.currentScene.scaling;
                s.enabled = scaleEnabled.checked;
                s.min = parseFloat(scaleMin?.value) || 0.5;
                s.max = parseFloat(scaleMax?.value) || 1.0;
                s.horizon = parseInt(scaleHorizon?.value) || 150;
                s.front = parseInt(scaleFront?.value) || 300;
            }
        }
    }

    toggle(): void {
        this.enabled = !this.enabled;

        const parserInput = document.getElementById('parser-input') as HTMLInputElement;
        const editorWrapper = document.getElementById('editor-wrapper');

        if (editorWrapper) {
            if (this.enabled) {
                editorWrapper.classList.remove('hidden');
                this.syncUI();
                this.refreshHierarchy();
                this.selectObject('SCENE');

                // Block Parser
                if (parserInput) {
                    parserInput.blur();
                    parserInput.disabled = true;
                }
            } else {
                editorWrapper.classList.add('hidden');
                this.selectedObject = null;

                // Restore Parser
                if (parserInput) {
                    parserInput.disabled = false;
                    parserInput.focus();
                }
            }
        }
    }

    syncUI(): void {
        const scene = this.game.sceneManager.currentScene;
        if (scene) {
            const titleInput = document.getElementById('editor-scene-title') as HTMLInputElement;
            if (titleInput) titleInput.value = scene.name;

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
            this.lastMousePos = { x: e.clientX, y: e.clientY };

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

                    console.log(`[Hitbox] HIT! Entity: ${entity.name}`);
                    this.selectObject(entity);
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
        if (!this.enabled) return;

        // PANNING LOGIC
        if (this.isPanning && this.game.sceneManager.currentScene) {
            const dx = e.clientX - this.lastMousePos.x;
            const dy = e.clientY - this.lastMousePos.y;
            this.lastMousePos = { x: e.clientX, y: e.clientY };

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

        // Only drag Entities for now if not polygon
        if (!(this.selectedObject instanceof Entity)) return;

        // Entity Drag Logic
        const entity = this.selectedObject as Entity;
        const p = entity.parallax !== undefined ? entity.parallax : 1.0;

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
        this.isPanning = false;
    }

    selectObject(obj: any): void {
        this.selectedObject = obj;

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
            if (propScale) propScale.value = (ent.scale || 1.0).toString();
            if (propLayer) propLayer.value = (ent.layer || 0).toString();
            if (propParallax) propParallax.value = (ent.parallax !== undefined ? ent.parallax : 1.0).toString();
            if (propNoScale) propNoScale.checked = ent.ignoreScaling || false;

            if (ent instanceof Actor) {
                if (propDirection) propDirection.value = ent.direction || 'down';
                if (propState) propState.value = ent.state || 'idle';
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

    updateEntityFromUI(): void {
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
        if (propWidth) {
            const rawW = parseInt(propWidth.value) || 1;
            // We want the resulting 'width' to be 'rawW'.
            // Since width = baseWidth * scale, then baseWidth = rawW / scale.
            // However, scale might be updated in the same tick.
            const s = parseFloat(propScale.value) || 1.0;
            ent.baseWidth = rawW / (s !== 0 ? s : 1);
            ent.width = rawW; // Force immediate visual update
        }
        if (propHeight) {
            const rawH = parseInt(propHeight.value) || 1;
            const s = parseFloat(propScale.value) || 1.0;
            ent.baseHeight = rawH / (s !== 0 ? s : 1);
            ent.height = rawH;
        }

        if (propScale) ent.scale = parseFloat(propScale.value) || 1.0;
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
        if (propNoScale) ent.ignoreScaling = propNoScale.checked;

        if (ent instanceof Actor) {
            if (propDirection) ent.setDirection(propDirection.value as any);
            if (propState) ent.setState(propState.value as any);
        }



        this.refreshHierarchy();
    }

    deleteSelectedObject(): void {
        if (!this.selectedObject) return;
        const scene = this.game.sceneManager.currentScene;
        if (scene) {
            if (this.selectedObject instanceof Walkbox) {
                const index = scene.walkbox.indexOf(this.selectedObject);
                if (index > -1) {
                    scene.walkbox.splice(index, 1);
                    console.log('Walkbox deleted');
                }
            } else if (this.selectedObject instanceof Triggerbox) {
                const index = scene.triggerboxes.indexOf(this.selectedObject);
                if (index > -1) {
                    scene.triggerboxes.splice(index, 1);
                    console.log('Triggerbox deleted');
                }
            } else if (this.selectedObject instanceof Entity) {
                const index = scene.entities.indexOf(this.selectedObject);
                if (index > -1) {
                    scene.entities.splice(index, 1);
                    console.log('Entity deleted');
                }
            }

            this.selectedObject = null;
            this.refreshHierarchy();

            // clear Props
            const propName = document.getElementById('prop-name') as HTMLInputElement;
            if (propName) propName.value = '';

            // Hide all sections
            const sectionEntityProps = document.getElementById('section-entity-props');
            const sectionWalkboxProps = document.getElementById('section-walkbox-props');
            if (sectionEntityProps) sectionEntityProps.classList.add('hidden');
            if (sectionWalkboxProps) sectionWalkboxProps.classList.add('hidden');
        }
    }


    saveScene(): void {
        const scene = this.game.sceneManager.currentScene;
        if (!scene) return;
        const data = scene.toJSON();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${scene.id}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    loadScene(jsonString: string): void {
        try {
            const data = JSON.parse(jsonString);
            const newScene = new Scene(data.id || 'loaded_scene', data.name || 'Untitled');

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
                        entity = new Player(entityData.x, entityData.y);
                        // Player constructor sets hardcoded size/sprite, might need to override from saved data
                        // if we want perfect persistence.
                        // For now we assume Player defaults are good, but we should restore position at least (done in constructor).
                    } else if (entityData.type === 'Actor') {
                        entity = new Actor(entityData.x, entityData.y, entityData.width, entityData.height, entityData.name);
                    } else {
                        entity = new Entity(entityData.x, entityData.y, entityData.width, entityData.height, entityData.name);
                    }

                    // Restore common properties
                    entity.color = entityData.color || entity.color;
                    entity.scale = entityData.scale || entity.scale;
                    entity.layer = entityData.layer || entity.layer;
                    entity.parallax = entityData.parallax !== undefined ? entityData.parallax : 1.0;
                    entity.ignoreScaling = !!entityData.ignoreScaling;

                    if (entityData.spriteName) {
                        entity.setSprite(entityData.spriteName);
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
            ctx.fillText(`Horizon (World Y: ${horizonWorldY})`, 5, horizonScreenY - 2);

            // Front Line (Max Scale)
            const frontWorldY = scene.scaling.front;
            const frontScreenY = (frontWorldY - camY) * zoom + halfH;

            ctx.strokeStyle = 'rgba(255, 0, 255, 0.5)'; // Magenta, semi-transparent
            ctx.beginPath();
            ctx.moveTo(0, frontScreenY);
            ctx.lineTo(this.game.canvas.width, frontScreenY);
            ctx.stroke();
            ctx.fillStyle = 'rgba(255, 0, 255, 0.8)';
            ctx.fillText(`Front (World Y: ${frontWorldY})`, 5, frontScreenY - 2);

            ctx.restore();
        }
    }
}
