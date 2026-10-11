import { invokeTauri, isTauriRuntime } from './fileApi';

type NativeLlmResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type LlmRequestInit = RequestInit & { timeoutMs?: number };

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

export async function fetchLlm(
  provider: 'anthropic' | 'ollama',
  url: RequestInfo | URL,
  init: LlmRequestInit | undefined,
  fallbackFetch: typeof fetch
): Promise<Response> {
  if (!isTauriRuntime()) return fallbackFetch(url, init);

  if (init?.signal?.aborted) throw abortError();

  const payload = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
  const requestId = crypto.randomUUID();
  // ponytail: buffered IPC response; add Tauri event streaming only if live token latency matters.
  const pending = invokeTauri<NativeLlmResponse>('invoke_llm', {
    request: { provider, payload, requestId, timeoutMs: init?.timeoutMs },
  });
  const signal = init?.signal;
  if (!signal) {
    const response = await pending;
    return new Response(response.body, { status: response.status, headers: response.headers });
  }

  const response = await new Promise<NativeLlmResponse>((resolve, reject) => {
    const abort = () => {
      void invokeTauri('cancel_invoke_llm', { requestId }).catch(() => {});
      reject(abortError());
    };
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
  return new Response(response.body, { status: response.status, headers: response.headers });
}
