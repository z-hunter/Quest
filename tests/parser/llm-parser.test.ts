import { describe, it, expect, vi } from 'vitest';
import { createParserFixture } from '../fixtures/parserFactory';
import { Console } from '../../src/core/Console';

describe('Parser LLM Integration', () => {
  it('#LLM-ON/#LLM-OFF toggle parserLlmEnabled on a real Console instance', () => {
    const game = {
      log: vi.fn(),
      textAssets: {
        getParserCommands: () => ({}),
        getParserLexicon: () => ({}),
      },
      sceneManager: { currentScene: null },
    };
    const console = new Console(game);

    expect(console.parserLlmEnabled).toBe(false);

    console.processCommand('#LLM-ON');
    expect(console.parserLlmEnabled).toBe(true);

    console.processCommand('#LLM-OFF');
    expect(console.parserLlmEnabled).toBe(false);
  });

  it('#PEEKLLM-ON/#PEEKLLM-OFF toggle parserPeekLlmEnabled on a real Console instance', () => {
    const game = {
      log: vi.fn(),
      textAssets: {
        getParserCommands: () => ({}),
        getParserLexicon: () => ({}),
      },
      sceneManager: { currentScene: null },
    };
    const console = new Console(game);

    expect(console.parserPeekLlmEnabled).toBe(false);

    console.processCommand('#peekllm-on');
    expect(console.parserPeekLlmEnabled).toBe(true);

    console.processCommand('#peekllm-off');
    expect(console.parserPeekLlmEnabled).toBe(false);
  });

  it('#C1-OFF/#C1-ON toggle forced LLM handoff mode', () => {
    const game = {
      log: vi.fn(),
      textAssets: {
        getParserCommands: () => ({}),
        getParserLexicon: () => ({}),
      },
      sceneManager: { currentScene: null },
    };
    const console = new Console(game);

    expect(console.parserCascade1ForceLlm).toBe(false);

    console.processCommand('#C1-OFF');
    expect(console.parserCascade1ForceLlm).toBe(true);

    console.processCommand('#C1-ON');
    expect(console.parserCascade1ForceLlm).toBe(false);

    console.processCommand('#С1-OFF');
    expect(console.parserCascade1ForceLlm).toBe(true);
  });

  it('Parser does not call llmCascade for a Stage 1 handled command', async () => {
    const fixture = createParserFixture();
    fixture.game.console.parserLlmEnabled = true;

    const mockLlmParse = vi.fn();
    fixture.parser.llmCascade.parse = mockLlmParse;

    // "LOOK" is handled by Stage 1 (regex-v1)
    await fixture.parser.parse('LOOK');

    expect(mockLlmParse).not.toHaveBeenCalled();
  });

  it('Parser calls llmCascade after lower cascades hand off and parserLlmEnabled is true', async () => {
    const fixture = createParserFixture();
    fixture.game.console.parserLlmEnabled = true;

    // Mock LLM to return a result
    const mockLlmParse = vi.fn().mockResolvedValue({
      stage: 'llm-v3',
      output: { kind: 'plan', actions: [{ type: 'showText', message: 'LLM Result' }] },
      debug: { rawInput: 'SENSEI', normalizedInput: 'SENSEI', verb: 'LLM', noun: '' },
    });
    fixture.parser.llmCascade.parse = mockLlmParse;

    // "SENSEI" is not handled by Stage 1 or Stage 2 (NLP is disabled in fixture)
    await fixture.parser.parse('SENSEI');

    expect(mockLlmParse).toHaveBeenCalled();
    // In createParserFixture, game.log pushes to messages
    expect(fixture.messages).toContain('LLM Result');
  });

  it('Parser forces a Stage 1 handled command into LLM when C1 is off', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.game.console.parserLlmEnabled = true;
    fixture.game.console.parserCascade1ForceLlm = true;

    const mockLlmParse = vi.fn().mockResolvedValue({
      stage: 'llm-v3',
      output: { kind: 'plan', actions: [{ type: 'showText', message: 'LLM looked instead.' }] },
      debug: { rawInput: 'LOOK', normalizedInput: 'LOOK', verb: 'LLM', noun: '' },
    });
    fixture.parser.llmCascade.parse = mockLlmParse;

    await fixture.parser.parse('LOOK');

    expect(mockLlmParse).toHaveBeenCalled();
    const previousAttempt = mockLlmParse.mock.calls[0]?.[3];
    expect(previousAttempt?.kind).toBe('forced_cascade_handoff');
    expect(previousAttempt?.envelope?.stage).toBe('regex-v1');
    expect(fixture.messages).toContain('LLM looked instead.');
  });

  it('Parser calls llmCascade after a standard command escalates from the game API', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.game.console.parserLlmEnabled = true;
    fixture.addEntity('window1', {
      title: 'Window',
      description: 'A stubborn window.',
    });

    const mockLlmParse = vi.fn().mockResolvedValue({
      stage: 'llm-v3',
      output: {
        kind: 'plan',
        actions: [{ type: 'showText', message: 'The window gives you a cold stare.' }],
      },
      debug: { rawInput: 'open window', normalizedInput: 'OPEN WINDOW', verb: 'LLM', noun: '' },
    });
    fixture.parser.llmCascade.parse = mockLlmParse;

    await fixture.parser.parse('open window');

    expect(mockLlmParse).toHaveBeenCalled();
    const previousAttempt = mockLlmParse.mock.calls[0]?.[3];
    expect(previousAttempt?.result?.outcomes?.[0]?.code).toBe('target_is_not_switch');
    expect(fixture.messages).toContain('The window gives you a cold stare.');
  });

  it('Parser calls llmCascade after a Stage 1 command fails with a soft not-found result', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.game.console.parserLlmEnabled = true;
    fixture.addEntity('red_key', {
      title: 'Red key',
      description: 'A small red key.',
    });
    fixture.textAssets.setObject('red_key', {
      title: 'Red key',
      description: 'A small red key.',
      synonyms: ['key'],
    });

    const mockLlmParse = vi.fn().mockResolvedValue({
      stage: 'llm-v3',
      output: {
        kind: 'plan',
        actions: [{ type: 'lookTarget', target: 'key' }],
      },
      debug: {
        rawInput: 'look shiny red key',
        normalizedInput: 'LOOK SHINY RED KEY',
        verb: 'LLM',
        noun: '',
      },
    });
    fixture.parser.llmCascade.parse = mockLlmParse;

    await fixture.parser.parse('look shiny red key');

    expect(mockLlmParse).toHaveBeenCalled();
    const previousAttempt = mockLlmParse.mock.calls[0]?.[3];
    expect(previousAttempt?.kind).toBe('post_api_not_found');
    expect(previousAttempt?.result?.outcomes?.[0]?.code).toBe('entity_not_found');
    expect(fixture.messages).toContain('A small red key.');
  });

  it('Parser calls llmCascade after a recoverable standard command failure', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.game.console.parserLlmEnabled = true;
    fixture.addEntity('book', {
      title: 'Book',
      description: 'A heavy reference book.',
    });

    const mockLlmParse = vi.fn().mockResolvedValue({
      stage: 'llm-v3',
      output: {
        kind: 'plan',
        actions: [
          {
            type: 'showText',
            message: 'The book has done its talking. Now it is your turn to move.',
          },
        ],
      },
      debug: {
        rawInput: 'take book',
        normalizedInput: 'TAKE BOOK',
        verb: 'LLM',
        noun: '',
      },
    });
    fixture.parser.llmCascade.parse = mockLlmParse;

    await fixture.parser.parse('take book');

    expect(mockLlmParse).toHaveBeenCalled();
    const previousAttempt = mockLlmParse.mock.calls[0]?.[3];
    expect(previousAttempt?.kind).toBe('post_api_recovery');
    expect(previousAttempt?.result?.outcomes?.[0]?.code).toBe('not_takeable');
    expect(fixture.messages).toContain(
      'The book has done its talking. Now it is your turn to move.'
    );
    expect(fixture.messages).not.toContain(fixture.game.text('parser.take_cannot'));
  });

  it('uses object TA takeFailure instead of LLM recovery for non-takeable objects', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.game.console.parserLlmEnabled = true;
    fixture.addEntity('book', {
      title: 'Book',
      description: 'A heavy reference book.',
      takeFailure: 'The book is bolted to the lectern.',
    });

    const mockLlmParse = vi.fn();
    fixture.parser.llmCascade.parse = mockLlmParse;

    await fixture.parser.parse('take book');

    expect(mockLlmParse).not.toHaveBeenCalled();
    expect(fixture.messages).toContain('The book is bolted to the lectern.');
    expect(fixture.messages).not.toContain(fixture.game.text('parser.take_cannot'));
  });

  it('keeps the standard parser failure when LLM recovery returns no envelope', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.game.console.parserLlmEnabled = true;
    fixture.addEntity('book', {
      title: 'Book',
      description: 'A heavy reference book.',
    });

    const mockLlmParse = vi.fn().mockResolvedValue(null);
    fixture.parser.llmCascade.parse = mockLlmParse;

    await fixture.parser.parse('take book');

    expect(mockLlmParse).toHaveBeenCalled();
    const previousAttempt = mockLlmParse.mock.calls[0]?.[3];
    expect(previousAttempt?.kind).toBe('post_api_recovery');
    expect(previousAttempt?.result?.outcomes?.[0]?.code).toBe('not_takeable');
    expect(fixture.messages).toContain(fixture.game.text('parser.take_cannot'));
  });
});
