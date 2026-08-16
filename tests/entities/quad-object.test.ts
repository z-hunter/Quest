import { describe, expect, it, vi } from 'vitest';
import {
  buildQuadTextureMesh,
  createQuadHomography,
  isQuadNearlyAffine,
  projectQuadGridPoint,
  projectQuadPoint,
  QuadObject,
} from '../../src/entities/QuadObject';
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
    clip: vi.fn(),
    transform: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    getTransform: vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1 })),
    fill: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

function createLayerContext() {
  return {
    filter: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    transform: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe('QuadObject', () => {
  it('does not cull a global-parallax Quad that is visible through the outer renderer transform', () => {
    const fixture = createSceneFixture();
    fixture.scene.camera.x = 1000;
    fixture.scene.camera.y = 500;
    fixture.scene.camera.zoom = 1;

    const quad = new QuadObject(fixture.game, 'far-parallax-quad');
    quad.parallax = 0.5;
    quad.filled = true;
    // After SceneRenderer's outer -camera * P transform this Quad appears at
    // x=0..100, y=0..100. Its inner coordinates alone are far from camera.
    quad.vertices = [
      { x: 500, y: 250, p: 1 },
      { x: 600, y: 250, p: 1 },
      { x: 600, y: 350, p: 1 },
      { x: 500, y: 350, p: 1 },
    ];
    fixture.scene.addEntity(quad);

    const ctx = createMockContext();
    quad.render(ctx);

    expect(ctx.fill).toHaveBeenCalledTimes(1);
  });

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

  it('rejects projective perspective for concave, crossed, and collapsed Quads', () => {
    const concave = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 100 },
    ] as const;
    const crossed = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ] as const;
    const collapsed = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 0 },
      { x: 0, y: 100 },
    ] as const;

    for (const points of [concave, crossed, collapsed]) {
      expect(createQuadHomography(...points)).toBeNull();
      const center = projectQuadGridPoint(...points, null, 0.5, 0.5);
      expect(center.x).toBeGreaterThanOrEqual(0);
      expect(center.x).toBeLessThanOrEqual(100);
      expect(center.y).toBeGreaterThanOrEqual(0);
      expect(center.y).toBeLessThanOrEqual(100);
    }
  });

  it('falls back smoothly to bilinear mapping before a visual Quad becomes a sliver', () => {
    const points = [
      { x: 42.983, y: 112.49 },
      { x: 63.983, y: 112.49 },
      { x: 81.936, y: 112.546 },
      { x: -20, y: 113 },
    ] as const;
    const transform = createQuadHomography(...points);
    const projected = projectQuadGridPoint(...points, transform, 0.2884, 0.9664, 1, true, true);
    const bilinear = projectQuadGridPoint(...points, transform, 0.2884, 0.9664, 0, true, true);

    expect(projected).toEqual(bilinear);
  });

  it('fades Retro Grid perspective by visual collapse relative to the authored Quad', () => {
    // This is `floor` from test_t at camera Y=154.287. Its authored shape is
    // broad, but its visual top edge has been pulled down by the P=0.6 camera
    // offset, leaving a 3%-compactness sliver. The old absolute threshold
    // still used roughly 78% projective mapping here, which visibly sheared
    // grid nodes in X before the late fallback began.
    const visual = [
      { x: -37.18849374150989, y: 61.16749457685296 },
      { x: 74.81150625849011, y: 61.16749457685296 },
      { x: 146, y: 71 },
      { x: -110.18849374150989, y: 73.4526945768529 },
    ] as const;
    const authoredCompactness = 0.20408887721916238;
    const transform = createQuadHomography(...visual);
    const legacy = projectQuadGridPoint(...visual, transform, 0.5, 0.5, 1, true, true);
    const adaptive = projectQuadGridPoint(
      ...visual,
      transform,
      0.5,
      0.5,
      1,
      true,
      true,
      authoredCompactness
    );
    const bilinear = projectQuadGridPoint(...visual, transform, 0.5, 0.5, 0, true, true);
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);

    expect(distance(adaptive, bilinear)).toBeLessThan(distance(legacy, bilinear) * 0.1);
  });

  it('starts the lateral-shift correction as soon as the visual Quad compresses', () => {
    const authored = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 120, y: 100 },
      { x: -20, y: 100 },
    ] as const;
    const visual = authored.map((point) => ({ ...point, y: point.y === 0 ? 25 : point.y }));
    const transform = createQuadHomography(...visual);
    const authoredCompactness = 12000 / 19600;
    const fullProjection = projectQuadGridPoint(...visual, transform, 0.3, 0.6, 1, true, true);
    const corrected = projectQuadGridPoint(
      ...visual,
      transform,
      0.3,
      0.6,
      1,
      true,
      true,
      authoredCompactness
    );
    const bilinear = projectQuadGridPoint(...visual, transform, 0.3, 0.6, 0, true, true);
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);

    expect(distance(corrected, bilinear)).toBeLessThan(distance(fullProjection, bilinear));
  });

  it('keeps perspective for an authored Quad that is already equally thin', () => {
    const points = [
      { x: -37.18849374150989, y: 61.16749457685296 },
      { x: 74.81150625849011, y: 61.16749457685296 },
      { x: 146, y: 71 },
      { x: -110.18849374150989, y: 73.4526945768529 },
    ] as const;
    const transform = createQuadHomography(...points);
    const authoredCompactness = 0.030999467267023437;
    const adaptive = projectQuadGridPoint(
      ...points,
      transform,
      0.5,
      0.5,
      1,
      true,
      true,
      authoredCompactness
    );

    const projected = projectQuadPoint(transform!, 0.5, 0.5)!;
    expect(adaptive).toMatchObject({
      x: expect.closeTo(projected.x, 10),
      y: expect.closeTo(projected.y, 10),
    });
  });

  it('clips Retro Grid internals to a malformed Quad', () => {
    const fixture = createSceneFixture();
    const quad = new QuadObject(fixture.game, 'crossed_grid_quad');
    quad.vertices = [
      { x: 0, y: 0, p: 1 },
      { x: 160, y: 160, p: 1 },
      { x: 160, y: 0, p: 1 },
      { x: 0, y: 160, p: 1 },
    ];
    quad.isGrid = true;
    quad.gridLinesX = 8;
    quad.gridLinesY = 8;
    fixture.scene.addEntity(quad);

    const ctx = createMockContext();
    quad.render(ctx);

    expect(ctx.clip).toHaveBeenCalledTimes(1);
    for (const call of [...(ctx.moveTo as any).mock.calls, ...(ctx.lineTo as any).mock.calls]) {
      expect(Number.isFinite(call[0])).toBe(true);
      expect(Number.isFinite(call[1])).toBe(true);
      expect(Math.abs(call[0])).toBeLessThanOrEqual(160);
      expect(Math.abs(call[1])).toBeLessThanOrEqual(160);
    }
  });

  it('serializes textured Quad settings alongside the existing visual properties', () => {
    const fixture = createSceneFixture();
    const quad = new QuadObject(fixture.game, 'test_quad');
    quad.isGrid = true;
    quad.perspective = true;
    quad.perspectiveAmount = 1.5;
    quad.spriteName = 'floors/metal.json';
    quad.flipX = true;
    quad.flipY = true;
    quad.receive3DParallax = true;
    quad.textureMode = 'tile';
    quad.tileScaleX = 0.5;
    quad.tileScaleY = 0.25;
    quad.filled = true;
    quad.checkerboard = true;
    quad.secondColor = '#ff0000';

    const json = quad.toJSON();
    expect(json.perspective).toBe(true);
    expect(json.perspectiveAmount).toBe(1.5);
    expect(json.spriteName).toBe('floors/metal.json');
    expect(json.flipX).toBe(true);
    expect(json.flipY).toBe(true);
    expect(json.receive3DParallax).toBe(true);
    expect(json.textureMode).toBe('tile');
    expect(json.tileScaleX).toBe(0.5);
    expect(json.tileScaleY).toBe(0.25);
    expect(json.gridPerspective).toBeUndefined();
    expect(json.texturePerspective).toBeUndefined();
    expect(json.checkerboard).toBe(true);
    expect(json.secondColor).toBe('#ff0000');

    (fixture.game.assets as any).loadSprite = vi.fn().mockResolvedValue({
      json: { x: 0, y: 0, width: 16, height: 16, frames: 1 },
      image: { complete: true },
    });
    const loadedQuad = QuadObject.fromJSON(fixture.game, json);
    expect(loadedQuad.perspective).toBe(true);
    expect(loadedQuad.perspectiveAmount).toBe(1.5);
    expect(loadedQuad.spriteName).toBe('floors/metal.json');
    expect(loadedQuad.flipX).toBe(true);
    expect(loadedQuad.flipY).toBe(true);
    expect(loadedQuad.receive3DParallax).toBe(true);
    expect(loadedQuad.textureMode).toBe('tile');
    expect(loadedQuad.tileScaleX).toBe(0.5);
    expect(loadedQuad.tileScaleY).toBe(0.25);
    expect(loadedQuad.gridPerspective).toBeUndefined();
    expect(loadedQuad.texturePerspective).toBeUndefined();
    expect(loadedQuad.checkerboard).toBe(true);
    expect(loadedQuad.secondColor).toBe('#ff0000');

    const legacyJson = { ...json };
    delete legacyJson.perspective;
    delete legacyJson.perspectiveAmount;
    legacyJson.gridPerspective = false;
    legacyJson.gridPerspectiveAmount = 1.5;
    legacyJson.texturePerspective = true;
    const legacyQuad = QuadObject.fromJSON(fixture.game, legacyJson);
    expect(legacyQuad.perspective).toBe(false);
    expect(legacyQuad.perspectiveAmount).toBe(1.5);
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

  it('builds texture mesh with explicit tile seams and projective positions', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 140, y: 100 },
      { x: -20, y: 100 },
    ] as const;
    const stretch = buildQuadTextureMesh(...points, 'stretch', 1, 1, 0);
    const tiled = buildQuadTextureMesh(...points, 'tile', 0.25, 0.5, 0);
    const projective = buildQuadTextureMesh(...points, 'stretch', 1, 1, 1);

    const coarse = buildQuadTextureMesh(...points, 'stretch', 1, 1, 1, 100);

    expect(stretch[0].points[0]).toEqual(points[0]);
    expect(stretch.length).toBeGreaterThan(1);
    expect(stretch.length).toBeLessThanOrEqual(32);
    expect(coarse).toHaveLength(1);
    expect(tiled.length).toBeGreaterThan(1);
    expect(
      tiled.every((cell) => cell.u0 >= 0 && cell.u1 <= 1 && cell.v0 >= 0 && cell.v1 <= 1)
    ).toBe(true);
    expect(projective[0].center).not.toEqual(stretch[0].center);

    const halfPerspective = buildQuadTextureMesh(...points, 'stretch', 1, 1, 0.5, 100);
    const transform = createQuadHomography(...points);
    expect(halfPerspective[0].center).toEqual(
      projectQuadGridPoint(...points, transform, 0.5, 0.5, 0.5, true, true)
    );
  });

  it('raises the triangle budget only when the normal mesh cannot meet its error target', () => {
    const mesh = buildQuadTextureMesh(
      { x: 0, y: 0 },
      { x: 160, y: 0 },
      { x: 120, y: 160 },
      { x: 40, y: 160 },
      'stretch',
      1,
      1,
      1,
      0.001
    );

    expect(mesh.length).toBeGreaterThan(16);
    expect(mesh.length).toBeLessThanOrEqual(32);
  });

  it('renders the active sprite frame as texture instead of the fill and keeps the grid on top', () => {
    const fixture = createSceneFixture();
    const quad = new QuadObject(fixture.game, 'textured_quad');
    const image = { complete: true } as HTMLImageElement;
    quad.spriteName = 'floors/metal.json';
    quad.image = image;
    quad.animator = { getCurrentFrame: () => ({ x: 4, y: 8, w: 16, h: 16 }) } as any;
    quad.isGrid = true;
    quad.gridLinesX = 1;
    quad.gridLinesY = 1;
    fixture.scene.addEntity(quad);

    const ctx = createMockContext();
    quad.render(ctx);

    expect(ctx.drawImage).toHaveBeenCalledWith(image, 4, 8, 16, 16, 0, 0, 16, 16);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(ctx.fill).not.toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    // Almost-affine Stretch Quads are drawn as one transformed sprite.
    expect(ctx.clip).toHaveBeenCalled();
    expect(ctx.transform).toHaveBeenCalledTimes(1);
  });

  it('flips an affine Quad texture without changing its surface geometry', () => {
    const fixture = createSceneFixture();
    const quad = new QuadObject(fixture.game, 'flipped_textured_quad');
    quad.spriteName = 'floors/metal.json';
    quad.image = { complete: true } as HTMLImageElement;
    quad.animator = { getCurrentFrame: () => ({ x: 0, y: 0, w: 16, h: 16 }) } as any;
    quad.flipX = true;
    quad.flipY = true;
    quad.vertices = [
      { x: 0, y: 0, p: 1 },
      { x: 100, y: 0, p: 1 },
      { x: 100, y: 100, p: 1 },
      { x: 0, y: 100, p: 1 },
    ];
    fixture.scene.addEntity(quad);

    const ctx = createMockContext();
    quad.render(ctx);

    expect(ctx.transform).toHaveBeenCalledWith(-6.25, 0, 0, -6.25, 100, 100);
  });

  it('uses a flat sprite for near-affine Quads and bounded screen-space tessellation otherwise', () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 100, y: 0 };
    const p3 = { x: 0, y: 100 };
    expect(isQuadNearlyAffine(p0, p1, { x: 100.5, y: 100 }, p3, 0.75)).toBe(true);
    expect(isQuadNearlyAffine(p0, p1, { x: 104, y: 100 }, p3, 0.75)).toBe(false);

    const fixture = createSceneFixture();
    const quad = new QuadObject(fixture.game, 'projective_quad');
    const image = { complete: true } as HTMLImageElement;
    quad.spriteName = 'floors/metal.json';
    quad.image = image;
    quad.animator = { getCurrentFrame: () => ({ x: 0, y: 0, w: 16, h: 16 }) } as any;
    quad.vertices = [
      { x: 0, y: 0, p: 1 },
      { x: 160, y: 0, p: 1 },
      { x: 100, y: 160, p: 1 },
      { x: 20, y: 160, p: 1 },
    ];
    fixture.scene.addEntity(quad);

    const ctx = createMockContext();
    quad.render(ctx);

    expect((ctx.drawImage as any).mock.calls.length).toBeGreaterThan(1);
    expect((ctx.drawImage as any).mock.calls.length).toBeLessThanOrEqual(64);
    // Clip vertices are expanded to cover antialias gaps, but the UV transform
    // remains anchored to the original top-left texture vertex.
    expect((ctx.transform as any).mock.calls[0][4]).toBeCloseTo(0);
    expect((ctx.transform as any).mock.calls[0][5]).toBeCloseTo(0);
  });

  it('composites a blurred or transparent texture mesh once after drawing its triangles into a layer', () => {
    const fixture = createSceneFixture();
    const quad = new QuadObject(fixture.game, 'layered_projective_quad');
    const image = { complete: true } as HTMLImageElement;
    quad.spriteName = 'floors/metal.json';
    quad.image = image;
    quad.animator = { getCurrentFrame: () => ({ x: 0, y: 0, w: 16, h: 16 }) } as any;
    quad.opacity = 0.5;
    quad.vertices = [
      { x: 0, y: 0, p: 1 },
      { x: 160, y: 0, p: 1 },
      { x: 100, y: 160, p: 1 },
      { x: 20, y: 160, p: 1 },
    ];
    fixture.scene.addEntity(quad);

    const layerCtx = createLayerContext();
    const layerCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => layerCtx),
    } as unknown as HTMLCanvasElement;
    vi.stubGlobal('document', { createElement: vi.fn(() => layerCanvas) });
    const ctx = createMockContext();

    quad.render(ctx);

    expect((layerCtx.drawImage as any).mock.calls.length).toBeGreaterThan(1);
    expect(ctx.drawImage).toHaveBeenCalledWith(layerCanvas, 0, 0);
    vi.unstubAllGlobals();
  });

  it('keeps visual vertices fixed when its global parallax changes', () => {
    const fixture = createSceneFixture();
    fixture.scene.camera.x = 80;
    fixture.scene.camera.y = 120;
    const quad = new QuadObject(fixture.game, 'parallax_quad');
    quad.vertices = [
      { x: 10, y: 20, p: 0.5 },
      { x: 110, y: 20, p: 0.75 },
      { x: 110, y: 120, p: 1 },
      { x: 10, y: 120, p: 0.5 },
    ];
    fixture.scene.addEntity(quad);
    // SceneRenderer applies the Quad's global P after Quad.render(), so this
    // is the final coordinate that reaches the canvas rather than the
    // intermediate coordinate returned by getVisualVertices().
    const screenVertices = () =>
      quad.getVisualVertices().map((vertex) => ({
        x: vertex.x - fixture.scene.camera.x * quad.parallax,
        y: vertex.y - fixture.scene.camera.y * quad.parallax,
      }));
    const visualBefore = screenVertices();

    quad.setParallaxPreservingVisualPosition(0.6);

    expect(screenVertices()).toEqual(visualBefore);
    expect(quad.parallax).toBe(0.6);
  });

  it('keeps a bound vertex visually fixed after its source global parallax changes', () => {
    const fixture = createSceneFixture();
    fixture.scene.camera.x = 80;
    fixture.scene.camera.y = 120;
    const target = new QuadObject(fixture.game, 'target');
    target.vertices[0] = { x: 10, y: 20, p: 0.5 };
    const source = new QuadObject(fixture.game, 'source');
    source.vertices[0] = {
      x: 10,
      y: 20,
      p: 0.5,
      binding: { targetName: 'target', type: 'vertex', index: 0 },
    };
    fixture.scene.addEntity(target);
    fixture.scene.addEntity(source);
    source.update(0);
    const screenVertex = () => {
      const vertex = source.getVisualVertices()[0];
      return {
        x: vertex.x - fixture.scene.camera.x * source.parallax,
        y: vertex.y - fixture.scene.camera.y * source.parallax,
      };
    };
    const visualBefore = screenVertex();

    source.setParallaxPreservingVisualPosition(0.6);
    source.update(0);

    expect(screenVertex()).toEqual(visualBefore);
    expect(source.parallax).toBe(0.6);
  });

  it('edits a bound vertex through its connected group', () => {
    const fixture = createSceneFixture();
    fixture.scene.camera.x = 80;
    fixture.scene.camera.y = 120;

    // Keep the source first: this is the update order that used to overwrite
    // a property-panel edit before its target had been updated.
    const source = new QuadObject(fixture.game, 'source');
    source.parallax = 1;
    source.vertices[0] = {
      x: 10,
      y: 20,
      p: 0.5,
      binding: { targetName: 'target', type: 'vertex', index: 0 },
    };
    const target = new QuadObject(fixture.game, 'target');
    target.parallax = 0.5;
    target.vertices[0] = { x: 10, y: 20, p: 1 };
    fixture.scene.addEntity(source);
    fixture.scene.addEntity(target);

    expect(source.setVertex(0, 30, 40)).toBe(true);

    expect(target.vertices[0].x).toBe(30);
    expect(target.vertices[0].y).toBe(40);
    expect(source.vertices[0].x).toBeCloseTo(30, 6);
    expect(source.vertices[0].y).toBeCloseTo(40, 6);

    // P edits preserve the current screen position, so authored coordinates
    // shift by the camera delta while the effective P stays synchronized.
    expect(source.setVertex(0, undefined, undefined, 0.8, true)).toBe(true);
    expect(target.vertices[0].x).toBeCloseTo(54, 6);
    expect(target.vertices[0].y).toBeCloseTo(76, 6);
    expect(target.vertices[0].p).toBeCloseTo(1.6, 6);
    expect(source.vertices[0].x).toBeCloseTo(54, 6);
    expect(source.vertices[0].y).toBeCloseTo(76, 6);
    expect(source.vertices[0].p).toBeCloseTo(0.8, 6);

    source.update(0);
    expect(source.vertices[0].x).toBeCloseTo(54, 6);
    expect(source.vertices[0].y).toBeCloseTo(76, 6);
    expect(source.vertices[0].p).toBeCloseTo(0.8, 6);
  });
});
