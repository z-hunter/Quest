import { describe, expect, it, vi } from 'vitest';

const { invokeTauri } = vi.hoisted(() => ({ invokeTauri: vi.fn() }));

vi.mock('../../src/platform/fileApi', () => ({
  isTauriRuntime: () => true,
  invokeTauri,
}));

import { fetchLlm } from '../../src/platform/llmApi';

describe('fetchLlm', () => {
  it('routes a Tauri request through the native command', async () => {
    invokeTauri.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}',
    });
    const fallbackFetch = vi.fn();

    const response = await fetchLlm(
      'ollama',
      'http://localhost:11434/v1/chat/completions',
      { body: '{"model":"qwen2.5:3b"}' },
      fallbackFetch
    );

    expect(invokeTauri).toHaveBeenCalledWith('invoke_llm', {
      request: { provider: 'ollama', payload: { model: 'qwen2.5:3b' } },
    });
    expect(fallbackFetch).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ ok: true });
  });
});
