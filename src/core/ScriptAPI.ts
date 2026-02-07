import type { IGame } from './IGame';
import { QuadObject } from '../entities/QuadObject';

export class ScriptAPI {
  constructor(private game: IGame) { }

  log(message: string) {
    this.game.log(message);
  }

  /**
  * Retrieves a QuadObject by name.
  * @param name Name of the QuadObject
  * @returns The QuadObject or null if not found
  */
  getQuad(name: string): QuadObject | null {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return null;

    const entity = scene.findEntity(name);
    if (entity && entity.type === 'Quad') {
      return entity as QuadObject;
    }

    console.warn(`[ScriptAPI] Quad '${name}' not found.`);
    return null;
  }

  /**
   * Retrieves an Actor by name.
   * @param name Name of the Actor
   * @returns The Actor instance or null if not found
   */
  getActor(name: string) {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return null;

    const entity = scene.findEntity(name);
    if (entity && entity.type === 'Actor') {
      return entity as any; // Cast as any to avoid circular imports / strict typing issues in scripts for now
    }
    return null;
  }

  /**
   * Retrieves a generic Entity by name.
   * @param name Name of the Entity
   * @returns The Entity instance or null if not found
   */
  getEntity(name: string) {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return null;
    return scene.findEntity(name) as any;
  }

  /**
   * Saves the current scene state to the Undo History.
   * Useful for creating granular undo points within a script.
   */
  saveCheckpoint() {
    if (this.game.editor) {
      this.game.editor.saveUndoState();
      console.log('[ScriptAPI] Checkpoint saved.');
    }
  }
}
