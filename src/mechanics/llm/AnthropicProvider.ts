import type {
  ILlmProvider,
  LlmProviderContent,
  LlmProviderMessage,
  LlmProviderTextBlock,
  LlmProviderResponse,
  LlmStreamDeltaCallback,
} from './ILlmProvider';
import { ProviderCircuitBreaker, classifyHttpFailure, delay, retryDelayMs } from './providerPolicy';
import { fetchLlm } from '../../platform/llmApi';

const DEFAULT_PROXY_URL = '/api/llm';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 15000;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type AnthropicProviderOptions = {
  proxyUrl?: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  maxAttempts?: number;
  streamIdleTimeoutMs?: number;
  circuitFailureThreshold?: number;
  circuitCooldownMs?: number;
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
  private maxAttempts: number;
  private streamIdleTimeoutMs: number;
  private breaker: ProviderCircuitBreaker;

  constructor(options: AnthropicProviderOptions = {}) {
    this.proxyUrl = options.proxyUrl || DEFAULT_PROXY_URL;
    this.model = options.model || DEFAULT_MODEL;
    this.maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl || fetch.bind(globalThis);
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 2);
    this.streamIdleTimeoutMs = options.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
    this.breaker = new ProviderCircuitBreaker(
      options.circuitFailureThreshold,
      options.circuitCooldownMs
    );
  }

  sendMessage(
    system: LlmProviderContent,
    messages: LlmProviderMessage[]
  ): Promise<LlmProviderResponse> {
    return this.sendMessageStream(system, messages, () => {});
  }

  async sendMessageStream(
    system: LlmProviderContent,
    messages: LlmProviderMessage[],
    onDelta: LlmStreamDeltaCallback
  ): Promise<LlmProviderResponse> {
    const startedAt = this.nowMs();
    if (this.breaker.isOpen())
      return {
        ok: false,
        text: '',
        model: this.model,
        error: 'Provider circuit is open',
        reason: 'unavailable',
        retryable: true,
        retryAfterMs: this.breaker.remainingMs(),
        attempts: 0,
        durationMs: 0,
      };
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
      let deltaEmitted = false;
      let accumulatedText = '';
      let callbackError: unknown = null;

      const wrappedOnDelta = (delta: string, accumulated: string) => {
        deltaEmitted = true;
        accumulatedText = accumulated;
        try {
          onDelta(delta, accumulated);
        } catch (err) {
          callbackError = err;
          throw err;
        }
      };

      try {
        const response = await fetchLlm(
          'anthropic',
          this.proxyUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: this.model,
              max_tokens: this.maxTokens,
              system: this.toAnthropicContent(system),
              messages: messages.map((message) => ({
                role: message.role,
                content: this.toAnthropicContent(message.content),
              })),
              stream: true,
            }),
            signal: controller.signal,
          },
          this.fetchImpl
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          const failure = classifyHttpFailure(
            response.status,
            response.headers?.get?.('retry-after') || null
          );
          if (failure.retryable && attempt < this.maxAttempts) {
            await delay(retryDelayMs(attempt, failure.retryAfterMs));
            continue;
          }
          this.breaker.failure(failure.retryable);
          return {
            ok: false,
            text: '',
            model: this.model,
            error: errorText || `LLM proxy returned HTTP ${response.status}`,
            reason: failure.reason,
            statusCode: response.status,
            requestId: response.headers?.get?.('x-request-id') || undefined,
            retryAfterMs: failure.retryAfterMs,
            retryable: failure.retryable,
            attempts: attempt,
            durationMs: this.nowMs() - startedAt,
          };
        }

        if (!response.body) {
          this.breaker.failure(false);
          return {
            ok: false,
            text: '',
            model: this.model,
            error: 'Response body is missing',
            reason: 'invalid_response',
            retryable: false,
            attempts: attempt,
            durationMs: this.nowMs() - startedAt,
          };
        }

        const streamResult = await this.readSseStream(response.body, wrappedOnDelta);
        if (streamResult.error) {
          this.breaker.failure(false);
          return {
            ok: false,
            text: streamResult.text,
            model: this.model,
            error: streamResult.error,
            reason: 'api_error',
            durationMs: this.nowMs() - startedAt,
            tokensGenerated: streamResult.tokensGenerated,
            inputTokens: streamResult.inputTokens,
            cacheCreationInputTokens: streamResult.cacheCreationInputTokens,
            cacheReadInputTokens: streamResult.cacheReadInputTokens,
            retryable: false,
            attempts: attempt,
          };
        }

        this.breaker.success();
        return {
          ok: true,
          text: streamResult.text,
          model: this.model,
          durationMs: this.nowMs() - startedAt,
          tokensGenerated: streamResult.tokensGenerated,
          inputTokens: streamResult.inputTokens,
          cacheCreationInputTokens: streamResult.cacheCreationInputTokens,
          cacheReadInputTokens: streamResult.cacheReadInputTokens,
          attempts: attempt,
        };
      } catch (error) {
        if (callbackError !== null) {
          throw callbackError;
        }
        const errorName = error instanceof Error ? error.name : '';
        const isAbort = errorName === 'AbortError';
        if (attempt < this.maxAttempts && !deltaEmitted) {
          await delay(retryDelayMs(attempt));
          continue;
        }
        this.breaker.failure(true);
        return {
          ok: false,
          text: accumulatedText,
          model: this.model,
          error: isAbort ? 'Request timed out' : String(error),
          reason: isAbort ? 'timeout' : 'network_error',
          retryable: !deltaEmitted,
          attempts: attempt,
          durationMs: this.nowMs() - startedAt,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    }
    return {
      ok: false,
      text: '',
      model: this.model,
      error: 'Retry policy exhausted',
      reason: 'unavailable',
      retryable: false,
      attempts: this.maxAttempts,
      durationMs: this.nowMs() - startedAt,
    };
  }

  isAvailable(): boolean {
    return !this.breaker.isOpen();
  }

  getProviderName(): string {
    return 'Anthropic (proxy)';
  }

  getModelName(): string {
    return this.model;
  }

  private toAnthropicContent(content: LlmProviderContent): string | any[] {
    if (typeof content === 'string') return content;
    return content.map((block) => this.toAnthropicBlock(block));
  }

  private toAnthropicBlock(block: LlmProviderTextBlock): Record<string, unknown> {
    const result: Record<string, unknown> = {
      type: 'text',
      text: block.text,
    };
    if (block.cacheControl) {
      result.cache_control = {
        type: block.cacheControl.type,
        ...(block.cacheControl.ttl ? { ttl: block.cacheControl.ttl } : {}),
      };
    }
    return result;
  }

  private async readSseStream(
    body: ReadableStream<Uint8Array>,
    onDelta: LlmStreamDeltaCallback
  ): Promise<{
    text: string;
    error?: string;
    tokensGenerated?: number;
    inputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  }> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = '';
    let currentEvent = '';
    let currentDataLines: string[] = [];
    let accumulated = '';
    let error: string | undefined;
    let tokensGenerated: number | undefined;
    let inputTokens: number | undefined;
    let cacheCreationInputTokens: number | undefined;
    let cacheReadInputTokens: number | undefined;

    const captureUsage = (usage: any) => {
      if (!usage || typeof usage !== 'object') return;
      if (typeof usage.input_tokens === 'number') inputTokens = usage.input_tokens;
      if (typeof usage.output_tokens === 'number') tokensGenerated = usage.output_tokens;
      if (typeof usage.cache_read_input_tokens === 'number') {
        cacheReadInputTokens = usage.cache_read_input_tokens;
      }
      if (typeof usage.cache_creation_input_tokens === 'number') {
        cacheCreationInputTokens = usage.cache_creation_input_tokens;
      }
      const cacheCreation = usage.cache_creation;
      if (cacheCreation && typeof cacheCreation === 'object') {
        const fiveMinute = cacheCreation.ephemeral_5m_input_tokens;
        const oneHour = cacheCreation.ephemeral_1h_input_tokens;
        const total =
          (typeof fiveMinute === 'number' ? fiveMinute : 0) +
          (typeof oneHour === 'number' ? oneHour : 0);
        if (total > 0) cacheCreationInputTokens = total;
      }
    };

    const dispatch = (event: SseEvent) => {
      const parsed = this.parseEventData(event.data);
      if (!parsed) return;

      if (event.event === 'message_start') {
        captureUsage(parsed.message?.usage || parsed.usage);
        return;
      }

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
        captureUsage(parsed.usage);
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
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const idle = new Promise<never>((_, reject) => {
        idleTimer = setTimeout(() => {
          reader.cancel().catch(() => {});
          reject(new DOMException('Stream idle timeout', 'AbortError'));
        }, this.streamIdleTimeoutMs);
      });
      const { done, value } = await Promise.race([reader.read(), idle]);
      if (idleTimer) clearTimeout(idleTimer);
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

    return {
      text: accumulated,
      error,
      tokensGenerated,
      inputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
    };
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
