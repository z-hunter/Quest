export interface SpriteData {
  image: HTMLImageElement;
  json: any;
}

export type ImageCacheState = 'active' | 'warm' | 'cold';

export interface ImageCacheStats {
  estimatedBytes: number;
  imageCount: number;
  activeCount: number;
  warmCount: number;
  coldCount: number;
  budgetBytes: number;
}

type ImageCacheEntry = {
  image: HTMLImageElement;
  estimatedBytes: number;
  lastAccessed: number;
  refSceneIds: Set<string>;
  state: ImageCacheState;
};

export class AssetLoader {
  private jsonCache: Map<string, any> = new Map();
  private imageCache: Map<string, ImageCacheEntry> = new Map();
  private pending: Map<string, Promise<any>> = new Map();
  private spriteToImagePath: Map<string, string> = new Map();
  private sceneToSpriteKeys: Map<string, Set<string>> = new Map();
  private currentSceneId: string | null = null;
  private loadedSceneIds: Set<string> = new Set();
  private imageCacheBudgetBytes: number = 128 * 1024 * 1024;

  setImageCacheBudget(bytes: number): void {
    this.imageCacheBudgetBytes = Math.max(8 * 1024 * 1024, Math.round(bytes || 0));
    this.evictUnusedImagesIfNeeded();
  }

  getImageCacheStats(): ImageCacheStats {
    let estimatedBytes = 0;
    let activeCount = 0;
    let warmCount = 0;
    let coldCount = 0;

    for (const entry of this.imageCache.values()) {
      estimatedBytes += entry.estimatedBytes;
      if (entry.state === 'active') activeCount++;
      else if (entry.state === 'warm') warmCount++;
      else coldCount++;
    }

    return {
      estimatedBytes,
      imageCount: this.imageCache.size,
      activeCount,
      warmCount,
      coldCount,
      budgetBytes: this.imageCacheBudgetBytes,
    };
  }

  markSceneSpriteRefs(sceneId: string, spriteKeys: Iterable<string>): void {
    const normalizedSceneId = String(sceneId || '').trim();
    if (!normalizedSceneId) return;

    const previousKeys = this.sceneToSpriteKeys.get(normalizedSceneId) || new Set<string>();
    const nextKeys = new Set(
      [...spriteKeys].map((spriteKey) => this.normalizeSpriteKey(spriteKey)).filter(Boolean)
    );

    for (const spriteKey of previousKeys) {
      if (!nextKeys.has(spriteKey)) {
        this.detachSceneRefFromSprite(normalizedSceneId, spriteKey);
      }
    }

    this.sceneToSpriteKeys.set(normalizedSceneId, nextKeys);
    for (const spriteKey of nextKeys) {
      this.attachSceneRefToSprite(normalizedSceneId, spriteKey);
    }

    this.updateImageStates();
  }

  renameSceneSpriteRefs(previousSceneId: string, nextSceneId: string): void {
    const oldId = String(previousSceneId || '').trim();
    const newId = String(nextSceneId || '').trim();
    if (!oldId || !newId || oldId === newId) return;

    const spriteKeys = this.sceneToSpriteKeys.get(oldId);
    if (!spriteKeys) return;

    this.sceneToSpriteKeys.delete(oldId);
    this.sceneToSpriteKeys.set(newId, new Set(spriteKeys));

    for (const entry of this.imageCache.values()) {
      if (entry.refSceneIds.delete(oldId)) {
        entry.refSceneIds.add(newId);
      }
    }

    if (this.currentSceneId === oldId) {
      this.currentSceneId = newId;
    }
    if (this.loadedSceneIds.delete(oldId)) {
      this.loadedSceneIds.add(newId);
    }

    this.updateImageStates();
  }

  releaseSceneSpriteRefs(sceneId: string): void {
    const normalizedSceneId = String(sceneId || '').trim();
    if (!normalizedSceneId) return;

    const spriteKeys = this.sceneToSpriteKeys.get(normalizedSceneId);
    if (!spriteKeys) return;

    for (const spriteKey of spriteKeys) {
      this.detachSceneRefFromSprite(normalizedSceneId, spriteKey);
    }

    this.sceneToSpriteKeys.delete(normalizedSceneId);
    this.loadedSceneIds.delete(normalizedSceneId);
    if (this.currentSceneId === normalizedSceneId) {
      this.currentSceneId = null;
    }

    this.updateImageStates();
    this.evictUnusedImagesIfNeeded();
  }

  syncSceneCacheState(currentSceneId: string | null, loadedSceneIds: Iterable<string>): void {
    this.currentSceneId = currentSceneId ? String(currentSceneId) : null;
    this.loadedSceneIds = new Set(
      [...loadedSceneIds].map((sceneId) => String(sceneId || '').trim()).filter(Boolean)
    );
    this.updateImageStates();
    this.evictUnusedImagesIfNeeded();
  }

  async estimateSpritesTextureBytes(
    spriteKeys: Iterable<string>
  ): Promise<{ bytes: number; count: number; imagePaths: string[] }> {
    const uniqueImages = new Set<string>();
    let bytes = 0;

    for (const rawSpriteKey of spriteKeys) {
      const spriteKey = this.normalizeSpriteKey(rawSpriteKey);
      if (!spriteKey) continue;
      const { image } = await this.loadSprite(spriteKey);
      const imagePath =
        this.spriteToImagePath.get(spriteKey) || image.currentSrc || image.src || spriteKey;
      if (uniqueImages.has(imagePath)) continue;
      uniqueImages.add(imagePath);
      bytes +=
        (image.naturalWidth || image.width || 0) * (image.naturalHeight || image.height || 0) * 4;
    }

    return {
      bytes,
      count: uniqueImages.size,
      imagePaths: [...uniqueImages],
    };
  }

  /**
   * Loads a JSON file with caching and request deduplication.
   */
  async loadJson(path: string): Promise<any> {
    if (this.jsonCache.has(path)) {
      return this.jsonCache.get(path);
    }

    if (this.pending.has(path)) {
      return this.pending.get(path);
    }

    const promise = (async () => {
      const { isTauriRuntime, readProjectFileExisting } = await import('../platform/fileApi');
      if (isTauriRuntime()) {
        const localPath = `public${path.split('?')[0]}`;
        const content = await readProjectFileExisting(localPath);
        return JSON.parse(content);
      } else {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`Failed to load JSON: ${res.statusText}`);
        return res.json();
      }
    })()
      .then((data) => {
        this.jsonCache.set(path, data);
        return data;
      })
      .finally(() => {
        this.pending.delete(path);
      });

    this.pending.set(path, promise);
    return promise;
  }

  /**
   * Loads an Image with caching and request deduplication.
   */
  async loadImage(path: string): Promise<HTMLImageElement> {
    const cached = this.imageCache.get(path);
    if (cached) {
      cached.lastAccessed = Date.now();
      return cached.image;
    }

    if (this.pending.has(path)) {
      return this.pending.get(path);
    }

    const promise = (async () => {
      const { isTauriRuntime, readProjectFileBase64 } = await import('../platform/fileApi');

      let finalSrc = path;
      if (isTauriRuntime() && !path.startsWith('http') && !path.startsWith('data:')) {
        try {
          const localPath = `public${path.split('?')[0]}`;
          const base64 = await readProjectFileBase64(localPath);

          // Determine mime type from extension
          let mimeType = 'image/png';
          if (localPath.endsWith('.jpg') || localPath.endsWith('.jpeg')) mimeType = 'image/jpeg';
          else if (localPath.endsWith('.webp')) mimeType = 'image/webp';
          else if (localPath.endsWith('.gif')) mimeType = 'image/gif';
          else if (localPath.endsWith('.svg')) mimeType = 'image/svg+xml';

          finalSrc = `data:${mimeType};base64,${base64}`;
        } catch (e) {
          console.warn('[AssetLoader] Failed to load local image via Tauri API, falling back', e);
        }
      }

      return new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();

        img.src = finalSrc;
        img.onload = () => {
          const entry: ImageCacheEntry = {
            image: img,
            estimatedBytes:
              (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0) * 4,
            lastAccessed: Date.now(),
            refSceneIds: new Set<string>(),
            state: 'cold',
          };
          this.imageCache.set(path, entry);
          this.rehydrateImageRefs(path);
          resolve(img);
        };
        img.onerror = (e) => reject(e);
      });
    })().finally(() => {
      this.pending.delete(path);
      this.evictUnusedImagesIfNeeded();
    });

    this.pending.set(path, promise);
    return promise;
  }

  /**
   * High-level method to load a Sprite by name (not full path).
   * Handles path resolution logic (legacy vs public).
   */
  async loadSprite(spriteName: string): Promise<SpriteData> {
    const normalizedSpriteKey = this.normalizeSpriteKey(spriteName);

    const filename = normalizedSpriteKey;
    let jsonPath = filename;
    if (jsonPath.startsWith('public/')) {
      jsonPath = '/' + jsonPath.substring(7);
    } else if (!jsonPath.startsWith('/')) {
      jsonPath = '/sprites/' + filename;
    }

    const data = await this.loadJson(jsonPath);

    let imagePath = data.imageFile;
    if (imagePath.startsWith('public/')) {
      imagePath = '/' + imagePath.substring(7);
    } else if (!imagePath.startsWith('/') && !imagePath.startsWith('http')) {
      imagePath = '/assets/' + imagePath;
    }

    this.spriteToImagePath.set(normalizedSpriteKey, imagePath);
    this.rehydrateImageRefs(imagePath);

    const image = await this.loadImage(imagePath);
    const entry = this.imageCache.get(imagePath);
    if (entry) {
      entry.lastAccessed = Date.now();
    }

    return { json: data, image };
  }

  private normalizeSpriteKey(spriteName: string): string {
    let filename = String(spriteName || '').trim();
    if (!filename) return '';
    if (!filename.toLowerCase().endsWith('.json')) {
      filename += '.json';
    }
    return filename;
  }

  private attachSceneRefToSprite(sceneId: string, spriteKey: string): void {
    const imagePath = this.spriteToImagePath.get(spriteKey);
    if (!imagePath) return;
    const entry = this.imageCache.get(imagePath);
    if (!entry) return;
    entry.refSceneIds.add(sceneId);
  }

  private detachSceneRefFromSprite(sceneId: string, spriteKey: string): void {
    const imagePath = this.spriteToImagePath.get(spriteKey);
    if (!imagePath) return;
    const entry = this.imageCache.get(imagePath);
    if (!entry) return;
    entry.refSceneIds.delete(sceneId);
  }

  private rehydrateImageRefs(imagePath: string): void {
    const entry = this.imageCache.get(imagePath);
    if (!entry) return;

    const referencedSceneIds = new Set<string>();
    for (const [sceneId, spriteKeys] of this.sceneToSpriteKeys.entries()) {
      for (const spriteKey of spriteKeys) {
        if (this.spriteToImagePath.get(spriteKey) === imagePath) {
          referencedSceneIds.add(sceneId);
        }
      }
    }

    entry.refSceneIds = referencedSceneIds;
    this.updateEntryState(entry);
  }

  private updateImageStates(): void {
    for (const entry of this.imageCache.values()) {
      this.updateEntryState(entry);
    }
  }

  private updateEntryState(entry: ImageCacheEntry): void {
    if (this.currentSceneId && entry.refSceneIds.has(this.currentSceneId)) {
      entry.state = 'active';
      return;
    }

    for (const sceneId of entry.refSceneIds) {
      if (this.loadedSceneIds.has(sceneId)) {
        entry.state = 'warm';
        return;
      }
    }

    entry.state = 'cold';
  }

  private evictUnusedImagesIfNeeded(): void {
    let stats = this.getImageCacheStats();
    if (stats.estimatedBytes <= this.imageCacheBudgetBytes) return;

    const coldEntries = [...this.imageCache.entries()]
      .filter(([, entry]) => entry.state === 'cold')
      .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

    for (const [imagePath] of coldEntries) {
      if (stats.estimatedBytes <= this.imageCacheBudgetBytes) break;
      this.imageCache.delete(imagePath);
      stats = this.getImageCacheStats();
    }
  }
}
