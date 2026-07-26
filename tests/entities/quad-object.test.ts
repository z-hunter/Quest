import { describe, expect, it, vi } from 'vitest';
import { QuadObject, getPerspectiveT } from '../../src/entities/QuadObject';
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

  it('calculates getPerspectiveT correctly with ratio and amount blending', () => {
    // Rectangle: equal edge lengths -> linear parameter t
    expect(getPerspectiveT(0.5, 100, 100, 1.0)).toBe(0.5);

    // Amount = 0 -> linear parameter t
    expect(getPerspectiveT(0.5, 50, 100, 0.0)).toBe(0.5);

    // Narrower top edge (50 vs 100) -> perspective pulls t closer to 0 (top)
    const tPersp = getPerspectiveT(0.5, 50, 100, 1.0);
    expect(tPersp).toBeLessThan(0.5);
    expect(tPersp).toBeCloseTo(1 / 3, 4); // 0.5 / (0.5 + 0.5 * 2) = 1/3

    // Amount = 2.0 (exaggerated effect)
    const tExaggerated = getPerspectiveT(0.5, 50, 100, 2.0);
    expect(tExaggerated).toBeLessThan(tPersp);
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
