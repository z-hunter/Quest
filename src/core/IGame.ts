import { AssetLoader } from './AssetLoader';
import { AudioManager } from './AudioManager';
import { SceneManager } from '../scene/SceneManager';
import { SceneEditor } from '../tools/SceneEditor';
import { Entity } from '../entities/Entity';
import { TextAssetManager } from './TextAssetManager';
import type { GameActionOutcome } from './GameActionTypes';
import type { Scene } from '../scene/Scene';
import type { SceneObject } from '../entities/SceneObject';
import type { SpatialRelationType } from '../scene/spatialTypes';

export interface IGame {
  assets: AssetLoader;
  audio: AudioManager;
  textAssets: TextAssetManager;
  sceneManager: SceneManager;
  editor: SceneEditor;
  inventory: Entity[];

  showMessage(text: string): void;
  log(text: string): void;
  text(key: string, params?: Record<string, string | number>): string;
  getSeeMessage(target: SceneObject): string | null;
  lookScene(scene?: Scene | null): GameActionOutcome;
  lookEntity(entity: SceneObject): GameActionOutcome;
  describeSpatialRelation(anchorNodeId: string, relation: SpatialRelationType): GameActionOutcome;
  examineEntity(entity: SceneObject): GameActionOutcome;
  takeEntity(entity: Entity): GameActionOutcome;
  removeInventoryEntity(entity: Entity): GameActionOutcome;
  showInventory(): GameActionOutcome;
  goToSceneTarget(target: string): GameActionOutcome;
  goToScene(sceneId: string): GameActionOutcome;
  goToEntity(entity: Entity): GameActionOutcome;
  showNotification?(text: string): void; // Optional
  onSceneChange?(sceneName: string): void;
  playSound(name: string): void;
  openFileBrowser(
    mode: 'load' | 'save',
    dir: string,
    callback: (file: string) => void,
    extension?: string,
    title?: string,
    onCancel?: () => void
  ): void;
  setCommandInput(input: HTMLInputElement | null): void;
  getCommandInput(): HTMLInputElement | null;
  focusCommandInput(): void;

  // Core property access needed by entities/systems
  input: any;
  isMouseOverUI?: boolean;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  bufferCanvas: HTMLCanvasElement;
}
