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
    panel: HTMLElement | null;
    hierarchyPanel: HTMLElement | null;
    entityList: HTMLElement | null;
    currentPolygon: { x: number, y: number }[];
    selectedObject: SceneObject | null;
    isDragging: boolean;
    dragOffset: { x: number, y: number };
    creationType: 'Walkbox' | 'Triggerbox' = 'Walkbox';
    draggingVertexIndex: number = -1;
    drawMode: boolean;

    // UI Elements
    titleInput: HTMLInputElement | null;
    spriteInput: HTMLInputElement | null;
    fileInput: HTMLInputElement | null;
    chkDrawMode: HTMLInputElement | null;
    propPanel: HTMLElement | null;
    propName: HTMLInputElement | null;
    propImage: HTMLInputElement | null;
    propX: HTMLInputElement | null;
    propY: HTMLInputElement | null;
    propWidth: HTMLInputElement | null;
    propHeight: HTMLInputElement | null;
    propScale: HTMLInputElement | null;
    propLayer: HTMLInputElement | null;
    propActorGroup: HTMLElement | null;
    propDirection: HTMLSelectElement | null;
    propState: HTMLInputElement | null;
    // propWalkboxName removed - unified Model
    scaleEnabled: HTMLInputElement | null;
    scaleMin: HTMLInputElement | null;
    scaleMax: HTMLInputElement | null;
    scaleHorizon: HTMLInputElement | null;
    scaleFront: HTMLInputElement | null;

    // Sections
    sectionSceneProps: HTMLElement | null;
    sectionEntityProps: HTMLElement | null;
    sectionWalkboxProps: HTMLElement | null;
    scenePropertiesItem: HTMLElement | null;
    editorWrapper: HTMLElement | null;

    constructor(game: any) {
        this.game = game;
        this.enabled = false;
        this.panel = null;
        this.hierarchyPanel = null;
        this.entityList = null;
        this.editorWrapper = null;

        this.currentPolygon = [];
        this.selectedObject = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.drawMode = false;

        // Initialize nulls
        this.titleInput = null;
        this.spriteInput = null;
        this.fileInput = null;
        this.chkDrawMode = null;
        this.propPanel = null;
        this.propName = null;
        this.propImage = null;
        this.propX = null;
        this.propY = null;
        this.propWidth = null;
        this.propHeight = null;
        this.propScale = null;
        this.propLayer = null;
        this.propActorGroup = null;
        this.propDirection = null;
        this.propState = null;

        this.scaleEnabled = null;
        this.scaleMin = null;
        this.scaleMax = null;
        this.scaleHorizon = null;
        this.scaleFront = null;

        this.sectionSceneProps = null;
        this.sectionEntityProps = null;
        this.sectionWalkboxProps = null;
        this.scenePropertiesItem = null;
    }

    initUI(): void {
        console.log('[SceneEditor] Initializing UI...');
        this.editorWrapper = document.getElementById('editor-wrapper');
        this.panel = document.getElementById('editor-panel');
        this.hierarchyPanel = document.getElementById('hierarchy-panel');
        this.entityList = document.getElementById('entity-list');

        this.titleInput = document.getElementById('editor-scene-title') as HTMLInputElement;
        this.spriteInput = document.getElementById('sprite-name-input') as HTMLInputElement;
        this.fileInput = document.getElementById('file-load-json') as HTMLInputElement;
        this.chkDrawMode = document.getElementById('chk-draw-mode') as HTMLInputElement;

        this.propPanel = document.getElementById('editor-panel');
        this.sectionEntityProps = document.getElementById('section-entity-props');
        this.sectionWalkboxProps = document.getElementById('section-walkbox-props');
        this.scenePropertiesItem = document.getElementById('scene-properties-item');

        this.propName = document.getElementById('prop-name') as HTMLInputElement;
        this.propImage = document.getElementById('prop-image') as HTMLInputElement;
        this.propX = document.getElementById('prop-x') as HTMLInputElement;
        this.propY = document.getElementById('prop-y') as HTMLInputElement;
        this.propWidth = document.getElementById('prop-width') as HTMLInputElement;
        this.propHeight = document.getElementById('prop-height') as HTMLInputElement;
        this.propScale = document.getElementById('prop-scale') as HTMLInputElement;
        this.propLayer = document.getElementById('prop-layer') as HTMLInputElement;
        this.propActorGroup = document.getElementById('prop-actor-group');
        this.propDirection = document.getElementById('prop-direction') as HTMLSelectElement;
        this.propState = document.getElementById('prop-state') as HTMLInputElement;
        // propWalkboxName removed

        // Property Updates
        [this.propName, this.propWidth, this.propHeight, this.propX, this.propY, this.propScale, this.propLayer, this.propDirection, this.propState].forEach(input => {
            if (input) input.oninput = () => this.updateEntityFromUI();
            if (input && input.tagName === 'SELECT') input.onchange = () => this.updateEntityFromUI();
        });

        this.scaleEnabled = document.getElementById('scale-enabled') as HTMLInputElement;
        this.scaleMin = document.getElementById('scale-min') as HTMLInputElement;
        this.scaleMax = document.getElementById('scale-max') as HTMLInputElement;
        this.scaleHorizon = document.getElementById('scale-horizon') as HTMLInputElement;
        this.scaleFront = document.getElementById('scale-front') as HTMLInputElement;

        // Bind New Buttons
        const btnAdd = document.getElementById('btn-add-object');
        if (btnAdd) btnAdd.onclick = () => this.onAddObjectClick();

        const btnDel = document.getElementById('btn-delete-object');
        if (btnDel) btnDel.onclick = () => this.deleteSelectedObject();

        const btnSaveObj = document.getElementById('btn-save-object');
        if (btnSaveObj) btnSaveObj.onclick = () => {
            // ... save object logic is SceneObject-compatible
            if (this.selectedObject && this.selectedObject instanceof SceneObject && this.selectedObject.name !== 'SCENE') {
                const data = this.selectedObject.toJSON();
                const json = JSON.stringify(data, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${this.selectedObject.name}.json`;
                a.click();
                URL.revokeObjectURL(url);
            } else {
                alert('Select an Entity to save');
            }
        };

        const fileLoadObj = document.getElementById('file-load-object') as HTMLInputElement;
        if (fileLoadObj) fileLoadObj.onchange = () => {
            // ToDo: Implement Object Load
            alert('Load Object not implemented yet');
        };

        const btnClose = document.getElementById('btn-close-editor');
        if (btnClose) btnClose.onclick = () => this.toggle();

        this.setupListeners();
        this.setupUI();
        console.log('[SceneEditor] UI Initialized');
    }

    onAddObjectClick(): void {
        const select = document.getElementById('add-object-type') as HTMLSelectElement;
        const type = select ? select.value : 'Static';
        this.startCreating(type);
    }

    setupListeners(): void {
        // Toggle Key
        window.addEventListener('keydown', (e) => {
            // Prevent default for F-keys and Editor keys when editor is open
            if (this.enabled) {
                if (['F2', 'F3', 'F4', 'F5', 's', 'a', 'w', 't', '+', '-', '*', '/'].includes(e.key.toLowerCase())) {
                    // e.preventDefault(); // Be careful not to block typing in inputs
                }
            }

            if (e.key === 'F1') {
                e.preventDefault();
                this.toggle();
                return;
            }

            if (!this.enabled) return;

            // Ignore shortcuts if user is typing in an input
            if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) {
                return;
            }

            switch (e.key.toLowerCase()) {
                case 'f2': e.preventDefault(); this.saveScene(); break;
                case 'f3': e.preventDefault(); if (this.fileInput) this.fileInput.click(); break;
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

                case 'delete':
                    if (this.selectedObject) this.deleteSelectedObject();
                    break;

                case 'enter':
                    if (!e.ctrlKey) this.finishPolygon();
                    break;

                case 'escape':
                    this.drawMode = false;
                    this.currentPolygon = [];
                    if (this.chkDrawMode) this.chkDrawMode.checked = false;
                    console.log("[Editor] Draw Mode Cancelled");
                    break;
            }
        });

        // Mouse Dragging
        this.game.canvas.addEventListener('mousedown', (e: MouseEvent) => this.onMouseDown(e));
        this.game.canvas.addEventListener('mousemove', (e: MouseEvent) => this.onMouseMove(e));
        this.game.canvas.addEventListener('mouseup', () => this.onMouseUp());
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
            if (this.chkDrawMode) this.chkDrawMode.checked = true;
            this.selectObject(null);
            console.log("Draw Mode: Walkbox");
        } else if (type === 'Triggerbox') {
            this.creationType = 'Triggerbox';
            this.currentPolygon = [];
            this.drawMode = true;
            // distinct draw mode or shared? For now shared but logged
            console.log("Draw Mode: Triggerbox");
            // Ideally set a 'drawType' or similar if we want to distinguish
            // For now, let's treat it same as Walkbox for the UI interaction part
            this.selectObject(null);
        }
    }

    setupUI(): void {
        // Close Button
        const closeBtn = document.getElementById('btn-close-editor');
        if (closeBtn) closeBtn.onclick = () => this.toggle();

        // Scene Properties Click
        if (this.scenePropertiesItem) {
            this.scenePropertiesItem.onclick = () => {
                this.selectObject('SCENE');
            };
        }

        // F-Key Buttons
        const btnSave = document.getElementById('btn-f2-save');
        if (btnSave) btnSave.onclick = () => this.saveScene();

        const btnLoad = document.getElementById('btn-f3-load');
        if (btnLoad && this.fileInput) btnLoad.onclick = () => this.fileInput!.click();

        const btnNew = document.getElementById('btn-f4-new');
        if (btnNew) btnNew.onclick = () => this.newScene();

        // Draw Mode Toggle
        if (this.chkDrawMode) {
            this.chkDrawMode.onchange = (e: Event) => {
                this.drawMode = (e.target as HTMLInputElement).checked;
                if (this.drawMode) {
                    this.selectObject(null);
                }
            };
        }

        // Clear Walkbox
        const clearBtn = document.getElementById('btn-clear-walkbox');
        if (clearBtn) {
            clearBtn.onclick = () => {
                if (this.game.sceneManager.currentScene) {
                    this.game.sceneManager.currentScene.walkbox = [];
                    this.currentPolygon = [];
                    console.log('Walkbox cleared');
                    this.refreshHierarchy();
                }
            };
        }

        // Add Sprite
        const addSpriteBtn = document.getElementById('btn-add-sprite');
        if (addSpriteBtn) {
            addSpriteBtn.onclick = () => {
                const name = this.spriteInput ? this.spriteInput.value : 'Sprite';
                if (this.game.sceneManager.currentScene) {
                    const sprite = new Entity(160, 100, 30, 30, name || 'Sprite');
                    if (name) sprite.setSprite(name);
                    sprite.color = '#ffa500';
                    this.game.sceneManager.currentScene.addEntity(sprite);

                    this.drawMode = false;
                    if (this.chkDrawMode) this.chkDrawMode.checked = false;
                    this.selectObject(sprite);
                    this.refreshHierarchy();
                }
            };
        }

        // Save JSON (Duplicate button in File section)
        const saveBtn = document.getElementById('btn-save-json');
        if (saveBtn) saveBtn.onclick = () => this.saveScene();

        // Load JSON
        if (this.fileInput) {
            this.fileInput.onchange = (e: Event) => {
                const target = e.target as HTMLInputElement;
                if (target.files && target.files[0]) {
                    const file = target.files[0];
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        if (event.target) this.loadScene(event.target.result as string);
                    };
                    reader.readAsText(file);
                    this.fileInput!.value = '';
                }
            };
        }

        // Title Update
        if (this.titleInput) {
            this.titleInput.oninput = (e: Event) => {
                if (this.game.sceneManager.currentScene) {
                    this.game.sceneManager.currentScene.name = (e.target as HTMLInputElement).value;
                    const display = document.getElementById('scene-title-display');
                    if (display) display.textContent = (e.target as HTMLInputElement).value;
                }
            };
        }

        // Property Updates

        if (this.propImage) {
            this.propImage.onchange = () => {
                if (this.selectedObject && typeof this.selectedObject !== 'string' && !Array.isArray(this.selectedObject)) {
                    if (this.selectedObject && this.selectedObject instanceof Entity) {
                        // Determine if Entity or Actor
                        // For now, assuming setSprite is on Entity?
                        // Entity.ts shows spriteName string but no setSprite method in the interface shown earlier?
                        // Wait, Entity.ts didn't have setSprite in what I viewed?
                        // Let's just set the property directly for now.
                        this.selectedObject.spriteName = this.propImage!.value;
                    }
                }
            };
        }

        // Scaling Config Updates
        const updateScaling = () => {
            if (this.game.sceneManager.currentScene && this.scaleEnabled) {
                const s = this.game.sceneManager.currentScene.scaling;
                s.enabled = this.scaleEnabled.checked;
                s.min = parseFloat(this.scaleMin!.value) || 0.5;
                s.max = parseFloat(this.scaleMax!.value) || 1.0;
                s.horizon = parseInt(this.scaleHorizon!.value) || 150;
                s.front = parseInt(this.scaleFront!.value) || 300;
            }
        };

        [this.scaleEnabled, this.scaleMin, this.scaleMax, this.scaleHorizon, this.scaleFront].forEach(el => {
            if (el) {
                el.onchange = updateScaling;
                el.oninput = updateScaling;
            }
        });
    }

    toggle(): void {
        this.enabled = !this.enabled;

        const parserInput = document.getElementById('parser-input') as HTMLInputElement;

        if (this.editorWrapper) {
            if (this.enabled) {
                this.editorWrapper.classList.remove('hidden');
                this.syncUI();
                this.refreshHierarchy();
                this.selectObject('SCENE');

                // Block Parser
                if (parserInput) {
                    parserInput.blur();
                    parserInput.disabled = true;
                }
            } else {
                this.editorWrapper.classList.add('hidden');
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
            if (this.titleInput) this.titleInput.value = scene.name;

            // Sync Scaling
            if (scene.scaling && this.scaleEnabled) {
                this.scaleEnabled.checked = scene.scaling.enabled;
                if (this.scaleMin) this.scaleMin.value = scene.scaling.min.toString();
                if (this.scaleMax) this.scaleMax.value = scene.scaling.max.toString();
                if (this.scaleHorizon) this.scaleHorizon.value = scene.scaling.horizon.toString();
                if (this.scaleFront) this.scaleFront.value = scene.scaling.front.toString();
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
        if (this.drawMode) return;

        const pos = this.getMousePos(e); // Screen Coords
        console.log(`[Editor] MousePos: ${pos.x}, ${pos.y}`);
        const scene = this.game.sceneManager.currentScene;

        if (scene) {
            const camX = scene.camera ? scene.camera.x : 0;
            const camY = scene.camera ? scene.camera.y : 0;
            const zoom = scene.camera ? scene.camera.zoom : 1.0;

            // 0. CHECK SELECTED POLYGON VERTICES (High Priority)
            if (this.selectedObject && (this.selectedObject instanceof Walkbox || this.selectedObject instanceof Triggerbox)) {
                const worldPos = {
                    x: pos.x / zoom + camX,
                    y: pos.y / zoom + camY
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
                    // Store offset relative to first point for consistency?
                    // Actually, let's store mouse World Pos
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

                // Entity Screen Rect (With Zoom)
                // Center: (EntityX - CamX*p) * Zoom, (EntityY - CamY*p) * Zoom
                // But easier: Transform Mouse to World

                // Mouse is Screen Coord.
                // ScreenEntityX = (E.x - CamX*p) * Zoom + CanvasOffsetX? (Assuming canvas is 0,0)

                // Let's do Screen Space Check
                const screenX = (entity.x - camX * p) * zoom;
                const screenY = (entity.y - camY * p) * zoom; // Assuming y is bottom
                const screenW = entity.width * zoom;
                const screenH = entity.height * zoom;

                // Entity pivot is Bottom-Center
                // Rect: Left = screenX - W/2, Top = screenY - H

                if (pos.x >= screenX - screenW / 2 && pos.x <= screenX + screenW / 2 &&
                    pos.y >= screenY - screenH && pos.y <= screenY) {

                    console.log(`[Hitbox] HIT! Entity: ${entity.name}`);
                    this.selectObject(entity);
                    this.isDragging = true;
                    this.draggingVertexIndex = -1;
                    // Offset in Screen Space
                    this.dragOffset = { x: pos.x - screenX, y: pos.y - screenY };
                    e.stopPropagation();
                    return;
                } else {
                    // console.log(`[Hitbox] Miss: ${entity.name}`);
                }
            }

            // 2. Check Walkboxes (World Space, Parallax 1.0)
            const worldPos = {
                x: pos.x / zoom + camX,
                y: pos.y / zoom + camY
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
        if (!this.enabled || !this.isDragging || !this.selectedObject) return;

        const pos = this.getMousePos(e);
        const scene = this.game.sceneManager.currentScene;
        const camX = scene && scene.camera ? scene.camera.x : 0;
        const camY = scene && scene.camera ? scene.camera.y : 0;
        const zoom = scene && scene.camera ? scene.camera.zoom : 1.0;

        // Polygon Dragging (Walkbox/Triggerbox)
        if (this.selectedObject instanceof Walkbox || this.selectedObject instanceof Triggerbox) {
            const worldPos = {
                x: pos.x / zoom + camX,
                y: pos.y / zoom + camY
            };

            const poly = this.selectedObject.poly;

            if (this.draggingVertexIndex >= 0) {
                // Drag Vertex
                poly[this.draggingVertexIndex].x = Math.round(worldPos.x);
                poly[this.draggingVertexIndex].y = Math.round(worldPos.y);
            } else {
                // Drag Whole Body
                // Calculate Delta in World Space
                const dx = worldPos.x - this.dragOffset.x;
                const dy = worldPos.y - this.dragOffset.y;

                if (dx !== 0 || dy !== 0) {
                    for (const pt of poly) {
                        pt.x += dx;
                        pt.y += dy;
                        // Optional: Round to int? 
                        // pt.x = Math.round(pt.x + dx); 
                        // But for smooth drag let's just add float and maybe round on save.
                    }
                    // Update Offset
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

        // targetScreenX (Zoomed) = pos.x - dragOffset
        // Unzoomed ScreenX = targetScreenX / zoom

        const targetScreenX = pos.x - this.dragOffset.x;
        const targetScreenY = pos.y - this.dragOffset.y;

        const unzoomedX = targetScreenX / zoom;
        const unzoomedY = targetScreenY / zoom;

        entity.x = Math.round(unzoomedX + camX * p);
        entity.y = Math.round(unzoomedY + camY * p);

        this.updateUIFromObject();
    }

    onMouseUp(): void {
        this.isDragging = false;
    }

    selectObject(obj: any): void {
        this.selectedObject = obj;

        // Visibility Toggles
        if ((this.selectedObject as any) === 'SCENE') {
            if (this.sectionSceneProps) this.sectionSceneProps.classList.remove('hidden');
            if (this.sectionEntityProps) this.sectionEntityProps.classList.add('hidden');
            if (this.sectionWalkboxProps) this.sectionWalkboxProps.classList.add('hidden');
        } else if (obj instanceof SceneObject) {
            // Unified Logic for all SceneObjects
            if (obj instanceof Entity) {
                // Entity Specifics
                if (this.sectionSceneProps) this.sectionSceneProps.classList.add('hidden');
                if (this.sectionEntityProps) this.sectionEntityProps.classList.remove('hidden');
                if (this.sectionWalkboxProps) this.sectionWalkboxProps.classList.add('hidden');

                if (this.propActorGroup) {
                    if (obj instanceof Actor) {
                        this.propActorGroup.classList.remove('hidden');
                    } else {
                        this.propActorGroup.classList.add('hidden');
                    }
                }
            } else if (obj instanceof Walkbox || obj instanceof Triggerbox) {
                // Walkbox/Triggerbox
                if (this.sectionSceneProps) this.sectionSceneProps.classList.add('hidden');
                if (this.sectionEntityProps) this.sectionEntityProps.classList.add('hidden');
                if (this.sectionWalkboxProps) this.sectionWalkboxProps.classList.remove('hidden');
            }

            this.updateUIFromObject();
        } else {
            // Null, Scene handled above or something else
            if (this.sectionSceneProps) this.sectionSceneProps.classList.add('hidden');
            if (this.sectionEntityProps) this.sectionEntityProps.classList.add('hidden');
            if (this.sectionWalkboxProps) this.sectionWalkboxProps.classList.add('hidden');
        }

        this.refreshHierarchy();
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
        if (this.entityList) {
            this.entityList.innerHTML = '';
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

                    // [T] Name
                    div.innerText = `${typeChar}:${entity.name}`;

                    div.onclick = () => {
                        this.selectObject(entity);
                    };
                    if (this.selectedObject === entity) {
                        div.classList.add('selected');
                    }
                    this.entityList?.appendChild(div);
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
                        this.entityList?.appendChild(div);
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
                        this.entityList?.appendChild(div);
                    });
                }
            }
        }
    }


    updateUIFromObject(): void {
        if (!this.selectedObject || !(this.selectedObject instanceof SceneObject)) return;

        // Universal Name Binding
        if (this.propName) this.propName.value = this.selectedObject.name || '';

        // Entity Specifics
        if (this.selectedObject instanceof Entity) {
            const ent = this.selectedObject as Entity;
            if (this.propImage) this.propImage.value = ent.spriteName || '';
            if (this.propX) this.propX.value = ent.x.toString();
            if (this.propY) this.propY.value = ent.y.toString();
            if (this.propWidth) this.propWidth.value = ent.width.toString();
            if (this.propHeight) this.propHeight.value = ent.height.toString();
            if (this.propScale) this.propScale.value = (ent.scale || 1.0).toString();
            if (this.propLayer) this.propLayer.value = (ent.layer || 0).toString();

            if (ent instanceof Actor) {
                if (this.propDirection) this.propDirection.value = ent.direction || 'down';
                if (this.propState) this.propState.value = ent.state || 'idle';
            }
        } else if (this.selectedObject instanceof Walkbox || this.selectedObject instanceof Triggerbox) {
            // For Walkbox/Triggerbox, we can still use the Entity props panel for Name if we want,
            // or keep the separated one. Since we unified SceneObject logic, 
            // we can actually just use the main Name field if we show it.
            // But our selectObject logic shows specific panels.

            // If we are showing section-walkbox-props, we need to bind that input.
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

        if (this.propName) ent.name = this.propName.value || 'Unnamed';
        if (this.propX) ent.x = parseInt(this.propX.value) || 0;
        if (this.propY) ent.y = parseInt(this.propY.value) || 0;
        if (this.propWidth) ent.width = parseInt(this.propWidth.value) || 1;
        if (this.propHeight) ent.height = parseInt(this.propHeight.value) || 1;
        if (this.propScale) ent.scale = parseFloat(this.propScale.value) || 1.0;
        if (this.propLayer) ent.layer = parseInt(this.propLayer.value) || 0;

        if (ent instanceof Actor) {
            if (this.propDirection) ent.setDirection(this.propDirection.value as any);
            if (this.propState) ent.setState(this.propState.value as any);
        }

        if (ent.image && ent.image.complete) {
            // Optional: Auto-Update width/height if scale changes? 
            // Only if we want to enforce aspect ratio or something.
            // For now, let's just leave it manual or handle elsewhere.
            ent.width = ent.image.naturalWidth * ent.scale;
            ent.height = ent.image.naturalHeight * ent.scale;
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
            if (this.propName) this.propName.value = '';
            // Hide all sections
            if (this.sectionEntityProps) this.sectionEntityProps.classList.add('hidden');
            if (this.sectionWalkboxProps) this.sectionWalkboxProps.classList.add('hidden');
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
                newScene.camera = data.camera;
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
        if (!this.drawMode) return false;

        console.log(`OnClick in DrawMode: ${x}, ${y}`);

        // Convert Screen X/Y to World X/Y for storage
        const scene = this.game.sceneManager.currentScene;
        const camX = scene && scene.camera ? scene.camera.x : 0;
        const camY = scene && scene.camera ? scene.camera.y : 0;
        const zoom = scene && scene.camera ? scene.camera.zoom : 1.0;

        // Mouse (Screen) -> World
        // WorldX = ScreenX / Zoom + CamX
        const worldX = x / zoom + camX;
        const worldY = y / zoom + camY;

        if (!this.currentPolygon) this.currentPolygon = [];
        this.currentPolygon.push({ x: Math.round(worldX), y: Math.round(worldY) });
        console.log(`Point Added. Total: ${this.currentPolygon.length}`);
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
                if (this.chkDrawMode) this.chkDrawMode.checked = false;
                this.refreshHierarchy();
            }
        } else {
            console.log('Polygon incomplete (<3 points)');
        }
    }

    render(ctx: CanvasRenderingContext2D): void {
        if (!this.enabled) return;

        const scene = this.game.sceneManager.currentScene;
        const camX = scene && scene.camera ? scene.camera.x : 0;
        const camY = scene && scene.camera ? scene.camera.y : 0;

        // Render current polygon (World Space)
        if (this.currentPolygon && this.currentPolygon.length > 0) {
            ctx.save();
            ctx.scale(scene && scene.camera ? scene.camera.zoom : 1, scene && scene.camera ? scene.camera.zoom : 1);
            ctx.translate(-camX, -camY); // Apply Camera
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 2 / (scene && scene.camera ? scene.camera.zoom : 1); // Keep line width constant
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
            ctx.scale(zoom, zoom);

            if (this.selectedObject instanceof Walkbox) {
                // Highlight Walkbox (World Space)
                ctx.translate(-camX, -camY); // Apply Camera

                ctx.strokeStyle = '#ff0000';
                ctx.lineWidth = 3 / zoom;
                ctx.beginPath();
                const poly = this.selectedObject.poly;
                if (poly.length > 0) {
                    ctx.moveTo(poly[0].x, poly[0].y);
                    for (let i = 1; i < poly.length; i++) {
                        ctx.lineTo(poly[i].x, poly[i].y);
                    }
                    ctx.closePath();
                    ctx.stroke();

                     // Draw Vertex Handles
                    ctx.fillStyle = '#ff0000';
                    const handleSize = 6 / zoom;
                    for (const pt of poly) {
                        ctx.fillRect(pt.x - handleSize / 2, pt.y - handleSize / 2, handleSize, handleSize);
                    }
                }
            } else if (this.selectedObject instanceof Triggerbox) {
                // Highlight Triggerbox (World Space)
                ctx.translate(-camX, -camY); // Apply Camera

                ctx.strokeStyle = '#ff00ff'; // Magenta Selection
                ctx.lineWidth = 3 / zoom;
                ctx.beginPath();
                const poly = this.selectedObject.poly;
                if (poly.length > 0) {
                    ctx.moveTo(poly[0].x, poly[0].y);
                    for (let i = 1; i < poly.length; i++) {
                        ctx.lineTo(poly[i].x, poly[i].y);
                    }
                    ctx.closePath();
                    ctx.stroke();

                    // Draw Vertex Handles
                    ctx.fillStyle = '#ff00ff';
                    const handleSize = 6 / zoom;
                    for (const pt of poly) {
                        ctx.fillRect(pt.x - handleSize / 2, pt.y - handleSize / 2, handleSize, handleSize);
                    }
                }
            } else if (this.selectedObject instanceof Entity) {
                // Highlight Entity
                const entity = this.selectedObject as Entity;
                const p = entity.parallax !== undefined ? entity.parallax : 1.0;

                // Entity is rendered at: (x - camX * p, y - camY * p)
                // Note: Entity x,y is (top-left? or bottom-center?)
                // Entity.ts constructor says x,y. Scene render typically calculates screen pos.
                // Assuming x,y is Top-Left (based on standard canvas rects) or checking prior logic.
                // Previous logic was: strokeRect(drawX, drawY, width, height)
                // Let's assume Top-Left for now as it's standard 2D.

                const drawX = entity.x - camX * p;
                const drawY = entity.y - camY * p;

                ctx.save();
                ctx.strokeStyle = '#fff'; // White/Yellow dash
                ctx.lineWidth = 2 / zoom;
                ctx.setLineDash([4 / zoom, 4 / zoom]); // Dashed Line

                // Entity Anchor is Bottom-Center
                // We draw the rect starting at Top-Left relative to that anchor
                ctx.strokeRect(
                    drawX - entity.width / 2,
                    drawY - entity.height,
                    entity.width,
                    entity.height
                );
                ctx.restore();
            }
            ctx.restore();
        }

        // Draw Scaling Lines (Horizon and Front)
        // const scene = this.game.sceneManager.currentScene; // Already declared at top
        if (scene && scene.scaling && scene.scaling.enabled) {
            ctx.save();
            ctx.font = '10px monospace';

            // Horizon Line (Min Scale)
            const horizonY = scene.scaling.horizon;
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)'; // Cyan, semi-transparent
            ctx.setLineDash([5, 5]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, horizonY);
            ctx.lineTo(this.game.canvas.width, horizonY);
            ctx.stroke();
            ctx.fillStyle = 'rgba(0, 255, 255, 0.8)';
            ctx.fillText(`Horizon`, 5, horizonY - 2);

            // Front Line (Max Scale)
            const frontY = scene.scaling.front;
            ctx.strokeStyle = 'rgba(255, 0, 255, 0.5)'; // Magenta, semi-transparent
            ctx.beginPath();
            ctx.moveTo(0, frontY);
            ctx.lineTo(this.game.canvas.width, frontY);
            ctx.stroke();
            ctx.fillStyle = 'rgba(255, 0, 255, 0.8)';
            ctx.fillText(`Front`, 5, frontY - 2);

            ctx.restore();
        }
    }
}
