import { SceneEditor } from '../SceneEditor';
import { Entity } from '../../entities/Entity';
import { Actor } from '../../entities/Actor';
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

    const id = scene.id || '';
    // Allow backslashes for subfolders
    const isValidId = id && id !== 'new_scene';

    if (!saveAs && isValidId) {
      // Smart Save
      // Ensure filename property matches ID (normalized for file system)
      scene.filename = id.replace(/\\/g, '/');
      this.performSaveScene(scene.filename);
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
      this.performSaveScene(scene.filename);
    });
  }

  async performSaveScene(filenameId: string): Promise<void> {
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
        body: JSON.stringify({ path: filePath, content: json })
      });

      if (response.ok) {
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
    if (!this.editor.selectedObject || !(this.editor.selectedObject instanceof Entity)) {
      this.editor.game.showNotification("Select an Object to Save");
      return;
    }

    this.editor.game.openFileBrowser('save', 'public/prefabs', (filename: string) => {
      this.performSaveObject(filename);
    });
  }

  async performSaveObject(filename: string): Promise<void> {
    if (!this.editor.selectedObject) return;
    const ent = this.editor.selectedObject as Entity;

    // Use Entity.toJSON or basic properties
    const data = ent.toJSON ? ent.toJSON() : {
      type: (ent as any).type || (ent instanceof Actor ? 'Actor' : 'Static'),
      name: ent.name,
      x: 0,
      y: 0,
      width: ent.width,
      height: ent.height,
      color: ent.color,
      scale: ent.scale,
      layer: ent.layer,
      parallax: ent.parallax,
      spriteName: ent.spriteName,
      ignoreScaling: ent.ignoreScaling
    };

    const json = JSON.stringify(data, null, 2);
    const filePath = `public/prefabs/${filename}`;

    try {
      const response = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: json })
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

  async loadObject(): Promise<void> {
    if (!this.editor.game.sceneManager.currentScene) return;
    this.editor.game.openFileBrowser('load', 'public/prefabs', (filename: string) => {
      this.performLoadObject(filename);
    });
  }

  async performLoadObject(filename: string): Promise<void> {
    try {
      const response = await fetch(`/prefabs/${filename}?t=${Date.now()}`);
      if (!response.ok) throw new Error('File not found');
      const data = await response.json();

      // Validate data
      if (!data.type) data.type = 'Static'; // Default

      // Logic 2 & 3: ID Derivation & Collision
      // Filename: "folder/chair.json" -> ID: "folder\chair"
      const baseId = filename.replace('.json', '').replace(/\//g, '\\');

      // Check Collision against current scene objects
      const scene = this.editor.game.sceneManager.currentScene;
      if (scene) {
        const allObjects = [
          ...(scene.entities || []),
          ...(scene.walkbox || []),
          ...(scene.triggerboxes || [])
        ];

        // Override name in data to be the ID (or base it off ID)
        // Actually, objects have 'name', not 'id'. We treat 'name' as unique identifier in Editor.
        // So we format the name as "folder\chair".

        let newName = baseId;
        let counter = 1;

        const isNameTaken = (n: string) => allObjects.some((o: any) => o.name === n);

        if (isNameTaken(newName)) {
          // Try name_1, name_2...
          while (isNameTaken(`${baseId}_${counter}`)) {
            counter++;
          }
          newName = `${baseId}_${counter}`;
        }

        data.name = newName;
      }

      // Use Editor's creation logic
      const entity = this.editor.createObjectFromData(data);

      if (entity) {
        this.editor.selectObject(entity);
        this.editor.refreshHierarchy();
      }

    } catch (e) {
      console.error(e);
      this.editor.game.showNotification("Failed to load prefab");
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
