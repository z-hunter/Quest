import { describe, expect, it } from 'vitest';
import { Console } from '../../src/core/Console';

describe('Console gameplay preprocessor', () => {
  it('expands single-letter parser aliases including Q -> QUIT', () => {
    const consoleInstance = new Console({});

    expect(consoleInstance.preprocessGameplayInput('l')).toBe('LOOK');
    expect(consoleInstance.preprocessGameplayInput('x lamp')).toBe('EXAMINE lamp');
    expect(consoleInstance.preprocessGameplayInput('i')).toBe('INVENTORY');
    expect(consoleInstance.preprocessGameplayInput('q')).toBe('QUIT');
  });
});
