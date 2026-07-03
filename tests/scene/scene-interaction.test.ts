import { describe, expect, it } from 'vitest';
import { Entity } from '../../src/entities/Entity';
import { GAME_DESIGN_HEIGHT, GAME_DESIGN_WIDTH } from '../../src/core/Resolution';
import { handleSceneClick } from '../../src/scene/SceneInteraction';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('Scene interaction text layer', () => {
  it('shows the triggerbox title on click when it has TA', () => {
    const fixture = createSceneFixture();
    fixture.addTriggerbox('tb_drawer', {
      title: 'Desk Drawer',
      description: 'A shallow desk drawer.',
    });

    handleSceneClick(fixture.scene, 215, 155);

    expect(fixture.messages.at(-1)).toBe(
      fixture.game.text('engine.click_you_see', { title: 'Desk Drawer' })
    );
  });

  it('uses the actual canvas size for screen-to-world click mapping', () => {
    const fixture = createSceneFixture();
    fixture.game.canvas.width = 640;
    fixture.game.canvas.height = 360;
    fixture.addTriggerbox('tb_center', {
      title: 'Center Trigger',
      description: 'Centered hotspot.',
    });

    handleSceneClick(fixture.scene, 320, 180);

    expect(fixture.messages.at(-1)).toBe(
      fixture.game.text('engine.click_you_see', { title: 'Center Trigger' })
    );
  });

  it('keeps editor-locked top-layer entities interactive at runtime', () => {
    const fixture = createSceneFixture();
    const back = fixture.addTriggerbox('tb_back', {
      title: 'Back Trigger',
      description: 'Behind the ghost.',
    });
    back.layer = 1;

    const ghost = fixture.addEntity('ghost_item', {
      title: 'Ghost Item',
      description: 'Should not intercept clicks.',
    });
    ghost.layer = 2;
    ghost.x = 5;
    ghost.y = 10;
    ghost.locked = true;

    handleSceneClick(fixture.scene, 215, 155);

    expect(fixture.messages.at(-1)).toBe(
      fixture.game.text('engine.click_you_see', { title: 'Ghost Item' })
    );
  });

  it('does not show a hand cursor for State-only script events on entities', () => {
    const fixture = createSceneFixture();
    const tv = fixture.addEntity('tv', {
      title: 'TV',
      description: 'A television.',
      components: [{ type: 'State', id: 'power', valueType: 'string', initialValue: 'off' }],
    });
    tv.interactions = { 'state:power': 'tv_power_changed' };

    expect(fixture.scene.checkHover(GAME_DESIGN_WIDTH / 2, GAME_DESIGN_HEIGHT / 2)).toBeNull();
  });

  it('still shows a hand cursor for click-facing script events on entities', () => {
    const fixture = createSceneFixture();
    const button = fixture.addEntity('button', {
      title: 'Button',
      description: 'A clickable button.',
    });
    button.interactions = { use: 'button_use' };

    expect(fixture.scene.checkHover(GAME_DESIGN_WIDTH / 2, GAME_DESIGN_HEIGHT / 2)).toBe('hand');
  });

  it('hits parallax entities at their rendered screen position', () => {
    const fixture = createSceneFixture();
    fixture.game.canvas.width = 800;
    fixture.game.canvas.height = 600;
    fixture.scene.camera.x = 200;
    fixture.scene.camera.y = 100;

    const entity = fixture.addEntity('near_item', {
      title: 'Near Item',
      description: 'A parallax item.',
    });
    entity.x = 300;
    entity.y = 180;
    entity.width = 40;
    entity.height = 60;
    entity.parallax = 1.6;

    handleSceneClick(
      fixture.scene,
      entity.x - fixture.scene.camera.x * entity.parallax + 400,
      entity.y - fixture.scene.camera.y * entity.parallax + 300
    );

    expect(fixture.messages.at(-1)).toBe(
      fixture.game.text('engine.click_you_see', { title: 'Near Item' })
    );
  });

  it('ignores interaction-locked top-layer entities so clicks pass through to objects below', () => {
    const fixture = createSceneFixture();
    const back = fixture.addTriggerbox('tb_back', {
      title: 'Back Trigger',
      description: 'Behind the ghost.',
    });
    back.layer = 1;

    const ghost = fixture.addEntity('ghost_item', {
      title: 'Ghost Item',
      description: 'Should not intercept clicks.',
    });
    ghost.layer = 2;
    ghost.x = 5;
    ghost.y = 10;
    ghost.interactionLocked = true;

    handleSceneClick(fixture.scene, 215, 155);

    expect(fixture.messages.at(-1)).toBe(
      fixture.game.text('engine.click_you_see', { title: 'Back Trigger' })
    );
  });

  it('ignores untitled technical subscene surfaces so clicks pass through to objects below', () => {
    const fixture = createSceneFixture();
    fixture.scene.activeSubscene = 'DrawerZone';

    const drawerBody = fixture.addTriggerbox('drawer_body', {
      title: 'Middle drawer',
      description: 'The drawer body.',
      components: [{ type: 'Switch', state: 2 }],
    });
    drawerBody.layer = 1;
    fixture.scene.subsceneEntities.add(drawerBody);

    const surface = fixture.addTriggerbox('drawer_surface', {
      title: null,
      description: 'Technical storage surface.',
      components: [{ type: 'Surface', relation: 'in', capacity: 2, items: [] }],
    });
    surface.layer = 4;
    fixture.scene.subsceneEntities.add(surface);

    handleSceneClick(fixture.scene, 215, 155);

    expect(fixture.messages.at(-1)).toBe(
      fixture.game.text('engine.click_you_see', { title: 'Middle drawer' })
    );
  });

  it('click reveals a lookable hidden title but not an examinable one', () => {
    const fixture = createSceneFixture();
    const lookable = fixture.addTriggerbox('lookable_trigger', {
      title: 'Lookable Trigger',
      description: 'A discoverable trigger.',
    });
    lookable.hidden = 'lookable';

    handleSceneClick(fixture.scene, 215, 155);
    expect(fixture.messages.at(-1)).toBe(
      fixture.game.text('engine.click_you_see', { title: 'Lookable Trigger' })
    );

    fixture.messages.length = 0;
    fixture.scene.removeTriggerbox(lookable);
    const examinable = fixture.addTriggerbox('examinable_trigger', {
      title: 'Examinable Trigger',
      description: 'A secret trigger.',
    });
    examinable.hidden = 'examinable';

    handleSceneClick(fixture.scene, 215, 155);
    expect(fixture.messages).toHaveLength(0);
  });

  it('moves the player when clicking a walkbox instead of showing its floor title', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 100, 100);
    fixture.addWalkbox('wb_floor');

    handleSceneClick(fixture.scene, 320, 180);

    expect(fixture.messages).toHaveLength(0);
    expect(fixture.scene.player?.getMoveResult().status).toBe('started');
    expect(fixture.scene.player?.target).not.toBeNull();
    expect(fixture.scene.player?.visualTarget).toBeNull();
  });

  it('click-to-move uses route planning around blocking colliders', () => {
    const fixture = createSceneFixture();
    fixture.game.canvas.width = 640;
    fixture.game.canvas.height = 360;
    const player = fixture.addPlayer('Hero', -80, 0);
    player.colliderWidth = 4;
    player.colliderHeight = 4;
    player.speed = 1;
    const floor = fixture.addWalkbox('wb_floor');
    floor.poly = [
      { x: -100, y: -50 },
      { x: 100, y: -50 },
      { x: 100, y: 50 },
      { x: -100, y: 50 },
    ];

    const obstacle = new Entity(fixture.game as any, 0, 20, 10, 10, 'Blocker');
    obstacle.colliderWidth = 20;
    obstacle.colliderHeight = 40;
    fixture.scene.addEntity(obstacle);

    handleSceneClick(fixture.scene, 400, 180);

    expect(player.getMoveResult().status).toBe('started');
    expect(player.getMoveResult().route.length).toBeGreaterThan(1);
  });
});
