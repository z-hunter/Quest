import { describe, it, expect, vi, beforeEach } from 'vitest';
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
      () => undefined,
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
