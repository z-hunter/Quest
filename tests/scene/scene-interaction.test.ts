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
});
