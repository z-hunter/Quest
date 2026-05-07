export class Input {
  game: any; // Using any to avoid circular dependency for now
  canvas: HTMLCanvasElement;
  mouse: { x: number; y: number; clicked: boolean };
  keys: { [key: string]: boolean };
  private listenersAttached: boolean;

  private readonly onMouseMove: (e: MouseEvent) => void;
  private readonly onMouseDown: (e: MouseEvent) => void;
  private readonly onContextMenu: (e: Event) => void;
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;

  constructor(game: any) {
    this.game = game;
    this.canvas = game.canvas;
    this.mouse = { x: 0, y: 0, clicked: false };
    this.keys = {};
    this.listenersAttached = false;

    this.onMouseMove = (e: MouseEvent) => {
      this.updateMouse(e);
    };

    this.onMouseDown = (e: MouseEvent) => {
      e.preventDefault(); // Prevent canvas from stealing focus
      this.updateMouse(e);
      this.mouse.clicked = true;
      if (this.game.onMouseClick) {
        this.game.onMouseClick(this.mouse.x, this.mouse.y);
      }
    };

    this.onContextMenu = (e: Event) => {
      e.preventDefault();
    };

    this.onKeyDown = (e: KeyboardEvent) => {
      // Toggle console by physical backquote key, independent of keyboard layout.
      if (e.code === 'Backquote') {
        e.preventDefault();
        if (this.game.console) {
          this.game.console.toggle();
        }
        return;
      }

      if (this.game.console?.continueClosedModal()) {
        e.preventDefault();
        return;
      }

      this.keys[e.key] = true;
    };

    this.onKeyUp = (e: KeyboardEvent) => {
      this.keys[e.key] = false;
    };

    this.setupListeners();
  }

  private updateMouse(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;

    this.mouse.x = (e.clientX - rect.left) * scaleX;
    this.mouse.y = (e.clientY - rect.top) * scaleY;
  }

  setupListeners(): void {
    if (this.listenersAttached) {
      return;
    }

    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);

    // Keyboard listeners stay on window to catch global input.
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.listenersAttached = true;
  }

  private detachCanvasListeners(canvas: HTMLCanvasElement): void {
    canvas.removeEventListener('mousemove', this.onMouseMove);
    canvas.removeEventListener('mousedown', this.onMouseDown);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  isDown(key: string): boolean {
    return !!this.keys[key];
  }

  updateCanvas(newCanvas: HTMLCanvasElement): void {
    if (this.canvas === newCanvas) {
      return;
    }

    if (this.listenersAttached) {
      this.detachCanvasListeners(this.canvas);
    }

    this.canvas = newCanvas;
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  destroy(): void {
    if (!this.listenersAttached) {
      return;
    }

    this.detachCanvasListeners(this.canvas);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.listenersAttached = false;
  }
}
