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
});
