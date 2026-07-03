import { describe, expect, it } from 'vitest';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('Scene correctional scale', () => {
  it('scales entity positions and scale basis around the shared center', () => {
    const fixture = createSceneFixture();
    fixture.scene.scaling = { ...fixture.scene.scaling, enabled: false, correctionalScale: 1 };
    const left = fixture.addEntity('left');
    const right = fixture.addEntity('right');
    left.x = 0;
    left.y = 0;
    left.refScale = 0.5;
    right.x = 10;
    right.y = 0;
    right.refScale = 1;

    fixture.scene.applyCorrectionalScaleChange(2);

    expect(left.x).toBe(-5);
    expect(right.x).toBe(15);
    expect(left.modelScale).toBe(1);
    expect(left.scale).toBe(1);
    expect(right.modelScale).toBe(2);
    expect(right.scale).toBe(2);
  });

  it('scales locked objects together with the rest of the scene', () => {
    const fixture = createSceneFixture();
    fixture.scene.scaling = { ...fixture.scene.scaling, enabled: false, correctionalScale: 1 };
    const locked = fixture.addEntity('locked');
    const free = fixture.addEntity('free');
    locked.x = 0;
    locked.y = 0;
    locked.locked = true;
    free.x = 10;
    free.y = 0;

    const trigger = fixture.addTriggerbox('locked_trigger');
    trigger.locked = true;
    trigger.poly = [
      { x: 20, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 10 },
      { x: 20, y: 10 },
    ];

    fixture.scene.applyCorrectionalScaleChange(2);

    expect(locked.x).toBe(-12);
    expect(free.x).toBe(8);
    expect(trigger.poly).toEqual([
      { x: 28, y: -2 },
      { x: 48, y: -2 },
      { x: 48, y: 18 },
      { x: 28, y: 18 },
    ]);
  });

  it('scales triggerbox polygons with the same correction factor', () => {
    const fixture = createSceneFixture();
    fixture.scene.scaling = { ...fixture.scene.scaling, enabled: false, correctionalScale: 1 };
    const entity = fixture.addEntity('anchor');
    entity.x = 0;
    entity.y = 0;
    const trigger = fixture.addTriggerbox('entry');
    trigger.poly = [
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 10, y: 10 },
    ];

    fixture.scene.applyCorrectionalScaleChange(2);

    expect(trigger.poly).toEqual([
      { x: 13, y: -2 },
      { x: 33, y: -2 },
      { x: 33, y: 18 },
      { x: 13, y: 18 },
    ]);
  });
});
