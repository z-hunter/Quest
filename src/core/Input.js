class Input {
    constructor(game) {
        this.game = game;
        this.canvas = game.canvas;
        this.mouse = { x: 0, y: 0, clicked: false };

        this.setupListeners();
    }

    setupListeners() {
        this.canvas.addEventListener('mousedown', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;

            this.mouse.x = (e.clientX - rect.left) * scaleX;
            this.mouse.y = (e.clientY - rect.top) * scaleY;
            this.mouse.clicked = true;

            console.log(`[Input] Click: ${this.mouse.x}, ${this.mouse.y}`);
            this.game.onMouseClick(this.mouse.x, this.mouse.y);
        });

        // Prevent context menu on right click
        this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    }
    updateCanvas(newCanvas) {
        this.canvas = newCanvas;
        this.setupListeners();
    }
}
