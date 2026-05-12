import { Scene } from './Scene';
import type { IGame } from '../core/IGame';
import { Entity } from '../entities/Entity';
import { Actor } from '../entities/Actor';
import { Walkbox } from '../entities/Walkbox';
import { Triggerbox } from '../entities/Triggerbox';
import type { EntryTrigger } from '../entities/TriggerComponents';
import { QuadObject } from '../entities/QuadObject';
import { listProjectFiles } from '../platform/fileApi';
import { Folder } from '../entities/Folder';
import { SoundManager } from '../systems/SoundManager';
import { ScriptRegistry } from '../core/ScriptRegistry';

const GRAPH_WEIGHT_FACTOR = 0.15;
const TEXTURE_BYTES_PER_UNIT = 64 * 1024;

export interface SceneDescriptor {
  id: string;
  path: string;
  name: string;
  title: string | null;
  sourceData: any | null;
  lastIndexed: number;
  graphWeightUnits?: number;
  textureBytes?: number;
  textureWeightUnits?: number;
  totalWeightUnits?: number;
}

export interface SceneCacheStats {
  estimatedMemory: number;
  loadedScenes: number;
  budget: number;
  graphUnits: number;
  textureMb: number;
  imageBudgetMb: number;
}

export interface SceneMemoryProfile {
  sceneId: string;
  sceneName: string;
  weightUnits: number;
  graphWeightUnits: number;
  textureWeightUnits: number;
  loadedScenes: number;
  estimatedCacheUnits: number;
  jsHeapUsedBytes: number | null;
  jsHeapUsedMb: number | null;
  jsHeapDeltaBytes: number | null;
  jsHeapDeltaMb: number | null;
  bytesPerUnit: number | null;
  estimatedTextureBytes: number;
  estimatedTextureMb: number;
  textureCount: number;
  imageCacheBytes: number;
  imageCacheMb: number;
}

type DeviceMemoryProfile = {
  className: string;
  deviceMemoryGb: number | null;
  sceneCacheBudget: number;
  imageCacheBudgetBytes: number;
};

type CachedSceneEntry = {
  scene: Scene;
  graphWeightUnits: number;
  textureBytes: number;
  textureWeightUnits: number;
  totalWeightUnits: number;
  spriteKeys: Set<string>;
  lastAccessed: number;
  pinned: boolean;
};

export class SceneManager {
  game: IGame;
  currentScene: Scene | null;
  /** ID of the Entry trigger to use when loading the next scene. */
  pendingEntryId: string | null = null;

  scenes: Map<string, Scene>;
  sceneRegistry: Map<string, SceneDescriptor>;
  private sceneCacheMeta: Map<string, CachedSceneEntry>;
  private sceneCacheBudget: number;

  constructor(game: IGame) {
    this.game = game;
    this.currentScene = null;
    this.scenes = new Map();
    this.sceneRegistry = new Map();
    this.sceneCacheMeta = new Map();

    const memoryProfile = this.detectDeviceMemoryProfile();
    this.sceneCacheBudget = memoryProfile.sceneCacheBudget;
    this.game.assets.setImageCacheBudget(memoryProfile.imageCacheBudgetBytes);
    console.log(
      `[SceneManager] Device class: ${memoryProfile.className}` +
        ` (deviceMemory=${memoryProfile.deviceMemoryGb ?? 'unknown'}GB)` +
        `, scene cache budget: ${this.sceneCacheBudget}` +
        `, image cache budget: ${this.bytesToMb(memoryProfile.imageCacheBudgetBytes)}MB`
    );

    void this.refreshSceneRegistry();
  }

  addScene(scene: Scene): void {
    this.syncSceneRegistration(scene);
    this.cacheScene(scene, false);
  }

  switchTo(sceneId: string, activator?: Actor): void {
    const oldScene = this.currentScene;
    const scene = this.ensureSceneLoaded(sceneId);
    if (!scene) {
      console.error(`Scene ${sceneId} not found!`);
      return;
    }

    // --- PLAYER TRANSFER PRIORITY ---
    // If the activator is a player, we must ensure they are the ONLY player in the target scene.
    if (activator && (activator as any).isPlayer) {
      // 1. Remove ANY existing player instance from the target scene's entities (except the activator itself)
      const existingPlayer = scene.entities.find((e) => (e as any).isPlayer && e !== activator);
      if (existingPlayer) {
        scene.removeEntity(existingPlayer);
      }

      // 2. Transfer the live player
      if (oldScene && oldScene !== scene) {
        oldScene.removeEntity(activator as Entity);
        scene.addEntity(activator as Entity);
      }

      // 3. FORCE the scene's player reference to our live activator
      scene.player = activator;
    } else if (activator && oldScene && oldScene !== scene) {
      // Handle NPC transfer
      oldScene.removeEntity(activator as Entity);
      scene.addEntity(activator as Entity);
    }

    // Handle Entry point placement (works for both scene switch and same-scene teleport)
    if (this.pendingEntryId) {
      const entryObj = scene.getObjectByName(this.pendingEntryId);
      if (entryObj) {
        const entryComp = entryObj.components?.find((c) => c.type === 'Entry') as
          | EntryTrigger
          | undefined;
        if (entryComp) {
          // Calculate center of object
          let targetX: number | null = null;
          let targetY: number | null = null;

          if (entryObj.type === 'Triggerbox' || (entryObj as any).poly) {
            const poly = (entryObj as any).poly as { x: number; y: number }[];
            if (poly && poly.length > 0) {
              let cx = 0,
                cy = 0;
              poly.forEach((p) => {
                cx += p.x;
                cy += p.y;
              });
              targetX = cx / poly.length;
              targetY = cy / poly.length;
            }
          } else if ('x' in entryObj && 'y' in entryObj) {
            // It's an Entity or Quad
            targetX = (entryObj as any).x;
            targetY = (entryObj as any).y;
          }

          if (activator && targetX !== null && targetY !== null) {
            activator.x = targetX;
            activator.y = targetY;
            if (entryComp.direction && typeof (activator as any).setDirection === 'function') {
              (activator as any).setDirection(entryComp.direction);
            }
            activator.update(0);

            // Ensure player reference is set before snapping
            if ((activator as any).isPlayer) {
              scene.player = activator;
              if (scene.autoCenter) {
                scene.snapCameraToPlayer();
              }
            }
          }
        }
      }
      this.pendingEntryId = null;
    }

    this.currentScene = scene;
    SoundManager.getInstance().setEnvironment(scene.soundEnv);
    if (oldScene !== scene) {
      scene.clearParserRecentTurns();
    }
    this.touchScene(scene.id);
    this.pinCurrentScene();
    this.syncAssetCacheState();
    this.game.inventoryManager?.handleSceneChange?.();
    (this.game as any).parser?.prepareLlmStaticPromptForCurrentScene?.();
    this.exposeEntitiesToWindow();
    if (this.game.onSceneChange) {
      this.game.onSceneChange(scene.name);
    }
    this.evictScenesIfNeeded();
  }

  exposeEntitiesToWindow(): void {
    if (!this.currentScene) return;
    const shouldExpose =
      typeof window !== 'undefined' &&
      (window as { __QUEST_EXPOSE_GLOBALS__?: boolean }).__QUEST_EXPOSE_GLOBALS__ === true;
    if (!shouldExpose) return;

    this.currentScene.entities.forEach((entity) => {
      if (entity.name) {
        (window as unknown as Record<string, unknown>)[entity.name] = entity;
      }
    });
  }

  update(deltaTime: number): void {
    if (!this.currentScene) return;
    this.currentScene.update(deltaTime);
    this.refreshCurrentSceneGraphWeight();
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (this.currentScene) {
      this.currentScene.render(ctx);
    }
  }

  async loadScene(filename: string): Promise<void> {
    try {
      const idFromPath = filename.replace('.json', '').replace(/\//g, '\\');
      const { isTauriRuntime, readProjectFileExisting } = await import('../platform/fileApi');
      let data: any = null;
      if (isTauriRuntime()) {
        const content = await readProjectFileExisting(`public/scenes/${filename}`);
        data = JSON.parse(content);
      } else {
        const response = await fetch(`/scenes/${filename}?t=${Date.now()}`);
        if (!response.ok) throw new Error('File not found');
        data = await response.json();
      }
      await this.loadSceneData(data, idFromPath, filename);
    } catch (e) {
      console.error(e);
      this.game.showNotification?.('Failed to load scene');
    }
  }

  async loadSceneData(data: any, filename?: string, explicitPath?: string): Promise<void> {
    try {
      const sceneId = filename || data.id || 'loaded_scene';

      // If we are hot-reloading or entirely replacing this scene, clean up any old scripts bound to it
      if (this.scenes.has(sceneId)) {
        ScriptRegistry.stopSceneScripts(sceneId);
      }

      const pathValue = explicitPath || `${sceneId.replace(/\\/g, '/')}.json`;
      const newScene = this.instantiateScene(sceneId, data, pathValue);

      this.syncSceneRegistration(newScene, undefined, data);
      this.cacheScene(newScene, false);
      this.switchTo(newScene.id);
      await this.preloadSwitchSounds(newScene);
      await this.game.textAssets.preloadScene(newScene);
      this.syncSceneRegistration(newScene, undefined, newScene.toJSON());
      await this.refreshSceneFootprint(newScene.id);

      if (this.game.editor) {
        this.game.editor.refreshHierarchy();
      }
    } catch (e) {
      console.error('Failed to load scene:', e);
      if (this.game.showNotification) this.game.showNotification('Error loading JSON');
    }
  }

  private async preloadSwitchSounds(scene: Scene): Promise<void> {
    const promises: Promise<void>[] = [];
    const allObjects = [...scene.entities, ...scene.triggerboxes];
    const soundManager = SoundManager.getInstance();

    allObjects.forEach((obj) => {
      if (obj.components) {
        obj.components.forEach((comp: any) => {
          if (comp.type === 'Switch') {
            if (comp.sound1)
              promises.push(soundManager.loadSound(comp.sound1, `/sounds/${comp.sound1}`));
            if (comp.sound2)
              promises.push(soundManager.loadSound(comp.sound2, `/sounds/${comp.sound2}`));
          }
        });
      }
    });

    await Promise.all(promises);
  }

  syncSceneRegistration(scene: Scene, previousId?: string, sourceData?: any): void {
    const sceneId = scene.id;
    const pathValue = this.getScenePathFromScene(scene);
    const existingMeta = this.sceneCacheMeta.get(sceneId);
    const descriptor: SceneDescriptor = {
      id: sceneId,
      path: pathValue,
      name: scene.name,
      title: this.game.textAssets.getResolvedSceneField(scene, 'title') || scene.name || sceneId,
      sourceData: sourceData ? JSON.parse(JSON.stringify(sourceData)) : null,
      lastIndexed: Date.now(),
      graphWeightUnits: existingMeta?.graphWeightUnits,
      textureBytes: existingMeta?.textureBytes,
      textureWeightUnits: existingMeta?.textureWeightUnits,
      totalWeightUnits: existingMeta?.totalWeightUnits,
    };

    if (previousId && previousId !== sceneId) {
      this.sceneRegistry.delete(previousId);
      const previousScene = this.scenes.get(previousId);
      const previousMeta = this.sceneCacheMeta.get(previousId);
      if (previousScene) {
        this.scenes.delete(previousId);
        this.scenes.set(sceneId, previousScene);
      }
      if (previousMeta) {
        this.sceneCacheMeta.delete(previousId);
        this.sceneCacheMeta.set(sceneId, { ...previousMeta, scene });
      }
      this.game.assets.renameSceneSpriteRefs(previousId, sceneId);
      this.syncAssetCacheState();
    }

    this.sceneRegistry.set(sceneId, descriptor);
  }

  getSceneCacheStats(): SceneCacheStats {
    let estimatedMemory = 0;
    let graphUnits = 0;
    let textureBytes = 0;

    for (const entry of this.sceneCacheMeta.values()) {
      estimatedMemory += entry.totalWeightUnits;
      graphUnits += entry.graphWeightUnits;
      textureBytes += entry.textureBytes;
    }

    return {
      estimatedMemory: Math.round(estimatedMemory),
      loadedScenes: this.scenes.size,
      budget: this.sceneCacheBudget,
      graphUnits: Math.round(graphUnits),
      textureMb: this.bytesToMb(textureBytes),
      imageBudgetMb: this.bytesToMb(this.game.assets.getImageCacheStats().budgetBytes),
    };
  }

  estimateSceneGraphWeight(scene: Scene): number {
    let weight = 16;

    weight += (scene.walkbox?.length || 0) * 6;
    weight += (scene.triggerboxes?.length || 0) * 8;

    for (const entity of scene.entities || []) {
      switch (entity.type) {
        case 'Actor':
          weight += 24;
          break;
        case 'Quad':
          weight += 18 + ((entity as any).vertices?.length || 0) * 3;
          break;
        default:
          weight += 12;
          break;
      }

      weight += ((entity.components || []).length || 0) * 4;
      weight += Object.keys(entity.interactions || {}).length * 2;
      if ((entity as any).animSets) {
        weight += Object.keys((entity as any).animSets).length * 4;
      }
    }

    for (const wb of scene.walkbox || []) {
      weight += (wb.poly?.length || 0) * 2;
    }

    for (const tb of scene.triggerboxes || []) {
      weight += (tb.poly?.length || 0) * 2;
      weight += ((tb.components || []).length || 0) * 4;
    }

    return weight;
  }

  async refreshSceneRegistry(): Promise<void> {
    try {
      const files = await this.listSceneFiles('public/scenes');
      const seenIds = new Set<string>();

      for (const file of files) {
        const sceneId = file.replace('.json', '').replace(/\//g, '\\');
        seenIds.add(sceneId);
        const response = await fetch(`/scenes/${file}?t=${Date.now()}`);
        if (!response.ok) continue;
        const data = await response.json();
        const existingMeta = this.sceneCacheMeta.get(sceneId);
        const descriptor: SceneDescriptor = {
          id: sceneId,
          path: file,
          name: data.name || sceneId,
          title: (await this.readSceneTitle(sceneId)) || data.name || sceneId,
          sourceData: data,
          lastIndexed: Date.now(),
          graphWeightUnits: existingMeta?.graphWeightUnits,
          textureBytes: existingMeta?.textureBytes,
          textureWeightUnits: existingMeta?.textureWeightUnits,
          totalWeightUnits: existingMeta?.totalWeightUnits,
        };
        this.sceneRegistry.set(sceneId, descriptor);
      }

      for (const [sceneId, descriptor] of [...this.sceneRegistry.entries()]) {
        if (!seenIds.has(sceneId) && !this.scenes.has(sceneId)) {
          this.sceneRegistry.delete(sceneId);
        } else if (!seenIds.has(sceneId) && this.scenes.has(sceneId)) {
          this.sceneRegistry.set(sceneId, {
            ...descriptor,
            lastIndexed: Date.now(),
          });
        }
      }
    } catch (error) {
      console.warn('[SceneManager] Failed to refresh scene registry:', error);
    }
  }

  async profileCurrentSceneMemory(): Promise<SceneMemoryProfile | null> {
    const scene = this.currentScene;
    if (!scene) {
      console.warn('[SceneManager] profileCurrentSceneMemory(): no current scene');
      return null;
    }

    await this.waitForSceneToSettle();
    await this.refreshSceneFootprint(scene.id);
    const heapBytes = this.readUsedJsHeapBytes();
    const entry = this.sceneCacheMeta.get(scene.id);
    const stats = this.getSceneCacheStats();
    const imageStats = this.game.assets.getImageCacheStats();
    const profile = this.buildMemoryProfile(
      scene,
      entry,
      stats.estimatedMemory,
      heapBytes,
      null,
      imageStats.estimatedBytes
    );

    console.table([this.formatMemoryProfileForConsole(profile)]);
    return profile;
  }

  async profileScenes(sceneIds: string[]): Promise<SceneMemoryProfile[]> {
    const requested = [
      ...new Set((sceneIds || []).map((id) => String(id || '').trim()).filter(Boolean)),
    ];
    if (requested.length === 0) {
      console.warn('[SceneManager] profileScenes(): no scene ids provided');
      return [];
    }

    const results: SceneMemoryProfile[] = [];
    const originalSceneId = this.currentScene?.id ?? null;

    for (const sceneId of requested) {
      const beforeHeap = this.readUsedJsHeapBytes();
      await this.loadProfileScene(sceneId);
      await this.waitForSceneToSettle();
      await this.refreshSceneFootprint(sceneId);

      const scene = this.currentScene;
      if (!scene || scene.id !== sceneId) {
        console.warn(`[SceneManager] profileScenes(): failed to load scene '${sceneId}'`);
        continue;
      }

      const afterHeap = this.readUsedJsHeapBytes();
      const imageStats = this.game.assets.getImageCacheStats();
      const profile = this.buildMemoryProfile(
        scene,
        this.sceneCacheMeta.get(scene.id),
        this.getSceneCacheStats().estimatedMemory,
        afterHeap,
        beforeHeap !== null && afterHeap !== null ? Math.max(0, afterHeap - beforeHeap) : null,
        imageStats.estimatedBytes
      );
      results.push(profile);
    }

    if (originalSceneId && originalSceneId !== this.currentScene?.id) {
      this.switchTo(originalSceneId);
      await this.waitForSceneToSettle();
    }

    console.table(results.map((profile) => this.formatMemoryProfileForConsole(profile)));
    return results;
  }

  private instantiateScene(sceneId: string, data: any, pathValue?: string): Scene {
    const newScene = new Scene(this.game, sceneId, data.name || 'Untitled');

    if (pathValue) {
      newScene.filename = pathValue.replace('.json', '');
    } else if (data.filename) {
      newScene.filename = data.filename;
    }

    newScene.id = sceneId;
    if (data.description !== undefined) newScene.description = data.description;
    if (data.textRedirects) newScene.textRedirects = { ...data.textRedirects };

    if (data.camera) {
      newScene.defaultCamera = { ...data.camera };
      newScene.camera = { ...data.camera };
    }

    if (data.autoCenter !== undefined) newScene.autoCenter = data.autoCenter;
    if (data.cameraSpeed !== undefined) newScene.cameraSpeed = data.cameraSpeed;
    if (data.camDeadzoneX !== undefined) newScene.camDeadzoneX = data.camDeadzoneX;
    if (data.camDeadzoneY !== undefined) newScene.camDeadzoneY = data.camDeadzoneY;
    if (data.camMinX !== undefined) newScene.camMinX = data.camMinX;
    if (data.camMaxX !== undefined) newScene.camMaxX = data.camMaxX;
    if (data.camMinY !== undefined) newScene.camMinY = data.camMinY;
    if (data.camMaxY !== undefined) newScene.camMaxY = data.camMaxY;
    if (data.scaling) newScene.scaling = data.scaling;

    if (data.soundEnv) {
      newScene.soundEnv = { ...newScene.soundEnv, ...data.soundEnv };
    }

    if (data.walkbox) {
      (data.walkbox || []).forEach((wb: any) => {
        const poly = wb.poly.map((p: any) => ({ x: Number(p.x), y: Number(p.y) }));
        const w = new Walkbox(poly, wb.name || 'Walkbox');
        w.load(wb);
        newScene.addWalkbox(w);
      });
    }

    if (data.triggerboxes) {
      (data.triggerboxes || []).forEach((t: any) => {
        const poly = t.poly.map((p: any) => ({ x: Number(p.x), y: Number(p.y) }));
        const tb = new Triggerbox(poly, t.name || 'Triggerbox', t.script || '');
        tb.load(t);
        newScene.addTriggerbox(tb);
      });
    }

    if (data.entities) {
      data.entities.forEach((entityData: any) => {
        if (entityData.type === 'Folder') {
          const folder = Folder.fromData(this.game, entityData);
          newScene.addFolder(folder);
          return;
        }

        let entity: Entity;

        const hasActorComponent = Array.isArray(entityData.components)
          ? entityData.components.some((component: any) => component?.type === 'Actor')
          : false;

        if (entityData.type === 'Player') {
          entity = Actor.fromJSON(this.game, { ...entityData, type: 'Actor', isPlayer: true });
        } else if (entityData.type === 'Actor' || hasActorComponent) {
          entity = Actor.fromJSON(this.game, { ...entityData, type: 'Actor' });
        } else if (entityData.type === 'Quad' || entityData.type === 'Rect') {
          entity = QuadObject.fromJSON(this.game, entityData);
        } else {
          entity = Entity.fromJSON(this.game, entityData);
        }

        newScene.addEntity(entity);
      });
    }

    if (data.folders) {
      data.folders.forEach((folderData: any) => {
        const folder = Folder.fromData(this.game, folderData);
        newScene.addFolder(folder);
      });
    }

    return newScene;
  }

  private ensureSceneLoaded(sceneId: string): Scene | null {
    const cached = this.scenes.get(sceneId);
    if (cached) return cached;

    const descriptor = this.sceneRegistry.get(sceneId);
    if (!descriptor?.sourceData) return null;

    const scene = this.instantiateScene(sceneId, descriptor.sourceData, descriptor.path);
    this.cacheScene(scene, false);
    void this.game.textAssets.preloadScene(scene);
    void this.refreshSceneFootprint(scene.id);
    return scene;
  }

  private cacheScene(scene: Scene, pinned: boolean): void {
    this.scenes.set(scene.id, scene);
    const existing = this.sceneCacheMeta.get(scene.id);
    const graphWeightUnits = this.estimateSceneGraphWeight(scene);
    const spriteKeys = this.collectSceneSpriteNames(scene);
    this.game.assets.markSceneSpriteRefs(scene.id, spriteKeys);

    const textureBytes = existing?.textureBytes || 0;
    const textureWeightUnits =
      existing?.textureWeightUnits || this.textureBytesToUnits(textureBytes);

    this.sceneCacheMeta.set(scene.id, {
      scene,
      graphWeightUnits,
      textureBytes,
      textureWeightUnits,
      totalWeightUnits: this.computeTotalWeightUnits(graphWeightUnits, textureBytes),
      spriteKeys,
      lastAccessed: Date.now(),
      pinned: existing?.pinned || pinned,
    });

    this.syncAssetCacheState();
    void this.refreshSceneFootprint(scene.id);
    this.evictScenesIfNeeded();
  }

  private touchScene(sceneId: string): void {
    const entry = this.sceneCacheMeta.get(sceneId);
    if (!entry) return;
    entry.lastAccessed = Date.now();
  }

  private pinCurrentScene(): void {
    for (const [sceneId, entry] of this.sceneCacheMeta.entries()) {
      entry.pinned = this.currentScene?.id === sceneId;
    }
    this.syncAssetCacheState();
  }

  private refreshCurrentSceneGraphWeight(): void {
    if (!this.currentScene) return;
    const entry = this.sceneCacheMeta.get(this.currentScene.id);
    if (!entry) return;
    entry.graphWeightUnits = this.estimateSceneGraphWeight(this.currentScene);
    entry.totalWeightUnits = this.computeTotalWeightUnits(
      entry.graphWeightUnits,
      entry.textureBytes
    );
  }

  private async refreshSceneFootprint(sceneId: string): Promise<void> {
    const entry = this.sceneCacheMeta.get(sceneId);
    const scene = this.scenes.get(sceneId);
    if (!entry || !scene) return;

    const spriteKeys = this.collectSceneSpriteNames(scene);
    this.game.assets.markSceneSpriteRefs(sceneId, spriteKeys);
    const textureEstimate = await this.game.assets.estimateSpritesTextureBytes(spriteKeys);
    entry.spriteKeys = spriteKeys;
    entry.graphWeightUnits = this.estimateSceneGraphWeight(scene);
    entry.textureBytes = textureEstimate.bytes;
    entry.textureWeightUnits = this.textureBytesToUnits(textureEstimate.bytes);
    entry.totalWeightUnits = this.computeTotalWeightUnits(
      entry.graphWeightUnits,
      entry.textureBytes
    );

    const descriptor = this.sceneRegistry.get(sceneId);
    if (descriptor) {
      descriptor.graphWeightUnits = entry.graphWeightUnits;
      descriptor.textureBytes = entry.textureBytes;
      descriptor.textureWeightUnits = entry.textureWeightUnits;
      descriptor.totalWeightUnits = entry.totalWeightUnits;
      descriptor.lastIndexed = Date.now();
    }

    this.syncAssetCacheState();
    this.evictScenesIfNeeded();
  }

  private evictScenesIfNeeded(): void {
    let stats = this.getSceneCacheStats();
    if (stats.estimatedMemory <= this.sceneCacheBudget) return;

    const candidates = [...this.sceneCacheMeta.entries()]
      .filter(([sceneId, entry]) => sceneId !== this.currentScene?.id && !entry.pinned)
      .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

    for (const [sceneId] of candidates) {
      if (stats.estimatedMemory <= this.sceneCacheBudget) break;
      this.evictScene(sceneId);
      stats = this.getSceneCacheStats();
    }
  }

  private evictScene(sceneId: string): void {
    const scene = this.scenes.get(sceneId);
    if (!scene) return;

    const entry = this.sceneCacheMeta.get(sceneId);
    const descriptor = this.sceneRegistry.get(sceneId) || {
      id: sceneId,
      path: this.getScenePathFromScene(scene),
      name: scene.name,
      title: this.game.textAssets.getResolvedSceneField(scene, 'title') || scene.name,
      sourceData: null,
      lastIndexed: Date.now(),
    };

    descriptor.name = scene.name;
    descriptor.title = this.game.textAssets.getResolvedSceneField(scene, 'title') || scene.name;
    descriptor.sourceData = scene.toJSON();
    descriptor.lastIndexed = Date.now();
    descriptor.graphWeightUnits = entry?.graphWeightUnits;
    descriptor.textureBytes = entry?.textureBytes;
    descriptor.textureWeightUnits = entry?.textureWeightUnits;
    descriptor.totalWeightUnits = entry?.totalWeightUnits;
    this.sceneRegistry.set(sceneId, descriptor);

    this.scenes.delete(sceneId);
    this.sceneCacheMeta.delete(sceneId);
    this.game.assets.releaseSceneSpriteRefs(sceneId);
    this.syncAssetCacheState();
  }

  private getScenePathFromScene(scene: Scene): string {
    const filename = scene.filename || scene.id.replace(/\\/g, '/');
    return `${filename.replace(/\.json$/i, '')}.json`;
  }

  private async listSceneFiles(relativeDir: string): Promise<string[]> {
    const files: string[] = [];

    for (const item of await listProjectFiles(relativeDir)) {
      const joined = `${relativeDir}/${item.name}`.replace(/\\/g, '/');
      if (item.isDir) {
        const nested = await this.listSceneFiles(joined);
        files.push(...nested);
      } else if (item.name.toLowerCase().endsWith('.json')) {
        files.push(joined.replace(/^public\/scenes\//, ''));
      }
    }

    return files;
  }

  private async readSceneTitle(sceneId: string): Promise<string | null> {
    try {
      const scenePath = sceneId.replace(/\\/g, '/');
      const { isTauriRuntime, readProjectFileExisting } = await import('../platform/fileApi');
      let data: any = null;
      if (isTauriRuntime()) {
        const content = await readProjectFileExisting(`public/text/scenes/${scenePath}.json`);
        data = JSON.parse(content);
      } else {
        const response = await fetch(`/text/scenes/${scenePath}.json?t=${Date.now()}`);
        if (!response.ok) return null;
        data = await response.json();
      }
      return typeof data.title === 'string' ? data.title : null;
    } catch {
      return null;
    }
  }

  private detectDeviceMemoryProfile(): DeviceMemoryProfile {
    const navigatorLike =
      typeof navigator !== 'undefined'
        ? (navigator as Navigator & { deviceMemory?: number })
        : null;
    const deviceMemoryRaw =
      navigatorLike && typeof navigatorLike.deviceMemory === 'number'
        ? navigatorLike.deviceMemory
        : null;
    const deviceMemoryGb =
      deviceMemoryRaw && Number.isFinite(deviceMemoryRaw) ? deviceMemoryRaw : null;

    if (deviceMemoryGb === null) {
      return {
        className: 'unknown',
        deviceMemoryGb: null,
        sceneCacheBudget: 2700,
        imageCacheBudgetBytes: 256 * 1024 * 1024,
      };
    }

    if (deviceMemoryGb <= 4) {
      return {
        className: 'low-memory',
        deviceMemoryGb,
        sceneCacheBudget: 2700,
        imageCacheBudgetBytes: 256 * 1024 * 1024,
      };
    }

    if (deviceMemoryGb <= 8) {
      return {
        className: 'mid-memory',
        deviceMemoryGb,
        sceneCacheBudget: 4500,
        imageCacheBudgetBytes: 512 * 1024 * 1024,
      };
    }

    if (deviceMemoryGb <= 16) {
      return {
        className: 'high-memory',
        deviceMemoryGb,
        sceneCacheBudget: 7200,
        imageCacheBudgetBytes: 1024 * 1024 * 1024,
      };
    }

    return {
      className: 'very-high-memory',
      deviceMemoryGb,
      sceneCacheBudget: 9600,
      imageCacheBudgetBytes: 1536 * 1024 * 1024,
    };
  }

  private async loadProfileScene(sceneId: string): Promise<void> {
    const descriptor = this.sceneRegistry.get(sceneId);
    if (descriptor) {
      this.switchTo(descriptor.id);
      return;
    }

    const guessedFile = `${sceneId.replace(/\\/g, '/')}.json`;
    await this.loadScene(guessedFile);
  }

  private collectSceneSpriteNames(scene: Scene): Set<string> {
    const spriteNames = new Set<string>();

    for (const entity of scene.entities || []) {
      if (entity.spriteName) {
        spriteNames.add(entity.spriteName);
      }

      const animSets = (entity as any).animSets as
        | Record<string, Record<string, string | null>>
        | undefined;
      if (!animSets) continue;

      for (const set of Object.values(animSets)) {
        for (const key of ['up', 'down', 'left', 'right'] as const) {
          const spriteName = set?.[key];
          if (typeof spriteName === 'string' && spriteName.trim()) {
            spriteNames.add(spriteName);
          }
        }
      }
    }

    return spriteNames;
  }

  private syncAssetCacheState(): void {
    this.game.assets.syncSceneCacheState(this.currentScene?.id || null, [...this.scenes.keys()]);
  }

  private computeTotalWeightUnits(graphWeightUnits: number, textureBytes: number): number {
    return Math.max(
      1,
      Math.round(this.textureBytesToUnits(textureBytes) + graphWeightUnits * GRAPH_WEIGHT_FACTOR)
    );
  }

  private textureBytesToUnits(textureBytes: number): number {
    return textureBytes / TEXTURE_BYTES_PER_UNIT;
  }

  private buildMemoryProfile(
    scene: Scene,
    entry: CachedSceneEntry | undefined,
    estimatedCacheUnits: number,
    heapBytes: number | null,
    deltaBytes: number | null,
    imageCacheBytes: number
  ): SceneMemoryProfile {
    const graphWeightUnits = Math.round(
      entry?.graphWeightUnits ?? this.estimateSceneGraphWeight(scene)
    );
    const textureBytes = entry?.textureBytes ?? 0;
    const totalWeightUnits = Math.round(
      entry?.totalWeightUnits ?? this.computeTotalWeightUnits(graphWeightUnits, textureBytes)
    );
    const bytesPerUnit =
      heapBytes !== null && totalWeightUnits > 0 ? heapBytes / totalWeightUnits : null;

    return {
      sceneId: scene.id,
      sceneName: scene.name,
      weightUnits: totalWeightUnits,
      graphWeightUnits,
      textureWeightUnits: Math.round(
        entry?.textureWeightUnits ?? this.textureBytesToUnits(textureBytes)
      ),
      loadedScenes: this.scenes.size,
      estimatedCacheUnits,
      jsHeapUsedBytes: heapBytes,
      jsHeapUsedMb: heapBytes !== null ? this.bytesToMb(heapBytes) : null,
      jsHeapDeltaBytes: deltaBytes,
      jsHeapDeltaMb: deltaBytes !== null ? this.bytesToMb(deltaBytes) : null,
      bytesPerUnit,
      estimatedTextureBytes: textureBytes,
      estimatedTextureMb: this.bytesToMb(textureBytes),
      textureCount: entry?.spriteKeys.size ?? this.collectSceneSpriteNames(scene).size,
      imageCacheBytes,
      imageCacheMb: this.bytesToMb(imageCacheBytes),
    };
  }

  private readUsedJsHeapBytes(): number | null {
    const performanceLike =
      typeof performance !== 'undefined'
        ? (performance as Performance & { memory?: { usedJSHeapSize?: number } })
        : null;
    const used = performanceLike?.memory?.usedJSHeapSize;
    return typeof used === 'number' && Number.isFinite(used) ? used : null;
  }

  private async waitForSceneToSettle(delayMs: number = 300): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private bytesToMb(bytes: number): number {
    return Math.round((bytes / (1024 * 1024)) * 100) / 100;
  }

  private formatMemoryProfileForConsole(
    profile: SceneMemoryProfile
  ): Record<string, string | number | null> {
    return {
      sceneId: profile.sceneId,
      sceneName: profile.sceneName,
      weightUnits: profile.weightUnits,
      graphUnits: profile.graphWeightUnits,
      textureUnits: profile.textureWeightUnits,
      loadedScenes: profile.loadedScenes,
      cacheUnits: profile.estimatedCacheUnits,
      jsHeapMb: profile.jsHeapUsedMb,
      deltaMb: profile.jsHeapDeltaMb,
      textureMb: profile.estimatedTextureMb,
      imageCacheMb: profile.imageCacheMb,
      textureCount: profile.textureCount,
      kbPerUnit:
        profile.bytesPerUnit !== null
          ? Math.round((profile.bytesPerUnit / 1024) * 100) / 100
          : null,
    };
  }
}
