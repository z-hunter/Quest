import type { Scene } from '../scene/Scene';
import type { SceneObject } from '../entities/SceneObject';

type TextAssetData = Record<string, string>;

export class TextAssetManager {
  private sceneCache = new Map<string, TextAssetData | null>();
  private objectCache = new Map<string, TextAssetData | null>();

  private normalizeId(id: string): string {
    return String(id || '')
      .replace(/\//g, '\\')
      .trim();
  }

  private idToRelativePath(id: string): string {
    return this.normalizeId(id).replace(/\\/g, '/');
  }

  getSceneAssetProjectPath(sceneId: string): string {
    return `public/text/scenes/${this.idToRelativePath(sceneId)}.json`;
  }

  getObjectAssetProjectPath(objectId: string): string {
    return `public/text/objects/${this.idToRelativePath(objectId)}.json`;
  }

  private getSceneAssetUrl(sceneId: string): string {
    return `/text/scenes/${this.idToRelativePath(sceneId)}.json`;
  }

  private getObjectAssetUrl(objectId: string): string {
    return `/text/objects/${this.idToRelativePath(objectId)}.json`;
  }

  buildDefaultSceneAsset(scene: Scene): TextAssetData {
    return {
      title: scene.name || scene.id || 'Untitled Scene',
      description:
        scene.description || `You are in ${scene.name || scene.id || 'an unnamed scene'}.`,
    };
  }

  buildDefaultObjectAsset(obj: SceneObject): TextAssetData {
    const fallbackTitle = (obj as any).customName || obj.name || obj.type || 'Object';
    const fallbackDescription = (obj as any).description || 'You see nothing special.';
    return {
      title: fallbackTitle,
      description: fallbackDescription,
    };
  }

  async ensureSceneAssetFile(scene: Scene): Promise<void> {
    if (!scene?.id) return;
    const assetPath = this.getSceneAssetProjectPath(scene.id);
    const content = JSON.stringify(this.buildDefaultSceneAsset(scene), null, 2);
    await this.ensureFile(assetPath, content);
  }

  async ensureObjectAssetFile(obj: SceneObject): Promise<void> {
    if (!obj?.name) return;
    const assetPath = this.getObjectAssetProjectPath(obj.name);
    const content = JSON.stringify(this.buildDefaultObjectAsset(obj), null, 2);
    await this.ensureFile(assetPath, content);
  }

  async openSceneAsset(scene: Scene): Promise<void> {
    const assetPath = this.getSceneAssetProjectPath(scene.id);
    const content = JSON.stringify(this.buildDefaultSceneAsset(scene), null, 2);
    await this.openFile(assetPath, content);
  }

  async openObjectAsset(obj: SceneObject): Promise<void> {
    const assetPath = this.getObjectAssetProjectPath(obj.name);
    const content = JSON.stringify(this.buildDefaultObjectAsset(obj), null, 2);
    await this.openFile(assetPath, content);
  }

  async deleteSceneAsset(scene: Scene): Promise<void> {
    await this.deleteFile(this.getSceneAssetProjectPath(scene.id));
    this.sceneCache.delete(this.normalizeId(scene.id));
  }

  async deleteObjectAsset(obj: SceneObject): Promise<void> {
    await this.deleteFile(this.getObjectAssetProjectPath(obj.name));
    this.objectCache.delete(this.normalizeId(obj.name));
  }

  async readSceneAsset(scene: Scene, forceReload: boolean = false): Promise<TextAssetData | null> {
    const sceneId = this.normalizeId(scene?.id || '');
    if (!sceneId) return null;
    if (!forceReload && this.sceneCache.has(sceneId)) {
      return this.sceneCache.get(sceneId) || null;
    }
    const data = await this.fetchJson(this.getSceneAssetUrl(sceneId));
    this.sceneCache.set(sceneId, data);
    return data;
  }

  async readObjectAsset(
    obj: SceneObject,
    forceReload: boolean = false
  ): Promise<TextAssetData | null> {
    const objectId = this.normalizeId(obj?.name || '');
    if (!objectId) return null;
    if (!forceReload && this.objectCache.has(objectId)) {
      return this.objectCache.get(objectId) || null;
    }
    const data = await this.fetchJson(this.getObjectAssetUrl(objectId));
    this.objectCache.set(objectId, data);
    return data;
  }

  async preloadScene(scene: Scene): Promise<void> {
    await this.readSceneAsset(scene, true);
    await Promise.all(
      (scene.entities || []).map((entity: SceneObject) => this.readObjectAsset(entity, true))
    );
  }

  clearCaches(): void {
    this.sceneCache.clear();
    this.objectCache.clear();
  }

  getResolvedSceneField(scene: Scene, field: string): string | null {
    const sceneId = this.normalizeId(scene?.id || '');
    const asset = sceneId ? this.sceneCache.get(sceneId) : null;
    const fallback = field === 'description' ? scene?.description || null : null;
    return this.resolveField(asset, scene?.textRedirects || null, field, fallback);
  }

  getResolvedObjectField(obj: SceneObject, field: string): string | null {
    const objectId = this.normalizeId(obj?.name || '');
    const asset = objectId ? this.objectCache.get(objectId) : null;
    const fallback = field === 'description' ? (obj as any).description || null : null;
    return this.resolveField(asset, obj?.textRedirects || null, field, fallback);
  }

  private resolveField(
    asset: TextAssetData | null | undefined,
    redirects: Record<string, string> | null | undefined,
    field: string,
    fallback: string | null
  ): string | null {
    if (!asset) return fallback;
    const redirectTarget = redirects && redirects[field];
    if (redirectTarget) {
      const redirected = asset[redirectTarget];
      if (typeof redirected === 'string') return redirected;
      console.warn(
        `[TextAssetManager] Missing redirected field '${redirectTarget}' for '${field}'.`
      );
    }
    const direct = asset[field];
    if (typeof direct === 'string') return direct;
    return fallback;
  }

  private async fetchJson(url: string): Promise<TextAssetData | null> {
    try {
      const response = await fetch(`${url}?t=${Date.now()}`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(await response.text());
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return null;
      }
      return (await response.json()) as TextAssetData;
    } catch (error) {
      console.error('[TextAssetManager] Failed to fetch text asset:', error);
      return null;
    }
  }

  private async ensureFile(filePath: string, content: string): Promise<void> {
    await fetch('/api/ensure-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content }),
    });
  }

  private async openFile(filePath: string, content: string): Promise<void> {
    const response = await fetch('/api/open-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
  }

  async duplicateObjectAssetIfExists(
    sourceObjectId: string,
    targetObjectId: string
  ): Promise<void> {
    const sourceUrl = this.getObjectAssetUrl(sourceObjectId);
    const sourceData = await this.fetchJson(sourceUrl);
    if (!sourceData) return;

    const targetPath = this.getObjectAssetProjectPath(targetObjectId);
    const response = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetPath, content: JSON.stringify(sourceData, null, 2) }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    this.objectCache.set(this.normalizeId(targetObjectId), sourceData);
  }

  private async deleteFile(filePath: string): Promise<void> {
    const response = await fetch('/api/delete-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
  }
}
