import { describe, it, expect, vi } from 'vitest';
import { OllamaProvider } from '../../src/mechanics/llm/OllamaProvider';

describe('OllamaProvider', () => {
  it('correctly formats request and handles successful OpenAI-compatible response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'qwen2.5:3b',
        choices: [
          {
            message: {
              role: 'assistant',
              content: '{"kind":"plan","actions":[]}',
            },
          },
        ],
        usage: {
          prompt_tokens: 150,
          completion_tokens: 25,
        },
      }),
    });

    const provider = new OllamaProvider({ fetchImpl: mockFetch as any });
    const res = await provider.sendMessage('System prompt', [
      { role: 'user', content: 'LOOK AROUND' },
    ]);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const callArgs = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callArgs.model).toBe('qwen2.5:3b');
    expect(callArgs.response_format).toEqual({ type: 'json_object' });
    expect(callArgs.messages).toEqual([
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'LOOK AROUND' },
    ]);

    expect(res.ok).toBe(true);
    expect(res.text).toBe('{"kind":"plan","actions":[]}');
    expect(res.tokensGenerated).toBe(25);
    expect(res.inputTokens).toBe(150);
  });

  it('handles HTTP error gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const provider = new OllamaProvider({ fetchImpl: mockFetch as any });
    const res = await provider.sendMessage('sys', []);

    expect(res.ok).toBe(false);
    expect(res.error).toBe('Internal Server Error');
    expect(res.reason).toBe('unavailable');
    expect(res.retryable).toBe(true);
  });
});
