import { AssetLoader } from './AssetLoader';
import { AudioManager } from './AudioManager';
import { SceneManager } from '../scene/SceneManager';
import { SceneEditor } from '../tools/SceneEditor';
import { Entity } from '../entities/Entity';
import { TextAssetManager } from './TextAssetManager';
import type { GameActionOutcome } from './GameActionTypes';

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
  look(target?: string | null): GameActionOutcome;
  take(target?: string | null): GameActionOutcome;
  showInventory(): GameActionOutcome;
  goTo(target?: string | null): GameActionOutcome;
  showNotification?(text: string): void; // Optional
  onSceneChange?(sceneName: string): void;
  playSound(name: string): void;
  openFileBrowser(
    mode: 'load' | 'save',
    dir: string,
    callback: (file: string) => void,
    extension?: string
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
