import { describe, expect, it, vi } from 'vitest';
import { createQuadHomography, projectQuadPoint, QuadObject } from '../../src/entities/QuadObject';
import { createSceneFixture } from '../fixtures/sceneFactory';

function createMockContext() {
  return {
    canvas: { width: 800, height: 600 },
    filter: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe('QuadObject', () => {
  it('draws retro-grid lines with normal composition over blended fill', () => {
    const fixture = createSceneFixture();
    fixture.scene.camera.x = -750;
    fixture.scene.camera.y = -20;
    fixture.scene.camera.zoom = 1;

    const quad = new QuadObject(fixture.game, 'q6-1_1');
    quad.vertices = [
      { x: -796.8195852460148, y: -65.90341133361912, p: 1 },
      { x: -714.8525471439664, y: -86.90681780569503, p: 1 },
      { x: -701.6967016306735, y: 47.52823721138852, p: 1 },
      { x: -804.5997561709523, y: 21.561006682053637, p: 1 },
    ];
    quad.color = '#a01c70';
    quad.blendMode = 'screen';
    quad.isGrid = true;
    quad.gridLinesX = 2;
    quad.gridLinesY = 2;
    quad.lineWidth = 4.9;
    quad.gridColor = '#000000';
    quad.filled = true;
    fixture.scene.addEntity(quad);

    const ctx = createMockContext();
    quad.render(ctx);

    expect(ctx.fill).toHaveBeenCalledTimes(1);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    expect(ctx.globalCompositeOperation).toBe('source-over');
    expect(ctx.strokeStyle).toBe('#000000');
  });

  it('uses converging edges, not opposite edge lengths, for grid perspective', () => {
    // Top/bottom are parallel; the right edge is vertical and the left one is
    // slanted. Therefore vertical grid cuts must stay linearly spaced even
    // though the side edges have different lengths.
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 100, y: 0 };
    const p2 = { x: 100, y: 100 };
    const p3 = { x: -20, y: 100 };
    const transform = createQuadHomography(p0, p1, p2, p3);

    expect(transform).not.toBeNull();
    expect(transform!.g).toBeCloseTo(0);
    expect(projectQuadPoint(transform!, 0.25, 0)).toMatchObject({ x: 25, y: 0 });
    expect(projectQuadPoint(transform!, 0.25, 1)).toMatchObject({ x: expect.closeTo(10), y: 100 });

    // The other pair of edges does converge, so horizontal cuts still receive
    // the appropriate projective spacing.
    expect(transform!.h).not.toBeCloseTo(0);
  });

  it('maps every unit-square corner exactly to its Quad vertex', () => {
    const points = [
      { x: 20, y: 10 },
      { x: 130, y: 30 },
      { x: 110, y: 140 },
      { x: -10, y: 100 },
    ];
    const transform = createQuadHomography(points[0], points[1], points[2], points[3]);

    expect(transform).not.toBeNull();
    for (const [u, v, point] of [
      [0, 0, points[0]],
      [1, 0, points[1]],
      [1, 1, points[2]],
      [0, 1, points[3]],
    ] as const) {
      expect(projectQuadPoint(transform!, u, v)).toMatchObject({
        x: expect.closeTo(point.x),
        y: expect.closeTo(point.y),
      });
    }
  });

  it('serializes and deserializes gridPerspective, gridPerspectiveAmount, checkerboard and secondColor', () => {
    const fixture = createSceneFixture();
    const quad = new QuadObject(fixture.game, 'test_quad');
    quad.isGrid = true;
    quad.gridPerspective = true;
    quad.gridPerspectiveAmount = 1.5;
    quad.filled = true;
    quad.checkerboard = true;
    quad.secondColor = '#ff0000';

    const json = quad.toJSON();
    expect(json.gridPerspective).toBe(true);
    expect(json.gridPerspectiveAmount).toBe(1.5);
    expect(json.checkerboard).toBe(true);
    expect(json.secondColor).toBe('#ff0000');

    const loadedQuad = QuadObject.fromJSON(fixture.game, json);
    expect(loadedQuad.gridPerspective).toBe(true);
    expect(loadedQuad.gridPerspectiveAmount).toBe(1.5);
    expect(loadedQuad.checkerboard).toBe(true);
    expect(loadedQuad.secondColor).toBe('#ff0000');
  });

  it('draws checkerboard pattern when Retro Grid, filled, and checkerboard are active', () => {
    const fixture = createSceneFixture();
    const quad = new QuadObject(fixture.game, 'checker_quad');
    quad.isGrid = true;
    quad.filled = true;
    quad.checkerboard = true;
    quad.color = '#ffffff';
    quad.secondColor = '#000000';
    quad.gridLinesX = 2; // 3 cols
    quad.gridLinesY = 2; // 3 rows -> 9 total cells (4 filled with secondColor)
    fixture.scene.addEntity(quad);

    const ctx = createMockContext();
    quad.render(ctx);

    // Initial base fill + 4 alternating cells filled with secondColor = 5 fill calls total
    expect(ctx.fill).toHaveBeenCalledTimes(5);
    expect(ctx.fillStyle).toBe('#000000');
  });
});
