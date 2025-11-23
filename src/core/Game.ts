import { CRTFilter } from '../graphics/CRTFilter';
import { Input } from './Input';
import { Parser } from '../mechanics/Parser';
import { SceneManager } from '../scene/SceneManager';
import { SceneEditor } from '../tools/SceneEditor';
import { Scene } from '../scene/Scene';
import { Player } from '../entities/Player';
import { Entity } from '../entities/Entity';

export class Game {
    canvas: HTMLCanvasElement;
    bufferCanvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    crtFilter: CRTFilter | null;
    lastTime: number;
    isRunning: boolean;
    inventory: Entity[];
    input: Input;
    parser: Parser;
    sceneManager: SceneManager;
    editor: SceneEditor;

    // Callbacks for React
    onSceneChange?: (sceneName: string) => void;
    onMessage?: (text: string) => void;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;

        // Create an offscreen buffer for the game to draw onto
        this.bufferCanvas = document.createElement('canvas');
        this.bufferCanvas.width = 420;
        this.bufferCanvas.height = 300;
        this.ctx = this.bufferCanvas.getContext('2d') as CanvasRenderingContext2D;

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

        // Expose game instance globally for legacy compatibility (Entity.ts uses it)
        // @ts-ignore
        window.game = this;

        this.initTestScene();

        console.log('Game initialized');
    }

    initTestScene(): void {
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
                this.showMessage("You insert the key into a hidden slot in the pillar.");
                this.showMessage("CLICK! A secret compartment opens!");
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

    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTime = performance.now();
        requestAnimationFrame(this.loop.bind(this));
    }

    stop(): void {
        this.isRunning = false;
    }

    loop(timestamp: number): void {
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

    update(deltaTime: number): void {
        this.sceneManager.update(deltaTime);
    }

    render(): void {
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

    disableCRT(): void {
        this.crtFilter = null;

        // In React, we might want to just render the buffer canvas directly or copy it
        // For now, let's just copy buffer to main canvas using 2D context
        const ctx = this.canvas.getContext('2d');
        if (ctx) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(this.bufferCanvas, 0, 0, this.canvas.width, this.canvas.height);
        }
    }

    onMouseClick(x: number, y: number): void {
        // If editor consumes the click, don't pass to game
        if (this.editor.onClick(x, y)) return;

        console.log(`Click at ${Math.round(x)}, ${Math.round(y)}`);
        // Forward click to current scene
        if (this.sceneManager.currentScene) {
            this.sceneManager.currentScene.onClick(x, y);
        }
    }

    showMessage(text: string): void {
        console.log(`[MESSAGE] ${text}`);
        if (this.onMessage) {
            this.onMessage(text);
        } else {
            // Fallback if no UI hooked up
            alert(text);
        }
    }

    bindUI(): void {
        this.parser.setupListener();
        this.editor.initUI();
    }
}
