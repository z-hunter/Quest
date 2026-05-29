import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScriptRegistry } from '../../src/core/ScriptRegistry';
import { ScriptAPI } from '../../src/core/ScriptAPI';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('ScriptAPI State access', () => {
  afterEach(() => {
    ScriptRegistry.stop('test.script-api-state');
    vi.restoreAllMocks();
  });

  it('gets and sets State components by current-scene object id', () => {
    const fixture = createSceneFixture();
    const door = fixture.addEntity('door', {
      title: 'Door',
      components: [
        { type: 'State', id: 'open', valueType: 'boolean', initialValue: false, value: false },
      ],
    });
    const api = new ScriptAPI(fixture.game as any);

    expect(api.getState('door', 'open')).toBe(false);
    expect(api.setState('door', 'open', true)).toBe(true);
    expect(api.getState(door, 'open')).toBe(true);
  });

  it('resolves triggerboxes and walkboxes by id', () => {
    const fixture = createSceneFixture();
    fixture.addTriggerbox('door_trigger', {
      title: 'Door trigger',
      components: [
        { type: 'State', id: 'armed', valueType: 'boolean', initialValue: true, value: true },
      ],
    });
    const walkbox = fixture.addWalkbox('floor_zone');
    walkbox.components = [
      { type: 'State', id: 'wet', valueType: 'boolean', initialValue: false, value: false },
    ] as any;
    const api = new ScriptAPI(fixture.game as any);

    expect(api.setState('door_trigger', 'armed', false)).toBe(true);
    expect(api.getState('door_trigger', 'armed')).toBe(false);
    expect(api.setState('floor_zone', 'wet', true)).toBe(true);
    expect(api.getState('floor_zone', 'wet')).toBe(true);
  });

  it('rejects unknown states and wrong value types without creating state', () => {
    const fixture = createSceneFixture();
    fixture.addEntity('lamp', {
      title: 'Lamp',
      components: [
        { type: 'State', id: 'powered', valueType: 'boolean', initialValue: false, value: false },
      ],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = new ScriptAPI(fixture.game as any);

    expect(api.setState('lamp', 'powered', 'yes' as any)).toBe(false);
    expect(api.getState('lamp', 'powered')).toBe(false);
    expect(api.setState('lamp', 'missing', true)).toBe(false);
    expect(api.getState('lamp', 'missing')).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('dispatches State script events when setting through the Script API', () => {
    const fixture = createSceneFixture();
    const handler = vi.fn();
    ScriptRegistry.register('test.script-api-state', handler);
    const door = fixture.addEntity('door', {
      title: 'Door',
      components: [
        { type: 'State', id: 'open', valueType: 'boolean', initialValue: false, value: false },
      ],
    });
    door.interactions = { 'state:open=true': 'test.script-api-state' };
    const api = new ScriptAPI(fixture.game as any);

    expect(api.setState('door', 'open', true)).toBe(true);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: door,
        args: expect.objectContaining({
          stateId: 'open',
          previousValue: false,
          value: true,
          valueType: 'boolean',
          source: 'script-api',
        }),
      })
    );
  });
});
