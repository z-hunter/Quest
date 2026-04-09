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
    expect([...fixture.scene.subsceneEntities].map((item) => item.name).sort()).toEqual([
      'Lamp',
      'Trig_B',
    ]);
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

  it('includes recursive descendants inside the subscene, but preserves switch-gated visibility and nested subscene boundaries', () => {
    const fixture = createSceneFixture();
    const rootSubscene = fixture.addTriggerbox('Trig_A', {
      components: [{ type: 'Subscene', targetGroupId: '' }],
    });
    const openDrawer = fixture.addEntity('OpenDrawer', {
      disabled: true,
      spatial: { parentNodeId: 'Trig_A', relation: 'in' },
      components: [
        {
          type: 'Switch',
          state: 2,
          groupId1: '#open_drawer_closed',
          groupId2: '#open_drawer_open',
        },
      ],
    });
    const tray = fixture.addEntity('Tray', {
      disabled: true,
      groupID: '#open_drawer_open',
      spatial: { parentNodeId: 'OpenDrawer', relation: 'in' },
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    const coin = fixture.addEntity('Coin', {
      disabled: true,
      spatial: { parentNodeId: 'Tray', relation: 'on' },
    });
    const closedDrawer = fixture.addEntity('ClosedDrawer', {
      disabled: true,
      spatial: { parentNodeId: 'Trig_A', relation: 'in' },
      components: [
        { type: 'Switch', state: 1, groupId1: '#drawer_closed', groupId2: '#drawer_open' },
      ],
    });
    const hiddenBySwitch = fixture.addEntity('HiddenBySwitch', {
      disabled: true,
      groupID: '#drawer_open',
      spatial: { parentNodeId: 'ClosedDrawer', relation: 'in' },
    });
    const nestedSubscene = fixture.addTriggerbox('Trig_B', {
      disabled: true,
      components: [{ type: 'Subscene', targetGroupId: '' }],
      spatial: { parentNodeId: 'Trig_A', relation: 'in' },
    });
    const hiddenGrandchild = fixture.addEntity('HiddenGrandchild', {
      disabled: true,
      spatial: { parentNodeId: 'Trig_B', relation: 'in' },
    });

    ComponentSystem.handleActivation(rootSubscene, fixture.scene);

    expect(openDrawer.disabled).toBe(false);
    expect(tray.disabled).toBe(false);
    expect(coin.disabled).toBe(false);
    expect(closedDrawer.disabled).toBe(false);
    expect(hiddenBySwitch.disabled).toBe(true);
    expect(nestedSubscene.disabled).toBe(false);
    expect(hiddenGrandchild.disabled).toBe(true);
    expect([...fixture.scene.subsceneEntities].map((item) => item.name).sort()).toEqual(
      ['Coin', 'ClosedDrawer', 'OpenDrawer', 'Tray', 'Trig_B'].sort()
    );
  });

  it('applies itemScale from the active subscene to visible item entities only', () => {
    const fixture = createSceneFixture();
    const rootSubscene = fixture.addTriggerbox('Trig_A', {
      components: [{ type: 'Subscene', targetGroupId: '', itemScale: 2 }],
    });
    const coin = fixture.addEntity('Coin', {
      disabled: true,
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'Trig_A', relation: 'in' },
    });
    coin.modelScale = 1.5;
    coin.ignoreScaling = true;

    const mug = fixture.addEntity('Mug', {
      disabled: true,
      spatial: { parentNodeId: 'Trig_A', relation: 'in' },
    });
    mug.modelScale = 1.5;
    mug.ignoreScaling = true;

    ComponentSystem.handleActivation(rootSubscene, fixture.scene);
    fixture.scene.update(16);

    expect(coin.subsceneItemScale).toBe(2);
    expect(coin.scale).toBe(3);
    expect(mug.subsceneItemScale).toBe(1);
    expect(mug.scale).toBe(1.5);

    fixture.scene.activeSubscene = null;
    fixture.scene.subsceneEntities.clear();
    fixture.scene.update(16);

    expect(coin.subsceneItemScale).toBe(1);
    expect(coin.scale).toBe(1.5);
  });
});
