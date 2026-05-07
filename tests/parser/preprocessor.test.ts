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

  it('wraps closed-console output by words and preserves forced newlines', () => {
    const consoleInstance = new Console({});
    (consoleInstance as { CLOSED_CONSOLE_WRAP_COLUMNS: number }).CLOSED_CONSOLE_WRAP_COLUMNS = 24;

    consoleInstance.log(
      'One two three four five six seven.\nSecond paragraph starts here and keeps going.'
    );

    const lines = consoleInstance.getClosedDisplayLines().map((line) => line.text);

    expect(lines).toEqual([
      'One two three four five',
      'six seven.',
      'Second paragraph starts',
      'here and keeps going.',
    ]);
  });

  it('enters and dismisses closed modal mode for output longer than two wrapped lines', () => {
    const consoleInstance = new Console({});

    consoleInstance.log(
      [
        'This is a deliberately long parser response that should occupy more than one closed-console line.',
        'It keeps adding enough words to pass the two visible lines threshold.',
        'The closed console should expand and wait for continue.',
      ].join(' ')
    );

    expect(consoleInstance.isClosedModal).toBe(true);
    expect(consoleInstance.preprocessGameplayInput('look')).toBe('');
    expect(consoleInstance.processCommand('#HELP')).toBeUndefined();

    expect(consoleInstance.continueClosedModal()).toBe(true);
    expect(consoleInstance.isClosedModal).toBe(false);
    expect(consoleInstance.preprocessGameplayInput('l')).toBe('LOOK');
  });

  it('enters closed modal mode when a parser response spans several short messages', () => {
    const consoleInstance = new Console({});
    (consoleInstance as { CLOSED_CONSOLE_WRAP_COLUMNS: number }).CLOSED_CONSOLE_WRAP_COLUMNS = 80;

    consoleInstance.logResponse([
      'First short response line.',
      'Second short response line.',
      'Third short response line.',
    ]);

    expect(consoleInstance.isClosedModal).toBe(true);
    expect(
      consoleInstance
        .getClosedDisplayLines()
        .slice(-3)
        .map((line) => line.text)
    ).toEqual([
      'First short response line.',
      'Second short response line.',
      'Third short response line.',
    ]);
  });

  it('shows only the latest parser response in closed modal mode', () => {
    const consoleInstance = new Console({});
    (consoleInstance as { CLOSED_CONSOLE_WRAP_COLUMNS: number }).CLOSED_CONSOLE_WRAP_COLUMNS = 80;

    consoleInstance.log('LOOK CITY', 'command');
    consoleInstance.logResponse([
      'First city response line.',
      'Second city response line.',
      'Third city response line.',
    ]);
    consoleInstance.continueClosedModal();

    consoleInstance.log('LOOK CITY', 'command');
    consoleInstance.logResponse([
      'Latest city response line one.',
      'Latest city response line two.',
      'Latest city response line three.',
    ]);

    expect(consoleInstance.getClosedDisplayLines().map((line) => line.text)).toContain(
      'First city response line.'
    );
    expect(consoleInstance.getClosedModalDisplayLines().map((line) => line.text)).toEqual([
      'Latest city response line one.',
      'Latest city response line two.',
      'Latest city response line three.',
    ]);
  });

  it('opens the full console instead of continuing when toggled from closed modal mode', () => {
    const consoleInstance = new Console({});

    consoleInstance.logResponse([
      'First short response line.',
      'Second short response line.',
      'Third short response line.',
    ]);

    expect(consoleInstance.isClosedModal).toBe(true);
    expect(consoleInstance.isOpen).toBe(false);

    consoleInstance.toggle();

    expect(consoleInstance.isClosedModal).toBe(false);
    expect(consoleInstance.isOpen).toBe(true);
  });

  it('keeps technical logs out of the closed console while preserving them in the full buffer', () => {
    const consoleInstance = new Console({});

    consoleInstance.log('Parser peek enabled.', 'info');
    consoleInstance.log('--- CONTEXT ---\n{"huge":true}', 'info', { showInClosed: false });
    consoleInstance.log('You see the city.', 'output');

    expect(consoleInstance.buffer.map((line) => line.text)).toEqual([
      'Parser peek enabled.',
      '--- CONTEXT ---\n{"huge":true}',
      'You see the city.',
    ]);
    expect(consoleInstance.getClosedDisplayLines().map((line) => line.text)).toEqual([
      'Parser peek enabled.',
      'You see the city.',
    ]);
  });
});
