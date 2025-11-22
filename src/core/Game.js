class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');
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

        const deltaTime = timestamp - this.lastTime;
        this.lastTime = timestamp;

        this.update(deltaTime);
        this.render();

        requestAnimationFrame(this.loop.bind(this));
    }

    update(deltaTime) {
        this.sceneManager.update(deltaTime);
    }

    render() {
        // Clear screen
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.sceneManager.render(this.ctx);
        this.editor.render(this.ctx);

        // Debug text
        this.ctx.fillStyle = '#fff';
        this.ctx.font = '10px monospace';
        this.ctx.fillText('Sierra Engine v0.1', 10, 10);
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
