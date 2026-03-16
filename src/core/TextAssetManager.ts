import type { Scene } from '../scene/Scene';
import type { SceneObject } from '../entities/SceneObject';
import type { ParserLexiconAsset, ParserTrainingAsset } from '../mechanics/parserLanguage';

type TextAssetValue = string | string[];
type TextAssetData = Record<string, TextAssetValue>;

const DEFAULT_SERVICE_ASSETS: Record<string, TextAssetData> = {
  parser: {
    look_default_scene: 'You are in {scene}.',
    look_default_object: 'You see nothing special about the {target}.',
    look_not_found: "You don't see any {target} here.",
    look_which_one: 'Which one do you mean: {options}?',
    examine_prompt: 'Examine what?',
    examine_which_one: 'Which one do you want to examine: {options}?',
    take_prompt: 'Take what?',
    take_which_one: 'Which item do you mean: {options}?',
    take_pickup_success: 'You picked up the {item}.',
    take_cannot: 'You cannot take that.',
    inventory_empty: 'You are not carrying anything.',
    inventory_items: 'You are carrying: {items}',
    go_to_prompt: 'Where do you want to go?',
    go_to_which_one: 'Where exactly do you want to go: {options}?',
    go_to_not_found: "You can't get to {target} from here.",
    go_to_success: 'You go to {target}.',
    use_prompt: 'Use what?',
    use_format_prompt: 'Use what on what? (Format: USE ITEM ON TARGET)',
    use_missing_item: "You don't have the {item}.",
    use_no_effect_pair: 'Using the {item} on the {target} does nothing.',
    use_no_effect_single: 'You try to use the {target}, but nothing happens.',
    parse_unknown: "I don't understand.",
  },
  engine: {
    click_you_see: 'You see {title}',
    too_far_generic: 'You are too far away.',
    too_far_from_entity: 'You are too far away from the {target}.',
    locked_needs: 'Locked. Needs {item}',
    locked_generic: 'Locked.',
  },
  scripts: {
    pillar_key_inserted: 'You insert the key into a hidden slot in the pillar.',
    pillar_compartment_opened: 'Click! A secret compartment opens!',
    pillar_open_description: 'The pillar is open, revealing a secret compartment.',
    test_audio_playing: 'Playing test sound...',
  },
};

const DEFAULT_PARSER_LEXICON: ParserLexiconAsset = {
  stage1Aliases: {
    look: ['look'],
    examine: ['examine', 'inspect', 'check'],
    take: ['take', 'get', 'pickup', 'pick up'],
    goTo: ['go', 'walk', 'move'],
    showInventory: ['inventory', 'inv'],
  },
  normalizationPrefixes: {
    look: ['look at', 'look', 'tell me about', 'what is that', 'what is', 'describe'],
    examine: [
      'take a closer look at',
      'look closely at',
      'examine at',
      'examine',
      'inspect at',
      'inspect',
      'check at',
      'check',
    ],
    take: ['pick up', 'take', 'get', 'grab'],
    goTo: [
      'go over to',
      'walk over to',
      'move over to',
      'go to',
      'walk to',
      'move to',
      'go',
      'walk',
      'move',
      'head to',
      'travel to',
      'head',
      'travel',
    ],
    showInventory: [],
  },
  politePrefixes: [
    'please',
    'could you',
    'can you',
    'would you',
    'i want to',
    'i would like to',
    "i'd like to",
  ],
  articles: ['the', 'a', 'an', 'my'],
  lookSceneWords: ['around', 'here', 'scene'],
};

const DEFAULT_PARSER_TRAINING: ParserTrainingAsset = {
  look: [
    'look',
    'look chair',
    'look logo',
    'look lamp',
    'look key',
    'look door',
    'look at the lamp',
    'look at the chair',
    'look at the logo',
    'tell me about the door',
    'what is that lamp',
    'what is the chair',
    'what is the logo',
    'describe the office door',
    'look over the note',
  ],
  examine: [
    'examine',
    'examine chair',
    'examine logo',
    'inspect chair',
    'inspect the logo',
    'check the card',
    'check chair',
    'inspect the note',
    'examine the lamp',
    'inspect the desk',
    'check the key',
    'look closely at the logo',
    'take a closer look at the chair',
  ],
  take: [
    'take',
    'take key',
    'take card',
    'take note',
    'get key',
    'pickup key',
    'pick up key',
    'take the key',
    'pick up the key',
    'grab the card',
    'take the id card',
    'pick up linda card',
    'grab the note',
    'i want to take the key',
    'please pick up the card',
  ],
  goTo: [
    'go',
    'go office',
    'go logo',
    'walk office',
    'walk logo',
    'move office',
    'move logo',
    'go to the office',
    'go to office',
    'walk to the office',
    'walk to the logo',
    'move to the lamp',
    'move to logo',
    'head to the door',
    'go over to the desk',
    'go over to the office',
    'go over to the logo',
    'travel to the office',
    'walk over to the card reader',
    'move over to the console',
  ],
  showInventory: [
    'inventory',
    'inv',
    'items',
    'my items',
    'show inventory',
    'what do i have',
    'what am i carrying',
    'check my inventory',
    'show me my inventory',
    'list my items',
    'what items do i have',
    'open inventory',
  ],
};

export class TextAssetManager {
  private sceneCache = new Map<string, TextAssetData | null>();
  private objectCache = new Map<string, TextAssetData | null>();
  private serviceCache = new Map<string, TextAssetData>();
  private parserLexiconCache: ParserLexiconAsset = structuredClone(DEFAULT_PARSER_LEXICON);
  private parserTrainingCache: ParserTrainingAsset = structuredClone(DEFAULT_PARSER_TRAINING);
  private parserLexiconLoaded = false;
  private parserTrainingLoaded = false;

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

  private getServiceAssetUrl(domain: string): string {
    return `/text/system/${domain}.json`;
  }

  private getDefaultServiceDomain(domain: string): TextAssetData {
    return { ...(DEFAULT_SERVICE_ASSETS[domain] || {}) };
  }

  getParserLexicon(): ParserLexiconAsset {
    return this.parserLexiconCache;
  }

  getParserTraining(): ParserTrainingAsset {
    return this.parserTrainingCache;
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
      synonyms: [],
    };
  }

  async ensureSceneAssetFile(scene: Scene): Promise<void> {
    if (!scene?.id) return;
    const assetPath = this.getSceneAssetProjectPath(scene.id);
    const content = JSON.stringify(this.buildDefaultSceneAsset(scene), null, 2);
    await this.ensureFile(assetPath, content);
  }

  async ensureObjectAssetFile(obj: SceneObject): Promise<void> {
    if (!obj?.name || obj.type === 'Walkbox') return;
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
    if (!obj?.name || obj.type === 'Walkbox') return;
    const assetPath = this.getObjectAssetProjectPath(obj.name);
    const content = JSON.stringify(this.buildDefaultObjectAsset(obj), null, 2);
    await this.openFile(assetPath, content);
  }

  async deleteSceneAsset(scene: Scene): Promise<void> {
    await this.deleteFile(this.getSceneAssetProjectPath(scene.id));
    this.sceneCache.delete(this.normalizeId(scene.id));
  }

  async deleteObjectAsset(obj: SceneObject): Promise<void> {
    if (!obj?.name || obj.type === 'Walkbox') return;
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
    if (!obj?.name || obj.type === 'Walkbox') return null;
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

  async preloadServiceAssets(domains?: string[]): Promise<void> {
    const targetDomains = domains?.length ? domains : Object.keys(DEFAULT_SERVICE_ASSETS);
    await Promise.all(targetDomains.map((domain) => this.readServiceAsset(domain, true)));
  }

  async preloadParserLanguageAssets(): Promise<void> {
    await Promise.all([this.readParserLexiconAsset(true), this.readParserTrainingAsset(true)]);
  }

  clearCaches(): void {
    this.sceneCache.clear();
    this.objectCache.clear();
    this.serviceCache.clear();
    this.parserLexiconCache = structuredClone(DEFAULT_PARSER_LEXICON);
    this.parserTrainingCache = structuredClone(DEFAULT_PARSER_TRAINING);
    this.parserLexiconLoaded = false;
    this.parserTrainingLoaded = false;
  }

  async readParserLexiconAsset(forceReload: boolean = false): Promise<ParserLexiconAsset> {
    if (!forceReload && this.parserLexiconLoaded) {
      return this.parserLexiconCache;
    }

    const loaded = (await this.fetchUnknownJson(
      '/text/system/parser-lexicon.json'
    )) as Partial<ParserLexiconAsset> | null;
    this.parserLexiconCache = {
      ...structuredClone(DEFAULT_PARSER_LEXICON),
      ...(loaded || {}),
      stage1Aliases: {
        ...DEFAULT_PARSER_LEXICON.stage1Aliases,
        ...(loaded?.stage1Aliases || {}),
      },
      normalizationPrefixes: {
        ...DEFAULT_PARSER_LEXICON.normalizationPrefixes,
        ...(loaded?.normalizationPrefixes || {}),
      },
    };
    this.parserLexiconLoaded = true;
    return this.parserLexiconCache;
  }

  async readParserTrainingAsset(forceReload: boolean = false): Promise<ParserTrainingAsset> {
    if (!forceReload && this.parserTrainingLoaded) {
      return this.parserTrainingCache;
    }

    const loaded = (await this.fetchUnknownJson(
      '/text/system/parser-training.json'
    )) as Partial<ParserTrainingAsset> | null;
    this.parserTrainingCache = {
      ...structuredClone(DEFAULT_PARSER_TRAINING),
      ...(loaded || {}),
    };
    this.parserTrainingLoaded = true;
    return this.parserTrainingCache;
  }

  async readServiceAsset(domain: string, forceReload: boolean = false): Promise<TextAssetData> {
    const normalizedDomain = String(domain || '')
      .trim()
      .toLowerCase();
    if (!normalizedDomain) return {};
    if (!forceReload && this.serviceCache.has(normalizedDomain)) {
      return this.serviceCache.get(normalizedDomain) || {};
    }

    const defaults = this.getDefaultServiceDomain(normalizedDomain);
    const loaded = await this.fetchJson(this.getServiceAssetUrl(normalizedDomain));
    const merged = { ...defaults, ...(loaded || {}) };
    this.serviceCache.set(normalizedDomain, merged);
    return merged;
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

  getResolvedObjectListField(obj: SceneObject, field: string): string[] {
    const objectId = this.normalizeId(obj?.name || '');
    const asset = objectId ? this.objectCache.get(objectId) : null;
    return this.resolveListField(asset, field);
  }

  getServiceText(key: string, params?: Record<string, string | number>, fallback?: string): string {
    const rawKey = String(key || '').trim();
    if (!rawKey) return fallback || '';

    const dotIndex = rawKey.indexOf('.');
    if (dotIndex === -1) {
      console.warn(`[TextAssetManager] Invalid service text key '${rawKey}'.`);
      return fallback || rawKey;
    }

    const domain = rawKey.slice(0, dotIndex).toLowerCase();
    const entryKey = rawKey.slice(dotIndex + 1);
    if (!entryKey) {
      console.warn(`[TextAssetManager] Invalid service text key '${rawKey}'.`);
      return fallback || rawKey;
    }

    if (!this.serviceCache.has(domain)) {
      this.serviceCache.set(domain, this.getDefaultServiceDomain(domain));
      void this.readServiceAsset(domain, true);
    }

    const domainAsset = this.serviceCache.get(domain) || {};
    const template = domainAsset[entryKey];
    if (typeof template !== 'string') {
      console.warn(`[TextAssetManager] Missing service text '${rawKey}'.`);
      return fallback || rawKey;
    }

    return this.interpolate(template, params);
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

  private resolveListField(asset: TextAssetData | null | undefined, field: string): string[] {
    const raw = asset?.[field];
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private async fetchJson(url: string): Promise<TextAssetData | null> {
    return (await this.fetchUnknownJson(url)) as TextAssetData | null;
  }

  private async fetchUnknownJson(url: string): Promise<unknown | null> {
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
      return await response.json();
    } catch (error) {
      console.error('[TextAssetManager] Failed to fetch text asset:', error);
      return null;
    }
  }

  private interpolate(
    template: string,
    params?: Record<string, string | number> | null | undefined
  ): string {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_match, token: string) => {
      const value = params[token];
      return value === undefined || value === null ? `{${token}}` : String(value);
    });
  }

  private async ensureFile(filePath: string, content: string): Promise<void> {
    await fetch('/api/ensure-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content }),
    });
  }

  private async saveFile(filePath: string, content: string): Promise<void> {
    const response = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
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

  async carrySceneAssetIfNeeded(
    previousSceneId: string | null | undefined,
    scene: Scene
  ): Promise<void> {
    const targetSceneId = this.normalizeId(scene?.id || '');
    const sourceSceneId = this.normalizeId(previousSceneId || '');

    if (!targetSceneId) return;

    if (sourceSceneId && sourceSceneId !== targetSceneId) {
      const targetData = await this.fetchJson(this.getSceneAssetUrl(targetSceneId));
      if (!targetData) {
        const sourceData = await this.fetchJson(this.getSceneAssetUrl(sourceSceneId));
        if (sourceData) {
          await this.saveFile(
            this.getSceneAssetProjectPath(targetSceneId),
            JSON.stringify(sourceData, null, 2)
          );
          this.sceneCache.set(targetSceneId, sourceData);
          return;
        }
      }
    }

    await this.ensureSceneAssetFile(scene);
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
