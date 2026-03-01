import { SceneEditor } from '../SceneEditor';
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


        // Cache command input provided by UI layer
        this.elParserInput = this.editor.game.getCommandInput();

        this.setupListeners();

        this.uiInitialized = true;
    }

    destroy(): void {
        if (this.editor.boundKeyHandler) document.removeEventListener('keydown', this.editor.boundKeyHandler, { capture: true });

        if (this.editor.boundMouseDownHandler) this.editor.game.canvas.removeEventListener('mousedown', this.editor.boundMouseDownHandler);
        if (this.editor.boundMouseMoveHandler) window.removeEventListener('mousemove', this.editor.boundMouseMoveHandler);
        if (this.editor.boundMouseUpHandler) window.removeEventListener('mouseup', this.editor.boundMouseUpHandler);
        if (this.editor.boundWheelHandler) this.editor.game.canvas.removeEventListener('wheel', this.editor.boundWheelHandler);

        this.uiInitialized = false;
        this.elParserInput = null;
    }

    setupListeners(): void {
        // Canvas Interaction Listeners
        this.editor.game.canvas.addEventListener('mousedown', this.editor.boundMouseDownHandler);
        // Passive: false is required to preventDefault() on wheel events
        this.editor.game.canvas.addEventListener('wheel', this.editor.boundWheelHandler, { passive: false });
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

}
