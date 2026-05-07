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
import type { InventoryManager } from '../systems/InventoryManager';

export interface IGame {
  assets: AssetLoader;
  audio: AudioManager;
  textAssets: TextAssetManager;
  sceneManager: SceneManager;
  editor: SceneEditor;
  inventory: Entity[];
  inventoryManager: InventoryManager;
  getInventoryPreviewEntity(): Entity | null;
  getInventoryPreviewText(): string | null;
  openInventoryPreview(entity: Entity, previewText?: string | null): void;
  closeInventoryPreview(): void;

  isEntityInInventory(entity: Entity): boolean;
  showMessage(text: string): void;
  log(text: string): void;
  logResponse?(messages: string[]): void;
  text(key: string, params?: Record<string, string | number>): string;
  getSeeMessage(target: SceneObject): string | null;
  getBlockedAccessOutcome(entity: SceneObject): GameActionOutcome | null;
  lookScene(scene?: Scene | null): GameActionOutcome;
  lookEntity(entity: SceneObject): GameActionOutcome;
  describeSpatialRelation(anchorNodeId: string, relation: SpatialRelationType): GameActionOutcome;
  getRelationScopedTakeCandidates?(
    anchor: SceneObject,
    relation: SpatialRelationType | 'near'
  ): { status: 'resolved'; candidates: Entity[]; hasStorage: boolean } | GameActionOutcome;
  isEntityInPutTarget?(
    source: SceneObject,
    target: SceneObject,
    relation: SpatialRelationType | 'near' | null
  ): boolean;
  examineEntity(entity: SceneObject): GameActionOutcome;
  openEntity(entity: SceneObject): GameActionOutcome;
  closeEntity(entity: SceneObject): GameActionOutcome;
  closeFocusedView(): GameActionOutcome;
  takeEntity(entity: Entity): GameActionOutcome;
  getSurfacePutMessage(
    surface: SceneObject,
    item: Entity,
    relation: SpatialRelationType | null,
    target?: SceneObject | null
  ): string;
  putEntity(
    entity: Entity,
    target?: SceneObject | null,
    options?: { relation?: SpatialRelationType | null }
  ): GameActionOutcome;
  addInventoryEntity(
    owner: Entity,
    entity: Entity,
    relation?: Exclude<SpatialRelationType, 'near'>
  ): GameActionOutcome;
  removeEntityFromInventory(
    owner: Entity,
    entity: Entity,
    relation?: Exclude<SpatialRelationType, 'near'>
  ): GameActionOutcome;
  hasInventoryEntity(
    owner: Entity,
    entity: Entity,
    relation?: Exclude<SpatialRelationType, 'near'>
  ): boolean;
  getInventoryEntities(owner: Entity, relation?: Exclude<SpatialRelationType, 'near'>): Entity[];
  addEntityToSurface(
    surface: SceneObject,
    entity: Entity,
    relation?: Exclude<SpatialRelationType, 'near'>,
    options?: { preferPlayerPoint?: boolean }
  ): GameActionOutcome;
  getSwitchComponent(entity: SceneObject): any;
  removeEntityFromSurface(
    surface: SceneObject,
    entity: Entity,
    relation?: Exclude<SpatialRelationType, 'near'>
  ): GameActionOutcome;
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
