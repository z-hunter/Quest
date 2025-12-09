import { Entity } from '../entities/Entity';
import { Actor } from '../entities/Actor';
import { Player } from '../entities/Player';
import { Geometry } from '../utils/Geometry';
import { Scene } from '../scene/Scene';

export class SceneEditor {
    game: any;
    enabled: boolean;
    panel: HTMLElement | null;
    hierarchyPanel: HTMLElement | null;
    entityList: HTMLElement | null;
    currentPolygon: { x: number, y: number }[];
    selectedObject: any; // Entity or Walkbox (array)
    isDragging: boolean;
    dragOffset: { x: number, y: number };
    drawMode: boolean;

    // UI Elements
    titleInput: HTMLInputElement | null;
    spriteInput: HTMLInputElement | null;
    fileInput: HTMLInputElement | null;
    chkDrawMode: HTMLInputElement | null;
    propPanel: HTMLElement | null;
    propImage: HTMLInputElement | null;
    propX: HTMLInputElement | null;
    propY: HTMLInputElement | null;
    propScale: HTMLInputElement | null;
    propLayer: HTMLInputElement | null;
    scaleEnabled: HTMLInputElement | null;
    scaleMin: HTMLInputElement | null;
    scaleMax: HTMLInputElement | null;
    scaleHorizon: HTMLInputElement | null;
    scaleFront: HTMLInputElement | null;

    // Sections
    sectionSceneProps: HTMLElement | null;
    sectionEntityProps: HTMLElement | null;
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
        this.propImage = null;
        this.propX = null;
        this.propY = null;
        this.propScale = null;
        this.propLayer = null;
        this.scaleEnabled = null;
        this.scaleMin = null;
        this.scaleMax = null;
        this.scaleHorizon = null;
        this.scaleFront = null;

        this.sectionSceneProps = null;
        this.sectionEntityProps = null;
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

        this.propPanel = document.getElementById('editor-panel'); // Reused, though sectionEntityProps is specific
        this.sectionSceneProps = document.getElementById('section-scene-props');
        this.sectionEntityProps = document.getElementById('section-entity-props');
        this.scenePropertiesItem = document.getElementById('scene-properties-item');

        this.propImage = document.getElementById('prop-image') as HTMLInputElement;
        this.propX = document.getElementById('prop-x') as HTMLInputElement;
        this.propY = document.getElementById('prop-y') as HTMLInputElement;
        this.propScale = document.getElementById('prop-scale') as HTMLInputElement;
        this.propLayer = document.getElementById('prop-layer') as HTMLInputElement;

        this.scaleEnabled = document.getElementById('scale-enabled') as HTMLInputElement;
        this.scaleMin = document.getElementById('scale-min') as HTMLInputElement;
        this.scaleMax = document.getElementById('scale-max') as HTMLInputElement;
        this.scaleHorizon = document.getElementById('scale-horizon') as HTMLInputElement;
        this.scaleFront = document.getElementById('scale-front') as HTMLInputElement;

        this.setupListeners();
        this.setupUI();
        console.log('[SceneEditor] UI Initialized');
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
            const name = prompt(`Enter name for ${type}:`, type + '_' + Math.floor(Math.random() * 1000));
            if (!name) return;

            const ent = new Entity(160, 100, 30, 30, name);
            ent.color = type === 'Actor' ? '#0000ff' : '#00ff00';

            scene.addEntity(ent);
            this.selectObject(ent);
            this.drawMode = false;
        } else if (type === 'Walkbox') {
            this.drawMode = true;
            if (this.chkDrawMode) this.chkDrawMode.checked = true;
            this.selectObject(null);
            console.log("Draw Mode: Walkbox");
        } else if (type === 'Triggerbox') {
            console.log("Draw Mode: Triggerbox (Not fully implemented yet)");
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
        [this.propX, this.propY, this.propScale, this.propLayer].forEach(input => {
            if (input) input.oninput = () => this.updateEntityFromUI();
        });

        if (this.propImage) {
            this.propImage.onchange = () => {
                if (this.selectedObject && typeof this.selectedObject !== 'string' && !Array.isArray(this.selectedObject)) {
                    this.selectedObject.setSprite(this.propImage!.value);
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
        if (this.editorWrapper) {
            if (this.enabled) {
                this.editorWrapper.classList.remove('hidden');
                this.syncUI();
                this.refreshHierarchy();
                this.selectObject('SCENE');
            } else {
                this.editorWrapper.classList.add('hidden');
                this.selectedObject = null;
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

    refreshHierarchy(): void {
        if (!this.entityList) return;
        this.entityList.innerHTML = '';
        const scene = this.game.sceneManager.currentScene;
        if (!scene) return;

        // Highlight Scene Properties Item?
        if (this.scenePropertiesItem) {
            if (this.selectedObject === 'SCENE') {
                this.scenePropertiesItem.classList.add('selected');
            } else {
                this.scenePropertiesItem.classList.remove('selected');
            }
        }

        // 1. List Walkboxes
        if (scene.walkbox) {
            scene.walkbox.forEach((poly: any, index: number) => {
                const div = document.createElement('div');
                div.className = 'entity-item';
                div.style.color = '#ffff00'; // Yellow for walkboxes
                if (poly === this.selectedObject) div.classList.add('selected');
                div.textContent = `Walkbox ${index}`;
                div.onclick = () => {
                    this.drawMode = false;
                    if (this.chkDrawMode) this.chkDrawMode.checked = false;
                    this.selectObject(poly);
                };
                if (this.entityList) this.entityList.appendChild(div);
            });
        }

        // 2. List Entities
        scene.entities.forEach((entity: Entity) => {
            const div = document.createElement('div');
            div.className = 'entity-item';
            if (entity === this.selectedObject) div.classList.add('selected');
            div.textContent = `${entity.name} (L:${entity.layer})`;
            div.onclick = () => {
                this.drawMode = false;
                if (this.chkDrawMode) this.chkDrawMode.checked = false;
                this.selectObject(entity);
            };
            if (this.entityList) this.entityList.appendChild(div);
        });
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
        if (this.drawMode) return;

        const pos = this.getMousePos(e); // Screen Coords
        const scene = this.game.sceneManager.currentScene;

        if (scene) {
            const camX = scene.camera ? scene.camera.x : 0;
            const camY = scene.camera ? scene.camera.y : 0;
            const zoom = scene.camera ? scene.camera.zoom : 1.0;

            // 1. Check Entities
            for (let i = scene.entities.length - 1; i >= 0; i--) {
                const entity = scene.entities[i];
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

                    this.selectObject(entity);
                    this.isDragging = true;
                    // Offset in Screen Space
                    this.dragOffset = { x: pos.x - screenX, y: pos.y - screenY };
                    e.stopPropagation();
                    return;
                }
            }

            // 2. Check Walkboxes (World Space, Parallax 1.0)
            // Mouse (Screen) -> World
            const worldPos = {
                x: pos.x / zoom + camX,
                y: pos.y / zoom + camY
            };

            for (const poly of scene.walkbox) {
                if (Geometry.isPointInPolygon(worldPos, poly)) {
                    this.selectObject(poly);
                    e.stopPropagation();
                    return;
                }
            }
        }

        this.selectObject(null);
    }

    onMouseMove(e: MouseEvent): void {
        if (!this.enabled || !this.isDragging || !this.selectedObject) return;

        // Only drag Entities for now
        if (Array.isArray(this.selectedObject)) return; // It's a walkbox

        const pos = this.getMousePos(e);
        const scene = this.game.sceneManager.currentScene;
        const camX = scene && scene.camera ? scene.camera.x : 0;
        const camY = scene && scene.camera ? scene.camera.y : 0;

        const entity = this.selectedObject;
        const p = entity.parallax !== undefined ? entity.parallax : 1.0;
        const zoom = scene && scene.camera ? scene.camera.zoom : 1.0;

        // targetScreenX (Zoomed) = pos.x - dragOffset
        // Unzoomed ScreenX = targetScreenX / zoom
        // WorldX = UnzoomedScreenX + camX * p

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
        if (this.selectedObject === 'SCENE') {
            if (this.sectionSceneProps) this.sectionSceneProps.classList.remove('hidden');
            if (this.sectionEntityProps) this.sectionEntityProps.classList.add('hidden');
        } else if (obj && !Array.isArray(obj)) {
            // Entity
            if (this.sectionSceneProps) this.sectionSceneProps.classList.add('hidden');
            if (this.sectionEntityProps) this.sectionEntityProps.classList.remove('hidden');
            this.updateUIFromObject();
        } else {
            // Walkbox or Null
            // If Walkbox, maybe show nothing specific or walkbox props?
            // For now hide entity props, keep scene props hidden?
            // Default to nothing?
            if (this.sectionSceneProps) this.sectionSceneProps.classList.add('hidden');
            if (this.sectionEntityProps) this.sectionEntityProps.classList.add('hidden');
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


    updateUIFromObject(): void {
        if (!this.selectedObject || Array.isArray(this.selectedObject)) return;

        if (this.propImage) this.propImage.value = this.selectedObject.spriteName || '';
        if (this.propX) this.propX.value = this.selectedObject.x.toString();
        if (this.propY) this.propY.value = this.selectedObject.y.toString();
        if (this.propScale) this.propScale.value = (this.selectedObject.scale || 1.0).toString();
        if (this.propLayer) this.propLayer.value = (this.selectedObject.layer || 0).toString();
    }

    updateEntityFromUI(): void {
        if (!this.selectedObject || Array.isArray(this.selectedObject)) return;

        if (this.propX) this.selectedObject.x = parseInt(this.propX.value) || 0;
        if (this.propY) this.selectedObject.y = parseInt(this.propY.value) || 0;
        if (this.propScale) this.selectedObject.scale = parseFloat(this.propScale.value) || 1.0;
        if (this.propLayer) this.selectedObject.layer = parseInt(this.propLayer.value) || 0;

        if (this.selectedObject.image && this.selectedObject.image.complete) {
            this.selectedObject.width = this.selectedObject.image.naturalWidth * this.selectedObject.scale;
            this.selectedObject.height = this.selectedObject.image.naturalHeight * this.selectedObject.scale;
        }
        this.refreshHierarchy();
    }

    deleteSelectedObject(): void {
        if (!this.selectedObject) return;
        const scene = this.game.sceneManager.currentScene;
        if (scene) {
            if (Array.isArray(this.selectedObject)) {
                // Delete Walkbox
                const index = scene.walkbox.indexOf(this.selectedObject);
                if (index > -1) {
                    scene.walkbox.splice(index, 1);
                    console.log('Walkbox deleted');
                }
            } else {
                // Delete Entity
                const index = scene.entities.indexOf(this.selectedObject);
                if (index > -1) {
                    scene.entities.splice(index, 1);
                    console.log('Entity deleted');
                }
            }
            this.selectObject(null);
            this.refreshHierarchy();
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
                newScene.camera = { ...data.camera };
            }

            // Restore Scaling
            if (data.scaling) {
                newScene.scaling = { ...data.scaling };
            }

            // Ensure walkbox coordinates are numbers
            newScene.walkbox = (data.walkbox || []).map((poly: any) =>
                poly.map((p: any) => ({ x: Number(p.x), y: Number(p.y) }))
            );

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
        if (!this.enabled) return false;
        if (!this.drawMode) return false;

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
        return true;
    }

    finishPolygon(): void {
        if (this.currentPolygon && this.currentPolygon.length > 2) {
            const scene = this.game.sceneManager.currentScene;
            if (scene) {
                scene.walkbox.push([...this.currentPolygon]);
                this.currentPolygon = [];
                console.log('Polygon added to scene');
                this.refreshHierarchy();
            }
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

        // Highlight selected object
        if (this.selectedObject) {
            ctx.save();
            const zoom = scene && scene.camera ? scene.camera.zoom : 1.0;
            ctx.scale(zoom, zoom);

            if (Array.isArray(this.selectedObject)) {
                // Highlight Walkbox (World Space)
                ctx.translate(-camX, -camY); // Apply Camera

                ctx.strokeStyle = '#ff0000';
                ctx.lineWidth = 3 / zoom;
                ctx.beginPath();
                const poly = this.selectedObject;
                if (poly.length > 0) {
                    ctx.moveTo(poly[0].x, poly[0].y);
                    for (let i = 1; i < poly.length; i++) {
                        ctx.lineTo(poly[i].x, poly[i].y);
                    }
                    ctx.closePath();
                    ctx.stroke();
                }
            } else {
                // Highlight Entity
                const entity = this.selectedObject;
                const p = entity.parallax !== undefined ? entity.parallax : 1.0;

                // Move to Entity position in World Space relative to Camera * Parallax
                // We want to draw at (entity.x, entity.y) but shifted by camera * parallax
                // Transform: Translate(-camX * p, -camY * p)

                ctx.translate(-camX * p, -camY * p);

                // Draw rect around Entity
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1 / zoom;
                ctx.setLineDash([4 / zoom, 4 / zoom]);
                ctx.strokeRect(
                    entity.x - 2,
                    entity.y - entity.height, // Pivot is bottom-center, draw up
                    entity.width + 4,
                    entity.height + 4
                );
                // Note: Entity x/y is Bottom-Center?
                // scene.render draws entity.render(ctx) at translated pos.
                // entity.render typically draws image centered at x? or top-left?
                // Let's check Entity.ts later. Assuming x is center, y is bottom for now.
                // Actually, Entity.render typically does: ctx.drawImage(img, this.x - w/2, this.y - h)
                // So this strokeRect matches that.
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
