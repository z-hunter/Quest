import { afterEach, describe, expect, it, vi } from 'vitest';

import { QuadObject } from '../../src/entities/QuadObject';
import { EditorSnappingSystem } from '../../src/tools/editor/EditorSnappingSystem';
import { EditorTransformManager } from '../../src/tools/editor/EditorTransformManager';
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

  it('adopts interpolated target parallax when Alt-snapping to a quad grid node', () => {
    const fixture = createSceneFixture();
    const source = addQuad(fixture, 'source');
    const target = addQuad(fixture, 'target');
    target.isGrid = true;
    target.gridLinesX = 1;
    target.gridLinesY = 1;
    target.vertices = [
      { x: 0, y: 0, p: 1 },
      { x: 100, y: 0, p: 3 },
      { x: 100, y: 100, p: 5 },
      { x: 0, y: 100, p: 7 },
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

    expect(result.binding).toEqual({ targetName: 'target', type: 'grid', gridU: 0.5, gridV: 0.5 });
    expect(result.p).toBe(4);
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
});
