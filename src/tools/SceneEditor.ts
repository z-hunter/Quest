import { Entity } from '../entities/Entity';
import { Actor } from '../entities/Actor';
import { SceneObject } from '../entities/SceneObject';
import { Walkbox } from '../entities/Walkbox';
import { Triggerbox } from '../entities/Triggerbox';
import { QuadObject } from '../entities/QuadObject';
import { Folder } from '../entities/Folder';
import { Scene } from '../scene/Scene';
import { useEditorStore } from '../store/editorStore';

import { EditorUndoManager } from './editor/EditorUndoManager';
import { EditorSelectionManager } from './editor/EditorSelectionManager';
import { EditorTransformManager } from './editor/EditorTransformManager';
import { EditorPersistenceManager } from './editor/EditorPersistenceManager';
import { EditorUI } from './editor/EditorUI';

export class SceneEditor {
  undoManager: EditorUndoManager;
  selectionManager: EditorSelectionManager;
  transformManager: EditorTransformManager;
  persistenceManager: EditorPersistenceManager;
  ui: EditorUI;

  game: any;
  enabled: boolean;
  selectionSlots: Array<string[] | null>;
  // State Properties
  get selectedObject(): SceneObject | null {
    return this.selectionManager.selectedObject;
  }
  set selectedObject(val: SceneObject | null) {
    this.selectionManager.selectedObject = val;
  }
  lastMousePos: { x: number; y: number };
  lastClientMousePos: { x: number; y: number };

  // Callbacks
  // Refactored: Use this.game.openFileBrowser instead of local property

  // Event Handlers (Bound)
  public boundKeyHandler: (e: KeyboardEvent) => void;
  public boundMouseDownHandler: (e: MouseEvent) => void;
  public boundMouseMoveHandler: (e: MouseEvent) => void;
  public boundMouseUpHandler: (e: MouseEvent) => void;
  public boundPasteHandler: (e: ClipboardEvent) => void;
  public boundWheelHandler: (e: WheelEvent) => void;

  constructor(game: any) {
    this.game = game;
    this.undoManager = new EditorUndoManager(this);
    this.selectionManager = new EditorSelectionManager(this);
    this.transformManager = new EditorTransformManager(this);
    this.persistenceManager = new EditorPersistenceManager(this);
    this.ui = new EditorUI(this);
    this.enabled = false;
    this.selectionSlots = [null, null];

    this.selectionManager.selectedObject = null;
    this.lastMousePos = { x: 0, y: 0 };
    this.lastClientMousePos = { x: Number.NaN, y: Number.NaN };

    // Bind handlers once for cleanup

    this.boundKeyHandler = this.handleGlobalKey.bind(this);
    this.boundMouseDownHandler = this.onMouseDown.bind(this);
    this.boundMouseMoveHandler = this.onMouseMove.bind(this);
    this.boundMouseUpHandler = this.onMouseUp.bind(this);
    this.boundPasteHandler = this.handleGlobalPaste.bind(this);
    this.boundWheelHandler = this.onWheel.bind(this);

    this.ui.initUI();
  }

  initUI(): void {
    this.ui.initUI();
  }

  destroy(): void {
    this.ui.destroy();
  }

  lastCameraPos: { x: number; y: number } = { x: 0, y: 0 };

  update(_deltaTime?: number): void {
    this.persistenceManager.ensureCurrentSceneBaseline();

    // Check for Camera changes to update UI
    if (this.game.sceneManager.currentScene) {
      const cam = this.game.sceneManager.currentScene.camera;
      if (cam) {
        if (cam.x !== this.lastCameraPos.x || cam.y !== this.lastCameraPos.y) {
          this.lastCameraPos.x = cam.x;
          this.lastCameraPos.y = cam.y;

          // Only update UI if Scene is selected (showing Camera Props)
          // Or if we decide to show camera Pos elsewhere
          if (useEditorStore.getState().selectedObjectId === 'SCENE') {
            useEditorStore.getState().incrementObjectVersion();
          }
        }
      }
    }
  }

  setupListeners(): void {
    this.ui.setupListeners();
  }

  /* Event Handlers extracted for cleanup */

  /* Legacy Event Handlers Removed */

  // Kept for F-Key shortcuts

  /* handleGlobalInput Removed */

  /* handleGlobalChange Removed */

  saveUndoState(): void {
    this.undoManager.saveUndoState();
  }

  // Keep public for compatibility if needed, but implementation is in manager
  restoreSceneState(data: any): void {
    this.undoManager.restoreSceneState(data);
  }

  undo(): void {
    this.undoManager.undo();
  }

  redo(): void {
    this.undoManager.redo();
  }

  handleGlobalKey(e: KeyboardEvent): void {
    const isTypingInField =
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement ||
      document.activeElement instanceof HTMLSelectElement;

    if (this.enabled && !isTypingInField && this.isArrowKey(e.key) && this.isMouseOverCanvas()) {
      e.preventDefault();
    }

    if (
      this.enabled &&
      e.key === '/' &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !isTypingInField
    ) {
      const filterInput = document.getElementById(
        'hierarchy-filter-input'
      ) as HTMLInputElement | null;
      if (filterInput) {
        e.preventDefault();
        filterInput.focus();
        const valueLength = filterInput.value.length;
        filterInput.setSelectionRange(valueLength, valueLength);
        return;
      }
    }

    // High Priority: Ctrl+D for Duplication (Overrides Chrome Bookmark & Input focus)
    if (this.enabled && e.ctrlKey && (e.key.toLowerCase() === 'd' || e.code === 'KeyD')) {
      e.preventDefault();
      this.duplicateSelectedObject();
      return;
    }

    // Ctrl+C: Copy Object
    if (this.enabled && e.ctrlKey && (e.key.toLowerCase() === 'c' || e.code === 'KeyC')) {
      // Only prevent default if we have an object selected,
      // otherwise let normal copy work (e.g. text in inputs/textareas)
      if (this.selectedObject && !isTypingInField) {
        e.preventDefault();
        this.copySelectedObjectToClipboard();
        return;
      }
    }

    // Ctrl+V: Paste Object
    if (this.enabled && e.ctrlKey && (e.key.toLowerCase() === 'v' || e.code === 'KeyV')) {
      if (!isTypingInField) {
        // e.preventDefault(); // Don't prevent default, let 'paste' event fire
        // We rely on the global 'paste' event listener which calls handleGlobalPaste
        return;
      }
    }

    // Ctrl+S: Save Object
    if (this.enabled && e.ctrlKey && (e.key.toLowerCase() === 's' || e.code === 'KeyS')) {
      e.preventDefault();
      this.persistenceManager.saveObject();
      return;
    }

    // Ctrl+O: Load Object (cursor placement mode)
    if (this.enabled && e.ctrlKey && (e.key.toLowerCase() === 'o' || e.code === 'KeyO')) {
      e.preventDefault();
      this.persistenceManager.loadObject('cursor');
      return;
    }

    // Alt+D: Toggle Disabled State
    if (this.enabled && e.altKey && (e.key.toLowerCase() === 'd' || e.code === 'KeyD')) {
      e.preventDefault();
      if (this.selectedObject) {
        this.selectedObject.disabled = !this.selectedObject.disabled;

        // Force UI Update
        useEditorStore.getState().incrementObjectVersion();
        useEditorStore.getState().incrementHierarchyVersion();
      }
      return;
    }

    // Alt+L: Toggle Locked State
    if (this.enabled && e.altKey && (e.key.toLowerCase() === 'l' || e.code === 'KeyL')) {
      e.preventDefault();
      if (this.selectedObject) {
        this.selectedObject.locked = !this.selectedObject.locked;

        // Force UI Update
        useEditorStore.getState().incrementObjectVersion();
        useEditorStore.getState().incrementHierarchyVersion();
      }
      return;
    }

    // Ctrl+Z: Undo
    if (
      this.enabled &&
      e.ctrlKey &&
      (e.key.toLowerCase() === 'z' || e.code === 'KeyZ') &&
      !e.shiftKey
    ) {
      // Ensure Shift not held for Redo in some apps
      e.preventDefault();
      this.undo();
      return;
    }

    // Ctrl+Y or Ctrl+Shift+Z: Redo
    if (
      this.enabled &&
      e.ctrlKey &&
      (e.key.toLowerCase() === 'y' ||
        e.code === 'KeyY' ||
        (e.shiftKey && (e.key.toLowerCase() === 'z' || e.code === 'KeyZ')))
    ) {
      e.preventDefault();
      this.redo();
      return;
    }

    // Alt-S: Assign Sprite (Static/Actor)
    if (this.enabled && e.altKey && (e.key.toLowerCase() === 's' || e.code === 'KeyS')) {
      e.preventDefault();
      if (
        this.selectedObject &&
        (this.selectedObject instanceof Entity || this.selectedObject instanceof Actor)
      ) {
        // Check if method exists, else implement inline or warn
        this.persistenceManager.promptSetSprite();
      }
      return;
    }

    // Allows opening editor with F1 or F5 even if disabled
    if (!this.enabled && e.key !== 'F1' && e.key !== 'F5') return;

    if (
      this.enabled &&
      !isTypingInField &&
      !e.ctrlKey &&
      !e.metaKey &&
      (e.code === 'Digit1' || e.code === 'Digit2') &&
      this.isSelectionSlotHotkeyContext()
    ) {
      const slotIndex = e.code === 'Digit1' ? 0 : 1;
      e.preventDefault();
      if (e.shiftKey) {
        this.saveSelectionSlot(slotIndex);
      } else if (!e.altKey) {
        this.restoreSelectionSlot(slotIndex);
      }
      return;
    }

    // F1: Toggle Scene Editor
    if (e.key === 'F1') {
      e.preventDefault();
      e.stopImmediatePropagation();

      // Ensure Sprite Editor is closed if switching
      if (this.game.spriteEditor && this.game.spriteEditor.active) {
        this.game.spriteEditor.toggle(false);
      }
      this.toggle();
      return;
    } else if (e.key === 'F5') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.game.spriteEditor.toggle();
      return;
    } else if (e.key === 'F9') {
      e.preventDefault();
      this.selectObject('SETTINGS');
      return;
    } else if (e.key === 'Delete') {
      // Prevent if user is typing or Mouse is over UI
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        this.game.isMouseOverUI
      ) {
        return;
      }

      if (this.selectedObject) {
        this.deleteSelectedObject();
      }
    }

    // Prevent default for F-keys and Editor keys when editor is open
    if (this.enabled && e.key) {
      if (
        ['F2', 'F3', 'F4', 'F5', 's', 'a', 'w', 't', '+', '-', '*', '/'].includes(
          e.key.toLowerCase()
        )
      ) {
        // e.preventDefault();
      }
    }

    if (!this.enabled) return;

    // Ignore shortcuts if user is typing in an input
    if (
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement
    ) {
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'f2':
        e.preventDefault();
        if (e.shiftKey || e.altKey)
          this.persistenceManager.saveScene(true); // Save As
        else this.persistenceManager.saveScene(false); // Quick Save
        break;
      case 'f3':
        e.preventDefault();
        this.persistenceManager.promptLoadScene();
        break;
      case 'f4':
        e.preventDefault();
        this.newScene();
        break;

      case ' ':
        {
          // Spacebar: Select Scene if mouse is over canvas
          const mx = this.lastMousePos.x;
          const my = this.lastMousePos.y;
          if (mx >= 0 && mx <= this.game.canvas.width && my >= 0 && my <= this.game.canvas.height) {
            e.preventDefault();
            this.selectObject('SCENE');
          }
        }
        break;

      // Creation Hotkeys
      case 's':
        {
          const pos = this.getMouseWorldPosIfOverCanvas();
          this.startCreating('Static', pos?.x, pos?.y);
        }
        break;
      case 'a':
        {
          const pos = this.getMouseWorldPosIfOverCanvas();
          this.startCreating('Actor', pos?.x, pos?.y);
        }
        break;
      case 'w':
        this.startCreating('Walkbox');
        break;
      case 't':
        this.startCreating('Triggerbox');
        break;
      case 'q':
        {
          const pos = this.getMouseWorldPosIfOverCanvas();
          this.startCreating('Quad', pos?.x, pos?.y);
        }
        break;
      case 'f':
        this.startCreating('Folder');
        break;

      // Camera Hotkeys
      case '+':
      case '=':
        if (this.game.sceneManager.currentScene) {
          this.game.sceneManager.currentScene.camera.zoom *= 1.1;
          useEditorStore.getState().incrementObjectVersion();
        }
        break;
      case '-':
        if (this.game.sceneManager.currentScene) {
          this.game.sceneManager.currentScene.camera.zoom *= 0.9;
          useEditorStore.getState().incrementObjectVersion();
        }
        break;
      case '*':
        // Reset Camera Position
        if (this.game.sceneManager.currentScene) {
          const s = this.game.sceneManager.currentScene;
          if (s.player) {
            s.camera.x = s.player.x - 320;
            s.camera.y = s.player.y - 200;
          } else {
            s.camera.x = 0;
            s.camera.y = 0;
          }
          s.suspendEditorCameraFollow?.();
          useEditorStore.getState().incrementObjectVersion();
        }
        break;
      case '\\':
        // Reset Zoom
        if (this.game.sceneManager.currentScene) {
          this.game.sceneManager.currentScene.camera.zoom = 1.0;
          useEditorStore.getState().incrementObjectVersion();
        }
        break;

      case 'enter':
        if (!e.ctrlKey) this.transformManager.finishPolygon();
        break;

      case 'escape':
        {
          this.transformManager.drawMode = false;
          this.transformManager.currentPolygon = [];
          const c = document.getElementById('chk-draw-mode') as HTMLInputElement;
          if (c) c.checked = false;
        }
        break;
    }
  }

  // Helper to get World Pos from last mouse pos if inside canvas
  getMouseWorldPosIfOverCanvas(): { x: number; y: number } | null {
    // IMPORTANT:
    // lastMousePos is updated from window mousemove in EditorUI and is the most up-to-date cursor point.
    // game.input.mouse is updated only from canvas events and may be stale.
    const candidates: { x: number; y: number }[] = [this.lastMousePos];
    if (this.game?.input?.mouse) {
      candidates.push({
        x: this.game.input.mouse.x,
        y: this.game.input.mouse.y,
      });
    }

    for (const pos of candidates) {
      const mx = pos.x;
      const my = pos.y;
      if (mx >= 0 && mx <= this.game.canvas.width && my >= 0 && my <= this.game.canvas.height) {
        return this.convertScreenToWorld(mx, my);
      }
    }
    return null;
  }

  private isArrowKey(key: string): boolean {
    return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';
  }

  private isMouseOverCanvas(): boolean {
    const { x, y } = this.lastClientMousePos;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

    const rect = this.game.canvas.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  convertScreenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const scene = this.game.sceneManager.currentScene;
    const camX = scene && scene.camera ? scene.camera.x : 0;
    const camY = scene && scene.camera ? scene.camera.y : 0;
    const zoom = scene && scene.camera ? scene.camera.zoom : 1.0;

    const halfW = this.game.canvas.width / 2;
    const halfH = this.game.canvas.height / 2;

    return {
      x: (screenX - halfW) / zoom + camX,
      y: (screenY - halfH) / zoom + camY,
    };
  }

  startCreating(type: string, x?: number, y?: number): void {
    if (!this.game.sceneManager.currentScene) return;

    this.saveUndoState(); // Save before creation
    this.transformManager.startCreating(type, x, y);
  }

  setScalingEnabled(isEnabled: boolean): void {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return;

    const s = scene.scaling;
    const wasEnabled = s.enabled;

    // Start Logic
    s.enabled = isEnabled;

    // Normalization Logic on Toggle
    if (wasEnabled !== isEnabled) {
      const entities = scene.entities;
      for (const ent of entities) {
        if (ent.ignoreScaling) continue;

        const currentVisW = ent.width;
        const currentVisH = ent.height;

        if (isEnabled) {
          // A controller Quad replaces the scene fallback entirely. Always
          // use the common resolver here, otherwise toggling scene scaling
          // bakes the fallback factor into controller-managed objects.
          const depthFactor = scene.getDepthScaleFor(ent);
          const totalScale = ent.modelScale * depthFactor;
          ent.scale = totalScale;

          if (totalScale !== 0) {
            ent.baseWidth = currentVisW / totalScale;
            ent.baseHeight = currentVisH / totalScale;
          }
        } else {
          // Scene.getDepthScaleFor() still returns a matching controller
          // while scene scaling is disabled; only uncontrolled objects become
          // Model * 1.0.
          const totalScale = ent.modelScale * scene.getDepthScaleFor(ent);
          ent.scale = totalScale;

          if (totalScale !== 0) {
            ent.baseWidth = currentVisW / totalScale;
            ent.baseHeight = currentVisH / totalScale;
          } else {
            ent.baseWidth = currentVisW; // Fallback
            ent.baseHeight = currentVisH;
          }

          ent.width = currentVisW;
          ent.height = currentVisH;
        }
      }
      // Refresh properties panel calls if needed (Store update handles it via objectVersion usually,
      // but we might want to trigger a hierarchy/object version bump since ALL entities changed)
      useEditorStore.getState().incrementHierarchyVersion();
    }
  }

  toggle(): void {
    this.ui.toggle();
  }

  syncUI(): void {
    // Legacy: UI is now reactive.
    useEditorStore.getState().incrementObjectVersion();
    useEditorStore.getState().incrementHierarchyVersion();
  }

  updateUIFromObject(): void {
    this.ui.updateUIFromObject();
  }

  saveObject(): Promise<void> {
    return this.persistenceManager.saveObject();
  }

  loadObject(mode: 'default' | 'cursor' = 'default'): Promise<void> {
    return this.persistenceManager.loadObject(mode);
  }

  saveScene(saveAs: boolean = false): Promise<boolean> {
    return this.persistenceManager.saveScene(saveAs);
  }

  promptLoadScene(): void {
    this.persistenceManager.promptLoadScene();
  }

  onMouseDown(e: MouseEvent): void {
    this.transformManager.onMouseDown(e);
  }

  onMouseMove(e: MouseEvent): void {
    this.lastMousePos = this.getMousePos(e);
    this.lastClientMousePos = { x: e.clientX, y: e.clientY };
    this.transformManager.onMouseMove(e);
  }

  onMouseUp(e: MouseEvent): void {
    this.transformManager.onMouseUp(e);
  }

  onWheel(e: WheelEvent): void {
    this.transformManager.onWheel(e);
  }

  selectObject(obj: any): void {
    this.selectionManager.selectObject(obj);
  }

  convertEntityToActor(entity: Entity): Actor | null {
    if (!entity || entity instanceof Actor || entity.type === 'Quad') return null;
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return null;

    const index = scene.entities.indexOf(entity);
    if (index < 0) return null;

    this.saveUndoState();

    const inventoryOwner = entity.getInventoryPositionOwner?.() || null;
    const data = entity.toJSON();
    const components = Array.isArray(data.components) ? data.components : [];
    const actor = Actor.fromJSON(this.game, {
      ...data,
      type: 'Actor',
      direction: data.direction || 'down',
      speed: typeof data.speed === 'number' ? data.speed : 0.1,
      animSets: data.animSets || {},
      isPlayer: !!data.isPlayer,
      components: components.some((component: any) => component?.type === 'Actor')
        ? components
        : [{ type: 'Actor' }, ...components],
    });

    actor.scene = scene;
    actor.setInventoryPositionOwner?.(inventoryOwner);
    scene.entities[index] = actor;
    if (actor.isPlayer) scene.player = actor;
    if (scene.subsceneEntities.has(entity)) {
      scene.subsceneEntities.delete(entity);
      scene.subsceneEntities.add(actor);
    }

    this.game.sceneManager.exposeEntitiesToWindow();
    this.selectObject(actor);
    useEditorStore.getState().incrementObjectVersion();
    this.refreshHierarchy();
    return actor;
  }

  convertActorToEntity(actor: Actor): Entity | null {
    if (!actor || !(actor instanceof Actor)) return null;
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return null;

    const index = scene.entities.indexOf(actor);
    if (index < 0) return null;

    this.saveUndoState();

    const inventoryOwner = actor.getInventoryPositionOwner?.() || null;
    const data = actor.toJSON();
    const components = Array.isArray(data.components)
      ? data.components.filter(
          (component: any) => component?.type !== 'Actor' && component?.type !== 'Shadow'
        )
      : [];
    const entity = Entity.fromJSON(this.game, {
      ...data,
      type: 'Entity',
      components,
    });

    entity.scene = scene;
    entity.setInventoryPositionOwner?.(inventoryOwner);
    scene.entities[index] = entity;
    if (scene.player === actor) scene.player = null;
    if (scene.subsceneEntities.has(actor)) {
      scene.subsceneEntities.delete(actor);
      scene.subsceneEntities.add(entity);
    }

    this.game.sceneManager.exposeEntitiesToWindow();
    this.selectObject(entity);
    useEditorStore.getState().incrementObjectVersion();
    this.refreshHierarchy();
    return entity;
  }

  toggleObjectSelection(obj: SceneObject): void {
    this.selectionManager.toggleObjectSelection(obj);
  }

  setMultiSelection(objs: SceneObject[]): void {
    this.selectionManager.setMultiSelection(objs);
  }

  getSelectedObjects(): SceneObject[] {
    return this.selectionManager.getSelectedObjects();
  }

  private getObjectKey(obj: any): string | null {
    if (!obj) return null;
    if (obj.type === 'Quad') return `Quad:${obj.name}`;
    if (obj instanceof Actor) return `Actor:${obj.name}`;
    if (obj instanceof Entity) return `Entity:${obj.name}`;
    if (obj instanceof Walkbox) return `Walkbox:${obj.name || 'Walkbox'}`;
    if (obj instanceof Triggerbox) return `Triggerbox:${obj.name || 'Triggerbox'}`;
    return null;
  }

  private findObjectBySelectionKey(key: string): SceneObject | null {
    const scene = this.game.sceneManager.currentScene;
    if (!scene || !key) return null;

    const sep = key.indexOf(':');
    const type = sep >= 0 ? key.slice(0, sep) : '';
    const name = sep >= 0 ? key.slice(sep + 1) : key;
    if (!type || !name) return null;

    if (type === 'Folder') {
      return (scene.folders || []).find((obj: any) => obj?.name === name) || null;
    }
    if (type === 'Entity' || type === 'Actor') {
      return (scene.entities || []).find((obj: any) => obj?.name === name) || null;
    }
    if (type === 'Walkbox') {
      return (scene.walkbox || []).find((obj: any) => obj?.name === name) || null;
    }
    if (type === 'Triggerbox') {
      return (scene.triggerboxes || []).find((obj: any) => obj?.name === name) || null;
    }
    if (type === 'Quad') {
      return (
        (scene.entities || []).find((obj: any) => obj?.type === 'Quad' && obj?.name === name) ||
        null
      );
    }

    return null;
  }

  private getCurrentObjectSelectionKeys(): string[] {
    if (this.selectionManager.hasMultiSelection()) {
      return this.selectionManager
        .getSelectedObjects()
        .map((obj) => this.getObjectKey(obj))
        .filter((key): key is string => !!key);
    }

    const key = this.getObjectKey(this.selectedObject);
    return key ? [key] : [];
  }

  private isSelectionSlotHotkeyContext(): boolean {
    const { x, y } = this.lastClientMousePos;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const hovered = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!hovered) return false;
    if (hovered.closest('#hierarchy-panel')) return true;
    if (this.game.canvas?.contains(hovered) || hovered === this.game.canvas) return true;
    return false;
  }

  saveSelectionSlot(slotIndex: number): void {
    const keys = this.getCurrentObjectSelectionKeys();
    const slotNumber = slotIndex + 1;
    if (!keys.length) {
      this.game.showNotification(`Nothing selected to save in slot ${slotNumber}`);
      return;
    }

    this.selectionSlots[slotIndex] = [...keys];
    const label = keys.length === 1 ? 'object' : 'objects';
    this.game.showNotification(`Saved ${keys.length} ${label} to selection slot ${slotNumber}`);
  }

  restoreSelectionSlot(slotIndex: number): void {
    const slotNumber = slotIndex + 1;
    const stored = this.selectionSlots[slotIndex];
    if (!stored || stored.length === 0) {
      this.game.showNotification(`Selection slot ${slotNumber} is empty`);
      return;
    }

    const objects = stored
      .map((key) => this.findObjectBySelectionKey(key))
      .filter((obj): obj is SceneObject => !!obj);

    if (!objects.length) {
      this.game.showNotification(`Saved selection in slot ${slotNumber} is no longer available`);
      return;
    }

    if (objects.length === 1) {
      this.selectObject(objects[0]);
    } else {
      this.setMultiSelection(objects);
    }

    const label = objects.length === 1 ? 'object' : 'objects';
    this.game.showNotification(
      `Restored ${objects.length} ${label} from selection slot ${slotNumber}`
    );
  }

  newScene(): void {
    void this.persistenceManager.runWithUnsavedChangesGuard(async () => {
      const newScene = new Scene(this.game, 'new_scene', 'New Scene');
      // Add default scale
      newScene.scaling.enabled = true;
      this.game.sceneManager.addScene(newScene);
      this.game.sceneManager.switchTo(newScene.id);
      this.persistenceManager.ensureCurrentSceneBaseline();
      this.game.textAssets.ensureSceneAssetFile(newScene).catch((err: unknown) => {
        console.error('Failed to create default scene text asset:', err);
      });
      this.syncUI();
      this.refreshHierarchy();
      this.selectObject('SCENE');
    });
  }

  refreshHierarchy(): void {
    // Sync to Store: Signal React to re-render the hierarchy
    useEditorStore.getState().incrementHierarchyVersion();
  }

  // Unified Object Creation Logic
  createObjectFromData(
    data: any,
    overrideX?: number,
    overrideY?: number,
    options?: { preserveBindings?: boolean }
  ): any {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return null;

    // Determine Type (fallback to Static if missing)
    const type = data.type || 'Static';

    // Coordinates
    const x = overrideX !== undefined ? overrideX : data.x || 0;
    const y = overrideY !== undefined ? overrideY : data.y || 0;

    let newObj: any;

    try {
      // Apply Overrides to data
      data.x = x;
      data.y = y;

      if (type === 'Walkbox') {
        // ... (Walkbox logic remains) ...
        let poly = data.poly || [];
        if (overrideX !== undefined && overrideY !== undefined) {
          // ... (Walkbox position logic) ...
          if (poly.length > 0) {
            const minX = Math.min(...poly.map((p: any) => p.x));
            const minY = Math.min(...poly.map((p: any) => p.y));
            const maxX = Math.max(...poly.map((p: any) => p.x));
            const maxY = Math.max(...poly.map((p: any) => p.y));
            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;

            const dx = overrideX - cx;
            const dy = overrideY - cy;

            poly = poly.map((p: any) => ({ x: p.x + dx, y: p.y + dy }));
          }
        } else {
          poly = poly.map((p: any) => ({ x: p.x, y: p.y }));
        }

        newObj = new Walkbox(poly, data.name);
        newObj.load({ ...data, poly, type: 'Walkbox' });
      } else if (type === 'Triggerbox') {
        // ... (Triggerbox logic remains) ...
        let poly = data.poly || [];
        if (overrideX !== undefined && overrideY !== undefined) {
          if (poly.length > 0) {
            const minX = Math.min(...poly.map((p: any) => p.x));
            const minY = Math.min(...poly.map((p: any) => p.y));
            const maxX = Math.max(...poly.map((p: any) => p.x));
            const maxY = Math.max(...poly.map((p: any) => p.y));
            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;
            const dx = overrideX - cx;
            const dy = overrideY - cy;
            poly = poly.map((p: any) => ({ x: p.x + dx, y: p.y + dy }));
          }
        } else {
          poly = poly.map((p: any) => ({ x: p.x, y: p.y }));
        }
        newObj = new Triggerbox(poly, data.name, data.script || '');
        newObj.load({ ...data, poly, type: 'Triggerbox' });
      } else if (type === 'Quad') {
        newObj = QuadObject.fromJSON(this.game, data);

        // Clear Bindings for New Objects (Paste/Duplicate/Load)
        // BUT preserve if explicitly requested (Undo/Redo)
        if (!options?.preserveBindings && newObj.vertices) {
          newObj.vertices.forEach((v: any) => delete v.binding);
        }

        // Handle Paste Position Override
        if (overrideX !== undefined && overrideY !== undefined) {
          const vertices = Array.isArray(data.vertices) ? data.vertices : [];
          const oldX =
            vertices.length > 0
              ? vertices.reduce((acc: number, v: any) => acc + v.x, 0) / vertices.length
              : data.x || 0;
          const oldY =
            vertices.length > 0
              ? vertices.reduce((acc: number, v: any) => acc + v.y, 0) / vertices.length
              : data.y || 0;
          const dx = overrideX - oldX;
          const dy = overrideY - oldY;

          newObj.x = overrideX;
          newObj.y = overrideY;

          if (newObj.vertices) {
            newObj.vertices.forEach((v: any) => {
              v.x += dx;
              v.y += dy;
            });
          }
        }
      } else if (
        type === 'Actor' ||
        (Array.isArray(data.components) &&
          data.components.some((component: any) => component?.type === 'Actor'))
      ) {
        data.type = 'Actor';
        newObj = Actor.fromJSON(this.game, data);
      } else if (type === 'Player') {
        newObj = Actor.fromJSON(this.game, { ...data, type: 'Actor', isPlayer: true });
      } else if (type === 'Folder') {
        newObj = Folder.fromData(this.game, data);
      } else if (type === 'Static' || type === 'Entity') {
        newObj = Entity.fromJSON(this.game, data);
      }
      // Fallback
      if (!newObj) {
        if (type !== 'Walkbox' && type !== 'Triggerbox') {
          newObj = Entity.fromJSON(this.game, data);
        }
      }

      // ADD TO SCENE
      if (type === 'Walkbox') {
        if (!scene.walkbox) scene.walkbox = [];
        scene.walkbox.push(newObj);
      } else if (type === 'Triggerbox') {
        if (!scene.triggerboxes) scene.triggerboxes = [];
        scene.triggerboxes.push(newObj);
      } else if (type === 'Folder') {
        scene.addFolder(newObj);
      } else {
        scene.addEntity(newObj);
      }

      // Ensure new object is available in console
      this.game.sceneManager.exposeEntitiesToWindow();

      return newObj;
    } catch (e) {
      console.error('Error creating object from data:', e);
      return null;
    }
  }

  handleGlobalPaste(e: ClipboardEvent): void {
    this.selectionManager.handleGlobalPaste(e);
  }

  async pasteObjectFromClipboard(): Promise<void> {
    const text = await navigator.clipboard.readText();
    if (text) {
      this.selectionManager.processPasteData(text);
    }
  }

  getMousePos(e: MouseEvent): { x: number; y: number } {
    const rect = this.game.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.game.canvas.width / rect.width),
      y: (e.clientY - rect.top) * (this.game.canvas.height / rect.height),
    };
  }

  // Existing mouse move needs to update this

  copySelectedObjectToClipboard(): void {
    this.selectionManager.copySelectionToClipboard();
  }

  duplicateSelectedObject(): void {
    this.selectionManager.duplicateSelection();
  }

  deleteSelectedObject(): void {
    if (!this.selectedObject) return;
    this.saveUndoState(); // Save before deletion
    const scene = this.game.sceneManager.currentScene;
    if (scene) {
      if (this.selectedObject.type === 'Folder') {
        const rootFolderId = (this.selectedObject as any).folderId;
        const folderIdsToDelete = new Set<string>([rootFolderId]);
        const subFoldersToDelete: any[] = [];

        const queue: string[] = [rootFolderId];
        while (queue.length > 0) {
          const current = queue.shift()!;
          for (const f of scene.folders) {
            const fid = (f as any).folderId;
            if ((f as any).folder === current && !folderIdsToDelete.has(fid)) {
              folderIdsToDelete.add(fid);
              subFoldersToDelete.push(f);
              queue.push(fid);
            }
          }
        }

        const children = [
          ...scene.entities.filter((e: any) => folderIdsToDelete.has(e.folder)),
          ...scene.walkbox.filter((w: any) => folderIdsToDelete.has(w.folder)),
          ...scene.triggerboxes.filter((t: any) => folderIdsToDelete.has(t.folder)),
        ];
        for (const child of children) {
          if (child instanceof Walkbox) scene.removeWalkbox(child);
          else if (child instanceof Triggerbox) scene.removeTriggerbox(child);
          else if (child instanceof Entity) scene.removeEntity(child);
        }

        for (const sub of subFoldersToDelete) {
          scene.removeFolder(sub);
        }
      }

      if (this.selectedObject.type === 'Folder') {
        scene.removeFolder(this.selectedObject as any);
      } else if (this.selectedObject instanceof Walkbox) {
        scene.removeWalkbox(this.selectedObject);
      } else if (this.selectedObject instanceof Triggerbox) {
        scene.removeTriggerbox(this.selectedObject);
      } else if (this.selectedObject instanceof Entity) {
        scene.removeEntity(this.selectedObject);
      }
    }

    this.selectedObject = null;
    this.selectObject(null); // Ensure store updates
    this.refreshHierarchy();
  }

  redrawSelected(): void {
    if (!this.selectedObject) return;
    const type = this.selectedObject.type;

    if (type === 'Walkbox' || type === 'Triggerbox') {
      // Keep object, just clear points
      if ((this.selectedObject as any).poly) {
        (this.selectedObject as any).poly = [];
      }

      this.transformManager.currentPolygon = [];
      this.transformManager.creationType = type as any;
      this.transformManager.drawMode = true;

      // UI Feedback
      const chk = document.getElementById('chk-draw-mode') as HTMLInputElement;
      if (chk) chk.checked = true;

      if (type === 'Walkbox') useEditorStore.getState().setMode('DRAW_WALKBOX');
      else useEditorStore.getState().setMode('DRAW_TRIGGER');
    }
  }

  // Renamed from loadScene to loadSceneData to differentiate from file fetching

  onClick(x: number, y: number): boolean {
    return this.transformManager.onClick(x, y);
  }

  finishPolygon(): void {
    this.transformManager.finishPolygon();
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.enabled) return;

    const scene = this.game.sceneManager.currentScene;
    let camX = 0;
    let camY = 0;
    if (scene && scene.camera) {
      camX = scene.camera.x;
      camY = scene.camera.y;
    }

    const halfW = this.game.canvas.width / 2;
    const halfH = this.game.canvas.height / 2;

    // Render current polygon (World Space)
    if (this.transformManager.currentPolygon && this.transformManager.currentPolygon.length > 0) {
      ctx.save();
      ctx.translate(halfW, halfH);
      ctx.scale(
        scene && scene.camera ? scene.camera.zoom : 1,
        scene && scene.camera ? scene.camera.zoom : 1
      );
      ctx.translate(-camX, -camY); // Apply Camera

      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 1.25 / (scene && scene.camera ? scene.camera.zoom : 1);
      ctx.beginPath();
      ctx.moveTo(
        this.transformManager.currentPolygon[0].x,
        this.transformManager.currentPolygon[0].y
      );
      for (let i = 1; i < this.transformManager.currentPolygon.length; i++) {
        ctx.lineTo(
          this.transformManager.currentPolygon[i].x,
          this.transformManager.currentPolygon[i].y
        );
      }
      ctx.stroke();
      ctx.fillStyle = '#ffff00';
      this.transformManager.currentPolygon.forEach((p) => ctx.fillRect(p.x - 2, p.y - 2, 4, 4));
      ctx.restore();
    }

    const highlighted = this.selectionManager.hasMultiSelection()
      ? this.selectionManager.getSelectedObjects()
      : this.selectedObject
        ? [this.selectedObject]
        : [];

    // Highlight selected object(s)
    for (const selected of highlighted) {
      ctx.save();
      const zoom = scene && scene.camera ? scene.camera.zoom : 1.0;

      if (selected instanceof Entity) {
        if (this.game.inventoryManager?.getInventorySlotForEntity(selected)) {
          ctx.restore();
          continue;
        }

        if ((selected as any).type === 'Quad') {
          // ** QUAD SELECTION RENDERING **
          const quad = selected as QuadObject;

          const globalP = quad.parallax !== undefined ? quad.parallax : 1.0;

          ctx.save();
          ctx.translate(halfW, halfH);
          ctx.scale(zoom, zoom);
          ctx.translate(-camX * globalP, -camY * globalP);

          ctx.beginPath();
          // Draw Outline
          const verts = quad.vertices;
          if (verts.length > 0) {
            const getDrawPos = (v: any) => {
              const effP = (v.p !== undefined ? v.p : 1.0) * globalP;
              return {
                x: v.x - camX * (effP - globalP),
                y: v.y - camY * (effP - globalP),
              };
            };

            const p0 = getDrawPos(verts[0]);
            ctx.moveTo(p0.x, p0.y);
            for (let i = 1; i < verts.length; i++) {
              const pi = getDrawPos(verts[i]);
              ctx.lineTo(pi.x, pi.y);
            }
            ctx.closePath();

            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 1.25 / zoom;
            ctx.stroke();

            // Draw Vertices
            ctx.fillStyle = '#00ff00';
            const handleSize = 5 / zoom;
            verts.forEach((v: any, i: number) => {
              const p = getDrawPos(v);
              // Highlight dragging vertex
              if (
                this.transformManager.isDragging &&
                this.transformManager.draggingVertexIndex === i
              ) {
                ctx.fillStyle = '#ffff00';
              } else if (v.binding) {
                ctx.fillStyle = '#00FFFF'; // Bound = Cyan
              } else if (useEditorStore.getState().selectedVertexIndex === i) {
                ctx.fillStyle = '#ffff00';
              } else {
                ctx.fillStyle = '#00ff00';
              }

              // Calculate Centroid for Quad "Inside" shift
              // Simple average
              let cx = 0,
                cy = 0;
              verts.forEach((vv: any) => {
                const vp = getDrawPos(vv);
                cx += vp.x;
                cy += vp.y;
              });
              cx /= verts.length;
              cy /= verts.length;

              // Vector from Vertex to Centroid
              const dx = cx - p.x;
              const dy = cy - p.y;
              const len = Math.sqrt(dx * dx + dy * dy);

              let shiftX = 0;
              let shiftY = 0;

              if (len > 0) {
                // Shift by half handle size + padding?
                // handleSize is 6. We want to be "inside".
                const shiftDist = handleSize / 2 + 2 / zoom; // Slight offset
                shiftX = (dx / len) * shiftDist;
                shiftY = (dy / len) * shiftDist;
              }

              // Draw Handle Centered at Shifted Pos
              // ctx.fillRect(p.x - handleSize/2 + shiftX, p.y - handleSize/2 + shiftY, handleSize, handleSize);

              // Actually, let's just draw it.
              ctx.fillRect(
                p.x - handleSize / 2 + shiftX,
                p.y - handleSize / 2 + shiftY,
                handleSize,
                handleSize
              );
            });
          }
          ctx.restore();
        } else {
          // ** STANDARD ENTITY SELECTION **
          const entity = selected as Entity;
          const p = entity.parallax !== undefined ? entity.parallax : 1.0;

          const vOx = (entity as any).visualOffset ? (entity as any).visualOffset.x : 0;
          const vOy = (entity as any).visualOffset ? (entity as any).visualOffset.y : 0;

          ctx.translate(halfW, halfH);
          ctx.scale(zoom, zoom);
          ctx.translate(-camX * p + vOx, -camY * p + vOy);

          if (entity.locked) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 1 / zoom;
            ctx.setLineDash([4 / zoom, 4 / zoom]); // Dashed, thin line
          } else {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.25 / zoom;
            ctx.setLineDash([4 / zoom, 4 / zoom]);
          }

          // Entity Anchor is Bottom-Center
          // We draw the rect starting at Top-Left relative to that anchor
          const drawX = entity.x;
          const drawY = entity.y;

          ctx.strokeRect(
            drawX - entity.width / 2,
            drawY - entity.height,
            entity.width,
            entity.height
          );

          // Draw Resize Handles (Only if NOT locked)
          if (!entity.locked) {
            ctx.fillStyle = '#ffffff';
            const hSize = 5 / zoom; // Handle size

            const l = drawX - entity.width / 2;
            const r = drawX + entity.width / 2;
            const t = drawY - entity.height;
            const b = drawY;

            // NW - Top Left Corner -> Draw Inside (Top-Left of Rect is top-left of handle)
            ctx.fillRect(l, t, hSize, hSize);

            // NE - Top Right Corner -> Draw Inside (Shift Left)
            ctx.fillRect(r - hSize, t, hSize, hSize);

            // SW - Bottom Left Corner -> Draw Inside (Shift Up - wait, bottom is positive Y)
            // b is bottom Y. we want to draw above it.
            ctx.fillRect(l, b - hSize, hSize, hSize);

            // SE - Bottom Right Corner -> Draw Inside
            ctx.fillRect(r - hSize, b - hSize, hSize, hSize);
          }
        }

        ctx.restore();
      } else if (selected instanceof Walkbox || selected instanceof Triggerbox) {
        // Triggerbox/Walkbox
        const p = (selected as any).parallax !== undefined ? (selected as any).parallax : 1.0;
        ctx.translate(halfW, halfH);
        ctx.scale(zoom, zoom);
        ctx.translate(-camX * p, -camY * p);

        const poly = selected.poly;

        // If getting bounding box or drawing highlight
        if (selected instanceof Walkbox) ctx.strokeStyle = '#ff0000';
        else ctx.strokeStyle = '#ff00ff';

        if (selected.locked) {
          // Locked Style
          ctx.lineWidth = 1 / zoom;
          ctx.setLineDash([]);
        } else {
          ctx.lineWidth = 1.75 / zoom;
          ctx.setLineDash([]);
        }

        ctx.beginPath();

        if (poly.length > 0) {
          ctx.moveTo(poly[0].x, poly[0].y);
          for (let i = 1; i < poly.length; i++) {
            ctx.lineTo(poly[i].x, poly[i].y);
          }
          ctx.closePath();
          ctx.stroke();

          // Draw Vertex Handles (Only if NOT locked)
          if (!selected.locked) {
            if (selected instanceof Walkbox) ctx.fillStyle = '#ff0000';
            else ctx.fillStyle = '#ff00ff';

            const handleSize = 5 / zoom;
            for (const pt of poly) {
              ctx.fillRect(pt.x - handleSize / 2, pt.y - handleSize / 2, handleSize, handleSize);
            }
          }
        }
      }
      ctx.restore();
    }

    // Draw area selection rectangle
    if (this.transformManager.isBoxSelecting()) {
      const box = this.transformManager.getSelectionBox();
      if (box) {
        const x = Math.min(box.start.x, box.current.x);
        const y = Math.min(box.start.y, box.current.y);
        const w = Math.abs(box.current.x - box.start.x);
        const h = Math.abs(box.current.y - box.start.y);
        ctx.save();
        ctx.strokeStyle = '#79EFA4';
        ctx.fillStyle = 'rgba(121, 239, 164, 0.12)';
        ctx.lineWidth = 0.75;
        ctx.setLineDash([4, 3]);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
      }
    }

    // Draw Scaling Lines (Horizon and Front)
    // const scene = this.game.sceneManager.currentScene; // Already declared at top
    if (
      scene &&
      scene.scaling &&
      scene.scaling.enabled &&
      (this.selectedObject as any) === 'SCENE'
    ) {
      ctx.save();
      ctx.font = '5px monospace';

      const zoom = scene.camera ? scene.camera.zoom : 1;
      const camY = scene.camera ? scene.camera.y : 0;

      // Horizon Line (Min Scale)
      // Transform World Y -> Screen Y
      const horizonWorldY = scene.scaling.horizon;
      const horizonScreenY = (horizonWorldY - camY) * zoom + halfH;

      ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)'; // Cyan, semi-transparent
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, horizonScreenY);
      ctx.lineTo(this.game.canvas.width, horizonScreenY);
      ctx.stroke();
      ctx.fillStyle = 'rgba(0, 255, 255, 0.8)';
      ctx.fillText(`Horizon(${horizonWorldY})`, 5, horizonScreenY - 2);

      // Front Line (Max Scale)
      const frontWorldY = scene.scaling.front;
      const frontScreenY = (frontWorldY - camY) * zoom + halfH;

      ctx.strokeStyle = 'rgba(255, 0, 255, 0.5)'; // Magenta, semi-transparent
      ctx.beginPath();
      ctx.moveTo(0, frontScreenY);
      ctx.lineTo(this.game.canvas.width, frontScreenY);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 0, 255, 0.8)';
      ctx.fillText(`Front(${frontWorldY})`, 5, frontScreenY - 2);

      ctx.restore();
    }
  }
}
