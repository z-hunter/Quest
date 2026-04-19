import { describe, expect, it } from 'vitest';
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

    expect(fixture.messages.at(-1)).toBe('You see Desk Drawer');
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

    expect(fixture.messages.at(-1)).toBe('You see Center Trigger');
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

    expect(fixture.messages.at(-1)).toBe('You see Ghost Item');
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

    expect(fixture.messages.at(-1)).toBe('You see Back Trigger');
  });

  it('click reveals a lookable hidden title but not an examinable one', () => {
    const fixture = createSceneFixture();
    const lookable = fixture.addTriggerbox('lookable_trigger', {
      title: 'Lookable Trigger',
      description: 'A discoverable trigger.',
    });
    lookable.hidden = 'lookable';

    handleSceneClick(fixture.scene, 215, 155);
    expect(fixture.messages.at(-1)).toBe('You see Lookable Trigger');

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
    expect(fixture.scene.player?.visualTarget).not.toBeNull();
    expect(fixture.scene.player?.target).toBeNull();
  });
});
