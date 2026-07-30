import { describe, expect, it } from 'vitest';
import { compactRecord } from '../../src/mechanics/compactRecord';

describe('compactRecord', () => {
  it('removes empty fields while preserving non-empty arrays', () => {
    expect(
      compactRecord({ empty: null, nested: { empty: undefined }, values: [null], enabled: false })
    ).toEqual({ values: [null], enabled: false });
  });
});
