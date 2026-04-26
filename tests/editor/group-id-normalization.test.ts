import { describe, expect, it } from 'vitest';
import { SceneObject } from '../../src/entities/SceneObject';
import { normalizeGroupIdList } from '../../src/utils/GroupIds';

describe('group ID normalization', () => {
  it('trims group ids and adds missing # prefixes', () => {
    expect(normalizeGroupIdList(' D , #D1 ,#D2 ')).toBe('#D,#D1,#D2');
  });

  it('can preserve empty tokens while the editor input is mid-edit', () => {
    expect(normalizeGroupIdList('D, ', { preserveEmptyTokens: true })).toBe('#D,');
  });

  it('normalizes SceneObject groupID values on load and serialization', () => {
    const obj = new SceneObject('Drawer2', 'Triggerbox');

    obj.load({ groupID: '#D ' });
    expect(obj.groupID).toBe('#D');

    obj.groupID = ' D1 , #D2 ';
    expect(obj.toJSON().groupID).toBe('#D1,#D2');
  });
});
