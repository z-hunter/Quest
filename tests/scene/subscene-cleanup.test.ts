import { describe, expect, it } from 'vitest';
import { ComponentSystem } from '../../src/systems/ComponentSystem';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('Subscene cleanup', () => {
  it('resets switches included via spatial hierarchy when the subscene closes', () => {
    const fixture = createSceneFixture();
    const rootSubscene = fixture.addTriggerbox('Trig_A', {
      components: [{ type: 'Subscene', targetGroupId: '' }],
    });
    const spatialSwitch = fixture.addEntity('SwitchEntity', {
      disabled: true,
      spatial: { parentNodeId: 'Trig_A', relation: 'in' },
      components: [{ type: 'Switch', state: 2, sound1: 'switch-close' }],
    });

    ComponentSystem.handleActivation(rootSubscene, fixture.scene);
    fixture.scene.activeSubscene = null;

    expect((spatialSwitch.components[0] as { state: number }).state).toBe(1);
    expect(fixture.sounds).toEqual(['switch-close']);
    expect(spatialSwitch.disabled).toBe(true);
    expect(fixture.scene.subsceneEntities.size).toBe(0);
  });

  it('resets switches included via targetGroupId on close as well', () => {
    const fixture = createSceneFixture();
    const rootSubscene = fixture.addTriggerbox('Trig_A', {
      components: [{ type: 'Subscene', targetGroupId: '#A' }],
    });
    const groupSwitch = fixture.addEntity('GroupSwitch', {
      disabled: true,
      groupID: '#A',
      components: [{ type: 'Switch', state: 2, sound1: 'group-close' }],
    });

    ComponentSystem.handleActivation(rootSubscene, fixture.scene);
    fixture.scene.activeSubscene = null;

    expect((groupSwitch.components[0] as { state: number }).state).toBe(1);
    expect(fixture.sounds).toEqual(['group-close']);
    expect(groupSwitch.disabled).toBe(true);
  });
});
