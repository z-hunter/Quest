import type {
  ILlmProvider,
  LlmProviderMessage,
  LlmProviderResponse,
  LlmStreamDeltaCallback,
} from './ILlmProvider';

const DEFAULT_PROXY_URL = '/api/llm';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 10000;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type AnthropicProviderOptions = {
  proxyUrl?: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
};

type SseEvent = {
  event: string;
  data: string;
};

export class AnthropicProvider implements ILlmProvider {
  private proxyUrl: string;
  private model: string;
  private maxTokens: number;
  private timeoutMs: number;
  private fetchImpl: FetchLike;

  constructor(options: AnthropicProviderOptions = {}) {
    this.proxyUrl = options.proxyUrl || DEFAULT_PROXY_URL;
    this.model = options.model || DEFAULT_MODEL;
    this.maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl || fetch.bind(globalThis);
  }

  sendMessage(system: string, messages: LlmProviderMessage[]): Promise<LlmProviderResponse> {
    return this.sendMessageStream(system, messages, () => {});
  }

  async sendMessageStream(
    system: string,
    messages: LlmProviderMessage[],
    onDelta: LlmStreamDeltaCallback
  ): Promise<LlmProviderResponse> {
    const startedAt = this.nowMs();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          system,
          messages,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          ok: false,
          text: '',
          model: this.model,
          error: errorText || `LLM proxy returned HTTP ${response.status}`,
          reason: 'api_error',
          durationMs: this.nowMs() - startedAt,
        };
      }

      if (!response.body) {
        const text = await response.text();
        return {
          ok: true,
          text,
          model: this.model,
          durationMs: this.nowMs() - startedAt,
        };
      }

      const streamResult = await this.readSseStream(response.body, onDelta);
      if (streamResult.error) {
        return {
          ok: false,
          text: streamResult.text,
          model: this.model,
          error: streamResult.error,
          reason: 'api_error',
          durationMs: this.nowMs() - startedAt,
          tokensGenerated: streamResult.tokensGenerated,
        };
      }

      return {
        ok: true,
        text: streamResult.text,
        model: this.model,
        durationMs: this.nowMs() - startedAt,
        tokensGenerated: streamResult.tokensGenerated,
      };
    } catch (error) {
      const errorName = error instanceof Error ? error.name : '';
      const isAbort = errorName === 'AbortError';
      return {
        ok: false,
        text: '',
        model: this.model,
        error: isAbort ? 'Request timed out' : String(error),
        reason: isAbort ? 'timeout' : 'api_error',
        durationMs: this.nowMs() - startedAt,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  isAvailable(): boolean {
    return true;
  }

  getProviderName(): string {
    return 'Anthropic (proxy)';
  }

  getModelName(): string {
    return this.model;
  }

  private async readSseStream(
    body: ReadableStream<Uint8Array>,
    onDelta: LlmStreamDeltaCallback
  ): Promise<{ text: string; error?: string; tokensGenerated?: number }> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = '';
    let currentEvent = '';
    let currentDataLines: string[] = [];
    let accumulated = '';
    let error: string | undefined;
    let tokensGenerated: number | undefined;

    const dispatch = (event: SseEvent) => {
      const parsed = this.parseEventData(event.data);
      if (!parsed) return;

      if (event.event === 'content_block_delta') {
        const delta = parsed.delta;
        const text = typeof delta?.text === 'string' ? delta.text : '';
        if (text) {
          accumulated += text;
          onDelta(text, accumulated);
        }
        return;
      }

      if (event.event === 'message_delta') {
        const outputTokens = parsed.usage?.output_tokens;
        if (typeof outputTokens === 'number') {
          tokensGenerated = outputTokens;
        }
        return;
      }

      if (event.event === 'error') {
        error =
          typeof parsed.error?.message === 'string'
            ? parsed.error.message
            : typeof parsed.message === 'string'
              ? parsed.message
              : event.data;
      }
    };

    const flushEvent = () => {
      if (!currentEvent && currentDataLines.length === 0) return;
      dispatch({
        event: currentEvent || 'message',
        data: currentDataLines.join('\n'),
      });
      currentEvent = '';
      currentDataLines = [];
    };

    const processLine = (line: string) => {
      const cleanLine = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (cleanLine === '') {
        flushEvent();
        return;
      }
      if (cleanLine.startsWith('event:')) {
        currentEvent = cleanLine.slice('event:'.length).trim();
        return;
      }
      if (cleanLine.startsWith('data:')) {
        currentDataLines.push(cleanLine.slice('data:'.length).trimStart());
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });

      while (true) {
        const newlineIndex = lineBuffer.indexOf('\n');
        if (newlineIndex === -1) break;
        const line = lineBuffer.slice(0, newlineIndex);
        lineBuffer = lineBuffer.slice(newlineIndex + 1);
        processLine(line);
      }
    }

    lineBuffer += decoder.decode();
    if (lineBuffer) processLine(lineBuffer);
    flushEvent();

    return { text: accumulated, error, tokensGenerated };
  }

  private parseEventData(data: string): any | null {
    if (!data || data === '[DONE]') return null;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  private nowMs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }
}
