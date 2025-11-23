export class Input {
    game: any; // Using any to avoid circular dependency for now
    canvas: HTMLCanvasElement;
    mouse: { x: number, y: number, clicked: boolean };

    constructor(game: any) {
        this.game = game;
        this.canvas = game.canvas;
        this.mouse = { x: 0, y: 0, clicked: false };

        this.setupListeners();
    }

    setupListeners(): void {
        this.canvas.addEventListener('mousedown', (e: MouseEvent) => {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;

            this.mouse.x = (e.clientX - rect.left) * scaleX;
            this.mouse.y = (e.clientY - rect.top) * scaleY;
            this.mouse.clicked = true;

            console.log(`[Input] Click: ${this.mouse.x}, ${this.mouse.y}`);
            if (this.game.onMouseClick) {
                this.game.onMouseClick(this.mouse.x, this.mouse.y);
            }
        });

        // Prevent context menu on right click
        this.canvas.addEventListener('contextmenu', (e: Event) => e.preventDefault());
    }

    updateCanvas(newCanvas: HTMLCanvasElement): void {
        this.canvas = newCanvas;
        this.setupListeners();
    }
}
