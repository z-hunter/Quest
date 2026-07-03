import { describe, expect, it } from 'vitest';
import { ComponentSystem } from '../../src/systems/ComponentSystem';
import { GAME_DESIGN_HEIGHT, GAME_DESIGN_WIDTH } from '../../src/core/Resolution';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('Subscene interaction', () => {
  const screenX = GAME_DESIGN_WIDTH / 2;
  const screenY = GAME_DESIGN_HEIGHT / 2 - 5;

  it('does not show the back cursor while hovering a locked visual entity inside the active subscene', () => {
    const fixture = createSceneFixture();
    const rootSubscene = fixture.addTriggerbox('Trig_A', {
      components: [{ type: 'Subscene', targetGroupId: '' }],
    });
    const lockedVisual = fixture.addEntity('LockedVisual', {
      disabled: true,
      spatial: { parentNodeId: 'Trig_A', relation: 'in' },
    });
    lockedVisual.locked = true;

    ComponentSystem.handleActivation(rootSubscene, fixture.scene);

    expect(fixture.scene.checkHover(screenX, screenY)).toBeNull();
  });

  it('does not close the active subscene when clicking a locked visual entity inside it', () => {
    const fixture = createSceneFixture();
    const rootSubscene = fixture.addTriggerbox('Trig_A', {
      components: [{ type: 'Subscene', targetGroupId: '' }],
    });
    const lockedVisual = fixture.addEntity('LockedVisual', {
      disabled: true,
      spatial: { parentNodeId: 'Trig_A', relation: 'in' },
    });
    lockedVisual.locked = true;

    ComponentSystem.handleActivation(rootSubscene, fixture.scene);
    fixture.scene.onClick(screenX, screenY);

    expect(fixture.scene.activeSubscene).toBe('Trig_A');
  });
});
