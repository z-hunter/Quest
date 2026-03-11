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
import { TextAssetManager } from './TextAssetManager';
import type { GameActionOutcome } from './GameActionTypes';

import { Console } from './Console';
import { ScriptRegistry } from './ScriptRegistry';
import { ComponentSystem } from '../systems/ComponentSystem';

import type { IGame } from './IGame';

export class Game implements IGame {
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
  textAssets: TextAssetManager;
  editor: SceneEditor;
  spriteEditor: SpriteEditor;
  console: Console; // Virtual Console
  score: number = 0;
  cursorBlink: number = 0;

  // FPS Counter
  fps: number = 0;
  frameCount: number = 0;
  lastFpsTime: number = 0;

  // UI State
  public isMouseOverUI: boolean = false;

  // Callbacks for React
  // Callbacks for React
  onSceneChange: ((sceneName: string) => void) | undefined;
  onMessage: ((text: string) => void) | null = null;
  onRequestFileBrowser:
    | ((
        mode: 'save' | 'load',
        dir: string,
        onConfirm: (f: string) => void,
        extension?: string,
        title?: string
      ) => void)
    | null = null;

  settings: {
    crt: CRTSettings & { enabled: boolean };
    editor: {
      uiScale: number;
    };
  };

  openFileBrowser(
    mode: 'save' | 'load',
    dir: string,
    onConfirm: (f: string) => void,
    extension?: string,
    title?: string
  ): void {
    if (this.onRequestFileBrowser) {
      this.onRequestFileBrowser(mode, dir, onConfirm, extension, title);
    } else {
      console.error('File Browser UI not hooked up!');
      alert('File Browser Unavailable');
    }
  }

  constructor(
    rendererCanvas: HTMLCanvasElement, // The main visual canvas (WebGL)
    uiCanvas: HTMLCanvasElement // The UI overlay canvas (2D)
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
        bloom: 0.0,
      },
      editor: {
        uiScale: 1.0,
      },
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
    this.console = new Console(this); // Init Console with Game Reference
    this.parser = new Parser(this);
    this.assets = new AssetLoader();
    this.audio = new AudioManager();
    this.textAssets = new TextAssetManager();
    void this.textAssets.preloadServiceAssets();
    this.sceneManager = new SceneManager(this);
    this.editor = new SceneEditor(this);
    this.spriteEditor = new SpriteEditor(this);

    this.sceneManager.loadScene('test_room.json');

    // Register default scripts
    registerDemoScripts();

    // Register user scripts (from src/scripts/main.ts)
    registerUserScripts();
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
      this.input.destroy();
    }
  }

  loop(timestamp: number): void {
    if (!this.isRunning) return;

    try {
      let deltaTime = timestamp - this.lastTime;
      this.lastTime = timestamp;

      // FPS Calculation
      this.frameCount++;
      if (timestamp - this.lastFpsTime >= 1000) {
        this.fps = this.frameCount;
        this.frameCount = 0;
        this.lastFpsTime = timestamp;
      }

      // Cap delta time to prevent spiraling or fast-forwarding after backgrounding
      // If the game was in the background, this prevents animations from trying to "catch up"
      // by playing all missed frames at once.
      if (deltaTime > 100) {
        deltaTime = 100;
      }

      this.update(deltaTime);
      this.render();
    } catch (e) {
      console.error('Game Loop Error:', e);
      this.stop();
      return;
    }

    requestAnimationFrame(this.loop.bind(this));
  }

  update(deltaTime: number): void {
    this.sceneManager.update(deltaTime);
    if (this.editor.enabled) {
      this.editor.update(deltaTime);
    }

    // Cursor Logic: Change to 'eye' if hovering over Subscene object in Game Mode
    if (!this.editor.enabled && this.sceneManager.currentScene) {
      const hovered = this.sceneManager.currentScene.checkHover(
        this.input.mouse.x,
        this.input.mouse.y
      );
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
      this.ctx.fillText(
        'Scanline v0.1                                                   F1=Menu',
        10,
        10
      );

      this.sceneManager.render(this.ctx);

      // RENDER UI (Status Bar & Command Line) ON TOP OF SCENE (Inside CRT)
      try {
        this.renderUI(this.ctx);
      } catch (uiErr) {
        console.error('UI Render Failed:', uiErr);
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
          bloom: 0,
        };
      }

      try {
        this.crtFilter.render(this.bufferCanvas, settings);
      } catch (e) {
        console.warn('CRT Filter failed, disabling:', e);
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

  consoleInput: HTMLInputElement | null = null; // Command input provided by UI layer

  setCommandInput(input: HTMLInputElement | null): void {
    this.consoleInput = input;
  }

  getCommandInput(): HTMLInputElement | null {
    return this.consoleInput;
  }

  focusCommandInput(): void {
    this.consoleInput?.focus();
  }

  renderUI(ctx: CanvasRenderingContext2D): void {
    const w = this.bufferCanvas.width;
    const h = this.bufferCanvas.height;
    // Use a fixed height for the closed console area (last 2 lines + input)
    // 3 lines * 10px = 30px? GDD says "2 last lines ... and under them input".
    // Let's allocate roughly 3 lines of text height.
    const lineHeight = 10;
    const consoleHeight = lineHeight * 3 + 4; // 3 lines + padding

    ctx.font = '10px monospace';
    ctx.textBaseline = 'top';

    // --- CLOSED CONSOLE (Bottom Only) ---
    // Replacing Status Bar (Top) with nothing as per GDD ("we clean up status bar").

    // Draw Background for Console Area
    const consoleY = h - consoleHeight;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'; // Semi-transparent black backing? Or solid for readability?
    // GDD: "In closed state... integrated into game picture... drawn on low-res 2d canvas".
    // Let's use solid black for the bottom strip to ensure text readability.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, consoleY, w, consoleHeight);

    // --- Draw Last 2 Lines of Buffer ---
    ctx.fillStyle = '#fff';
    const buffer = this.console.buffer;
    const lastIndex = buffer.length - 1;

    // Show last 2 lines above input
    // Line -2
    if (lastIndex >= 1) {
      const line = buffer[lastIndex - 1];
      ctx.fillStyle = line.type === 'command' ? '#aaa' : '#fff';
      ctx.fillText(line.text, 2, consoleY + 2);
    }
    // Line -1
    if (lastIndex >= 0) {
      const line = buffer[lastIndex];
      ctx.fillStyle = line.type === 'command' ? '#aaa' : '#fff';
      ctx.fillText(line.text, 2, consoleY + 2 + lineHeight);
    }

    // --- INPUT LINE ---
    const inputText = this.consoleInput ? this.consoleInput.value : '';
    const isFocused = document.activeElement === this.consoleInput;

    // Cursor Blink (Only if focused)
    let cursor = '';
    if (isFocused) {
      this.cursorBlink += 16; // Approx ms per frame
      if (Math.floor(this.cursorBlink / 500) % 2 === 0) {
        cursor = '_';
      }
    }

    ctx.fillStyle = '#fff';
    ctx.fillText(`> ${inputText}${cursor}`, 2, consoleY + 2 + lineHeight * 2);
  }

  disableCRT(): void {
    this.crtFilter = null;
  }

  onMouseClick(x: number, y: number): void {
    // Only focus parser if editor is NOT enabled
    if (!this.editor.enabled) {
      this.focusCommandInput();
    }

    // If editor consumes the click, don't pass to game
    if (this.editor.onClick(x, y)) {
      return;
    }

    // Forward click to current scene
    if (this.sceneManager.currentScene) {
      this.sceneManager.currentScene.onClick(x, y);
    }
  }

  // --- Message API ---
  log(text: string): void {
    console.log(`[GAME LOG] ${text}`);
    this.console.log(text);
  }

  text(key: string, params?: Record<string, string | number>): string {
    return this.textAssets.getServiceText(key, params);
  }

  look(target?: string | null): GameActionOutcome {
    const scene = this.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.text('parser.parse_unknown'),
        recoverable: false,
      };
    }

    const normalizedTarget = String(target || '').trim();
    const normalizedUpper = normalizedTarget.toUpperCase();

    if (
      !normalizedTarget ||
      normalizedUpper === 'AROUND' ||
      normalizedUpper === 'HERE' ||
      normalizedUpper === 'SCENE'
    ) {
      const sceneDescription =
        this.textAssets.getResolvedSceneField(scene, 'description') ||
        scene.description ||
        this.text('parser.look_default_scene', { scene: scene.name });
      return {
        status: 'ok',
        code: 'scene_description',
        message: sceneDescription,
        data: { targetType: 'scene', sceneId: scene.id },
      };
    }

    const entity = scene.findEntity(normalizedTarget);
    if (!entity) {
      return {
        status: 'failed',
        code: 'entity_not_found',
        message: this.text('parser.look_not_found', { target: normalizedTarget }),
        data: { target: normalizedTarget },
        recoverable: true,
      };
    }

    const interactionId = entity.interactions && (entity.interactions.look || entity.interactions.LOOK);
    if (interactionId) {
      ScriptRegistry.execute(interactionId, { game: this, entity });
      return {
        status: 'ok',
        code: 'delegated_script',
        data: { targetType: 'entity', entityId: entity.name, scriptId: interactionId },
        effects: ['script_executed'],
      };
    }

    const description = this.textAssets.getResolvedObjectField(entity, 'description') || entity.description;
    if (description && description.trim()) {
      return {
        status: 'ok',
        code: 'entity_description',
        message: description,
        data: { targetType: 'entity', entityId: entity.name },
      };
    }

    return {
      status: 'escalate',
      code: 'missing_description',
      message: this.text('parser.look_default_object', { target: normalizedTarget }),
      data: { targetType: 'entity', entityId: entity.name },
      recoverable: true,
    };
  }

  take(target?: string | null): GameActionOutcome {
    const scene = this.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.text('parser.parse_unknown'),
        recoverable: false,
      };
    }

    const normalizedTarget = String(target || '').trim();
    if (!normalizedTarget) {
      return {
        status: 'needs_clarification',
        code: 'missing_take_target',
        message: this.text('parser.take_prompt'),
        recoverable: true,
      };
    }

    const entity = scene.findEntity(normalizedTarget);
    if (!entity) {
      return {
        status: 'failed',
        code: 'entity_not_found',
        message: this.text('parser.look_not_found', { target: normalizedTarget }),
        data: { target: normalizedTarget },
        recoverable: true,
      };
    }

    const interactionId =
      entity.interactions && (entity.interactions.pickup || entity.interactions.PICKUP);
    if (interactionId) {
      ScriptRegistry.execute(interactionId, { game: this, entity });
      return {
        status: 'ok',
        code: 'delegated_script',
        data: { targetType: 'entity', entityId: entity.name, scriptId: interactionId },
        effects: ['script_executed'],
      };
    }

    const errorMsg = ComponentSystem.canTakeItem(entity, scene.player);
    if (errorMsg) {
      return {
        status: 'failed',
        code: 'cannot_take',
        message: errorMsg,
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    const isItem = entity.components && entity.components.find((c: any) => c.type === 'Item');
    if (isItem || entity.isTakeable) {
      scene.removeEntity(entity);
      this.inventory.push(entity);
      return {
        status: 'ok',
        code: 'item_taken',
        message: this.text('parser.take_pickup_success', {
          item: entity.customName || entity.name,
        }),
        data: { entityId: entity.name },
        effects: ['moved_to_inventory'],
      };
    }

    return {
      status: 'failed',
      code: 'not_takeable',
      message: this.text('parser.take_cannot'),
      data: { entityId: entity.name },
      recoverable: true,
    };
  }

  showInventory(): GameActionOutcome {
    return {
      status: 'ok',
      code: 'inventory_list',
      message:
        this.inventory.length === 0
          ? this.text('parser.inventory_empty')
          : this.text('parser.inventory_items', {
              items: this.inventory.map((e: any) => e.customName || e.name).join(', '),
            }),
      data: {
        count: this.inventory.length,
      },
    };
  }

  goTo(target?: string | null): GameActionOutcome {
    const normalizedTarget = String(target || '').trim();
    if (!normalizedTarget) {
      return {
        status: 'needs_clarification',
        code: 'missing_destination',
        message: this.text('parser.go_to_prompt'),
        recoverable: true,
      };
    }

    const currentScene = this.sceneManager.currentScene;
    const sceneMatch = this.sceneManager.findSceneDescriptorByTarget(normalizedTarget);

    if (sceneMatch) {
      this.sceneManager.switchTo(sceneMatch.id);
      const activeScene = this.sceneManager.currentScene;
      return {
        status: 'ok',
        code: 'scene_switched',
        message:
          (activeScene && this.textAssets.getResolvedSceneField(activeScene, 'description')) ||
          activeScene?.description ||
          this.text('parser.go_to_success', { target: sceneMatch.name }),
        data: { targetType: 'scene', sceneId: sceneMatch.id },
        effects: currentScene?.id !== sceneMatch.id ? ['scene_changed'] : [],
      };
    }

    if (currentScene?.player) {
      const entity = currentScene.findEntity(normalizedTarget);
      if (entity && 'x' in entity && 'y' in entity) {
        currentScene.player.walkTo((entity as any).x, (entity as any).y);
        return {
          status: 'ok',
          code: 'player_moving',
          message: this.text('parser.go_to_success', {
            target: this.textAssets.getResolvedObjectField(entity, 'title') || entity.name,
          }),
          data: { targetType: 'entity', entityId: entity.name },
          effects: ['player_move_started'],
        };
      }
    }

    return {
      status: 'failed',
      code: 'destination_not_found',
      message: this.text('parser.go_to_not_found', { target: normalizedTarget }),
      data: { target: normalizedTarget },
      recoverable: true,
    };
  }

  showNotification(text: string): void {
    if (this.onMessage) {
      this.onMessage(text);
    }
  }

  showMessage(text: string): void {
    this.log(text);
  }

  bindUI(): void {
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
      this.showNotification('Settings Saved!');
    } catch (e) {
      console.error('Failed to save settings:', e);
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
        if (loaded.editor) {
          this.settings.editor = { ...this.settings.editor, ...loaded.editor };
        }
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  }
}
