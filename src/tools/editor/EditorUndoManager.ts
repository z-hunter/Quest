
import { SceneEditor } from '../SceneEditor';

export class EditorUndoManager {
    private editor: SceneEditor;
    private undoBuffer: any = null; // Stores SceneData for Undo

    constructor(editor: SceneEditor) {
        this.editor = editor;
    }

    saveUndoState(): void {
        const scene = this.editor.game.sceneManager.currentScene;
        if (!scene) return;
        this.undoBuffer = scene.toJSON();
        console.log('[Editor] Undo State Saved');
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
        this.editor.drawMode = false;
        this.editor.refreshHierarchy();
    }

    undo(): void {
        if (!this.undoBuffer) {
            console.log("[Editor] Nothing to undo.");
            return;
        }

        const scene = this.editor.game.sceneManager.currentScene;
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
}
