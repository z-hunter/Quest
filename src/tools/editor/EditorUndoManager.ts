import { SceneEditor } from '../SceneEditor';

export class EditorUndoManager {
  private editor: SceneEditor;
  private undoStack: Array<{ sceneData: any; version: number }> = [];
  private redoStack: Array<{ sceneData: any; version: number }> = [];
  private readonly MAX_HISTORY = 50;
  private currentMutationVersion = 0;
  private savedMutationVersion = 0;

  constructor(editor: SceneEditor) {
    this.editor = editor;
  }

  private captureCurrentState(): any {
    const scene = this.editor.game.sceneManager.currentScene;
    if (!scene) return null;
    return JSON.parse(JSON.stringify(scene.toJSON()));
  }

  saveUndoState(): void {
    const scene = this.editor.game.sceneManager.currentScene;
    if (!scene) return;

    // Push current state to Undo Stack (Deep Clone)
    this.undoStack.push({
      sceneData: this.captureCurrentState(),
      version: this.currentMutationVersion,
    });

    // Enforce Max History
    if (this.undoStack.length > this.MAX_HISTORY) {
      this.undoStack.shift(); // Remove oldest
    }

    this.currentMutationVersion += 1;

    // Clear Redo Stack on new action
    this.redoStack = [];
  }

  markSaved(): void {
    this.savedMutationVersion = this.currentMutationVersion;
  }

  isDirty(): boolean {
    return this.currentMutationVersion !== this.savedMutationVersion;
  }

  resetForCleanScene(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.currentMutationVersion = 0;
    this.savedMutationVersion = 0;
  }

  restoreSceneState(data: any): void {
    const scene = this.editor.game.sceneManager.currentScene;
    if (!scene) return;
    const previousId = scene.id;
    const previousFilename = scene.filename;

    // Clear existing
    scene.entities = [];
    scene.folders = [];
    scene.walkbox = [];
    scene.triggerboxes = [];
    scene.player = null;
    scene.activeSubscene = null;
    (scene as any)._walkboxEntitiesCache = null;
    (scene as any)._physicalExitsCache = null;

    // Restore persisted scene settings before constructing objects that derive state from them.
    if (data.scaling) scene.scaling = { ...data.scaling };
    if (data.camera) scene.defaultCamera = { ...data.camera };
    Object.assign(scene, {
      id: data.id,
      name: data.name,
      description: data.description,
      filename: data.filename,
      textRedirects: { ...(data.textRedirects || {}) },
      displayOrder: [...(data.displayOrder || [])],
      autoCenter: data.autoCenter ?? true,
      cameraSpeed: data.cameraSpeed ?? 5,
      camDeadzoneX: data.camDeadzoneX ?? 50,
      camDeadzoneY: data.camDeadzoneY ?? 30,
      box3dPerspective: data.box3dPerspective ?? 1,
      box3dOcclusionMode: data.box3dOcclusionMode ?? 'exact',
      camMinX: data.camMinX,
      camMaxX: data.camMaxX,
      camMinY: data.camMinY,
      camMaxY: data.camMaxY,
    });
    if (data.soundEnv) scene.soundEnv = { ...data.soundEnv };
    if (
      (previousId !== scene.id || previousFilename !== scene.filename) &&
      typeof this.editor.game.sceneManager.syncSceneRegistration === 'function'
    ) {
      this.editor.game.sceneManager.syncSceneRegistration(
        scene,
        previousId !== scene.id ? previousId : undefined,
        data,
        false
      );
    }

    if (data.folders) {
      data.folders.forEach((fData: any) => {
        this.editor.createObjectFromData({ ...fData, type: 'Folder' }, undefined, undefined, {
          preserveBindings: true,
        });
      });
    }

    // Restore Entities
    if (data.entities) {
      data.entities.forEach((eData: any) => {
        this.editor.createObjectFromData(eData, undefined, undefined, { preserveBindings: true });
      });
    }

    // Restore Walkboxes
    if (data.walkbox) {
      data.walkbox.forEach((wData: any) => {
        // @ts-ignore
        this.editor.createObjectFromData({ ...wData, type: 'Walkbox' }, undefined, undefined, {
          preserveBindings: true,
        });
      });
    }

    // Restore Triggerboxes
    if (data.triggerboxes) {
      data.triggerboxes.forEach((tData: any) => {
        // @ts-ignore
        this.editor.createObjectFromData({ ...tData, type: 'Triggerbox' }, undefined, undefined, {
          preserveBindings: true,
        });
      });
    }

    this.editor.selectObject(null);
    this.editor.transformManager.drawMode = false;
    this.editor.refreshHierarchy();
  }

  undo(): void {
    if (this.undoStack.length === 0) {
      this.editor.game.showNotification('Cannot Undo: Start of Buffer');
      return;
    }

    const currentState = this.captureCurrentState();
    if (!currentState) return;
    this.redoStack.push({
      sceneData: currentState,
      version: this.currentMutationVersion,
    });

    const previousState = this.undoStack.pop();
    if (!previousState) return;

    this.restoreSceneState(previousState.sceneData);
    this.currentMutationVersion = previousState.version;

    this.editor.game.showNotification(`Undo (-${this.redoStack.length})`);
  }

  redo(): void {
    if (this.redoStack.length === 0) {
      this.editor.game.showNotification('Cannot Redo: End of Buffer');
      return;
    }

    const currentState = this.captureCurrentState();
    if (!currentState) return;
    this.undoStack.push({
      sceneData: currentState,
      version: this.currentMutationVersion,
    });

    const nextState = this.redoStack.pop();
    if (!nextState) return;

    this.restoreSceneState(nextState.sceneData);
    this.currentMutationVersion = nextState.version;

    if (this.redoStack.length === 0) {
      this.editor.game.showNotification(`Redo (Latest)`);
    } else {
      this.editor.game.showNotification(`Redo (-${this.redoStack.length})`);
    }
  }
}
