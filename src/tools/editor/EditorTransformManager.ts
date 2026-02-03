
import { SceneEditor } from '../SceneEditor';
import { Entity } from '../../entities/Entity';
import { Actor } from '../../entities/Actor';
import { QuadObject, type QuadVertexBinding } from '../../entities/QuadObject';
import { Walkbox } from '../../entities/Walkbox';
import { Triggerbox } from '../../entities/Triggerbox';

import { Geometry } from '../../utils/Geometry';
import { DefaultActorData, DefaultEntityData, DefaultQuadData } from '../../entities/EntityPrefabs';
import { useEditorStore } from '../../store/editorStore';

export class EditorTransformManager {
    private editor: SceneEditor;

    // State
    isDragging: boolean = false;
    dragOffset: { x: number, y: number } = { x: 0, y: 0 };
    isPanning: boolean = false;
    lastPanPos: { x: number, y: number } = { x: 0, y: 0 };
    lastMousePos: { x: number, y: number } = { x: 0, y: 0 };

    creationType: 'Walkbox' | 'Triggerbox' = 'Walkbox';
    draggingVertexIndex: number = -1;
    resizingHandle: string | null = null;
    drawMode: boolean = false;
    currentPolygon: { x: number, y: number }[] = [];
    currentSnapBinding: QuadVertexBinding | null = null;
    dragStartPos: { x: number, y: number } | null = null;

    constructor(editor: SceneEditor) {
        this.editor = editor;
    }

    // Helper: Screen -> World
    getMousePos(e: MouseEvent): { x: number, y: number } {
        const rect = this.editor.game.canvas.getBoundingClientRect();
        const scaleX = this.editor.game.canvas.width / rect.width;
        const scaleY = this.editor.game.canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    getSnappedPos(current: { x: number, y: number }, anchor: { x: number, y: number }): { x: number, y: number } {
        const dx = current.x - anchor.x;
        const dy = current.y - anchor.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist === 0) return anchor;

        const angle = Math.atan2(dy, dx);
        const snapAngle = Math.PI / 8; // 22.5 degrees
        const snappedAngle = Math.round(angle / snapAngle) * snapAngle;

        return {
            x: Math.round(anchor.x + Math.cos(snappedAngle) * dist),
            y: Math.round(anchor.y + Math.sin(snappedAngle) * dist)
        };
    }

    // Interaction Handlers

    onMouseDown(e: MouseEvent): void {
        const editor = this.editor;
        if (!editor.enabled) return;

        // Right Click Panning
        if (e.button === 2) {
            this.isPanning = true;
            this.lastPanPos = { x: e.clientX, y: e.clientY };

            // Disable Auto-Center automatically
            if (editor.game.sceneManager.currentScene) {
                editor.game.sceneManager.currentScene.autoCenter = false;

                // Notify UI immediately
                const store = useEditorStore.getState();
                if (!store.selectedObjectId || store.selectedObjectId === 'SCENE') {
                    store.incrementObjectVersion();
                }
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

            // 0. CHECK SELECTED POLYGON VERTICES (High Priority)
            if (editor.selectedObject && (editor.selectedObject instanceof Walkbox || editor.selectedObject instanceof Triggerbox || (editor.selectedObject as any).type === 'Quad')) {
                if (editor.selectedObject.disabled) return; // Prevent interaction if disabled

                let poly: any[] = [];
                // Only Quads use projected vertices for Hit Test logic in original code
                if ((editor.selectedObject as any).type === 'Quad') {
                    // Project Quad Vertices to World P=1 for Hit Test
                    poly = (editor.selectedObject as QuadObject).vertices.map((v: any) => ({
                        x: v.x - camX * (v.p - 1.0),
                        y: v.y - camY * (v.p - 1.0)
                    }));
                } else {
                    poly = (editor.selectedObject as any).poly;
                }

                const vertexRadius = 6 / zoom; // Hit radius

                // Calculate Centroid...
                let cx = 0, cy = 0;
                if ((editor.selectedObject as any).type === 'Quad') {
                    poly.forEach((p: any) => { cx += p.x; cy += p.y; });
                    cx /= poly.length;
                    cy /= poly.length;
                }

                // Check vertices
                const worldPos = {
                    x: (pos.x - halfW) / zoom + camX,
                    y: (pos.y - halfH) / zoom + camY
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
                            const shiftDist = (vertexRadius / 2) + (2 / zoom);
                            vx += (dx / len) * shiftDist;
                            vy += (dy / len) * shiftDist;
                        }
                    }

                    if (Math.abs(worldPos.x - vx) < vertexRadius / 2 && Math.abs(worldPos.y - vy) < vertexRadius / 2) {
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

            // 0.5 CHECK SELECTED ENTITY (High Priority)
            if (editor.selectedObject && editor.selectedObject instanceof Entity && (editor.selectedObject as any).type !== 'Quad') {
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
                if (pos.x >= sl && pos.x <= sl + exactHSize && pos.y >= st && pos.y <= st + exactHSize) hitHandle = 'nw';
                else if (pos.x >= sr - exactHSize && pos.x <= sr && pos.y >= st && pos.y <= st + exactHSize) hitHandle = 'ne';
                else if (pos.x >= sl && pos.x <= sl + exactHSize && pos.y >= sb - exactHSize && pos.y <= sb) hitHandle = 'sw';
                else if (pos.x >= sr - exactHSize && pos.x <= sr && pos.y >= sb - exactHSize && pos.y <= sb) hitHandle = 'se';

                const hitBody = (pos.x >= sl && pos.x <= sr && pos.y >= st && pos.y <= sb);

                if (hitHandle || hitBody) {
                    if (!entity.locked) {
                        editor.saveUndoState();
                        this.isDragging = true;
                        this.draggingVertexIndex = -1;

                        if (hitHandle) {
                            this.resizingHandle = hitHandle;
                        } else {
                            this.resizingHandle = null;
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

                const p = entity.parallax !== undefined ? entity.parallax : 1.0;

                // @ts-ignore
                const vOx = (entity as any).visualOffset ? (entity as any).visualOffset.x : 0;
                // @ts-ignore
                const vOy = (entity as any).visualOffset ? (entity as any).visualOffset.y : 0;

                // Mouse World Pos for this entity layer
                const worldX = (pos.x - halfW) / zoom + camX * p - vOx;
                const worldY = (pos.y - halfH) / zoom + camY * p - vOy;

                if (entity.hitTest(worldX, worldY)) {
                    this.editor.selectObject(entity);
                    e.stopPropagation();
                    return;
                }
            }

            // 2. Check Walkboxes
            const worldPos = {
                x: (pos.x - halfW) / zoom + camX,
                y: (pos.y - halfH) / zoom + camY
            };

            if (scene.walkbox) {
                for (const wb of scene.walkbox) {
                    if (wb.disabled) continue;
                    if (wb.locked) continue;
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
                    if (Geometry.isPointInPolygon(worldPos, tb.poly)) {
                        this.editor.selectObject(tb);
                        e.stopPropagation();
                        return;
                    }
                }
            }
        }

        this.editor.selectObject(null);
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

            if (s.autoCenter) {
                s.autoCenter = false;
                const store = useEditorStore.getState();
                if (!store.selectedObjectId || store.selectedObjectId === 'SCENE') {
                    store.incrementObjectVersion();
                }
            }

            // Update UI
            const cx = document.getElementById('cam-x') as HTMLInputElement;
            const cy = document.getElementById('cam-y') as HTMLInputElement;
            if (cx) cx.value = Math.round(s.camera.x).toString();
            if (cy) cy.value = Math.round(s.camera.y).toString();
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

            // POLYGON DRAGGING
            if (editor.selectedObject instanceof Walkbox || editor.selectedObject instanceof Triggerbox || (editor.selectedObject as any).type === 'Quad') {
                const worldPos = {
                    x: (pos.x - halfW) / zoom + camX,
                    y: (pos.y - halfH) / zoom + camY
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

                    // SHIFT: ANGLE SNAPPING (Relative Parallax Space Dual Edge Intersection)
                    if (e.shiftKey) {
                        const prevIndex = (this.draggingVertexIndex - 1 + poly.length) % poly.length;
                        const nextIndex = (this.draggingVertexIndex + 1) % poly.length;

                        const prevV = poly[prevIndex];
                        const nextV = poly[nextIndex];

                        // Helper: Resolve effective parallax (Binding Lookup)
                        const resolveParallax = (v: any) => {
                            if (v.binding && v.binding.targetName) {
                                const targetName = v.binding.targetName;
                                // Find entity by name
                                // Check Entities
                                const ent = scene.entities.find((e: any) => e.name === targetName);
                                if (ent) return ent.parallax ?? 1.0;

                                // Check Triggerboxes
                                if (scene.triggerboxes) {
                                    const tb = scene.triggerboxes.find((t: any) => t.name === targetName);
                                    if (tb) return tb.parallax ?? 1.0;
                                }
                            }
                            return v.p ?? 1.0;
                        };

                        const pCurr = resolveParallax(v);
                        const pPrev = resolveParallax(prevV);
                        const pNext = resolveParallax(nextV);

                        // Formula: Pos_New = Pos_Old + Cam * (P_New - P_Old)
                        // We convert everything to the "Space of Current Vertex" (pCurr)

                        const transformToCurr = (pos: { x: number, y: number }, pOld: number) => ({
                            x: pos.x + camX * (pCurr - pOld),
                            y: pos.y + camY * (pCurr - pOld)
                        });

                        const prevTrans = transformToCurr(prevV, pPrev);
                        const nextTrans = transformToCurr(nextV, pNext);

                        // Mouse is in World Space P=1 (Layout Space)
                        // Convert Mouse(P=1) to Mouse(P=pCurr)
                        const mouseTrans = transformToCurr(worldPos, 1.0);

                        // Helper: Get angle from A to B
                        const getAngle = (a: { x: number, y: number }, b: { x: number, y: number }) => Math.atan2(b.y - a.y, b.x - a.x);

                        // 1. Calculate angles in Local Space
                        const rawAnglePrev = getAngle(prevTrans, mouseTrans);
                        const rawAngleNext = getAngle(nextTrans, mouseTrans);

                        // 2. Snap angles to 22.5 deg
                        const step = Math.PI / 8;
                        const snapAnglePrev = Math.round(rawAnglePrev / step) * step;
                        const snapAngleNext = Math.round(rawAngleNext / step) * step;

                        // 3. Construct Lines
                        const getLine = (p: { x: number, y: number }, theta: number) => {
                            const A = -Math.sin(theta);
                            const B = Math.cos(theta);
                            const C = A * p.x + B * p.y;
                            return { A, B, C, p, theta };
                        };

                        const L1 = getLine(prevTrans, snapAnglePrev);
                        const L2 = getLine(nextTrans, snapAngleNext);

                        // 4. Find Intersection
                        const det = L1.A * L2.B - L2.A * L1.B;

                        let targetTrans = { x: mouseTrans.x, y: mouseTrans.y };

                        const EPSILON = 0.0001;
                        if (Math.abs(det) > EPSILON) {
                            // Intersection exists
                            targetTrans.x = (L2.B * L1.C - L1.B * L2.C) / det;
                            targetTrans.y = (L1.A * L2.C - L2.A * L1.C) / det;
                        } else {
                            // Parallel: Project onto closest line
                            const distToLine = (x: number, y: number, L: any) => Math.abs(L.A * x + L.B * y - L.C);
                            const d1 = distToLine(mouseTrans.x, mouseTrans.y, L1);
                            const d2 = distToLine(mouseTrans.x, mouseTrans.y, L2);

                            const project = (start: { x: number, y: number }, theta: number, p: { x: number, y: number }) => {
                                const ux = Math.cos(theta);
                                const uy = Math.sin(theta);
                                const v = { x: p.x - start.x, y: p.y - start.y };
                                const t = v.x * ux + v.y * uy;
                                return { x: start.x + t * ux, y: start.y + t * uy };
                            };

                            if (d1 < d2) {
                                targetTrans = project(L1.p, L1.theta, mouseTrans);
                            } else {
                                targetTrans = project(L2.p, L2.theta, mouseTrans);
                            }
                        }

                        // 5. Update WorldPos
                        // targetTrans IS the correct Raw Coordinate for 'v' (in pCurr space)
                        // HOWEVER, the default logic below expects worldPos to be Visual (P=1)
                        // because it does: v.x = worldPos.x + camX * (v.p - 1.0)
                        // So we must inverse transform it here.

                        worldPos.x = targetTrans.x - camX * (pCurr - 1.0);
                        worldPos.y = targetTrans.y - camY * (pCurr - 1.0);
                    }

                    // ALT: QUAD SNAP TO OTHER QUADS/GRIDS
                    if (e.altKey && (editor.selectedObject as any).type === 'Quad') {
                        let bestDist = 10 / zoom; // Snap threshold
                        let snapTarget: { x: number, y: number } | null = null;

                        // Iterate all OTHER entities
                        scene.entities.forEach((ent: Entity) => {
                            if (ent === editor.selectedObject) return;
                            if ((ent as any).type === 'Quad') {
                                const q = ent as QuadObject;
                                if (q.disabled || !q.visible) return;

                                // Check Vertices
                                q.vertices.forEach(qv => {
                                    // Visual Position = Raw - Camera * (P - 1)
                                    // Note: Editor stores standard camera as camX, camY.
                                    // We must match the visual projection logic used elsewhere.
                                    const vx = Math.round(qv.x - camX * (qv.p - 1.0));
                                    const vy = Math.round(qv.y - camY * (qv.p - 1.0));

                                    const dx = Math.abs(vx - worldPos.x);
                                    const dy = Math.abs(vy - worldPos.y);
                                    if (dx < bestDist && dy < bestDist) {
                                        snapTarget = { x: vx, y: vy };
                                        bestDist = Math.max(dx, dy);
                                        this.currentSnapBinding = {
                                            targetName: q.name,
                                            type: 'vertex',
                                            index: q.vertices.indexOf(qv) // Assuming reference identity, else use loop index
                                        };
                                    }
                                });

                                // Check Retro Grid Nodes
                                if (q.isGrid) {
                                    // Calculate Visual Positions of Corners
                                    const visualVerts = q.vertices.map(v => ({
                                        x: Math.round(v.x - camX * (v.p - 1.0)),
                                        y: Math.round(v.y - camY * (v.p - 1.0))
                                    }));

                                    const v0 = visualVerts[0];
                                    const v1 = visualVerts[1];
                                    const v2 = visualVerts[2];
                                    const v3 = visualVerts[3];

                                    for (let i = 1; i <= q.gridLinesX; i++) {
                                        const t = i / (q.gridLinesX + 1);

                                        // Vertical Line Top/Bottom points (Edge Intersections)
                                        const tx = v0.x + (v1.x - v0.x) * t;
                                        const ty = v0.y + (v1.y - v0.y) * t;
                                        const bx = v3.x + (v2.x - v3.x) * t;
                                        const by = v3.y + (v2.y - v3.y) * t;

                                        // Snap to Top Edge Point
                                        let d = Math.abs(tx - worldPos.x);
                                        let d2 = Math.abs(ty - worldPos.y);
                                        if (d < bestDist && d2 < bestDist) {
                                            snapTarget = { x: tx, y: ty };
                                            this.currentSnapBinding = { targetName: q.name, type: 'grid', gridU: t, gridV: 0 };
                                        }

                                        // Snap to Bottom Edge Point
                                        d = Math.abs(bx - worldPos.x);
                                        d2 = Math.abs(by - worldPos.y);
                                        if (d < bestDist && d2 < bestDist) {
                                            snapTarget = { x: bx, y: by };
                                            this.currentSnapBinding = { targetName: q.name, type: 'grid', gridU: t, gridV: 1 };
                                        }

                                        // Vertical Line
                                        // Intersection with Horizontal Lines
                                        for (let j = 1; j <= q.gridLinesY; j++) {
                                            const ty_h = j / (q.gridLinesY + 1);
                                            // Bilinear Interpolation
                                            const u = t;
                                            const v_param = ty_h;

                                            const nx = (1 - u) * (1 - v_param) * v0.x + u * (1 - v_param) * v1.x + (1 - u) * v_param * v3.x + u * v_param * v2.x;
                                            const ny = (1 - u) * (1 - v_param) * v0.y + u * (1 - v_param) * v1.y + (1 - u) * v_param * v3.y + u * v_param * v2.y;

                                            const dx = Math.abs(nx - worldPos.x);
                                            const dy = Math.abs(ny - worldPos.y);
                                            if (dx < bestDist && dy < bestDist) {
                                                snapTarget = { x: nx, y: ny };
                                                this.currentSnapBinding = { targetName: q.name, type: 'grid', gridU: u, gridV: v_param };
                                            }
                                        }
                                    }

                                    // Horizontal Line Edge Points (Left/Right)
                                    for (let j = 1; j <= q.gridLinesY; j++) {
                                        const u = j / (q.gridLinesY + 1);
                                        // Left Point (v0 -> v3)
                                        const lx = v0.x + (v3.x - v0.x) * u;
                                        const ly = v0.y + (v3.y - v0.y) * u;

                                        // Right Point (v1 -> v2)
                                        const rx = v1.x + (v2.x - v1.x) * u;
                                        const ry = v1.y + (v2.y - v1.y) * u;

                                        // Snap to Left Edge Point
                                        let d = Math.abs(lx - worldPos.x);
                                        let d2 = Math.abs(ly - worldPos.y);
                                        if (d < bestDist && d2 < bestDist) {
                                            snapTarget = { x: lx, y: ly };
                                            this.currentSnapBinding = { targetName: q.name, type: 'grid', gridU: 0, gridV: u };
                                        }

                                        // Snap to Right Edge Point
                                        d = Math.abs(rx - worldPos.x);
                                        d2 = Math.abs(ry - worldPos.y);
                                        if (d < bestDist && d2 < bestDist) {
                                            snapTarget = { x: rx, y: ry };
                                            this.currentSnapBinding = { targetName: q.name, type: 'grid', gridU: 1, gridV: u };
                                        }
                                    }
                                }
                            }
                        });

                        if (snapTarget) {
                            worldPos.x = (snapTarget as any).x;
                            worldPos.y = (snapTarget as any).y;
                        } else {
                            this.currentSnapBinding = null;
                        }
                    } else {
                        this.currentSnapBinding = null;
                    }

                    if ((editor.selectedObject as any).type === 'Quad') {
                        // Reverse Projection
                        v.x = Math.round(worldPos.x + camX * (v.p - 1.0));
                        v.y = Math.round(worldPos.y + camY * (v.p - 1.0));

                    } else {
                        v.x = Math.round(worldPos.x);
                        v.y = Math.round(worldPos.y);
                    }
                    store.incrementObjectVersion();

                } else if (this.draggingVertexIndex === -1) {
                    // Moving Body (Quad/Polygon)
                    const dx = worldPos.x - this.dragOffset.x;
                    const dy = worldPos.y - this.dragOffset.y;

                    // Update DragOffset
                    this.dragOffset = { x: worldPos.x, y: worldPos.y };

                    if ((editor.selectedObject as any).type === 'Quad') {
                        const q = editor.selectedObject as QuadObject;
                        // Move all vertices
                        // And center x/y?
                        q.vertices.forEach(v => {
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
                    // We need World Pos at entity parallax
                    const worldX = (pos.x - halfW) / zoom + camX * p - vOx;
                    const worldY = (pos.y - halfH) / zoom + camY * p - vOy;

                    // Snap to grid?
                    const wx = Math.round(worldX);
                    const wy = Math.round(worldY);

                    // Calc new bounding box based on handle
                    // Top-Left is entity.x - w/2, entity.y - h
                    // Bottom-Right is entity.x + w/2, entity.y

                    let newL = entity.x - entity.width / 2;
                    let newR = entity.x + entity.width / 2;
                    let newT = entity.y - entity.height;
                    let newB = entity.y;

                    // SHIFT: PROPORTIONAL SCALING
                    // Calculate Ratio from Base Dims (preferred) or Current Dims
                    // Ratio = Width / Height
                    let ratio = 1.0;
                    if (entity.baseWidth && entity.baseHeight && entity.baseHeight !== 0) {
                        ratio = entity.baseWidth / entity.baseHeight;
                    } else if (entity.height !== 0) {
                        ratio = entity.width / entity.height;
                    }

                    if (this.resizingHandle === 'nw') {
                        newL = wx; newT = wy;
                        if (e.shiftKey) {
                            const w = newR - newL;
                            const idealH = w / ratio;
                            newT = newB - idealH;
                        }
                    } else if (this.resizingHandle === 'ne') {
                        newR = wx; newT = wy;
                        if (e.shiftKey) {
                            const w = newR - newL;
                            const idealH = w / ratio;
                            newT = newB - idealH;
                        }
                    } else if (this.resizingHandle === 'sw') {
                        newL = wx; newB = wy;
                        if (e.shiftKey) {
                            const w = newR - newL;
                            const idealH = w / ratio;
                            newB = newT + idealH;
                        }
                    } else if (this.resizingHandle === 'se') {
                        newR = wx; newB = wy;
                        if (e.shiftKey) {
                            const w = newR - newL;
                            const idealH = w / ratio;
                            newB = newT + idealH;
                        }
                    }

                    // Enforce Min Size
                    if (newR - newL < 10) newR = newL + 10;
                    if (newB - newT < 10) newB = newT + 10;

                    const newW = newR - newL;
                    const newH = newB - newT;
                    // Pivot is Bottom Center
                    // X = L + W/2
                    // Y = B
                    entity.width = Math.round(newW);
                    entity.height = Math.round(newH);
                    entity.x = Math.round(newL + newW / 2);
                    entity.y = Math.round(newB);

                    // Recalc Base Dims if scaling enabled
                    if (!entity.ignoreScaling && scene.scaling.enabled) {
                        const factor = scene.getScaling(entity.y) * entity.modelScale;
                        if (factor !== 0) {
                            entity.baseWidth = entity.width / factor;
                            entity.baseHeight = entity.height / factor;
                        }
                    } else if (entity.scale !== 0) {
                        entity.baseWidth = entity.width / entity.scale;
                        entity.baseHeight = entity.height / entity.scale;
                    }

                    editor.ui.updateUIFromObject();

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
                    if (!entity.ignoreScaling && scene.scaling.enabled) {
                        const factor = scene.getScaling(entity.y) * entity.modelScale;
                        entity.scale = factor;
                        entity.width = entity.baseWidth * factor;
                        entity.height = entity.baseHeight * factor;
                    }

                    editor.ui.updateUIFromObject();
                }
            }
        }
    }

    onMouseUp(_e: MouseEvent): void {
        const store = useEditorStore.getState();
        if (store.selectedVertexIndex !== -1) {
            // Apply Binding if exists
            if (this.currentSnapBinding && this.draggingVertexIndex >= 0 && (this.editor.selectedObject as any).type === 'Quad') {
                const q = this.editor.selectedObject as QuadObject;
                if (q.vertices[this.draggingVertexIndex]) {
                    q.vertices[this.draggingVertexIndex].binding = this.currentSnapBinding;
                    console.log(`[Editor] Vertex ${this.draggingVertexIndex} bound to ${this.currentSnapBinding.targetName} (${this.currentSnapBinding.type})`);
                }
            } else if (this.draggingVertexIndex >= 0 && (this.editor.selectedObject as any).type === 'Quad') {
                // If we moved a vertex and DID NOT snap, clear binding
                const q = this.editor.selectedObject as QuadObject;
                if (q.vertices[this.draggingVertexIndex]) {
                    delete q.vertices[this.draggingVertexIndex].binding;
                }
            }
            this.currentSnapBinding = null;
            store.selectVertex(-1);
        }

        this.isDragging = false;
        this.draggingVertexIndex = -1;
        this.resizingHandle = null;
        this.isPanning = false;
    }

    onClick(x: number, y: number): boolean {
        // console.log(`[Editor] onClick: ${x}, ${y}, Enabled: ${this.editor.enabled}, DrawMode: ${this.drawMode} `);
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
            console.log(`Point Added: ${finalX},${finalY}.Total: ${this.currentPolygon.length} `);
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
                        { x: x, y: y + 100, p: 1.0 }
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
            this.drawMode = false;
        } else if (type === 'Walkbox') {
            if (!scene.walkbox) scene.walkbox = [];
            const newWalkbox = new Walkbox([], 'Walk_' + Math.floor(Math.random() * 1000));
            scene.walkbox.push(newWalkbox);
            console.log('Walkbox object added to scene (Empty)');
            editor.selectObject(newWalkbox);
            editor.redrawSelected();

        } else if (type === 'Triggerbox') {
            if (!scene.triggerboxes) scene.triggerboxes = [];
            const newTrigger = new Triggerbox([], 'Trig_' + Math.floor(Math.random() * 1000));
            scene.triggerboxes.push(newTrigger);
            console.log('Triggerbox object added to scene (Empty)');
            editor.selectObject(newTrigger);
            editor.redrawSelected();
        }
    }

    finishPolygon(): void {
        console.log('finishPolygon called');
        if (this.currentPolygon && this.currentPolygon.length > 2) {
            // Instead of creating NEW object, assign to SELECTED object
            if (this.editor.selectedObject && (this.editor.selectedObject instanceof Walkbox || this.editor.selectedObject instanceof Triggerbox)) {
                this.editor.selectedObject.poly = [...this.currentPolygon];
                console.log("Polygon updated for " + this.editor.selectedObject.name);
            } else {
                console.warn("No valid object selected for polygon completion!");
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
            } else if (e.deltaY > 0) {
                // Zoom Out
                scene.camera.zoom *= 0.9;
                if (scene.camera.zoom < 0.1) scene.camera.zoom = 0.1;
            }
            // Notify UI if needed (though zoom usually doesn't need immediate inspector update unless we show zoom level)
            // But we might want to refresh if we add a zoom slider later.
        }
    }
}
