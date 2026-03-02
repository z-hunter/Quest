import type { IGame } from './IGame';
import { QuadObject } from '../entities/QuadObject';

export class ScriptAPI {
  private intervals: number[] = [];
  private timeouts: number[] = [];
  private game: IGame;

  constructor(game: IGame) {
    this.game = game;
  }

  log(message: string) {
    this.game.log(message);
  }

  setInterval(handler: TimerHandler, timeout?: number, ...args: any[]): number {
    const id = setInterval(handler, timeout, ...args);
    this.intervals.push(id);
    return id;
  }

  clearInterval(id: number | undefined): void {
    if (id === undefined) return;
    const idx = this.intervals.indexOf(id);
    if (idx !== -1) {
      this.intervals.splice(idx, 1);
    }
    clearInterval(id);
  }

  setTimeout(handler: TimerHandler, timeout?: number, ...args: any[]): number {
    const id = setTimeout(handler, timeout, ...args);
    this.timeouts.push(id);
    return id;
  }

  clearTimeout(id: number | undefined): void {
    if (id === undefined) return;
    const idx = this.timeouts.indexOf(id);
    if (idx !== -1) {
      this.timeouts.splice(idx, 1);
    }
    clearTimeout(id);
  }

  /**
   * Cleans up all active timers created by this script instance.
   */
  dispose() {
    this.intervals.forEach((id) => clearInterval(id));
    this.timeouts.forEach((id) => clearTimeout(id));
    this.intervals = [];
    this.timeouts = [];
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
    }
  }
}
