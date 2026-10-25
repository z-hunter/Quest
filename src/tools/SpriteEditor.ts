import type { IGame } from '../core/IGame';
import { useEditorStore } from '../store/editorStore';
import { Theme } from '../utils/Theme';
import { Game } from '../core/Game';
import { saveProjectFile, isTauriRuntime } from '../platform/fileApi';

export interface SpriteData {
  id: string; // Filename without extension
  imageFile: string;
  x: number;
  y: number;
  width: number;
  height: number;
  frames: number;
}

type SpriteEditorDrag =
  | { kind: 'pan'; last: { x: number; y: number } }
  | { kind: 'draw'; start: { x: number; y: number } }
  | {
      kind: 'scrollbar';
      axis: 'x' | 'y';
      start: number;
      pan: number;
      overflow: number;
      travel: number;
    }
  | {
      kind: 'move' | 'resize';
      start: { x: number; y: number };
      x: number;
      y: number;
      width: number;
      height: number;
    };

export class SpriteEditor {
  game: IGame;

  get active(): boolean {
    return useEditorStore.getState().spriteEditorEnabled;
  }

  set active(value: boolean) {
    useEditorStore.getState().toggleSpriteEditor(value);
  }

  // Data State
  sprite: SpriteData;
  isDirty: boolean = false;
  sourceImage: HTMLImageElement | null = null;

  // Rendering State
  checkerboardPattern: CanvasPattern | null = null;

  // Preview Settings
  previewSpeed: number = 200; // ms
  isPlaying: boolean = true;
  previewBg: 'black' | 'checker' | 'pink' = 'black';
  showRulers: boolean = false;
  private viewZoom = 1;
  private panX = 0;
  private panY = 0;
  private drag: SpriteEditorDrag | null = null;
  private boundWheelHandler: (e: WheelEvent) => void;
  private boundMouseDownHandler: (e: MouseEvent) => void;
  private boundContextMenuHandler: (e: MouseEvent) => void;
  private boundMouseMoveHandler: (e: MouseEvent) => void;
  private boundMouseUpHandler: (e: MouseEvent) => void;

  constructor(game: IGame) {
    this.game = game;

    // Default Sprite
    this.sprite = {
      id: 'new_sprite',
      imageFile: '',
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      frames: 1,
    };

    // Bind Global Keys
    // Bind Global Keys (Capture Phase on Document)
    // Using bind to ensure 'this' context and consistent reference
    this.boundKeyHandler = this.handleKey.bind(this);
    this.boundWheelHandler = this.handleWheel.bind(this);
    this.boundMouseDownHandler = this.handleMouseDown.bind(this);
    this.boundContextMenuHandler = this.handleContextMenu.bind(this);
    this.boundMouseMoveHandler = this.handleMouseMove.bind(this);
    this.boundMouseUpHandler = this.handleMouseUp.bind(this);
    document.addEventListener('keydown', this.boundKeyHandler, true);

    this.game.canvas.addEventListener('wheel', this.boundWheelHandler, {
      capture: true,
      passive: false,
    });
    this.game.canvas.addEventListener('mousedown', this.boundMouseDownHandler);
    this.game.canvas.addEventListener('contextmenu', this.boundContextMenuHandler, true);
    window.addEventListener('mousemove', this.boundMouseMoveHandler);
    window.addEventListener('mouseup', this.boundMouseUpHandler);
  }

  private boundKeyHandler: (e: KeyboardEvent) => void;

  destroy(): void {
    document.removeEventListener('keydown', this.boundKeyHandler, true);
    this.game.canvas.removeEventListener('wheel', this.boundWheelHandler, true);
    this.game.canvas.removeEventListener('mousedown', this.boundMouseDownHandler);
    this.game.canvas.removeEventListener('contextmenu', this.boundContextMenuHandler, true);
    window.removeEventListener('mousemove', this.boundMouseMoveHandler);
    window.removeEventListener('mouseup', this.boundMouseUpHandler);
    this.stopPreviewLoop();
  }

  toggle(force?: boolean): void {
    const newState = force !== undefined ? force : !this.active;
    this.active = newState;

    const parserInput = this.game.getCommandInput();

    if (this.active) {
      // Disable Parser Input to prevent game commands and focus stealing
      if (parserInput) {
        parserInput.blur();
        parserInput.disabled = true;
      }

      // Ensure checkerboard pattern is ready
      if (!this.checkerboardPattern) {
        this.createCheckerboard();
      }

      // Hide Scene Editor if open
      if (this.game.editor && this.game.editor.enabled) {
        this.game.editor.toggle();
      }

      this.updateUI();

      // Force immediate render after UI is mounted/visible (next tick)
      setTimeout(() => {
        this.updatePreviewCanvas();
      }, 50);
    } else {
      // Re-enable Parser
      if (parserInput) {
        parserInput.disabled = false;
        // Optional: focus it back? Maybe not if we just closed editor.
      }

      // Fix: Blur any active inputs to prevent them from swallowing keys after editor unmounts
      if (
        document.activeElement instanceof HTMLElement &&
        document.activeElement.id !== 'parser-input'
      ) {
        document.activeElement.blur();
      }

      // Fix: Reset UI mouse hover state in case editor was closed via hotkey while mouse was over it
      if (this.game) {
        this.game.isMouseOverUI = false;
      }
    }
  }

  // Removed dead initUI code (DOM bindings handled by React now)

  handleKey(e: KeyboardEvent): void {
    // HMR/Reload Protection:
    // If this editor belongs to an old Game instance (zombie), kill the listener.
    const globalGame = Game.instance;
    if (globalGame && (this.game as any) !== globalGame) {
      console.warn('[SpriteEditor] Detected Zombie Instance - Removing Listener');
      document.removeEventListener('keydown', this.boundKeyHandler, true);
      return;
    }

    // If not active, let it propagate (e.g. to SceneEditor)
    if (!this.active) return;

    const isInputFocused =
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement ||
      document.activeElement instanceof HTMLSelectElement;

    // AGGRESSIVE HOTKEY HANDLING
    // We check keys first and return immediately if handled, bypassing input focus checks for specific keys.

    if (e.ctrlKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this.promptLoadImage();
      return;
    }

    if (e.ctrlKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this.saveSprite();
      return;
    }

    if (e.altKey && !e.ctrlKey && e.code === 'KeyS') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this.promptLoadImage();
      return;
    }

    if (e.ctrlKey && e.key === 'F6') {
      if (!isTauriRuntime()) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        window.open('/vetool.html', '_blank');
        return;
      }
    }

    let handled = false;

    if (e.key === 'F1') {
      this.switchToSceneEditor();
      handled = true;
    } else if (e.key === 'F2') {
      if (e.shiftKey) {
        this.saveSprite(true); // Shift+F2 = Save As
      } else {
        this.saveSprite(false); // F2 = Smart Save
      }
      handled = true;
    } else if (e.key === 'F3') {
      this.loadSprite();
      handled = true;
    } else if (e.key === 'F4') {
      this.newSprite();
      handled = true;
    } else if (e.key === 'F5') {
      this.toggle(false);
      handled = true;
    } else if (e.key === 'F6') {
      if (this.isDirty) {
        if (!window.confirm('You have unsaved sprite edits. Are you sure you want to leave?')) {
          handled = true;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          return;
        }
      }
      window.location.href = '/vetool.html';
      handled = true;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }

    // Only now do we respect input focus for other keys
    if (isInputFocused) return;
  }

  switchToSceneEditor(): void {
    this.toggle(false);
    if (this.game.editor && !this.game.editor.enabled) this.game.editor.toggle();
  }

  updateUI(): void {
    useEditorStore.getState().incrementSpriteVersion();
    this.updatePreview();
  }

  private getCanvasPos(e: MouseEvent | WheelEvent): { x: number; y: number } {
    const rect = this.game.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * this.game.canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * this.game.canvas.height,
    };
  }

  private getViewport() {
    const canvas = this.game.canvas;
    return { x: 0, y: 16, width: canvas.width - 16, height: canvas.height - 32 };
  }

  private getImageView() {
    if (!this.sourceImage?.width || !this.sourceImage.height) return null;
    const viewport = this.getViewport();
    const fit = Math.min(
      viewport.width / this.sourceImage.width,
      viewport.height / this.sourceImage.height
    );
    const scale = fit * this.viewZoom;
    const width = this.sourceImage.width * scale;
    const height = this.sourceImage.height * scale;
    return {
      viewport,
      scale,
      x: viewport.x + (viewport.width - width) / 2 + this.panX,
      y: viewport.y + (viewport.height - height) / 2 + this.panY,
      width,
      height,
    };
  }

  private getScrollbar(
    view: NonNullable<ReturnType<SpriteEditor['getImageView']>>,
    axis: 'x' | 'y'
  ) {
    const horizontal = axis === 'x';
    const imageSize = horizontal ? view.width : view.height;
    const viewportSize = horizontal ? view.viewport.width : view.viewport.height;
    if (imageSize <= viewportSize + 1) return null;
    const trackStart = horizontal ? view.viewport.x : view.viewport.y;
    const trackSize = viewportSize;
    const thumbSize = Math.min(trackSize, Math.max(24, (viewportSize / imageSize) * trackSize));
    const overflow = imageSize - viewportSize;
    const travel = trackSize - thumbSize;
    if (travel <= 0) return null;
    const pan = horizontal ? this.panX : this.panY;
    const thumbStart = trackStart + ((overflow / 2 - pan) / overflow) * travel;
    return {
      x: horizontal ? thumbStart : view.viewport.x + view.viewport.width + 4,
      y: horizontal ? view.viewport.y + view.viewport.height + 5 : thumbStart,
      width: horizontal ? thumbSize : 6,
      height: horizontal ? 6 : thumbSize,
      trackStart,
      overflow,
      travel,
    };
  }

  private clampPan(): void {
    const view = this.getImageView();
    if (!view) return;
    const maxX = Math.max(0, (view.width - view.viewport.width) / 2);
    const maxY = Math.max(0, (view.height - view.viewport.height) / 2);
    this.panX = Math.max(-maxX, Math.min(maxX, this.panX));
    this.panY = Math.max(-maxY, Math.min(maxY, this.panY));
  }

  private handleWheel(e: WheelEvent): void {
    if (!this.active) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!this.sourceImage) return;

    const pos = this.getCanvasPos(e);
    const view = this.getImageView();
    if (!view) return;
    const zoom = Math.max(1, Math.min(10, this.viewZoom * Math.exp(-e.deltaY * 0.001)));
    const ratio = zoom / this.viewZoom;
    this.panX =
      pos.x -
      view.viewport.x -
      view.viewport.width / 2 -
      (pos.x - view.viewport.x - view.viewport.width / 2 - this.panX) * ratio;
    this.panY =
      pos.y -
      view.viewport.y -
      view.viewport.height / 2 -
      (pos.y - view.viewport.y - view.viewport.height / 2 - this.panY) * ratio;
    this.viewZoom = zoom;
    this.clampPan();
  }

  private handleMouseDown(e: MouseEvent): void {
    if (!this.active || !this.sourceImage) return;
    const pos = this.getCanvasPos(e);
    if (e.button === 2) {
      this.drag = { kind: 'pan', last: pos };
    } else if (e.button === 0) {
      const view = this.getImageView();
      if (!view) return;
      const scrollbars = (['x', 'y'] as const)
        .map((axis) => ({ axis, bar: this.getScrollbar(view, axis) }))
        .find(
          ({ bar }) =>
            bar &&
            pos.x >= bar.x &&
            pos.x <= bar.x + bar.width &&
            pos.y >= bar.y &&
            pos.y <= bar.y + bar.height
        );
      if (scrollbars?.bar) {
        const axis = scrollbars.axis;
        this.drag = {
          kind: 'scrollbar',
          axis,
          start: axis === 'x' ? pos.x : pos.y,
          pan: axis === 'x' ? this.panX : this.panY,
          overflow: scrollbars.bar.overflow,
          travel: scrollbars.bar.travel,
        };
      } else {
        const frame = {
          x: view.x + this.sprite.x * view.scale,
          y: view.y + this.sprite.y * view.scale,
          width: this.sprite.width * view.scale,
          height: this.sprite.height * view.scale,
        };
        const start = {
          x: (pos.x - view.x) / view.scale,
          y: (pos.y - view.y) / view.scale,
        };
        const handleSize = 12;
        const nearHandle =
          Math.abs(pos.x - (frame.x + frame.width)) <= handleSize &&
          Math.abs(pos.y - (frame.y + frame.height)) <= handleSize;
        const onSecondaryFrame = Array.from({ length: Math.max(0, this.sprite.frames - 1) }).some(
          (_, index) => {
            const y = view.y + (this.sprite.y + (index + 1) * this.sprite.height) * view.scale;
            return (
              pos.x >= frame.x &&
              pos.x <= frame.x + frame.width &&
              pos.y >= y &&
              pos.y <= y + frame.height
            );
          }
        );
        const onImage =
          pos.x >= view.x &&
          pos.x <= view.x + view.width &&
          pos.y >= view.y &&
          pos.y <= view.y + view.height;
        if (
          !onSecondaryFrame &&
          (nearHandle ||
            (pos.x >= frame.x &&
              pos.x <= frame.x + frame.width &&
              pos.y >= frame.y &&
              pos.y <= frame.y + frame.height))
        ) {
          this.drag = {
            kind: nearHandle ? 'resize' : 'move',
            start,
            x: this.sprite.x,
            y: this.sprite.y,
            width: this.sprite.width,
            height: this.sprite.height,
          };
        } else if (!onSecondaryFrame && onImage) {
          this.drag = {
            kind: 'draw',
            start: {
              x: Math.max(0, Math.min(this.sourceImage.width, (pos.x - view.x) / view.scale)),
              y: Math.max(0, Math.min(this.sourceImage.height, (pos.y - view.y) / view.scale)),
            },
          };
        }
      }
    }
    if (this.drag) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  private handleContextMenu(e: MouseEvent): void {
    if (!this.active) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.active) return;
    const pos = this.getCanvasPos(e);
    const view = this.getImageView();
    const overScrollbar =
      !!view &&
      (['x', 'y'] as const).some((axis) => {
        const bar = this.getScrollbar(view, axis);
        return (
          !!bar &&
          pos.x >= bar.x &&
          pos.x <= bar.x + bar.width &&
          pos.y >= bar.y &&
          pos.y <= bar.y + bar.height
        );
      });
    this.game.canvas.style.cursor =
      this.drag?.kind === 'scrollbar' ? 'grabbing' : overScrollbar ? 'pointer' : '';
    if (!this.drag) return;
    if (this.drag.kind === 'pan') {
      this.panX += pos.x - this.drag.last.x;
      this.panY += pos.y - this.drag.last.y;
      this.drag.last = pos;
      this.clampPan();
      return;
    }
    if (this.drag.kind === 'scrollbar') {
      const coordinate = this.drag.axis === 'x' ? pos.x : pos.y;
      const pan =
        this.drag.pan - ((coordinate - this.drag.start) / this.drag.travel) * this.drag.overflow;
      if (this.drag.axis === 'x') this.panX = pan;
      else this.panY = pan;
      this.clampPan();
      return;
    }
    if (!view || !this.sourceImage) return;
    const local = {
      x: (pos.x - view.x) / view.scale,
      y: (pos.y - view.y) / view.scale,
    };
    if (this.drag.kind === 'draw') {
      const x = Math.max(0, Math.min(this.sourceImage.width, local.x));
      const y = Math.max(0, Math.min(this.sourceImage.height, local.y));
      this.sprite.x = Math.floor(Math.min(this.drag.start.x, x));
      this.sprite.y = Math.floor(Math.min(this.drag.start.y, y));
      this.sprite.width = Math.max(1, Math.floor(Math.abs(x - this.drag.start.x)));
      this.sprite.height = Math.max(
        1,
        Math.min(
          Math.floor(Math.abs(y - this.drag.start.y)),
          Math.floor((this.sourceImage.height - this.sprite.y) / Math.max(1, this.sprite.frames))
        )
      );
      this.isDirty = true;
      this.updateUI();
      return;
    }
    const dx = local.x - this.drag.start.x;
    const dy = local.y - this.drag.start.y;
    if (this.drag.kind === 'move') {
      this.sprite.x = Math.max(
        0,
        Math.min(this.sourceImage.width - this.drag.width, Math.round(this.drag.x + dx))
      );
      this.sprite.y = Math.max(
        0,
        Math.min(
          Math.floor(this.sourceImage.height - this.drag.height * Math.max(1, this.sprite.frames)),
          Math.round(this.drag.y + dy)
        )
      );
    } else {
      this.sprite.width = Math.max(
        1,
        Math.min(this.sourceImage.width - this.drag.x, Math.round(this.drag.width + dx))
      );
      this.sprite.height = Math.max(
        1,
        Math.min(
          Math.floor((this.sourceImage.height - this.drag.y) / Math.max(1, this.sprite.frames)),
          Math.round(this.drag.height + dy)
        )
      );
    }
    this.isDirty = true;
    this.updateUI();
  }

  private handleMouseUp(): void {
    this.drag = null;
  }

  // Animation State
  public currentFrame: number = 0;
  private lastFrameTime: number = 0;
  private animationInterval: number | null = null;

  startPreviewLoop(): void {
    if (this.animationInterval) return; // Already running

    const loop = (timestamp: number) => {
      if (!this.active) {
        this.animationInterval = null;
        return;
      }

      // Always request next frame to keep loop alive
      this.animationInterval = requestAnimationFrame(loop);

      if (this.isPlaying) {
        // Update Frame based on variable speed
        if (timestamp - this.lastFrameTime > this.previewSpeed) {
          this.currentFrame = (this.currentFrame + 1) % (this.sprite.frames || 1);
          this.lastFrameTime = timestamp;
          this.updatePreviewCanvas();
          // Sync UI slider if needed? Usually controlled components update from Model.
          // We might need to force UI update if Slider needs to move automatically.
          // But for performance, maybe just let Canvas update.
          // If user wants to see Slider move, we need to trigger React update.
          // Let's rely on Canvas for playback visualization, Slider for manual control.
          useEditorStore.getState().incrementSpriteVersion();
        }
      }
    };

    this.animationInterval = requestAnimationFrame(loop);
  }

  togglePlay(playing?: boolean): void {
    this.isPlaying = playing !== undefined ? playing : !this.isPlaying;
    if (this.isPlaying) {
      this.startPreviewLoop();
    }
    // If paused, we don't kill the loop necessarily, but logic inside stops updating.
    this.updateUI();
  }

  setFrame(frame: number): void {
    this.currentFrame = Math.max(0, Math.min(frame, (this.sprite.frames || 1) - 1));
    this.updatePreviewCanvas();
    this.updateUI();
  }

  stopPreviewLoop(): void {
    if (this.animationInterval) {
      cancelAnimationFrame(this.animationInterval);
      this.animationInterval = null;
    }
  }

  updatePreview(): void {
    // Called when UI changes (e.g. user types new W/H)
    // We just ensure the cycle continues or resets if frames changed
    // Real rendering is done in loop.

    // Ensure loop is running if active
    if (this.active && !this.animationInterval) {
      this.startPreviewLoop();
    }

    // Immediate redraw for responsiveness
    this.updatePreviewCanvas();
  }

  updatePreviewCanvas(): void {
    const canvas = document.getElementById('se-preview-canvas') as HTMLCanvasElement;
    if (canvas) {
      // Force 250x250 to ensure buffer matches visual size
      if (canvas.width !== 250) canvas.width = 250;
      if (canvas.height !== 250) canvas.height = 250;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Clear
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw Background
      if (this.previewBg === 'black') {
        ctx.fillStyle = Theme.backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else if (this.previewBg === 'pink') {
        ctx.fillStyle = '#ff00ff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else if (this.previewBg === 'checker') {
        if (!this.checkerboardPattern) this.createCheckerboard();
        if (this.checkerboardPattern) {
          ctx.fillStyle = this.checkerboardPattern;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      }

      // Draw Rulers (Behind Sprite)
      if (this.showRulers) {
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        ctx.strokeStyle = '#00ffff'; // Cyan
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, canvas.height);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(canvas.width, cy);
        ctx.stroke();
      }

      if (this.sourceImage && this.sourceImage.src) {
        // Use sprite dimensions
        if (this.sprite.width <= 0 || this.sprite.height <= 0) return;

        // Determine scale to fit in current canvas container (200x200) WITH PADDING
        const padding = 10;
        const availW = canvas.width - padding * 2;
        const availH = canvas.height - padding * 2;

        // Calculate Scale needed for Width and Height separately
        const scaleW = availW / this.sprite.width;
        const scaleH = availH / this.sprite.height;

        // Use the SMALLER scale to ensure entire sprite fits (Letterboxing)
        const scale = Math.min(scaleW, scaleH);

        // Center the sprite in the canvas (250x250)
        const drawW = this.sprite.width * scale;
        const drawH = this.sprite.height * scale;

        const destX = (canvas.width - drawW) / 2;
        const destY = (canvas.height - drawH) / 2;

        // Source Rect (Current Frame)
        const sx = this.sprite.x;
        const sy = this.sprite.y + this.currentFrame * this.sprite.height;
        const sw = this.sprite.width;
        const sh = this.sprite.height;

        // Disable smoothing for pixel art
        ctx.imageSmoothingEnabled = false;

        try {
          ctx.drawImage(this.sourceImage, sx, sy, sw, sh, destX, destY, drawW, drawH);
        } catch (_e) {
          // Image might not be fully loaded or broken coords
        }

        canvas.style.display = 'block';
      } else {
        canvas.style.display = 'none';
      }
    }
  }

  promptLoadImage(): void {
    this.game.openFileBrowser(
      'load',
      'public/assets',
      (file) => {
        // FileBrowser returns just the filename (e.g. 'hero.png')
        // We need to construct the path relative to project root or public
        // If the file string doesn't include the dir, add it.
        // Assuming FileBrowser returns simple filename from the list.

        // Construct full path
        // If dir is 'public/assets', we want 'public/assets/hero.png'
        // (which loadImage will then convert to '/assets/hero.png')

        const fullPath = `public/assets/${file}`;
        this.loadImage(fullPath);
      },
      '.png'
    );
  }

  loadImage(path: string, keepDimensions: boolean = false): void {
    // Convert local path to relative.
    // The FileBrowser returns "public/assets/foo.png".
    // In Vite, "public/" is the root. So we should request "/assets/foo.png".

    // Strip 'public/' from start if present
    let src = path;
    if (src.startsWith('public/')) {
      src = '/' + src.substring(7); // Remove 'public/'
    }

    // If it starts with 'assets', ensure it has a Slash
    if (!src.startsWith('/') && !src.startsWith('http')) {
      src = '/' + src;
    }

    this.sprite.imageFile = path; // Keep original path in data
    this.viewZoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.drag = null;
    if (!keepDimensions) {
      this.isDirty = true;
    }
    this.sourceImage = new Image();
    this.sourceImage.src = src;
    this.sourceImage.onload = () => {
      // Auto-resize sprite logic requested by user
      // Unless we are loading an existing sprite (keepDimensions = true)
      // or if we are editing an existing sprite, we generally keep W/H unless user loads NEW image manually.

      // Logic:
      // If keepDimensions is TRUE, do not touch width/height.
      // If keepDimensions is FALSE:
      //    If ID is 'new_sprite', we overwrite W/H (First load).
      //    If User manually loaded an image (via button), we might want to reset W/H or keep?
      //    Let's assume if manual load (keepDimensions false), we overwrite if it's 'new_sprite' OR maybe always?
      //    Actually, if user replaces image, they probably want full size initially if frame count is 1.

      if (!keepDimensions) {
        // Only overwrite if it looks like a "new" operation or explicit user load
        // For now, let's stick to the previous logic but respect the flag.
        if (this.sprite.id === 'new_sprite' || this.sprite.frames === 1) {
          if (this.sourceImage) {
            this.sprite.width = this.sourceImage.width;
            this.sprite.height = this.sourceImage.height;
          }
        }

        // Update ID to match filename (without extension)
        // e.g. /assets/hero.png -> hero
        const filename = src.split('/').pop() || 'sprite';
        const id = filename.split('.')[0];
        this.sprite.id = id;
      }

      this.updateUI();
    };
    this.sourceImage.onerror = (e) => {
      console.error(`[SpriteEditor] Failed to load image: ${src}`, e);
    };
  }

  saveSprite(forceSaveAs: boolean = false): void {
    // Validation:
    // If forceSaveAs is FALSE and I have a valid ID, save directly.
    // Allow backslashes in ID now
    const id = this.sprite.id.trim();
    const isValidId = id && id !== 'new_sprite' && !id.includes('.');

    if (!forceSaveAs && isValidId) {
      // Smart Save
      // Convert ID to filename path: chars\hero -> chars/hero.json
      const filename = `${id.replace(/\\/g, '/')}.json`;
      this.doSave(filename);
      return;
    }

    // Save As / Fallback
    this.game.openFileBrowser('save', 'public/sprites', (file) => {
      // Derive ID from path: chars/hero.json -> chars\hero
      // file path is used directly below
      // Actually use it or remove it. If logic below doesn't use it, remove.
      // But looking at error: 'name' is declared but never read.
      // I'll just comment it out or remove it.
      // Wait, file from browser might be "chars/hero.json" if we navigated.
      // We need to respect the full relative path returned.

      // Check if file contains separate path parts
      // FileBrowser returns relative path from 'public/sprites' if we are deeper?
      // Actually FileBrowser logic constructs relative path from root of search.

      // Let's assume 'file' is the relative path we want to save to.
      this.doSave(file);

      // Update ID to match the save path
      const newId = file.replace('.json', '').replace(/\//g, '\\');
      this.sprite.id = newId;
      this.updateUI();
    });
  }

  async doSave(filename: string): Promise<void> {
    // Ensure filename has .json
    if (!filename.toLowerCase().endsWith('.json')) filename += '.json';

    // Normalize path separators
    const normalizedFilename = filename.replace(/\\/g, '/');

    const filePath = `public/sprites/${normalizedFilename}`;

    const data = JSON.stringify(this.sprite, null, 2);

    // Take snapshot of current state
    const savedData = data;

    try {
      await saveProjectFile(filePath, data);

      // Only clear dirty if the sprite hasn't changed since we started saving
      if (JSON.stringify(this.sprite, null, 2) === savedData) {
        this.isDirty = false;
      }

      // Use Toast Message instead of Alert
      this.game.showNotification?.(`Sprite saved as ${normalizedFilename}`);
    } catch (e) {
      console.error('[SpriteEditor] Failed to save sprite:', e);
      this.game.showNotification?.(`Error saving sprite: ${e}`);
    }
  }

  loadSprite(): void {
    this.game.openFileBrowser('load', 'public/sprites', (file) => {
      // Construct path. FileBrowser returns relative path like "sub/file.json"
      const dir = 'public/sprites';
      const path = `/${dir.replace('public/', '')}/${file}`;

      fetch(path)
        .then((res) => {
          if (!res.ok) throw new Error('Fetch failed');
          return res.json();
        })
        .then((data) => {
          this.sprite = data;
          this.isDirty = false;

          // Sync ID with filename path (sub/file -> sub\file)
          const id = file.replace('.json', '').replace(/\//g, '\\');
          this.sprite.id = id;

          if (this.sprite.imageFile) {
            // PASS TRUE to preserve dimensions from JSON
            this.loadImage(this.sprite.imageFile, true);
          }
          this.updateUI();
        })
        .catch((err) => {
          console.error('Failed to load sprite json', err);
          alert('Failed to load sprite. Ensure it is accessible via URL.');
        });
    });
  }

  newSprite(): void {
    this.sprite = {
      id: 'new_sprite',
      imageFile: '',
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      frames: 1,
    };
    this.isDirty = false;
    this.sourceImage = null;
    this.viewZoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.drag = null;
    this.updateUI();
  }

  createCheckerboard(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 20;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ccc';
      ctx.fillRect(0, 0, 20, 20);
      ctx.fillStyle = '#999';
      ctx.fillRect(0, 0, 10, 10);
      ctx.fillRect(10, 10, 10, 10);
      this.checkerboardPattern = this.game.ctx?.createPattern(canvas, 'repeat') || null;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.active) return;

    ctx.save();

    // Ensure opacity
    ctx.globalAlpha = 1.0;

    // Ensure checkerboard pattern exists (fallback if init failed)
    if (!this.checkerboardPattern) {
      this.createCheckerboard();
    }

    // Fill background (Dark Grey usually, but checkerboard handles it)
    if (this.checkerboardPattern) {
      ctx.fillStyle = this.checkerboardPattern;
      ctx.fillRect(0, 0, this.game.canvas.width, this.game.canvas.height);
    } else {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, this.game.canvas.width, this.game.canvas.height);
    }

    // Draw Source Image
    if (this.sourceImage && this.sourceImage.complete && this.sourceImage.naturalWidth > 0) {
      this.clampPan();
      const view = this.getImageView()!;
      ctx.save();
      ctx.beginPath();
      ctx.rect(view.viewport.x, view.viewport.y, view.viewport.width, view.viewport.height);
      ctx.clip();
      ctx.drawImage(this.sourceImage, view.x, view.y, view.width, view.height);

      for (let i = 0; i < this.sprite.frames; i++) {
        const sx = view.x + this.sprite.x * view.scale;
        const sy = view.y + (this.sprite.y + i * this.sprite.height) * view.scale;
        const sw = this.sprite.width * view.scale;
        const sh = this.sprite.height * view.scale;
        ctx.strokeStyle = i === 0 ? Theme.mainColor : '#f2b84b';
        ctx.lineWidth = i === 0 ? 2 : 1;
        ctx.strokeRect(sx, sy, sw, sh);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(`${i}`, sx + 2, sy + 12);
        if (i === 0) {
          ctx.fillRect(sx + sw - 5, sy + sh - 5, 10, 10);
        }
      }
      ctx.restore();

      for (const axis of ['x', 'y'] as const) {
        const bar = this.getScrollbar(view, axis);
        if (!bar) continue;
        const horizontal = axis === 'x';
        ctx.fillStyle = '#252525';
        ctx.fillRect(
          horizontal ? view.viewport.x : view.viewport.x + view.viewport.width + 4,
          horizontal ? view.viewport.y + view.viewport.height + 5 : view.viewport.y,
          horizontal ? view.viewport.width : 6,
          horizontal ? 6 : view.viewport.height
        );
        ctx.fillStyle = Theme.mainColor;
        ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#000';
        ctx.strokeRect(bar.x, bar.y, bar.width, bar.height);
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(bar.x - 1, bar.y - 1, bar.width + 2, bar.height + 2);
      }

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, this.game.canvas.width, 15);
      ctx.fillStyle = '#fff';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const filename = this.sprite.imageFile.split('/').pop() || 'image';
      ctx.fillText(
        `${filename} (${this.sourceImage.width}x${this.sourceImage.height})`,
        this.game.canvas.width / 2,
        8
      );
    }

    ctx.restore();
  }
}
