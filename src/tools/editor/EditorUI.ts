import { SceneEditor } from '../SceneEditor';
import { Actor } from '../../entities/Actor';
import { Entity } from '../../entities/Entity';
import { useEditorStore } from '../../store/editorStore';

export class EditorUI {
    private editor: SceneEditor;
    private uiInitialized: boolean = false;

    // Cached DOM Elements
    private elParserInput: HTMLInputElement | null = null;

    constructor(editor: SceneEditor) {
        this.editor = editor;
    }

    initUI(): void {
        if (this.uiInitialized) return;

        console.log('[SceneEditor] Initializing UI...');

        // Cache DOM Elements
        this.elParserInput = document.getElementById('parser-input') as HTMLInputElement;

        this.setupListeners();

        this.uiInitialized = true;
        console.log('[SceneEditor] UI Initialized');
    }

    destroy(): void {
        console.log('[SceneEditor] Destroying, removing listeners...');

        if (this.editor.boundKeyHandler) document.removeEventListener('keydown', this.editor.boundKeyHandler, { capture: true });

        if (this.editor.boundMouseDownHandler) this.editor.game.canvas.removeEventListener('mousedown', this.editor.boundMouseDownHandler);
        if (this.editor.boundMouseMoveHandler) window.removeEventListener('mousemove', this.editor.boundMouseMoveHandler);
        if (this.editor.boundMouseUpHandler) window.removeEventListener('mouseup', this.editor.boundMouseUpHandler);

        this.uiInitialized = false;
        this.elParserInput = null;
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

    toggle(): void {
        this.editor.enabled = !this.editor.enabled;

        const parserInput = this.elParserInput;
        // editor-wrapper might be controlled by React now, but if it exists in index.html/App structure for layout, we toggle it.
        // CHECK: App.tsx conditionally renders components based on store, so manual class toggling might be redundant 
        // IF the wrapper is the parent of the React roots. 
        // However, based on App.tsx, 'editor-wrapper' logic seems to be legacy or for the parser.
        // Let's keep the parser logic.

        if (this.editor.enabled) {
            // Block Parser
            if (parserInput) {
                parserInput.blur();
                parserInput.disabled = true;
            }

            // Initial Sync
            const scene = this.editor.game.sceneManager.currentScene;
            if (scene) {
                useEditorStore.getState().setSceneInfo(scene.name, scene.filename || '');
            }

            // Start by selecting scene properties if nothing else selected, or maintain previous?
            // Existing logic selected SCENE.
            this.editor.selectObject('SCENE');

        } else {
            // Restore Parser
            if (parserInput) {
                parserInput.disabled = false;
                parserInput.focus();
            }
        }

        // Update Store
        useEditorStore.getState().toggle(this.editor.enabled);
    }

    // Called when an object is selected or modified
    updateUIFromObject(): void {
        useEditorStore.getState().incrementObjectVersion();
    }

    // Called when the hierarchy needs a refresh (e.g. added/removed object, renamed)
    refreshHierarchy(): void {
        useEditorStore.getState().incrementHierarchyVersion();
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

        // Force update to refresh UI checkboxes/state
        this.updateUIFromObject();
    }
}
