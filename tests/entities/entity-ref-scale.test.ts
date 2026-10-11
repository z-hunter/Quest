import { describe, expect, it, vi } from 'vitest';
import { Entity } from '../../src/entities/Entity';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('Entity refScale', () => {
  it('serializes refScale and restores legacy objects from modelScale', () => {
    const fixture = createSceneFixture();
    const entity = new Entity(fixture.game, 0, 0, 10, 10, 'item');
    entity.refScale = 0.75;

    expect(entity.toJSON().refScale).toBe(0.75);

    const legacy = Entity.fromJSON(fixture.game, {
      type: 'Entity',
      name: 'legacy',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      spriteName: null,
      color: '#fff',
      scale: 0.5,
      modelScale: 0.6,
      layer: 0,
    });

    expect(legacy.refScale).toBe(0.6);
  });

  it('applies refScale directly to modelScale and final scale', () => {
    const fixture = createSceneFixture();
    fixture.scene.scaling = { ...fixture.scene.scaling, enabled: false, correctionalScale: 1.5 };
    const entity = new Entity(fixture.game, 0, 0, 10, 10, 'item');
    entity.refScale = 0.8;
    fixture.scene.addEntity(entity);

    entity.applySceneCorrectionalScale(fixture.scene);

    expect(entity.modelScale).toBeCloseTo(0.8);
    expect(entity.scale).toBeCloseTo(0.8);
  });

  it('renders and serializes both sprite flip axes', () => {
    const fixture = createSceneFixture();
    const entity = new Entity(fixture.game, 20, 30, 10, 10, 'item');
    const image = { complete: true, naturalWidth: 16 } as HTMLImageElement;
    entity.image = image;
    entity.animator = { getCurrentFrame: () => ({ x: 0, y: 0, w: 16, h: 16 }) } as any;
    entity.flipX = true;
    entity.flipY = true;

    const ctx = {
      canvas: { width: 800, height: 600 },
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      filter: '',
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    entity.render(ctx);

    expect(ctx.scale).toHaveBeenCalledWith(-1, -1);
    expect(ctx.drawImage).toHaveBeenCalledWith(image, 0, 0, 16, 16, -5, -5, 10, 10);
    expect(entity.toJSON()).toMatchObject({ flipX: true, flipY: true });
  });
});
