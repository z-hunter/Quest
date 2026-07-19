import { describe, expect, it } from 'vitest';
import {
  formatNpcObjectivesForEditor,
  materializeNpcObjectives,
  normalizeNpcMemory,
  parseNpcObjectivesFromEditor,
} from '../../src/mechanics/npcState';

describe('NPC cognition state', () => {
  it('normalizes legacy memory into separate factual entries', () => {
    expect(normalizeNpcMemory(' Old note. ')).toEqual(['Old note.']);
    expect(normalizeNpcMemory([' One ', '', 'Two'])).toEqual(['One', 'Two']);
  });

  it('round-trips a two-space objective tree through editor text', () => {
    const parsed = parseNpcObjectivesFromEditor('Turn on the TV\n  Find the remote\n    Ask Rick');
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    const objectives = materializeNpcObjectives(parsed.objectives);
    expect(formatNpcObjectivesForEditor(objectives)).toBe(
      'Turn on the TV\n  Find the remote\n    Ask Rick'
    );
    expect(objectives[0].id).toMatch(/^npc-objective-/);
  });

  it('rejects tabs, odd indentation, and skipped levels', () => {
    expect(parseNpcObjectivesFromEditor('\tTask')).toEqual(
      expect.objectContaining({ error: expect.any(String) })
    );
    expect(parseNpcObjectivesFromEditor(' Task')).toEqual(
      expect.objectContaining({ error: expect.any(String) })
    );
    expect(parseNpcObjectivesFromEditor('    Task')).toEqual(
      expect.objectContaining({ error: expect.any(String) })
    );
  });
});
