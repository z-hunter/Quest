import { CRTFilter, type CRTSettings } from '../graphics/CRTFilter';
import { Input } from './Input';
import { Parser } from '../mechanics/Parser';
import { SceneManager } from '../scene/SceneManager';
import { SceneEditor } from '../tools/SceneEditor';
import { SpriteEditor } from '../tools/SpriteEditor';
import { AssetLoader } from './AssetLoader';
import { Entity } from '../entities/Entity';
import { SceneObject } from '../entities/SceneObject';
import { registerDemoScripts } from '../scripts/DemoScripts';
import { registerUserScripts } from '../scripts/main';
import { AudioManager } from './AudioManager';
import { TextAssetManager } from './TextAssetManager';
import type { GameActionOutcome } from './GameActionTypes';

import { Console } from './Console';
import { ScriptRegistry } from './ScriptRegistry';
import { ComponentSystem } from '../systems/ComponentSystem';
import type { SwitchComponent } from '../systems/ComponentSystem';
import { buildSceneTextLayerSnapshot, getInactiveSubsceneAncestors } from '../scene/SceneTextLayer';

import type { IGame } from './IGame';
import type { Scene } from '../scene/Scene';
import type { SpatialRelationType } from '../scene/spatialTypes';

type EditorViewportZoom = 'fit' | '1' | '1.5' | '2';

export class Game implements IGame {
  public static instance: Game;

  canvas: HTMLCanvasElement; // UI Canvas
  editorOverlayCanvas: HTMLCanvasElement | null;
  rendererCanvas: HTMLCanvasElement; // High-Res Display (WebGL)
  bufferCanvas: HTMLCanvasElement; // 420x300 Buffer (Internal)

  ctx: CanvasRenderingContext2D | null;
  rendererCtx: CanvasRenderingContext2D | null; // For simple 2D upscale if CRT disabled
  uiCtx: CanvasRenderingContext2D | null;
  editorOverlayCtx: CanvasRenderingContext2D | null;

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
        title?: string,
        onCancel?: () => void
      ) => void)
    | null = null;
  onRequestChoiceDialog:
    | ((
        title: string,
        message: string,
        options: Array<{ id: string; label: string; variant?: 'primary' | 'danger' | 'neutral' }>,
        onResolve: (choiceId: string | null) => void
      ) => void)
    | null = null;

  settings: {
    crt: CRTSettings & { enabled: boolean };
    editor: {
      uiScale: number;
      viewportZoom: EditorViewportZoom;
    };
  };

  openFileBrowser(
    mode: 'save' | 'load',
    dir: string,
    onConfirm: (f: string) => void,
    extension?: string,
    title?: string,
    onCancel?: () => void
  ): void {
    if (this.onRequestFileBrowser) {
      this.onRequestFileBrowser(mode, dir, onConfirm, extension, title, onCancel);
    } else {
      console.error('File Browser UI not hooked up!');
      alert('File Browser Unavailable');
    }
  }

  requestChoiceDialog(
    title: string,
    message: string,
    options: Array<{ id: string; label: string; variant?: 'primary' | 'danger' | 'neutral' }>
  ): Promise<string | null> {
    if (!this.onRequestChoiceDialog) {
      console.error('Choice Dialog UI not hooked up!');
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      this.onRequestChoiceDialog!(title, message, options, resolve);
    });
  }

  constructor(
    rendererCanvas: HTMLCanvasElement, // The main visual canvas (WebGL)
    uiCanvas: HTMLCanvasElement, // The UI overlay canvas (2D)
    editorOverlayCanvas?: HTMLCanvasElement // High-res editor overlay canvas
  ) {
    Game.instance = this;
    this.rendererCanvas = rendererCanvas;
    this.canvas = uiCanvas;
    this.editorOverlayCanvas = editorOverlayCanvas || null;

    this.uiCtx = this.canvas.getContext('2d');
    this.editorOverlayCtx = this.editorOverlayCanvas?.getContext('2d') || null;

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
        curvature: 0.16,
        scanlineCount: 200,
        scanlineIntensity: 0.4,
        aberration: 0.2,
        vignette: 0.9,
        phosphor: 1.0,
        bezelGlow: true,
        bloom: 0.05,
      },
      editor: {
        uiScale: 1.0,
        viewportZoom: 'fit',
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
    if (this.editorOverlayCtx) this.editorOverlayCtx.imageSmoothingEnabled = true;

    // (Previously corrupted lines removed)
    this.input = new Input(this);
    this.console = new Console(this); // Init Console with Game Reference
    this.parser = new Parser(this);
    this.assets = new AssetLoader();
    this.audio = new AudioManager();
    this.textAssets = new TextAssetManager();
    void this.textAssets.preloadServiceAssets();
    void this.textAssets.preloadParserLanguageAssets();
    this.sceneManager = new SceneManager(this);
    if (typeof window !== 'undefined') {
      const debugWindow = window as Window & {
        __QUEST_DEBUG__?: Record<string, unknown>;
      };
      debugWindow.__QUEST_DEBUG__ = {
        ...(debugWindow.__QUEST_DEBUG__ || {}),
        game: this,
        profileCurrentSceneMemory: () => this.sceneManager.profileCurrentSceneMemory(),
        profileScenes: (sceneIds: string[]) => this.sceneManager.profileScenes(sceneIds),
      };
    }
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

    // Cursor Logic: Change to contextual cursor if hovering over interactive object in Game Mode
    if (!this.editor.enabled && this.sceneManager.currentScene) {
      const hoverCursor = this.sceneManager.currentScene.checkHover(
        this.input.mouse.x,
        this.input.mouse.y
      );
      this.canvas.classList.remove('cursor-eye', 'cursor-hand', 'cursor-back');
      if (hoverCursor === 'eye') {
        this.canvas.classList.add('cursor-eye');
      } else if (hoverCursor === 'hand') {
        this.canvas.classList.add('cursor-hand');
      } else if (hoverCursor === 'back') {
        this.canvas.classList.add('cursor-back');
      }
    } else {
      this.canvas.classList.remove('cursor-eye', 'cursor-hand', 'cursor-back');
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

    // 3. Render UI/Editor overlays
    if (this.uiCtx) {
      this.uiCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (this.editorOverlayCtx && this.editorOverlayCanvas) {
      this.editorOverlayCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.editorOverlayCtx.clearRect(
        0,
        0,
        this.editorOverlayCanvas.width,
        this.editorOverlayCanvas.height
      );
    }

    if (this.uiCtx) {
      // Sprite Editor Overlay (Takes over screen if active)
      if (this.spriteEditor.active) {
        this.spriteEditor.render(this.uiCtx);
      } else if (!this.editorOverlayCtx) {
        this.editor.render(this.uiCtx);
      }
    }

    if (
      this.editorOverlayCtx &&
      this.editorOverlayCanvas &&
      !this.spriteEditor.active &&
      this.editor.enabled
    ) {
      const scaleX = this.editorOverlayCanvas.width / this.canvas.width;
      const scaleY = this.editorOverlayCanvas.height / this.canvas.height;
      this.editorOverlayCtx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      this.editor.render(this.editorOverlayCtx);
      this.editorOverlayCtx.setTransform(1, 0, 0, 1, 0, 0);
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

  private getPlayerFacingObjectTitle(target: SceneObject): string | null {
    const title = this.textAssets.getResolvedObjectField(target as any, 'title');
    return title && title.trim() ? title.trim() : null;
  }

  private getRelationDisplayText(relation: SpatialRelationType): string {
    switch (relation) {
      case 'in':
        return 'in';
      case 'on':
        return 'on';
      case 'under':
        return 'under';
      case 'behind':
        return 'behind';
      default:
        return relation;
    }
  }

  private capitalize(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  }

  private formatTitleList(items: string[]): string {
    if (items.length <= 1) return items[0] || '';
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  }

  private getSpatialParentMessage(target: SceneObject): string | null {
    const scene = this.sceneManager.currentScene;
    if (!scene) return null;

    const textLayer = buildSceneTextLayerSnapshot(scene, this);
    const entry = textLayer.entryById.get(target.name);
    if (!entry?.effectiveParentId || !entry.effectiveRelation) return null;

    const itemTitle = entry.title || this.getPlayerFacingObjectTitle(target);
    const parentTitle = textLayer.entryById.get(entry.effectiveParentId)?.title?.trim() || null;
    if (!itemTitle || !parentTitle) return null;

    return this.text('parser.relation_contents', {
      Relation: this.capitalize(this.getRelationDisplayText(entry.effectiveRelation)),
      relation: this.getRelationDisplayText(entry.effectiveRelation),
      target: parentTitle,
      items: itemTitle,
    });
  }

  getSeeMessage(target: SceneObject): string | null {
    return this.getSpatialParentMessage(target) || null;
  }

  private isEntityInInventory(entity: Entity): boolean {
    return this.inventory.includes(entity);
  }

  private canExamineObject(entity: SceneObject): GameActionOutcome | null {
    if (entity instanceof Entity && this.isEntityInInventory(entity)) return null;

    const scene = this.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.text('parser.parse_unknown'),
        recoverable: false,
      };
    }

    const blockedOutcome = this.getBlockedAccessOutcome(entity);
    if (blockedOutcome) {
      return blockedOutcome;
    }

    if (scene.activeSubscene && scene.subsceneEntities.has(entity as any)) {
      return null;
    }

    const distanceError = ComponentSystem.getInteractionDistanceError(entity as any, scene.player);
    if (distanceError) {
      return {
        status: 'failed',
        code: 'too_far_to_examine',
        message: distanceError,
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    return null;
  }

  private getSwitchComponent(entity: SceneObject): SwitchComponent | null {
    const component = entity.components?.find((candidate: any) => candidate?.type === 'Switch');
    return (component as SwitchComponent | undefined) || null;
  }

  private isSwitchTargetInInactiveSubscene(entity: SceneObject): boolean {
    if (!this.getSwitchComponent(entity)) return false;
    const scene = this.sceneManager.currentScene;
    if (!scene) return false;
    return getInactiveSubsceneAncestors(scene, entity).length > 0;
  }

  private openInactiveAncestorSubscenes(entity: SceneObject): GameActionOutcome | null {
    const scene = this.sceneManager.currentScene;
    if (!scene) return null;

    const ancestors = getInactiveSubsceneAncestors(scene, entity);
    for (const triggerbox of ancestors) {
      const accessError = this.canExamineObject(triggerbox);
      if (accessError) return accessError;
      scene.activateObject(triggerbox);
    }

    return null;
  }

  private ensureSwitchTargetReady(entity: SceneObject): GameActionOutcome | null {
    if (!this.isSwitchTargetInInactiveSubscene(entity)) return null;
    return this.openInactiveAncestorSubscenes(entity);
  }

  private getBlockedAccessOutcome(entity: SceneObject): GameActionOutcome | null {
    const scene = this.sceneManager.currentScene;
    if (!scene) return null;
    const entry = buildSceneTextLayerSnapshot(scene, this).entryById.get(entity.name);
    if (!entry?.blocked) return null;
    return {
      status: 'failed',
      code: 'blocked_inside_closed',
      message: this.text('engine.blocked_inside_closed'),
      data: { entityId: entity.name },
      recoverable: true,
    };
  }

  private executeSwitchStateChange(
    entity: SceneObject,
    desiredState: 1 | 2
  ): GameActionOutcome {
    const scene = this.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.text('parser.parse_unknown'),
        recoverable: false,
      };
    }

    const autoOpenOutcome = this.ensureSwitchTargetReady(entity);
    if (autoOpenOutcome) return autoOpenOutcome;

    const switchComponent = this.getSwitchComponent(entity);
    if (!switchComponent) {
      return {
        status: 'escalate',
        code: 'target_is_not_switch',
        recoverable: true,
      };
    }

    const accessError = this.canExamineObject(entity);
    if (accessError) return accessError;

    const title = this.getPlayerFacingObjectTitle(entity);
    if (!title) {
      return {
        status: 'escalate',
        code: 'switch_missing_title',
        recoverable: true,
      };
    }

    const blocked = ComponentSystem.getSwitchLockError(entity, switchComponent, scene);
    if (blocked) {
      return {
        status: 'failed',
        code: blocked.code,
        message: blocked.message,
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    const currentState = switchComponent.state === 2 ? 2 : 1;
    if (currentState === desiredState) {
      return {
        status: 'failed',
        code: desiredState === 2 ? 'switch_already_open' : 'switch_already_closed',
        message: this.text(
          desiredState === 2 ? 'parser.open_already' : 'parser.close_already',
          { target: title }
        ),
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    ComponentSystem.applySwitchState(entity, switchComponent, scene, desiredState);

    return {
      status: 'ok',
      code: desiredState === 2 ? 'switch_opened' : 'switch_closed',
      message: this.text(desiredState === 2 ? 'parser.open_success' : 'parser.close_success', {
        target: title,
      }),
      data: { entityId: entity.name, state: desiredState },
      effects: [desiredState === 2 ? 'switch_opened' : 'switch_closed'],
    };
  }

  lookScene(scene?: Scene | null): GameActionOutcome {
    const targetScene = scene || this.sceneManager.currentScene;
    if (!targetScene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.text('parser.parse_unknown'),
        recoverable: false,
      };
    }

    const sceneDescription =
      this.textAssets.getResolvedSceneField(targetScene, 'description') ||
      targetScene.description ||
      this.text('parser.look_default_scene', { scene: targetScene.name });
    // Intentionally disabled for now:
    // const directItems = this.getDirectSceneLookItems(targetScene);
    // const contentsMessage = directItems.length
    //   ? this.text('parser.look_scene_contents', {
    //       items: this.formatTitleList(directItems),
    //     })
    //   : '';
    return {
      status: 'ok',
      code: 'scene_description',
      message: sceneDescription,
      data: { targetType: 'scene', sceneId: targetScene.id },
    };
  }

  lookEntity(entity: SceneObject): GameActionOutcome {
    const autoOpenOutcome = this.ensureSwitchTargetReady(entity);
    if (autoOpenOutcome) return autoOpenOutcome;

    const interactionId =
      entity.interactions && (entity.interactions.look || entity.interactions.LOOK);
    if (interactionId) {
      ScriptRegistry.execute(interactionId, { game: this, entity });
      return {
        status: 'ok',
        code: 'delegated_script',
        data: { targetType: 'entity', entityId: entity.name, scriptId: interactionId },
        effects: ['script_executed'],
      };
    }

    const objectDescription = this.textAssets.getResolvedObjectField(entity, 'description');
    const runtimeDescription =
      typeof (entity as any).description === 'string' ? (entity as any).description : null;
    const description = objectDescription || runtimeDescription;
    if (description && description.trim()) {
      return {
        status: 'ok',
        code: 'entity_description',
        message: description,
        data: { targetType: 'entity', entityId: entity.name },
      };
    }

    const targetTitle = this.getPlayerFacingObjectTitle(entity);
    if (targetTitle) {
      const genericMessage = this.text('parser.look_default_object', { target: targetTitle });
      return {
        status: 'ok',
        code: 'entity_generic_description',
        message: genericMessage,
        data: { targetType: 'entity', entityId: entity.name },
      };
    }

    return {
      status: 'escalate',
      code: 'missing_description',
      data: { targetType: 'entity', entityId: entity.name },
      recoverable: true,
    };
  }

  examineEntity(entity: SceneObject): GameActionOutcome {
    const autoOpenOutcome = this.ensureSwitchTargetReady(entity);
    if (autoOpenOutcome) return autoOpenOutcome;

    const accessError = this.canExamineObject(entity);
    if (accessError) return accessError;

    const subsceneComponent = entity.components?.find(
      (component: any) => component?.type === 'Subscene'
    );
    if (subsceneComponent && this.sceneManager.currentScene) {
      this.sceneManager.currentScene.activateObject(entity);
      const seeMessage = this.getSeeMessage(entity);
      const targetTitle = this.getPlayerFacingObjectTitle(entity);
      return {
        status: 'ok',
        code: 'subscene_activated',
        ...(seeMessage
          ? { message: seeMessage }
          : targetTitle
            ? { message: this.text('engine.click_you_see', { title: targetTitle }) }
            : {}),
        data: { targetType: 'entity', entityId: entity.name },
        effects: ['subscene_opened'],
      };
    }

    const interactionId =
      entity.interactions &&
      (entity.interactions.examine ||
        entity.interactions.EXAMINE ||
        entity.interactions.inspect ||
        entity.interactions.INSPECT ||
        entity.interactions.check ||
        entity.interactions.CHECK);
    if (interactionId) {
      ScriptRegistry.execute(interactionId, { game: this, entity });
      return {
        status: 'ok',
        code: 'delegated_script',
        data: { targetType: 'entity', entityId: entity.name, scriptId: interactionId },
        effects: ['script_executed'],
      };
    }

    const details = this.textAssets.getResolvedObjectField(entity, 'details');
    if (details && details.trim()) {
      return {
        status: 'ok',
        code: 'entity_details',
        message: details,
        data: { targetType: 'entity', entityId: entity.name },
      };
    }

    const objectDescription = this.textAssets.getResolvedObjectField(entity, 'description');
    const runtimeDescription =
      typeof (entity as any).description === 'string' ? (entity as any).description : null;
    const description = objectDescription || runtimeDescription;
    if (description && description.trim()) {
      return {
        status: 'ok',
        code: 'entity_description_fallback',
        message: description,
        data: { targetType: 'entity', entityId: entity.name },
      };
    }

    return {
      status: 'escalate',
      code: 'missing_details',
      data: { targetType: 'entity', entityId: entity.name },
      recoverable: true,
    };
  }

  describeSpatialRelation(anchorNodeId: string, relation: SpatialRelationType): GameActionOutcome {
    const scene = this.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.text('parser.parse_unknown'),
        recoverable: false,
      };
    }

    const textLayer = buildSceneTextLayerSnapshot(scene, this);
    const anchorTitle = textLayer.entryById.get(anchorNodeId)?.title?.trim() || null;
    if (!anchorTitle) {
      return {
        status: 'escalate',
        code: 'spatial_node_missing_title',
        recoverable: true,
      };
    }

    const childTitles =
      textLayer.childrenByParentAndRelation
        .get(anchorNodeId)
        ?.get(relation as Exclude<SpatialRelationType, 'near'>)
        ?.map((entry) => entry.title)
        .filter((title): title is string => !!title) || [];

    if (!childTitles.length) {
      return {
        status: 'ok',
        code: 'relation_empty',
        message: this.text('parser.relation_empty', {
          relation: this.getRelationDisplayText(relation),
          target: anchorTitle,
        }),
        data: {
          relation,
          anchorNodeId,
        },
      };
    }

    return {
      status: 'ok',
      code: 'relation_contents',
      message: this.text('parser.relation_contents', {
        Relation: this.capitalize(this.getRelationDisplayText(relation)),
        relation: this.getRelationDisplayText(relation),
        target: anchorTitle,
        items: this.formatTitleList(childTitles),
      }),
      data: {
        relation,
        anchorNodeId,
      },
    };
  }

  takeEntity(entity: Entity): GameActionOutcome {
    const scene = this.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.text('parser.parse_unknown'),
        recoverable: false,
      };
    }

    const autoOpenOutcome = this.ensureSwitchTargetReady(entity);
    if (autoOpenOutcome) return autoOpenOutcome;

    const blockedOutcome = this.getBlockedAccessOutcome(entity);
    if (blockedOutcome) return blockedOutcome;

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
      scene.playPickupAnimation(entity);
      scene.removeEntity(entity);
      this.inventory.push(entity);
      const itemTitle = this.getPlayerFacingObjectTitle(entity);
      if (!itemTitle) {
        return {
          status: 'escalate',
          code: 'taken_item_missing_title',
          data: { entityId: entity.name },
          effects: ['moved_to_inventory'],
          recoverable: true,
        };
      }
      return {
        status: 'ok',
        code: 'item_taken',
        message: this.text('parser.take_pickup_success', {
          item: itemTitle,
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

  removeInventoryEntity(entity: Entity): GameActionOutcome {
    const index = this.inventory.indexOf(entity);
    if (index === -1) {
      return {
        status: 'failed',
        code: 'inventory_item_not_found',
        recoverable: true,
      };
    }

    this.inventory.splice(index, 1);
    return {
      status: 'ok',
      code: 'inventory_item_removed',
      data: { entityId: entity.name },
      effects: ['removed_from_inventory'],
    };
  }

  showInventory(): GameActionOutcome {
    const inventoryTitles = this.inventory
      .map((entity: any) => this.getPlayerFacingObjectTitle(entity))
      .filter((title): title is string => !!title);

    if (inventoryTitles.length !== this.inventory.length) {
      return {
        status: 'escalate',
        code: 'inventory_item_missing_title',
        data: {
          count: this.inventory.length,
        },
        recoverable: true,
      };
    }

    return {
      status: 'ok',
      code: 'inventory_list',
      message:
        this.inventory.length === 0
          ? this.text('parser.inventory_empty')
          : this.text('parser.inventory_items', {
              items: inventoryTitles.join(', '),
            }),
      data: {
        count: this.inventory.length,
      },
    };
  }

  goToSceneTarget(target: string): GameActionOutcome {
    const normalized = String(target || '')
      .trim()
      .toUpperCase();
    if (!normalized) {
      return {
        status: 'failed',
        code: 'destination_not_found',
        recoverable: true,
      };
    }

    for (const descriptor of this.sceneManager.sceneRegistry.values()) {
      if (
        descriptor.id.toUpperCase() === normalized ||
        descriptor.name.toUpperCase() === normalized ||
        (!!descriptor.title && descriptor.title.toUpperCase() === normalized)
      ) {
        return this.goToScene(descriptor.id);
      }
    }

    return {
      status: 'failed',
      code: 'destination_not_found',
      recoverable: true,
    };
  }

  goToScene(sceneId: string): GameActionOutcome {
    const currentScene = this.sceneManager.currentScene;
    const activeScene = this.sceneManager.scenes.get(sceneId);
    if (!activeScene && !this.sceneManager.sceneRegistry.get(sceneId)) {
      return {
        status: 'failed',
        code: 'destination_not_found',
        recoverable: true,
      };
    }

    this.sceneManager.switchTo(sceneId);
    const switchedScene = this.sceneManager.currentScene;
    return {
      status: 'ok',
      code: 'scene_switched',
      message:
        (switchedScene && this.textAssets.getResolvedSceneField(switchedScene, 'description')) ||
        switchedScene?.description ||
        undefined,
      data: { targetType: 'scene', sceneId },
      effects: currentScene?.id !== sceneId ? ['scene_changed'] : [],
    };
  }

  goToEntity(entity: Entity): GameActionOutcome {
    const currentScene = this.sceneManager.currentScene;
    if (currentScene?.player && 'x' in entity && 'y' in entity) {
      const entityTitle = this.getPlayerFacingObjectTitle(entity);
      if (!entityTitle) {
        return {
          status: 'escalate',
          code: 'destination_missing_title',
          data: { targetType: 'entity', entityId: entity.name },
          recoverable: true,
        };
      }
      currentScene.player.moveTo((entity as any).x, (entity as any).y);
      return {
        status: 'ok',
        code: 'player_moving',
        message: this.text('parser.go_to_success', {
          target: entityTitle,
        }),
        data: { targetType: 'entity', entityId: entity.name },
        effects: ['player_move_started'],
      };
    }

    return {
      status: 'failed',
      code: 'destination_not_found',
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

  openEntity(entity: SceneObject): GameActionOutcome {
    return this.executeSwitchStateChange(entity, 2);
  }

  closeEntity(entity: SceneObject): GameActionOutcome {
    return this.executeSwitchStateChange(entity, 1);
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
