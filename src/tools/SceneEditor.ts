import { Entity } from '../entities/Entity';
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

    constructor(game: any) {
        this.game = game;
        this.enabled = false;
        this.panel = null;
        this.hierarchyPanel = null;
        this.entityList = null;

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
    }

    initUI(): void {
        console.log('[SceneEditor] Initializing UI...');
        this.panel = document.getElementById('editor-panel');
        this.hierarchyPanel = document.getElementById('hierarchy-panel');
        this.entityList = document.getElementById('entity-list');

        // Force initial hidden state (decoupled from React)
        if (this.panel) this.panel.classList.add('hidden');
        if (this.hierarchyPanel) this.hierarchyPanel.classList.add('hidden');

        this.titleInput = document.getElementById('editor-scene-title') as HTMLInputElement;
        this.spriteInput = document.getElementById('sprite-name-input') as HTMLInputElement;
        this.fileInput = document.getElementById('file-load-json') as HTMLInputElement;
        this.chkDrawMode = document.getElementById('chk-draw-mode') as HTMLInputElement;

        this.propPanel = document.getElementById('sprite-properties');
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
            if (e.key === 'F1' || e.key === '`' || e.key === 'Backquote') {
                console.log('[SceneEditor] Toggle Key Pressed');
                e.preventDefault();
                this.toggle();
            }

            if (!this.enabled) return;

            if (e.key === 'Enter' && !e.ctrlKey) {
                this.finishPolygon();
            } else if (e.key === 'Delete' && this.selectedObject) {
                this.deleteSelectedObject();
            }
        });

        // Mouse Dragging
        this.game.canvas.addEventListener('mousedown', (e: MouseEvent) => this.onMouseDown(e));
        this.game.canvas.addEventListener('mousemove', (e: MouseEvent) => this.onMouseMove(e));
        this.game.canvas.addEventListener('mouseup', () => this.onMouseUp());
    }

    setupUI(): void {
        // Close Button
        const closeBtn = document.getElementById('btn-close-editor');
        if (closeBtn) closeBtn.onclick = () => this.toggle();

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

        // Save JSON
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
                if (this.selectedObject && !Array.isArray(this.selectedObject)) {
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
        if (this.enabled) {
            if (this.panel) this.panel.classList.remove('hidden');
            if (this.hierarchyPanel) this.hierarchyPanel.classList.remove('hidden');
            this.syncUI();
            this.refreshHierarchy();
        } else {
            if (this.panel) this.panel.classList.add('hidden');
            if (this.hierarchyPanel) this.hierarchyPanel.classList.add('hidden');
            this.selectedObject = null;
            if (this.propPanel) this.propPanel.classList.add('hidden');
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

        const pos = this.getMousePos(e);
        const scene = this.game.sceneManager.currentScene;

        if (scene) {
            // 1. Check Entities (Top to Bottom)
            for (let i = scene.entities.length - 1; i >= 0; i--) {
                const entity = scene.entities[i];
                if (pos.x >= entity.x - entity.width / 2 && pos.x <= entity.x + entity.width / 2 &&
                    pos.y >= entity.y - entity.height && pos.y <= entity.y) {

                    this.selectObject(entity);
                    this.isDragging = true;
                    this.dragOffset = { x: pos.x - entity.x, y: pos.y - entity.y };
                    e.stopPropagation();
                    return;
                }
            }

            // 2. Check Walkboxes
            for (const poly of scene.walkbox) {
                if (Geometry.isPointInPolygon(pos, poly)) {
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
        this.selectedObject.x = Math.round(pos.x - this.dragOffset.x);
        this.selectedObject.y = Math.round(pos.y - this.dragOffset.y);

        this.updateUIFromObject();
    }

    onMouseUp(): void {
        this.isDragging = false;
    }

    selectObject(obj: any): void {
        this.selectedObject = obj;
        this.refreshHierarchy();

        if (obj && !Array.isArray(obj)) {
            // It's an Entity
            if (this.propPanel) this.propPanel.classList.remove('hidden');
            this.updateUIFromObject();
        } else {
            // It's a Walkbox or Null
            if (this.propPanel) this.propPanel.classList.add('hidden');
        }
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

            // Ensure walkbox coordinates are numbers
            newScene.walkbox = (data.walkbox || []).map((poly: any) =>
                poly.map((p: any) => ({ x: Number(p.x), y: Number(p.y) }))
            );

            if (data.entities) {
                data.entities.forEach((entityData: any) => {
                    const entity = Entity.fromJSON(entityData);
                    newScene.addEntity(entity);
                });
            }
            // Player is added by Game.ts usually, or we can add a default one
            // const player = new Player(160, 100);
            // newScene.addEntity(player);

            this.game.sceneManager.addScene(newScene);
            this.game.sceneManager.switchTo(newScene.id);
            this.syncUI();
            this.refreshHierarchy();
            alert('Scene loaded successfully!');
        } catch (e) {
            console.error('Failed to load scene:', e);
            alert('Error loading JSON');
        }
    }

    onClick(x: number, y: number): boolean {
        if (!this.enabled) return false;
        if (!this.drawMode) return false;

        if (!this.currentPolygon) this.currentPolygon = [];
        this.currentPolygon.push({ x: Math.round(x), y: Math.round(y) });
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

        // Render current polygon
        if (this.currentPolygon && this.currentPolygon.length > 0) {
            ctx.save();
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 2;
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
            if (Array.isArray(this.selectedObject)) {
                // Highlight Walkbox
                ctx.strokeStyle = '#ff0000';
                ctx.lineWidth = 3;
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
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.strokeRect(
                    this.selectedObject.x - this.selectedObject.width / 2 - 2,
                    this.selectedObject.y - this.selectedObject.height - 2,
                    this.selectedObject.width + 4,
                    this.selectedObject.height + 4
                );
            }
            ctx.restore();
        }
    }
}
