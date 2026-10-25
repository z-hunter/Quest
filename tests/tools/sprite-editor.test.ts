import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../../src/core/Game';
import { SpriteEditor } from '../../src/tools/SpriteEditor';
import { useEditorStore } from '../../src/store/editorStore';

describe('SpriteEditor direct manipulation', () => {
  let game: any;
  let editor: SpriteEditor;
  let previousGame: typeof Game.instance;

  beforeEach(() => {
    previousGame = Game.instance;
    vi.stubGlobal('document', {
      activeElement: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getElementById: vi.fn(() => null),
    });
    vi.stubGlobal('window', { addEventListener: vi.fn() });
    vi.stubGlobal('HTMLInputElement', class {});
    vi.stubGlobal('HTMLTextAreaElement', class {});
    vi.stubGlobal('HTMLSelectElement', class {});
    useEditorStore.setState({ spriteEditorEnabled: true });
    game = {
      canvas: {
        width: 800,
        height: 600,
        style: { cursor: '' },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      },
    };
    (window as any).removeEventListener = vi.fn();
    Game.instance = game;
    editor = new SpriteEditor(game);
    vi.spyOn(editor, 'updateUI').mockImplementation(() => {});
    editor.sourceImage = {
      width: 400,
      height: 200,
      naturalWidth: 400,
      complete: true,
    } as HTMLImageElement;
  });

  afterEach(() => {
    Game.instance = previousGame;
    useEditorStore.setState({ spriteEditorEnabled: false });
    vi.unstubAllGlobals();
  });

  it('opens the image picker with Alt+S', () => {
    const picker = vi.spyOn(editor, 'promptLoadImage').mockImplementation(() => {});
    const event = {
      key: 's',
      code: 'KeyS',
      altKey: true,
      ctrlKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    editor.handleKey(event);

    expect(picker).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('removes its canvas and window listeners when destroyed', () => {
    editor.destroy();

    expect(game.canvas.removeEventListener).toHaveBeenCalledWith(
      'wheel',
      expect.any(Function),
      true
    );
    expect(game.canvas.removeEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function));
    expect(window.removeEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(window.removeEventListener).toHaveBeenCalledWith('mouseup', expect.any(Function));
  });

  it('zooms at the pointer and consumes the wheel event', () => {
    const event = {
      clientX: 400,
      clientY: 300,
      deltaY: -500,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as WheelEvent;

    (editor as any).handleWheel(event);

    expect((editor as any).viewZoom).toBeGreaterThan(1);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it('does not zoom out past the fit-to-workspace size', () => {
    const event = {
      clientX: 400,
      clientY: 300,
      deltaY: 100_000,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as WheelEvent;

    (editor as any).handleWheel(event);

    expect((editor as any).viewZoom).toBe(1);
  });

  it('pans an enlarged image with the right mouse button', () => {
    (editor as any).viewZoom = 2;
    const mouse = (clientX: number, clientY: number, button: number) =>
      ({
        clientX,
        clientY,
        button,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      }) as unknown as MouseEvent;

    (editor as any).handleMouseDown(mouse(400, 300, 2));
    (editor as any).handleMouseMove(mouse(450, 320, 0));

    expect((editor as any).panX).toBe(50);
    expect((editor as any).panY).toBe(20);
  });

  it('drags the scrollbar thumb to pan the enlarged image', () => {
    (editor as any).viewZoom = 2;
    const view = (editor as any).getImageView();
    const bar = (editor as any).getScrollbar(view, 'x');
    const mouse = (clientX: number, clientY: number) =>
      ({
        clientX,
        clientY,
        button: 0,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      }) as unknown as MouseEvent;

    (editor as any).handleMouseDown(mouse(bar.x + bar.width / 2, bar.y + 2));
    (editor as any).handleMouseMove(mouse(bar.x + bar.width / 2 + 40, bar.y + 2));

    expect((editor as any).panX).toBeLessThan(0);
  });

  it('keeps the vertical scrollbar thumb aligned with the visible image edge', () => {
    (editor as any).viewZoom = 2;
    const view = (editor as any).getImageView();
    const maxPanY = (view.height - view.viewport.height) / 2;

    (editor as any).panY = maxPanY;
    const topBar = (editor as any).getScrollbar(view, 'y');
    expect(topBar.y).toBe(view.viewport.y);

    (editor as any).panY = -maxPanY;
    const bottomBar = (editor as any).getScrollbar(view, 'y');
    expect(bottomBar.y).toBeCloseTo(view.viewport.y + bottomBar.travel);
  });

  it('hides scrollbars when the image fits within rounding tolerance or the thumb cannot travel', () => {
    const view = {
      width: 800.5,
      height: 200,
      viewport: { x: 0, y: 0, width: 800, height: 600 },
    };
    expect((editor as any).getScrollbar(view, 'x')).toBeNull();

    view.width = 100;
    view.viewport.width = 20;
    expect((editor as any).getScrollbar(view, 'x')).toBeNull();
  });

  it('shows a hand cursor when hovering over a scrollbar thumb', () => {
    (editor as any).viewZoom = 2;
    const view = (editor as any).getImageView();
    const bar = (editor as any).getScrollbar(view, 'y');
    const mouse = (clientX: number, clientY: number) =>
      ({ clientX, clientY }) as unknown as MouseEvent;

    (editor as any).handleMouseMove(mouse(bar.x + 2, bar.y + bar.height / 2));
    expect(game.canvas.style.cursor).toBe('pointer');

    (editor as any).handleMouseMove(mouse(400, 300));
    expect(game.canvas.style.cursor).toBe('');
  });

  it('moves and resizes the first animation frame from the workspace', () => {
    const mouse = (clientX: number, clientY: number, button = 0) =>
      ({
        clientX,
        clientY,
        button,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      }) as unknown as MouseEvent;

    editor.sprite.frames = 2;
    (editor as any).handleMouseDown(mouse(39, 198));
    (editor as any).handleMouseMove(mouse(59, 218));
    (editor as any).handleMouseUp();
    expect(editor.sprite.x).toBe(0);
    expect(editor.sprite.y).toBe(0);

    editor.sprite.frames = 1;
    (editor as any).handleMouseDown(mouse(39, 135));
    (editor as any).handleMouseMove(mouse(59, 155));
    (editor as any).handleMouseUp();
    expect(editor.sprite.x).toBe(10);
    expect(editor.sprite.y).toBe(10);

    editor.sprite.x = 20;
    editor.sprite.y = 10;
    editor.sprite.width = 40;
    editor.sprite.height = 30;
    (editor as any).handleMouseDown(mouse(126, 182));
    (editor as any).handleMouseMove(mouse(146, 202));
    (editor as any).handleMouseUp();
    expect(editor.sprite.width).toBe(50);
    expect(editor.sprite.height).toBe(40);
  });

  it('draws a new first-frame selection with a left-button drag', () => {
    const mouse = (clientX: number, clientY: number) =>
      ({
        clientX,
        clientY,
        button: 0,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      }) as unknown as MouseEvent;

    (editor as any).handleMouseDown(mouse(392, 281));
    (editor as any).handleMouseMove(mouse(569, 360));
    (editor as any).handleMouseUp();

    expect(editor.sprite.x).toBe(200);
    expect(editor.sprite.y).toBe(90);
    expect(editor.sprite.width).toBe(90);
    expect(editor.sprite.height).toBe(40);
  });
});
