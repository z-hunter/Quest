import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../../src/core/Game';
import { createDefaultQuestSettings } from '../../src/core/displaySettings';
import {
  GAME_DESIGN_HEIGHT,
  GAME_DESIGN_WIDTH,
  getGameDesignResolution,
  setGameDesignResolution,
} from '../../src/core/Resolution';

afterEach(() => setGameDesignResolution(GAME_DESIGN_WIDTH, GAME_DESIGN_HEIGHT));

describe('Game SVS display lifecycle', () => {
  it('renders the source through the same virtual screen instance after profile changes', () => {
    const virtualScreen = { render: vi.fn(), clearPersistence: vi.fn(), dispose: vi.fn() };
    const source = { width: 420, height: 300 };
    const settings = createDefaultQuestSettings();
    const game = {
      ctx: {
        fillStyle: '',
        font: '',
        fillRect: vi.fn(),
        fillText: vi.fn(),
      },
      bufferCanvas: source,
      sceneManager: { render: vi.fn() },
      renderUI: vi.fn(),
      virtualScreen,
      settings,
      canvas: { width: 420, height: 300 },
      uiCtx: { clearRect: vi.fn() },
      editorOverlayCtx: null,
      editorOverlayCanvas: null,
      spriteEditor: { active: false },
      editor: { render: vi.fn() },
    } as any;

    Game.prototype.render.call(game);
    const renderer = game.virtualScreen;
    game.settings.screenProfile.crt.crtEmulation = false;
    Game.prototype.render.call(game);

    expect(game.virtualScreen).toBe(renderer);
    expect(virtualScreen.render).toHaveBeenCalledTimes(2);
    expect(virtualScreen.render.mock.calls[1][0]).toBe(source);
    expect(virtualScreen.render.mock.calls[1][3]).toBe(true);
  });

  it('clears SVS persistence only when output size changes and disposes once', () => {
    const rendererCanvas = { width: 420, height: 300 };
    const virtualScreen = { render: vi.fn(), clearPersistence: vi.fn(), dispose: vi.fn() };
    const game = {
      rendererCanvas,
      virtualScreen,
      isRunning: true,
      stop: Game.prototype.stop,
      editor: { destroy: vi.fn() },
      input: { destroy: vi.fn() },
    } as any;

    Game.prototype.resize.call(game, 420, 300);
    Game.prototype.resize.call(game, 800, 600);
    Game.prototype.destroy.call(game);

    expect(virtualScreen.clearPersistence).toHaveBeenCalledTimes(1);
    expect(virtualScreen.dispose).toHaveBeenCalledTimes(1);
    expect(game.virtualScreen).toBeNull();
    expect(game.isRunning).toBe(false);
  });

  it('switches the source buffer and active resolution without recreating SVS', () => {
    const settings = createDefaultQuestSettings();
    const virtualScreen = { clearPersistence: vi.fn() };
    const game = {
      settings,
      bufferCanvas: {
        width: GAME_DESIGN_WIDTH,
        height: GAME_DESIGN_HEIGHT,
        getContext: vi.fn(() => ({ imageSmoothingEnabled: true })),
      },
      virtualScreen,
    } as any;

    Game.prototype.setScreenProfile.call(game, {
      ...settings.screenProfile,
      virtualScreen: { modeId: 'quest-800x600' },
    });

    expect(game.bufferCanvas.width).toBe(800);
    expect(game.bufferCanvas.height).toBe(600);
    expect(getGameDesignResolution()).toEqual({ width: 800, height: 600 });
    expect(virtualScreen.clearPersistence).toHaveBeenCalledTimes(1);
  });
});
