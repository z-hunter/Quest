import { describe, expect, it } from 'vitest';
import { ComponentSystem } from '../../src/systems/ComponentSystem';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('Subscene activation', () => {
  it('enables direct spatial children and leaves grandchildren disabled', () => {
    const fixture = createSceneFixture();
    const rootSubscene = fixture.addTriggerbox('Trig_A', {
      components: [{ type: 'Subscene', targetGroupId: '' }],
    });
    const directEntity = fixture.addEntity('Lamp', {
      disabled: true,
      spatial: { parentNodeId: 'Trig_A', relation: 'in' },
    });
    const nestedSubscene = fixture.addTriggerbox('Trig_B', {
      disabled: true,
      components: [{ type: 'Subscene', targetGroupId: '' }],
      spatial: { parentNodeId: 'Trig_A', relation: 'in' },
    });
    const grandchild = fixture.addEntity('HiddenNote', {
      disabled: true,
      spatial: { parentNodeId: 'Trig_B', relation: 'in' },
    });

    const handled = ComponentSystem.handleActivation(rootSubscene, fixture.scene);

    expect(handled).toBe(true);
    expect(fixture.scene.activeSubscene).toBe('Trig_A');
    expect(directEntity.disabled).toBe(false);
    expect(nestedSubscene.disabled).toBe(false);
    expect(grandchild.disabled).toBe(true);
    expect([...fixture.scene.subsceneEntities].map((item) => item.name).sort()).toEqual(['Lamp', 'Trig_B']);
  });

  it('still includes group targets together with direct spatial children', () => {
    const fixture = createSceneFixture();
    const rootSubscene = fixture.addTriggerbox('Trig_A', {
      components: [{ type: 'Subscene', targetGroupId: '#A' }],
    });
    const groupEntity = fixture.addEntity('ByGroup', {
      disabled: true,
      groupID: '#A',
    });
    const spatialEntity = fixture.addEntity('BySpatial', {
      disabled: true,
      spatial: { parentNodeId: 'Trig_A', relation: 'in' },
    });

    ComponentSystem.handleActivation(rootSubscene, fixture.scene);

    expect(groupEntity.disabled).toBe(false);
    expect(spatialEntity.disabled).toBe(false);
    expect([...fixture.scene.subsceneEntities].map((item) => item.name).sort()).toEqual([
      'ByGroup',
      'BySpatial',
    ]);
  });
});
