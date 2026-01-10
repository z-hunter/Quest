
import { CRTFilter, type CRTSettings } from '../graphics/CRTFilter';
import { Input } from './Input';
import { Parser } from '../mechanics/Parser';
import { SceneManager } from '../scene/SceneManager';
import { SceneEditor } from '../tools/SceneEditor';
import { SpriteEditor } from '../tools/SpriteEditor';
import { AssetLoader } from './AssetLoader';
import { Entity } from '../entities/Entity';
import { registerDemoScripts } from '../scripts/DemoScripts';
import { registerUserScripts } from '../scripts/main';
import { AudioManager } from './AudioManager';

export class Game {
    public static instance: Game;

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

    playSound(name: string): void {
        if (this.audio) {
            this.audio.playSound(name);
        }
    }

    input: Input;
    parser: Parser;
    sceneManager: SceneManager;
    assets: AssetLoader;
    audio: AudioManager;
    editor: SceneEditor;
    spriteEditor: SpriteEditor;
    score: number = 0;
    cursorBlink: number = 0;

    // UI State
    public isMouseOverUI: boolean = false;

    // Callbacks for React
    onSceneChange: ((title: string) => void) | null = null;
    onMessage: ((text: string) => void) | null = null;
    onRequestFileBrowser: ((mode: 'save' | 'load', dir: string, onConfirm: (f: string) => void, extension?: string, title?: string) => void) | null = null;

    settings: {
        crt: CRTSettings & { enabled: boolean };
    };

    openFileBrowser(mode: 'save' | 'load', dir: string, onConfirm: (f: string) => void, extension?: string, title?: string): void {
        if (this.onRequestFileBrowser) {
            this.onRequestFileBrowser(mode, dir, onConfirm, extension, title);
        } else {
            console.error("File Browser UI not hooked up!");
            alert("File Browser Unavailable");
        }
    }

    constructor(
        rendererCanvas: HTMLCanvasElement, // The main visual canvas (WebGL)
        uiCanvas: HTMLCanvasElement        // The UI overlay canvas (2D)
    ) {
        Game.instance = this;
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

        // (Previously corrupted lines removed)
        this.input = new Input(this);
        this.parser = new Parser(this);
        this.assets = new AssetLoader();
        this.audio = new AudioManager();
        this.sceneManager = new SceneManager(this);
        this.editor = new SceneEditor(this);
        this.spriteEditor = new SpriteEditor(this);

        // Expose game instance globally for legacy compatibility (Entity.ts uses it)
        // @ts-ignore
        window.game = this;

        this.sceneManager.loadScene('test_room.json');

        // Register default scripts
        registerDemoScripts();

        // Register user scripts (from src/scripts/main.ts)
        registerUserScripts();

        console.log('Game initialized');
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
            let deltaTime = timestamp - this.lastTime;
            this.lastTime = timestamp;

            // Cap delta time to prevent spiraling or fast-forwarding after backgrounding
            // If the game was in the background, this prevents animations from trying to "catch up"
            // by playing all missed frames at once.
            if (deltaTime > 100) {
                deltaTime = 100;
            }

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

        // Cursor Logic: Change to 'eye' if hovering over Subscene object in Game Mode
        if (!this.editor.enabled && this.sceneManager.currentScene) {
            const hovered = this.sceneManager.currentScene.checkHover(this.input.mouse.x, this.input.mouse.y);
            if (hovered) {
                this.canvas.classList.add('cursor-eye');
            } else {
                this.canvas.classList.remove('cursor-eye');
            }
        } else {
            this.canvas.classList.remove('cursor-eye');
        }
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

            // Sprite Editor Overlay (Takes over screen if active)
            if (this.spriteEditor.active) {
                this.spriteEditor.render(this.uiCtx);
            } else {
                this.editor.render(this.uiCtx);
            }
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

        // Only focus parser if editor is NOT enabled
        if (input && !this.editor.enabled) {
            input.focus();
        }

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
