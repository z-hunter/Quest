import { describe, expect, it } from 'vitest';
import {
  buildScriptEventAddOptions,
  formatInteractionLabel,
  getInteractionKeyForAddValue,
  getStateEventSelectOptions,
  parseStateEventKey,
  renameInteractionKey,
} from '../../src/components/editor/properties/SectionScriptEventsUtils';

describe('SectionScriptEvents helpers', () => {
  it('shows State Changed only when the object has authored State components', () => {
    expect(buildScriptEventAddOptions([]).map((option) => option.label)).toEqual([
      'Look',
      'Use',
      'Talk',
      'Pickup',
    ]);

    expect(buildScriptEventAddOptions(['open']).map((option) => option.label)).toEqual([
      'Look',
      'Use',
      'Talk',
      'Pickup',
      'State Changed',
    ]);
  });

  it('creates a State event for the first authored State id', () => {
    const stateChangedOption = buildScriptEventAddOptions(['open', 'locked']).find(
      (option) => option.label === 'State Changed'
    );

    expect(stateChangedOption).toBeDefined();
    expect(getInteractionKeyForAddValue(stateChangedOption!.value, ['open', 'locked'])).toBe(
      'state:open'
    );
  });

  it('renames a State event key without losing the script id', () => {
    const interactions = { 'state:open': 'door_open_changed' };

    expect(renameInteractionKey(interactions, 'state:open', 'state:locked')).toBe(true);

    expect(interactions).toEqual({ 'state:locked': 'door_open_changed' });
  });

  it('keeps legacy missing State ids available in the State selector', () => {
    expect(getStateEventSelectOptions(['open', 'locked'], 'missing')).toEqual([
      { value: 'open', label: 'open' },
      { value: 'locked', label: 'locked' },
      { value: 'missing', label: 'missing' },
    ]);
  });

  it('formats value-specific State events as read-only labels', () => {
    expect(parseStateEventKey('state:power=on')).toEqual({
      isState: true,
      stateId: 'power',
      value: 'on',
      isValueSpecific: true,
    });
    expect(formatInteractionLabel('state:power=on')).toBe('STATE power=on');
  });

  it('keeps regular interaction labels unchanged', () => {
    expect(formatInteractionLabel('look')).toBe('LOOK');
    expect(getInteractionKeyForAddValue('pickup', ['open'])).toBe('pickup');
  });
});
