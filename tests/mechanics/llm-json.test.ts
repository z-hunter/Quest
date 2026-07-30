import { describe, expect, it } from 'vitest';
import { extractJson, parseJson } from '../../src/mechanics/llm/llmJson';

describe('llmJson', () => {
  it('extracts a fenced JSON object and safely parses invalid output', () => {
    expect(extractJson('note\n```json\n{"ok":true}\n```')).toBe('{"ok":true}');
    expect(parseJson('{"ok":true}')).toEqual({ ok: true });
    expect(parseJson('not json')).toBeNull();
  });
});
