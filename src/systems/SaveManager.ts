import type { Game } from '../core/Game';
import { readProjectFileExisting, saveProjectFile } from '../platform/fileApi';
import {
  SAVE_STATE_ENGINE,
  SAVE_STATE_VERSION,
  applyJsonDelta,
  createJsonDelta,
  fingerprintJson,
  migrateSaveState,
  type SavedSceneDelta,
  type SaveStateV1,
} from './saveState';

export const SAVE_DIRECTORY = 'saves';

export class SaveManager {
  private readonly game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  static normalizeName(name: string): string {
    const normalized = String(name || '').trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,63}$/.test(normalized)) {
      throw new Error('Save name must be 1-64 characters using letters, numbers, spaces, _ or -.');
    }
    return normalized;
  }

  static pathFor(name: string): string {
    return `${SAVE_DIRECTORY}/${SaveManager.normalizeName(name).replace(/\s+/g, '_')}.json`;
  }

  createState(name: string): SaveStateV1 {
    const normalizedName = SaveManager.normalizeName(name);
    const currentScene = this.game.sceneManager.currentScene;
    if (!currentScene) throw new Error('Cannot save: no current scene is loaded.');
    const scenes: SavedSceneDelta[] = [];
    const authoredSceneHashes: Record<string, string> = {};
    for (const source of this.game.sceneManager.getSaveSceneSources()) {
      const delta = createJsonDelta(source.authored, source.current);
      const runtime = source.runtime;
      if (delta || runtime) {
        scenes.push({ id: source.id, path: source.path, delta, runtime });
        authoredSceneHashes[source.id] = fingerprintJson(source.authored);
      }
    }
    return {
      format: SAVE_STATE_ENGINE,
      version: SAVE_STATE_VERSION,
      metadata: {
        name: normalizedName,
        createdAt: new Date().toISOString(),
        currentSceneId: currentScene.id,
      },
      compatibility: { minimumVersion: 1, authoredSceneHashes },
      game: { score: this.game.score },
      scenes,
      parser: { pendingState: this.clone(this.game.parser.pendingState) },
      npcPuppetMaster: this.game.npcPuppetMaster.exportSaveState(),
      console: this.game.console.toJSON(),
    };
  }

  async save(name: string): Promise<SaveStateV1> {
    const state = this.createState(name);
    await saveProjectFile(SaveManager.pathFor(name), `${JSON.stringify(state, null, 2)}\n`);
    return state;
  }

  async load(name: string): Promise<SaveStateV1> {
    const content = await readProjectFileExisting(SaveManager.pathFor(name));
    const state = migrateSaveState(JSON.parse(content));
    this.restoreState(state);
    return state;
  }

  restoreState(state: SaveStateV1): void {
    const parsed = migrateSaveState(state);
    const sources = new Map(
      this.game.sceneManager.getSaveSceneSources().map((source) => [source.id, source])
    );
    const savedScenes = parsed.scenes.map((saved) => {
      const source = sources.get(saved.id);
      if (!source) throw new Error(`Save references unknown scene '${saved.id}'.`);
      const expectedHash = parsed.compatibility.authoredSceneHashes[saved.id];
      const actualHash = fingerprintJson(source.authored);
      if (!expectedHash || expectedHash !== actualHash) {
        throw new Error(
          `Save is incompatible with authored scene '${saved.id}' (expected ${expectedHash || 'missing hash'}, found ${actualHash}).`
        );
      }
      return {
        id: saved.id,
        path: saved.path || source.path,
        data: applyJsonDelta(source.authored, saved.delta),
      };
    });
    this.game.npcPuppetMaster.haltAllNpcs();
    this.game.sceneManager.restoreSavedScenes(savedScenes, parsed.metadata.currentSceneId);
    for (const saved of parsed.scenes) {
      const scene = this.game.sceneManager.scenes.get(saved.id);
      if (scene && saved.runtime) {
        this.game.sceneManager.restoreSceneRuntimeSnapshot(saved.id, saved.runtime);
      }
    }
    this.game.inventoryManager.handleSceneChange();
    this.game.score = parsed.game.score;
    this.game.parser.pendingState = this.clone(parsed.parser.pendingState);
    this.game.npcPuppetMaster.importSaveState(parsed.npcPuppetMaster);
    this.game.console.fromJSON(parsed.console);
  }

  private clone<T>(value: T): T {
    return value == null ? value : structuredClone(value);
  }
}
