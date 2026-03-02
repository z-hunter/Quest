import { SceneEditor } from '../SceneEditor';
import { SceneObject } from '../../entities/SceneObject';
import { Actor } from '../../entities/Actor';
import { Entity } from '../../entities/Entity';
import { Walkbox } from '../../entities/Walkbox';
import { Triggerbox } from '../../entities/Triggerbox';
import { useEditorStore } from '../../store/editorStore';

export class EditorSelectionManager {
  private editor: SceneEditor;
  private _selectedObjects: SceneObject[] = [];
  private _groupTransform = {
    originX: 0,
    originY: 0,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  };
  private _groupSnapshot = new Map<string, any>();

  constructor(editor: SceneEditor) {
    this.editor = editor;
  }

  private getObjectTypeAndId(obj: any): {
    type: string | null;
    id: string | null;
    key: string | null;
  } {
    if (obj === null || obj === undefined) return { type: null, id: null, key: null };
    if (obj === 'SCENE') return { type: 'SCENE', id: 'SCENE', key: 'SCENE' };
    if (obj === 'SETTINGS') return { type: 'SETTINGS', id: 'SETTINGS', key: 'SETTINGS' };
    if (obj.type === 'Quad') return { type: 'Quad', id: obj.name, key: `Quad:${obj.name}` };
    if (obj instanceof Actor) return { type: 'Actor', id: obj.name, key: `Actor:${obj.name}` };
    if (obj instanceof Entity) return { type: 'Entity', id: obj.name, key: `Entity:${obj.name}` };
    if (obj instanceof Walkbox)
      return {
        type: 'Walkbox',
        id: obj.name || 'Walkbox',
        key: `Walkbox:${obj.name || 'Walkbox'}`,
      };
    if (obj instanceof Triggerbox)
      return {
        type: 'Triggerbox',
        id: obj.name || 'Triggerbox',
        key: `Triggerbox:${obj.name || 'Triggerbox'}`,
      };
    return { type: null, id: null, key: null };
  }

  private resetGroupState(): void {
    this._selectedObjects = [];
    this._groupSnapshot.clear();
    this._groupTransform = { originX: 0, originY: 0, offsetX: 0, offsetY: 0, scale: 1 };
  }

  selectObject(obj: any): void {
    this.resetGroupState();
    this.editor.selectedObject = obj;

    // Sync to Store
    const meta = this.getObjectTypeAndId(obj);
    useEditorStore.getState().selectObjects(meta.key ? [meta.key] : [], meta.id, meta.type);
    this.editor.updateUIFromObject();
    this.editor.refreshHierarchy();
  }

  toggleObjectSelection(obj: SceneObject): void {
    if (!obj) return;

    const key = this.getObjectTypeAndId(obj).key;
    if (!key) return;

    if (this._selectedObjects.length === 0 && this._selectedObject) {
      const currentKey = this.getObjectTypeAndId(this._selectedObject).key;
      if (currentKey) {
        this._selectedObjects.push(this._selectedObject);
      }
    }

    const existing = this._selectedObjects.findIndex((o) => this.getObjectTypeAndId(o).key === key);
    if (existing >= 0) {
      this._selectedObjects.splice(existing, 1);
    } else {
      this._selectedObjects.push(obj);
    }

    if (this._selectedObjects.length <= 1) {
      // Revert to single-select mode
      if (this._selectedObjects.length === 1) {
        this.selectObject(this._selectedObjects[0]);
      } else {
        this.selectObject(null);
      }
      return;
    }

    this.editor.selectedObject = this._selectedObjects[this._selectedObjects.length - 1];
    this.rebuildGroupTransformSnapshot();

    const keys = this._selectedObjects
      .map((o) => this.getObjectTypeAndId(o).key)
      .filter((k): k is string => !!k);

    useEditorStore
      .getState()
      .selectObjects(keys, this.editor.selectedObject?.name || null, 'MULTI');
    this.editor.updateUIFromObject();
    this.editor.refreshHierarchy();
  }

  setMultiSelection(objs: SceneObject[]): void {
    const uniq = new Map<string, SceneObject>();
    objs.forEach((o) => {
      const key = this.getObjectTypeAndId(o).key;
      if (o && key) uniq.set(key, o);
    });

    const selected = [...uniq.values()];
    if (selected.length <= 1) {
      this.selectObject(selected[0] || null);
      return;
    }

    this._selectedObjects = selected;
    this.editor.selectedObject = selected[selected.length - 1];
    this.rebuildGroupTransformSnapshot();

    const keys = selected
      .map((o) => this.getObjectTypeAndId(o).key)
      .filter((k): k is string => !!k);

    useEditorStore
      .getState()
      .selectObjects(keys, this.editor.selectedObject?.name || null, 'MULTI');
    this.editor.updateUIFromObject();
    this.editor.refreshHierarchy();
  }

  isInMultiSelection(obj: any): boolean {
    const key = this.getObjectTypeAndId(obj).key;
    if (!key) return false;
    return this._selectedObjects.some((o) => this.getObjectTypeAndId(o).key === key);
  }

  hasMultiSelection(): boolean {
    return this._selectedObjects.length > 1;
  }

  getSelectedObjects(): SceneObject[] {
    return [...this._selectedObjects];
  }

  getGroupTransform() {
    return { ...this._groupTransform };
  }

  rebuildGroupTransformSnapshot(): void {
    if (!this.hasMultiSelection()) return;

    this._groupSnapshot.clear();
    let sumX = 0;
    let sumY = 0;
    let count = 0;

    this._selectedObjects.forEach((obj) => {
      const key = this.getObjectTypeAndId(obj).key;
      if (!key) return;

      if (obj instanceof Entity) {
        this._groupSnapshot.set(key, {
          kind: 'entity',
          obj,
          x: obj.x,
          y: obj.y,
          modelScale: obj.modelScale ?? 1,
        });
        sumX += obj.x;
        sumY += obj.y;
        count++;
        return;
      }

      if (obj instanceof Walkbox || obj instanceof Triggerbox) {
        const poly = obj.poly || [];
        if (poly.length === 0) return;
        const cx = poly.reduce((acc: number, p: any) => acc + p.x, 0) / poly.length;
        const cy = poly.reduce((acc: number, p: any) => acc + p.y, 0) / poly.length;
        this._groupSnapshot.set(key, {
          kind: 'poly',
          obj,
          centroidX: cx,
          centroidY: cy,
          poly: poly.map((p: any) => ({ x: p.x, y: p.y })),
        });
        sumX += cx;
        sumY += cy;
        count++;
      }
    });

    this._groupTransform.originX = count > 0 ? sumX / count : 0;
    this._groupTransform.originY = count > 0 ? sumY / count : 0;
    this._groupTransform.offsetX = 0;
    this._groupTransform.offsetY = 0;
    this._groupTransform.scale = 1;
  }

  applyGroupTransform(offsetX: number, offsetY: number, scale: number): void {
    if (!this.hasMultiSelection()) return;
    if (this._groupSnapshot.size === 0) this.rebuildGroupTransformSnapshot();

    const sx = Number.isFinite(scale) ? Math.max(0.01, scale) : 1;
    const { originX, originY } = this._groupTransform;
    const scene = this.editor.game.sceneManager.currentScene;

    this._groupSnapshot.forEach((snap) => {
      if (snap.kind === 'entity') {
        const obj = snap.obj as Entity;
        const rx = snap.x - originX;
        const ry = snap.y - originY;

        obj.x = Math.round(originX + rx * sx + offsetX);
        obj.y = Math.round(originY + ry * sx + offsetY);
        obj.modelScale = snap.modelScale * sx;

        if (!obj.ignoreScaling && scene?.scaling?.enabled) {
          const factor = scene.getScaling(obj.y) * obj.modelScale;
          obj.scale = factor;
        } else {
          obj.scale = obj.modelScale;
        }
        return;
      }

      if (snap.kind === 'poly') {
        const obj = snap.obj as Walkbox | Triggerbox;
        const rcx = snap.centroidX - originX;
        const rcy = snap.centroidY - originY;
        const targetCx = originX + rcx * sx + offsetX;
        const targetCy = originY + rcy * sx + offsetY;

        const scaledPoly = snap.poly.map((p: any) => ({
          x: originX + (p.x - originX) * sx,
          y: originY + (p.y - originY) * sx,
        }));
        const scaledCx =
          scaledPoly.reduce((acc: number, p: any) => acc + p.x, 0) / scaledPoly.length;
        const scaledCy =
          scaledPoly.reduce((acc: number, p: any) => acc + p.y, 0) / scaledPoly.length;
        const dx = targetCx - scaledCx;
        const dy = targetCy - scaledCy;
        obj.poly = scaledPoly.map((p: any) => ({
          x: Math.round(p.x + dx),
          y: Math.round(p.y + dy),
        }));
      }
    });

    this._groupTransform.offsetX = offsetX;
    this._groupTransform.offsetY = offsetY;
    this._groupTransform.scale = sx;
    this.editor.updateUIFromObject();
    this.editor.refreshHierarchy();
  }

  duplicateSelectedObject(): void {
    const obj = this.editor.selectedObject;
    if (!obj || !(obj instanceof SceneObject)) return;

    // serialize
    const data = obj.toJSON();

    // Generate new name
    const scene = this.editor.game.sceneManager.currentScene;
    if (!scene) return;

    // Base Name
    const baseName = data.name;
    // Strip existing suffix if present
    const match = baseName.match(/^(.*?)_\d+$/);
    const prefix = match ? match[1] : baseName;

    let counter = 1;
    let newName = `${prefix}_${counter}`;

    // Check availability
    // We check against all entities, walkboxes, triggerboxes
    const allObjects = [
      ...(scene.entities || []),
      ...(scene.walkbox || []),
      ...(scene.triggerboxes || []),
    ];

    const isNameTaken = (n: string) => allObjects.some((o: any) => o.name === n);

    while (isNameTaken(newName)) {
      counter++;
      newName = `${prefix}_${counter}`;
    }

    data.name = newName;
    data.x = (data.x || 0) + 10;
    data.y = (data.y || 0) + 10;

    // Fix Component IDs if they reference self (Backface, Shadow)
    // Similar logic to Paste...

    // Use unified creation from Editor
    const newObj = this.editor.createObjectFromData(data);
    if (newObj) {
      this.selectObject(newObj);
      this.editor.refreshHierarchy();
    }
  }

  handleGlobalPaste(e: ClipboardEvent): void {
    if (!this.editor.enabled) return;
    if (document.activeElement instanceof HTMLInputElement) return;

    // Use clipboard data from event if available (Synchronous and reliable)
    const text = e.clipboardData?.getData('text');
    if (text) {
      e.preventDefault();
      this.processPasteData(text);
    }
  }

  async processPasteData(text: string): Promise<void> {
    try {
      this.editor.saveUndoState(); // Save before paste
      let data: any;
      try {
        data = JSON.parse(text);
      } catch (_e) {
        console.warn('Clipboard does not contain valid JSON');
        return;
      }

      // Basic Validation
      if (!data || typeof data !== 'object') {
        console.warn('Clipboard data is not an object');
        return;
      }

      // Check Mouse Pos
      if (!this.editor.lastMousePos) {
        return;
      }

      // Helper to get World Coords - delegating to Editor for now
      // @ts-ignore
      const worldPos = this.editor.convertScreenToWorld(
        this.editor.lastMousePos.x,
        this.editor.lastMousePos.y
      );

      // Ensure unique name for Paste as well
      const scene = this.editor.game.sceneManager.currentScene;
      if (scene) {
        const baseName = data.name || 'Object';
        const match = baseName.match(/^(.*?)_\d+$/);
        const prefix = match ? match[1] : baseName;

        let counter = 1;
        let newName = `${prefix}_${counter}`;
        const allObjects = [
          ...(scene.entities || []),
          ...(scene.walkbox || []),
          ...(scene.triggerboxes || []),
        ];
        const isNameTaken = (n: string) => allObjects.some((o: any) => o.name === n);
        while (isNameTaken(newName)) {
          counter++;
          newName = `${prefix}_${counter}`;
        }
        data.name = newName;

        // Fix Component References (Self-Targeting)
        if (data.components) {
          const srcName = scene.entities.find((e: any) => e.name === baseName)
            ? baseName
            : baseName;
          data.components.forEach((comp: any) => {
            if (comp.type === 'Backface') {
              if (comp.targetId === srcName || comp.targetId === baseName) {
                comp.targetId = newName;
              }
            }
          });
        }
      }

      // Create
      const newObj = this.editor.createObjectFromData(data, worldPos.x, worldPos.y);
      if (newObj) {
        this.selectObject(newObj);
        this.editor.refreshHierarchy();
      }
    } catch (e) {
      console.error('Paste Failed:', e);
    }
  }

  private dirty = false;
  private _selectedObject: SceneObject | null = null;

  get selectedObject(): SceneObject | null {
    return this._selectedObject;
  }
  set selectedObject(val: SceneObject | null) {
    this._selectedObject = val;
  }

  notifyObjectChanged(obj: SceneObject): void {
    // Update UI if changed object is selected singly or belongs to current multi-selection
    const isPrimary = obj === this._selectedObject;
    const isInMulti = this.hasMultiSelection() && this.isInMultiSelection(obj);
    if (!isPrimary && !isInMulti) return;

    if (!this.dirty) {
      this.dirty = true;
      requestAnimationFrame(() => {
        useEditorStore.getState().incrementObjectVersion();
        this.dirty = false;
      });
    }
  }
}
