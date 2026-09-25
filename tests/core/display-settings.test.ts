import { afterEach, describe, expect, it } from 'vitest';
import {
  createDefaultQuestSettings,
  loadQuestSettings,
  QUEST_SCREEN_MODES,
} from '../../src/core/displaySettings';
import {
  GAME_DESIGN_HEIGHT,
  GAME_DESIGN_WIDTH,
  getGameDesignResolution,
  setGameDesignResolution,
} from '../../src/core/Resolution';
import { getBox3DProjectionFocal } from '../../src/entities/Box3DObject';

afterEach(() => setGameDesignResolution(GAME_DESIGN_WIDTH, GAME_DESIGN_HEIGHT));

describe('Quest screen profile', () => {
  it('defaults to quest-420x300 and exposes all supported modes', () => {
    const settings = createDefaultQuestSettings();

    expect(settings.screenProfile.virtualScreen.modeId).toBe('quest-420x300');
    expect(QUEST_SCREEN_MODES.map((mode) => mode.id)).toEqual([
      'quest-420x300',
      'quest-800x600',
      'quest-1024x768',
    ]);
  });

  it('falls back to the default mode while retaining a canonical profile', () => {
    const defaults = createDefaultQuestSettings();
    const result = loadQuestSettings({
      screenProfile: {
        ...defaults.screenProfile,
        virtualScreen: { modeId: 'missing-mode' },
      },
    });

    expect(result.settings.screenProfile.virtualScreen.modeId).toBe('quest-420x300');
    expect(result.shouldPersist).toBe(false);
  });

  it('migrates legacy CRT settings without losing editor or audio settings', () => {
    const result = loadQuestSettings({
      resolution: '800x600',
      crt: {
        enabled: false,
        curvature: '0.25',
        scanlineCount: '300',
        scanlineIntensity: 0.4,
        aberration: 4,
        bloom: 0.2,
      },
      editor: { uiScale: 1.4, viewportZoom: '1.5' },
      audio: { attachedVolume: 0.75 },
    });

    expect(result.settings.screenProfile.virtualScreen.modeId).toBe('quest-800x600');
    expect(result.settings.screenProfile.crt.crtEmulation).toBe(false);
    expect(result.settings.screenProfile.crt.curvature).toBe(0.25);
    expect(result.settings.screenProfile.crt.scanlineCount).toBe(300);
    expect(result.settings.screenProfile.crt.aberration).toBe(0);
    expect(result.settings.editor.uiScale).toBe(1.4);
    expect(result.settings.audio.attachedVolume).toBe(0.75);
    expect(result.shouldPersist).toBe(true);
  });

  it('keeps a valid canonical profile instead of applying legacy CRT data', () => {
    const defaults = createDefaultQuestSettings();
    const result = loadQuestSettings({
      screenProfile: {
        ...defaults.screenProfile,
        virtualScreen: { modeId: 'quest-1024x768' },
        crt: { ...defaults.screenProfile.crt, crtEmulation: true },
      },
      crt: { enabled: false },
    });

    expect(result.settings.screenProfile.virtualScreen.modeId).toBe('quest-1024x768');
    expect(result.settings.screenProfile.crt.crtEmulation).toBe(true);
    expect(result.shouldPersist).toBe(false);
  });
});

describe('active Quest resolution', () => {
  it('updates Box3D focal calculations when the source mode changes', () => {
    setGameDesignResolution(1024, 768);

    expect(getGameDesignResolution()).toEqual({ width: 1024, height: 768 });
    expect(getBox3DProjectionFocal({ zoom: 1 })).toBe(1024);
  });
});
