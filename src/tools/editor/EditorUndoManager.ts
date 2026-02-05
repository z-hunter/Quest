
import { SceneEditor } from '../SceneEditor';

export class EditorUndoManager {
    private editor: SceneEditor;
    private undoStack: any[] = [];
    private redoStack: any[] = [];
    private readonly MAX_HISTORY = 50;

    constructor(editor: SceneEditor) {
        this.editor = editor;
    }

    saveUndoState(): void {
        const scene = this.editor.game.sceneManager.currentScene;
        if (!scene) return;

        // Push current state to Undo Stack
        this.undoStack.push(scene.toJSON());

        // Enforce Max History
        if (this.undoStack.length > this.MAX_HISTORY) {
            this.undoStack.shift(); // Remove oldest
        }

        // Clear Redo Stack on new action
        this.redoStack = [];

        console.log(`[Editor] Undo State Saved. Stack Size: ${this.undoStack.length}`);
    }

    restoreSceneState(data: any): void {
        const scene = this.editor.game.sceneManager.currentScene;
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
                this.editor.createObjectFromData(eData);
            });
        }

        // Restore Walkboxes
        if (data.walkbox) {
            data.walkbox.forEach((wData: any) => {
                // @ts-ignore
                this.editor.createObjectFromData({ ...wData, type: 'Walkbox' });
            });
        }

        // Restore Triggerboxes
        if (data.triggerboxes) {
            data.triggerboxes.forEach((tData: any) => {
                // @ts-ignore
                this.editor.createObjectFromData({ ...tData, type: 'Triggerbox' });
            });
        }

        // Restore Scene Settings
        if (data.scaling) scene.scaling = { ...data.scaling };
        // We do NOT restore cameraX/Y to allow keeping view focused

        this.editor.selectObject(null);
        this.editor.transformManager.drawMode = false;
        this.editor.refreshHierarchy();
    }

    undo(): void {
        const scene = this.editor.game.sceneManager.currentScene;
        if (!scene) return;

        if (this.undoStack.length === 0) {
            console.log("[Editor] Cannot Undo: Start of Buffer");
            this.editor.game.showNotification("Cannot Undo: Start of Buffer");
            return;
        }

        console.log("[Editor] Performing Undo...");

        // 1. Capture CURRENT state and push to Redo Stack
        const currentState = scene.toJSON();
        this.redoStack.push(currentState);

        // 2. Pop from Undo Stack
        const previousState = this.undoStack.pop();

        // 3. Restore Previous State
        this.restoreSceneState(previousState);

        this.editor.game.showNotification(`Undo (-${this.redoStack.length})`);
        console.log(`[Editor] Undo Complete. Undo Stack: ${this.undoStack.length}, Redo Stack: ${this.redoStack.length}`);
    }

    redo(): void {
        const scene = this.editor.game.sceneManager.currentScene;
        if (!scene) return;

        if (this.redoStack.length === 0) {
            console.log("[Editor] Cannot Redo: End of Buffer");
            this.editor.game.showNotification("Cannot Redo: End of Buffer");
            return;
        }

        console.log("[Editor] Performing Redo...");

        // 1. Capture CURRENT state and push to Undo Stack
        const currentState = scene.toJSON();
        this.undoStack.push(currentState);

        // 2. Pop from Redo Stack
        const nextState = this.redoStack.pop();

        // 3. Restore Next State
        this.restoreSceneState(nextState);

        if (this.redoStack.length === 0) {
            this.editor.game.showNotification(`Redo (Latest)`);
        } else {
            this.editor.game.showNotification(`Redo (-${this.redoStack.length})`);
        }
        console.log(`[Editor] Redo Complete. Undo Stack: ${this.undoStack.length}, Redo Stack: ${this.redoStack.length}`);
    }
}

