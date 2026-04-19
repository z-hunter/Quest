import { SceneEditor } from '../SceneEditor';
import { Entity } from '../../entities/Entity';
import { SceneObject } from '../../entities/SceneObject';
import { SceneSpatialValidator } from '../../scene/SceneSpatialValidator';
import { useEditorStore } from '../../store/editorStore';
import { saveProjectFile } from '../../platform/fileApi';

export class EditorPersistenceManager {
  private editor: SceneEditor;
  private trackedSceneRef: object | null = null;
  private pendingSceneSave: Promise<boolean> | null = null;

  constructor(editor: SceneEditor) {
    this.editor = editor;
  }

  ensureCurrentSceneBaseline(): void {
    const scene = this.editor.game.sceneManager.currentScene;
    if (!scene) return;
    if (this.trackedSceneRef === scene) return;
    this.trackedSceneRef = scene;
    this.editor.undoManager.resetForCleanScene();
  }

  markSceneSaved(): void {
    this.editor.undoManager.markSaved();
  }

  private reportSceneSpatialValidation(phase: 'load' | 'save'): void {
    const scene = this.editor.game.sceneManager.currentScene;
    if (!scene) return;

    const result = SceneSpatialValidator.validate(scene, this.editor.game as any);
    if (result.issues.length === 0) {
      console.info(`[SceneSpatialValidator] ${phase}: '${scene.name}' has no issues.`);
      return;
    }

    const summary = `Spatial validation ${phase}: ${result.errors.length} error(s), ${result.warnings.length} warning(s)`;
    this.editor.game.showNotification(summary);
    const logMethod = result.errors.length > 0 ? console.warn : console.info;
    logMethod(`[SceneSpatialValidator] ${summary} in '${scene.name}'.`, result.issues);
  }

  isCurrentSceneDirty(): boolean {
    return this.editor.undoManager.isDirty();
  }

  private async confirmProceedWithUnsavedChanges(): Promise<'save' | 'discard' | 'cancel'> {
    const game = this.editor.game;
    const choice = await game.requestChoiceDialog(
      'Unsaved Changes',
      'The current scene has unsaved changes. What would you like to do?',
      [
        { id: 'save', label: 'Save and Continue', variant: 'primary' },
        { id: 'discard', label: 'Continue Without Saving', variant: 'danger' },
        { id: 'cancel', label: 'Cancel', variant: 'neutral' },
      ]
    );

    if (choice === 'save' || choice === 'discard') return choice;
    return 'cancel';
  }

  async runWithUnsavedChangesGuard(action: () => Promise<void> | void): Promise<void> {
    if (this.pendingSceneSave) {
      const saveResult = await this.pendingSceneSave;
      if (!saveResult && this.isCurrentSceneDirty()) {
        return;
      }
    }

    if (!this.isCurrentSceneDirty()) {
      await action();
      return;
    }

    const choice = await this.confirmProceedWithUnsavedChanges();
    if (choice === 'cancel') return;

    if (choice === 'save') {
      const saved = await this.saveScene(false);
      if (!saved) return;
    }

    await action();
  }

  // --- Scene Saving ---

  async saveScene(saveAs: boolean = false): Promise<boolean> {
    if (this.pendingSceneSave) {
      return this.pendingSceneSave;
    }

    const savePromise = this.saveSceneInternal(saveAs);
    this.pendingSceneSave = savePromise;
    try {
      return await savePromise;
    } finally {
      if (this.pendingSceneSave === savePromise) {
        this.pendingSceneSave = null;
      }
    }
  }

  private async saveSceneInternal(saveAs: boolean = false): Promise<boolean> {
    const scene = this.editor.game.sceneManager.currentScene;
    if (!scene) return false;
    const previousSceneId = scene.id || '';

    const id = scene.id || '';
    // Allow backslashes for subfolders
    const isValidId = id && id !== 'new_scene';

    if (!saveAs && isValidId) {
      // Smart Save
      // Ensure filename property matches ID (normalized for file system)
      scene.filename = id.replace(/\\/g, '/');
      return this.performSaveScene(scene.filename, previousSceneId);
    }

    // Fallback / Save As
    return new Promise((resolve) => {
      this.editor.game.openFileBrowser(
        'save',
        'public/scenes',
        async (filename: string) => {
          // Update Filename from browser selection
          const name = filename.replace('.json', '');

          // Normalize slashes for ID: use backslash for subfolders
          const idFromName = name.replace(/\//g, '\\');

          scene.filename = name;
          scene.id = idFromName;
          this.editor.game.sceneManager.syncSceneRegistration(scene, previousSceneId);

          this.editor.syncUI(); // Refresh UI to show new Filename
          const result = await this.performSaveScene(scene.filename, previousSceneId);
          resolve(result);
        },
        undefined,
        undefined,
        () => resolve(false)
      );
    });
  }

  async performSaveScene(filenameId: string, previousSceneId?: string): Promise<boolean> {
    const scene = this.editor.game.sceneManager.currentScene;
    if (!scene) return false;
    this.reportSceneSpatialValidation('save');

    // Ensure filenameId uses forward slashes for URL/Path
    const normalizedPath = filenameId.replace(/\\/g, '/');

    const data = scene.toJSON();
    const json = JSON.stringify(data, null, 2);
    const filePath = `public/scenes/${normalizedPath}.json`;

    try {
      await saveProjectFile(filePath, json);
      this.editor.game.sceneManager.syncSceneRegistration(scene, previousSceneId, data);
      await this.editor.game.textAssets.carrySceneAssetIfNeeded(previousSceneId, scene);
      this.markSceneSaved();
      // Use Toast Message
      this.editor.game.showNotification(`Scene saved as ${normalizedPath}.json`);
      return true;
    } catch (e) {
      console.error('Failed to save scene:', e);
      this.editor.game.showNotification(`Error saving scene: ${e}`);
      return false;
    }
  }

  // --- Scene Loading ---

  promptLoadScene(): void {
    void this.runWithUnsavedChangesGuard(async () => {
      this.editor.game.openFileBrowser('load', 'public/scenes', async (filename: string) => {
        await this.editor.game.sceneManager.loadScene(filename);
        this.editor.syncUI();
        this.editor.refreshHierarchy();
        this.editor.selectObject(null);
        const scene = this.editor.game.sceneManager.currentScene;
        if (scene) {
          this.trackedSceneRef = scene;
          this.editor.undoManager.resetForCleanScene();
          this.reportSceneSpatialValidation('load');
        }
      });
    });
  }

  // --- Prefab Saving ---

  async saveObject(): Promise<void> {
    let selection = this.editor.selectionManager.hasMultiSelection()
      ? this.editor.selectionManager.getSelectedObjects()
      : this.editor.selectedObject instanceof SceneObject
        ? [this.editor.selectedObject]
        : [];

    if (!selection.length) {
      this.editor.game.showNotification('Select an Object to Save');
      return;
    }

    // If selection includes folders, also include their contents
    const scene = this.editor.game.sceneManager.currentScene;
    if (scene) {
      const folderIds = selection
        .filter((obj) => obj.type === 'Folder')
        .map((obj) => (obj as any).folderId)
        .filter(Boolean);
      if (folderIds.length > 0) {
        const result = new Set<SceneObject>(selection);
        const allObjects: SceneObject[] = [
          ...scene.entities,
          ...scene.walkbox,
          ...scene.triggerboxes,
        ];
        for (const obj of allObjects) {
          if ((obj as any).folder && folderIds.includes((obj as any).folder)) {
            result.add(obj);
          }
        }
        selection = Array.from(result);
      }
    }

    this.editor.game.openFileBrowser('save', 'public/prefabs', (filename: string) => {
      this.performSaveObject(filename, selection);
    });
  }

  async performSaveObject(filename: string, selection: SceneObject[]): Promise<void> {
    if (!selection.length) return;

    const serialized = selection.map((obj) => obj.toJSON());
    const data =
      serialized.length === 1
        ? serialized[0]
        : {
            kind: 'group_prefab',
            version: 1,
            items: serialized,
            order: serialized.map((item) => `${item.type || 'Entity'}:${item.name || 'Object'}`),
            anchorKey: `${serialized[0]?.type || 'Entity'}:${serialized[0]?.name || 'Object'}`,
            meta: { source: 'prefab-save', timestamp: Date.now() },
          };

    const json = JSON.stringify(data, null, 2);
    const filePath = `public/prefabs/${filename}`;

    try {
      await saveProjectFile(filePath, json);
      this.editor.game.showNotification(`Prefab Saved: ${filename} `);
    } catch (e) {
      console.error('Failed to save prefab:', e);
      this.editor.game.showNotification(`Error: ${e} `);
    }
  }

  // --- Prefab Loading ---

  async loadObject(mode: 'default' | 'cursor' = 'default'): Promise<void> {
    if (!this.editor.game.sceneManager.currentScene) return;
    const insertionWorldPos = mode === 'cursor' ? this.editor.getMouseWorldPosIfOverCanvas() : null;
    this.editor.game.openFileBrowser('load', 'public/prefabs', (filename: string) => {
      this.performLoadObject(filename, mode, insertionWorldPos);
    });
  }

  async performLoadObject(
    filename: string,
    mode: 'default' | 'cursor' = 'default',
    insertionWorldPos: { x: number; y: number } | null = null
  ): Promise<void> {
    try {
      const response = await fetch(`/prefabs/${filename}?t=${Date.now()}`);
      if (!response.ok) throw new Error('File not found');
      const data = await response.json();

      // Backward compatibility for single-object prefabs:
      // keep previous naming behavior based on file path.
      const isGroupPrefab =
        data &&
        typeof data === 'object' &&
        data.kind === 'group_prefab' &&
        Array.isArray(data.items);

      let payload: any = data;
      if (!isGroupPrefab) {
        if (!payload.type) payload.type = 'Static';
        const baseId = filename.replace('.json', '').replace(/\//g, '\\');
        payload = { ...payload, name: baseId };
      }

      const resolvedInsertionPoint = mode === 'cursor' ? insertionWorldPos : null;

      const created = this.editor.selectionManager.instantiateFromSerializedData(payload, {
        saveUndo: true,
        // For Ctrl+O we must use cursor position captured at hotkey time only.
        // If it was outside canvas, selection manager will fall back to center view.
        preferCursor: false,
        insertionWorldPos: resolvedInsertionPoint,
        preserveOriginalPosition: mode === 'default',
      });
      if (mode === 'cursor' && !resolvedInsertionPoint) {
        this.editor.game.showNotification('Prefab loaded: cursor not on canvas, used center view');
      }
      if (!created.length) {
        this.editor.game.showNotification('Failed to instantiate prefab');
      }
    } catch (e) {
      console.error(e);
      this.editor.game.showNotification('Failed to load prefab');
    }
  }

  promptSetSprite(): void {
    if (!this.editor.selectedObject || !(this.editor.selectedObject instanceof Entity)) return;

    this.editor.game.openFileBrowser('load', 'public/sprites', (filename: string) => {
      // Logic to set sprite
      const ent = this.editor.selectedObject as Entity;
      // Assume browser returns "chars/hero.json" or "folder/hero.json"

      const spriteName = filename.replace('.json', '');
      ent.setSprite(spriteName);
      useEditorStore.getState().incrementObjectVersion();
    });
  }
}
