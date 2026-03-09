import { SceneEditor } from '../SceneEditor';
import { Entity } from '../../entities/Entity';
import { SceneObject } from '../../entities/SceneObject';
import { useEditorStore } from '../../store/editorStore';

export class EditorPersistenceManager {
  private editor: SceneEditor;

  constructor(editor: SceneEditor) {
    this.editor = editor;
  }

  // --- Scene Saving ---

  async saveScene(saveAs: boolean = false): Promise<void> {
    const scene = this.editor.game.sceneManager.currentScene;
    if (!scene) return;
    const previousSceneId = scene.id || '';

    const id = scene.id || '';
    // Allow backslashes for subfolders
    const isValidId = id && id !== 'new_scene';

    if (!saveAs && isValidId) {
      // Smart Save
      // Ensure filename property matches ID (normalized for file system)
      scene.filename = id.replace(/\\/g, '/');
      this.performSaveScene(scene.filename, previousSceneId);
      return;
    }

    // Fallback / Save As
    this.editor.game.openFileBrowser('save', 'public/scenes', (filename: string) => {
      // Update Filename from browser selection
      const name = filename.replace('.json', '');

      // Normalize slashes for ID: use backslash for subfolders
      const idFromName = name.replace(/\//g, '\\');

      scene.filename = name;
      scene.id = idFromName;

      this.editor.syncUI(); // Refresh UI to show new Filename
      this.performSaveScene(scene.filename, previousSceneId);
    });
  }

  async performSaveScene(filenameId: string, previousSceneId?: string): Promise<void> {
    const scene = this.editor.game.sceneManager.currentScene;
    if (!scene) return;

    // Ensure filenameId uses forward slashes for URL/Path
    const normalizedPath = filenameId.replace(/\\/g, '/');

    const data = scene.toJSON();
    const json = JSON.stringify(data, null, 2);
    const filePath = `public/scenes/${normalizedPath}.json`;

    try {
      const response = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: json }),
      });

      if (response.ok) {
        await this.editor.game.textAssets.carrySceneAssetIfNeeded(previousSceneId, scene);
        // Use Toast Message
        this.editor.game.showNotification(`Scene saved as ${normalizedPath}.json`);
      } else {
        throw new Error(await response.text());
      }
    } catch (e) {
      console.error('Failed to save scene:', e);
      this.editor.game.showNotification(`Error saving scene: ${e}`);
    }
  }

  // --- Scene Loading ---

  promptLoadScene(): void {
    this.editor.game.openFileBrowser('load', 'public/scenes', async (filename: string) => {
      await this.editor.game.sceneManager.loadScene(filename);
      this.editor.syncUI();
      this.editor.refreshHierarchy();
      this.editor.selectObject(null);
    });
  }

  // --- Prefab Saving ---

  async saveObject(): Promise<void> {
    const selection = this.editor.selectionManager.hasMultiSelection()
      ? this.editor.selectionManager.getSelectedObjects()
      : this.editor.selectedObject instanceof SceneObject
        ? [this.editor.selectedObject]
        : [];

    if (!selection.length) {
      this.editor.game.showNotification('Select an Object to Save');
      return;
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
      const response = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: json }),
      });

      if (response.ok) {
        this.editor.game.showNotification(`Prefab Saved: ${filename} `);
      } else {
        throw new Error(await response.text());
      }
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
