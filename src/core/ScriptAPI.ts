import type { IGame } from './IGame';
import { QuadObject } from '../entities/QuadObject';
import { Actor } from '../entities/Actor';
import { SoundManager, type SoundOptions } from '../systems/SoundManager';

export interface CustomTimer {
  id: number;
  handler: (...args: any[]) => void;
  timeout: number;
  elapsed: number;
  isInterval: boolean;
  args: any[];
}

export class ScriptAPI {
  public scope: 'scene' | 'global' = 'scene';
  public boundSceneId: string | null = null;

  private timers: Map<number, CustomTimer> = new Map();
  private nextTimerId: number = 1;
  private game: IGame;

  constructor(game: IGame) {
    this.game = game;
    this.boundSceneId = this.game.sceneManager.currentScene?.id || null;
  }

  /**
   * Declares this script as a global script, which will keep running and ticking
   * even if the scene it was launched from is unloaded or switched.
   */
  makeGlobal() {
    this.scope = 'global';
  }

  log(message: string) {
    this.game.log(message);
  }

  text(key: string, params?: Record<string, string | number>): string {
    return this.game.text(key, params);
  }

  setInterval(handler: (...args: any[]) => void, timeout: number = 0, ...args: any[]): number {
    const id = this.nextTimerId++;
    this.timers.set(id, { id, handler, timeout, elapsed: 0, isInterval: true, args });
    return id;
  }

  clearInterval(id: number | undefined): void {
    if (id !== undefined) {
      this.timers.delete(id);
    }
  }

  setTimeout(handler: (...args: any[]) => void, timeout: number = 0, ...args: any[]): number {
    const id = this.nextTimerId++;
    this.timers.set(id, { id, handler, timeout, elapsed: 0, isInterval: false, args });
    return id;
  }

  clearTimeout(id: number | undefined): void {
    if (id !== undefined) {
      this.timers.delete(id);
    }
  }

  /**
   * Async helper that resolves after a specified number of milliseconds.
   * Relies on the engine's tick mechanism, so it naturally pauses when the scene is inactive.
   * @param ms Milliseconds to wait
   */
  wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.setTimeout(() => resolve(), ms);
    });
  }

  /**
   * Updates all active timers. Called by ScriptRegistry on active scripts.
   * @param deltaTime Elapsed time in ms since the last frame
   */
  update(deltaTime: number) {
    for (const timer of this.timers.values()) {
      timer.elapsed += deltaTime;
      if (timer.elapsed >= timer.timeout) {
        timer.handler(...timer.args);
        if (timer.isInterval) {
          timer.elapsed = 0; // Reset for next interval
        } else {
          this.timers.delete(timer.id);
        }
      }
    }
  }

  /**
   * Cleans up all active timers created by this script instance.
   */
  dispose() {
    this.timers.clear();
  }

  /**
   * Returns runtime state metadata for this script instance.
   */
  getRuntimeState() {
    return {
      scope: this.scope,
      boundSceneId: this.boundSceneId,
      activeTimers: this.timers.size,
    };
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

  transferActor(actorName: string, targetSceneId: string, targetEntryId?: string | null): boolean {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return false;
    const actor = scene.findEntity(actorName);
    if (!(actor instanceof Actor)) return false;
    return !!this.game.sceneManager.transferActorToScene(actor, targetSceneId, { targetEntryId });
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

  // --- Audio API ---

  /**
   * Loads an audio file into the SoundManager cache.
   * @param id The ID to assign to the sound.
   * @param url The URL path of the sound (e.g. '/sounds/file.mp3').
   */
  async loadSound(id: string, url: string): Promise<void> {
    await SoundManager.getInstance().loadSound(id, url);
  }

  /**
   * Loads an impulse response file for Convolution Reverb.
   * @param url The URL path of the IR sound file.
   */
  async loadReverbIR(url: string): Promise<void> {
    await SoundManager.getInstance().loadReverbIR(url);
  }

  /**
   * Plays a sound without 3D panning.
   * @param id The ID of the loaded sound.
   * @param options Sound options including volume, loop, startTime, offset.
   * @returns Playback handle ID.
   */
  playSound(id: string, options?: SoundOptions): number {
    return SoundManager.getInstance().play(id, options);
  }

  /**
   * Plays a sound attached to a 3D scene entity, automatically tracking its position.
   * @param id The ID of the loaded sound.
   * @param entityName The name of the entity to attach the sound to.
   * @param options Sound options. Includes useProximityEQ and noReverb.
   * @returns Playback handle ID.
   */
  playSoundAttached(
    id: string,
    entityName: string,
    options?: SoundOptions & { useProximityEQ?: boolean; noReverb?: boolean }
  ): number {
    const handle = SoundManager.getInstance().play(id, options);
    if (handle !== -1) {
      SoundManager.getInstance().attachSound(handle, entityName, {
        useProximityEQ: !!options?.useProximityEQ,
        bypassSceneReverb: !!options?.noReverb,
      });
    }
    return handle;
  }

  /**
   * Dynamically sets effects on an actively playing sound.
   * @param handle Playback handle ID.
   * @param effects Effects to apply (reverbAmount, delayAmount, etc).
   */
  setSoundEffects(
    handle: number,
    effects: {
      reverbAmount?: number;
      delayAmount?: number;
      delayTime?: number;
      delayFeedback?: number;
    }
  ) {
    SoundManager.getInstance().setEffects(handle, effects);
  }

  /**
   * Stops an actively playing sound.
   * @param handle Playback handle ID.
   */
  stopSound(handle: number) {
    SoundManager.getInstance().stop(handle);
  }
}
