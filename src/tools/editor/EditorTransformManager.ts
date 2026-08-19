import { SceneEditor } from '../SceneEditor';
import { Entity } from '../../entities/Entity';
import { Actor } from '../../entities/Actor';
import { QuadObject, type QuadVertexBinding } from '../../entities/QuadObject';
import { Walkbox } from '../../entities/Walkbox';
import { Triggerbox } from '../../entities/Triggerbox';
import { Folder } from '../../entities/Folder';
import { SceneObject } from '../../entities/SceneObject';

import { Geometry } from '../../utils/Geometry';
import { EditorSnappingSystem } from './EditorSnappingSystem';
import { DefaultActorData, DefaultEntityData, DefaultQuadData } from '../../entities/EntityPrefabs';
import { useEditorStore } from '../../store/editorStore';

function clearReciprocalVertexBinding(scene: any, quad: QuadObject, index: number): void {
  const binding = quad.vertices[index]?.binding;
  if (!binding || binding.type !== 'vertex') return;

  const target = scene.entities.find((entity: any) => entity.name === binding.targetName);
  const targetVertex = target?.type === 'Quad' ? target.vertices[binding.index ?? 0] : undefined;
  if (
    targetVertex?.binding?.type === 'vertex' &&
    targetVertex.binding.targetName === quad.name &&
    targetVertex.binding.index === index
  ) {
    delete targetVertex.binding;
  }
}

function applyVertexBinding(
  scene: any,
  source: QuadObject,
  sourceIndex: number,
  binding: QuadVertexBinding
): void {
  const group = QuadObject.getConnectedVertices(scene, source, sourceIndex);
  group.forEach((ref) => clearReciprocalVertexBinding(scene, ref.quad, ref.index));
  group.forEach((ref) => {
    ref.v.binding = { ...binding };
  });
}

export class EditorTransformManager {
  private editor: SceneEditor;

  // State
  isDragging: boolean = false;
  dragOffset: { x: number; y: number } = { x: 0, y: 0 };
  isPanning: boolean = false;
  lastPanPos: { x: number; y: number } = { x: 0, y: 0 };
  lastMousePos: { x: number; y: number } = { x: 0, y: 0 };

  creationType: 'Walkbox' | 'Triggerbox' = 'Walkbox';
  draggingVertexIndex: number = -1;
  resizingHandle: string | null = null;
  drawMode: boolean = false;
  currentPolygon: { x: number; y: number }[] = [];
  currentSnapBinding: QuadVertexBinding | null = null;
  dragStartPos: { x: number; y: number } | null = null;
  resizeAnchor: { x: number; y: number } | null = null; // Stores the stationary corner (Raw Coords) during resize
  private boxSelectActive: boolean = false;
  private boxSelectStart: { x: number; y: number } | null = null;
  private boxSelectCurrent: { x: number; y: number } | null = null;

  constructor(editor: SceneEditor) {
    this.editor = editor;
  }

  // Helper: Screen -> World
  getMousePos(e: MouseEvent): { x: number; y: number } {
    const rect = this.editor.game.canvas.getBoundingClientRect();
    const scaleX = this.editor.game.canvas.width / rect.width;
    const scaleY = this.editor.game.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  getSnappedPos(
    current: { x: number; y: number },
    anchor: { x: number; y: number }
  ): { x: number; y: number } {
    const dx = current.x - anchor.x;
    const dy = current.y - anchor.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist === 0) return anchor;

    const angle = Math.atan2(dy, dx);
    const snapAngle = Math.PI / 8; // 22.5 degrees
    const snappedAngle = Math.round(angle / snapAngle) * snapAngle;

    return {
      x: Math.round(anchor.x + Math.cos(snappedAngle) * dist),
      y: Math.round(anchor.y + Math.sin(snappedAngle) * dist),
    };
  }

  isBoxSelecting(): boolean {
    return this.boxSelectActive;
  }

  getSelectionBox(): { start: { x: number; y: number }; current: { x: number; y: number } } | null {
    if (!this.boxSelectActive || !this.boxSelectStart || !this.boxSelectCurrent) return null;
    return { start: this.boxSelectStart, current: this.boxSelectCurrent };
  }

  private rectIntersects(
    a: { l: number; t: number; r: number; b: number },
    b: { l: number; t: number; r: number; b: number }
  ): boolean {
    return !(a.r < b.l || a.l > b.r || a.b < b.t || a.t > b.b);
  }

  private findHitSelectable(
    pos: { x: number; y: number },
    scene: any,
    camX: number,
    camY: number,
    zoom: number,
    halfW: number,
    halfH: number
  ): SceneObject | null {
    const entities = scene.entities || [];
    for (let i = entities.length - 1; i >= 0; i--) {
      const entity = entities[i];
      if (entity.disabled || entity.locked) continue;

      const vOx = (entity as any).visualOffset ? (entity as any).visualOffset.x : 0;
      const vOy = (entity as any).visualOffset ? (entity as any).visualOffset.y : 0;
      const worldX = (pos.x - halfW) / zoom + camX - vOx;
      const worldY = (pos.y - halfH) / zoom + camY - vOy;

      if (entity.hitTest(worldX, worldY)) return entity;
    }

    if (scene.walkbox) {
      for (const wb of scene.walkbox) {
        if (wb.disabled || wb.locked) continue;
        const p = (wb as any).parallax !== undefined ? (wb as any).parallax : 1.0;
        const worldPos = {
          x: (pos.x - halfW) / zoom + camX * p,
          y: (pos.y - halfH) / zoom + camY * p,
        };
        if (Geometry.isPointInPolygon(worldPos, wb.poly)) return wb;
      }
    }

    if (scene.triggerboxes) {
      for (const tb of scene.triggerboxes) {
        if (tb.disabled || tb.locked) continue;
        const p = (tb as any).parallax !== undefined ? (tb as any).parallax : 1.0;
        const worldPos = {
          x: (pos.x - halfW) / zoom + camX * p,
          y: (pos.y - halfH) / zoom + camY * p,
        };
        if (Geometry.isPointInPolygon(worldPos, tb.poly)) return tb;
      }
    }

    return null;
  }

  private collectObjectsInScreenRect(
    scene: any,
    rect: { l: number; t: number; r: number; b: number },
    camX: number,
    camY: number,
    zoom: number,
    halfW: number,
    halfH: number
  ): SceneObject[] {
    const selected: SceneObject[] = [];
    const toScreen = (wx: number, wy: number, parallax: number = 1.0) => ({
      x: (wx - camX * parallax) * zoom + halfW,
      y: (wy - camY * parallax) * zoom + halfH,
    });

    (scene.entities || []).forEach((entity: any) => {
      if (entity.disabled || entity.locked) return;

      if ((entity as any).type === 'Quad' && entity.vertices) {
        const globalP = entity.parallax !== undefined ? entity.parallax : 1.0;
        const pts = entity.vertices.map((v: any) => {
          const effP = (v.p !== undefined ? v.p : 1.0) * globalP;
          return {
            x: (v.x - camX * effP) * zoom + halfW,
            y: (v.y - camY * effP) * zoom + halfH,
          };
        });
        const minX = Math.min(...pts.map((p: any) => p.x));
        const maxX = Math.max(...pts.map((p: any) => p.x));
        const minY = Math.min(...pts.map((p: any) => p.y));
        const maxY = Math.max(...pts.map((p: any) => p.y));
        if (this.rectIntersects(rect, { l: minX, t: minY, r: maxX, b: maxY }))
          selected.push(entity);
        return;
      }

      const p = entity.parallax !== undefined ? entity.parallax : 1.0;
      const vOx = (entity as any).visualOffset ? (entity as any).visualOffset.x : 0;
      const vOy = (entity as any).visualOffset ? (entity as any).visualOffset.y : 0;
      const cx = (entity.x - camX * p + vOx) * zoom + halfW;
      const cy = (entity.y - camY * p + vOy) * zoom + halfH;
      const halfEW = (entity.width * zoom) / 2;
      const eh = entity.height * zoom;
      const entityRect = { l: cx - halfEW, t: cy - eh, r: cx + halfEW, b: cy };
      if (this.rectIntersects(rect, entityRect)) selected.push(entity);
    });

    (scene.walkbox || []).forEach((wb: any) => {
      if (wb.disabled || wb.locked || !wb.poly?.length) return;
      const p = wb.parallax !== undefined ? wb.parallax : 1.0;
      const screenPoly = wb.poly.map((pt: any) => toScreen(pt.x, pt.y, p));
      const minX = Math.min(...screenPoly.map((p: any) => p.x));
      const maxX = Math.max(...screenPoly.map((p: any) => p.x));
      const minY = Math.min(...screenPoly.map((p: any) => p.y));
      const maxY = Math.max(...screenPoly.map((p: any) => p.y));
      if (this.rectIntersects(rect, { l: minX, t: minY, r: maxX, b: maxY })) selected.push(wb);
    });

    (scene.triggerboxes || []).forEach((tb: any) => {
      if (tb.disabled || tb.locked || !tb.poly?.length) return;
      const p = tb.parallax !== undefined ? tb.parallax : 1.0;
      const screenPoly = tb.poly.map((pt: any) => toScreen(pt.x, pt.y, p));
      const minX = Math.min(...screenPoly.map((p: any) => p.x));
      const maxX = Math.max(...screenPoly.map((p: any) => p.x));
      const minY = Math.min(...screenPoly.map((p: any) => p.y));
      const maxY = Math.max(...screenPoly.map((p: any) => p.y));
      if (this.rectIntersects(rect, { l: minX, t: minY, r: maxX, b: maxY })) selected.push(tb);
    });

    return selected;
  }

  // Interaction Handlers

  onMouseDown(e: MouseEvent): void {
    const editor = this.editor;
    if (!editor.enabled) return;

    // Right Click Panning
    if (e.button === 2) {
      this.isPanning = true;
      this.lastPanPos = { x: e.clientX, y: e.clientY };

      if (editor.game.sceneManager.currentScene) {
        editor.game.sceneManager.currentScene.suspendEditorCameraFollow();
      }
      e.preventDefault();
      return;
    }

    if (this.drawMode) return;

    const pos = this.getMousePos(e); // Screen Coords
    const scene = editor.game.sceneManager.currentScene;

    if (scene) {
      const camX = scene.camera ? scene.camera.x : 0;
      const camY = scene.camera ? scene.camera.y : 0;
      const zoom = scene.camera ? scene.camera.zoom : 1.0;

      const halfW = editor.game.canvas.width / 2;
      const halfH = editor.game.canvas.height / 2;
      const hitObject = this.findHitSelectable(pos, scene, camX, camY, zoom, halfW, halfH);

      if (e.button === 0 && e.ctrlKey && hitObject) {
        editor.toggleObjectSelection(hitObject);
        e.stopPropagation();
        return;
      }

      if (e.button === 0 && editor.selectionManager.hasMultiSelection()) {
        if (hitObject && editor.selectionManager.isInMultiSelection(hitObject)) {
          editor.saveUndoState();
          this.isDragging = true;
          this.draggingVertexIndex = -1;
          const worldPos = {
            x: (pos.x - halfW) / zoom + camX,
            y: (pos.y - halfH) / zoom + camY,
          };
          this.dragOffset = { x: worldPos.x, y: worldPos.y };
          editor.selectionManager.rebuildGroupTransformSnapshot();
          e.stopPropagation();
          return;
        }

        if (hitObject) {
          // Regular single selection destroys the group.
          editor.selectObject(hitObject);
        }
      }

      // 0. CHECK SELECTED POLYGON VERTICES (High Priority — must be BEFORE box-select guard)
      if (
        e.button === 0 &&
        editor.selectedObject &&
        (editor.selectedObject instanceof Walkbox ||
          editor.selectedObject instanceof Triggerbox ||
          (editor.selectedObject as any).type === 'Quad')
      ) {
        if (editor.selectedObject.disabled) return; // Prevent interaction if disabled

        let poly: any[] = [];
        const isQuad = (editor.selectedObject as any).type === 'Quad';
        const selectedParallax =
          (editor.selectedObject as any).parallax !== undefined
            ? (editor.selectedObject as any).parallax
            : 1.0;
        // Only Quads use projected vertices for Hit Test logic in original code
        if (isQuad) {
          const quad = editor.selectedObject as QuadObject;
          const globalP = selectedParallax;
          // Project Quad Vertices relative to Quad globalP layer
          poly = quad.vertices.map((v: any) => {
            const effP = (v.p !== undefined ? v.p : 1.0) * globalP;
            return {
              x: v.x - camX * (effP - globalP),
              y: v.y - camY * (effP - globalP),
            };
          });
        } else {
          poly = (editor.selectedObject as any).poly;
        }

        const vertexRadius = 6 / zoom; // Hit radius

        // Calculate Centroid...
        let cx = 0,
          cy = 0;
        if ((editor.selectedObject as any).type === 'Quad') {
          poly.forEach((p: any) => {
            cx += p.x;
            cy += p.y;
          });
          cx /= poly.length;
          cy /= poly.length;
        }

        // Check vertices
        const worldPos = {
          x: (pos.x - halfW) / zoom + camX * selectedParallax,
          y: (pos.y - halfH) / zoom + camY * selectedParallax,
        };

        for (let i = 0; i < poly.length; i++) {
          let vx = poly[i].x;
          let vy = poly[i].y;

          // Apply Quad Shift
          if ((editor.selectedObject as any).type === 'Quad') {
            const dx = cx - vx;
            const dy = cy - vy;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 0) {
              const shiftDist = vertexRadius / 2 + 2 / zoom;
              vx += (dx / len) * shiftDist;
              vy += (dy / len) * shiftDist;
            }
          }

          if (
            Math.abs(worldPos.x - vx) < vertexRadius &&
            Math.abs(worldPos.y - vy) < vertexRadius
          ) {
            if (!editor.selectedObject.locked) {
              editor.saveUndoState();
              editor.saveUndoState();
              this.isDragging = true;
              this.draggingVertexIndex = i;
              this.dragOffset = { x: worldPos.x, y: worldPos.y }; // Used for delta calc if needed
              this.dragStartPos = { x: worldPos.x, y: worldPos.y }; // Store initial pos for angle snap
              useEditorStore.getState().selectVertex(i); // Sync UI
              e.stopPropagation();
              return;
            }
          }
        }

        // Check Polygon Body
        if (Geometry.isPointInPolygon(worldPos, poly)) {
          if (!editor.selectedObject.locked) {
            editor.saveUndoState();
            this.isDragging = true;
            this.draggingVertexIndex = -1; // Drag Whole Body

            // For QuadObject, DragOffset should be relative to P=1 World Pos
            this.dragOffset = { x: worldPos.x, y: worldPos.y };
            useEditorStore.getState().selectVertex(-1);
            e.stopPropagation();
            return;
          }
        }
      }

      if (e.button === 0 && !hitObject && !e.ctrlKey) {
        this.boxSelectActive = true;
        this.boxSelectStart = { x: pos.x, y: pos.y };
        this.boxSelectCurrent = { x: pos.x, y: pos.y };
        e.stopPropagation();
        return;
      }

      // 0.5 CHECK SELECTED ENTITY (High Priority)
      if (
        editor.selectedObject &&
        editor.selectedObject instanceof Entity &&
        (editor.selectedObject as any).type !== 'Quad'
      ) {
        if (editor.selectedObject.disabled) return;
        const entity = editor.selectedObject;

        const p = entity.parallax !== undefined ? entity.parallax : 1.0;
        // @ts-ignore
        const vOx = entity.visualOffset ? entity.visualOffset.x : 0;
        // @ts-ignore
        const vOy = entity.visualOffset ? entity.visualOffset.y : 0;

        const screenX = (entity.x - camX * p + vOx) * zoom + halfW;
        const screenY = (entity.y - camY * p + vOy) * zoom + halfH;
        const screenW = entity.width * zoom;
        const screenH = entity.height * zoom;

        const sl = screenX - screenW / 2;
        const sr = screenX + screenW / 2;
        const st = screenY - screenH;
        const sb = screenY;

        const exactHSize = 6;
        let hitHandle = null;

        // Handles
        if (pos.x >= sl && pos.x <= sl + exactHSize && pos.y >= st && pos.y <= st + exactHSize)
          hitHandle = 'nw';
        else if (pos.x >= sr - exactHSize && pos.x <= sr && pos.y >= st && pos.y <= st + exactHSize)
          hitHandle = 'ne';
        else if (pos.x >= sl && pos.x <= sl + exactHSize && pos.y >= sb - exactHSize && pos.y <= sb)
          hitHandle = 'sw';
        else if (pos.x >= sr - exactHSize && pos.x <= sr && pos.y >= sb - exactHSize && pos.y <= sb)
          hitHandle = 'se';

        const hitBody = pos.x >= sl && pos.x <= sr && pos.y >= st && pos.y <= sb;

        if (hitHandle || hitBody) {
          if (!entity.locked) {
            editor.saveUndoState();
            this.isDragging = true;
            this.draggingVertexIndex = -1;

            if (hitHandle) {
              this.resizingHandle = hitHandle;

              // Initialize Fixed Anchor to prevent Parallax Shift
              let ax = entity.x;
              let ay = entity.y;
              // Width/Height are current (including scale)
              const hw = entity.width / 2;
              if (hitHandle === 'nw') {
                ax = entity.x + hw;
                ay = entity.y;
              } // SE
              else if (hitHandle === 'ne') {
                ax = entity.x - hw;
                ay = entity.y;
              } // SW
              else if (hitHandle === 'sw') {
                ax = entity.x + hw;
                ay = entity.y - entity.height;
              } // NE
              else if (hitHandle === 'se') {
                ax = entity.x - hw;
                ay = entity.y - entity.height;
              } // NW
              this.resizeAnchor = { x: ax, y: ay };
            } else {
              this.resizingHandle = null;
              this.resizeAnchor = null;
              this.dragOffset = { x: pos.x - screenX, y: pos.y - screenY };
            }

            e.stopPropagation();
            return;
          }
        }
      }

      // 1. Check Entities
      const entities = scene.entities;
      for (let i = entities.length - 1; i >= 0; i--) {
        const entity = entities[i];
        if (entity.disabled) continue;
        if (entity.locked) continue;

        // @ts-ignore
        const vOx = (entity as any).visualOffset ? (entity as any).visualOffset.x : 0;
        // @ts-ignore
        const vOy = (entity as any).visualOffset ? (entity as any).visualOffset.y : 0;

        // Entity.hitTest expects visual world coordinates; it applies its own parallax projection.
        const worldX = (pos.x - halfW) / zoom + camX - vOx;
        const worldY = (pos.y - halfH) / zoom + camY - vOy;

        if (entity.hitTest(worldX, worldY)) {
          this.editor.selectObject(entity);
          e.stopPropagation();
          return;
        }
      }

      // 2. Check Walkboxes
      if (scene.walkbox) {
        for (const wb of scene.walkbox) {
          if (wb.disabled) continue;
          if (wb.locked) continue;
          const p = (wb as any).parallax !== undefined ? (wb as any).parallax : 1.0;
          const worldPos = {
            x: (pos.x - halfW) / zoom + camX * p,
            y: (pos.y - halfH) / zoom + camY * p,
          };
          if (Geometry.isPointInPolygon(worldPos, wb.poly)) {
            this.editor.selectObject(wb);
            e.stopPropagation();
            return;
          }
        }
      }

      // 3. Check Triggerboxes
      if (scene.triggerboxes) {
        for (const tb of scene.triggerboxes) {
          if (tb.disabled) continue;
          if (tb.locked) continue;
          const p = (tb as any).parallax !== undefined ? (tb as any).parallax : 1.0;
          const worldPos = {
            x: (pos.x - halfW) / zoom + camX * p,
            y: (pos.y - halfH) / zoom + camY * p,
          };
          if (Geometry.isPointInPolygon(worldPos, tb.poly)) {
            this.editor.selectObject(tb);
            e.stopPropagation();
            return;
          }
        }
      }
    }

    if (!e.ctrlKey) {
      this.editor.selectObject(null);
    }
  }

  onMouseMove(e: MouseEvent): void {
    const editor = this.editor;
    this.lastMousePos = this.getMousePos(e);
    // Sync Editor's lastMousePos too for Paste compatibility?
    editor.lastMousePos = this.lastMousePos;

    if (!editor.enabled) return;

    // PANNING
    if (this.isPanning && editor.game.sceneManager.currentScene) {
      const dx = e.clientX - this.lastPanPos.x;
      const dy = e.clientY - this.lastPanPos.y;
      this.lastPanPos = { x: e.clientX, y: e.clientY };

      const s = editor.game.sceneManager.currentScene;
      s.camera.x -= dx / s.camera.zoom;
      s.camera.y -= dy / s.camera.zoom;

      s.suspendEditorCameraFollow();

      // React Properties Panel Update
      if (useEditorStore.getState().selectedObjectId === 'SCENE') {
        useEditorStore.getState().incrementObjectVersion();
      }
      return;
    }

    if (this.boxSelectActive) {
      this.boxSelectCurrent = { x: this.lastMousePos.x, y: this.lastMousePos.y };
      return;
    }

    if (!this.isDragging || !editor.selectedObject) return;

    const pos = this.getMousePos(e);
    const scene = editor.game.sceneManager.currentScene;

    if (scene) {
      const camX = scene.camera ? scene.camera.x : 0;
      const camY = scene.camera ? scene.camera.y : 0;
      const zoom = scene.camera ? scene.camera.zoom : 1.0;
      const halfW = editor.game.canvas.width / 2;
      const halfH = editor.game.canvas.height / 2;
      const store = useEditorStore.getState();
      if (editor.selectionManager.hasMultiSelection()) {
        const worldPos = {
          x: (pos.x - halfW) / zoom + camX,
          y: (pos.y - halfH) / zoom + camY,
        };
        const dx = worldPos.x - this.dragOffset.x;
        const dy = worldPos.y - this.dragOffset.y;
        const current = editor.selectionManager.getGroupTransform();
        editor.selectionManager.applyGroupTransform(
          current.offsetX + dx,
          current.offsetY + dy,
          current.scale
        );
        this.dragOffset = worldPos;
        store.incrementObjectVersion();
        return;
      }

      // POLYGON DRAGGING
      if (
        editor.selectedObject instanceof Walkbox ||
        editor.selectedObject instanceof Triggerbox ||
        (editor.selectedObject as any).type === 'Quad'
      ) {
        const selectedParallax =
          (editor.selectedObject as any).parallax !== undefined
            ? (editor.selectedObject as any).parallax
            : 1.0;
        const worldPos = {
          x: (pos.x - halfW) / zoom + camX * selectedParallax,
          y: (pos.y - halfH) / zoom + camY * selectedParallax,
        };

        let poly: any;
        if ((editor.selectedObject as any).type === 'Quad') {
          poly = (editor.selectedObject as QuadObject).vertices;
        } else {
          poly = (editor.selectedObject as any).poly;
        }

        if (this.draggingVertexIndex >= 0 && this.draggingVertexIndex < poly.length) {
          // Moving a Vertex
          const v = poly[this.draggingVertexIndex];

          // Use Snapping System
          const zoom = scene.camera.zoom;
          const isQuad = (editor.selectedObject as any).type === 'Quad';
          const excludedVertexRefs = isQuad
            ? new Set(
                QuadObject.getConnectedVertices(
                  scene,
                  editor.selectedObject as QuadObject,
                  this.draggingVertexIndex
                ).map((ref) => `${ref.quad.name}:${ref.index}`)
              )
            : undefined;

          // 1. Calculate Snapped Position for the PRIMARY dragged vertex
          const snapResult = EditorSnappingSystem.snapVertex(
            worldPos,
            poly,
            this.draggingVertexIndex,
            scene,
            camX,
            camY,
            isQuad,
            editor.selectedObject as Entity,
            e.shiftKey,
            e.altKey && isQuad,
            zoom,
            excludedVertexRefs
          );

          // 2. Determine Delta for the Primary Vertex
          // We want to apply this delta to ALL connected vertices.
          // But wait, the snap result is absolute position for THIS vertex.

          const newX = snapResult.x;
          const newY = snapResult.y;
          this.currentSnapBinding = snapResult.binding;

          if (!isQuad) {
            // Walkbox / Triggerbox: vertices are plain {x, y} world coords — no parallax p.
            // Just assign snapped position directly.
            const prevX = v.x;
            const prevY = v.y;
            v.x = Math.round(newX);
            v.y = Math.round(newY);
            if (Math.abs(v.x - prevX) < 0.001 && Math.abs(v.y - prevY) < 0.001) return;
            store.incrementObjectVersion();
            return;
          }

          // ── Quad path ──────────────────────────────────────────────────────
          const quad = editor.selectedObject as QuadObject;
          const globalP = quad.parallax !== undefined ? quad.parallax : 1.0;
          const effP = (v.p !== undefined ? v.p : 1.0) * globalP;

          // Calculate effective delta from current visual position relative to Quad globalP layer
          // Note: v.x/v.y are RAW. newX/newY are VISUAL relative to Quad globalP layer.
          const currentVisX = v.x - camX * (effP - globalP);
          const currentVisY = v.y - camY * (effP - globalP);

          const diffX = newX - currentVisX;
          const diffY = newY - currentVisY;
          const nextPrimaryEffP = snapResult.p !== undefined ? snapResult.p : effP;

          // If NO interaction (diff is 0), skip
          if (
            Math.abs(diffX) < 0.001 &&
            Math.abs(diffY) < 0.001 &&
            Math.abs(nextPrimaryEffP - effP) < 0.001
          ) {
            return;
          }

          // 3. Find Connected Group (BFS)
          interface VertexRef {
            quad: QuadObject;
            index: number;
            v: any;
          }
          const group: VertexRef[] = [];
          const visited = new Set<string>();
          const queue: VertexRef[] = [];

          const startRef = {
            quad: editor.selectedObject as QuadObject,
            index: this.draggingVertexIndex,
            v: v,
          };
          queue.push(startRef);
          visited.add(`${startRef.quad.name}_${startRef.index}`);
          group.push(startRef);

          // BFS Expansion
          while (queue.length > 0) {
            const current = queue.shift()!;

            // A. Check OUTGOING binding (Who I am bound to)
            if (current.v.binding && current.v.binding.type === 'vertex') {
              const targetName = current.v.binding.targetName;
              const targetIdx = current.v.binding.index || 0;
              if (!visited.has(`${targetName}_${targetIdx}`)) {
                const tEnt = scene.entities.find((e: any) => e.name === targetName);
                if (tEnt && (tEnt as any).type === 'Quad') {
                  const tQuad = tEnt as QuadObject;
                  if (tQuad.vertices[targetIdx]) {
                    const nextRef = { quad: tQuad, index: targetIdx, v: tQuad.vertices[targetIdx] };
                    visited.add(`${targetName}_${targetIdx}`);
                    group.push(nextRef);
                    queue.push(nextRef);
                  }
                }
              }
            }

            // B. Check INCOMING bindings (Who is bound to me)
            scene.entities.forEach((e: any) => {
              if ((e as any).type === 'Quad') {
                const q = e as QuadObject;
                q.vertices.forEach((qv, qIdx) => {
                  if (qv.binding && qv.binding.type === 'vertex') {
                    if (
                      qv.binding.targetName === current.quad.name &&
                      qv.binding.index === current.index
                    ) {
                      if (!visited.has(`${q.name}_${qIdx}`)) {
                        const nextRef = { quad: q, index: qIdx, v: qv };
                        visited.add(`${q.name}_${qIdx}`);
                        group.push(nextRef);
                        queue.push(nextRef);
                      }
                    }
                  }
                });
              }
            });
          }

          // 4. Move Group
          group.forEach((ref) => {
            const refGlobalP = ref.quad.parallax !== undefined ? ref.quad.parallax : 1.0;
            const refEffP = (ref.v.p !== undefined ? ref.v.p : 1.0) * refGlobalP;
            const nextEffP = snapResult.p !== undefined ? snapResult.p : refEffP;
            const nextP = refGlobalP !== 0 ? nextEffP / refGlobalP : nextEffP;

            const refVisX = ref.v.x - camX * (refEffP - refGlobalP);
            const refVisY = ref.v.y - camY * (refEffP - refGlobalP);
            ref.v.p = nextP;
            ref.v.x = refVisX + diffX + camX * (nextEffP - refGlobalP);
            ref.v.y = refVisY + diffY + camY * (nextEffP - refGlobalP);
            ref.v.x = Math.round(ref.v.x);
            ref.v.y = Math.round(ref.v.y);
          });

          store.incrementObjectVersion();
        } else if (this.draggingVertexIndex === -1) {
          // Moving Body (Quad/Polygon)
          let dx = worldPos.x - this.dragOffset.x;
          let dy = worldPos.y - this.dragOffset.y;

          // MAGNETIC MOVE (Quad only, Alt Key)
          if ((editor.selectedObject as any).type === 'Quad' && e.altKey) {
            const q = editor.selectedObject as QuadObject;
            let bestDist = 20 / zoom;
            let bestSnapDelta: { x: number; y: number } | null = null;

            // Check all vertices for potential snap
            for (let i = 0; i < q.vertices.length; i++) {
              const v = q.vertices[i];

              // Proposed position for this vertex
              const propX = v.x + dx;
              const propY = v.y + dy;

              // 1. Calculate Visual Position of Proposed Vertex (for Snapping System)
              // Note: snapVertex expects "World Visual" (P=1) coords for the mouse/target.
              // But v.x/v.y are RAW coords (if using QuadObject).
              // Wait, QuadObject vertices are stored in RAW coordinates in data?
              // Let's check QuadObject.ts or existing code.
              // In TransformManager:
              // poly = (editor.selectedObject as QuadObject).vertices; (Reference)
              // worldPos (mouse) is calculated as: (Screen - HalfW)/Zoom + CamX
              // In 'Moving a Vertex' block:
              // v.x = Math.round(worldPos.x + camX * (v.p - 1.0));
              // This implies v.x is RAW.

              // snapVertex input `mouseWorldPos` is treated as Visual P=1.
              // So we need to convert Proposed Raw -> Proposed Visual.
              // Visual = Raw - Cam * (P-1)
              const qGlobalP = q.parallax !== undefined ? q.parallax : 1.0;
              const qEffP = (v.p !== undefined ? v.p : 1.0) * qGlobalP;
              const visualPropX = propX - camX * (qEffP - qGlobalP);
              const visualPropY = propY - camY * (qEffP - qGlobalP);

              const snapResult = EditorSnappingSystem.snapVertex(
                { x: visualPropX, y: visualPropY },
                q.vertices, // Pass vertices for reference (Angle snap ignored via shift=false)
                i,
                scene,
                camX,
                camY,
                true, // isQuad
                editor.selectedObject as Entity,
                false, // shiftKey (Disable Angle Snap for Body Move)
                true, // altKey (Enable World Snap)
                zoom
              );

              // If snapResult diff differs from visualProp
              const sdx = snapResult.x - visualPropX;
              const sdy = snapResult.y - visualPropY;
              const dist = Math.sqrt(sdx * sdx + sdy * sdy);

              // If snapped (dist > 0 implies snap usually, or we check if result != input)
              // snapVertex returns input pos if no snap found.
              if ((Math.abs(sdx) > 0.01 || Math.abs(sdy) > 0.01) && dist < bestDist) {
                // Convert Visual Snap Delta back to Raw Delta?
                // RawDelta = VisualDelta (since Cam offset allows linear translation? No.)
                // Raw1 = Vis1 + Offset. Raw2 = Vis2 + Offset.
                // Raw2 - Raw1 = Vis2 - Vis1. Yes.
                // So SnapDelta applies directly to Raw coords?
                // Yes, because Camera Offset is constant for a given frame/parallax (ignoring P changes).

                bestDist = dist;
                bestSnapDelta = { x: sdx, y: sdy };
              }
            }

            if (bestSnapDelta) {
              dx += bestSnapDelta.x;
              dy += bestSnapDelta.y;
            }
          }

          // Update DragOffset
          // FIX: If we applied a magnetic snap, our dragoffset (Mouse-to-Object) relation changed.
          // If we don't update dragOffset, next frame calculates dx from Mouse Original relative to Body Original.
          // We want consistent dragging.
          // If we snap, the object moves. Mouse is same.
          // dx = Mouse - DragOffset.
          // NewObjectPos = OldObjectPos + dx.
          // Snap modifies dx. NewObjectPos = OldObjectPos + dx + snap.
          // Effectively, we just want to set the position.
          // The standard logic is: this.dragOffset becomes MousePos at the end?
          // Code says: this.dragOffset = { x: worldPos.x, y: worldPos.y };
          // This resets the delta anchor to current mouse pos for the NEXT frame.
          // So dx/dy is always "Mouse Delta since last frame".
          // Wait. `dx = worldPos.x - this.dragOffset.x`.
          // If dragOffset is updated to current WorldPos at end of frame, then next frame dx is just frame delta.
          // And `p.x += dx` applies frame delta.
          // Correct.

          // So if we modify dx via snap, we move the object extra.
          // Next frame, mouse moves. dx is small.
          // If we are still snapped, maybe we shouldn't move?
          // Magnetic snap usually implies: "If close, jump to target".
          // If we move mouse further, it might unsnap (dist > threshold).
          // So logic holds: Calculate proposed, check snap, apply offset.

          this.dragOffset = { x: worldPos.x, y: worldPos.y };

          if ((editor.selectedObject as any).type === 'Quad') {
            const q = editor.selectedObject as QuadObject;
            // Move all vertices
            q.vertices.forEach((v) => {
              v.x += dx;
              v.y += dy;
            });
            q.x += dx;
            q.y += dy;
          } else {
            poly.forEach((p: any) => {
              p.x += dx;
              p.y += dy;
            });
          }
          store.incrementObjectVersion();
        }
      }
      // ENTITY DRAGGING/RESIZING
      else if (editor.selectedObject instanceof Entity) {
        const entity = editor.selectedObject;
        const p = entity.parallax !== undefined ? entity.parallax : 1.0;

        // @ts-ignore
        const vOx = entity.visualOffset ? entity.visualOffset.x : 0;
        // @ts-ignore
        const vOy = entity.visualOffset ? entity.visualOffset.y : 0;

        if (this.resizingHandle) {
          // RESIZING

          // 1. MOUSE (Raw at Entity Parallax)
          let worldX = (pos.x - halfW) / zoom + camX * p - vOx;
          let worldY = (pos.y - halfH) / zoom + camY * p - vOy;

          // 2. SNAPPING (Alt) - Visual Space -> Raw Space
          if (e.altKey) {
            const mouseVisual = {
              x: (pos.x - halfW) / zoom + camX,
              y: (pos.y - halfH) / zoom + camY,
            };

            const snappedVisual = EditorSnappingSystem.snapEntity(
              mouseVisual,
              entity,
              scene,
              camX,
              camY,
              zoom
            );

            if (snappedVisual) {
              // Unproject Visual -> Raw (Entity P)
              // Raw = Visual - vOx + Cam*(P-1)
              worldX = snappedVisual.x - vOx + camX * (p - 1.0);
              worldY = snappedVisual.y - vOy + camY * (p - 1.0);
            }
          }

          // Quantize
          worldX = Math.round(worldX);
          worldY = Math.round(worldY);

          // 3. APPLY RESIZE USING FIXED ANCHOR
          if (!this.resizeAnchor) {
            let ax = entity.x;
            let ay = entity.y;
            const hw = entity.width / 2;
            if (this.resizingHandle === 'nw') {
              ax = entity.x + hw;
              ay = entity.y;
            } else if (this.resizingHandle === 'ne') {
              ax = entity.x - hw;
              ay = entity.y;
            } else if (this.resizingHandle === 'sw') {
              ax = entity.x + hw;
              ay = entity.y - entity.height;
            } else if (this.resizingHandle === 'se') {
              ax = entity.x - hw;
              ay = entity.y - entity.height;
            }
            this.resizeAnchor = { x: ax, y: ay };
          }

          const anchor = this.resizeAnchor;
          let newL = 0,
            newR = 0,
            newT = 0,
            newB = 0;

          if (this.resizingHandle === 'nw') {
            newL = worldX;
            newT = worldY;
            newR = anchor.x;
            newB = anchor.y;
          } else if (this.resizingHandle === 'ne') {
            newR = worldX;
            newT = worldY;
            newL = anchor.x;
            newB = anchor.y;
          } else if (this.resizingHandle === 'sw') {
            newL = worldX;
            newB = worldY;
            newR = anchor.x;
            newT = anchor.y;
          } else if (this.resizingHandle === 'se') {
            newR = worldX;
            newB = worldY;
            newL = anchor.x;
            newT = anchor.y;
          }

          // 4. SHIFT: PROPORTIONAL SCALING
          if (e.shiftKey) {
            let ratio = 1.0;
            if (entity.baseWidth && entity.baseHeight && entity.baseHeight !== 0) {
              ratio = entity.baseWidth / entity.baseHeight;
            } else if (entity.height !== 0) {
              ratio = entity.width / entity.height;
            }

            const currentW = Math.abs(newR - newL);
            const idealH = currentW / ratio;

            if (this.resizingHandle.includes('n')) {
              newT = newB - idealH;
            } else {
              newB = newT + idealH;
            }
          }

          // Enforce Normality & Min Size
          if (newR < newL) {
            const t = newR;
            newR = newL;
            newL = t;
          }
          if (newB < newT) {
            const t = newB;
            newB = newT;
            newT = t;
          }

          if (newR - newL < 10) newR = newL + 10;
          if (newB - newT < 10) newB = newT + 10;

          const newW = newR - newL;
          const newH = newB - newT;

          entity.width = Math.round(newW);
          entity.height = Math.round(newH);
          entity.x = Math.round(newL + newW / 2);
          entity.y = Math.round(newB);

          // Recalc Base Dims
          if (!entity.ignoreScaling) {
            const factor = scene.getDepthScaleFor(entity) * entity.modelScale;
            if (factor !== 0) {
              entity.baseWidth = entity.width / factor;
              entity.baseHeight = entity.height / factor;
            }
          } else if (entity.scale !== 0) {
            entity.baseWidth = entity.width / entity.scale;
            entity.baseHeight = entity.height / entity.scale;
          }

          editor.updateUIFromObject();
        } else {
          // MOVING
          // Screen Space Drag Logic
          const newScreenX = pos.x - this.dragOffset.x;
          const newScreenY = pos.y - this.dragOffset.y;

          // Back to World
          // ScreenX = (EntityX - CamX*p + vOx) * Zoom + HalfW
          // EntityX = ((ScreenX - HalfW) / Zoom - vOx) / p + CamX  <-- No.
          // (ScreenX - HalfW)/Zoom = Ex - CamX*p + vOx
          // (ScreenX - HalfW)/Zoom - vOx + CamX*p = Ex

          // Simple:
          const wx = (newScreenX - halfW) / zoom - vOx + camX * p;
          const wy = (newScreenY - halfH) / zoom - vOy + camY * p;

          entity.x = Math.round(wx);
          entity.y = Math.round(wy);

          // Update Scaling if Y changed
          if (!entity.ignoreScaling) {
            const factor = scene.getDepthScaleFor(entity) * entity.modelScale;
            entity.scale = factor;
            entity.width = entity.baseWidth * factor;
            entity.height = entity.baseHeight * factor;
          }

          editor.updateUIFromObject();
        }
      }
    }
  }

  onMouseUp(_e: MouseEvent): void {
    if (this.boxSelectActive && this.boxSelectStart && this.boxSelectCurrent) {
      const editor = this.editor;
      const scene = editor.game.sceneManager.currentScene;
      if (scene) {
        const camX = scene.camera ? scene.camera.x : 0;
        const camY = scene.camera ? scene.camera.y : 0;
        const zoom = scene.camera ? scene.camera.zoom : 1.0;
        const halfW = editor.game.canvas.width / 2;
        const halfH = editor.game.canvas.height / 2;

        const rect = {
          l: Math.min(this.boxSelectStart.x, this.boxSelectCurrent.x),
          t: Math.min(this.boxSelectStart.y, this.boxSelectCurrent.y),
          r: Math.max(this.boxSelectStart.x, this.boxSelectCurrent.x),
          b: Math.max(this.boxSelectStart.y, this.boxSelectCurrent.y),
        };

        const hasArea = Math.abs(rect.r - rect.l) > 4 && Math.abs(rect.b - rect.t) > 4;
        if (hasArea) {
          const selected = this.collectObjectsInScreenRect(
            scene,
            rect,
            camX,
            camY,
            zoom,
            halfW,
            halfH
          );
          if (selected.length > 1) editor.setMultiSelection(selected);
          else if (selected.length === 1) editor.selectObject(selected[0]);
          else editor.selectObject(null);
        } else {
          editor.selectObject(null);
        }
      }
      this.boxSelectActive = false;
      this.boxSelectStart = null;
      this.boxSelectCurrent = null;
      this.isDragging = false;
      this.isPanning = false;
      return;
    }

    const store = useEditorStore.getState();
    if (store.selectedVertexIndex !== -1) {
      // Apply Binding if exists
      if (
        this.currentSnapBinding &&
        this.draggingVertexIndex >= 0 &&
        (this.editor.selectedObject as any).type === 'Quad'
      ) {
        const q = this.editor.selectedObject as QuadObject;
        if (q.vertices[this.draggingVertexIndex]) {
          const scene = this.editor.game.sceneManager.currentScene;
          if (this.currentSnapBinding.type === 'vertex') {
            applyVertexBinding(scene, q, this.draggingVertexIndex, this.currentSnapBinding);
          } else {
            // Grid snapping is positional only. Keep direct vertex bindings
            // intact, but drop any legacy live grid constraint being edited.
            QuadObject.getConnectedVertices(scene, q, this.draggingVertexIndex).forEach((ref) => {
              if (ref.v.binding?.type === 'grid') delete ref.v.binding;
            });
          }
        }
      } else if (
        this.draggingVertexIndex >= 0 &&
        (this.editor.selectedObject as any).type === 'Quad'
      ) {
        // If we moved a vertex and DID NOT snap, we KEEP the binding (Standard Group Move)
        // Do nothing.
      }
      this.currentSnapBinding = null;
      store.selectVertex(-1);
    }

    this.isDragging = false;
    this.draggingVertexIndex = -1;
    this.resizingHandle = null;
    this.resizeAnchor = null; // Clear anchor
    this.isPanning = false;
  }

  onClick(x: number, y: number): boolean {
    if (!this.editor.enabled) return false;

    // If in Draw Mode, add points
    if (this.drawMode) {
      // Convert Screen X/Y to World X/Y for storage
      const scene = this.editor.game.sceneManager.currentScene;
      const camX = scene && scene.camera ? scene.camera.x : 0;
      const camY = scene && scene.camera ? scene.camera.y : 0;
      const zoom = scene && scene.camera ? scene.camera.zoom : 1.0;

      const halfW = this.editor.game.canvas.width / 2;
      const halfH = this.editor.game.canvas.height / 2;

      const worldX = (x - halfW) / zoom + camX;
      const worldY = (y - halfH) / zoom + camY;

      if (!this.currentPolygon) this.currentPolygon = [];

      // SNAP LOGIC
      let finalX = Math.round(worldX);
      let finalY = Math.round(worldY);

      if (this.editor.game.input.isDown('Shift') && this.currentPolygon.length > 0) {
        const anchor = this.currentPolygon[this.currentPolygon.length - 1];
        const snapped = this.getSnappedPos({ x: worldX, y: worldY }, anchor);
        finalX = snapped.x;
        finalY = snapped.y;
      }

      this.currentPolygon.push({ x: finalX, y: finalY });
    }

    // ALWAYS consume click if editor is enabled to prevent Game/Player interaction
    return true;
  }

  startCreating(type: string, x?: number, y?: number): void {
    const editor = this.editor;
    if (!editor.game.sceneManager.currentScene) return;

    // NOTE: SceneEditor.startCreating already calls saveUndoState()
    // editor.saveUndoState();

    const scene = editor.game.sceneManager.currentScene;

    if (type === 'Static' || type === 'Actor' || type === 'Quad') {
      const nameInput = document.getElementById('new-object-name') as HTMLInputElement;
      let name = nameInput ? nameInput.value : '';

      if (!name) {
        name = type + '_' + Math.floor(Math.random() * 1000);
        if (nameInput) nameInput.value = name;
      }

      let ent: Entity;
      if (type === 'Actor') {
        const data = JSON.parse(JSON.stringify(DefaultActorData));
        data.name = name;
        data.x = x !== undefined ? x : 160;
        data.y = y !== undefined ? y : 100;
        ent = Actor.fromJSON(editor.game, data);
      } else if (type === 'Quad') {
        const data = JSON.parse(JSON.stringify(DefaultQuadData));
        data.name = name;

        if (x !== undefined && y !== undefined) {
          data.vertices = [
            { x: x, y: y, p: 1.0 },
            { x: x + 100, y: y, p: 1.0 },
            { x: x + 100, y: y + 100, p: 1.0 },
            { x: x, y: y + 100, p: 1.0 },
          ];
          data.x = x + 50;
          data.y = y + 100;
        } else {
          data.x = 160;
          data.y = 100;
        }

        ent = QuadObject.fromJSON(editor.game, data);
      } else {
        const data = JSON.parse(JSON.stringify(DefaultEntityData));
        data.name = name;
        data.x = x !== undefined ? x : 160;
        data.y = y !== undefined ? y : 100;
        ent = Entity.fromJSON(editor.game, data);
      }

      scene.addEntity(ent);
      editor.selectObject(ent);
      useEditorStore.getState().incrementHierarchyVersion();
      this.drawMode = false;
    } else if (type === 'Walkbox') {
      if (!scene.walkbox) scene.walkbox = [];
      const newWalkbox = new Walkbox([], 'Walk_' + Math.floor(Math.random() * 1000));
      scene.walkbox.push(newWalkbox);
      editor.selectObject(newWalkbox);
      useEditorStore.getState().incrementHierarchyVersion();
      editor.redrawSelected();
    } else if (type === 'Triggerbox') {
      if (!scene.triggerboxes) scene.triggerboxes = [];
      const newTrigger = new Triggerbox([], 'Trig_' + Math.floor(Math.random() * 1000));
      scene.triggerboxes.push(newTrigger);
      editor.selectObject(newTrigger);
      useEditorStore.getState().incrementHierarchyVersion();
      editor.redrawSelected();
    } else if (type === 'Folder') {
      const name = 'Folder_' + Math.floor(Math.random() * 1000);
      const folder = new Folder(editor.game, name);
      scene.addFolder(folder);
      editor.selectObject(folder);
      useEditorStore.getState().incrementHierarchyVersion();
    }
  }

  finishPolygon(): void {
    if (this.currentPolygon && this.currentPolygon.length > 2) {
      // Instead of creating NEW object, assign to SELECTED object
      if (
        this.editor.selectedObject &&
        (this.editor.selectedObject instanceof Walkbox ||
          this.editor.selectedObject instanceof Triggerbox)
      ) {
        this.editor.selectedObject.poly = [...this.currentPolygon];
      } else {
        console.warn('No valid object selected for polygon completion!');
      }

      this.currentPolygon = [];
      this.drawMode = false;

      const chk = document.getElementById('chk-draw-mode') as HTMLInputElement;
      if (chk) chk.checked = false;

      useEditorStore.getState().setMode('SELECT');
      this.editor.refreshHierarchy();
    }
  }

  onWheel(e: WheelEvent): void {
    const editor = this.editor;
    if (!editor.enabled) return;
    if (editor.game.isMouseOverUI) return;

    e.preventDefault();

    const scene = editor.game.sceneManager.currentScene;
    if (scene && scene.camera) {
      if (e.deltaY < 0) {
        // Zoom In
        scene.camera.zoom *= 1.1;
        // Clamp max zoom? Optional but good practice.
        if (scene.camera.zoom > 10) scene.camera.zoom = 10;
        useEditorStore.getState().incrementObjectVersion();
      } else if (e.deltaY > 0) {
        // Zoom Out
        scene.camera.zoom *= 0.9;
        if (scene.camera.zoom < 0.01) scene.camera.zoom = 0.01;
        useEditorStore.getState().incrementObjectVersion();
      }
      // Notify UI if needed (though zoom usually doesn't need immediate inspector update unless we show zoom level)
      // But we might want to refresh if we add a zoom slider later.
    }
  }
}
