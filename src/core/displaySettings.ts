import {
  defaultScreenProfile,
  normalizeProfile,
  type ScreenMode,
  type ScreenProfile,
} from 'scanline-virtual-screen/core';

export const QUEST_SCREEN_MODES: readonly ScreenMode[] = [
  { id: 'quest-420x300', label: '420 × 300', width: 420, height: 300 },
  { id: 'quest-800x600', label: '800 × 600', width: 800, height: 600 },
  { id: 'quest-1024x768', label: '1024 × 768', width: 1024, height: 768 },
];

export const DEFAULT_QUEST_SCREEN_MODE = QUEST_SCREEN_MODES[0];

export interface QuestSettings {
  screenProfile: ScreenProfile;
  editor: {
    uiScale: number;
    viewportZoom: 'fit' | '1' | '1.5' | '2';
  };
  audio: {
    attachedVolume: number;
  };
}

export function createDefaultQuestSettings(): QuestSettings {
  return {
    screenProfile: defaultScreenProfile(DEFAULT_QUEST_SCREEN_MODE.id),
    editor: { uiScale: 1.0, viewportZoom: 'fit' },
    audio: { attachedVolume: 1.0 },
  };
}

export function getQuestScreenMode(modeId: string): ScreenMode {
  return QUEST_SCREEN_MODES.find((mode) => mode.id === modeId) ?? DEFAULT_QUEST_SCREEN_MODE;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function findLegacyValue(loaded: Record<string, unknown>, key: string): unknown {
  return loaded[key] ?? asRecord(loaded.settings)?.[key];
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function legacyModeId(loaded: Record<string, unknown>): string {
  const candidates = [
    loaded.resolution,
    asRecord(loaded.display)?.resolution,
    asRecord(loaded.video)?.resolution,
    asRecord(loaded.settings)?.resolution,
  ];
  const value = candidates.find((candidate): candidate is string => typeof candidate === 'string');
  if (!value) return DEFAULT_QUEST_SCREEN_MODE.id;
  const normalized = value.trim().toLowerCase();
  const prefixed = normalized.startsWith('quest-') ? normalized : `quest-${normalized}`;
  return (
    QUEST_SCREEN_MODES.find((mode) => {
      const modeId = mode.id.toLowerCase();
      return modeId === normalized || modeId === prefixed;
    })?.id ?? DEFAULT_QUEST_SCREEN_MODE.id
  );
}

function isCanonicalProfile(value: unknown): value is Record<string, unknown> {
  const record = asRecord(value);
  return (
    !!record &&
    record.schemaVersion === 1 &&
    !!asRecord(record.virtualScreen) &&
    !!asRecord(record.terminal) &&
    !!asRecord(record.crt)
  );
}

function migrateLegacyProfile(
  legacyCrt: Record<string, unknown>,
  loaded: Record<string, unknown>,
  fallback: ScreenProfile
): ScreenProfile {
  const crt = { ...fallback.crt } as Record<string, unknown>;
  const numericKeys = [
    'curvature',
    'scanlineCount',
    'scanlineIntensity',
    'vignette',
    'phosphor',
    'bloom',
    'glow',
    'persistence',
    'beamModulation',
    'humBar',
    'breathing',
  ];
  for (const key of numericKeys) {
    const value = coerceNumber(legacyCrt[key]);
    if (value !== undefined) crt[key] = value;
  }
  for (const key of ['bezelGlow', 'antiAliasedPixels'] as const) {
    if (typeof legacyCrt[key] === 'boolean') crt[key] = legacyCrt[key];
  }
  if (typeof legacyCrt.enabled === 'boolean') crt.crtEmulation = legacyCrt.enabled;

  return (
    normalizeProfile(
      {
        schemaVersion: 1,
        virtualScreen: { modeId: legacyModeId(loaded) },
        terminal: fallback.terminal,
        crt,
      },
      fallback,
      QUEST_SCREEN_MODES
    ) ?? fallback
  );
}

export function loadQuestSettings(
  raw: unknown,
  defaults: QuestSettings = createDefaultQuestSettings()
): { settings: QuestSettings; shouldPersist: boolean } {
  const loaded = asRecord(raw);
  if (!loaded) return { settings: defaults, shouldPersist: false };

  const settings: QuestSettings = {
    screenProfile: defaults.screenProfile,
    editor: { ...defaults.editor },
    audio: { ...defaults.audio },
  };

  const canonicalCandidate = loaded.screenProfile ?? asRecord(loaded.settings)?.screenProfile;
  const canonical = isCanonicalProfile(canonicalCandidate)
    ? normalizeProfile(canonicalCandidate, defaults.screenProfile, QUEST_SCREEN_MODES)
    : null;
  const legacyCrt =
    asRecord(findLegacyValue(loaded, 'crt')) ?? asRecord(asRecord(loaded.graphics)?.crt);
  const useCanonical = !!canonical;
  settings.screenProfile =
    canonical ??
    (legacyCrt
      ? migrateLegacyProfile(legacyCrt, loaded, defaults.screenProfile)
      : defaults.screenProfile);

  const loadedEditor = asRecord(findLegacyValue(loaded, 'editor'));
  const uiScale = coerceNumber(loadedEditor?.uiScale);
  if (uiScale !== undefined) settings.editor.uiScale = uiScale;
  if (
    loadedEditor?.viewportZoom === 'fit' ||
    loadedEditor?.viewportZoom === '1' ||
    loadedEditor?.viewportZoom === '1.5' ||
    loadedEditor?.viewportZoom === '2'
  ) {
    settings.editor.viewportZoom = loadedEditor.viewportZoom;
  }
  const loadedAudio = asRecord(findLegacyValue(loaded, 'audio'));
  const attachedVolume = coerceNumber(loadedAudio?.attachedVolume);
  if (attachedVolume !== undefined) {
    settings.audio.attachedVolume = Math.max(0, Math.min(10, attachedVolume));
  }

  return { settings, shouldPersist: !useCanonical && !!legacyCrt };
}
