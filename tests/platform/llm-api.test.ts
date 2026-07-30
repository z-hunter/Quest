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
      { body: '{"model":"qwen2.5:3b"}', timeoutMs: 42 },
      fallbackFetch
    );

    expect(invokeTauri).toHaveBeenCalledWith('invoke_llm', {
      request: expect.objectContaining({
        provider: 'ollama',
        payload: { model: 'qwen2.5:3b' },
        timeoutMs: 42,
      }),
    });
    expect(fallbackFetch).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ ok: true });
  });

  it('aborts a native request and asks Rust to cancel it', async () => {
    let resolveNative!: (value: unknown) => void;
    invokeTauri.mockImplementation((command: string) =>
      command === 'invoke_llm'
        ? new Promise((resolve) => {
            resolveNative = resolve;
          })
        : Promise.resolve()
    );
    const controller = new AbortController();
    const request = fetchLlm('ollama', 'http://localhost', { signal: controller.signal }, vi.fn());

    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(invokeTauri).toHaveBeenCalledWith('cancel_invoke_llm', {
      requestId: expect.any(String),
    });
    resolveNative({ status: 200, headers: {}, body: '{}' });
  });
});
