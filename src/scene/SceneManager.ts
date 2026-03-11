import { Scene } from './Scene';
import type { IGame } from '../core/IGame';
import { Entity } from '../entities/Entity';
import { Actor } from '../entities/Actor';
import { Walkbox } from '../entities/Walkbox';
import { Triggerbox } from '../entities/Triggerbox';
import { QuadObject } from '../entities/QuadObject';

export interface SceneDescriptor {
  id: string;
  path: string;
  name: string;
  title: string | null;
  sourceData: any | null;
  lastIndexed: number;
}

export interface SceneCacheStats {
  estimatedMemory: number;
  loadedScenes: number;
  budget: number;
}

type DeviceMemoryProfile = {
  className: string;
  deviceMemoryGb: number | null;
  sceneCacheBudget: number;
};

type CachedSceneEntry = {
  scene: Scene;
  estimatedWeight: number;
  lastAccessed: number;
  pinned: boolean;
};

export class SceneManager {
  game: IGame;
  currentScene: Scene | null;
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
    console.log(
      `[SceneManager] Device class: ${memoryProfile.className}` +
        ` (deviceMemory=${memoryProfile.deviceMemoryGb ?? 'unknown'}GB)` +
        `, scene cache budget: ${this.sceneCacheBudget}`
    );
    void this.refreshSceneRegistry();
  }

  addScene(scene: Scene): void {
    this.syncSceneRegistration(scene);
    this.cacheScene(scene, false);
  }

  switchTo(sceneId: string): void {
    const scene = this.ensureSceneLoaded(sceneId);
    if (scene) {
      this.currentScene = scene;
      this.touchScene(scene.id);
      this.pinCurrentScene();
      this.exposeEntitiesToWindow();
      if (this.game.onSceneChange) {
        this.game.onSceneChange(scene.name);
      }
      this.evictScenesIfNeeded();
    } else {
      console.error(`Scene ${sceneId} not found!`);
    }
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
    if (this.currentScene) {
      this.currentScene.update(deltaTime);
      this.refreshCurrentSceneWeight();
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (this.currentScene) {
      this.currentScene.render(ctx);
    }
  }

  async loadScene(filename: string): Promise<void> {
    try {
      const idFromPath = filename.replace('.json', '').replace(/\//g, '\\');
      const response = await fetch(`/scenes/${filename}?t=${Date.now()}`);
      if (!response.ok) throw new Error('File not found');
      const data = await response.json();
      await this.loadSceneData(data, idFromPath, filename);
    } catch (e) {
      console.error(e);
      this.game.showNotification?.('Failed to load scene');
    }
  }

  async loadSceneData(data: any, filename?: string, explicitPath?: string): Promise<void> {
    try {
      const sceneId = filename || data.id || 'loaded_scene';
      const pathValue = explicitPath || `${sceneId.replace(/\\/g, '/')}.json`;
      const newScene = this.instantiateScene(sceneId, data, pathValue);

      this.syncSceneRegistration(newScene, undefined, data);
      this.cacheScene(newScene, false);
      this.switchTo(newScene.id);
      await this.game.textAssets.preloadScene(newScene);
      this.syncSceneRegistration(newScene, undefined, newScene.toJSON());
      this.refreshCurrentSceneWeight();

      if (this.game.editor) {
        this.game.editor.refreshHierarchy();
      }
    } catch (e) {
      console.error('Failed to load scene:', e);
      if (this.game.showNotification) this.game.showNotification('Error loading JSON');
    }
  }

  syncSceneRegistration(scene: Scene, previousId?: string, sourceData?: any): void {
    const sceneId = scene.id;
    const pathValue = this.getScenePathFromScene(scene);
    const descriptor: SceneDescriptor = {
      id: sceneId,
      path: pathValue,
      name: scene.name,
      title: this.game.textAssets.getResolvedSceneField(scene, 'title') || scene.name || sceneId,
      sourceData: sourceData ? JSON.parse(JSON.stringify(sourceData)) : null,
      lastIndexed: Date.now(),
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
        this.sceneCacheMeta.set(sceneId, {
          ...previousMeta,
          scene,
          estimatedWeight: this.estimateSceneWeight(scene),
        });
      }
    }

    this.sceneRegistry.set(sceneId, descriptor);
  }

  getSceneCacheStats(): SceneCacheStats {
    let estimatedMemory = 0;
    for (const entry of this.sceneCacheMeta.values()) {
      estimatedMemory += entry.estimatedWeight;
    }
    return {
      estimatedMemory: Math.round(estimatedMemory),
      loadedScenes: this.scenes.size,
      budget: this.sceneCacheBudget,
    };
  }

  estimateSceneWeight(scene: Scene): number {
    let weight = 16;

    weight += (scene.walkbox?.length || 0) * 6;
    weight += (scene.triggerboxes?.length || 0) * 8;

    for (const entity of scene.entities || []) {
      switch (entity.type) {
        case 'Actor':
          weight += 24;
          break;
        case 'Quad':
          weight += 18 + (((entity as any).vertices?.length || 0) * 3);
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

  findSceneDescriptorByTarget(target: string): SceneDescriptor | null {
    const normalized = String(target || '')
      .trim()
      .toUpperCase();
    if (!normalized) return null;

    for (const descriptor of this.sceneRegistry.values()) {
      if (
        descriptor.id.toUpperCase() === normalized ||
        descriptor.name.toUpperCase() === normalized ||
        (!!descriptor.title && descriptor.title.toUpperCase() === normalized)
      ) {
        return descriptor;
      }
    }

    return null;
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
        const descriptor: SceneDescriptor = {
          id: sceneId,
          path: file,
          name: data.name || sceneId,
          title: (await this.readSceneTitle(sceneId)) || data.name || sceneId,
          sourceData: data,
          lastIndexed: Date.now(),
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

    if (data.walkbox) {
      newScene.walkbox = (data.walkbox || []).map((wb: any) => {
        const poly = wb.poly.map((p: any) => ({ x: Number(p.x), y: Number(p.y) }));
        const w = new Walkbox(poly, wb.name || 'Walkbox');
        w.load(wb);
        return w;
      });
    }

    if (data.triggerboxes) {
      newScene.triggerboxes = (data.triggerboxes || []).map((t: any) => {
        const poly = t.poly.map((p: any) => ({ x: Number(p.x), y: Number(p.y) }));
        const tb = new Triggerbox(poly, t.name || 'Triggerbox', t.script || '');
        tb.load(t);
        return tb;
      });
    }

    if (data.entities) {
      data.entities.forEach((entityData: any) => {
        let entity: Entity;

        if (entityData.type === 'Player') {
          entity = Actor.fromJSON(this.game, { ...entityData, type: 'Actor', isPlayer: true });
        } else if (entityData.type === 'Actor') {
          entity = Actor.fromJSON(this.game, entityData);
        } else if (entityData.type === 'Quad' || entityData.type === 'Rect') {
          entity = QuadObject.fromJSON(this.game, entityData);
        } else {
          entity = Entity.fromJSON(this.game, entityData);
        }

        newScene.addEntity(entity);
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
    return scene;
  }

  private cacheScene(scene: Scene, pinned: boolean): void {
    this.scenes.set(scene.id, scene);
    const existing = this.sceneCacheMeta.get(scene.id);
    this.sceneCacheMeta.set(scene.id, {
      scene,
      estimatedWeight: this.estimateSceneWeight(scene),
      lastAccessed: Date.now(),
      pinned: existing?.pinned || pinned,
    });
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
  }

  private refreshCurrentSceneWeight(): void {
    if (!this.currentScene) return;
    const entry = this.sceneCacheMeta.get(this.currentScene.id);
    if (!entry) return;
    entry.estimatedWeight = this.estimateSceneWeight(this.currentScene);
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
    this.sceneRegistry.set(sceneId, descriptor);

    this.scenes.delete(sceneId);
    this.sceneCacheMeta.delete(sceneId);
  }

  private getScenePathFromScene(scene: Scene): string {
    const filename = scene.filename || scene.id.replace(/\\/g, '/');
    return `${filename.replace(/\.json$/i, '')}.json`;
  }

  private async listSceneFiles(relativeDir: string): Promise<string[]> {
    const response = await fetch('/api/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relativeDir }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const payload = (await response.json()) as { files?: Array<{ name: string; isDir: boolean }> };
    const files: string[] = [];

    for (const item of payload.files || []) {
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
      const response = await fetch(`/text/scenes/${scenePath}.json?t=${Date.now()}`);
      if (!response.ok) return null;
      const data = (await response.json()) as Record<string, unknown>;
      return typeof data.title === 'string' ? data.title : null;
    } catch {
      return null;
    }
  }

  private detectDeviceMemoryProfile(): DeviceMemoryProfile {
    const navigatorLike =
      typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : null;
    const deviceMemoryRaw =
      navigatorLike && typeof navigatorLike.deviceMemory === 'number'
        ? navigatorLike.deviceMemory
        : null;
    const deviceMemoryGb = deviceMemoryRaw && Number.isFinite(deviceMemoryRaw) ? deviceMemoryRaw : null;

    if (deviceMemoryGb === null) {
      return {
        className: 'unknown',
        deviceMemoryGb: null,
        sceneCacheBudget: 900,
      };
    }

    if (deviceMemoryGb <= 4) {
      return {
        className: 'low-memory',
        deviceMemoryGb,
        sceneCacheBudget: 900,
      };
    }

    if (deviceMemoryGb <= 8) {
      return {
        className: 'mid-memory',
        deviceMemoryGb,
        sceneCacheBudget: 1500,
      };
    }

    if (deviceMemoryGb <= 16) {
      return {
        className: 'high-memory',
        deviceMemoryGb,
        sceneCacheBudget: 2400,
      };
    }

    return {
      className: 'very-high-memory',
      deviceMemoryGb,
      sceneCacheBudget: 3200,
    };
  }
}
