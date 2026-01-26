export class Input {
    game: any; // Using any to avoid circular dependency for now
    canvas: HTMLCanvasElement;
    mouse: { x: number, y: number, clicked: boolean };
    keys: { [key: string]: boolean };

    constructor(game: any) {
        this.game = game;
        this.canvas = game.canvas;
        this.mouse = { x: 0, y: 0, clicked: false };
        this.keys = {};

        this.setupListeners();
    }



    setupListeners(): void {
        const updateMouse = (e: MouseEvent) => {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;

            this.mouse.x = (e.clientX - rect.left) * scaleX;
            this.mouse.y = (e.clientY - rect.top) * scaleY;
        };

        this.canvas.addEventListener('mousemove', (e: MouseEvent) => {
            updateMouse(e);
        });

        this.canvas.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault(); // Prevent canvas from stealing focus
            updateMouse(e);
            this.mouse.clicked = true;

            console.log(`[Input] MouseDown: ${this.mouse.x}, ${this.mouse.y}`);
            if (this.game.onMouseClick) {
                // Input handles mousedown, updates state.
                // Actual 'click' logic usually happens on mouseup or here?
                // Game.onMouseClick is called here.
                this.game.onMouseClick(this.mouse.x, this.mouse.y);
            }
        });

        // Prevent context menu on right click
        this.canvas.addEventListener('contextmenu', (e: Event) => e.preventDefault());

        // Keyboard Listeners (Attached to window to catch global input)
        window.addEventListener('keydown', (e: KeyboardEvent) => {
            this.keys[e.key] = true;
            // console.log(`[Input] KeyDown: ${e.key}`);

            // Global Tilde (~) to toggle Console
            if (e.key === '`' || e.key === '~') {
                e.preventDefault();
                if (this.game.console) {
                    this.game.console.toggle();
                    // Force React UI update (if needed, but polling might handle it or we use callback)
                    // We might need to expose an OnConsoleToggle event or similar if React doesn't pick it up via polling.
                    // For now, let's assume UIOverlay or ConsoleOverlay will poll or we add a callback.
                    // Actually, simpler: toggle() changes state, React component should ideally observe this.
                    // Since we don't have MobX/Redux signals effectively from Game -> React without forceUpdate,
                    // we might need a generic onUIChange callback or similar.
                    // Let's add a quick hack if needed or rely on refresh.
                    // Better: call a method on Game that triggers listeners.

                    // Actually, Game loop renders 60fps. The React overlay might not re-render unless state changes.
                    // We should add a listener for console toggle.
                }
            }
        });

        window.addEventListener('keyup', (e: KeyboardEvent) => {
            this.keys[e.key] = false;
            // console.log(`[Input] KeyUp: ${e.key}`);
        });
    }

    isDown(key: string): boolean {
        return !!this.keys[key];
    }

    updateCanvas(newCanvas: HTMLCanvasElement): void {
        this.canvas = newCanvas;
        this.setupListeners();
    }
}
