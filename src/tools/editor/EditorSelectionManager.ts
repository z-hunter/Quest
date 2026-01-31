
import { SceneEditor } from '../SceneEditor';
import { SceneObject } from '../../entities/SceneObject';
import { QuadObject } from '../../entities/QuadObject';
import { Actor } from '../../entities/Actor';
import { Entity } from '../../entities/Entity';
import { Walkbox } from '../../entities/Walkbox';
import { Triggerbox } from '../../entities/Triggerbox';
import { useEditorStore } from '../../store/editorStore';
import { Scene } from '../../scene/Scene';

export class EditorSelectionManager {
    private editor: SceneEditor;

    constructor(editor: SceneEditor) {
        this.editor = editor;
    }

    selectObject(obj: any): void {
        this.editor.selectedObject = obj;

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
        if ((this.editor.selectedObject as any) === 'SCENE') {
            if (sectionSceneProps) sectionSceneProps.classList.remove('hidden');
            this.editor.syncUI();
        } else if ((this.editor.selectedObject as any) === 'SETTINGS') {
            if (sectionSettingsProps) sectionSettingsProps.classList.remove('hidden');
            this.editor.syncSettingsUI();
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

            this.editor.updateUIFromObject();
        }

        this.editor.refreshHierarchy();
    }

    duplicateSelectedObject(): void {
        const obj = this.editor.selectedObject;
        if (!obj || !(obj instanceof SceneObject)) return;

        console.log("[Editor] Duplicating Object:", obj);

        // serialize
        const data = obj.toJSON();

        // Generate new name
        const scene = this.editor.game.sceneManager.currentScene;
        if (!scene) return;

        // Base Name
        let baseName = data.name;
        // Strip existing suffix if present
        const match = baseName.match(/^(.*?)_\d+$/);
        const prefix = match ? match[1] : baseName;

        let counter = 1;
        let newName = `${prefix}_${counter}`;

        // Check availability
        // We check against all entities, walkboxes, triggerboxes
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
        data.x = (data.x || 0) + 10;
        data.y = (data.y || 0) + 10;

        // Fix Component IDs if they reference self (Backface, Shadow)
        // Similar logic to Paste...

        // Use unified creation from Editor
        const newObj = this.editor.createObjectFromData(data);
        if (newObj) {
            console.log(`Duplicated: ${baseName} -> ${newName} `);
            this.selectObject(newObj);
            this.editor.refreshHierarchy();
        }
    }

    handleGlobalPaste(e: ClipboardEvent): void {
        if (!this.editor.enabled) return;
        if (document.activeElement instanceof HTMLInputElement) return;

        // Use clipboard data from event if available (Synchronous and reliable)
        const text = e.clipboardData?.getData('text');
        if (text) {
            e.preventDefault();
            console.log("Paste Event Captured. Text length:", text.length);
            this.processPasteData(text);
        }
    }

    async processPasteData(text: string): Promise<void> {
        try {
            console.log("Processing Paste Data...");
            this.editor.saveUndoState(); // Save before paste
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
            if (!this.editor.lastMousePos) {
                console.log("Mouse position unknown, cannot paste at cursor.");
                return;
            }

            // Helper to get World Coords - delegating to Editor for now
            // Or implementing localized version if simple?
            // SceneEditor has `getMouseWorldPosIfOverCanvas` but that uses current mouse from Store/Event?
            // `this.editor.lastMousePos` is screen coords.
            // We need screen -> world.
            // Let's assume SceneEditor exposes a helper or we implement one.
            // Looking at original code, it called `this.convertScreenToWorld`.
            // We will assume/ensure SceneEditor has this method public.

            // @ts-ignore
            const worldPos = this.editor.convertScreenToWorld(this.editor.lastMousePos.x, this.editor.lastMousePos.y);

            // Ensure unique name for Paste as well
            const scene = this.editor.game.sceneManager.currentScene;
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
                    const srcName = (scene.entities.find((e: any) => e.name === baseName)) ? baseName : baseName;
                    data.components.forEach((comp: any) => {
                        if (comp.type === 'Backface') {
                            if (comp.targetId === srcName || comp.targetId === baseName) {
                                comp.targetId = newName;
                            }
                        }
                    });
                }
            }

            // Create
            const newObj = this.editor.createObjectFromData(data, worldPos.x, worldPos.y);
            if (newObj) {
                this.selectObject(newObj);
                this.editor.refreshHierarchy();
            }

        } catch (e) {
            console.error("Paste Failed:", e);
        }
    }
}
