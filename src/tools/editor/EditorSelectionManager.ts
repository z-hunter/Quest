import { SceneEditor } from '../SceneEditor';
import { SceneObject } from '../../entities/SceneObject';
import { Actor } from '../../entities/Actor';
import { Entity } from '../../entities/Entity';
import { Walkbox } from '../../entities/Walkbox';
import { Triggerbox } from '../../entities/Triggerbox';
import { useEditorStore } from '../../store/editorStore';

type SelectionPayloadKind = 'single' | 'group' | 'group_prefab';

interface SerializedSelectionPayload {
  kind: SelectionPayloadKind;
  version: number;
  items: any[];
  order: string[];
  anchorKey: string | null;
  meta?: {
    source?: 'copy' | 'duplicate' | 'paste' | 'prefab-load' | 'prefab-save';
    timestamp?: number;
  };
}

type PayloadSource = 'copy' | 'duplicate' | 'paste' | 'prefab-load' | 'prefab-save';

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
    if (obj.type === 'Folder') return { type: 'Folder', id: obj.name, key: `Folder:${obj.name}` };
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

      if ((obj as any).type === 'Quad' && Array.isArray((obj as any).vertices)) {
        const quad = obj as any;
        const vertices = quad.vertices || [];
        if (!vertices.length) return;
        const cx = vertices.reduce((acc: number, v: any) => acc + v.x, 0) / vertices.length;
        const cy = vertices.reduce((acc: number, v: any) => acc + v.y, 0) / vertices.length;
        this._groupSnapshot.set(key, {
          kind: 'quad',
          obj: quad,
          centroidX: cx,
          centroidY: cy,
          vertices: vertices.map((v: any) => ({
            x: v.x,
            y: v.y,
            p: v.p,
            binding: v.binding ? JSON.parse(JSON.stringify(v.binding)) : undefined,
          })),
        });
        sumX += cx;
        sumY += cy;
        count++;
        return;
      }

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
      if (snap.kind === 'quad') {
        const obj = snap.obj as any;
        const vertices = (snap.vertices || []).map((v: any) => ({
          x: originX + (v.x - originX) * sx + offsetX,
          y: originY + (v.y - originY) * sx + offsetY,
          p: v.p,
          ...(v.binding ? { binding: JSON.parse(JSON.stringify(v.binding)) } : {}),
        }));

        obj.vertices = vertices;
        const cx = vertices.reduce((acc: number, v: any) => acc + v.x, 0) / vertices.length;
        const cy = vertices.reduce((acc: number, v: any) => acc + v.y, 0) / vertices.length;
        obj.x = Math.round(cx);
        obj.y = Math.round(cy);
        return;
      }

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

  handleGlobalPaste(e: ClipboardEvent): void {
    if (!this.editor.enabled) return;
    if (
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement ||
      document.activeElement instanceof HTMLSelectElement
    ) {
      return;
    }

    // Use clipboard data from event if available (Synchronous and reliable)
    const text = e.clipboardData?.getData('text');
    if (text) {
      e.preventDefault();
      this.processPasteData(text);
    }
  }

  private getCurrentSelectionForSerialization(): SceneObject[] {
    let selected: SceneObject[] = [];
    if (this.hasMultiSelection()) selected = this.getSelectedObjects();
    else if (this.editor.selectedObject instanceof SceneObject)
      selected = [this.editor.selectedObject];
    if (selected.length === 0) return [];

    // If selection includes folders, also include their contents
    const scene = this.editor.game.sceneManager.currentScene;
    if (!scene) return selected;

    const result = new Set<SceneObject>(selected);
    const folderIds = selected
      .filter((obj) => obj.type === 'Folder')
      .map((obj) => (obj as any).folderId)
      .filter(Boolean);

    if (folderIds.length > 0) {
      const allObjects: SceneObject[] = [
        ...scene.entities,
        ...scene.walkbox,
        ...scene.triggerboxes,
      ];
      for (const obj of allObjects) {
        if ((obj as any).folder && folderIds.includes((obj as any).folder)) {
          result.add(obj);
        }
      }
    }

    return Array.from(result);
  }

  private getSerializedObjectKey(data: any): string {
    const type = data?.type || 'Entity';
    const name = data?.name || 'Object';
    return `${type}:${name}`;
  }

  private buildSelectionPayload(source: PayloadSource): SerializedSelectionPayload | null {
    const selected = this.getCurrentSelectionForSerialization();
    if (selected.length === 0) return null;

    const items = selected.map((obj) => obj.toJSON());
    const order = items.map((item) => this.getSerializedObjectKey(item));

    return {
      kind: items.length > 1 ? 'group' : 'single',
      version: 2,
      items,
      order,
      anchorKey: order[0] || null,
      meta: { source, timestamp: Date.now() },
    };
  }

  private normalizeIncomingPayload(raw: any): SerializedSelectionPayload | null {
    if (!raw || typeof raw !== 'object') return null;

    // Legacy single object JSON from clipboard/prefab.
    if (raw.type && typeof raw.type === 'string') {
      const key = this.getSerializedObjectKey(raw);
      return {
        kind: 'single',
        version: 1,
        items: [raw],
        order: [key],
        anchorKey: key,
      };
    }

    const kind: SelectionPayloadKind =
      raw.kind === 'group' || raw.kind === 'group_prefab' ? raw.kind : 'single';
    let items: any[] = [];

    if (Array.isArray(raw.items)) items = raw.items;
    else if (raw.item && typeof raw.item === 'object') items = [raw.item];

    if (!items.length) return null;

    const providedOrder: string[] = Array.isArray(raw.order) ? raw.order : [];
    const defaultOrder = items.map((item) => this.getSerializedObjectKey(item));
    const order = providedOrder.length ? providedOrder : defaultOrder;
    const anchorKey: string | null = raw.anchorKey || raw.anchor || order[0] || null;

    // Keep item order stable with explicit order if it exists.
    if (providedOrder.length) {
      const byKey = new Map<string, any>();
      items.forEach((item) => byKey.set(this.getSerializedObjectKey(item), item));
      const sorted: any[] = [];
      providedOrder.forEach((key) => {
        const item = byKey.get(key);
        if (item) {
          sorted.push(item);
          byKey.delete(key);
        }
      });
      byKey.forEach((item) => sorted.push(item));
      items = sorted;
    }

    return {
      kind,
      version: typeof raw.version === 'number' ? raw.version : 1,
      items,
      order,
      anchorKey,
      meta: raw.meta,
    };
  }

  private stripAutoSuffix(name: string): string {
    const match = name.match(/^(.*?)_\d+$/);
    return match ? match[1] : name;
  }

  private getExistingSceneNames(): Set<string> {
    const scene = this.editor.game.sceneManager.currentScene;
    const names = new Set<string>();
    if (!scene) return names;

    [
      ...(scene.entities || []),
      ...(scene.folders || []),
      ...(scene.walkbox || []),
      ...(scene.triggerboxes || []),
    ].forEach((obj: any) => {
      if (obj?.name) names.add(obj.name);
    });
    return names;
  }

  private generateUniqueName(baseName: string, usedNames: Set<string>): string {
    const safeBase = (baseName || 'Object').trim() || 'Object';
    const prefix = this.stripAutoSuffix(safeBase);
    if (!usedNames.has(prefix)) return prefix;

    let counter = 1;
    let candidate = `${prefix}_${counter}`;
    while (usedNames.has(candidate)) {
      counter++;
      candidate = `${prefix}_${counter}`;
    }
    return candidate;
  }

  private getReferencePointFromSerializedData(data: any): { x: number; y: number } {
    const type = data?.type || 'Static';
    if (type === 'Quad' && Array.isArray(data?.vertices) && data.vertices.length > 0) {
      const sx = data.vertices.reduce((acc: number, v: any) => acc + v.x, 0);
      const sy = data.vertices.reduce((acc: number, v: any) => acc + v.y, 0);
      return { x: sx / data.vertices.length, y: sy / data.vertices.length };
    }

    if (
      (type === 'Walkbox' || type === 'Triggerbox') &&
      Array.isArray(data?.poly) &&
      data.poly.length
    ) {
      const minX = Math.min(...data.poly.map((p: any) => p.x));
      const minY = Math.min(...data.poly.map((p: any) => p.y));
      const maxX = Math.max(...data.poly.map((p: any) => p.x));
      const maxY = Math.max(...data.poly.map((p: any) => p.y));
      return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    }

    return {
      x: typeof data?.x === 'number' ? data.x : 0,
      y: typeof data?.y === 'number' ? data.y : 0,
    };
  }

  private getDefaultInsertionPoint(): { x: number; y: number } {
    const scene = this.editor.game.sceneManager.currentScene;
    if (scene?.camera) {
      return { x: scene.camera.x, y: scene.camera.y };
    }
    return { x: 0, y: 0 };
  }

  private getInsertionPoint(preferCursor: boolean): { x: number; y: number } {
    if (preferCursor) {
      const worldPos = this.editor.getMouseWorldPosIfOverCanvas();
      if (worldPos) return worldPos;
    }
    return this.getDefaultInsertionPoint();
  }

  private remapReferencesForPastedObject(
    node: any,
    nameMap: Map<string, string>,
    folderIdMap?: Map<string, string>
  ): void {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      node.forEach((item) => this.remapReferencesForPastedObject(item, nameMap, folderIdMap));
      return;
    }

    Object.keys(node).forEach((key) => {
      const value = node[key];
      if (typeof value === 'string') {
        if (key === 'targetName' || key === 'shadowQuadId') {
          if (nameMap.has(value)) node[key] = nameMap.get(value);
        } else if (key === 'targetId' || key === 'triggerId' || key === 'triggerID') {
          const parts = value
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => nameMap.get(part) || part);
          node[key] = parts.join(', ');
        } else if ((key === 'folderId' || key === 'folder') && folderIdMap) {
          if (folderIdMap.has(value)) node[key] = folderIdMap.get(value);
        }
      } else {
        this.remapReferencesForPastedObject(value, nameMap, folderIdMap);
      }
    });
  }

  private instantiateNormalizedPayload(
    payload: SerializedSelectionPayload,
    options?: {
      preferCursor?: boolean;
      insertionWorldPos?: { x: number; y: number } | null;
      preserveOriginalPosition?: boolean;
    }
  ): SceneObject[] {
    const scene = this.editor.game.sceneManager.currentScene;
    if (!scene || payload.items.length === 0) return [];

    const orderedItems = payload.items.map((item) => JSON.parse(JSON.stringify(item)));
    const anchorIndex = Math.max(
      0,
      payload.anchorKey
        ? orderedItems.findIndex((item) => this.getSerializedObjectKey(item) === payload.anchorKey)
        : 0
    );
    const anchorData = orderedItems[Math.max(anchorIndex, 0)];
    const anchorSourcePoint = this.getReferencePointFromSerializedData(anchorData);
    const insertionPoint = options?.preserveOriginalPosition
      ? anchorSourcePoint
      : options?.insertionWorldPos || this.getInsertionPoint(options?.preferCursor ?? true);

    const usedNames = this.getExistingSceneNames();
    const nameMap = new Map<string, string>();

    // Precompute name remapping for all pasted objects.
    orderedItems.forEach((item, index) => {
      const originalName =
        typeof item?.name === 'string' && item.name.trim()
          ? item.name
          : `${item?.type || 'Object'}_${index + 1}`;
      const uniqueName = this.generateUniqueName(originalName, usedNames);
      usedNames.add(uniqueName);
      nameMap.set(originalName, uniqueName);
    });

    const folderIdMap = new Map<string, string>();
    orderedItems.forEach((item) => {
      if (item?.type === 'Folder' && item.folderId) {
        const newId = `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        folderIdMap.set(item.folderId, newId);
      }
    });

    const created: SceneObject[] = [];
    const preserveQuadBindings = payload.items.length > 1;
    orderedItems.forEach((item, index) => {
      const originalName =
        typeof payload.items[index]?.name === 'string' ? payload.items[index].name : item.name;
      const sourcePoint = this.getReferencePointFromSerializedData(item);
      const overrideX = insertionPoint.x + (sourcePoint.x - anchorSourcePoint.x);
      const overrideY = insertionPoint.y + (sourcePoint.y - anchorSourcePoint.y);

      this.remapReferencesForPastedObject(item, nameMap, folderIdMap);
      if (item.name && nameMap.has(item.name)) {
        item.name = nameMap.get(item.name);
      }

      const newObj = this.editor.createObjectFromData(item, overrideX, overrideY, {
        preserveBindings: preserveQuadBindings && item?.type === 'Quad',
      });
      if (newObj) {
        created.push(newObj);
        if (originalName && originalName !== newObj.name) {
          this.editor.game.textAssets
            .duplicateObjectAssetIfExists(originalName, newObj.name)
            .catch((err: unknown) => console.error('Failed to duplicate text asset:', err));
        }
      }
    });

    return created;
  }

  instantiateFromSerializedData(
    raw: any,
    options?: {
      saveUndo?: boolean;
      preferCursor?: boolean;
      insertionWorldPos?: { x: number; y: number } | null;
      preserveOriginalPosition?: boolean;
    }
  ): SceneObject[] {
    const payload = this.normalizeIncomingPayload(raw);
    if (!payload) {
      console.warn('Clipboard/prefab does not contain valid serialized selection payload');
      return [];
    }

    if (options?.saveUndo) this.editor.saveUndoState();
    const created = this.instantiateNormalizedPayload(payload, {
      preferCursor: options?.preferCursor ?? true,
      insertionWorldPos: options?.insertionWorldPos,
      preserveOriginalPosition: options?.preserveOriginalPosition ?? false,
    });

    if (created.length > 1) this.setMultiSelection(created);
    else if (created.length === 1) this.selectObject(created[0]);

    return created;
  }

  copySelectionToClipboard(): void {
    const payload = this.buildSelectionPayload('copy');
    if (!payload) return;

    navigator.clipboard
      .writeText(JSON.stringify(payload, null, 2))
      .catch((err) => console.error('Failed to copy selection JSON: ', err));
  }

  duplicateSelection(): void {
    const payload = this.buildSelectionPayload('duplicate');
    if (!payload) return;

    this.instantiateFromSerializedData(payload, {
      saveUndo: true,
      preferCursor: true,
    });
  }

  async processPasteData(text: string): Promise<void> {
    try {
      let data: any;
      try {
        data = JSON.parse(text);
      } catch (_e) {
        console.warn('Clipboard does not contain valid JSON');
        return;
      }

      this.instantiateFromSerializedData(data, {
        saveUndo: true,
        preferCursor: true,
      });
    } catch (e) {
      console.error('Paste failed:', e);
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
