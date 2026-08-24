import { SceneEditor } from '../SceneEditor';
import { SceneObject } from '../../entities/SceneObject';
import { Actor } from '../../entities/Actor';
import { Entity } from '../../entities/Entity';
import { QuadObject, type QuadVertex } from '../../entities/QuadObject';
import { Box3DObject, rotateAroundAxis, type Box3DPoint } from '../../entities/Box3DObject';
import { Folder, type CompoundBox3DState } from '../../entities/Folder';
import { Walkbox } from '../../entities/Walkbox';
import { Triggerbox } from '../../entities/Triggerbox';
import { useEditorStore } from '../../store/editorStore';
import {
  getParallaxFocalLength,
  projectParallaxPoint,
  rotateParallaxPointY,
  unprojectParallaxPoint,
} from '../../utils/Parallax';

type SelectionPayloadKind = 'single' | 'group' | 'group_prefab';

interface SerializedSelectionPayload {
  kind: SelectionPayloadKind;
  version: number;
  items: any[];
  order: string[];
  anchorKey: string | null;
  rootKeys: string[];
  meta?: {
    source?: 'copy' | 'duplicate' | 'paste' | 'prefab-load' | 'prefab-save';
    timestamp?: number;
  };
}

type PayloadSource = 'copy' | 'duplicate' | 'paste' | 'prefab-load' | 'prefab-save';

type VertexRef = { quad: QuadObject; index: number; v: QuadVertex };

type WeldedNode = {
  refs: VertexRef[];
  x: number;
  y: number;
  p: number;
};

type AssemblyState =
  | { kind: 'none'; canPrepare: false; canRotate: false; message?: string }
  | { kind: 'unprepared'; canPrepare: boolean; canRotate: false; message?: string }
  | { kind: 'preview'; canPrepare: false; canRotate: false }
  | { kind: 'prepared'; canPrepare: false; canRotate: true; assemblyId: string }
  | { kind: 'partial'; canPrepare: false; canRotate: false; assemblyId: string; message: string }
  | { kind: 'mixed'; canPrepare: false; canRotate: false; message: string };

type PreparedPreview = {
  assemblyId: string;
  quads: QuadObject[];
  originals: Map<QuadObject, { vertices: QuadVertex[]; x: number; y: number }>;
};

const ASSEMBLY_EPSILON = 0.0001;
const COMPOUND_MIN_MULTIPLIER = 0.01;
type CompoundNumericField = Exclude<keyof CompoundBox3DState, 'pivotX' | 'pivotY' | 'pivotZ'>;

export class EditorSelectionManager {
  private editor: SceneEditor;
  private _selectedObjects: SceneObject[] = [];
  private _groupTransform = {
    originX: 0,
    originY: 0,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    rotateY: 0,
    axisX: 0,
    axisP: 1,
  };
  private _groupSnapshot = new Map<string, any>();
  private _preparedPreview: PreparedPreview | null = null;

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
    if (obj instanceof Box3DObject)
      return { type: 'Box3D', id: obj.name, key: `Box3D:${obj.name}` };
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
    this.cancelPrepare3D();
    this._selectedObjects = [];
    this._groupSnapshot.clear();
    this._groupTransform = {
      originX: 0,
      originY: 0,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      rotateY: 0,
      axisX: 0,
      axisP: 1,
    };
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

  getCompoundBox3DObjects(folder: Folder): Box3DObject[] {
    const scene = this.editor.game.sceneManager.currentScene;
    if (!scene) return [];
    const folderIds = new Set<string>([folder.folderId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const child of scene.folders || []) {
        if (child.folder && folderIds.has(child.folder) && !folderIds.has(child.folderId)) {
          folderIds.add(child.folderId);
          changed = true;
        }
      }
    }
    return (scene.entities || []).filter(
      (object: any): object is Box3DObject =>
        object instanceof Box3DObject && !!object.folder && folderIds.has(object.folder)
    );
  }

  isCompoundBox3DFolder(value: unknown): value is Folder {
    return value instanceof Folder && this.getCompoundBox3DObjects(value).length > 0;
  }

  private createCompoundBox3DState(boxes: Box3DObject[]): CompoundBox3DState {
    const vertices = boxes.flatMap((box) => box.getWorldVertices());
    const min = {
      x: Math.min(...vertices.map((point) => point.x)),
      y: Math.min(...vertices.map((point) => point.y)),
      z: Math.min(...vertices.map((point) => point.z)),
    };
    const max = {
      x: Math.max(...vertices.map((point) => point.x)),
      y: Math.max(...vertices.map((point) => point.y)),
      z: Math.max(...vertices.map((point) => point.z)),
    };
    const center = {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    };
    return {
      ...center,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      uniformScale: 1,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      bottomWidth: 1,
      bottomDepth: 1,
      topWidth: 1,
      topDepth: 1,
      height: 1,
      topOffsetX: 0,
      topOffsetZ: 0,
      pivotX: { ...center },
      pivotY: { ...center },
      pivotZ: { ...center },
    };
  }

  getCompoundBox3DState(folder: Folder): CompoundBox3DState | null {
    const boxes = this.getCompoundBox3DObjects(folder);
    if (boxes.length === 0) return null;
    return JSON.parse(JSON.stringify(folder.compoundBox3D || this.createCompoundBox3DState(boxes)));
  }

  private getCompoundAxisDirections(
    state: CompoundBox3DState
  ): Record<'x' | 'y' | 'z', Box3DPoint> {
    const origin = { x: 0, y: 0, z: 0 };
    const x = { x: 1, y: 0, z: 0 };
    const y = rotateAroundAxis({ x: 0, y: 1, z: 0 }, origin, x, state.rotationX);
    let z = rotateAroundAxis({ x: 0, y: 0, z: 1 }, origin, { x: 0, y: 1, z: 0 }, state.rotationY);
    z = rotateAroundAxis(z, origin, x, state.rotationX);
    return { x, y, z };
  }

  applyCompoundBox3DPivot(
    folder: Folder,
    pivot: 'pivotX' | 'pivotY' | 'pivotZ',
    axis: keyof Box3DPoint,
    value: number
  ): boolean {
    const state = this.getCompoundBox3DState(folder);
    if (!state || !Number.isFinite(value)) return false;
    state[pivot][axis] = value;
    folder.compoundBox3D = state;
    this.editor.updateUIFromObject();
    this.editor.refreshHierarchy();
    return true;
  }

  applyCompoundBox3DField(folder: Folder, field: CompoundNumericField, value: number): boolean {
    const state = this.getCompoundBox3DState(folder);
    const boxes = this.getCompoundBox3DObjects(folder);
    if (!state || boxes.length === 0 || !Number.isFinite(value)) return false;
    const current = state[field];
    if (typeof current !== 'number') return false;

    if (field === 'x' || field === 'y' || field === 'z') {
      const delta = value - current;
      boxes.forEach((box) => (box[field] += delta));
      state[field] = value;
      (['pivotX', 'pivotY', 'pivotZ'] as const).forEach((pivot) => {
        state[pivot][field] += delta;
      });
    } else if (field === 'rotationX' || field === 'rotationY' || field === 'rotationZ') {
      const axis = field.slice(-1).toLowerCase() as 'x' | 'y' | 'z';
      const pivotKey = `pivot${axis.toUpperCase()}` as 'pivotX' | 'pivotY' | 'pivotZ';
      const delta = value - current;
      const direction = this.getCompoundAxisDirections(state)[axis];
      const pivot = state[pivotKey];
      boxes.forEach((box) => box.rotateAroundWorldAxis(pivot, direction, delta));
      const center = rotateAroundAxis(
        { x: state.x, y: state.y, z: state.z },
        pivot,
        direction,
        delta
      );
      state.x = center.x;
      state.y = center.y;
      state.z = center.z;
      (['pivotX', 'pivotY', 'pivotZ'] as const).forEach((key) => {
        state[key] = rotateAroundAxis(state[key], pivot, direction, delta);
      });
      state[field] = value;
    } else if (
      field === 'uniformScale' ||
      field === 'scaleX' ||
      field === 'scaleY' ||
      field === 'scaleZ'
    ) {
      const next = Math.max(COMPOUND_MIN_MULTIPLIER, value);
      const ratio = next / Math.max(COMPOUND_MIN_MULTIPLIER, current);
      const axes: Array<'x' | 'y' | 'z'> =
        field === 'uniformScale'
          ? ['x', 'y', 'z']
          : [field.slice(-1).toLowerCase() as 'x' | 'y' | 'z'];
      boxes.forEach((box) => {
        axes.forEach((axis) => {
          box[axis] = state[axis] + (box[axis] - state[axis]) * ratio;
        });
        box[field] *= ratio;
      });
      (['pivotX', 'pivotY', 'pivotZ'] as const).forEach((pivot) => {
        axes.forEach((axis) => {
          state[pivot][axis] = state[axis] + (state[pivot][axis] - state[axis]) * ratio;
        });
      });
      state[field] = next;
    } else if (field === 'topOffsetX' || field === 'topOffsetZ') {
      const delta = value - current;
      boxes.forEach((box) => (box[field] += delta));
      state[field] = value;
    } else {
      const next = Math.max(COMPOUND_MIN_MULTIPLIER, value);
      const ratio = next / Math.max(COMPOUND_MIN_MULTIPLIER, current);
      boxes.forEach((box) => (box[field] *= ratio));
      state[field] = next;
    }

    folder.compoundBox3D = state;
    const scene = this.editor.game.sceneManager.currentScene;
    boxes.forEach((box) => box.syncFaces(scene));
    this.editor.updateUIFromObject();
    this.editor.refreshHierarchy();
    return true;
  }

  private getSelectedQuads(): QuadObject[] {
    return this._selectedObjects.filter(
      (object): object is QuadObject => object instanceof QuadObject
    );
  }

  private cloneQuadVertices(vertices: QuadVertex[]): QuadVertex[] {
    return vertices.map((vertex) => ({
      ...vertex,
      ...(vertex.binding ? { binding: JSON.parse(JSON.stringify(vertex.binding)) } : {}),
    }));
  }

  private getAssemblyQuads(assemblyId: string): QuadObject[] {
    const scene = this.editor.game.sceneManager.currentScene;
    return (scene?.entities || []).filter(
      (object: any): object is QuadObject =>
        object instanceof QuadObject && object.quad3dAssemblyId === assemblyId
    );
  }

  get3DAssemblyState(): AssemblyState {
    if (this._preparedPreview) return { kind: 'preview', canPrepare: false, canRotate: false };
    const quads = this.getSelectedQuads();
    if (quads.length === 0) return { kind: 'none', canPrepare: false, canRotate: false };

    const ids = new Set(
      quads.map((quad) => quad.quad3dAssemblyId).filter((id): id is string => !!id)
    );
    if (ids.size === 0) {
      return {
        kind: 'unprepared',
        canPrepare: quads.length >= 3,
        canRotate: false,
        message: quads.length >= 3 ? undefined : 'Select at least three Quad faces',
      };
    }
    if (ids.size !== 1 || quads.some((quad) => !quad.quad3dAssemblyId)) {
      return {
        kind: 'mixed',
        canPrepare: false,
        canRotate: false,
        message: 'Select one complete 3D Assembly',
      };
    }

    const assemblyId = [...ids][0];
    const members = this.getAssemblyQuads(assemblyId);
    const selectedNames = new Set(quads.map((quad) => quad.name));
    if (members.length === 0 || members.some((quad) => !selectedNames.has(quad.name))) {
      return {
        kind: 'partial',
        canPrepare: false,
        canRotate: false,
        assemblyId,
        message: 'Select the complete 3D Assembly',
      };
    }
    return { kind: 'prepared', canPrepare: false, canRotate: true, assemblyId };
  }

  selectPreparedAssembly(): void {
    const state = this.get3DAssemblyState();
    if (state.kind !== 'partial') return;
    const otherObjects = this._selectedObjects.filter((object) => !(object instanceof QuadObject));
    this.setMultiSelection([...otherObjects, ...this.getAssemblyQuads(state.assemblyId)]);
  }

  private getSnapshotVertex(quad: QuadObject, index: number): QuadVertex | null {
    const key = this.getObjectTypeAndId(quad).key;
    const snapshot = key ? this._groupSnapshot.get(key) : null;
    return snapshot?.kind === 'quad'
      ? snapshot.vertices?.[index] || null
      : quad.vertices[index] || null;
  }

  private collectWeldedNodes(quads: QuadObject[], fromSnapshot: boolean): WeldedNode[] | null {
    const scene = this.editor.game.sceneManager.currentScene;
    const selectedKeys = new Set(quads.map((quad) => quad.name));
    const visited = new Set<string>();
    const nodes: WeldedNode[] = [];

    for (const quad of quads) {
      for (let index = 0; index < quad.vertices.length; index++) {
        const key = `${quad.name}:${index}`;
        if (visited.has(key)) continue;
        const connected = scene
          ? QuadObject.getConnectedVertices(scene, quad, index)
          : [{ quad, index, v: quad.vertices[index] }];
        const refs = connected.filter((ref) => selectedKeys.has(ref.quad.name)) as VertexRef[];
        if (refs.length === 0) return null;
        refs.forEach((ref) => visited.add(`${ref.quad.name}:${ref.index}`));

        const first = refs[0];
        const firstVertex = fromSnapshot
          ? this.getSnapshotVertex(first.quad, first.index)
          : first.v;
        const globalP = first.quad.parallax ?? 1;
        if (!firstVertex || !Number.isFinite(globalP) || globalP <= 0) return null;
        const effectiveP = firstVertex.p * globalP;
        if (
          !Number.isFinite(firstVertex.x) ||
          !Number.isFinite(firstVertex.y) ||
          !Number.isFinite(effectiveP) ||
          effectiveP <= 0
        ) {
          return null;
        }

        for (const ref of refs.slice(1)) {
          const vertex = fromSnapshot ? this.getSnapshotVertex(ref.quad, ref.index) : ref.v;
          const refGlobalP = ref.quad.parallax ?? 1;
          if (!vertex || !Number.isFinite(refGlobalP) || refGlobalP <= 0) return null;
          if (
            Math.abs(vertex.x - firstVertex.x) > ASSEMBLY_EPSILON ||
            Math.abs(vertex.y - firstVertex.y) > ASSEMBLY_EPSILON ||
            Math.abs(vertex.p * refGlobalP - effectiveP) > ASSEMBLY_EPSILON
          ) {
            return null;
          }
        }
        nodes.push({ refs, x: firstVertex.x, y: firstVertex.y, p: effectiveP });
      }
    }
    return nodes;
  }

  private stageEffectiveVertexUpdates(
    updates: Array<{ quad: QuadObject; index: number; x: number; y: number; p: number }>
  ): Map<QuadObject, QuadVertex[]> | null {
    const scene = this.editor.game.sceneManager.currentScene;
    const staged = new Map<QuadObject, QuadVertex[]>();
    const resolved = new Map<string, { x: number; y: number; p: number }>();
    const getVertices = (quad: QuadObject) => {
      let vertices = staged.get(quad);
      if (!vertices) {
        vertices = this.cloneQuadVertices(quad.vertices);
        staged.set(quad, vertices);
      }
      return vertices;
    };

    for (const update of updates) {
      if (
        !Number.isFinite(update.x) ||
        !Number.isFinite(update.y) ||
        !Number.isFinite(update.p) ||
        update.p <= 0
      ) {
        return null;
      }
      const refs = scene
        ? QuadObject.getConnectedVertices(scene, update.quad, update.index)
        : [{ quad: update.quad, index: update.index, v: update.quad.vertices[update.index] }];
      for (const ref of refs) {
        const key = `${ref.quad.name}:${ref.index}`;
        const previous = resolved.get(key);
        if (
          previous &&
          (Math.abs(previous.x - update.x) > ASSEMBLY_EPSILON ||
            Math.abs(previous.y - update.y) > ASSEMBLY_EPSILON ||
            Math.abs(previous.p - update.p) > ASSEMBLY_EPSILON)
        ) {
          return null;
        }
        resolved.set(key, update);
      }
    }

    for (const [key, value] of resolved) {
      const [name, rawIndex] = key.split(':');
      const quad = (scene?.entities || []).find(
        (object: any): object is QuadObject => object instanceof QuadObject && object.name === name
      );
      const index = Number(rawIndex);
      const globalP = quad?.parallax ?? 1;
      if (!quad || !Number.isInteger(index) || !Number.isFinite(globalP) || globalP <= 0)
        return null;
      const vertices = getVertices(quad);
      vertices[index] = { ...vertices[index], x: value.x, y: value.y, p: value.p / globalP };
    }
    return staged;
  }

  private commitStagedVertices(staged: Map<QuadObject, QuadVertex[]>): void {
    staged.forEach((vertices, quad) => {
      quad.vertices = vertices;
      quad.x = Math.round(vertices.reduce((sum, vertex) => sum + vertex.x, 0) / vertices.length);
      quad.y = Math.round(vertices.reduce((sum, vertex) => sum + vertex.y, 0) / vertices.length);
    });
  }

  private nodeForVertex(
    nodes: WeldedNode[],
    nodeByRef: Map<string, number>,
    quad: QuadObject,
    index: number
  ): WeldedNode | null {
    const nodeIndex = nodeByRef.get(`${quad.name}:${index}`);
    return nodeIndex === undefined ? null : nodes[nodeIndex] || null;
  }

  private buildPrismPreparation():
    | {
        updates: Array<{ quad: QuadObject; index: number; x: number; y: number; p: number }>;
        quads: QuadObject[];
      }
    | { error: string } {
    const quads = this.getSelectedQuads();
    if (quads.length < 3 || quads.some((quad) => quad.vertices.length !== 4)) {
      return { error: 'Prepare 3D needs at least three four-vertex Quad faces' };
    }
    if (quads.some((quad) => quad.vertices.some((vertex) => vertex.binding?.type === 'grid'))) {
      return { error: 'Prepare 3D does not support grid-bound vertices' };
    }

    const nodes = this.collectWeldedNodes(quads, false);
    if (!nodes || nodes.length !== 8)
      return { error: 'Box/Prism needs exactly eight bound physical corners' };
    const nodeByRef = new Map<string, number>();
    nodes.forEach((node, nodeIndex) =>
      node.refs.forEach((ref) => nodeByRef.set(`${ref.quad.name}:${ref.index}`, nodeIndex))
    );

    const levels: number[] = [];
    for (const node of nodes) {
      const level = levels.find((candidate) => Math.abs(candidate - node.p) <= ASSEMBLY_EPSILON);
      if (level === undefined) levels.push(node.p);
    }
    if (levels.length !== 2)
      return { error: 'Box/Prism needs exactly two effective P depth layers' };
    levels.sort((left, right) => right - left);
    const [nearP, farP] = levels;
    const nearNodes = nodes.filter((node) => Math.abs(node.p - nearP) <= ASSEMBLY_EPSILON);
    const farNodes = nodes.filter((node) => Math.abs(node.p - farP) <= ASSEMBLY_EPSILON);
    if (nearNodes.length !== 4 || farNodes.length !== 4) {
      return { error: 'Each depth layer must contain four physical corners' };
    }

    const frontQuads = quads.filter((quad) =>
      quad.vertices.every(
        (_, index) =>
          Math.abs(this.nodeForVertex(nodes, nodeByRef, quad, index)!.p - nearP) <= ASSEMBLY_EPSILON
      )
    );
    if (frontQuads.length !== 1)
      return { error: 'Select one unambiguous front Quad at the nearest P layer' };
    const frontQuad = frontQuads[0];
    const frontNodeOrder = frontQuad.vertices.map(
      (_, index) => nodeByRef.get(`${frontQuad.name}:${index}`)!
    );
    const frontNodeSet = new Set(frontNodeOrder);
    const correspondence = new Map<number, number>();
    const assign = (nearNode: number, farNode: number) => {
      const existing = correspondence.get(nearNode);
      if (existing !== undefined && existing !== farNode) return false;
      correspondence.set(nearNode, farNode);
      return true;
    };

    for (const quad of quads.filter((candidate) => candidate !== frontQuad)) {
      const ids = quad.vertices.map((_, index) => nodeByRef.get(`${quad.name}:${index}`)!);
      const nearIndexes = ids
        .map((id, index) => (frontNodeSet.has(id) ? index : -1))
        .filter((index) => index >= 0);
      if (nearIndexes.length === 0) {
        if (!ids.every((id) => !frontNodeSet.has(id)))
          return { error: 'Invalid rear face topology' };
        continue;
      }
      if (nearIndexes.length !== 2)
        return { error: 'Each side face must connect one front edge to one far edge' };
      const start = nearIndexes.find((index) => frontNodeSet.has(ids[(index + 1) % 4]));
      if (start === undefined) return { error: 'Side face front vertices must be adjacent' };
      const nearA = ids[start];
      const nearB = ids[(start + 1) % 4];
      const farB = ids[(start + 2) % 4];
      const farA = ids[(start + 3) % 4];
      if (
        frontNodeSet.has(farA) ||
        frontNodeSet.has(farB) ||
        !assign(nearA, farA) ||
        !assign(nearB, farB)
      ) {
        return { error: 'Side faces do not define one-to-one front-to-back corners' };
      }
    }
    if (correspondence.size !== 4 || new Set(correspondence.values()).size !== 4) {
      return { error: 'Side faces must map all four front corners to the far layer' };
    }

    const updates: Array<{ quad: QuadObject; index: number; x: number; y: number; p: number }> = [];
    for (const [nearNodeIndex, farNodeIndex] of correspondence) {
      const nearNode = nodes[nearNodeIndex];
      const farNode = nodes[farNodeIndex];
      const point3d = unprojectParallaxPoint(nearNode);
      if (!point3d) return { error: 'Invalid front-face P' };
      const projected = projectParallaxPoint({
        ...point3d,
        z: getParallaxFocalLength() / farNode.p,
      });
      if (!projected) return { error: 'Invalid far-face P' };
      const ref = farNode.refs[0];
      updates.push({ quad: ref.quad, index: ref.index, ...projected });
    }
    return { updates, quads };
  }

  beginPrepare3D(): { ok: boolean; message?: string } {
    if (this._preparedPreview)
      return { ok: false, message: 'Preparation preview is already active' };
    const state = this.get3DAssemblyState();
    if (!state.canPrepare) {
      return {
        ok: false,
        message: ('message' in state && state.message) || 'Select an unprepared Box/Prism',
      };
    }
    const prepared = this.buildPrismPreparation();
    if ('error' in prepared) return { ok: false, message: prepared.error };
    const staged = this.stageEffectiveVertexUpdates(prepared.updates);
    if (!staged)
      return { ok: false, message: 'Bound vertices disagree and cannot be prepared safely' };

    const originals = new Map<QuadObject, { vertices: QuadVertex[]; x: number; y: number }>();
    staged.forEach((_, quad) =>
      originals.set(quad, { vertices: this.cloneQuadVertices(quad.vertices), x: quad.x, y: quad.y })
    );
    this.editor.saveUndoState();
    this.commitStagedVertices(staged);
    this._preparedPreview = {
      assemblyId: `q3d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      quads: prepared.quads,
      originals,
    };
    this.editor.updateUIFromObject();
    this.editor.refreshHierarchy();
    return { ok: true };
  }

  applyPrepare3D(): boolean {
    const preview = this._preparedPreview;
    if (!preview) return false;
    preview.quads.forEach((quad) => (quad.quad3dAssemblyId = preview.assemblyId));
    this._preparedPreview = null;
    this.rebuildGroupTransformSnapshot();
    this.editor.updateUIFromObject();
    this.editor.refreshHierarchy();
    return true;
  }

  cancelPrepare3D(): boolean {
    const preview = this._preparedPreview;
    if (!preview) return false;
    preview.originals.forEach((original, quad) => {
      quad.vertices = this.cloneQuadVertices(original.vertices);
      quad.x = original.x;
      quad.y = original.y;
    });
    this._preparedPreview = null;
    return true;
  }

  detachPreparedAssembly(): boolean {
    const state = this.get3DAssemblyState();
    if (state.kind !== 'prepared') return false;
    this.getAssemblyQuads(state.assemblyId).forEach((quad) => delete quad.quad3dAssemblyId);
    this.rebuildGroupTransformSnapshot();
    this.editor.updateUIFromObject();
    this.editor.refreshHierarchy();
    return true;
  }

  hasPreparedAssemblyInSelection(): boolean {
    const state = this.get3DAssemblyState();
    return (
      state.kind === 'prepared' ||
      state.kind === 'partial' ||
      state.kind === 'mixed' ||
      state.kind === 'preview'
    );
  }

  is3DAssemblyLocked(quad: QuadObject): boolean {
    const scene = this.editor.game.sceneManager.currentScene;
    return quad.vertices.some((_, index) =>
      (scene ? QuadObject.getConnectedVertices(scene, quad, index) : [{ quad }]).some(
        (ref) => !!ref.quad.quad3dAssemblyId
      )
    );
  }

  rebuildGroupTransformSnapshot(): void {
    if (!this.hasMultiSelection()) return;

    this._groupSnapshot.clear();
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    let parallaxSum = 0;
    let parallaxCount = 0;

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
        const globalP = quad.parallax ?? 1;
        vertices.forEach((vertex: any) => {
          const effectiveP = (vertex.p ?? 1) * globalP;
          if (Number.isFinite(effectiveP) && effectiveP > 0) {
            parallaxSum += effectiveP;
            parallaxCount++;
          }
        });
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
    this._groupTransform.rotateY = 0;
    this._groupTransform.axisX = this._groupTransform.originX;
    this._groupTransform.axisP = parallaxCount > 0 ? parallaxSum / parallaxCount : 1;

    const assembly = this.get3DAssemblyState();
    if (assembly.kind === 'prepared') {
      const nodes = this.collectWeldedNodes(this.getSelectedQuads(), true);
      if (nodes && nodes.length > 0) {
        const points = nodes
          .map((node) => unprojectParallaxPoint(node))
          .filter((point): point is { x: number; y: number; z: number } => point !== null);
        if (points.length === nodes.length) {
          const center = points.reduce<{ x: number; y: number; z: number }>(
            (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y, z: sum.z + point.z }),
            { x: 0, y: 0, z: 0 }
          );
          center.x /= points.length;
          center.y /= points.length;
          center.z /= points.length;
          const axisP = getParallaxFocalLength() / center.z;
          if (Number.isFinite(axisP) && axisP > 0) {
            this._groupTransform.axisP = axisP;
            this._groupTransform.axisX = center.x * axisP;
          }
        }
      }
    }
  }

  applyGroupRotation(rotateY: number, axisX: number, axisP: number): boolean {
    if (
      !Number.isFinite(rotateY) ||
      !Number.isFinite(axisX) ||
      !Number.isFinite(axisP) ||
      axisP <= 0
    ) {
      return false;
    }
    const assembly = this.get3DAssemblyState();
    if (assembly.kind !== 'prepared') return false;
    const previous = {
      rotateY: this._groupTransform.rotateY,
      axisX: this._groupTransform.axisX,
      axisP: this._groupTransform.axisP,
    };
    const nodes = this.collectWeldedNodes(this.getSelectedQuads(), true);
    if (!nodes || nodes.length === 0) return false;
    const updates: Array<{ quad: QuadObject; index: number; x: number; y: number; p: number }> = [];
    for (const node of nodes) {
      const transformed = rotateParallaxPointY(node, { x: axisX, p: axisP }, rotateY);
      if (!transformed) return false;
      const ref = node.refs[0];
      updates.push({ quad: ref.quad, index: ref.index, ...transformed });
    }
    const staged = this.stageEffectiveVertexUpdates(updates);
    if (!staged) {
      Object.assign(this._groupTransform, previous);
      return false;
    }
    this.commitStagedVertices(staged);
    this._groupTransform.rotateY = rotateY;
    this._groupTransform.axisX = axisX;
    this._groupTransform.axisP = axisP;
    this.editor.updateUIFromObject();
    this.editor.refreshHierarchy();
    return true;
  }

  applyGroupTransform(offsetX: number, offsetY: number, scale: number): boolean {
    if (!this.hasMultiSelection()) return false;
    if (this.hasPreparedAssemblyInSelection()) return false;
    if (this._groupSnapshot.size === 0) this.rebuildGroupTransformSnapshot();

    const sx = Number.isFinite(scale) ? Math.max(0.01, scale) : 1;
    const { originX, originY } = this._groupTransform;
    const scene = this.editor.game.sceneManager.currentScene;
    const stagedVertices = new Map<QuadObject, any[]>();
    const connectedResults = new Map<
      string,
      { quad: QuadObject; index: number; x: number; y: number; p: number }
    >();

    const getVertices = (quad: QuadObject) => {
      let vertices = stagedVertices.get(quad);
      if (!vertices) {
        vertices = quad.vertices.map((vertex) => ({
          ...vertex,
          ...(vertex.binding ? { binding: JSON.parse(JSON.stringify(vertex.binding)) } : {}),
        }));
        stagedVertices.set(quad, vertices);
      }
      return vertices;
    };

    for (const snap of this._groupSnapshot.values()) {
      if (snap.kind !== 'quad') continue;
      const quad = snap.obj as QuadObject;
      const globalP = quad.parallax ?? 1;
      if (!Number.isFinite(globalP) || globalP === 0) return false;
      const vertices = (snap.vertices || []).map((vertex: any) => ({
        x: originX + (vertex.x - originX) * sx + offsetX,
        y: originY + (vertex.y - originY) * sx + offsetY,
        p: vertex.p ?? 1,
        ...(vertex.binding ? { binding: JSON.parse(JSON.stringify(vertex.binding)) } : {}),
      }));
      stagedVertices.set(quad, vertices);

      for (let index = 0; index < vertices.length; index++) {
        const vertex = vertices[index];
        const effectiveP = vertex.p * globalP;
        const transformed = rotateParallaxPointY(
          { x: vertex.x, y: vertex.y, p: effectiveP },
          { x: this._groupTransform.axisX, p: this._groupTransform.axisP },
          this._groupTransform.rotateY
        );
        if (!transformed) return false;
        const refs = scene
          ? QuadObject.getConnectedVertices(scene, quad, index)
          : [{ quad, index, v: quad.vertices[index] }];
        for (const ref of refs) {
          const key = `${ref.quad.name}:${ref.index}`;
          const existing = connectedResults.get(key);
          if (
            existing &&
            (Math.abs(existing.x - transformed.x) > 0.0001 ||
              Math.abs(existing.y - transformed.y) > 0.0001 ||
              Math.abs(existing.p - transformed.p) > 0.0001)
          ) {
            return false;
          }
          connectedResults.set(key, { quad: ref.quad, index: ref.index, ...transformed });
        }
      }
    }

    for (const result of connectedResults.values()) {
      const globalP = result.quad.parallax ?? 1;
      if (!Number.isFinite(globalP) || globalP === 0) return false;
      const vertices = getVertices(result.quad);
      const prior = vertices[result.index] || {};
      vertices[result.index] = { ...prior, x: result.x, y: result.y, p: result.p / globalP };
    }

    this._groupSnapshot.forEach((snap) => {
      if (snap.kind === 'quad') {
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

    stagedVertices.forEach((vertices, quad) => {
      quad.vertices = vertices;
      const cx = vertices.reduce((sum, vertex) => sum + vertex.x, 0) / vertices.length;
      const cy = vertices.reduce((sum, vertex) => sum + vertex.y, 0) / vertices.length;
      quad.x = Math.round(cx);
      quad.y = Math.round(cy);
    });

    this._groupTransform.offsetX = offsetX;
    this._groupTransform.offsetY = offsetY;
    this._groupTransform.scale = sx;
    this.editor.updateUIFromObject();
    this.editor.refreshHierarchy();
    return true;
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

    const scene = this.editor.game.sceneManager.currentScene;
    if (!scene) return selected;
    const allObjects: SceneObject[] = [
      ...scene.folders,
      ...scene.entities,
      ...scene.walkbox,
      ...scene.triggerboxes,
    ];
    const result = new Set<SceneObject>();
    const visit = (obj: SceneObject) => {
      if (result.has(obj)) return;
      result.add(obj);
      const name = obj.name;
      const folderId = obj.type === 'Folder' ? (obj as any).folderId : null;
      allObjects.forEach((candidate: any) => {
        if (candidate.spatial?.parentNodeId === name || (folderId && candidate.folder === folderId))
          visit(candidate);
      });
    };
    selected.forEach(visit);
    return allObjects.filter((obj) => result.has(obj));
  }

  private getSerializationRoots(items: SceneObject[]): SceneObject[] {
    const included = new Set(items);
    const byName = new Map(items.map((item) => [item.name, item]));
    const byFolderId = new Map(
      items.filter((item) => item.type === 'Folder').map((item) => [(item as any).folderId, item])
    );
    return items.filter((item: any) => {
      let parent = byName.get(item.spatial?.parentNodeId) || byFolderId.get(item.folder);
      const visited = new Set<SceneObject>();
      while (parent && !visited.has(parent)) {
        if (included.has(parent)) return false;
        visited.add(parent);
        parent =
          byName.get((parent as any).spatial?.parentNodeId) ||
          byFolderId.get((parent as any).folder);
      }
      return true;
    });
  }

  private getSerializedObjectKey(data: any): string {
    const type = data?.type || 'Entity';
    const name = data?.name || 'Object';
    return `${type}:${name}`;
  }

  buildSelectionPayload(source: PayloadSource): SerializedSelectionPayload | null {
    const directSelection = this.hasMultiSelection()
      ? this.getSelectedObjects()
      : this.editor.selectedObject instanceof SceneObject
        ? [this.editor.selectedObject]
        : [];
    if (
      directSelection.some(
        (obj: any) =>
          Number.isInteger(obj.box3dFaceIndex) &&
          !directSelection.some(
            (parent) => parent instanceof Box3DObject && parent.name === obj.spatial?.parentNodeId
          )
      )
    ) {
      this.editor.game.showNotification('Copy the Box3D parent to include managed faces');
      return null;
    }
    const selected = this.getCurrentSelectionForSerialization();
    if (selected.length === 0) return null;

    const items = selected.map((obj) => obj.toJSON());
    const order = items.map((item) => this.getSerializedObjectKey(item));
    const rootKeys = this.getSerializationRoots(selected).map((obj) =>
      this.getSerializedObjectKey(obj.toJSON())
    );

    return {
      kind: items.length > 1 ? 'group' : 'single',
      version: 3,
      items,
      order,
      rootKeys,
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
        rootKeys: [key],
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
    const rootKeys: string[] =
      Array.isArray(raw.rootKeys) && raw.rootKeys.length
        ? raw.rootKeys
        : kind === 'single'
          ? [anchorKey].filter(Boolean)
          : order;

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
      rootKeys,
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
        if (
          [
            'targetName',
            'shadowQuadId',
            'parentNodeId',
            'targetEntryId',
            'entityId',
            'objectId',
            'quadId',
          ].includes(key)
        ) {
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
    const rootKeys = new Set(payload.rootKeys);
    const boxesWithSerializedFaces = new Set<string>();
    orderedItems.forEach((item) => {
      if (
        item?.type === 'Quad' &&
        Number.isInteger(item.box3dFaceIndex) &&
        item.spatial?.parentNodeId
      )
        boxesWithSerializedFaces.add(item.spatial.parentNodeId);
    });
    const copiedAssemblyIds = new Map<string, string | null>();
    const payloadAssemblyMembers = new Map<string, Set<string>>();
    orderedItems.forEach((item) => {
      if (item?.type !== 'Quad' || !item.quad3dAssemblyId || !item.name) return;
      const members = payloadAssemblyMembers.get(item.quad3dAssemblyId) || new Set<string>();
      members.add(item.name);
      payloadAssemblyMembers.set(item.quad3dAssemblyId, members);
    });
    payloadAssemblyMembers.forEach((payloadMembers, assemblyId) => {
      const sceneMembers = this.getAssemblyQuads(assemblyId);
      const isComplete =
        sceneMembers.length === 0 ||
        (sceneMembers.length === payloadMembers.size &&
          sceneMembers.every((quad) => payloadMembers.has(quad.name)));
      copiedAssemblyIds.set(
        assemblyId,
        isComplete
          ? `q3d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
          : null
      );
    });
    orderedItems.forEach((item) => {
      if (item?.type !== 'Quad' || !item.quad3dAssemblyId) return;
      const replacement = copiedAssemblyIds.get(item.quad3dAssemblyId);
      if (replacement) item.quad3dAssemblyId = replacement;
      else delete item.quad3dAssemblyId;
    });
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
    orderedItems.forEach((item) => {
      if (
        item?.type !== 'Quad' ||
        !Number.isInteger(item.box3dFaceIndex) ||
        !item.spatial?.parentNodeId
      )
        return;
      const parentName = nameMap.get(item.spatial.parentNodeId);
      if (parentName) nameMap.set(item.name, `${parentName}_face_${item.box3dFaceIndex}`);
    });

    const folderIdMap = new Map<string, string>();
    orderedItems.forEach((item) => {
      if (item?.type === 'Folder' && item.folderId) {
        const newId = `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        folderIdMap.set(item.folderId, newId);
      }
    });

    const created: SceneObject[] = [];
    this.lastInstantiatedRoots = [];
    const preserveQuadBindings = payload.items.length > 1;
    orderedItems.forEach((item, index) => {
      const originalName =
        typeof payload.items[index]?.name === 'string' ? payload.items[index].name : item.name;
      const sourcePoint = this.getReferencePointFromSerializedData(item);
      const originalKey = this.getSerializedObjectKey(payload.items[index]);
      const overrideX = insertionPoint.x + (sourcePoint.x - anchorSourcePoint.x);
      const overrideY = insertionPoint.y + (sourcePoint.y - anchorSourcePoint.y);

      this.remapReferencesForPastedObject(item, nameMap, folderIdMap);
      if (item.name && nameMap.has(item.name)) {
        item.name = nameMap.get(item.name);
      }

      const newObj = this.editor.createObjectFromData(item, overrideX, overrideY, {
        preserveBindings: preserveQuadBindings && item?.type === 'Quad',
        skipBoxFaces: item?.type === 'Box3D' && boxesWithSerializedFaces.has(originalName),
      });
      if (newObj) {
        created.push(newObj);
        if (rootKeys.has(originalKey)) this.lastInstantiatedRoots.push(newObj);
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

    const roots = this.lastInstantiatedRoots.length ? this.lastInstantiatedRoots : created;
    if (roots.length > 1) this.setMultiSelection(roots);
    else if (roots.length === 1) this.selectObject(roots[0]);

    return created;
  }

  private lastInstantiatedRoots: SceneObject[] = [];

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
