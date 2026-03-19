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
});
