import { isTauriRuntime, saveProjectFile, readProjectFileExisting } from '../platform/fileApi';
import { Entity } from '../entities/Entity';
import type { EntityData } from '../entities/Entity';
import type { Actor } from '../entities/Actor';
import type { Scene } from '../scene/Scene';
import type { SceneManager } from '../scene/SceneManager';
import type { InventoryManager } from '../systems/InventoryManager';
import type { ConsoleState, ConsoleLineType } from './Console';

const SAVE_KEY = 'quest_savegame';
const SAVE_FILE = 'savegame.json';
const SAVE_VERSION = 1;

interface EntitySaveState {
  disabled?: boolean;
  parentNodeId?: string | null;
  relation?: string | null;
  switchState?: number;
}

interface SceneSaveState {
  playerX?: number;
  playerY?: number;
  entities: Record<string, EntitySaveState>;
  revealedHiddenEntities: string[];
  parserNote: string;
  parserNoteNeedsCheck: boolean;
  entityParserNotes: Record<string, string>;
  camera: { x: number; y: number; zoom: number };
}

interface SaveData {
  version: number;
  timestamp: number;
  currentSceneId: string;
  currentSceneFile: string;
  scenes: Record<string, SceneSaveState>;
  inventoryItems: EntityData[];
  console: ConsoleState;
}

interface GameForSave {
  sceneManager: SceneManager;
  inventory: Entity[];
  inventoryManager: InventoryManager;
  console: {
    log: (text: string, type?: ConsoleLineType) => void;
    toJSON: () => ConsoleState;
    fromJSON: (state: ConsoleState) => void;
  };
}

export class SaveManager {
  private readonly game: GameForSave;
  private pendingSceneStates: Map<string, SceneSaveState> = new Map();

  constructor(game: GameForSave) {
    this.game = game;
  }

  applySceneState(scene: Scene): void {
    const state = this.pendingSceneStates.get(scene.id);
    if (!state) return;

    for (const entity of scene.entities) {
      const es = state.entities[entity.name];
      if (!es) continue;

      if (es.disabled !== undefined) entity.disabled = es.disabled;

      if (es.parentNodeId !== undefined) {
        entity.spatial = {
          ...entity.spatial,
          parentNodeId: es.parentNodeId,
          relation: (es.relation as any) ?? entity.spatial?.relation ?? null,
        };
      }

      const switchComp = entity.components?.find((c: any) => c?.type === 'Switch') as any;
      if (switchComp && es.switchState !== undefined) {
        switchComp.state = es.switchState;
      }
    }

    scene.revealedHiddenEntities = new Set(state.revealedHiddenEntities);
    scene.parserNote = state.parserNote ?? '';
    scene.parserNoteNeedsCheck = state.parserNoteNeedsCheck ?? false;
    scene.entityParserNotes = { ...(state.entityParserNotes ?? {}) };

    if (state.camera) {
      scene.camera = { ...state.camera };
    }

    this.pendingSceneStates.delete(scene.id);
  }

  async save(): Promise<void> {
    const { sceneManager, inventory } = this.game;
    const currentScene = sceneManager.currentScene;

    if (!currentScene) {
      this.game.console.log('Nothing to save — no scene loaded.', 'error');
      return;
    }

    const scenes: Record<string, SceneSaveState> = {};
    for (const [sceneId, scene] of sceneManager.scenes) {
      scenes[sceneId] = this.serializeScene(scene);
    }

    const inventoryItems: EntityData[] = inventory.map((e) => (e as any).toJSON());
    this.markInventoryItemsDisabledInHomeScenes(inventoryItems, scenes);

    const saveData: SaveData = {
      version: SAVE_VERSION,
      timestamp: Date.now(),
      currentSceneId: currentScene.id,
      currentSceneFile:
        (currentScene.filename || currentScene.id).replace(/\.json$/i, '') + '.json',
      scenes,
      inventoryItems,
      console: this.game.console.toJSON(),
    };

    try {
      const json = JSON.stringify(saveData);
      if (isTauriRuntime()) {
        await saveProjectFile(SAVE_FILE, json);
      } else {
        localStorage.setItem(SAVE_KEY, json);
      }
      this.game.console.log('Game saved.', 'info');
    } catch {
      this.game.console.log('Failed to save game.', 'error');
    }
  }

  async hasSave(): Promise<boolean> {
    try {
      if (isTauriRuntime()) {
        const content = await readProjectFileExisting(SAVE_FILE);
        return !!content;
      }
      return localStorage.getItem(SAVE_KEY) !== null;
    } catch {
      return false;
    }
  }

  async load(): Promise<boolean> {
    try {
      let json: string | null = null;
      if (isTauriRuntime()) {
        json = await readProjectFileExisting(SAVE_FILE);
      } else {
        json = localStorage.getItem(SAVE_KEY);
      }

      if (!json) return false;

      const saveData: SaveData = JSON.parse(json);
      if (!saveData || saveData.version !== SAVE_VERSION) return false;

      for (const [sceneId, sceneState] of Object.entries(saveData.scenes)) {
        this.pendingSceneStates.set(sceneId, sceneState);
      }
      const inventoryItems: EntityData[] = saveData.inventoryItems ?? [];
      this.markInventoryItemsDisabledInHomeScenes(inventoryItems);

      await this.game.sceneManager.loadScene(saveData.currentSceneFile);

      const savedScene = this.game.sceneManager.currentScene;
      if (!savedScene) return false;

      const player = this.findPlayer();

      if (player) {
        this.game.sceneManager.transferActorToScene(player, savedScene.id, {
          activateScene: false,
          setAsScenePlayer: true,
        });

        const savedSceneState = saveData.scenes[saveData.currentSceneId];
        if (savedSceneState?.playerX !== undefined && savedSceneState?.playerY !== undefined) {
          player.x = savedSceneState.playerX;
          player.y = savedSceneState.playerY;
        }

        this.restoreInventoryFromData(inventoryItems, savedScene, player);
      }

      if (saveData.console) {
        this.game.console.fromJSON(saveData.console);
      }

      return true;
    } catch (e) {
      console.error('[SaveManager] Failed to load save:', e);
      return false;
    }
  }

  private markInventoryItemsDisabledInHomeScenes(
    inventoryItems: EntityData[],
    scenesMap?: Record<string, SceneSaveState>
  ): void {
    const registry = this.game.sceneManager.sceneRegistry;

    for (const itemData of inventoryItems) {
      for (const [sceneId, descriptor] of registry) {
        const sourceEntities = (descriptor.sourceData as any)?.entities;
        if (!Array.isArray(sourceEntities)) continue;
        if (!sourceEntities.some((e: any) => e.name === itemData.name)) continue;

        let pending = this.pendingSceneStates.get(sceneId);
        if (!pending) {
          pending = {
            entities: {},
            revealedHiddenEntities: [],
            parserNote: '',
            parserNoteNeedsCheck: false,
            entityParserNotes: {},
            camera: { x: 0, y: 0, zoom: 1 },
          };
          this.pendingSceneStates.set(sceneId, pending);
        }
        pending.entities[itemData.name] = { ...pending.entities[itemData.name], disabled: true };

        if (scenesMap && scenesMap[sceneId]) {
          scenesMap[sceneId].entities[itemData.name] = {
            ...scenesMap[sceneId].entities[itemData.name],
            disabled: true,
          };
        }

        break;
      }
    }
  }

  private restoreInventoryFromData(
    inventoryItems: EntityData[],
    scene: Scene,
    player: Entity
  ): void {
    if (inventoryItems.length === 0) return;

    const items: Entity[] = [];

    for (const itemData of inventoryItems) {
      let entity = scene.entities.find((e) => e.name === itemData.name) as Entity | undefined;

      if (!entity) {
        entity = Entity.fromJSON(this.game as any, itemData);
        scene.addEntity(entity);
      }

      entity.disabled = false;
      entity.spatial = { parentNodeId: player.name, relation: 'in' };
      items.push(entity);
    }

    this.game.inventoryManager.syncInventoryStore(player, items, 'in');
  }

  private findPlayer(): Actor | null {
    for (const scene of this.game.sceneManager.scenes.values()) {
      if (scene.player) return scene.player;
    }
    return null;
  }

  private serializeScene(scene: Scene): SceneSaveState {
    const entities: Record<string, EntitySaveState> = {};

    for (const entity of scene.entities) {
      const state: EntitySaveState = {};
      let changed = false;

      if (entity.disabled) {
        state.disabled = true;
        changed = true;
      }

      if (entity.spatial?.parentNodeId != null) {
        state.parentNodeId = entity.spatial.parentNodeId;
        state.relation = entity.spatial.relation ?? null;
        changed = true;
      }

      const switchComp = entity.components?.find((c: any) => c?.type === 'Switch') as any;
      if (switchComp && typeof switchComp.state === 'number') {
        state.switchState = switchComp.state;
        changed = true;
      }

      if (changed) entities[entity.name] = state;
    }

    return {
      playerX: scene.player?.x,
      playerY: scene.player?.y,
      entities,
      revealedHiddenEntities: Array.from(scene.revealedHiddenEntities),
      parserNote: scene.parserNote,
      parserNoteNeedsCheck: scene.parserNoteNeedsCheck,
      entityParserNotes: { ...scene.entityParserNotes },
      camera: { ...scene.camera },
    };
  }
}
