import { describe, it, expect, vi } from 'vitest';
import { createParserFixture } from '../fixtures/parserFactory';
import { Console } from '../../src/core/Console';
import { ScriptRegistry } from '../../src/core/ScriptRegistry';
import { ComponentSystem } from '../../src/systems/ComponentSystem';

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

  it('#PEEKPN-ON/#PEEKPN-OFF toggle parserPeekPnEnabled on a real Console instance', () => {
    const game = {
      log: vi.fn(),
      textAssets: {
        getParserCommands: () => ({}),
        getParserLexicon: () => ({}),
      },
      sceneManager: { currentScene: null },
    };
    const console = new Console(game);

    expect(console.parserPeekPnEnabled).toBe(false);

    console.processCommand('#peekpn-on');
    expect(console.parserPeekPnEnabled).toBe(true);

    console.processCommand('#peekpn-off');
    expect(console.parserPeekPnEnabled).toBe(false);
  });

  it('#PEEKPM-ON/#PEEKPM-OFF toggle parserPeekPmEnabled on a real Console instance', () => {
    const game = {
      log: vi.fn(),
      textAssets: {
        getParserCommands: () => ({}),
        getParserLexicon: () => ({}),
      },
      sceneManager: { currentScene: null },
    };
    const console = new Console(game);

    expect(console.parserPeekPmEnabled).toBe(false);

    console.processCommand('#peekpm-on');
    expect(console.parserPeekPmEnabled).toBe(true);

    console.processCommand('#peekpm-off');
    expect(console.parserPeekPmEnabled).toBe(false);
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

  it('expands LLM runCustomCommand actions through authored command plans', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    const tv = fixture.addEntity('tv', {
      title: 'TV',
      components: [
        { type: 'State', id: 'power', valueType: 'string', initialValue: 'off', value: 'off' },
      ],
    });
    const remote = fixture.addEntity('tv_rc', {
      title: 'TV remote',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    fixture.scene.removeEntity(remote);
    fixture.game.inventory.push(remote);
    fixture.game.console.parserLlmEnabled = true;
    if (!ScriptRegistry.has('tv_glow')) {
      ScriptRegistry.register('tv_glow', ({ api }) => {
        api.setInterval(() => {}, 1000);
      });
    }
    fixture.parser.llmCascade.parse = vi.fn().mockResolvedValue({
      stage: 'llm-v3',
      output: { kind: 'plan', actions: [{ type: 'runCustomCommand', commandId: 'turn_tv_on' }] },
      debug: { rawInput: 'tv on', normalizedInput: 'TV ON', verb: 'LLM', noun: '' },
    });

    await fixture.parser.parse('tv on');

    expect(ComponentSystem.getStateValue(tv, 'power')).toBe('on');
    expect(fixture.messages).toContain('The TV clicks on.');
    ScriptRegistry.stop('tv_glow');
  });

  it('executes direct LLM Game Master actions for State, groups, scripts, and text', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    const tv = fixture.addEntity('tv', {
      title: 'TV',
      components: [
        { type: 'State', id: 'power', valueType: 'string', initialValue: 'off', value: 'off' },
      ],
    });
    const glow = fixture.addEntity('tv_glow_quad', {
      groupID: '#tv_glow',
      disabled: true,
    });
    fixture.game.console.parserLlmEnabled = true;
    if (!ScriptRegistry.has('tv_glow')) {
      ScriptRegistry.register('tv_glow', ({ api }) => {
        api.setInterval(() => {}, 1000);
      });
    }
    fixture.parser.llmCascade.parse = vi.fn().mockResolvedValue({
      stage: 'llm-v3',
      output: {
        kind: 'plan',
        actions: [
          { type: 'requireEntityAvailable', entityId: 'tv', scopes: ['visible'] },
          { type: 'setEntityState', entityId: 'tv', stateId: 'power', value: 'on' },
          { type: 'setGroupDisabled', groupId: '#tv_glow', disabled: false },
          { type: 'runScript', scriptId: 'tv_glow', restart: true },
          { type: 'showText', message: 'The TV hums awake.' },
        ],
      },
      debug: { rawInput: 'tv on', normalizedInput: 'TV ON', verb: 'LLM', noun: '' },
    });

    await fixture.parser.parse('tv on');

    expect(ComponentSystem.getStateValue(tv, 'power')).toBe('on');
    expect(glow.disabled).toBe(false);
    expect(ScriptRegistry.isRunning('tv_glow')).toBe(true);
    expect(fixture.messages).toContain('The TV hums awake.');
    ScriptRegistry.stop('tv_glow');
  });

  it('lets LLM action plans use the standard numbered clarification session', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.game.console.parserLlmEnabled = true;

    const heldCassette = fixture.addEntity('held_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.textAssets.setObject('held_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      synonyms: ['cassette', 'tape'],
    });
    fixture.scene.removeEntity(heldCassette);
    fixture.game.inventory.push(heldCassette);

    const musicCassette = fixture.addEntity('music_cassette', {
      title: "Cassette 'Music'",
      description: 'A music cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.textAssets.setObject('music_cassette', {
      title: "Cassette 'Music'",
      description: 'A music cassette.',
      synonyms: ['cassette', 'tape', 'music'],
    });
    musicCassette.x = 10;
    musicCassette.y = 0;

    const boombox = fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'A tape player.',
      components: [{ type: 'Inventory', relation: 'in', capacity: 2, groups: [], items: [] }],
    });
    fixture.textAssets.setObject('boombox', {
      title: 'Boombox',
      description: 'A tape player.',
      synonyms: ['player', 'tape player', 'recorder'],
    });
    boombox.x = 20;
    boombox.y = 0;

    fixture.parser.llmCascade.parse = vi.fn().mockResolvedValue({
      stage: 'llm-v3',
      output: {
        kind: 'plan',
        actions: [
          {
            type: 'llmClarification',
            question: 'Which cassette do you want to load?',
            pendingActions: [
              { type: 'putTarget', item: 'cassette', target: 'player', relation: 'in' },
            ],
          },
        ],
      },
      debug: {
        rawInput: 'load cassette into player',
        normalizedInput: 'LOAD CASSETTE INTO PLAYER',
        verb: 'LLM',
        noun: '',
      },
    });

    await fixture.parser.parse('load cassette into player');

    expect(fixture.messages.at(-1)).toContain('Which item do you want to put down');
    expect(fixture.messages.at(-1)).toContain('1: Compact cassette');
    expect(fixture.messages.at(-1)).toContain("2: Cassette 'Music'");
    expect(fixture.parser.pendingState?.intent).toBe('put');

    await fixture.parser.parse('1');

    expect(fixture.messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_inventory', {
        item: 'held_cassette',
        target: 'Boombox',
      })
    );
    expect(fixture.game.inventory).not.toContain(heldCassette);
    expect(fixture.game.inventory).not.toContain(musicCassette);
    expect(fixture.parser.pendingState).toBeNull();
  });

  it('runs State event side effects when LLM returns only setEntityState and text', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    const tv = fixture.addEntity('tv', {
      title: 'TV',
      components: [
        { type: 'State', id: 'power', valueType: 'string', initialValue: 'off', value: 'off' },
      ],
    });
    tv.interactions = { 'state:power': 'test.llm.tv-power' };
    const glow = fixture.addEntity('tv_glow_quad', {
      groupID: '#tv_glow',
      disabled: true,
    });
    fixture.game.console.parserLlmEnabled = true;
    ScriptRegistry.register('test.llm.tv-glow', ({ api }) => {
      api.setInterval(() => {}, 1000);
    });
    ScriptRegistry.register('test.llm.tv-power', ({ game, args }) => {
      if (args?.value !== 'on') return;
      game.sceneManager.currentScene
        .getAllSceneObjects()
        .filter((object: any) => object.groupID === '#tv_glow')
        .forEach((object: any) => {
          object.disabled = false;
        });
      if (ScriptRegistry.isRunning('test.llm.tv-glow')) {
        ScriptRegistry.stop('test.llm.tv-glow');
      }
      ScriptRegistry.execute('test.llm.tv-glow', { game });
    });
    fixture.parser.llmCascade.parse = vi.fn().mockResolvedValue({
      stage: 'llm-v3',
      output: {
        kind: 'plan',
        actions: [
          { type: 'setEntityState', entityId: 'tv', stateId: 'power', value: 'on' },
          { type: 'showText', message: 'The TV hums awake.' },
        ],
      },
      debug: { rawInput: 'tv on', normalizedInput: 'TV ON', verb: 'LLM', noun: '' },
    });

    await fixture.parser.parse('tv on');

    expect(ComponentSystem.getStateValue(tv, 'power')).toBe('on');
    expect(glow.disabled).toBe(false);
    expect(ScriptRegistry.isRunning('test.llm.tv-glow')).toBe(true);
    expect(fixture.messages).toContain('The TV hums awake.');
    ScriptRegistry.stop('test.llm.tv-glow');
    ScriptRegistry.stop('test.llm.tv-power');
  });

  it('passes prior scene-local parser turns to LLM context', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.game.console.parserLlmEnabled = true;
    fixture.scene.addParserRecentTurn('look radio', 'The radio hisses.');

    const mockLlmParse = vi.fn().mockResolvedValue({
      stage: 'llm-v3',
      output: { kind: 'plan', actions: [{ type: 'showText', message: 'LLM Result' }] },
      debug: { rawInput: 'SENSEI', normalizedInput: 'SENSEI', verb: 'LLM', noun: '' },
    });
    fixture.parser.llmCascade.parse = mockLlmParse;

    await fixture.parser.parse('SENSEI');

    expect(mockLlmParse.mock.calls[0]?.[1].scene?.recentTurns).toEqual([
      { command: 'look radio', response: 'The radio hisses.' },
    ]);
    expect(fixture.scene.getParserRecentTurns().at(-1)).toEqual({
      command: 'SENSEI',
      response: 'LLM Result',
    });
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

  it('executes Parser Note actions and includes notes in later LLM context', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.game.console.parserLlmEnabled = true;
    fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'A radio and cassette recorder.',
    });

    const mockLlmParse = vi
      .fn()
      .mockResolvedValueOnce({
        stage: 'llm-v3',
        output: {
          kind: 'plan',
          actions: [
            {
              type: 'setEntityParserNote',
              entityId: 'boombox',
              note: 'Radio reception currently produces only static.',
            },
            {
              type: 'showText',
              message: 'You turn the dial. Static takes every station personally.',
            },
          ],
        },
        debug: { rawInput: 'listen radio', normalizedInput: 'LISTEN RADIO', verb: 'LLM', noun: '' },
      })
      .mockResolvedValueOnce({
        stage: 'llm-v3',
        output: {
          kind: 'plan',
          actions: [{ type: 'showText', message: 'The static is still there.' }],
        },
        debug: {
          rawInput: 'listen radio again',
          normalizedInput: 'LISTEN RADIO AGAIN',
          verb: 'LLM',
          noun: '',
        },
      });
    fixture.parser.llmCascade.parse = mockLlmParse;

    await fixture.parser.parse('listen radio');
    await fixture.parser.parse('listen radio again');

    expect(fixture.scene.getEntityParserNote('boombox')).toBe(
      'Radio reception currently produces only static.'
    );
    expect(fixture.messages).toContain('You turn the dial. Static takes every station personally.');
    const secondContext = mockLlmParse.mock.calls[1]?.[1];
    expect(secondContext.entities?.find((entity: any) => entity.id === 'boombox')?.parserNote).toBe(
      'Radio reception currently produces only static.'
    );
  });

  it('executes fenced provider Parser Note plans and exposes the note on the next LLM call', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.game.console.parserLlmEnabled = true;
    fixture.addEntity('boombox', {
      title: 'Boombox',
      synonyms: ['radio'],
      description: 'A radio and cassette recorder.',
    });

    const provider = {
      response: { ok: true, text: '', model: 'mock', durationMs: 10 },
      messages: [] as any[],
      system: '' as any,
      isAvailable: () => true,
      getProviderName: () => 'Mock',
      getModelName: () => 'mock-model',
      sendMessageStream: async (system: any, messages: any[]) => {
        provider.system = system;
        provider.messages = messages;
        return provider.response;
      },
    };
    (fixture.parser.llmCascade as any).provider = provider;
    provider.response.text = `\`\`\`json
{
  "kind": "plan",
  "actions": [
    {
      "type": "showText",
      "message": "You reach over and flip on the boombox. The dial catches a station mid-song."
    },
    {
      "type": "setEntityParserNote",
      "entityId": "boombox",
      "note": "Radio is currently on, tuned to a station playing 80s pop and new wave music."
    }
  ]
}
\`\`\``;

    await fixture.parser.parse('listen radio');

    expect(fixture.messages).toContain(
      'You reach over and flip on the boombox. The dial catches a station mid-song.'
    );
    expect(fixture.scene.getEntityParserNote('boombox')).toBe(
      'Radio is currently on, tuned to a station playing 80s pop and new wave music.'
    );

    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [{ type: 'showText', message: 'The same station keeps breathing.' }],
    });

    await fixture.parser.parse('listen radio');

    const promptContent = String(provider.messages[0]?.content || '');
    expect(promptContent).toContain(
      'Radio is currently on, tuned to a station playing 80s pop and new wave music.'
    );
  });

  it('preserves implementation-detail Parser Notes for debugging visibility', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.game.console.parserLlmEnabled = true;
    fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'A radio and cassette recorder.',
    });

    fixture.parser.llmCascade.parse = vi.fn().mockResolvedValue({
      stage: 'llm-v3',
      output: {
        kind: 'plan',
        actions: [
          {
            type: 'setEntityParserNote',
            entityId: 'boombox',
            note: 'Player attempted to listen to radio. No active mechanic exists. Treat as examine for now.',
          },
          {
            type: 'showText',
            message: 'You turn the dial. Static answers with professional indifference.',
          },
        ],
      },
      debug: { rawInput: 'listen radio', normalizedInput: 'LISTEN RADIO', verb: 'LLM', noun: '' },
    });

    await fixture.parser.parse('listen radio');

    expect(fixture.scene.getEntityParserNote('boombox')).toBe(
      'Player attempted to listen to radio. No active mechanic exists. Treat as examine for now.'
    );
    expect(fixture.messages).toContain(
      'You turn the dial. Static answers with professional indifference.'
    );
  });

  it('shows structured Parser Note effects in #PEEK-ON debug output', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.game.console.parserLlmEnabled = true;
    fixture.game.console.parserPeekEnabled = true;
    fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'A radio and cassette recorder.',
    });
    const debugLogs: string[] = [];
    fixture.game.console.log = (text: string) => {
      debugLogs.push(text);
    };

    fixture.parser.llmCascade.parse = vi.fn().mockResolvedValue({
      stage: 'llm-v3',
      output: {
        kind: 'plan',
        actions: [
          {
            type: 'setEntityParserNote',
            entityId: 'boombox',
            note: 'Radio reception currently produces only static.',
          },
          { type: 'showText', message: 'Only static comes back.' },
        ],
      },
      debug: { rawInput: 'listen radio', normalizedInput: 'LISTEN RADIO', verb: 'LLM', noun: '' },
    });

    await fixture.parser.parse('listen radio');

    expect(debugLogs.join('\n')).toContain('"operation": "created"');
    expect(debugLogs.join('\n')).toContain('"id": "boombox"');
    expect(debugLogs.join('\n')).toContain(
      '"note": "Radio reception currently produces only static."'
    );
  });

  it('shows accepted Parser Note actions and mutations in #PEEKLLM debug output', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.game.console.parserLlmEnabled = true;
    fixture.game.console.parserPeekLlmEnabled = true;
    fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'A radio and cassette recorder.',
    });
    const debugLogs: string[] = [];
    fixture.game.console.log = (text: string) => {
      debugLogs.push(text);
    };

    fixture.parser.llmCascade.parse = vi.fn().mockResolvedValue({
      stage: 'llm-v3',
      output: {
        kind: 'plan',
        actions: [
          {
            type: 'setEntityParserNote',
            entityId: 'boombox',
            note: 'Radio reception currently produces only static.',
          },
          { type: 'showText', message: 'Only static comes back.' },
        ],
      },
      debug: { rawInput: 'listen radio', normalizedInput: 'LISTEN RADIO', verb: 'LLM', noun: '' },
    });
    fixture.parser.llmCascade.getLastDebugInfo = vi.fn().mockReturnValue({
      provider: 'Mock',
      model: 'mock-model',
      rawResponse:
        '```json\n{"kind":"plan","actions":[{"type":"setEntityParserNote","entityId":"boombox","note":"Radio reception currently produces only static."},{"type":"showText","message":"Only static comes back."}]}\n```',
      extractedJson:
        '{"kind":"plan","actions":[{"type":"setEntityParserNote","entityId":"boombox","note":"Radio reception currently produces only static."},{"type":"showText","message":"Only static comes back."}]}',
      acceptedActions: [
        {
          type: 'setEntityParserNote',
          entityId: 'boombox',
          note: 'Radio reception currently produces only static.',
        },
        { type: 'showText', message: 'Only static comes back.' },
      ],
      filteredActions: [],
    });

    await fixture.parser.parse('listen radio');

    const output = debugLogs.join('\n');
    expect(output).toContain('"acceptedActions"');
    expect(output).toContain('"setEntityParserNote"');
    expect(output).toContain('"parserNoteMutations"');
    expect(output).toContain('"operation": "created"');
    expect(output).toContain('"note": "Radio reception currently produces only static."');
  });

  it('shows only Parser Note context and mutations when #PEEKPN-ON is enabled', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.game.console.parserLlmEnabled = true;
    fixture.game.console.parserPeekPnEnabled = true;
    fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'A radio and cassette recorder.',
    });
    fixture.scene.setEntityParserNote('boombox', 'Radio reception is already only static.');
    const debugLogs: string[] = [];
    fixture.game.console.log = (text: string) => {
      debugLogs.push(text);
    };

    fixture.parser.llmCascade.parse = vi.fn().mockResolvedValue({
      stage: 'llm-v3',
      output: {
        kind: 'plan',
        actions: [
          {
            type: 'setEntityParserNote',
            entityId: 'boombox',
            note: 'Radio reception now includes a weak sermon under the static.',
          },
          { type: 'showText', message: 'A sermon limps through the static.' },
        ],
      },
      debug: { rawInput: 'listen radio', normalizedInput: 'LISTEN RADIO', verb: 'LLM', noun: '' },
    });

    await fixture.parser.parse('listen radio');

    const output = debugLogs.join('\n');
    expect(output).toContain('--- PARSER NOTES CONTEXT ---');
    expect(output).toContain('"operation": "context"');
    expect(output).toContain('"id": "boombox"');
    expect(output).toContain('"note": "Radio reception is already only static."');
    expect(output).toContain('--- PARSER NOTES MUTATIONS ---');
    expect(output).toContain('"operation": "updated"');
    expect(output).toContain(
      '"note": "Radio reception now includes a weak sermon under the static."'
    );
    expect(output).not.toContain('--- CONTEXT ---');
    expect(output).not.toContain('--- RESULT ---');
  });

  it('marks touched object Parser Notes as needing check after standard parser mutations', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.game.console.parserPeekPnEnabled = true;
    fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'A radio and cassette recorder.',
      components: [{ type: 'Inventory', relation: 'in' }],
    });
    fixture.addEntity('cassette', {
      title: 'Compact cassette',
      synonyms: ['cassete'],
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'boombox', relation: 'in' },
    });
    fixture.game.addInventoryEntity(
      fixture.scene.getObjectByName('boombox') as any,
      fixture.scene.getObjectByName('cassette') as any
    );
    fixture.scene.setEntityParserNote('boombox', 'The cassette inside has been stopped.');
    const debugLogs: string[] = [];
    fixture.game.console.log = (text: string) => {
      debugLogs.push(text);
    };

    await fixture.parser.parse('take cassette from boombox');

    expect(fixture.scene.getEntityParserNote('boombox')).toBe(
      'The cassette inside has been stopped.'
    );
    expect(fixture.scene.getEntityParserNoteNeedsCheck('boombox')).toBe(true);
    const output = debugLogs.join('\n');
    expect(output).toContain('--- PARSER NOTES MUTATIONS ---');
    expect(output).toContain('"operation": "needsCheck"');
    expect(output).toContain('"id": "boombox"');
    expect(output).toContain('"needsCheck": true');
  });
});
