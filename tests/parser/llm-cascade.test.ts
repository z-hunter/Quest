import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LlmCascade } from '../../src/mechanics/LlmCascade';
import { AnthropicProvider } from '../../src/mechanics/llm/AnthropicProvider';
import type {
  ILlmProvider,
  LlmProviderMessage,
  LlmProviderResponse,
  LlmStreamDeltaCallback,
} from '../../src/mechanics/llm/ILlmProvider';
import type { ParserContext } from '../../src/mechanics/parserTypes';

class MockProvider implements ILlmProvider {
  response: LlmProviderResponse = { ok: true, text: '', model: 'mock', durationMs: 10 };
  messages: LlmProviderMessage[] = [];

  isAvailable() {
    return true;
  }
  getProviderName() {
    return 'Mock';
  }
  getModelName() {
    return 'mock-model';
  }

  async sendMessage(_system: string, messages: LlmProviderMessage[]): Promise<LlmProviderResponse> {
    this.messages = messages;
    return this.response;
  }

  async sendMessageStream(
    _system: string,
    messages: LlmProviderMessage[],
    onDelta: LlmStreamDeltaCallback
  ): Promise<LlmProviderResponse> {
    this.messages = messages;
    if (this.response.ok && this.response.text) {
      onDelta(this.response.text, this.response.text);
    }
    return this.response;
  }
}

describe('LlmCascade', () => {
  let provider: MockProvider;
  let cascade: LlmCascade;
  const mockPromptAssets = {
    previous_attempt_label: 'Previous parser attempt:',
    forced_handoff_label: 'Lower cascade interpretation:',
    forced_handoff_instructions: [
      'Cascade 1 test mode asks you to handle this command yourself.',
      'Use the lower cascade interpretation as a hint for what the dry machine parser would do.',
      'If you can give a richer, more atmospheric, and still grounded response, prefer final_response or showText.',
      'If the lower cascade action is genuinely the best answer, you may return that action plan.',
      "If the player's intent is recognized but no exact standard action fits it, invent a short atmospheric and logical Game Master response instead of calling a merely adjacent standard action.",
      'If you cannot improve the lower cascade result safely, return fallback.',
    ],
    post_api_escalation_instructions: [
      'The previous parser/game attempt escalated instead of completing.',
      'Do not repeat the same failing action unless you intentionally corrected the target, relation, or intent.',
      'If the requested action is impossible in the current world, return final_response or a showText action with a short in-world reason.',
    ],
    post_api_not_found_instructions: [
      'The previous parser/game attempt reported that it could not see the target. This often means the lower cascade misread a verb, adjective, or phrase fragment as the noun.',
      'Do not repeat the same failing action unless you intentionally corrected the target, relation, or intent.',
    ],
    post_api_recovery_instructions: [
      'The previous parser/game attempt recognized a command but ended in a recoverable failed outcome.',
      'First decide whether the lower parser likely misunderstood the player intent, target, relation, or action.',
      'If the intent and target are correct but the game outcome says the action is impossible, do not override game state.',
      'If you cannot improve the previous attempt safely or interestingly, return fallback.',
    ],
    world_fact_instructions: [
      'World facts are authoritative, including semantic facts generated from Text Assets.',
      'context.scene.recentTurns contains the last player-facing command/response turns from this current scene visit only.',
      'Before saying that a required object is missing, not loaded, not inserted, not fueled, empty, or unavailable, check worldFacts and entity contents/location.',
      'If an item is in inventory, it is held by the player character and is not inside or connected to a scene object unless the context explicitly says so.',
    ],
    parser_note_instructions: [
      'Parser Notes are private runtime memory for the parser Game Master.',
      'Entity Parser Notes must describe only that entity.',
      'A Parser Note with parserNoteNeedsCheck: true may be stale because the object or scene changed after the note was written.',
      "When any Parser Note in context has parserNoteNeedsCheck: true, resolving that stale note is part of the current task even if the player's command does not mention that object.",
    ],
    response_reminder: 'Respond with a single JSON object. Do not add any text outside the JSON.',
  };
  const mockContext: ParserContext = {
    rawInput: '',
    normalizedInput: '',
    entities: [],
    spatialNodes: [],
    inventory: [],
  };

  beforeEach(() => {
    provider = new MockProvider();
    cascade = new LlmCascade(
      provider,
      () =>
        ({
          readServiceAsset: vi.fn().mockResolvedValue(mockPromptAssets),
        }) as any,
      () => undefined
    );
  });

  it('accepts a valid plan response', async () => {
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [{ type: 'lookTarget', target: 'Logo' }],
    });

    const result = await cascade.parse('look at logo', mockContext);

    expect(result).not.toBeNull();
    expect(result?.output.kind).toBe('plan');
    expect(result?.output.actions).toEqual([{ type: 'lookTarget', target: 'Logo' }]);

    const debug = cascade.getLastDebugInfo();
    expect(debug?.matched).toBe(true);
    expect(debug?.acceptedActions).toHaveLength(1);
  });

  it('keeps prompt assets free of implementation-leaking unsupported-action phrases', () => {
    const systemPrompt = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm-system.md'),
      'utf8'
    );
    const promptAsset = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm.json'),
      'utf8'
    );
    const combined = `${systemPrompt}\n${promptAsset}`.toLowerCase();

    expect(combined).not.toContain('no listening action');
    expect(combined).not.toContain('no active');
    expect(combined).not.toContain('mechanic exists');
    expect(combined).not.toContain('treat as examine');
    expect(combined).not.toContain('available parser actions');
    expect(combined).not.toContain('unrelated engine action');
    expect(combined).not.toContain('available engine actions');
    expect(combined).toContain('never mention parser mechanics');
    expect(combined).toContain('the boombox currently produces only static when tuned to radio');
  });

  it('frames the LLM as a creative Game Master before action mapping', () => {
    const systemPrompt = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm-system.md'),
      'utf8'
    );
    const promptAsset = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm.json'),
      'utf8'
    );
    const combined = `${systemPrompt}\n${promptAsset}`;

    expect(systemPrompt).toContain('You are a creative Game Master');
    expect(systemPrompt).toContain('use every safe opportunity to immerse the player');
    expect(systemPrompt).not.toContain('You are not just a command parser');
    expect(combined).toContain(
      "If the player's intent is recognized but no exact standard action fits it"
    );
    expect(combined).toContain(
      'invent a short atmospheric and logical Game Master response instead of calling a merely adjacent standard action'
    );
  });

  it('keeps prompt assets explicit that Parser Notes are not temporary player state', () => {
    const systemPrompt = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm-system.md'),
      'utf8'
    );
    const promptAsset = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm.json'),
      'utf8'
    );
    const combined = `${systemPrompt}\n${promptAsset}`;

    expect(combined).toContain('Entity Parser Notes must describe only that entity');
    expect(combined).toContain('Scene Parser Notes must describe only the scene or area');
    expect(combined).toContain('Do not store temporary player character actions');
    expect(combined).toContain('Narrate those moments in `showText` or `final_response`');
    expect(combined).toContain(
      'Bad Parser Note: `The player character is currently sitting on the sofa.`'
    );
    expect(combined).toContain(
      'Good Parser Note: `The sofa cushion has a shallow, temporary crease from being sat on.`'
    );
  });

  it('keeps prompt assets explicit that stale Parser Notes must be checked', () => {
    const systemPrompt = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm-system.md'),
      'utf8'
    );
    const promptAsset = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm.json'),
      'utf8'
    );
    const combined = `${systemPrompt}\n${promptAsset}`;

    expect(combined).toContain('parserNoteNeedsCheck: true');
    expect(combined).toContain('resolving that stale note is part of the current task');
    expect(combined).toContain('Before giving the player-facing answer');
    expect(combined).toContain('replace it with a corrected note');
    expect(combined).toContain('clear it with an empty Parser Note');
    expect(combined).toContain('Do not leave a checked false Parser Note unchanged');
    expect(combined).toContain('if a note says a cassette inside a device is playing');
  });

  it('keeps prompt assets explicit that spatial world model beats word matching', () => {
    const systemPrompt = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm-system.md'),
      'utf8'
    );
    const promptAsset = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm.json'),
      'utf8'
    );
    const combined = `${systemPrompt}\n${promptAsset}`.toLowerCase();

    expect(combined).toContain('the physical model of the current scene');
    expect(combined).toContain('logical association');
    expect(combined).toContain('matching nouns');
    expect(combined).toContain('if an item is in inventory');
    expect(combined).toContain('held by the player character');
    expect(combined).toContain('not inside or connected to a scene object unless');
    expect(combined).toContain('do not claim that a scene object uses an unrelated inventory item');
    expect(combined).toContain('do not let word matches override the world model');
  });

  it('stores the full prompt and raw response in debug info', async () => {
    provider.response.text = JSON.stringify({
      kind: 'final_response',
      message: 'Full response text.',
    });

    await cascade.parse('speak to the terminal', mockContext);

    const debug = cascade.getLastDebugInfo();
    expect(debug?.prompt?.system).toContain('Respond with exactly one JSON object');
    expect(debug?.prompt?.messages[0]?.role).toBe('user');
    expect(debug?.prompt?.messages[0]?.content).toContain(
      'Player command: "speak to the terminal"'
    );
    expect(debug?.prompt?.messages[0]?.content).toContain('World facts are authoritative');
    expect(debug?.prompt?.messages[0]?.content).toContain(
      'If an item is in inventory, it is held by the player character'
    );
    expect(debug?.prompt?.messages[0]?.content).toContain(
      'Parser Notes are private runtime memory'
    );
    expect(debug?.prompt?.messages[0]?.content).toContain('context.scene.recentTurns');
    expect(debug?.rawResponse).toBe(provider.response.text);
  });

  it('converts final_response to a showText action', async () => {
    provider.response.text = JSON.stringify({
      kind: 'final_response',
      message: 'This is a final message.',
    });

    const result = await cascade.parse('hello', mockContext);

    expect(result?.output.actions).toEqual([
      { type: 'showText', message: 'This is a final message.' },
    ]);
  });

  it('converts clarification to a showText action', async () => {
    provider.response.text = JSON.stringify({
      kind: 'clarification',
      question: 'Which one do you mean?',
    });

    const result = await cascade.parse('take it', mockContext);

    expect(result?.output.actions).toEqual([
      { type: 'showText', message: 'Which one do you mean?' },
    ]);
  });

  it('accepts Parser Note actions in a plan response', async () => {
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [
        { type: 'setSceneParserNote', note: 'The room has a sour electrical smell.' },
        { type: 'setEntityParserNote', entityId: 'boombox', note: 'Radio reception is static.' },
        { type: 'showText', message: 'Only static answers.' },
      ],
    });

    const result = await cascade.parse('listen radio', mockContext);

    expect(result?.output.actions).toEqual([
      { type: 'setSceneParserNote', note: 'The room has a sour electrical smell.' },
      { type: 'setEntityParserNote', entityId: 'boombox', note: 'Radio reception is static.' },
      { type: 'showText', message: 'Only static answers.' },
    ]);
  });

  it('filters invalid Parser Note actions', async () => {
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [
        { type: 'setSceneParserNote', note: 42 },
        { type: 'setEntityParserNote', entityId: '', note: 'No target.' },
        { type: 'showText', message: 'Still narrates.' },
      ],
    });

    const result = await cascade.parse('listen radio', mockContext);

    expect(result?.output.actions).toEqual([{ type: 'showText', message: 'Still narrates.' }]);
    expect(cascade.getLastDebugInfo()?.filteredActions).toHaveLength(2);
  });

  it('rejects Parser Note plans that do not include player-facing showText', async () => {
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [
        {
          type: 'setEntityParserNote',
          entityId: 'boombox',
          note: 'Radio is now on and tuned to a grainy jazz station.',
        },
        { type: 'examineTarget', target: 'Boombox' },
      ],
    });

    const result = await cascade.parse('listen radio', mockContext);

    expect(result).toBeNull();
    expect(cascade.getLastDebugInfo()?.filteredActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'parser_note_plan_requires_showText',
        }),
      ])
    );
  });

  it('filters ordinary world actions from Parser Note plans that include showText', async () => {
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [
        {
          type: 'setEntityParserNote',
          entityId: 'boombox',
          note: 'Radio is now on and tuned to a grainy jazz station.',
        },
        { type: 'examineTarget', target: 'Boombox' },
        { type: 'showText', message: 'Static and thin jazz crawl out of the speaker.' },
      ],
    });

    const result = await cascade.parse('listen radio', mockContext);

    expect(result?.output.actions).toEqual([
      {
        type: 'setEntityParserNote',
        entityId: 'boombox',
        note: 'Radio is now on and tuned to a grainy jazz station.',
      },
      { type: 'showText', message: 'Static and thin jazz crawl out of the speaker.' },
    ]);
    expect(cascade.getLastDebugInfo()?.filteredActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'parser_note_plan_omits_world_actions',
        }),
      ])
    );
  });

  it('treats explicit fallback as no LLM envelope', async () => {
    provider.response.text = JSON.stringify({ kind: 'fallback' });

    const result = await cascade.parse('take book', mockContext);

    expect(result).toBeNull();
    const debug = cascade.getLastDebugInfo();
    expect(debug?.matched).toBe(false);
    expect(debug?.reason).toBe('fallback');
    expect(debug?.error).toBeUndefined();
    expect(debug?.filteredActions).toEqual([]);
  });

  it('returns null and populates debug reason invalid_response for invalid JSON', async () => {
    provider.response.text = 'Not a JSON';

    const result = await cascade.parse('invalid', mockContext);

    expect(result).toBeNull();
    const debug = cascade.getLastDebugInfo();
    expect(debug?.reason).toBe('invalid_response');
    expect(debug?.error).toContain('valid JSON');
  });

  it('returns null and populates debug reason invalid_response for invalid shape', async () => {
    provider.response.text = JSON.stringify({ kind: 'plan', actions: 'not-actions' });

    const result = await cascade.parse('invalid shape', mockContext);

    expect(result).toBeNull();
    const debug = cascade.getLastDebugInfo();
    expect(debug?.reason).toBe('invalid_response');
    expect(debug?.filteredActions).toHaveLength(1);
  });

  it('returns null and populates api_error debug for provider error', async () => {
    provider.response = {
      ok: false,
      text: '',
      model: 'mock',
      error: 'API failure',
      reason: 'api_error',
      durationMs: 100,
    };

    const result = await cascade.parse('error', mockContext);

    expect(result).toBeNull();
    const debug = cascade.getLastDebugInfo();
    expect(debug?.reason).toBe('api_error');
    expect(debug?.error).toBe('API failure');
  });

  it('returns null and populates timeout debug for provider timeout', async () => {
    provider.response = {
      ok: false,
      text: '',
      model: 'mock',
      error: 'Request timed out',
      reason: 'timeout',
      durationMs: 10000,
    };

    const result = await cascade.parse('timeout', mockContext);

    expect(result).toBeNull();
    const debug = cascade.getLastDebugInfo();
    expect(debug?.reason).toBe('timeout');
    expect(debug?.error).toBe('Request timed out');
  });

  it('filters unknown action types and shows remaining in debug', async () => {
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [
        { type: 'lookTarget', target: 'Logo' },
        { type: 'unknownAction', data: 'junk' },
      ],
    });

    const result = await cascade.parse('look logo', mockContext);

    expect(result?.output.actions).toHaveLength(1);
    expect(result?.output.actions[0].type).toBe('lookTarget');

    const debug = cascade.getLastDebugInfo();
    expect(debug?.acceptedActions).toHaveLength(1);
    expect(debug?.filteredActions).toHaveLength(1);
    expect((debug?.filteredActions?.[0] as any).type).toBe('unknownAction');
  });

  it('includes previous escalation details when retrying after a parser attempt', async () => {
    provider.response.text = JSON.stringify({
      kind: 'final_response',
      message: 'The window has retired from public service.',
    });

    await cascade.parse('open window', mockContext, undefined, {
      envelope: {
        stage: 'regex-v1',
        output: {
          kind: 'plan',
          actions: [{ type: 'openTarget', target: 'Window' }],
        },
        debug: {
          rawInput: 'open window',
          normalizedInput: 'OPEN WINDOW',
          verb: 'OPEN',
          noun: 'window',
        },
      },
      result: {
        type: 'outcomes',
        outcomes: [{ status: 'escalate', code: 'target_is_not_switch' }],
      },
    });

    const userMessage = provider.messages[0]?.content || '';
    expect(userMessage).toContain('Previous parser attempt');
    expect(userMessage).toContain('target_is_not_switch');
    expect(userMessage).toContain('Do not repeat the same failing action');
  });

  it('includes lower cascade interpretation in forced C1 handoff mode', async () => {
    provider.response.text = JSON.stringify({
      kind: 'final_response',
      message: 'There is more than one way to look.',
    });

    await cascade.parse('look in window', mockContext, undefined, {
      kind: 'forced_cascade_handoff',
      envelope: {
        stage: 'regex-v1',
        output: {
          kind: 'plan',
          actions: [{ type: 'lookRelationTarget', relation: 'in', anchor: 'window' }],
        },
        debug: {
          rawInput: 'look in window',
          normalizedInput: 'LOOK IN WINDOW',
          verb: 'LOOK',
          noun: 'window',
        },
      },
      result: {
        type: 'forced_cascade_handoff',
        reason: 'c1_off',
      },
    });

    const userMessage = provider.messages[0]?.content || '';
    expect(userMessage).toContain('Lower cascade interpretation');
    expect(userMessage).toContain('lookRelationTarget');
    expect(userMessage).toContain('Cascade 1 test mode asks you to handle this command yourself');
    expect(userMessage).toContain('richer, more atmospheric');
    expect(userMessage).toContain('you may return that action plan');
  });

  it('includes recovery instructions for recoverable failed parser attempts', async () => {
    provider.response.text = JSON.stringify({
      kind: 'fallback',
    });

    await cascade.parse('take book', mockContext, undefined, {
      kind: 'post_api_recovery',
      envelope: {
        stage: 'regex-v1',
        output: {
          kind: 'plan',
          actions: [{ type: 'takeTarget', target: 'Book' }],
        },
        debug: {
          rawInput: 'take book',
          normalizedInput: 'TAKE BOOK',
          verb: 'TAKE',
          noun: 'book',
        },
      },
      result: {
        type: 'outcomes',
        outcomes: [{ status: 'failed', code: 'cannot_take', message: 'You cannot take that.' }],
      },
    });

    const userMessage = provider.messages[0]?.content || '';
    expect(userMessage).toContain('Previous parser attempt');
    expect(userMessage).toContain('cannot_take');
    expect(userMessage).toContain('recoverable failed outcome');
    expect(userMessage).toContain('return fallback');
  });
});

describe('AnthropicProvider', () => {
  it('parses SSE content_block_delta chunks', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const emit = (event: string, data: unknown) => {
            controller.enqueue(encoder.encode(`event: ${event}\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          };
          emit('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: '{"kind":' },
          });
          emit('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: ' "plan"}' },
          });
          emit('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 15 },
          });
          controller.close();
        },
      }),
    });

    const provider = new AnthropicProvider({ fetchImpl: mockFetch });
    const deltas: string[] = [];
    const response = await provider.sendMessageStream(
      'system',
      [{ role: 'user', content: 'hi' }],
      (d) => deltas.push(d)
    );

    expect(response.ok).toBe(true);
    expect(response.text).toBe('{"kind": "plan"}');
    expect(deltas).toEqual(['{"kind":', ' "plan"}']);
    expect(response.tokensGenerated).toBe(15);
  });
});
