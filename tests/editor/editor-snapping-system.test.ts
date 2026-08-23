import { afterEach, describe, expect, it, vi } from 'vitest';

import { QuadObject } from '../../src/entities/QuadObject';
import { EditorSnappingSystem } from '../../src/tools/editor/EditorSnappingSystem';
import { EditorTransformManager } from '../../src/tools/editor/EditorTransformManager';
import { useEditorStore } from '../../src/store/editorStore';
import { createSceneFixture } from '../fixtures/sceneFactory';

function addQuad(fixture: ReturnType<typeof createSceneFixture>, name: string): QuadObject {
  const quad = new QuadObject(fixture.game, name);
  fixture.scene.addEntity(quad);
  return quad;
}

describe('Editor quad snapping', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adopts the target quad vertex parallax when Alt-snapping to a vertex', () => {
    const fixture = createSceneFixture();
    const source = addQuad(fixture, 'source');
    const target = addQuad(fixture, 'target');
    fixture.scene.camera.x = 100;
    fixture.scene.camera.y = 50;
    fixture.scene.camera.zoom = 1;

    target.vertices[1] = { x: 200, y: 90, p: 0.5 };

    const result = EditorSnappingSystem.snapVertex(
      { x: 250, y: 115 },
      source.vertices,
      0,
      fixture.scene,
      fixture.scene.camera.x,
      fixture.scene.camera.y,
      true,
      source,
      false,
      true,
      fixture.scene.camera.zoom
    );

    expect(result.binding).toEqual({ targetName: 'target', type: 'vertex', index: 1 });
    expect(result.p).toBe(0.5);
  });

  it('adopts the same surface parallax as 3D-Parallacs when snapping to a grid node', () => {
    const fixture = createSceneFixture();
    const source = addQuad(fixture, 'source');
    const target = addQuad(fixture, 'target');
    target.isGrid = true;
    target.gridLinesX = 1;
    target.gridLinesY = 1;
    target.perspective = false;
    target.vertices = [
      { x: 0, y: 0, p: 0.5 },
      { x: 100, y: 0, p: 0.5 },
      { x: 100, y: 100, p: 1 },
      { x: 0, y: 100, p: 1 },
    ];

    const result = EditorSnappingSystem.snapVertex(
      { x: 50, y: 50 },
      source.vertices,
      0,
      fixture.scene,
      0,
      0,
      true,
      source,
      false,
      true,
      1
    );

    expect(result.binding).toBeNull();
    expect(result.p).toBe(target.getParallaxAtGrid(0.5, 0.5));
    expect(result.p).toBe(0.75);
  });

  it('places a vertex on a perspective grid node without creating a live binding', () => {
    const fixture = createSceneFixture();
    const source = addQuad(fixture, 'source');
    const target = addQuad(fixture, 'target');
    fixture.scene.camera.x = 80;
    fixture.scene.camera.y = 40;
    fixture.scene.camera.zoom = 1;

    target.isGrid = true;
    target.gridLinesX = 1;
    target.gridLinesY = 1;
    target.perspective = true;
    target.perspectiveAmount = 1;
    target.vertices = [
      { x: 20, y: 10, p: 0.5 },
      { x: 140, y: 30, p: 0.5 },
      { x: 110, y: 150, p: 1 },
      { x: -20, y: 110, p: 1 },
    ];

    const gridU = 0.5;
    const gridV = 0.5;
    const initialGridPoint = target.getGridPointAt(gridU, gridV, true);
    const snap = EditorSnappingSystem.snapVertex(
      initialGridPoint,
      source.vertices,
      0,
      fixture.scene,
      fixture.scene.camera.x,
      fixture.scene.camera.y,
      true,
      source,
      false,
      true,
      fixture.scene.camera.zoom
    );

    expect(snap.binding).toBeNull();
    expect(snap.p).toBeCloseTo(target.getParallaxAtGrid(gridU, gridV), 10);
    expect(snap.p).toBeLessThan(0.75);
    expect(snap.p).toBeLessThan(1);

    const effectiveP = snap.p!;
    source.vertices[0] = {
      x: snap.x + fixture.scene.camera.x * (effectiveP - source.parallax),
      y: snap.y + fixture.scene.camera.y * (effectiveP - source.parallax),
      p: effectiveP / source.parallax,
    };

    const authoredPosition = {
      x: source.vertices[0].x,
      y: source.vertices[0].y,
      p: source.vertices[0].p,
    };
    const getGridDistance = () => {
      const sourcePoint = source.getVisualVertices(false)[0];
      const gridPoint = target.getGridPointAt(gridU, gridV, true, false);
      return Math.hypot(sourcePoint.x - gridPoint.x, sourcePoint.y - gridPoint.y);
    };

    source.update(0);
    expect(getGridDistance()).toBeLessThan(0.000001);
    fixture.scene.camera.x = 170;
    fixture.scene.camera.y = -25;
    source.update(0);
    const correctedDistance = getGridDistance();
    const gridPoint = target.getGridPointAt(gridU, gridV, true, false);
    const flatParallax = 0.75;
    const flatPoint = {
      x: initialGridPoint.x - (170 - 80) * (flatParallax - 1),
      y: initialGridPoint.y - (-25 - 40) * (flatParallax - 1),
    };
    const flatDistance = Math.hypot(flatPoint.x - gridPoint.x, flatPoint.y - gridPoint.y);
    expect(correctedDistance).toBeLessThan(flatDistance);

    target.vertices[0].x += 100;
    target.vertices[0].y += 100;
    expect(source.vertices[0]).toMatchObject(authoredPosition);
  });

  it('keeps the snapped visual position stable when applying a new parallax', () => {
    const fixture = createSceneFixture();
    const source = addQuad(fixture, 'source');
    source.vertices[0] = { x: 90, y: 40, p: 1 };
    fixture.scene.camera.x = 30;
    fixture.scene.camera.y = 20;
    fixture.scene.camera.zoom = 1;

    vi.spyOn(EditorSnappingSystem, 'snapVertex').mockReturnValue({
      x: 100,
      y: 50,
      binding: null,
      p: 2,
    });

    const editor = {
      enabled: true,
      selectedObject: source,
      lastMousePos: { x: 0, y: 0 },
      game: {
        ...fixture.game,
        canvas: {
          width: 800,
          height: 600,
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
        },
        sceneManager: fixture.game.sceneManager,
      },
      selectionManager: {
        hasMultiSelection: () => false,
      },
    };

    const manager = new EditorTransformManager(editor as any);
    manager.isDragging = true;
    manager.draggingVertexIndex = 0;

    manager.onMouseMove({
      clientX: 400,
      clientY: 300,
      shiftKey: false,
      altKey: true,
    } as MouseEvent);

    expect(source.vertices[0].p).toBe(2);
    expect(source.vertices[0].x - fixture.scene.camera.x * (source.vertices[0].p - 1)).toBe(100);
    expect(source.vertices[0].y - fixture.scene.camera.y * (source.vertices[0].p - 1)).toBe(50);
  });

  it('does not replace an existing vertex binding when snapping to a grid node', () => {
    const fixture = createSceneFixture();
    const source = addQuad(fixture, 'source');
    const oldTarget = addQuad(fixture, 'old-target');
    const grid = addQuad(fixture, 'grid');
    grid.isGrid = true;
    source.vertices[0].binding = { targetName: oldTarget.name, type: 'vertex', index: 0 };
    oldTarget.vertices[0].binding = { targetName: source.name, type: 'vertex', index: 0 };

    const editor = {
      enabled: true,
      selectedObject: source,
      game: { ...fixture.game, sceneManager: fixture.game.sceneManager },
    };
    const manager = new EditorTransformManager(editor as any);
    manager.draggingVertexIndex = 0;
    const gridBinding = { targetName: grid.name, type: 'grid' as const, gridU: 0.5, gridV: 0.5 };
    manager.currentSnapBinding = gridBinding;
    useEditorStore.getState().selectVertex(0);

    manager.onMouseUp({} as MouseEvent);
    source.update(0);

    expect(source.vertices[0].binding).toEqual({
      targetName: oldTarget.name,
      type: 'vertex',
      index: 0,
    });
    expect(oldTarget.vertices[0].binding).toEqual({
      targetName: source.name,
      type: 'vertex',
      index: 0,
    });
  });

  it('applies a new binding to every vertex in the connected group', () => {
    const fixture = createSceneFixture();
    const group = [0, 1, 2, 3].map((i) => addQuad(fixture, `group-${i}`));
    const target = addQuad(fixture, 'target');
    for (let i = 0; i < group.length - 1; i++) {
      group[i].vertices[0].binding = {
        targetName: group[i + 1].name,
        type: 'vertex',
        index: 0,
      };
    }

    const editor = {
      enabled: true,
      selectedObject: group[0],
      game: { ...fixture.game, sceneManager: fixture.game.sceneManager },
    };
    const manager = new EditorTransformManager(editor as any);
    const targetBinding = { targetName: target.name, type: 'vertex' as const, index: 0 };
    manager.draggingVertexIndex = 0;
    manager.currentSnapBinding = targetBinding;
    useEditorStore.getState().selectVertex(0);

    manager.onMouseUp({} as MouseEvent);

    for (const quad of group) expect(quad.vertices[0].binding).toEqual(targetBinding);
  });

  it('allows several vertices to bind to the same Quad vertex', () => {
    const fixture = createSceneFixture();
    const first = addQuad(fixture, 'first');
    const second = addQuad(fixture, 'second');
    const target = addQuad(fixture, 'target');
    const editor = {
      enabled: true,
      selectedObject: first,
      game: { ...fixture.game, sceneManager: fixture.game.sceneManager },
    };
    const manager = new EditorTransformManager(editor as any);
    const bindToTarget = { targetName: target.name, type: 'vertex' as const, index: 0 };

    manager.draggingVertexIndex = 0;
    manager.currentSnapBinding = bindToTarget;
    useEditorStore.getState().selectVertex(0);
    manager.onMouseUp({} as MouseEvent);

    editor.selectedObject = second;
    manager.draggingVertexIndex = 0;
    manager.currentSnapBinding = bindToTarget;
    useEditorStore.getState().selectVertex(0);
    manager.onMouseUp({} as MouseEvent);

    expect(first.vertices[0].binding).toEqual(bindToTarget);
    expect(second.vertices[0].binding).toEqual(bindToTarget);
    expect(target.vertices[0].binding).toBeUndefined();
  });

  it('ignores vertices that belong to the moving connected group', () => {
    const fixture = createSceneFixture();
    const source = addQuad(fixture, 'source');
    const oldTarget = addQuad(fixture, 'group-2');
    const group3 = addQuad(fixture, 'group-3');
    const group4 = addQuad(fixture, 'group-4');
    const external = addQuad(fixture, 'external');
    source.vertices[0].binding = { targetName: oldTarget.name, type: 'vertex', index: 0 };
    oldTarget.vertices[0].binding = { targetName: group3.name, type: 'vertex', index: 0 };
    group3.vertices[0].binding = { targetName: group4.name, type: 'vertex', index: 0 };
    oldTarget.vertices[0] = {
      x: 20,
      y: 20,
      p: 1,
      binding: { targetName: group3.name, type: 'vertex', index: 0 },
    };
    group3.vertices[0] = {
      x: 20,
      y: 20,
      p: 1,
      binding: { targetName: group4.name, type: 'vertex', index: 0 },
    };
    group4.vertices[0] = { x: 20, y: 20, p: 1 };
    external.vertices[0] = { x: 20, y: 20, p: 1 };

    const result = EditorSnappingSystem.snapVertex(
      { x: 20, y: 20 },
      source.vertices,
      0,
      fixture.scene,
      0,
      0,
      true,
      source,
      false,
      true,
      1,
      new Set(['source:0', 'group-2:0', 'group-3:0', 'group-4:0'])
    );

    expect(result.binding).toEqual({ targetName: external.name, type: 'vertex', index: 0 });
  });
});

describe('Editor parallax entity hit testing', () => {
  it('finds entities at their rendered screen position when parallax differs from 1', () => {
    const fixture = createSceneFixture();
    fixture.scene.camera.x = 200;
    fixture.scene.camera.y = 100;
    fixture.scene.camera.zoom = 1;

    const entity = fixture.addEntity('near_entity');
    entity.x = 300;
    entity.y = 180;
    entity.width = 40;
    entity.height = 60;
    entity.parallax = 1.6;

    const editor = { enabled: true, game: fixture.game };
    const manager = new EditorTransformManager(editor as any);
    const screenPos = {
      x: entity.x - fixture.scene.camera.x * entity.parallax + 400,
      y: entity.y - fixture.scene.camera.y * entity.parallax + 300,
    };

    const hit = (manager as any).findHitSelectable(
      screenPos,
      fixture.scene,
      fixture.scene.camera.x,
      fixture.scene.camera.y,
      fixture.scene.camera.zoom,
      400,
      300
    );

    expect(hit).toBe(entity);
  });

  it('uses the shared hit resolver for a regular click', () => {
    const fixture = createSceneFixture();
    const visible = fixture.addEntity('visible');
    const hidden = fixture.addEntity('hidden');
    (hidden as any).box3dHidden = true;
    const selectObject = vi.fn();
    const editor: any = {
      enabled: true,
      game: fixture.game,
      selectedObject: null,
      selectionManager: { hasMultiSelection: () => false },
      selectObject,
    };
    const manager = new EditorTransformManager(editor);
    vi.spyOn(manager as any, 'getMousePos').mockReturnValue({ x: 400, y: 300 });
    vi.spyOn(manager as any, 'findHitSelectable').mockReturnValue(visible);
    const hiddenHit = vi.spyOn(hidden, 'hitTest').mockReturnValue(true);

    manager.onMouseDown({ button: 0, ctrlKey: false, stopPropagation: vi.fn() } as any);

    expect(selectObject).toHaveBeenCalledWith(visible);
    expect(hiddenHit).not.toHaveBeenCalled();
  });

  it('keeps culled Box3D faces available to marquee selection', () => {
    const fixture = createSceneFixture();
    const face = addQuad(fixture, 'back-face');
    face.vertices = [
      { x: 0, y: 0, p: 1 },
      { x: 10, y: 0, p: 1 },
      { x: 10, y: 10, p: 1 },
      { x: 0, y: 10, p: 1 },
    ];
    face.box3dHidden = true;
    face.box3dCameraProjected = true;
    const manager = new EditorTransformManager({ enabled: true, game: fixture.game } as any);

    const selected = (manager as any).collectObjectsInScreenRect(
      fixture.scene,
      { l: 395, t: 295, r: 415, b: 315 },
      0,
      0,
      1,
      400,
      300
    );

    expect(selected).toContain(face);
  });

  it('selects a managed face parent on Ctrl-click and drags a selected Box3D', async () => {
    const { Box3DObject } = await import('../../src/entities/Box3DObject');
    const fixture = createSceneFixture();
    Object.assign(fixture.game.canvas, { width: 800, height: 600 });
    const box = new Box3DObject(fixture.game, 'box');
    box.rotationX = 0;
    box.rotationY = 0;
    const face = addQuad(fixture, 'box_face_2');
    face.box3dFaceIndex = 2;
    face.spatial = { parentNodeId: box.name, relation: 'in' };
    fixture.scene.entities.unshift(box as any);
    box.syncFaces(fixture.scene);
    const selectObject = vi.fn();
    const editor: any = {
      enabled: true,
      game: fixture.game,
      selectedObject: null,
      selectionManager: { hasMultiSelection: () => false },
      selectObject,
      saveUndoState: vi.fn(),
      updateUIFromObject: vi.fn(),
    };
    const manager = new EditorTransformManager(editor);
    vi.spyOn(manager as any, 'findHitSelectable').mockReturnValue(face);
    vi.spyOn(manager, 'getMousePos').mockReturnValue({ x: 400, y: 300 });

    manager.onMouseDown({ button: 0, ctrlKey: true, stopPropagation: vi.fn() } as any);
    expect(selectObject).toHaveBeenCalledWith(box);

    editor.selectedObject = box;
    (manager.getMousePos as any)
      .mockReturnValueOnce({ x: 400, y: 300 })
      .mockReturnValueOnce({ x: 420, y: 310 })
      .mockReturnValueOnce({ x: 420, y: 310 });
    manager.onMouseDown({
      button: 0,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as any);
    manager.onMouseMove({ clientX: 420, clientY: 310 } as any);

    expect(box.x).toBeCloseTo(20);
    expect(box.y).toBeCloseTo(10);
  });
});
