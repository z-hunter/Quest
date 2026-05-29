import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScriptRegistry } from '../../src/core/ScriptRegistry';
import { ComponentSystem } from '../../src/systems/ComponentSystem';
import { StateEventSystem } from '../../src/systems/StateEventSystem';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('StateEventSystem', () => {
  afterEach(() => {
    [
      'test.state.generic',
      'test.state.on',
      'test.state.same',
      'test.state.only-on',
      'test.state.invalid',
    ].forEach((id) => ScriptRegistry.stop(id));
    vi.restoreAllMocks();
  });

  it('dispatches generic and value-specific State events with change args', () => {
    const fixture = createSceneFixture();
    const generic = vi.fn();
    const on = vi.fn();
    ScriptRegistry.register('test.state.generic', generic);
    ScriptRegistry.register('test.state.on', on);
    const tv = fixture.addEntity('tv', {
      components: [
        { type: 'State', id: 'power', valueType: 'string', initialValue: 'off', value: 'off' },
      ],
    });
    tv.interactions = {
      'state:power': 'test.state.generic',
      'state:power=on': 'test.state.on',
    };

    const result = StateEventSystem.setState(fixture.game as any, tv, 'power', 'on', 'parser');

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      dispatchedScripts: ['test.state.generic', 'test.state.on'],
    });
    expect(ComponentSystem.getStateValue(tv, 'power')).toBe('on');
    expect(generic).toHaveBeenCalledWith(
      expect.objectContaining({
        game: fixture.game,
        entity: tv,
        args: {
          stateId: 'power',
          previousValue: 'off',
          value: 'on',
          valueType: 'string',
          source: 'parser',
        },
      })
    );
    expect(on).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch events when the value did not change', () => {
    const fixture = createSceneFixture();
    const handler = vi.fn();
    ScriptRegistry.register('test.state.same', handler);
    const lamp = fixture.addEntity('lamp', {
      components: [
        { type: 'State', id: 'powered', valueType: 'boolean', initialValue: false, value: false },
      ],
    });
    lamp.interactions = { 'state:powered': 'test.state.same' };

    const result = StateEventSystem.setState(fixture.game as any, lamp, 'powered', false, 'parser');

    expect(result).toMatchObject({ ok: true, changed: false, dispatchedScripts: [] });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not dispatch value-specific events for non-matching values', () => {
    const fixture = createSceneFixture();
    const on = vi.fn();
    ScriptRegistry.register('test.state.only-on', on);
    const tv = fixture.addEntity('tv', {
      components: [
        { type: 'State', id: 'power', valueType: 'string', initialValue: 'off', value: 'off' },
      ],
    });
    tv.interactions = { 'state:power=on': 'test.state.only-on' };

    StateEventSystem.setState(fixture.game as any, tv, 'power', 'standby', 'parser');

    expect(on).not.toHaveBeenCalled();
  });

  it('rejects wrong types and missing State without dispatching scripts', () => {
    const fixture = createSceneFixture();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = vi.fn();
    ScriptRegistry.register('test.state.invalid', handler);
    const lamp = fixture.addEntity('lamp', {
      components: [
        { type: 'State', id: 'powered', valueType: 'boolean', initialValue: false, value: false },
      ],
    });
    lamp.interactions = { 'state:powered': 'test.state.invalid' };

    expect(StateEventSystem.setState(fixture.game as any, lamp, 'powered', 'yes' as any)).toEqual({
      ok: false,
      reason: 'invalid-type',
      expectedType: 'boolean',
    });
    expect(StateEventSystem.setState(fixture.game as any, lamp, 'missing', true)).toEqual({
      ok: false,
      reason: 'missing-state',
    });
    expect(handler).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
