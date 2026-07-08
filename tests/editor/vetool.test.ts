import { describe, it, expect } from 'vitest';
import { calculateSpritesheetLayout, LayoutBox } from '../../src/utils/vetoolLayout';

describe('calculateSpritesheetLayout', () => {
  it('should compute start X coordinates and total sheet dimensions correctly', () => {
    const boxes: LayoutBox[] = [
      { id: 'box_a', colIndex: 0, w: 32, h: 48 },
      { id: 'box_b', colIndex: 1, w: 48, h: 48 },
    ];
    const result = calculateSpritesheetLayout(boxes, 6);
    expect(result.totalWidth).toBe(80);
    expect(result.totalHeight).toBe(288); // 6 * 48
    expect(result.colX['box_a']).toBe(0);
    expect(result.colX['box_b']).toBe(32);
  });

  it('should handle different heights and take the maximum for total height', () => {
    const boxes: LayoutBox[] = [
      { id: 'box_a', colIndex: 1, w: 32, h: 64 },
      { id: 'box_b', colIndex: 0, w: 32, h: 32 },
    ];
    const result = calculateSpritesheetLayout(boxes, 4);
    expect(result.totalWidth).toBe(64);
    expect(result.totalHeight).toBe(256); // 4 * 64
    expect(result.colX['box_b']).toBe(0); // colIndex 0 first
    expect(result.colX['box_a']).toBe(32); // colIndex 1 second
  });

  it('should return zeros for empty list', () => {
    const result = calculateSpritesheetLayout([], 10);
    expect(result.totalWidth).toBe(0);
    expect(result.totalHeight).toBe(0);
  });
});
