import { describe, expect, it } from 'vitest';

import { ComponentSystem } from '../../src/systems/ComponentSystem';
import { QuadObject } from '../../src/entities/QuadObject';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('ShadowSystem', () => {
  it('treats locked trigger entities as valid shadow zones', () => {
    const fixture = createSceneFixture('shadow_scene');
    const room = fixture.addEntity('room');
    room.locked = true;
    room.x = 100;
    room.y = 120;
    room.width = 200;
    room.height = 160;

    const player = fixture.addPlayer('Hero', 100, 100);
    player.components = [
      {
        type: 'Shadow',
        id: 'shadow-comp',
        shadowQuadId: 'shadow',
        offsetX: 0,
        offsetY: 0,
        triggerId: 'room',
      },
    ];

    const shadow = new QuadObject(fixture.game, 'shadow');
    shadow.visible = false;
    shadow.disabled = true;
    fixture.scene.addEntity(shadow);

    ComponentSystem.update(player, 16);

    expect(shadow.disabled).toBe(false);
    expect(shadow.visible).toBe(true);
  });

  it('uses the actual Quad polygon, not the inherited Entity bounds, for shadow zones', () => {
    const fixture = createSceneFixture('shadow_quad_scene');

    const lightspot = new QuadObject(fixture.game, 'lightspot');
    lightspot.groupID = '#lightSpots';
    lightspot.locked = true;
    lightspot.x = -94.35007280706921;
    lightspot.y = 132.21254989539653;
    lightspot.vertices = [
      { x: -139.12445128696197, y: 64.07837041744762, p: 0.64 },
      { x: -12.219765268971267, y: 63.76143450593196, p: 0.64 },
      { x: -106, y: 124, p: 1 },
      { x: -222.8963344900405, y: 123.83466797150467, p: 1 },
    ];
    fixture.scene.addEntity(lightspot);

    const player = fixture.addPlayer('Hero', -30, 70);
    player.components = [
      {
        type: 'Shadow',
        id: 'shadow-comp',
        shadowQuadId: 'shadow',
        offsetX: 0,
        offsetY: 0,
        triggerId: '#lightSpots',
      },
    ];

    const shadow = new QuadObject(fixture.game, 'shadow');
    shadow.visible = false;
    shadow.disabled = true;
    fixture.scene.addEntity(shadow);

    expect(lightspot.hitTest(player.x, player.y)).toBe(true);
    expect(lightspot.containsPoint(player.x, player.y)).toBe(false);

    ComponentSystem.update(player, 16);

    expect(shadow.disabled).toBe(false);
    expect(shadow.visible).toBe(true);
  });
});
