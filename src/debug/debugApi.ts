import type { Game } from '../core/Game';
import { useEditorStore } from '../store/editorStore';
import { isTauriRuntime } from '../platform/fileApi';
import { SoundManager } from '../systems/SoundManager';
import type { ConsoleLine, ConsoleLineType } from '../core/Console';
import { normalizeGroupIdList } from '../utils/GroupIds';
import type { Box3DRenderDiagnostics, Box3DRenderProfile } from '../graphics/SceneRenderer';

export type QuestAppMode = 'game' | 'scene-editor' | 'sprite-editor';

export interface ObjectDescriptor {
  id: string;
  name: string;
  type: string;
  customName?: string;
}

export interface GetConsoleMessagesOptions {
  afterTimestamp?: number;
  type?: ConsoleLineType | ConsoleLineType[];
}

export interface PerformanceSampleOptions {
  durationMs?: number;
  sections?: Array<'update' | 'render'>;
}

export interface SectionMetric {
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  count: number;
}

export interface PerformanceSampleResult {
  frameCount: number;
  measuredDurationMs: number;
  fps: number;
  sections: Partial<Record<'update' | 'render', SectionMetric>>;
  frameDurations: {
    p50: number;
    p95: number;
    minMs: number;
    maxMs: number;
    avgMs: number;
  };
}

export type {
  Box3DRenderDiagnostics,
  Box3DLayerDiagnostics,
  Box3DRenderProfile,
} from '../graphics/SceneRenderer';

export interface QuestDebugApi {
  isAvailable: () => boolean;

  // Modes
  modes: {
    getMode: () => QuestAppMode;
    setMode: (mode: QuestAppMode) => void;
  };
  getMode: () => QuestAppMode;
  setMode: (mode: QuestAppMode) => void;

  // Scenes
  scenes: {
    load: (filename: string) => Promise<void>;
  };

  // Objects
  objects: {
    listObjects: () => ObjectDescriptor[];
    getObject: (nameOrId: string) => any;
    getObjectProperties: (nameOrId: string) => Record<string, any> | null;
    setObjectProperty: (nameOrId: string, property: string, value: unknown) => boolean;
    setObjectProperties: (nameOrId: string, properties: Record<string, unknown>) => boolean;
  };

  // Settings
  settings: {
    getSettings: () => Record<string, any>;
    getSetting: (path: string) => any;
    setSetting: (path: string, value: unknown) => void;
    setSettings: (partialSettings: Record<string, any>) => void;
    saveSettings: () => void;
    loadSettings: () => void;
  };

  // In-Game Console & Parser
  console: {
    isOpen: () => boolean;
    open: () => void;
    close: () => void;
    toggle: () => void;
    sendCommand: (command: string) => Promise<void> | void;
    getMessages: (options?: GetConsoleMessagesOptions) => ConsoleLine[];
    clear: () => void;
    log: (text: string, type?: ConsoleLineType) => void;
  };

  // Performance Profiling
  performance: {
    sample: (options?: PerformanceSampleOptions) => Promise<PerformanceSampleResult>;
  };

  // Renderer Diagnostics
  renderer: {
    getDiagnostics: () => Box3DRenderDiagnostics;
    getBox3DProfile: () => Box3DRenderProfile;
    setBox3DProfilingEnabled: (enabled: boolean) => void;
    resetBox3DProfile: () => void;
  };
}

const NUMERIC_PROPERTIES = new Set([
  'x',
  'y',
  'width',
  'height',
  'refScale',
  'modelScale',
  'layer',
  'parallax',
  'colliderHeight',
  'colliderWidth',
  'opacity',
  'blur',
  'brightness',
  'saturation',
  'contrast',
  'hueShift',
  'speed',
  'horizon',
  'front',
  'min',
  'max',
  'correctionalScale',
  'camDeadzoneX',
  'camDeadzoneY',
  'cameraSpeed',
  'box3dPerspective',
  'attachedVolume',
  'uiScale',
  'curvature',
  'vignette',
  'scanlineCount',
  'scanlineIntensity',
  'aberration',
  'bloom',
  'glow',
  'persistence',
  'beamModulation',
  'humBar',
  'breathing',
  'phosphor',
]);

function getNestedValue(obj: Record<string, any>, path: string): any {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let current: any = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function setNestedValue(obj: Record<string, any>, path: string, value: unknown): void {
  if (!obj || !path) return;
  const parts = path.split('.');
  let current: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] == null || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function syncDomModeDataset(mode: QuestAppMode): void {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.questMode = mode;
  }
}

export function createDebugApi(game: Game): QuestDebugApi {
  // Modes implementation
  const getMode = (): QuestAppMode => {
    const store = useEditorStore.getState();
    if (store.spriteEditorEnabled || (game.spriteEditor && game.spriteEditor.active)) {
      return 'sprite-editor';
    }
    if (store.enabled || (game.editor && game.editor.enabled)) {
      return 'scene-editor';
    }
    return 'game';
  };

  const setMode = (mode: QuestAppMode): void => {
    const parserInput = game.getCommandInput?.();

    if (mode === 'game') {
      if (game.spriteEditor && game.spriteEditor.active) {
        game.spriteEditor.toggle(false);
      }
      if (game.editor && game.editor.enabled) {
        game.editor.toggle();
      }
      useEditorStore.getState().toggle(false);
      useEditorStore.getState().toggleSpriteEditor(false);

      if (parserInput) {
        parserInput.disabled = false;
      }
    } else if (mode === 'scene-editor') {
      if (game.spriteEditor && game.spriteEditor.active) {
        game.spriteEditor.toggle(false);
      }
      useEditorStore.getState().toggleSpriteEditor(false);

      if (game.editor && !game.editor.enabled) {
        game.editor.toggle();
      }
      useEditorStore.getState().toggle(true);

      const scene = game.sceneManager.currentScene;
      if (scene) {
        useEditorStore.getState().setSceneInfo(scene.name, scene.filename || '');
      }

      if (parserInput) {
        parserInput.blur();
        parserInput.disabled = true;
      }
    } else if (mode === 'sprite-editor') {
      if (game.editor && game.editor.enabled) {
        game.editor.toggle();
      }
      useEditorStore.getState().toggle(false);

      if (game.spriteEditor) {
        game.spriteEditor.toggle(true);
      }
      useEditorStore.getState().toggleSpriteEditor(true);

      if (parserInput) {
        parserInput.blur();
        parserInput.disabled = true;
      }
    }

    syncDomModeDataset(mode);
  };

  // Sync initial mode to DOM dataset
  syncDomModeDataset(getMode());

  // Scenes implementation
  const loadScene = async (filename: string): Promise<void> => {
    if (!filename) {
      throw new Error('Scene filename must be provided');
    }
    await game.sceneManager.loadScene(filename);
    if (game.editor && game.editor.enabled) {
      game.editor.refreshHierarchy?.();
      const current = game.sceneManager.currentScene;
      if (current) {
        useEditorStore.getState().setSceneInfo(current.name, current.filename || filename);
      }
    }
  };

  // Objects implementation
  const listObjects = (): ObjectDescriptor[] => {
    const scene = game.sceneManager.currentScene;
    if (!scene) return [];

    const result: ObjectDescriptor[] = [];

    // Scene itself
    result.push({
      id: scene.id || 'SCENE',
      name: scene.name || 'SCENE',
      type: 'SCENE',
    });

    // Entities (including Actors, Quads, Box3Ds)
    if (Array.isArray(scene.entities)) {
      for (const entity of scene.entities) {
        const type = (entity as any).isActor
          ? 'Actor'
          : (entity as any).isStatic
            ? 'Static'
            : entity.constructor?.name || 'Entity';

        result.push({
          id: (entity as any).id || entity.name,
          name: entity.name,
          type,
          customName: (entity as any).customName,
        });
      }
    }

    // Walkboxes
    if (Array.isArray(scene.walkbox)) {
      for (const wb of scene.walkbox) {
        result.push({
          id: (wb as any).id || wb.name,
          name: wb.name,
          type: 'Walkbox',
          customName: (wb as any).customName,
        });
      }
    }

    // Triggerboxes
    if (Array.isArray(scene.triggerboxes)) {
      for (const tb of scene.triggerboxes) {
        result.push({
          id: (tb as any).id || tb.name,
          name: tb.name,
          type: 'Triggerbox',
          customName: (tb as any).customName,
        });
      }
    }

    // Folders
    if (Array.isArray(scene.folders)) {
      for (const folder of scene.folders) {
        result.push({
          id: (folder as any).id || folder.name,
          name: folder.name,
          type: 'Folder',
        });
      }
    }

    return result;
  };

  const getObject = (nameOrId: string): any => {
    const scene = game.sceneManager.currentScene;
    if (!scene) return null;

    const trimmed = String(nameOrId || '').trim();
    if (!trimmed) return null;

    if (trimmed === 'SCENE' || trimmed === scene.id || trimmed === scene.name) {
      return scene;
    }

    // Exact matches
    if (Array.isArray(scene.entities)) {
      const found = scene.entities.find(
        (e: any) => e.name === trimmed || e.id === trimmed || (e as any).customName === trimmed
      );
      if (found) return found;
    }

    if (Array.isArray(scene.triggerboxes)) {
      const found = scene.triggerboxes.find(
        (tb: any) => tb.name === trimmed || tb.id === trimmed || (tb as any).customName === trimmed
      );
      if (found) return found;
    }

    if (Array.isArray(scene.walkbox)) {
      const found = scene.walkbox.find(
        (wb: any) => wb.name === trimmed || wb.id === trimmed || (wb as any).customName === trimmed
      );
      if (found) return found;
    }

    if (Array.isArray(scene.folders)) {
      const found = scene.folders.find((f: any) => f.name === trimmed || f.id === trimmed);
      if (found) return found;
    }

    // Case-insensitive fallback
    const lower = trimmed.toLowerCase();
    if (Array.isArray(scene.entities)) {
      const found = scene.entities.find(
        (e: any) =>
          e.name?.toLowerCase() === lower ||
          e.id?.toLowerCase() === lower ||
          (e as any).customName?.toLowerCase() === lower
      );
      if (found) return found;
    }

    if (Array.isArray(scene.triggerboxes)) {
      const found = scene.triggerboxes.find(
        (tb: any) =>
          tb.name?.toLowerCase() === lower ||
          tb.id?.toLowerCase() === lower ||
          (tb as any).customName?.toLowerCase() === lower
      );
      if (found) return found;
    }

    if (Array.isArray(scene.walkbox)) {
      const found = scene.walkbox.find(
        (wb: any) =>
          wb.name?.toLowerCase() === lower ||
          wb.id?.toLowerCase() === lower ||
          (wb as any).customName?.toLowerCase() === lower
      );
      if (found) return found;
    }

    return null;
  };

  const getObjectProperties = (nameOrId: string): Record<string, any> | null => {
    const target = getObject(nameOrId);
    if (!target) return null;

    const props: Record<string, any> = {};
    for (const key of Object.keys(target)) {
      // Filter internal engine references
      if (key === 'game' || key === 'scene' || key === 'renderer' || key === 'boundKeyHandler') {
        continue;
      }
      const val = target[key];
      if (typeof val === 'function') continue;

      if (val !== null && typeof val === 'object') {
        try {
          // Serialize / deep clone object structures
          props[key] = JSON.parse(JSON.stringify(val));
        } catch {
          props[key] = val;
        }
      } else {
        props[key] = val;
      }
    }
    return props;
  };

  const applyPropertyToObject = (target: any, property: string, value: unknown): boolean => {
    if (!target) return false;

    let finalValue: any = value;

    // Coerce numeric properties if passed as string
    if (NUMERIC_PROPERTIES.has(property) && typeof value === 'string') {
      const num = parseFloat(value);
      if (!Number.isNaN(num)) {
        finalValue = num;
      }
    } else if (typeof target[property] === 'number' && typeof value === 'string') {
      const num = parseFloat(value);
      if (!Number.isNaN(num)) {
        finalValue = num;
      }
    }

    if (property === 'groupID') {
      finalValue = normalizeGroupIdList(String(finalValue ?? ''), { preserveEmptyTokens: true });
    }

    const scene = game.sceneManager.currentScene;
    if (property === 'name' && scene && typeof scene.renameObject === 'function') {
      const nextName = String(finalValue || '').trim();
      if (nextName && nextName !== target.name) {
        scene.renameObject(target, nextName);
      }
    } else {
      target[property] = finalValue;
    }

    if (target.inheritedProps instanceof Set && target.inheritedProps.has(property)) {
      target.inheritedProps.delete(property);
    }

    useEditorStore.getState().incrementObjectVersion();
    useEditorStore.getState().incrementHierarchyVersion();
    return true;
  };

  const setObjectProperty = (nameOrId: string, property: string, value: unknown): boolean => {
    const target = getObject(nameOrId);
    if (!target) return false;
    return applyPropertyToObject(target, property, value);
  };

  const setObjectProperties = (nameOrId: string, properties: Record<string, unknown>): boolean => {
    const target = getObject(nameOrId);
    if (!target) return false;

    const entries = Object.entries(properties);
    if (entries.length === 0) return true;

    let allSucceeded = true;
    for (const [prop, val] of entries) {
      const success = applyPropertyToObject(target, prop, val);
      if (!success) {
        allSucceeded = false;
      }
    }
    return allSucceeded;
  };

  // Settings implementation
  const getSettings = (): Record<string, any> => {
    return JSON.parse(JSON.stringify(game.settings || {}));
  };

  const getSetting = (path: string): any => {
    return getNestedValue(game.settings as any, path);
  };

  const setSetting = (path: string, value: unknown): void => {
    if (!game.settings) return;

    let finalValue: any = value;
    const lastKey = path.split('.').pop() || '';
    if (NUMERIC_PROPERTIES.has(lastKey) && typeof value === 'string') {
      const num = parseFloat(value);
      if (!Number.isNaN(num)) {
        finalValue = num;
      }
    }

    setNestedValue(game.settings as any, path, finalValue);

    if (path.startsWith('audio') || path === 'audio.attachedVolume') {
      const vol = game.settings?.audio?.attachedVolume;
      if (typeof vol === 'number') {
        SoundManager.getInstance().setAttachedVolume(vol);
      }
    }

    if (path.startsWith('editor.uiScale')) {
      useEditorStore.getState().incrementHierarchyVersion();
    }

    useEditorStore.getState().incrementObjectVersion();
    game.saveSettings();
  };

  const setSettings = (partialSettings: Record<string, any>): void => {
    if (!game.settings || !partialSettings) return;

    const applyDeep = (base: Record<string, any>, patch: Record<string, any>) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          if (!base[k] || typeof base[k] !== 'object') base[k] = {};
          applyDeep(base[k], v);
        } else {
          base[k] = v;
        }
      }
    };

    applyDeep(game.settings as any, partialSettings);

    if (game.settings.audio?.attachedVolume !== undefined) {
      SoundManager.getInstance().setAttachedVolume(game.settings.audio.attachedVolume);
    }

    useEditorStore.getState().incrementHierarchyVersion();
    useEditorStore.getState().incrementObjectVersion();
    game.saveSettings();
  };

  const saveSettings = (): void => {
    game.saveSettings();
  };

  const loadSettings = (): void => {
    game.loadSettings();
  };

  // In-Game Console & Parser implementation
  const sendCommand = (command: string): Promise<void> | void => {
    const trimmed = String(command || '').trim();
    if (!trimmed) return;

    const firstWord = trimmed.split(/\s+/)[0] || '';
    if (firstWord.startsWith('#')) {
      game.console.processCommand(trimmed);
    } else {
      return game.submitGameplayInput(trimmed);
    }
  };

  const getMessages = (options?: GetConsoleMessagesOptions): ConsoleLine[] => {
    const buffer = game.console?.buffer || [];
    let lines = [...buffer];

    if (options?.afterTimestamp !== undefined) {
      const minTime = options.afterTimestamp;
      lines = lines.filter((line) => line.timestamp > minTime);
    }

    if (options?.type !== undefined) {
      const types = Array.isArray(options.type) ? new Set(options.type) : new Set([options.type]);
      lines = lines.filter((line) => types.has(line.type));
    }

    return lines;
  };

  const clearConsole = (): void => {
    game.console?.clear();
  };

  const logToConsole = (text: string, type: ConsoleLineType = 'info'): void => {
    game.console?.log(text, type);
  };

  // Performance Profiling implementation
  const samplePerformance = async (
    options: PerformanceSampleOptions = {}
  ): Promise<PerformanceSampleResult> => {
    const durationMs = options.durationMs ?? 1000;
    const sectionsToMeasure = options.sections ?? ['update', 'render'];

    const originalUpdate = game.update;
    const originalRender = game.render;
    const originalLoop = game.loop;

    const updateDurations: number[] = [];
    const renderDurations: number[] = [];
    const frameDurations: number[] = [];

    let frameCount = 0;
    let lastFrameTime = performance.now();
    const startTime = performance.now();

    const restore = () => {
      game.update = originalUpdate;
      game.render = originalRender;
      game.loop = originalLoop;
    };

    try {
      if (sectionsToMeasure.includes('update') && typeof originalUpdate === 'function') {
        game.update = function (deltaTime: number) {
          const t0 = performance.now();
          try {
            return originalUpdate.call(this, deltaTime);
          } finally {
            updateDurations.push(performance.now() - t0);
          }
        };
      }

      if (sectionsToMeasure.includes('render') && typeof originalRender === 'function') {
        game.render = function () {
          const t0 = performance.now();
          try {
            return originalRender.call(this);
          } finally {
            renderDurations.push(performance.now() - t0);
          }
        };
      }

      if (typeof originalLoop === 'function') {
        game.loop = function (timestamp: number) {
          const now = performance.now();
          const frameDelta = now - lastFrameTime;
          lastFrameTime = now;
          if (frameCount > 0) {
            frameDurations.push(frameDelta);
          }
          frameCount++;
          return originalLoop.call(this, timestamp);
        };
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, Math.max(1, durationMs));
      });
    } finally {
      restore();
    }

    const endTime = performance.now();
    const measuredDurationMs = Math.max(0.001, endTime - startTime);
    const fps = measuredDurationMs > 0 ? (frameCount / measuredDurationMs) * 1000 : 0;

    const calcSectionMetric = (durations: number[]): SectionMetric => {
      if (!durations.length) {
        return { totalMs: 0, avgMs: 0, minMs: 0, maxMs: 0, count: 0 };
      }
      const totalMs = durations.reduce((sum, d) => sum + d, 0);
      const avgMs = totalMs / durations.length;
      const minMs = Math.min(...durations);
      const maxMs = Math.max(...durations);
      return {
        totalMs: Math.round(totalMs * 100) / 100,
        avgMs: Math.round(avgMs * 100) / 100,
        minMs: Math.round(minMs * 100) / 100,
        maxMs: Math.round(maxMs * 100) / 100,
        count: durations.length,
      };
    };

    const sortedFrames = [...frameDurations].sort((a, b) => a - b);
    const getPercentile = (sorted: number[], p: number) => {
      if (!sorted.length) return 0;
      const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
      return Math.round(sorted[index] * 100) / 100;
    };

    const totalFrameTime = frameDurations.reduce((sum, d) => sum + d, 0);
    const avgFrameTime = frameDurations.length ? totalFrameTime / frameDurations.length : 0;

    const sections: Partial<Record<'update' | 'render', SectionMetric>> = {};
    if (sectionsToMeasure.includes('update')) {
      sections.update = calcSectionMetric(updateDurations);
    }
    if (sectionsToMeasure.includes('render')) {
      sections.render = calcSectionMetric(renderDurations);
    }

    return {
      frameCount,
      measuredDurationMs: Math.round(measuredDurationMs * 100) / 100,
      fps: Math.round(fps * 10) / 10,
      sections,
      frameDurations: {
        p50: getPercentile(sortedFrames, 0.5),
        p95: getPercentile(sortedFrames, 0.95),
        minMs: sortedFrames.length ? Math.round(sortedFrames[0] * 100) / 100 : 0,
        maxMs: sortedFrames.length
          ? Math.round(sortedFrames[sortedFrames.length - 1] * 100) / 100
          : 0,
        avgMs: Math.round(avgFrameTime * 100) / 100,
      },
    };
  };

  // Renderer Diagnostics implementation
  const getRendererDiagnostics = (): Box3DRenderDiagnostics => {
    const scene = game.sceneManager?.currentScene;
    if (scene?.renderer?.getBox3DDiagnostics) {
      return scene.renderer.getBox3DDiagnostics();
    }
    return {
      bitmapCacheHits: 0,
      bitmapCacheMisses: 0,
      totalVisibleFaces: 0,
      totalBspFragments: 0,
      totalStaticBitmapCommands: 0,
      totalSurfaceEntityCommands: 0,
      layers: [],
    };
  };

  const getBox3DProfile = (): Box3DRenderProfile =>
    game.sceneManager.currentScene?.renderer.getBox3DProfile() || {
      enabled: false,
      frames: 0,
      fragmentBuildCalls: 0,
      fragmentBuildMs: 0,
      fragmentRenderCalls: 0,
      fragmentRenderMs: 0,
      texturedFragments: 0,
      texturedFragmentMs: 0,
      textureMeshCells: 0,
      textureMeshBuildMs: 0,
      textureMeshBuildCalls: 0,
      textureMeshCacheHits: 0,
      textureTriangleCalls: 0,
      textureTriangleMs: 0,
      gridFragments: 0,
      gridFragmentMs: 0,
      gridPasses: 0,
      gridPreparationMs: 0,
      gridHomographyCalls: 0,
      gridLineSegments: 0,
    };

  const setBox3DProfilingEnabled = (enabled: boolean): void => {
    game.sceneManager.currentScene?.renderer.setBox3DProfilingEnabled(enabled);
  };

  const resetBox3DProfile = (): void => {
    game.sceneManager.currentScene?.renderer.resetBox3DProfile();
  };

  return {
    isAvailable: () => !isTauriRuntime(),
    modes: {
      getMode,
      setMode,
    },
    getMode,
    setMode,
    scenes: {
      load: loadScene,
    },
    objects: {
      listObjects,
      getObject,
      getObjectProperties,
      setObjectProperty,
      setObjectProperties,
    },
    settings: {
      getSettings,
      getSetting,
      setSetting,
      setSettings,
      saveSettings,
      loadSettings,
    },
    console: {
      isOpen: () => game.console?.isOpen ?? false,
      open: () => game.console?.setOpen(true),
      close: () => game.console?.setOpen(false),
      toggle: () => game.console?.toggle(),
      sendCommand,
      getMessages,
      clear: clearConsole,
      log: logToConsole,
    },
    performance: {
      sample: samplePerformance,
    },
    renderer: {
      getDiagnostics: getRendererDiagnostics,
      getBox3DProfile,
      setBox3DProfilingEnabled,
      resetBox3DProfile,
    },
  };
}
