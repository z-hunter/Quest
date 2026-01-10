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
