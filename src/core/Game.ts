import { CRTFilter, type CRTSettings } from '../graphics/CRTFilter';
import { Input } from './Input';
import { Parser } from '../mechanics/Parser';
import { SceneManager } from '../scene/SceneManager';
import { SceneEditor } from '../tools/SceneEditor';
import { SpriteEditor } from '../tools/SpriteEditor';
import { AssetLoader } from './AssetLoader';
import { Entity } from '../entities/Entity';
import { SceneObject } from '../entities/SceneObject';
import { Actor } from '../entities/Actor';
import { registerDemoScripts } from '../scripts/DemoScripts';
import { registerUserScripts } from '../scripts/main';
import { AudioManager } from './AudioManager';
import { TextAssetManager } from './TextAssetManager';
import type { GameActionOutcome } from './GameActionTypes';
import { SoundManager } from '../systems/SoundManager';
import { ScriptRegistry } from './ScriptRegistry';

import { Console } from './Console';
import type { SwitchComponent } from '../systems/ComponentSystem';

import type { IGame } from './IGame';
import { InventoryManager } from '../systems/InventoryManager';
import { GameSemanticAPI } from '../systems/GameSemanticAPI';
import type { Scene } from '../scene/Scene';
import type { SpatialRelationType } from '../scene/spatialTypes';
import { GAME_DESIGN_HEIGHT, GAME_DESIGN_WIDTH } from './Resolution';

type EditorViewportZoom = 'fit' | '1' | '1.5' | '2';

export type RelationScopedTakeCandidates =
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
    SoundManager.getInstance().play(name);
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
  semantic: GameSemanticAPI;

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
    audio: {
      attachedVolume: number;
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
      audio: {
        attachedVolume: 1.0,
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
    this.semantic = new GameSemanticAPI(this);

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
        getScriptRuntimeState: () => ScriptRegistry.getRuntimeState(),
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
  }

  destroy(): void {
    this.stop();
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
    ScriptRegistry.update(deltaTime, this.sceneManager.currentScene?.id);

    if (this.sceneManager.currentScene) {
      const scene = this.sceneManager.currentScene;
      SoundManager.getInstance().updateAttachedSounds(
        scene.camera.x,
        scene.camera.y,
        scene.camera.zoom,
        (id: string) => {
          const obj = scene.getObjectByName(id) as any;
          if (obj && obj.x !== undefined && obj.y !== undefined) {
            return { x: obj.x, y: obj.y, parallax: obj.parallax !== undefined ? obj.parallax : 1 };
          }
          return null;
        }
      );
    }

    // Cursor Logic
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
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, this.bufferCanvas.width, this.bufferCanvas.height);

      // Watermark
      this.ctx.fillStyle = '#666';
      this.ctx.font = '10px monospace';
      this.ctx.fillText(
        'Scanline v0.1                                                   F1=Menu',
        10,
        10
      );

      this.sceneManager.render(this.ctx);

      try {
        this.renderUI(this.ctx);
      } catch (uiErr) {
        console.error('UI Render Failed:', uiErr);
      }
    }

    // 2. Render Buffer to Screen via CRT Filter
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
      }
    } else {
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

  revealCommandCursor(): void {
    this.cursorBlink = 0;
  }

  renderUI(ctx: CanvasRenderingContext2D): void {
    const w = this.bufferCanvas.width;
    const h = this.bufferCanvas.height;
    const lineHeight = 10;
    const isClosedModal = this.console.isClosedModal;
    const closedDisplayLines = isClosedModal
      ? this.console.getClosedModalDisplayLines()
      : this.console.getClosedDisplayLines();
    const maxModalLines = Math.max(1, Math.floor((h - 4) / lineHeight) - 1);
    const outputLineCount = isClosedModal
      ? Math.min(Math.max(closedDisplayLines.length, 1), maxModalLines)
      : this.console.CLOSED_CONSOLE_VISIBLE_LINES;
    const continueLineCount = isClosedModal ? 1 : 0;
    const inputLineCount = isClosedModal ? 0 : 1;
    const consoleHeight = lineHeight * (outputLineCount + continueLineCount + inputLineCount) + 4;

    ctx.font = '10px monospace';
    ctx.textBaseline = 'top';

    const consoleY = h - consoleHeight;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, consoleY, w, consoleHeight);

    ctx.fillStyle = '#fff';
    const visibleOutput = closedDisplayLines.slice(-outputLineCount);

    for (let index = 0; index < visibleOutput.length; index += 1) {
      const line = visibleOutput[index];
      ctx.fillStyle = line.type === 'command' ? '#aaa' : '#fff';
      ctx.fillText(line.text, 2, consoleY + 2 + lineHeight * index);
    }

    if (isClosedModal) {
      this.cursorBlink += 16;
      const cursorVisible = Math.floor(this.cursorBlink / 500) % 2 === 0;
      const continueText = '[Continue]';
      const continueX = Math.max(2, w - ctx.measureText(continueText).width - 2);
      ctx.fillStyle = cursorVisible ? '#fff' : '#777';
      ctx.fillText(continueText, continueX, consoleY + 2 + lineHeight * outputLineCount);
      return;
    }

    const inputText = this.consoleInput ? this.consoleInput.value : '';
    const isFocused = document.activeElement === this.consoleInput;
    const caretIndex =
      this.consoleInput && typeof this.consoleInput.selectionStart === 'number'
        ? Math.max(
            0,
            Math.min(this.consoleInput.selectionStart ?? inputText.length, inputText.length)
          )
        : inputText.length;

    let cursorVisible = false;
    if (isFocused) {
      this.cursorBlink += 16;
      cursorVisible = Math.floor(this.cursorBlink / 500) % 2 === 0;
    }

    const inputX = 2;
    const inputY = consoleY + 2 + lineHeight * outputLineCount;
    const promptText = `> ${inputText}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(promptText, inputX, inputY);

    if (cursorVisible) {
      const beforeCaretText = `> ${inputText.slice(0, caretIndex)}`;
      const cursorChar = inputText[caretIndex] || ' ';
      const cursorX = inputX + ctx.measureText(beforeCaretText).width;
      const cursorWidth = Math.max(1, ctx.measureText(cursorChar).width);
      ctx.fillRect(cursorX, inputY, cursorWidth, lineHeight);
      ctx.fillStyle = '#000';
      ctx.fillText(cursorChar, cursorX, inputY);
    }
  }

  disableCRT(): void {
    this.crtFilter = null;
  }

  onMouseClick(x: number, y: number): void {
    if (this.console.continueClosedModal()) {
      return;
    }

    if (!this.editor.enabled) {
      this.focusCommandInput();
    }
    if (this.editor.onClick(x, y)) {
      return;
    }
    if (this.sceneManager.currentScene) {
      this.sceneManager.currentScene.onClick(x, y);
    }
  }

  // --- Message API ---
  log(text: string): void {
    console.log(`[GAME LOG] ${text}`);
    this.console.log(text);
  }

  logResponse(messages: string[]): void {
    if (typeof this.console?.logResponse !== 'function') {
      for (const message of messages) {
        this.log(message);
      }
      return;
    }

    for (const message of messages) {
      console.log(`[GAME LOG] ${message}`);
    }
    this.console.logResponse(messages);
  }

  text(key: string, params?: Record<string, string | number>): string {
    return this.textAssets.getServiceText(key, params);
  }

  // ─── Inventory UI / Preview delegates ───────────────────────────────────

  subscribeInventoryUi(listener: () => void): () => void {
    return this.inventoryManager.subscribeInventoryUi(listener);
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

  isEntityInInventory(entity: Entity): boolean {
    return this.inventoryManager.isEntityInInventory(entity);
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

  getSurfacePutMessage(
    surface: SceneObject,
    item: Entity,
    relation: SpatialRelationType | null,
    target?: SceneObject | null
  ): string {
    return this.semantic.getSurfacePutMessage(surface, item, relation, target);
  }

  getSeeMessage(target: SceneObject): string | null {
    return this.semantic.getSeeMessage(target);
  }

  // ─── Inventory / Surface storage delegates ───────────────────────────────

  getAccessibleInventoryItems(): Entity[] {
    return this.inventoryManager.getAccessibleInventoryItems(
      this.semantic.getBlockedAccessOutcome.bind(this.semantic)
    );
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

  getSwitchComponent(entity: SceneObject): SwitchComponent | null {
    const component = entity.components?.find((candidate: any) => candidate?.type === 'Switch');
    return (component as SwitchComponent | undefined) || null;
  }

  // --- Core Semantic API delegates ---

  getBlockedAccessOutcome(entity: SceneObject): GameActionOutcome | null {
    return this.semantic.getBlockedAccessOutcome(entity);
  }

  lookScene(scene?: Scene | null): GameActionOutcome {
    return this.semantic.lookScene(scene);
  }

  lookEntity(entity: SceneObject): GameActionOutcome {
    return this.semantic.lookEntity(entity);
  }

  examineEntity(entity: SceneObject): GameActionOutcome {
    return this.semantic.examineEntity(entity);
  }

  describeSpatialRelation(anchorNodeId: string, relation: SpatialRelationType): GameActionOutcome {
    return this.semantic.describeSpatialRelation(anchorNodeId, relation);
  }

  getRelationScopedTakeCandidates(
    anchor: SceneObject,
    relation: SpatialRelationType | 'near'
  ): RelationScopedTakeCandidates {
    return this.semantic.getRelationScopedTakeCandidates(anchor, relation);
  }

  isEntityInPutTarget(
    source: SceneObject,
    target: SceneObject,
    relation: SpatialRelationType | 'near' | null
  ): boolean {
    return this.semantic.isEntityInPutTarget(source, target, relation);
  }

  takeEntity(entity: Entity): GameActionOutcome {
    return this.semantic.takeEntity(entity);
  }

  canTakeEntity(entity: Entity): GameActionOutcome | null {
    return this.semantic.canTakeEntity(entity);
  }

  canPutSourceEntity(entity: Entity): GameActionOutcome | null {
    return this.semantic.canPutSourceEntity(entity);
  }

  putEntity(
    entity: Entity,
    target?: SceneObject | null,
    options?: { relation?: SpatialRelationType | null }
  ): GameActionOutcome {
    return this.semantic.putEntity(entity, target, options);
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
    this.inventoryManager.syncPlayerInventoryComponent();
    this.inventoryManager.reconcileInventoryPreview();
    this.inventoryManager.notifyInventoryUiChange();
    return {
      status: 'ok',
      code: 'inventory_item_removed',
      data: { entityId: entity.name },
      effects: ['removed_from_inventory'],
    };
  }

  showInventory(): GameActionOutcome {
    return this.semantic.showInventory();
  }

  goToSceneTarget(target: string): GameActionOutcome {
    return this.semantic.goToSceneTarget(target);
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

    const player =
      currentScene?.player ||
      (currentScene?.entities.find((entity) => entity instanceof Actor && entity.isPlayer) as
        | Actor
        | undefined);

    this.sceneManager.switchTo(sceneId, player || undefined);
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
    return this.semantic.goToEntity(entity);
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
    return this.semantic.openEntity(entity);
  }

  closeEntity(entity: SceneObject): GameActionOutcome {
    return this.semantic.closeEntity(entity);
  }

  bindUI(): void {
    this.editor.initUI();
  }

  resize(width: number, height: number): void {
    this.rendererCanvas.width = width;
    this.rendererCanvas.height = height;
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
      const coerceNumber = (value: unknown, fallback: number) => {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
          const n = Number.parseFloat(value);
          return Number.isFinite(n) ? n : fallback;
        }
        return fallback;
      };

      if (json) {
        const loaded = JSON.parse(json);
        const loadedCrt = loaded?.crt ?? loaded?.settings?.crt ?? loaded?.graphics?.crt;
        const loadedEditor = loaded?.editor ?? loaded?.settings?.editor;
        const loadedAudio = loaded?.audio ?? loaded?.settings?.audio;

        if (loadedCrt) {
          this.settings.crt = {
            ...this.settings.crt,
            ...loadedCrt,
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

        if (loadedAudio) {
          this.settings.audio = {
            ...this.settings.audio,
            attachedVolume: Math.max(
              0,
              Math.min(
                10,
                coerceNumber(loadedAudio.attachedVolume, this.settings.audio.attachedVolume)
              )
            ),
          };
        }
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
    SoundManager.getInstance().setAttachedVolume(this.settings.audio.attachedVolume);
  }
}
