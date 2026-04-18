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
import {
  buildSceneTextLayerSnapshot,
  getActiveBlockingComponentState,
  getInactiveSubsceneAncestors,
  getSceneTextRelationDescendants,
  getSceneTextLayerAccessState,
  getSceneTextRelationAccessStates,
  getSceneTextTargetDescriptor,
} from '../scene/SceneTextLayer';

import type { IGame } from './IGame';
import { InventoryManager } from './InventoryManager';
import type { Scene } from '../scene/Scene';
import type { SpatialRelationType } from '../scene/spatialTypes';
import { GAME_DESIGN_HEIGHT, GAME_DESIGN_WIDTH } from './Resolution';
import { Geometry } from '../utils/Geometry';

type EditorViewportZoom = 'fit' | '1' | '1.5' | '2';
type PutTargetTextDescriptor = {
  title: string;
  relation: SpatialRelationType;
};

type RelationScopedTakeCandidates =
  | { status: 'resolved'; candidates: Entity[]; hasStorage: boolean }
  | GameActionOutcome;

export class Game implements IGame {
  public static instance: Game;

  canvas: HTMLCanvasElement; // UI Canvas
  editorOverlayCanvas: HTMLCanvasElement | null;
  rendererCanvas: HTMLCanvasElement; // High-Res Display (WebGL)
  bufferCanvas: HTMLCanvasElement; // Design-resolution buffer (Internal)

  ctx: CanvasRenderingContext2D | null;
  rendererCtx: CanvasRenderingContext2D | null; // For simple 2D upscale if CRT disabled
  uiCtx: CanvasRenderingContext2D | null;
  editorOverlayCtx: CanvasRenderingContext2D | null;

  crtFilter: CRTFilter | null;
  lastTime: number;
  isRunning: boolean;

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

  /** Manages all inventory/surface storage state and logic. */
  inventoryManager: InventoryManager;

  // ─── inventory getter-proxy (Q2-A: all external call-sites unchanged) ────
  get inventory(): Entity[] {
    return this.inventoryManager.inventory;
  }
  set inventory(value: Entity[]) {
    this.inventoryManager.inventory = value;
  }

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
    this.bufferCanvas.width = GAME_DESIGN_WIDTH;
    this.bufferCanvas.height = GAME_DESIGN_HEIGHT;
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

    // Disable smoothing for pixel art look
    if (this.ctx) this.ctx.imageSmoothingEnabled = false;
    if (this.uiCtx) this.uiCtx.imageSmoothingEnabled = false;
    if (this.editorOverlayCtx) this.editorOverlayCtx.imageSmoothingEnabled = true;

    // (Previously corrupted lines removed)
    this.input = new Input(this);
    this.console = new Console(this); // Init Console with Game Reference

    // Load Settings from LocalStorage (after console exists for safe diagnostics elsewhere)
    this.loadSettings();

    this.parser = new Parser(this);
    this.assets = new AssetLoader();
    this.audio = new AudioManager();
    this.textAssets = new TextAssetManager();
    void this.textAssets.preloadServiceAssets();
    void this.textAssets.preloadParserLanguageAssets();
    this.sceneManager = new SceneManager(this);

    // Initialize InventoryManager after sceneManager and textAssets are ready
    this.inventoryManager = new InventoryManager(
      this.sceneManager,
      this.textAssets,
      this.text.bind(this)
    );

    if (typeof window !== 'undefined') {
      const debugWindow = window as Window & {
        __QUEST_DEBUG__?: Record<string, unknown>;
      };
      debugWindow.__QUEST_DEBUG__ = {
        ...(debugWindow.__QUEST_DEBUG__ || {}),
        game: this,
        profileCurrentSceneMemory: () => this.sceneManager.profileCurrentSceneMemory(),
        profileScenes: (sceneIds: string[]) => this.sceneManager.profileScenes(sceneIds),
        enablePutDebug: () => {
          this.inventoryManager.enablePutDebug();
        },
        disablePutDebug: () => {
          this.inventoryManager.disablePutDebug();
        },
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
        // Make CRT parameters resolution-aware so the effect is consistent
        // before/after editor layout resizes the renderer canvas.
        //
        // - scanlineCount is "number of scanlines across screen height"
        // - aberration is effectively in pixels in the shader, so scale with width
        const designW = GAME_DESIGN_WIDTH;
        const designH = GAME_DESIGN_HEIGHT;
        const scaleX = this.rendererCanvas?.width ? this.rendererCanvas.width / designW : 1;
        const scaleY = this.rendererCanvas?.height ? this.rendererCanvas.height / designH : 1;
        const effectiveSettings = {
          ...settings,
          scanlineCount: (settings.scanlineCount || 0) * scaleY,
          aberration: (settings.aberration || 0) * scaleX,
        };
        this.crtFilter.render(this.bufferCanvas, effectiveSettings);
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

  // ─── Inventory UI / Preview delegates ───────────────────────────────────

  private notifyInventoryUiChange(): void {
    this.inventoryManager.notifyInventoryUiChange();
  }

  subscribeInventoryUi(listener: () => void): () => void {
    return this.inventoryManager.subscribeInventoryUi(listener);
  }

  private reconcileInventoryPreview(): void {
    this.inventoryManager.reconcileInventoryPreview();
  }

  getInventoryPreviewEntity(): Entity | null {
    return this.inventoryManager.getInventoryPreviewEntity();
  }

  getInventoryPreviewText(): string | null {
    return this.inventoryManager.getInventoryPreviewText();
  }

  openInventoryPreview(entity: Entity, previewText?: string | null): void {
    this.inventoryManager.openInventoryPreview(entity, previewText);
  }

  closeInventoryPreview(): void {
    this.inventoryManager.closeInventoryPreview();
  }

  closeFocusedView(): GameActionOutcome {
    const previewEntity = this.getInventoryPreviewEntity();
    if (previewEntity) {
      this.closeInventoryPreview();
      return {
        status: 'ok',
        code: 'inventory_preview_closed',
        data: { entityId: previewEntity.name },
        effects: ['inventory_preview_closed'],
      };
    }

    const scene = this.sceneManager.currentScene;
    if (scene?.activeSubscene) {
      const subsceneId = scene.activeSubscene;
      scene.activeSubscene = null;
      return {
        status: 'ok',
        code: 'subscene_closed',
        data: { subsceneId },
        effects: ['subscene_closed'],
      };
    }

    return {
      status: 'escalate',
      code: 'no_active_view_to_close',
      recoverable: true,
    };
  }

  private getPutSuccessMessage(
    itemTitle: string,
    targetTitle: string,
    relation: SpatialRelationType
  ): string {
    switch (relation) {
      case 'in':
        return this.text('parser.put_success_inventory', {
          item: itemTitle,
          target: targetTitle,
        });
      case 'under':
        return this.text('parser.put_success_under', {
          item: itemTitle,
          target: targetTitle,
        });
      case 'behind':
        return this.text('parser.put_success_behind', {
          item: itemTitle,
          target: targetTitle,
        });
      case 'on':
      default:
        return this.text('parser.put_success_surface', {
          item: itemTitle,
          target: targetTitle,
        });
    }
  }

  private getPutTargetDescriptor(
    target: SceneObject | null | undefined,
    fallbackRelation?: SpatialRelationType | null
  ): PutTargetTextDescriptor | null {
    const scene = this.sceneManager.currentScene;
    if (!scene) return null;
    return getSceneTextTargetDescriptor(scene, this, target, fallbackRelation);
  }

  private getSurfaceDropMessage(
    surface: SceneObject,
    item: Entity,
    relation: SpatialRelationType | null
  ): string {
    const itemTitle = this.getPlayerFacingObjectTitle(item) || item.name;
    const target = this.getPutTargetDescriptor(surface, relation);
    if (target) {
      return this.getPutSuccessMessage(itemTitle, target.title, target.relation);
    }

    return this.text('parser.drop_success', { item: itemTitle });
  }

  private getSurfacePutMessage(
    surface: SceneObject,
    item: Entity,
    relation: SpatialRelationType | null,
    target?: SceneObject | null
  ): string {
    if (!target) return this.getSurfaceDropMessage(surface, item, relation);

    const itemTitle = this.getPlayerFacingObjectTitle(item) || item.name;
    if (surface.type === 'Walkbox' || target.type === 'Walkbox') {
      return this.text('parser.put_success_surface', {
        item: itemTitle,
        target: this.text('engine.floor_label'),
      });
    }

    const textTarget =
      this.getPutTargetDescriptor(target, relation) ||
      this.getPutTargetDescriptor(surface, relation);

    if (!textTarget) return this.getSurfaceDropMessage(surface, item, relation);

    return this.getPutSuccessMessage(itemTitle, textTarget.title, textTarget.relation);
  }

  private getPutTargetTitle(target: SceneObject | null | undefined): string | null {
    return this.getPutTargetDescriptor(target)?.title || null;
  }

  private getPutDistanceFailure(
    storageObject: SceneObject,
    anchor?: SceneObject | null
  ): GameActionOutcome | null {
    const scene = this.sceneManager.currentScene;
    if (!scene) return null;

    const distanceProbe = anchor || storageObject;
    const distanceError = ComponentSystem.getInteractionDistanceError(
      distanceProbe as any,
      scene.player
    );
    if (!distanceError) return null;

    const targetTitle = this.getPutTargetTitle(distanceProbe);
    return {
      status: 'failed',
      code: 'put_target_too_far',
      message: targetTitle
        ? this.text('engine.too_far_from_entity', { target: targetTitle })
        : distanceError,
      data: { targetId: distanceProbe.name, storageId: storageObject.name },
      recoverable: true,
    };
  }

  private getPutAccessibilityFailure(
    storageObject: SceneObject,
    anchor?: SceneObject | null
  ): GameActionOutcome | null {
    const scene = this.sceneManager.currentScene;
    if (!scene) return null;

    const blockedOutcome = this.getBlockedAccessOutcome(storageObject);
    if (blockedOutcome) return blockedOutcome;

    const distanceFailure = this.getPutDistanceFailure(storageObject, anchor);
    if (distanceFailure) return distanceFailure;

    return null;
  }

  private getAutoDropUnavailableFailure(): GameActionOutcome | null {
    const scene = this.sceneManager.currentScene;
    if (!scene) return null;

    const surfaces = scene
      .getAllSceneObjects()
      .filter((candidate) => !!ComponentSystem.getSurfaceComponent(candidate, 'on'))
      .sort((left, right) => {
        const a = this.getSceneObjectReferencePoint(left);
        const b = this.getSceneObjectReferencePoint(right);
        const player = scene.player;
        const aDistance = player ? Math.hypot(player.x - a.x, player.y - a.y) : 0;
        const bDistance = player ? Math.hypot(player.x - b.x, player.y - b.y) : 0;
        if (aDistance !== bDistance) return aDistance - bDistance;
        return left.name.localeCompare(right.name);
      });

    const playerPoint = scene.player ? { x: scene.player.x || 0, y: scene.player.y || 0 } : null;
    const subsceneContained = scene.activeSubscene
      ? surfaces.filter(
          (surface) => this.isObjectInsideActiveSubscene(surface) && surface.type !== 'Walkbox'
        )
      : [];
    const subsceneWalkboxes = scene.activeSubscene
      ? surfaces.filter(
          (surface) => this.isObjectInsideActiveSubscene(surface) && surface.type === 'Walkbox'
        )
      : [];
    const containingWalkboxes =
      playerPoint && scene.activeSubscene
        ? surfaces.filter(
            (surface) =>
              surface.type === 'Walkbox' &&
              Array.isArray((surface as any).poly) &&
              Geometry.isPointInPolygon(playerPoint, (surface as any).poly)
          )
        : [];
    const orderedSurfaces = subsceneContained.length
      ? subsceneContained
      : subsceneWalkboxes.length
        ? subsceneWalkboxes
        : containingWalkboxes.length
          ? containingWalkboxes
          : surfaces;

    for (const surface of orderedSurfaces) {
      const blockedOutcome = this.getBlockedAccessOutcome(surface);
      if (blockedOutcome) continue;

      const distanceFailure = this.getPutDistanceFailure(surface);
      if (distanceFailure) return distanceFailure;
    }

    return null;
  }

  private getPutMoveFailureMessage(
    moveOutcome: GameActionOutcome,
    entity: Entity,
    storageObject: SceneObject,
    relation: SpatialRelationType | null,
    anchor?: SceneObject | null
  ): string | null {
    const itemTitle = this.getPlayerFacingObjectTitle(entity) || entity.name;
    const target = this.getPutTargetDescriptor(anchor || storageObject, relation);
    const targetTitle = target?.title || null;
    const targetRelation = target?.relation || (relation === 'in' ? 'in' : 'on');

    if (!targetTitle) {
      return moveOutcome.message || null;
    }

    if (moveOutcome.code === 'inventory_full') {
      return this.text('parser.put_target_full_in', { target: targetTitle });
    }

    if (moveOutcome.code === 'surface_full') {
      return this.text(
        targetRelation === 'in' ? 'parser.put_target_full_in' : 'parser.put_target_full_on',
        { target: targetTitle }
      );
    }

    if (moveOutcome.code === 'surface_no_fit') {
      return this.text(
        targetRelation === 'in' ? 'parser.put_target_no_fit_in' : 'parser.put_target_no_fit_on',
        { item: itemTitle, target: targetTitle }
      );
    }

    return moveOutcome.message || null;
  }

  private withPutFailureContext(
    moveOutcome: GameActionOutcome,
    entity: Entity,
    storageObject: SceneObject,
    relation: SpatialRelationType | null,
    anchor?: SceneObject | null
  ): GameActionOutcome {
    const contextualMessage = this.getPutMoveFailureMessage(
      moveOutcome,
      entity,
      storageObject,
      relation,
      anchor
    );
    return contextualMessage ? { ...moveOutcome, message: contextualMessage } : moveOutcome;
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

  private getSemanticHiddenMode(target: SceneObject): false | 'lookable' | 'examinable' {
    return target.hidden === 'lookable' || target.hidden === 'examinable' ? target.hidden : false;
  }

  private revealHiddenEntityForIntent(entity: SceneObject, intent: 'look' | 'examine'): boolean {
    const scene = this.sceneManager.currentScene;
    if (!scene) return false;
    const hiddenMode = this.getSemanticHiddenMode(entity);
    if (!hiddenMode) return false;
    if (scene.isHiddenEntityRevealed(entity)) return false;
    if (intent === 'look' && hiddenMode !== 'lookable') return false;
    scene.revealHiddenEntity(entity);
    return true;
  }

  getSeeMessage(target: SceneObject): string | null {
    this.revealHiddenEntityForIntent(target, 'look');
    const scene = this.sceneManager.currentScene;
    if (
      scene &&
      this.getSemanticHiddenMode(target) === 'examinable' &&
      !scene.isHiddenEntityRevealed(target)
    ) {
      return null;
    }
    return this.getSpatialParentMessage(target) || null;
  }

  // ─── Inventory / Surface storage delegates ───────────────────────────────
  // All state and logic lives in InventoryManager. Game provides callback
  // functions that InventoryManager needs (blocked access, switch component,
  // player-facing title) to avoid circular dependencies.

  private isEntityInInventory(entity: Entity): boolean {
    return this.inventoryManager.isEntityInInventory(entity);
  }

  private findInventoryOwnerForEntity(entity: Entity): Entity | null {
    return this.inventoryManager.findInventoryOwnerForEntity(entity);
  }

  private syncPlayerInventoryComponent(): void {
    this.inventoryManager.syncPlayerInventoryComponent();
  }

  private clearInheritedSurfaceSwitchGroups(entity: Entity): void {
    this.inventoryManager.clearInheritedSurfaceSwitchGroups(entity);
  }

  private clearActiveContainerSwitchGroups(entity: Entity): void {
    this.inventoryManager.clearActiveContainerSwitchGroups(
      entity,
      this.getSwitchComponent.bind(this)
    );
  }

  private getContainingSubsceneRootIds(entity: SceneObject): string[] {
    return this.inventoryManager.getContainingSubsceneRootIds(entity);
  }

  private markEntityDetachedFromSubscenes(entity: Entity, subsceneRootIds: string[]): void {
    this.inventoryManager.markEntityDetachedFromSubscenes(entity, subsceneRootIds);
  }

  private isSurfaceAccessible(surface: SceneObject): boolean {
    return this.inventoryManager.isSurfaceAccessible(
      surface,
      this.getBlockedAccessOutcome.bind(this)
    );
  }

  private isSurfaceAccessibleFromAnchor(surface: SceneObject, anchor: SceneObject): boolean {
    return this.inventoryManager.isSurfaceAccessibleFromAnchor(
      surface,
      anchor,
      this.getBlockedAccessOutcome.bind(this),
      this.getPlayerFacingObjectTitle.bind(this)
    );
  }

  private isInventoryAccessible(
    owner: Entity,
    relation: Exclude<SpatialRelationType, 'near'> = 'in'
  ): boolean {
    return this.inventoryManager.isInventoryAccessible(
      owner,
      this.getBlockedAccessOutcome.bind(this),
      relation
    );
  }

  private isInventoryAccessibleFromAnchor(
    owner: Entity,
    anchor: SceneObject,
    relation: Exclude<SpatialRelationType, 'near'> = 'in'
  ): boolean {
    return this.inventoryManager.isInventoryAccessibleFromAnchor(
      owner,
      anchor,
      this.getBlockedAccessOutcome.bind(this),
      this.getPlayerFacingObjectTitle.bind(this),
      relation
    );
  }

  getAccessibleInventoryItems(): Entity[] {
    return this.inventoryManager.getAccessibleInventoryItems(
      this.getBlockedAccessOutcome.bind(this)
    );
  }

  private removeEntityFromCurrentStorage(entity: Entity): void {
    this.inventoryManager.removeEntityFromCurrentStorage(entity);
  }

  private isObjectInsideActiveSubscene(object: SceneObject): boolean {
    return this.inventoryManager.isObjectInsideActiveSubscene(object);
  }

  private getSceneObjectReferencePoint(sceneObject: SceneObject): { x: number; y: number } {
    return this.inventoryManager.getSceneObjectReferencePoint(sceneObject);
  }

  private shouldFacePlayerTowardObservedObject(entity: SceneObject): boolean {
    const scene = this.sceneManager.currentScene;
    if (!scene) return false;
    if (entity instanceof Entity && this.isEntityInInventory(entity)) return false;
    if (this.isObjectInsideActiveSubscene(entity)) return false;
    if (getInactiveSubsceneAncestors(scene, entity).length > 0) return false;
    return true;
  }

  private facePlayerTowardObservedObject(entity: SceneObject): void {
    if (!this.shouldFacePlayerTowardObservedObject(entity)) return;

    const scene = this.sceneManager.currentScene;
    const player = scene?.player;
    if (!player || typeof (player as any).setDirection !== 'function') return;

    const target = this.getSceneObjectReferencePoint(entity);
    const dx = target.x - (player as any).x;
    const dy = target.y - (player as any).y;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;

    if (Math.abs(dx) >= Math.abs(dy)) {
      (player as any).setDirection(dx >= 0 ? 'right' : 'left');
      return;
    }

    (player as any).setDirection(dy >= 0 ? 'down' : 'up');
  }

  private findPreferredSurfaceForRelation(
    anchor: SceneObject,
    relation: SpatialRelationType | null | undefined,
    requireAccessible: boolean = true
  ) {
    return this.inventoryManager.findPreferredSurfaceForRelation(
      anchor,
      relation,
      this.getBlockedAccessOutcome.bind(this),
      this.getPlayerFacingObjectTitle.bind(this),
      requireAccessible
    );
  }

  private findPreferredStorageForRelation(
    anchor: SceneObject,
    relation: SpatialRelationType,
    requireAccessible: boolean = true
  ) {
    return this.inventoryManager.findPreferredStorageForRelation(
      anchor,
      relation,
      this.getBlockedAccessOutcome.bind(this),
      this.getPlayerFacingObjectTitle.bind(this),
      requireAccessible
    );
  }

  hasPutStorageForRelation(target: SceneObject, relation: SpatialRelationType | null): boolean {
    if (relation !== 'in' && relation !== 'on' && relation !== 'under' && relation !== 'behind') {
      return false;
    }
    const storage = this.findPreferredStorageForRelation(target, relation, false);
    return !!storage.inventory || !!storage.surface;
  }

  getRelationScopedTakeCandidates(
    anchor: SceneObject,
    relation: SpatialRelationType | 'near'
  ): RelationScopedTakeCandidates {
    const scene = this.sceneManager.currentScene;
    if (!scene || relation === 'near') {
      return { status: 'resolved', candidates: [], hasStorage: false };
    }

    const storageCandidates = this.inventoryManager.findStorageCandidatesForRelation(
      anchor,
      relation,
      this.getBlockedAccessOutcome.bind(this),
      this.getPlayerFacingObjectTitle.bind(this),
      false
    );
    const accessibleInventories = storageCandidates.inventoryOwners.filter((storage) =>
      this.isInventoryAccessibleFromAnchor(storage.owner, anchor, storage.relation)
    );
    const accessibleSurfaces = storageCandidates.surfaces.filter((storage) =>
      this.isSurfaceAccessibleFromAnchor(storage.surface, anchor)
    );

    const textLayer = buildSceneTextLayerSnapshot(scene, this);
    const getRelationCandidates = (candidateRelation: SpatialRelationType) =>
      getSceneTextRelationDescendants(textLayer, anchor.name, candidateRelation)
        .map((entry) => entry.object)
        .filter((candidate): candidate is Entity => candidate instanceof Entity)
        .filter((candidate) => !candidate.disabled)
        .filter(
          (candidate) =>
            candidate.components?.some((component: any) => component?.type === 'Item') ||
            candidate.isTakeable
        );
    let directCandidates = getRelationCandidates(relation);

    if (relation === 'in' && !directCandidates.length) {
      const relationOutcome = this.describeSpatialRelation(anchor.name, 'in');
      if (relationOutcome.status === 'failed') {
        return relationOutcome;
      }

      directCandidates = ['on', 'under', 'behind'].flatMap((candidateRelation) =>
        getRelationCandidates(candidateRelation as SpatialRelationType)
      );
    }

    const semanticContents = getSceneTextRelationDescendants(textLayer, anchor.name, relation);
    const fallbackSemanticContents =
      relation === 'in' && !semanticContents.length
        ? ['on', 'under', 'behind'].flatMap((candidateRelation) =>
            getSceneTextRelationDescendants(
              textLayer,
              anchor.name,
              candidateRelation as SpatialRelationType
            )
          )
        : [];

    if (accessibleInventories.length || accessibleSurfaces.length) {
      const candidates: Entity[] = [];
      for (const storage of accessibleInventories) {
        candidates.push(...this.getInventoryEntities(storage.owner, storage.relation));
      }
      for (const storage of accessibleSurfaces) {
        candidates.push(
          ...this.inventoryManager.getSurfaceEntities(storage.surface, storage.relation)
        );
      }
      candidates.push(...directCandidates);
      return {
        status: 'resolved',
        candidates: Array.from(new Set(candidates)),
        hasStorage: true,
      };
    }

    if (directCandidates.length) {
      return {
        status: 'resolved',
        candidates: directCandidates,
        hasStorage: true,
      };
    }

    for (const storage of [...storageCandidates.inventoryOwners, ...storageCandidates.surfaces]) {
      const storageObject = 'owner' in storage ? storage.owner : storage.surface;
      const blockedOutcome = this.getBlockedAccessOutcome(storageObject);
      if (blockedOutcome) return blockedOutcome;
    }

    return {
      status: 'resolved',
      candidates: [],
      hasStorage:
        semanticContents.length > 0 ||
        fallbackSemanticContents.length > 0 ||
        storageCandidates.inventoryOwners.length > 0 ||
        storageCandidates.surfaces.length > 0,
    };
  }

  isEntityInPutTarget(
    source: SceneObject,
    target: SceneObject,
    relation: SpatialRelationType | 'near' | null
  ): boolean {
    if (!(source instanceof Entity)) return false;

    if (relation === 'in' || relation === 'on' || relation === 'under' || relation === 'behind') {
      const storage = this.findPreferredStorageForRelation(target, relation, false);
      if (
        storage.inventory &&
        this.getInventoryEntities(storage.inventory.owner, storage.inventory.relation).includes(
          source
        )
      ) {
        return true;
      }
      if (
        storage.surface &&
        this.inventoryManager
          .getSurfaceEntities(storage.surface.surface, storage.surface.relation)
          .includes(source)
      ) {
        return true;
      }
    }

    const scene = this.sceneManager.currentScene;
    if (!scene) return false;
    const textLayer = buildSceneTextLayerSnapshot(scene, this);
    const semanticRelation =
      relation === 'in' || relation === 'on' || relation === 'under' || relation === 'behind'
        ? relation
        : null;
    const relations: SpatialRelationType[] = semanticRelation
      ? [semanticRelation]
      : ['in', 'on', 'under', 'behind'];

    return relations.some((candidateRelation) =>
      getSceneTextRelationDescendants(textLayer, target.name, candidateRelation).some(
        (entry) => entry.object === source
      )
    );
  }

  private getAutoDropSurface() {
    return this.inventoryManager.getAutoDropSurface(this.getBlockedAccessOutcome.bind(this));
  }

  getInventoryEntities(
    owner: Entity,
    relation: Exclude<SpatialRelationType, 'near'> = 'in'
  ): Entity[] {
    return this.inventoryManager.getInventoryEntities(owner, relation);
  }

  getSurfaceEntities(
    surface: SceneObject,
    relation: Exclude<SpatialRelationType, 'near'> = 'on'
  ): Entity[] {
    return this.inventoryManager.getSurfaceEntities(surface, relation);
  }

  hasInventoryEntity(
    owner: Entity,
    entity: Entity,
    relation: Exclude<SpatialRelationType, 'near'> = 'in'
  ): boolean {
    return this.inventoryManager.hasInventoryEntity(owner, entity, relation);
  }

  addInventoryEntity(
    owner: Entity,
    entity: Entity,
    relation: Exclude<SpatialRelationType, 'near'> = 'in'
  ): GameActionOutcome {
    return this.inventoryManager.addInventoryEntity(owner, entity, relation);
  }

  removeEntityFromInventory(
    owner: Entity,
    entity: Entity,
    relation: Exclude<SpatialRelationType, 'near'> = 'in'
  ): GameActionOutcome {
    return this.inventoryManager.removeEntityFromInventory(owner, entity, relation);
  }

  addEntityToSurface(
    surface: SceneObject,
    entity: Entity,
    relation: Exclude<SpatialRelationType, 'near'> = 'on',
    options: { preferPlayerPoint?: boolean } = {}
  ): GameActionOutcome {
    return this.inventoryManager.addEntityToSurface(
      surface,
      entity,
      relation,
      this.getSwitchComponent.bind(this),
      options
    );
  }

  removeEntityFromSurface(
    surface: SceneObject,
    entity: Entity,
    relation: Exclude<SpatialRelationType, 'near'> = 'on'
  ): GameActionOutcome {
    return this.inventoryManager.removeEntityFromSurface(surface, entity, relation);
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
    if (entity instanceof Entity && this.isEntityInInventory(entity)) return null;

    const scene = this.sceneManager.currentScene;
    if (!scene) return null;
    const accessState = getSceneTextLayerAccessState(scene, this, entity);
    if (!accessState.blocked && !accessState.hidden) return null;

    const closedMessage =
      accessState.gatingSwitchClearlyOpenable && accessState.gatingSwitchTitle
        ? this.text('engine.closed_container', { target: accessState.gatingSwitchTitle })
        : null;

    if (accessState.hidden) {
      if (accessState.hiddenReason === 'lookable' || accessState.hiddenReason === 'examinable') {
        return {
          status: 'failed',
          code: 'hidden_semantic_target',
          message: this.text('parser.look_not_found', {
            target: this.getPlayerFacingObjectTitle(entity) || entity.name,
          }),
          data: { entityId: entity.name },
          recoverable: true,
        };
      }
      return {
        status: 'failed',
        code: accessState.gatingSwitchClearlyOpenable
          ? 'blocked_by_closed_container'
          : 'cannot_reach_hidden_target',
        message: closedMessage || this.text('engine.cant_reach_generic'),
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    return {
      status: 'failed',
      code: 'blocked_inside_closed',
      message: accessState.gatingSwitchClearlyOpenable
        ? this.text('engine.blocked_inside_closed')
        : this.text('engine.cant_reach_generic'),
      data: { entityId: entity.name },
      recoverable: true,
    };
  }

  private executeSwitchStateChange(entity: SceneObject, desiredState: 1 | 2): GameActionOutcome {
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
        message: this.text(desiredState === 2 ? 'parser.open_already' : 'parser.close_already', {
          target: title,
        }),
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
    this.revealHiddenEntityForIntent(entity, 'look');
    const autoOpenOutcome = this.ensureSwitchTargetReady(entity);
    if (autoOpenOutcome) return autoOpenOutcome;

    const blockedOutcome = this.getBlockedAccessOutcome(entity);
    if (blockedOutcome) return blockedOutcome;

    this.facePlayerTowardObservedObject(entity);

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
    this.revealHiddenEntityForIntent(entity, 'examine');
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

    this.facePlayerTowardObservedObject(entity);

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
      if (entity instanceof Entity && this.isEntityInInventory(entity)) {
        this.openInventoryPreview(entity, details);
      }
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
      if (entity instanceof Entity && this.isEntityInInventory(entity)) {
        this.openInventoryPreview(entity, description);
      }
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

    const anchorObject = scene.getObjectByName(anchorNodeId);
    const blockingComponent = anchorObject
      ? getActiveBlockingComponentState(anchorObject, relation)
      : null;
    if (blockingComponent && !blockingComponent.transparent) {
      if (blockingComponent.clearlyOpenable) {
        return {
          status: 'failed',
          code: 'blocked_by_closed_container',
          message: this.text('engine.closed_container', { target: anchorTitle }),
          data: { relation, anchorNodeId },
          recoverable: true,
        };
      }
    }

    let childTitles =
      getSceneTextRelationDescendants(
        textLayer,
        anchorNodeId,
        relation as Exclude<SpatialRelationType, 'near'>
      )
        ?.map((entry) => entry.title)
        .filter((title): title is string => !!title) || [];

    const revealableLookables = getSceneTextRelationAccessStates(
      scene,
      this,
      anchorNodeId,
      relation as Exclude<SpatialRelationType, 'near'>,
      { includeHidden: true }
    ).filter((accessState) => accessState.hiddenReason === 'lookable');
    if (revealableLookables.length) {
      revealableLookables.forEach((accessState) => scene.revealHiddenEntity(accessState.object));
      const revealedTextLayer = buildSceneTextLayerSnapshot(scene, this);
      childTitles =
        getSceneTextRelationDescendants(
          revealedTextLayer,
          anchorNodeId,
          relation as Exclude<SpatialRelationType, 'near'>
        )
          ?.map((entry) => entry.title)
          .filter((title): title is string => !!title) || [];
    }

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

    if (this.isEntityInInventory(entity)) {
      return {
        status: 'failed',
        code: 'item_already_held',
        message: this.text('parser.take_already_held', {
          item: this.getPlayerFacingObjectTitle(entity) || entity.name,
        }),
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    const autoOpenOutcome = this.ensureSwitchTargetReady(entity);
    if (autoOpenOutcome) return autoOpenOutcome;

    const inventoryOwner = this.findInventoryOwnerForEntity(entity);
    if (!inventoryOwner) {
      const blockedOutcome = this.getBlockedAccessOutcome(entity);
      if (blockedOutcome) return blockedOutcome;
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
      if (inventoryOwner && !this.isInventoryAccessible(inventoryOwner)) {
        return {
          status: 'failed',
          code: 'inventory_not_accessible',
          message: this.text('parser.take_cannot'),
          data: { entityId: entity.name, ownerId: inventoryOwner.name },
          recoverable: true,
        };
      }

      const player = scene.player instanceof Entity ? scene.player : null;
      if (!this.inventoryManager.hasMainInventory(player)) {
        return {
          status: 'failed',
          code: 'player_inventory_missing',
          message: this.text('parser.inventory_missing'),
          data: { entityId: entity.name, ownerId: player?.name },
          recoverable: true,
        };
      }

      scene.finishDropAnimation(entity);
      const containingSubsceneRootIds = this.getContainingSubsceneRootIds(entity);

      if (inventoryOwner) {
        this.removeEntityFromInventory(inventoryOwner, entity);
      }

      this.removeEntityFromCurrentStorage(entity);

      this.clearInheritedSurfaceSwitchGroups(entity);
      this.clearActiveContainerSwitchGroups(entity);
      scene.playPickupAnimation(entity);
      scene.subsceneEntities.delete(entity);
      this.markEntityDetachedFromSubscenes(entity, containingSubsceneRootIds);
      entity.subsceneItemScale = 1;
      this.inventory.push(entity);
      this.syncPlayerInventoryComponent();
      entity.update(0);
      this.notifyInventoryUiChange();
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

  canTakeEntity(entity: Entity): GameActionOutcome | null {
    const scene = this.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        message: this.text('parser.parse_unknown'),
        recoverable: false,
      };
    }

    if (this.isEntityInInventory(entity)) {
      return {
        status: 'failed',
        code: 'item_already_held',
        message: this.text('parser.take_already_held', {
          item: this.getPlayerFacingObjectTitle(entity) || entity.name,
        }),
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    const inventoryOwner = this.findInventoryOwnerForEntity(entity);
    if (!inventoryOwner) {
      const blockedOutcome = this.getBlockedAccessOutcome(entity);
      if (blockedOutcome) return blockedOutcome;
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
    if (!(isItem || entity.isTakeable)) {
      return {
        status: 'failed',
        code: 'not_takeable',
        message: this.text('parser.take_cannot'),
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    if (inventoryOwner && !this.isInventoryAccessible(inventoryOwner)) {
      return {
        status: 'failed',
        code: 'inventory_not_accessible',
        message: this.text('parser.take_cannot'),
        data: { entityId: entity.name, ownerId: inventoryOwner.name },
        recoverable: true,
      };
    }

    if (!this.inventoryManager.hasMainInventory(scene.player)) {
      return {
        status: 'failed',
        code: 'player_inventory_missing',
        message: this.text('parser.inventory_missing'),
        data: { entityId: entity.name, ownerId: scene.player?.name },
        recoverable: false,
      };
    }
    return null;
  }

  private getPuttableSourceFailure(entity: Entity): GameActionOutcome | null {
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

    const inventoryOwner = this.findInventoryOwnerForEntity(entity);
    if (!inventoryOwner) {
      const blockedOutcome = this.getBlockedAccessOutcome(entity);
      if (blockedOutcome) return blockedOutcome;
    }

    const errorMsg = ComponentSystem.canTakeItem(entity, scene.player);
    if (errorMsg) {
      return {
        status: 'failed',
        code: 'put_source_not_accessible',
        message: errorMsg,
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    const isItem = entity.components?.some((component: any) => component?.type === 'Item');
    if (!isItem && !entity.isTakeable) {
      return {
        status: 'failed',
        code: 'not_takeable',
        message: this.text('parser.take_cannot'),
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    if (inventoryOwner && !this.isInventoryAccessible(inventoryOwner)) {
      return {
        status: 'failed',
        code: 'inventory_not_accessible',
        message: this.text('parser.take_cannot'),
        data: { entityId: entity.name, ownerId: inventoryOwner.name },
        recoverable: true,
      };
    }
    return null;
  }

  canPutSourceEntity(entity: Entity): GameActionOutcome | null {
    if (this.isEntityInInventory(entity)) return null;
    return this.getPuttableSourceFailure(entity);
  }

  putEntity(
    entity: Entity,
    target?: SceneObject | null,
    options?: { relation?: SpatialRelationType | null }
  ): GameActionOutcome {
    if (target === entity) {
      return {
        status: 'failed',
        code: 'put_target_is_source',
        message: this.text('parser.put_no_place'),
        recoverable: true,
      };
    }
    const sourceInInventory = this.isEntityInInventory(entity);
    if (!sourceInInventory && !target) {
      return {
        status: 'failed',
        code: 'put_item_not_held',
        message: this.text('parser.put_item_not_held', {
          item: this.getPlayerFacingObjectTitle(entity) || entity.name,
        }),
        recoverable: true,
      };
    }
    if (!sourceInInventory) {
      const sourceFailure = this.getPuttableSourceFailure(entity);
      if (sourceFailure) return sourceFailure;
    }

    const relation = options?.relation || null;
    let destinationSurface: {
      surface: SceneObject;
      relation: Exclude<SpatialRelationType, 'near'>;
    } | null = null;
    let destinationInventory: {
      owner: Entity;
      relation: Exclude<SpatialRelationType, 'near'>;
    } | null = null;

    if (!target) {
      const autoDropSurface = this.getAutoDropSurface();
      destinationSurface = autoDropSurface
        ? {
            surface: autoDropSurface.surface,
            relation: autoDropSurface.relation,
          }
        : null;
      if (!destinationSurface) {
        const autoDropFailure = this.getAutoDropUnavailableFailure();
        if (autoDropFailure) return autoDropFailure;
      }
    } else if (
      relation === 'in' ||
      relation === 'on' ||
      relation === 'under' ||
      relation === 'behind'
    ) {
      const storage = this.findPreferredStorageForRelation(target, relation, false);
      destinationInventory = storage.inventory
        ? {
            owner: storage.inventory.owner,
            relation: storage.inventory.relation,
          }
        : null;
      destinationSurface = storage.surface
        ? {
            surface: storage.surface.surface,
            relation: storage.surface.relation,
          }
        : null;
    } else {
      const directInventory =
        target instanceof Entity ? ComponentSystem.getInventoryComponent(target) : null;
      if (target instanceof Entity && directInventory) {
        destinationInventory = {
          owner: target,
          relation: ComponentSystem.normalizeInventoryRelation(directInventory),
        };
      } else {
        const surfaceSlot = this.findPreferredSurfaceForRelation(target, 'on', false);
        destinationSurface = surfaceSlot
          ? {
              surface: surfaceSlot.surface,
              relation: surfaceSlot.relation,
            }
          : null;
      }
    }

    if (target && (destinationInventory || destinationSurface)) {
      const targetDistanceFailure = this.getPutDistanceFailure(target, target);
      if (targetDistanceFailure) return targetDistanceFailure;
    }

    if (destinationInventory) {
      const inventoryAccessible =
        relation && target
          ? this.isInventoryAccessibleFromAnchor(
              destinationInventory.owner,
              target,
              destinationInventory.relation
            )
          : this.isInventoryAccessible(destinationInventory.owner, destinationInventory.relation);
      if (!inventoryAccessible) {
        const accessFailure = this.getPutAccessibilityFailure(destinationInventory.owner, target);
        return {
          ...(accessFailure || {
            status: 'failed',
            code: 'put_target_not_accessible',
            message: this.text('parser.put_no_place'),
            recoverable: true,
          }),
        };
      }
      const moveOutcome = this.addInventoryEntity(
        destinationInventory.owner,
        entity,
        destinationInventory.relation
      );
      if (moveOutcome.status !== 'ok') {
        return this.withPutFailureContext(
          moveOutcome,
          entity,
          destinationInventory.owner,
          relation,
          target
        );
      }
      const textTarget =
        this.getPutTargetDescriptor(
          target || destinationInventory.owner,
          destinationInventory.relation
        ) ||
        ({
          title:
            this.getPlayerFacingObjectTitle(destinationInventory.owner) ||
            destinationInventory.owner.name,
          relation: destinationInventory.relation,
        } satisfies PutTargetTextDescriptor);
      return {
        status: 'ok',
        code: 'item_put_into_inventory',
        message: this.getPutSuccessMessage(
          this.getPlayerFacingObjectTitle(entity) || entity.name,
          textTarget.title,
          textTarget.relation
        ),
        data: { entityId: entity.name, ownerId: destinationInventory.owner.name },
        effects: sourceInInventory
          ? ['removed_from_inventory', 'moved_to_inventory']
          : ['moved_between_containers'],
      };
    }

    if (destinationSurface) {
      const surfaceAccessible =
        relation && target
          ? this.isSurfaceAccessibleFromAnchor(destinationSurface.surface, target)
          : this.isSurfaceAccessible(destinationSurface.surface);
      if (!surfaceAccessible) {
        const accessFailure = this.getPutAccessibilityFailure(destinationSurface.surface, target);
        return {
          ...(accessFailure || {
            status: 'failed',
            code: 'put_target_not_accessible',
            message: this.text('parser.put_no_place'),
            recoverable: true,
          }),
        };
      }
      const moveOutcome = this.addEntityToSurface(
        destinationSurface.surface,
        entity,
        destinationSurface.relation,
        {
          preferPlayerPoint: !target && destinationSurface.surface.type === 'Walkbox',
        }
      );
      if (moveOutcome.status !== 'ok') {
        return this.withPutFailureContext(
          moveOutcome,
          entity,
          destinationSurface.surface,
          relation,
          target
        );
      }
      return {
        status: 'ok',
        code: 'item_put_on_surface',
        message: this.getSurfacePutMessage(
          destinationSurface.surface,
          entity,
          relation || destinationSurface.relation,
          target
        ),
        data: { entityId: entity.name, targetId: destinationSurface.surface.name },
        effects: sourceInInventory
          ? ['removed_from_inventory', 'placed_on_surface']
          : ['moved_between_scene_targets'],
      };
    }

    return {
      status: 'failed',
      code: 'put_target_not_found',
      message: this.text('parser.put_no_place'),
      recoverable: true,
    };
  }

  removeInventoryEntity(entity: Entity): GameActionOutcome {
    const scene = this.sceneManager.currentScene;
    const player = scene?.player instanceof Entity ? scene.player : null;
    if (!this.inventoryManager.hasMainInventory(player)) {
      return {
        status: 'failed',
        code: 'player_inventory_missing',
        message: this.text('parser.inventory_missing'),
        recoverable: true,
      };
    }

    const index = this.inventory.indexOf(entity);
    if (index === -1) {
      return {
        status: 'failed',
        code: 'inventory_item_not_found',
        recoverable: true,
      };
    }

    this.inventory.splice(index, 1);
    this.syncPlayerInventoryComponent();
    this.reconcileInventoryPreview();
    this.notifyInventoryUiChange();
    return {
      status: 'ok',
      code: 'inventory_item_removed',
      data: { entityId: entity.name },
      effects: ['removed_from_inventory'],
    };
  }

  showInventory(): GameActionOutcome {
    const scene = this.sceneManager.currentScene;
    const player = scene?.player instanceof Entity ? scene.player : null;
    if (!this.inventoryManager.hasMainInventory(player)) {
      return {
        status: 'failed',
        code: 'player_inventory_missing',
        message: this.text('parser.inventory_missing'),
        recoverable: true,
      };
    }

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
        // Backward-compatible merge: older builds may have nested shapes.
        const loadedCrt = loaded?.crt ?? loaded?.settings?.crt ?? loaded?.graphics?.crt;
        const loadedEditor = loaded?.editor ?? loaded?.settings?.editor;

        if (loadedCrt) {
          const coerceNumber = (value: unknown, fallback: number) => {
            if (typeof value === 'number' && Number.isFinite(value)) return value;
            if (typeof value === 'string') {
              const n = Number.parseFloat(value);
              return Number.isFinite(n) ? n : fallback;
            }
            return fallback;
          };

          this.settings.crt = {
            ...this.settings.crt,
            ...loadedCrt,
            // Ensure numeric fields stay numeric even if older UI saved strings.
            curvature: coerceNumber(loadedCrt.curvature, this.settings.crt.curvature),
            scanlineCount: coerceNumber(loadedCrt.scanlineCount, this.settings.crt.scanlineCount),
            scanlineIntensity: coerceNumber(
              loadedCrt.scanlineIntensity,
              this.settings.crt.scanlineIntensity
            ),
            aberration: coerceNumber(loadedCrt.aberration, this.settings.crt.aberration),
            vignette: coerceNumber(loadedCrt.vignette, this.settings.crt.vignette),
            phosphor: coerceNumber(loadedCrt.phosphor, this.settings.crt.phosphor),
            bloom: coerceNumber(loadedCrt.bloom, this.settings.crt.bloom),
            enabled:
              typeof loadedCrt.enabled === 'boolean'
                ? loadedCrt.enabled
                : this.settings.crt.enabled,
            bezelGlow:
              typeof loadedCrt.bezelGlow === 'boolean'
                ? loadedCrt.bezelGlow
                : this.settings.crt.bezelGlow,
          };
        }

        if (loadedEditor) {
          this.settings.editor = { ...this.settings.editor, ...loadedEditor };
        }
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  }
}
