import { describe, expect, it } from 'vitest';
import { Entity } from '../../src/entities/Entity';
import { Triggerbox } from '../../src/entities/Triggerbox';
import { ComponentSystem } from '../../src/systems/ComponentSystem';
import { createTestGame } from '../fixtures/gameFactory';

describe('ComponentSystem State components', () => {
  it('reads explicit runtime values before initial values', () => {
    const { game } = createTestGame();
    const entity = new Entity(game as any, 0, 0, 10, 10, 'door');
    entity.components = [
      { type: 'State', id: 'open', valueType: 'boolean', initialValue: false, value: true },
    ];

    expect(ComponentSystem.getStateValue(entity, 'open')).toBe(true);
  });

  it('falls back to initial value when runtime value is missing', () => {
    const { game } = createTestGame();
    const entity = new Entity(game as any, 0, 0, 10, 10, 'lamp');
    entity.components = [{ type: 'State', id: 'mode', valueType: 'string', initialValue: 'dim' }];

    expect(ComponentSystem.getStateValue(entity, 'mode')).toBe('dim');
  });

  it('sets existing states only when the value type matches', () => {
    const { game } = createTestGame();
    const entity = new Entity(game as any, 0, 0, 10, 10, 'meter');
    const state = { type: 'State', id: 'charge', valueType: 'number', initialValue: 0, value: 1 };
    entity.components = [state];

    expect(ComponentSystem.setStateValue(entity, 'charge', 4)).toBe(true);
    expect(state.value).toBe(4);

    expect(ComponentSystem.setStateValue(entity, 'charge', 'full')).toBe(false);
    expect(state.value).toBe(4);
    expect(ComponentSystem.setStateValue(entity, 'missing', 1)).toBe(false);
  });

  it('normalizes State parser note text asset mappings', () => {
    const state = ComponentSystem.normalizeStateComponent({
      type: 'State',
      id: ' power ',
      valueType: 'boolean',
      initialValue: false,
      value: true,
      parserNoteTextAssets: {
        true: ' powerOn ',
        false: '',
        ' ': 'ignored',
      },
    });

    expect(state).toEqual({
      type: 'State',
      id: 'power',
      valueType: 'boolean',
      initialValue: false,
      value: true,
      parserNoteTextAssets: { true: 'powerOn' },
    });
  });

  it('normalizes State components when triggerboxes serialize', () => {
    const triggerbox = new Triggerbox(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      'door_trigger'
    );
    triggerbox.components = [
      {
        type: 'State',
        id: 'open',
        valueType: 'boolean',
        initialValue: false,
        value: true,
        parserNoteTextAssets: { true: 'openDescription' },
      },
    ] as any;

    const json = triggerbox.toJSON();
    expect(json.components).toEqual([
      {
        type: 'State',
        id: 'open',
        valueType: 'boolean',
        initialValue: false,
        value: true,
        parserNoteTextAssets: { true: 'openDescription' },
      },
    ]);
  });
});
