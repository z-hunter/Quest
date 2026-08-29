import { describe, expect, it, vi } from 'vitest';

import { QuadObject } from '../../src/entities/QuadObject';
import { Entity } from '../../src/entities/Entity';
import { Box3DObject, createBox3DSurfaceAnchor } from '../../src/entities/Box3DObject';
import {
  compareEntitiesForRender,
  getEntityRenderSortY,
  SceneRenderer,
} from '../../src/graphics/SceneRenderer';
import { createSceneFixture } from '../fixtures/sceneFactory';

function createMockContext(canvas = { width: 800, height: 600 }) {
  return {
    canvas,
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
    translate: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    transform: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getTransform: vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1 })),
    fill: vi.fn(),
    fillRect: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe('SceneRenderer Quad depth sorting', () => {
  it('reuses a bitmap for unchanged Box3D fragments', () => {
    const fixture = createSceneFixture();
    const box = new Box3DObject(fixture.game, 'box');
    const faces = Array.from({ length: 6 }, (_, index) => {
      const face = new QuadObject(fixture.game, `box_face_${index}`);
      face.box3dFaceIndex = index;
      face.spatial = { parentNodeId: box.name, relation: 'in' };
      return face;
    });
    fixture.scene.addEntity(box as any);
    faces.forEach((face) => fixture.scene.addEntity(face));

    const target = createMockContext();
    const back = createMockContext();
    const front = createMockContext();
    const canvases = [
      { width: 0, height: 0, getContext: vi.fn(() => back) },
      { width: 0, height: 0, getContext: vi.fn(() => front) },
    ] as unknown as HTMLCanvasElement[];
    vi.stubGlobal('document', { createElement: vi.fn(() => canvases.shift()) });
    try {
      const renderer = new SceneRenderer(fixture.game);
      renderer.render(target, fixture.scene);
      renderer.render(target, fixture.scene);
      expect(back.fill).toHaveBeenCalledTimes(6);
      expect(front.fill).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('draws a surface-bound Entity between cached Box3D bitmap layers', () => {
    const fixture = createSceneFixture();
    const box = new Box3DObject(fixture.game, 'box');
    const faces = Array.from({ length: 6 }, (_, index) => {
      const face = new QuadObject(fixture.game, `box_face_${index}`);
      face.box3dFaceIndex = index;
      face.spatial = { parentNodeId: box.name, relation: 'in' };
      return face;
    });
    fixture.scene.addEntity(box as any);
    faces.forEach((face) => fixture.scene.addEntity(face));
    box.syncFaces(fixture.scene);
    const prop = new Entity(fixture.game, 0, 0, 20, 20, 'prop');
    fixture.scene.addEntity(prop);
    (prop as any).__box3dSurfaceAnchor = createBox3DSurfaceAnchor(
      fixture.scene,
      faces[2],
      prop,
      0.5,
      0.5
    );

    const target = createMockContext();
    const back = createMockContext();
    const front = createMockContext();
    const canvases = Array.from(
      { length: 6 },
      (_, index) =>
        ({
          width: 0,
          height: 0,
          getContext: vi.fn(() => (index % 2 ? front : back)),
        }) as HTMLCanvasElement
    );
    vi.stubGlobal('document', { createElement: vi.fn(() => canvases.shift()) });
    try {
      const renderer = new SceneRenderer(fixture.game);
      renderer.render(target, fixture.scene);
      const cachedStaticDraws =
        (back.fill as any).mock.calls.length + (front.fill as any).mock.calls.length;
      const liveEntityDraws = (target.fillRect as any).mock.calls.length;
      renderer.render(target, fixture.scene);
      expect(cachedStaticDraws).toBeGreaterThan(0);
      expect((back.fill as any).mock.calls.length + (front.fill as any).mock.calls.length).toBe(
        cachedStaticDraws
      );
      expect((target.fillRect as any).mock.calls.length).toBe(liveEntityDraws * 2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('batches consecutive compatible blurred screen Quads into one final composite', () => {
    const fixture = createSceneFixture();
    const first = new QuadObject(fixture.game, 'first');
    const second = new QuadObject(fixture.game, 'second');
    for (const quad of [first, second]) {
      quad.blur = 2;
      quad.opacity = 0.95;
      quad.blendMode = 'screen';
      quad.isGrid = false;
      fixture.scene.addEntity(quad);
    }

    const target = createMockContext();
    const layer = createMockContext();
    const batchCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => layer),
    } as unknown as HTMLCanvasElement;
    vi.stubGlobal('document', { createElement: vi.fn(() => batchCanvas) });
    try {
      new SceneRenderer(fixture.game).render(target, fixture.scene);

      expect(layer.fill).toHaveBeenCalledTimes(2);
      expect(target.drawImage).toHaveBeenCalledTimes(1);
      expect(target.filter).toBe('blur(2px)');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps textured Quad seam compositing inside one shared blur batch', () => {
    const fixture = createSceneFixture();
    for (const name of ['first_texture', 'second_texture']) {
      const quad = new QuadObject(fixture.game, name);
      quad.blur = 2;
      quad.opacity = 0.95;
      quad.blendMode = 'screen';
      quad.spriteName = `${name}.json`;
      quad.image = { complete: true } as HTMLImageElement;
      quad.animator = { getCurrentFrame: () => ({ x: 0, y: 0, w: 16, h: 16 }) } as any;
      fixture.scene.addEntity(quad);
    }

    const target = createMockContext();
    const batch = createMockContext();
    const textureLayer = createMockContext();
    const batchCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => batch),
    } as unknown as HTMLCanvasElement;
    const textureCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => textureLayer),
    } as unknown as HTMLCanvasElement;
    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValueOnce(batchCanvas).mockReturnValue(textureCanvas),
    });
    try {
      new SceneRenderer(fixture.game).render(target, fixture.scene);

      expect(textureLayer.drawImage).toHaveBeenCalledTimes(2);
      expect(batch.drawImage).toHaveBeenCalledTimes(2);
      expect(target.drawImage).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('defaults Entity sorting to rendered Y and can sort an Entity by parallax', () => {
    const fixture = createSceneFixture();
    const far = fixture.addEntity('far');
    far.layer = 0;
    far.parallax = 0.4;
    far.y = 900;

    const near = fixture.addEntity('near');
    near.layer = 0;
    near.parallax = 0.8;
    near.y = -900;

    expect(compareEntitiesForRender(far, near, fixture.scene.camera)).toBeGreaterThan(0);
    far.depthSortMode = 'parallax';
    expect(compareEntitiesForRender(far, near, fixture.scene.camera)).toBeLessThan(0);
  });

  it('keeps same-Layer Entity scene order when either uses manual sorting', () => {
    const fixture = createSceneFixture();
    const manual = fixture.addEntity('manual');
    const byY = fixture.addEntity('by_y');
    manual.layer = byY.layer = 0;
    manual.y = 900;
    byY.y = -900;
    manual.depthSortMode = 'manual';

    expect(compareEntitiesForRender(manual, byY, fixture.scene.camera)).toBe(0);
  });

  it('orders same-layer objects around the selected Quad depth anchor using its rendered parallax', () => {
    const fixture = createSceneFixture();
    fixture.scene.camera.y = 200;

    const quad = new QuadObject(fixture.game, 'depth_quad');
    quad.layer = 0;
    quad.parallax = 0.5;
    quad.sortMode = 'v3';
    quad.vertices[3] = { x: 0, y: 200, p: 1 };

    const behind = fixture.addEntity('behind');
    behind.layer = 0;
    behind.parallax = 1;
    behind.y = 250;

    const inFront = fixture.addEntity('in_front');
    inFront.layer = 0;
    inFront.parallax = 1;
    inFront.y = 350;

    // The Quad's rendered anchor is 200 - 200 * (0.5 - 1) = 300.
    expect(getEntityRenderSortY(quad, fixture.scene.camera)).toBe(300);
    expect(compareEntitiesForRender(behind, quad, fixture.scene.camera)).toBeLessThan(0);
    expect(compareEntitiesForRender(quad, inFront, fixture.scene.camera)).toBeLessThan(0);
  });

  it('keeps manual Quad order behind sorted same-layer objects', () => {
    const fixture = createSceneFixture();
    const quad = new QuadObject(fixture.game, 'manual_quad');
    quad.layer = 0;
    quad.sortMode = 'ignore';
    const entity = fixture.addEntity('entity');
    entity.layer = 0;

    expect(getEntityRenderSortY(quad, fixture.scene.camera)).toBeNull();
    expect(compareEntitiesForRender(quad, entity, fixture.scene.camera)).toBeLessThan(0);
  });

  it('orders an equal-layer Quad by its global parallax when requested', () => {
    const fixture = createSceneFixture();
    const quad = new QuadObject(fixture.game, 'parallax_quad');
    quad.layer = 0;
    quad.parallax = 0.6;
    quad.sortMode = 'parallax';

    const behind = fixture.addEntity('behind');
    behind.layer = 0;
    behind.parallax = 0.4;
    behind.y = 900;

    const inFront = fixture.addEntity('in_front');
    inFront.layer = 0;
    inFront.parallax = 0.8;
    inFront.y = -900;

    expect(compareEntitiesForRender(behind, quad, fixture.scene.camera)).toBeLessThan(0);
    expect(compareEntitiesForRender(quad, inFront, fixture.scene.camera)).toBeLessThan(0);
  });
});
