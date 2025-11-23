class SceneEditor {
    constructor(game) {
        this.game = game;
        this.enabled = false;
        this.panel = document.getElementById('editor-panel');
        this.hierarchyPanel = document.getElementById('hierarchy-panel');
        this.entityList = document.getElementById('entity-list');

        this.currentPolygon = [];
        this.selectedObject = null; // Can be an Entity or a walkbox polygon
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.drawMode = false;

        // UI Elements
        this.titleInput = document.getElementById('editor-scene-title');
        this.spriteInput = document.getElementById('sprite-name-input');
        this.fileInput = document.getElementById('file-load-json');
        this.chkDrawMode = document.getElementById('chk-draw-mode');

        // Property Inputs
        this.propPanel = document.getElementById('sprite-properties');
        this.propImage = document.getElementById('prop-image');
        this.propX = document.getElementById('prop-x');
        this.propY = document.getElementById('prop-y');
        this.propScale = document.getElementById('prop-scale');
        this.propLayer = document.getElementById('prop-layer');

        // Scaling Inputs
        this.scaleEnabled = document.getElementById('scale-enabled');
        this.scaleMin = document.getElementById('scale-min');
        this.scaleMax = document.getElementById('scale-max');
        this.scaleHorizon = document.getElementById('scale-horizon');
        this.scaleFront = document.getElementById('scale-front');

        this.setupListeners();
        this.setupUI();
    }

    setupListeners() {
        // Toggle Key
        window.addEventListener('keydown', (e) => {
            if (e.key === 'F1') {
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
        this.game.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.game.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.game.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    }

    setupUI() {
        // Close Button
        document.getElementById('btn-close-editor').onclick = () => this.toggle();

        // Draw Mode Toggle
        this.chkDrawMode.onchange = (e) => {
            this.drawMode = e.target.checked;
            if (this.drawMode) {
                this.selectObject(null); // Deselect when entering draw mode
            }
        };

        // Clear Walkbox
        document.getElementById('btn-clear-walkbox').onclick = () => {
            if (this.game.sceneManager.currentScene) {
                this.game.sceneManager.currentScene.walkbox = [];
                this.currentPolygon = [];
                console.log('Walkbox cleared');
                this.refreshHierarchy();
            }
        };

        // Add Sprite
        document.getElementById('btn-add-sprite').onclick = () => {
            const name = this.spriteInput.value;
            if (this.game.sceneManager.currentScene) {
                const sprite = new Entity(160, 100, 30, 30, name || 'Sprite');
                if (name) sprite.setSprite(name);
                sprite.color = '#ffa500';
                this.game.sceneManager.currentScene.addEntity(sprite);

                this.drawMode = false;
                this.chkDrawMode.checked = false;
                this.selectObject(sprite);
                this.refreshHierarchy();
            }
        };

        // Save JSON
        document.getElementById('btn-save-json').onclick = () => this.saveScene();

        // Load JSON
        this.fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => this.loadScene(event.target.result);
                reader.readAsText(file);
                this.fileInput.value = '';
            }
        };

        // Title Update
        this.titleInput.oninput = (e) => {
            if (this.game.sceneManager.currentScene) {
                this.game.sceneManager.currentScene.name = e.target.value;
                const display = document.getElementById('scene-title-display');
                if (display) display.textContent = e.target.value;
            }
        };

        // Property Updates
        [this.propX, this.propY, this.propScale, this.propLayer].forEach(input => {
            input.oninput = () => this.updateEntityFromUI();
        });

        this.propImage.onchange = () => {
            if (this.selectedObject && !Array.isArray(this.selectedObject)) {
                this.selectedObject.setSprite(this.propImage.value);
            }
        };

        // Scaling Config Updates
        const updateScaling = () => {
            if (this.game.sceneManager.currentScene) {
                const s = this.game.sceneManager.currentScene.scaling;
                s.enabled = this.scaleEnabled.checked;
                s.min = parseFloat(this.scaleMin.value) || 0.5;
                s.max = parseFloat(this.scaleMax.value) || 1.0;
                s.horizon = parseInt(this.scaleHorizon.value) || 150;
                s.front = parseInt(this.scaleFront.value) || 300;
            }
        };

        [this.scaleEnabled, this.scaleMin, this.scaleMax, this.scaleHorizon, this.scaleFront].forEach(el => {
            el.onchange = updateScaling;
            el.oninput = updateScaling;
        });
    }

    toggle() {
        this.enabled = !this.enabled;
        if (this.enabled) {
            this.panel.classList.remove('hidden');
            this.hierarchyPanel.classList.remove('hidden');
            this.syncUI();
            this.refreshHierarchy();
        } else {
            this.panel.classList.add('hidden');
            this.hierarchyPanel.classList.add('hidden');
            this.selectedObject = null;
            this.propPanel.classList.add('hidden');
        }
    }

    syncUI() {
        const scene = this.game.sceneManager.currentScene;
        if (scene) {
            this.titleInput.value = scene.name;

            // Sync Scaling
            if (scene.scaling) {
                this.scaleEnabled.checked = scene.scaling.enabled;
                this.scaleMin.value = scene.scaling.min;
                this.scaleMax.value = scene.scaling.max;
                this.scaleHorizon.value = scene.scaling.horizon;
                this.scaleFront.value = scene.scaling.front;
            }
        }
    }

    refreshHierarchy() {
        this.entityList.innerHTML = '';
        const scene = this.game.sceneManager.currentScene;
        if (!scene) return;

        // 1. List Walkboxes
        if (scene.walkbox) {
            scene.walkbox.forEach((poly, index) => {
                const div = document.createElement('div');
                div.className = 'entity-item';
                div.style.color = '#ffff00'; // Yellow for walkboxes
                if (poly === this.selectedObject) div.classList.add('selected');
                div.textContent = `Walkbox ${index}`;
                div.onclick = () => {
                    this.drawMode = false;
                    this.chkDrawMode.checked = false;
                    this.selectObject(poly);
                };
                this.entityList.appendChild(div);
            });
        }

        // 2. List Entities
        scene.entities.forEach(entity => {
            const div = document.createElement('div');
            div.className = 'entity-item';
            if (entity === this.selectedObject) div.classList.add('selected');
            div.textContent = `${entity.name} (L:${entity.layer})`;
            div.onclick = () => {
                this.drawMode = false;
                this.chkDrawMode.checked = false;
                this.selectObject(entity);
            };
            this.entityList.appendChild(div);
        });
    }

    // --- Entity/Object Interaction ---

    getMousePos(e) {
        const rect = this.game.canvas.getBoundingClientRect();
        const scaleX = this.game.canvas.width / rect.width;
        const scaleY = this.game.canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    onMouseDown(e) {
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

            // 2. Check Walkboxes (if no entity clicked)
            // Simple bounding box check or point in polygon?
            // Let's use point in polygon for selection
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

    onMouseMove(e) {
        if (!this.enabled || !this.isDragging || !this.selectedObject) return;

        // Only drag Entities for now
        if (Array.isArray(this.selectedObject)) return; // It's a walkbox

        const pos = this.getMousePos(e);
        this.selectedObject.x = Math.round(pos.x - this.dragOffset.x);
        this.selectedObject.y = Math.round(pos.y - this.dragOffset.y);

        this.updateUIFromObject();
    }

    onMouseUp(e) {
        this.isDragging = false;
    }

    selectObject(obj) {
        this.selectedObject = obj;
        this.refreshHierarchy();

        if (obj && !Array.isArray(obj)) {
            // It's an Entity
            this.propPanel.classList.remove('hidden');
            this.updateUIFromObject();
        } else {
            // It's a Walkbox or Null
            this.propPanel.classList.add('hidden');
        }
    }

    updateUIFromObject() {
        if (!this.selectedObject || Array.isArray(this.selectedObject)) return;

        this.propImage.value = this.selectedObject.spriteName || '';
        this.propX.value = this.selectedObject.x;
        this.propY.value = this.selectedObject.y;
        this.propScale.value = this.selectedObject.scale || 1.0;
        this.propLayer.value = this.selectedObject.layer || 0;
    }

    updateEntityFromUI() {
        if (!this.selectedObject || Array.isArray(this.selectedObject)) return;

        this.selectedObject.x = parseInt(this.propX.value) || 0;
        this.selectedObject.y = parseInt(this.propY.value) || 0;
        this.selectedObject.scale = parseFloat(this.propScale.value) || 1.0;
        this.selectedObject.layer = parseInt(this.propLayer.value) || 0;

        if (this.selectedObject.image && this.selectedObject.image.complete) {
            this.selectedObject.width = this.selectedObject.image.naturalWidth * this.selectedObject.scale;
            this.selectedObject.height = this.selectedObject.image.naturalHeight * this.selectedObject.scale;
        }
        this.refreshHierarchy();
    }

    deleteSelectedObject() {
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

    // --- Existing Logic ---

    saveScene() {
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

    loadScene(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            const newScene = new Scene(data.id || 'loaded_scene', data.name || 'Untitled');

            // Ensure walkbox coordinates are numbers
            newScene.walkbox = (data.walkbox || []).map(poly =>
                poly.map(p => ({ x: Number(p.x), y: Number(p.y) }))
            );

            if (data.entities) {
                data.entities.forEach(entityData => {
                    const entity = Entity.fromJSON(entityData);
                    newScene.addEntity(entity);
                });
            }
            const player = new Player(160, 100);
            newScene.addEntity(player);
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

    onClick(x, y) {
        if (!this.enabled) return false;
        if (!this.drawMode) return false;

        if (!this.currentPolygon) this.currentPolygon = [];
        this.currentPolygon.push({ x: Math.round(x), y: Math.round(y) });
        return true;
    }

    finishPolygon() {
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

    render(ctx) {
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
