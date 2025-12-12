import { CRTFilter, type CRTSettings } from '../graphics/CRTFilter';
import { Input } from './Input';
import { Parser } from '../mechanics/Parser';
import { SceneManager } from '../scene/SceneManager';
import { SceneEditor } from '../tools/SceneEditor';
import { Scene } from '../scene/Scene';
import { Player } from '../entities/Player';
import { Entity } from '../entities/Entity';

export class Game {
    canvas: HTMLCanvasElement; // UI Canvas
    rendererCanvas: HTMLCanvasElement; // High-Res Display (WebGL)
    bufferCanvas: HTMLCanvasElement; // 420x300 Buffer (Internal)

    ctx: CanvasRenderingContext2D | null;
    rendererCtx: CanvasRenderingContext2D | null; // For simple 2D upscale if CRT disabled
    uiCtx: CanvasRenderingContext2D | null;

    crtFilter: CRTFilter | null;
    lastTime: number;
    isRunning: boolean;
    inventory: Entity[];
    input: Input;
    parser: Parser;
    sceneManager: SceneManager;
    editor: SceneEditor;
    score: number = 0;
    cursorBlink: number = 0;

    // Callbacks for React
    onSceneChange: ((title: string) => void) | null = null;
    onMessage: ((text: string) => void) | null = null;

    settings: {
        crt: CRTSettings & { enabled: boolean };
    };

    constructor(
        rendererCanvas: HTMLCanvasElement, // The main visual canvas (WebGL)
        uiCanvas: HTMLCanvasElement        // The UI overlay canvas (2D)
    ) {
        this.rendererCanvas = rendererCanvas;
        this.canvas = uiCanvas;

        this.uiCtx = this.canvas.getContext('2d');

        // Create an offscreen buffer for the game to draw onto
        this.bufferCanvas = document.createElement('canvas');
        this.bufferCanvas.width = 420;
        this.bufferCanvas.height = 300;
        this.ctx = this.bufferCanvas.getContext('2d');

        // We won't strictly need 2D context for rendererCanvas if we use WebGL,
        // but we might want it for fallback.
        this.rendererCtx = null;

        // Default Settings
        this.settings = {
            crt: {
                enabled: true,
                curvature: 0.1,
                scanlineCount: 800,
                scanlineIntensity: 0.5,
                aberration: 1.0,
                vignette: 0.3,
                phosphor: 0.0,
                bezelGlow: false,
                bloom: 0.0
            }
        };

        // Initialize CRT Filter on the RENDERER canvas (WebGL)
        this.crtFilter = new CRTFilter(this.rendererCanvas);

        this.lastTime = 0;
        this.isRunning = false;
        this.inventory = []; // Player inventory

        // Load Settings from LocalStorage
        this.loadSettings();

        // Disable smoothing for pixel art look
        if (this.ctx) this.ctx.imageSmoothingEnabled = false;
        if (this.uiCtx) this.uiCtx.imageSmoothingEnabled = false;

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
        // Do not destroy here, as stop might be just pause.
    }

    destroy(): void {
        this.stop();
        // Remove global listeners
        if (this.editor) {
            this.editor.destroy();
        }
        if (this.input) {
            // this.input.destroy(); // Input also has listeners? Check Input.ts later.
        }
        console.log('[Game] Destroyed');
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
        if (this.ctx) {
            // Clear buffer
            this.ctx.fillStyle = '#000';
            this.ctx.fillRect(0, 0, this.bufferCanvas.width, this.bufferCanvas.height);

            // Draw text BEHIND scene (Watermark)
            this.ctx.fillStyle = '#666';
            this.ctx.font = '10px monospace';
            this.ctx.fillText('Quest Engine v0.1                                           F1=Menu', 10, 10);

            this.sceneManager.render(this.ctx);

            // RENDER UI (Status Bar & Command Line) ON TOP OF SCENE (Inside CRT)
            try {
                this.renderUI(this.ctx);
            } catch (uiErr) {
                console.error("UI Render Failed:", uiErr);
            }
        }

        // 2. Render Buffer to Screen via CRT Filter (or Fallback)
        if (this.crtFilter && this.crtFilter.isValid()) {
            let settings = this.settings.crt;

            if (!this.settings.crt.enabled) {
                settings = {
                    enabled: false,
                    curvature: 0,
                    scanlineCount: 0,
                    scanlineIntensity: 0,
                    aberration: 0,
                    vignette: 0,
                    phosphor: 0,
                    bezelGlow: false,
                    bloom: 0
                };
            }

            try {
                this.crtFilter.render(this.bufferCanvas, settings);
            } catch (e) {
                console.warn("CRT Filter failed, disabling:", e);
                this.disableCRT();
                // If it fails, allow fallback next frame
            }
        } else {
            // Fallback: If WebGL failed
            if (this.uiCtx) {
                this.uiCtx.imageSmoothingEnabled = false;
                this.uiCtx.drawImage(this.bufferCanvas, 0, 0, this.canvas.width, this.canvas.height);
            }
        }

        // 3. Render UI/Editor to UI Canvas (Overlay)
        if (this.uiCtx) {
            this.uiCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.editor.render(this.uiCtx);
        }
    }

    renderUI(ctx: CanvasRenderingContext2D): void {
        const w = this.bufferCanvas.width;
        const h = this.bufferCanvas.height;
        const barHeight = 14;

        ctx.font = '10px monospace';
        ctx.textBaseline = 'middle';

        // --- TOP BAR (Status) ---
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, barHeight);

        // Separator Line
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, barHeight, w, 1);

        // Text
        ctx.fillStyle = '#fff';
        ctx.fillText(`Score: ${this.score} of 100`, 10, barHeight / 2);

        const sceneName = this.sceneManager.currentScene ? this.sceneManager.currentScene.name : 'Title';
        const titleWidth = ctx.measureText(sceneName).width;
        ctx.fillText(sceneName, w / 2 - titleWidth / 2, barHeight / 2);

        // --- BOTTOM BAR (Command Line) ---
        ctx.fillStyle = '#000';
        ctx.fillRect(0, h - barHeight, w, barHeight);

        // Separator Line
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, h - (barHeight + 1), w, 1);

        // Command Prompt
        ctx.fillStyle = '#fff';

        // Read Input from Hidden DOM Element
        const input = document.getElementById('parser-input') as HTMLInputElement;
        const inputText = input ? input.value : '';
        const isFocused = document.activeElement === input;

        // Cursor Blink (Only if focused)
        let cursor = '';
        if (isFocused) {
            this.cursorBlink += 16; // Approx ms per frame
            if (Math.floor(this.cursorBlink / 500) % 2 === 0) {
                cursor = '_';
            }
        }

        ctx.fillText(`> ${inputText}${cursor}`, 10, h - barHeight / 2);
    }

    disableCRT(): void {
        this.crtFilter = null;
    }

    onMouseClick(x: number, y: number): void {
        console.log(`[Game] onMouseClick: ${x}, ${y}`);

        const input = document.getElementById('parser-input');
        if (input) input.focus();

        // If editor consumes the click, don't pass to game
        if (this.editor.onClick(x, y)) {
            console.log(`[Game] Editor consumed click`);
            return;
        }

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

    resize(width: number, height: number): void {
        // Update RENDERER canvas size (High Res)
        this.rendererCanvas.width = width;
        this.rendererCanvas.height = height;

        // Note: We do NOT resize bufferCanvas. It stays at 420x300.
        // Note: We do NOT resize uiCanvas (this.canvas). It stays at 420x300 (set in React).
    }

    saveSettings(): void {
        try {
            const json = JSON.stringify(this.settings);
            localStorage.setItem('quest_settings', json);
            console.log('[Game] Settings saved to LocalStorage');
            this.showMessage("Settings Saved!");
        } catch (e) {
            console.error("Failed to save settings:", e);
        }
    }

    loadSettings(): void {
        try {
            const json = localStorage.getItem('quest_settings');
            if (json) {
                const loaded = JSON.parse(json);
                // Merge loaded settings with defaults (simple shallow merge for crt)
                if (loaded.crt) {
                    this.settings.crt = { ...this.settings.crt, ...loaded.crt };
                }
                console.log('[Game] Settings loaded from LocalStorage');
            }
        } catch (e) {
            console.error("Failed to load settings:", e);
        }
    }
}
