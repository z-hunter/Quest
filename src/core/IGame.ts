import { AssetLoader } from './AssetLoader';
import { AudioManager } from './AudioManager';
import { SceneManager } from '../scene/SceneManager';
import { SceneEditor } from '../tools/SceneEditor';
import { Entity } from '../entities/Entity';
import type { Actor } from '../entities/Actor';
import { TextAssetManager } from './TextAssetManager';
import type { GameActionOutcome } from './GameActionTypes';
import type { Scene } from '../scene/Scene';
import type { SceneObject } from '../entities/SceneObject';
import type { SpatialRelationType } from '../scene/spatialTypes';
import type { InventoryManager } from '../systems/InventoryManager';
import type { ActorNavigationService } from '../systems/ActorNavigationService';
import type { ActorWorldQuery } from '../systems/ActorWorldQuery';
import type { ActorCommandExecutor } from '../mechanics/ActorCommandExecutor';

export interface IGame {
  assets: AssetLoader;
  audio: AudioManager;
  textAssets: TextAssetManager;
  sceneManager: SceneManager;
  editor: SceneEditor;
  inventory: Entity[];
  inventoryManager: InventoryManager;
  actorNavigation: ActorNavigationService;
  actorWorld: ActorWorldQuery;
  actorCommands: ActorCommandExecutor;
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
  lookEntityForActor(
    actor: Actor | null,
    entity: SceneObject,
    options?: { relation?: SpatialRelationType | null }
  ): GameActionOutcome;
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
  examineEntityForActor(
    actor: Actor | null,
    entity: SceneObject,
    options?: { relation?: SpatialRelationType | null }
  ): GameActionOutcome;
  openEntity(entity: SceneObject): GameActionOutcome;
  openEntityForActor(actor: Actor | null, entity: SceneObject): GameActionOutcome;
  closeEntity(entity: SceneObject): GameActionOutcome;
  closeEntityForActor(actor: Actor | null, entity: SceneObject): GameActionOutcome;
  closeFocusedView(): GameActionOutcome;
  takeEntity(entity: Entity): GameActionOutcome;
  takeEntityForActor(actor: Actor | null, entity: Entity): GameActionOutcome;
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
  putEntityForActor(
    actor: Actor | null,
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
    options?: { preferPlayerPoint?: boolean; preferredPoint?: { x: number; y: number } }
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
  goToEntity(entity: Entity, options?: { traverseExit?: boolean }): GameActionOutcome;
  showNotification?(text: string): void; // Optional
  onSceneChange?(sceneName: string): void;
  playSound(name: string): void;
  emitActorAction?(
    actor: Actor,
    action: ObservedActorActionCode,
    subject?: SceneObject | null,
    payload?: Record<string, unknown>
  ): void;
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
  revealCommandCursor(): void;

  // Core property access needed by entities/systems
  input: any;
  isMouseOverUI?: boolean;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  bufferCanvas: HTMLCanvasElement;
}
export type ObservedActorActionCode =
  | 'look'
  | 'examine'
  | 'open'
  | 'close'
  | 'take'
  | 'put'
  | 'use'
  | 'command'
  | 'traverse_exit';
