class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        // Main canvas is now WebGL (handled by CRTFilter), so we don't get 2d context here directly if we want to be strict,
        // BUT CRTFilter expects to take control of the canvas.

        // Create an offscreen buffer for the game to draw onto
        this.bufferCanvas = document.createElement('canvas');
        this.bufferCanvas.width = 420;
        this.bufferCanvas.height = 300;
        this.ctx = this.bufferCanvas.getContext('2d');

        // Initialize CRT Filter on the main canvas
        this.crtFilter = new CRTFilter(this.canvas);

        this.lastTime = 0;
        this.isRunning = false;
        this.inventory = []; // Player inventory

        // Disable smoothing for pixel art look
        this.ctx.imageSmoothingEnabled = false;

        this.input = new Input(this);
        this.parser = new Parser(this);
        this.sceneManager = new SceneManager(this);
        this.editor = new SceneEditor(this);

        this.initTestScene();

        console.log('Game initialized');
    }

    initTestScene() {
        const testScene = new Scene('test_room', 'Test Room');

        // Add player
        const player = new Player(160, 100);
        testScene.addEntity(player);

        // Add a dummy prop (Pillar)
        const pillar = new Entity(180, 110, 20, 40, 'Pillar');
        pillar.color = '#888888';
        pillar.description = "It's an ancient stone pillar. It looks very heavy.";

        // Interaction Logic
        pillar.interactions = {
            'KEY': () => {
                console.log("You insert the key into a hidden slot in the pillar.");
                console.log("CLICK! A secret compartment opens!");
                pillar.description = "The pillar is open, revealing a secret compartment.";
            }
        };

        testScene.addEntity(pillar);

        // Add a Key
        const key = new Entity(200, 150, 10, 10, 'Key');
        key.color = '#ffff00';
        key.description = "A small golden key.";
        key.isTakeable = true;
        testScene.addEntity(key);

        this.sceneManager.addScene(testScene);
        this.sceneManager.switchTo('test_room');
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTime = performance.now();
        requestAnimationFrame(this.loop.bind(this));
    }

    stop() {
        this.isRunning = false;
    }

    loop(timestamp) {
        if (!this.isRunning) return;

        try {
            const deltaTime = timestamp - this.lastTime;
            this.lastTime = timestamp;

            this.update(deltaTime);
            this.render();
        } catch (e) {
            console.error("Game Loop Error:", e);
            this.stop();
            return;
        }

        requestAnimationFrame(this.loop.bind(this));
    }

    update(deltaTime) {
        this.sceneManager.update(deltaTime);
    }

    render() {
        // 1. Render Game to Buffer
        // Clear buffer
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.bufferCanvas.width, this.bufferCanvas.height);

        this.sceneManager.render(this.ctx);
        this.editor.render(this.ctx);

        // Debug text on buffer
        this.ctx.fillStyle = '#fff';
        this.ctx.font = '10px monospace';
        this.ctx.fillText('Sierra Engine v0.1', 10, 10);

        // 2. Render Buffer to Screen via CRT Filter
        if (this.crtFilter) {
            try {
                this.crtFilter.render(this.bufferCanvas);
            } catch (e) {
                console.warn("CRT Filter failed (likely SecurityError), disabling and falling back to 2D canvas:", e);
                this.disableCRT();
            }
        }
    }

    disableCRT() {
        this.crtFilter = null;

        // Replace WebGL canvas with 2D buffer canvas
        const container = document.getElementById('game-container');
        if (this.canvas && this.canvas.parentNode === container) {
            container.removeChild(this.canvas);
        }

        // Style the buffer canvas to look like the game canvas
        this.bufferCanvas.id = 'game-canvas';
        this.bufferCanvas.style.width = '100%';
        this.bufferCanvas.style.height = '100%';
        this.bufferCanvas.style.imageRendering = 'pixelated'; // Ensure crisp pixels

        container.appendChild(this.bufferCanvas);

        // Update reference
        this.canvas = this.bufferCanvas;

        // Re-bind input
        this.input.updateCanvas(this.canvas);

        // Inject CSS CRT Overlay
        const overlay = document.createElement('div');
        overlay.className = 'crt-overlay';
        container.appendChild(overlay);
        console.log("CSS CRT Overlay activated");
    }

    onMouseClick(x, y) {
        // If editor consumes the click, don't pass to game
        if (this.editor.onClick(x, y)) return;

        console.log(`Click at ${Math.round(x)}, ${Math.round(y)}`);
        // Forward click to current scene
        if (this.sceneManager.currentScene) {
            this.sceneManager.currentScene.onClick(x, y);
        }
    }
}
