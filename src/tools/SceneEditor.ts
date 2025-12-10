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
    creationType: 'Walkbox' | 'Triggerbox' = 'Walkbox';
    draggingVertexIndex: number = -1;
    drawMode: boolean;


    constructor(game: any) {
        this.game = game;
        this.enabled = false;

        this.currentPolygon = [];
        this.selectedObject = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.drawMode = false;
    }

    initUI(): void {
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

                case 'delete':
                    if (this.selectedObject) this.deleteSelectedObject();
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

        // CLICK HANDLERS (Delegation)
        document.addEventListener('click', (e: Event) => {
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
                    // Redraw Logic: Remove current, start new
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
            }
        });

        // INPUT HANDLERS (Delegation)
        document.addEventListener('input', (e: Event) => {
            const target = e.target as HTMLInputElement;
            if (!target) return;

            // Property Inputs - Only update if focused and valid
            if (['prop-name', 'prop-width', 'prop-height', 'prop-x', 'prop-y', 'prop-scale', 'prop-layer', 'prop-state'].includes(target.id)) {
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

            // Scaling Config
            if (['scale-min', 'scale-max', 'scale-horizon', 'scale-front'].includes(target.id)) {
                this.updateScalingConfig();
            }
        });

        // CHANGE HANDLERS (Delegation)
        document.addEventListener('change', (e: Event) => {
            const target = e.target as HTMLElement;
            if (!target) return;

            if (target.id === 'prop-direction' || target.id === 'prop-image') {
                this.updateEntityFromUI();
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
        });
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

        const sectionSceneProps = document.getElementById('section-scene-props');
        const sectionEntityProps = document.getElementById('section-entity-props');
        const sectionWalkboxProps = document.getElementById('section-walkbox-props');
        const propActorGroup = document.getElementById('prop-actor-group');

        // Visibility Toggles
        if ((this.selectedObject as any) === 'SCENE') {
            if (sectionSceneProps) sectionSceneProps.classList.remove('hidden');
            if (sectionEntityProps) sectionEntityProps.classList.add('hidden');
            if (sectionWalkboxProps) sectionWalkboxProps.classList.add('hidden');
        } else if (obj instanceof SceneObject) {
            // Unified Logic for all SceneObjects
            if (obj instanceof Entity) {
                // Entity Specifics
                if (sectionSceneProps) sectionSceneProps.classList.add('hidden');
                if (sectionEntityProps) sectionEntityProps.classList.remove('hidden');
                if (sectionWalkboxProps) sectionWalkboxProps.classList.add('hidden');

                if (propActorGroup) {
                    if (obj instanceof Actor) {
                        propActorGroup.classList.remove('hidden');
                    } else {
                        propActorGroup.classList.add('hidden');
                    }
                }
            } else if (obj instanceof Walkbox || obj instanceof Triggerbox) {
                // Walkbox/Triggerbox
                if (sectionSceneProps) sectionSceneProps.classList.add('hidden');
                if (sectionEntityProps) sectionEntityProps.classList.add('hidden');
                if (sectionWalkboxProps) sectionWalkboxProps.classList.remove('hidden');
            }

            this.updateUIFromObject();
        } else {
            // Null, Scene handled above or something else
            if (sectionSceneProps) sectionSceneProps.classList.add('hidden');
            if (sectionEntityProps) sectionEntityProps.classList.add('hidden');
            if (sectionWalkboxProps) sectionWalkboxProps.classList.add('hidden');
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

            if (propImage) propImage.value = ent.spriteName || '';
            if (propX) propX.value = ent.x.toString();
            if (propY) propY.value = ent.y.toString();
            if (propWidth) propWidth.value = ent.width.toString();
            if (propHeight) propHeight.value = ent.height.toString();
            if (propScale) propScale.value = (ent.scale || 1.0).toString();
            if (propLayer) propLayer.value = (ent.layer || 0).toString();

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

        if (propName) ent.name = propName.value || 'Unnamed';
        if (propX) ent.x = parseInt(propX.value) || 0;
        if (propY) ent.y = parseInt(propY.value) || 0;
        if (propWidth) ent.width = parseInt(propWidth.value) || 1;
        if (propHeight) ent.height = parseInt(propHeight.value) || 1;
        if (propScale) ent.scale = parseFloat(propScale.value) || 1.0;
        if (propLayer) ent.layer = parseInt(propLayer.value) || 0;

        if (ent instanceof Actor) {
            if (propDirection) ent.setDirection(propDirection.value as any);
            if (propState) ent.setState(propState.value as any);
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
                const chk = document.getElementById('chk-draw-mode') as HTMLInputElement;
                if (chk) chk.checked = false;
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
