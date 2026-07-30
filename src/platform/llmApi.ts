import { invokeTauri, isTauriRuntime } from './fileApi';

type NativeLlmResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export async function fetchLlm(
  provider: 'anthropic' | 'ollama',
  url: RequestInfo | URL,
  init: RequestInit | undefined,
  fallbackFetch: typeof fetch
): Promise<Response> {
  if (!isTauriRuntime()) return fallbackFetch(url, init);

  const payload = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
  // ponytail: buffered IPC response; add Tauri event streaming only if live token latency matters.
  const response = await invokeTauri<NativeLlmResponse>('invoke_llm', {
    request: { provider, payload },
  });
  return new Response(response.body, { status: response.status, headers: response.headers });
}
