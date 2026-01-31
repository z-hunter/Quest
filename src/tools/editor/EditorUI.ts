
import { SceneEditor } from '../SceneEditor';
import { Entity } from '../../entities/Entity';
import { Actor } from '../../entities/Actor';
import { Walkbox } from '../../entities/Walkbox';
import { Triggerbox } from '../../entities/Triggerbox';
import { useEditorStore } from '../../store/editorStore';

export class EditorUI {
    private editor: SceneEditor;
    private uiInitialized: boolean = false;

    constructor(editor: SceneEditor) {
        this.editor = editor;
    }

    initUI(): void {
        if (this.uiInitialized) return;

        console.log('[SceneEditor] Initializing UI...');
        this.setupListeners();
        this.setupUI();

        this.uiInitialized = true;
        console.log('[SceneEditor] UI Initialized');
    }

    destroy(): void {
        console.log('[SceneEditor] Destroying, removing listeners...');
        // We need access to bound handlers. 
        // Assuming they are exposed on editor or we move them here?
        // They are on editor.
        if (this.editor.boundKeyHandler) document.removeEventListener('keydown', this.editor.boundKeyHandler, { capture: true });

        if (this.editor.boundMouseDownHandler) this.editor.game.canvas.removeEventListener('mousedown', this.editor.boundMouseDownHandler);
        if (this.editor.boundMouseMoveHandler) window.removeEventListener('mousemove', this.editor.boundMouseMoveHandler);
        if (this.editor.boundMouseUpHandler) window.removeEventListener('mouseup', this.editor.boundMouseUpHandler);

        this.uiInitialized = false;
    }

    setupListeners(): void {
        // Canvas Interaction Listeners
        this.editor.game.canvas.addEventListener('mousedown', this.editor.boundMouseDownHandler);
        window.addEventListener('mousemove', this.editor.boundMouseMoveHandler);
        window.addEventListener('mouseup', this.editor.boundMouseUpHandler);
        window.addEventListener('paste', this.editor.boundPasteHandler);

        // Global Key Handler
        document.addEventListener('keydown', this.editor.boundKeyHandler, { capture: true });
    }

    setupUI(): void {
        console.log('[SceneEditor] Setting up UI Listeners (Delegation)');
    }

    toggle(): void {
        this.editor.enabled = !this.editor.enabled;

        const parserInput = document.getElementById('parser-input') as HTMLInputElement;
        const editorWrapper = document.getElementById('editor-wrapper');

        if (this.editor.enabled) {
            if (editorWrapper) editorWrapper.classList.remove('hidden');
            this.syncUI();
            this.refreshHierarchy();
            this.editor.selectObject('SCENE');

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
        useEditorStore.getState().toggle(this.editor.enabled);
    }

    syncUI(): void {
        const scene = this.editor.game.sceneManager.currentScene;
        if (scene) {
            useEditorStore.getState().setSceneInfo(scene.name, scene.filename || '');
            useEditorStore.getState().incrementObjectVersion();
        }
    }

    onAddObjectClick(): void {
        const select = document.getElementById('add-object-type') as HTMLSelectElement;
        const type = select ? select.value : 'Static';
        this.editor.transformManager.startCreating(type);
    }

    refreshHierarchy(): void {
        // Sync to Store
        useEditorStore.getState().incrementHierarchyVersion();

        // Sync static Scene Item selection state
        const scenePropertiesItem = document.getElementById('scene-properties-item');
        if (scenePropertiesItem) {
            if ((this.editor.selectedObject as any) === 'SCENE') {
                scenePropertiesItem.classList.add('selected');
            } else {
                scenePropertiesItem.classList.remove('selected');
            }
        }

        const entityList = document.getElementById('entity-list');
        if (entityList) {
            entityList.innerHTML = '';
            const scene = this.editor.game.sceneManager.currentScene;
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
                        this.editor.selectObject(entity);
                    };
                    if (this.editor.selectedObject === entity) {
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
                            this.editor.selectObject(wb);
                        };
                        if (this.editor.selectedObject === wb) {
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
                            this.editor.selectObject(trigger);
                        };
                        if (this.editor.selectedObject === trigger) {
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
        if (!this.editor.selectedObject || !(this.editor.selectedObject instanceof Entity)) return;

        this.editor.saveUndoState(); // Save before modification

        const ent = this.editor.selectedObject as Entity;

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
        if (triggerId === 'prop-scale') {
            const newModelScale = parseFloat(propScale.value) || 1.0;
            ent.modelScale = newModelScale;

            let depthFactor = 1.0;
            if (!ent.ignoreScaling) {
                if (this.editor.game.sceneManager.currentScene && this.editor.game.sceneManager.currentScene.scaling.enabled) {
                    depthFactor = this.editor.game.sceneManager.currentScene.getScaling(ent.y);
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

            if (propScale) propScale.value = ent.modelScale.toString();
        }


        if (propLayer) ent.layer = parseInt(propLayer.value) || 0;
        // Allow parallax to be 0
        if (propParallax) {
            const val = parseFloat(propParallax.value);
            const newVal = isNaN(val) ? 1.0 : val;

            // Auto-adjust coordinates to keep object visually stationary if Parallax changed
            if (ent.parallax !== undefined && ent.parallax !== newVal) {
                const scene = this.editor.game.sceneManager.currentScene;
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
                const currentVisW = ent.width;
                const currentVisH = ent.height;

                let targetFactor = ent.modelScale;

                if (!isIgnored) {
                    let depthFactor = 1.0;
                    if (this.editor.game.sceneManager.currentScene && this.editor.game.sceneManager.currentScene.scaling.enabled) {
                        depthFactor = this.editor.game.sceneManager.currentScene.getScaling(ent.y);
                    }
                    targetFactor = ent.modelScale * depthFactor;
                }

                if (targetFactor !== 0) {
                    ent.baseWidth = currentVisW / targetFactor;
                    ent.baseHeight = currentVisH / targetFactor;
                } else {
                    ent.baseWidth = currentVisW;
                    ent.baseHeight = currentVisH;
                }

                ent.ignoreScaling = isIgnored;
                ent.scale = targetFactor;
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

    setActorIsPlayer(actor: Actor, value: boolean): void {
        const scene = this.editor.game.sceneManager.currentScene;
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
}
