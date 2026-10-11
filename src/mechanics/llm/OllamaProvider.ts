import type {
  ILlmProvider,
  LlmProviderContent,
  LlmProviderMessage,
  LlmProviderResponse,
  LlmStreamDeltaCallback,
} from './ILlmProvider';
import { ProviderCircuitBreaker, classifyHttpFailure, delay, retryDelayMs } from './providerPolicy';
import { fetchLlm } from '../../platform/llmApi';

const DEFAULT_BASE_URL = 'http://localhost:11434/v1/chat/completions';
const DEFAULT_MODEL = 'qwen2.5:3b';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 600000;
const DEFAULT_TEMPERATURE = 0.2;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type OllamaProviderOptions = {
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  jsonMode?: boolean;
  fetchImpl?: FetchLike;
  maxAttempts?: number;
  circuitFailureThreshold?: number;
  circuitCooldownMs?: number;
};

export class OllamaProvider implements ILlmProvider {
  private baseUrl: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private timeoutMs: number;
  private jsonMode: boolean;
  private fetchImpl: FetchLike;
  private maxAttempts: number;
  private breaker: ProviderCircuitBreaker;

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.model = options.model || DEFAULT_MODEL;
    this.temperature = options.temperature ?? DEFAULT_TEMPERATURE;
    this.maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.jsonMode = options.jsonMode ?? true;
    this.fetchImpl = options.fetchImpl || fetch.bind(globalThis);
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 2);
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
      let callbackError: unknown = null;
      try {
        const formattedMessages = [
          { role: 'system', content: this.contentToString(system) },
          ...messages.map((m) => ({
            role: m.role,
            content: this.contentToString(m.content),
          })),
        ];

        const body: Record<string, unknown> = {
          model: this.model,
          messages: formattedMessages,
          max_tokens: this.maxTokens,
          temperature: this.temperature,
          stream: false,
          keep_alive: -1,
          options: {
            num_ctx: 4096,
          },
        };

        if (this.jsonMode) {
          body.response_format = { type: 'json_object' };
        }

        const response = await fetchLlm(
          'ollama',
          this.baseUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: controller.signal,
            timeoutMs: this.timeoutMs,
          },
          this.fetchImpl
        );

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
            error: errorText || `Ollama returned HTTP ${response.status}`,
            reason: failure.reason,
            statusCode: response.status,
            requestId: response.headers?.get?.('x-request-id') || undefined,
            retryAfterMs: failure.retryAfterMs,
            retryable: failure.retryable,
            attempts: attempt,
            durationMs: this.nowMs() - startedAt,
          };
        }

        let data: any = null;
        try {
          data = await response.json();
        } catch (jsonErr) {
          this.breaker.failure(false);
          return {
            ok: false,
            text: '',
            model: this.model,
            error: `Malformed JSON response: ${String(jsonErr)}`,
            reason: 'invalid_response',
            retryable: false,
            attempts: attempt,
            durationMs: this.nowMs() - startedAt,
          };
        }

        const text = data?.choices?.[0]?.message?.content;
        if (text === undefined || text === null) {
          this.breaker.failure(false);
          return {
            ok: false,
            text: '',
            model: this.model,
            error: 'Missing choices[0].message.content in response',
            reason: 'invalid_response',
            retryable: false,
            attempts: attempt,
            durationMs: this.nowMs() - startedAt,
          };
        }

        callbackError = null;
        if (text) {
          try {
            onDelta(text, text);
          } catch (err) {
            callbackError = err;
          }
        }

        if (callbackError !== null) {
          throw callbackError;
        }

        this.breaker.success();

        const usage = data?.usage;
        return {
          ok: true,
          text,
          model: data?.model || this.model,
          durationMs: this.nowMs() - startedAt,
          tokensGenerated: usage?.completion_tokens,
          inputTokens: usage?.prompt_tokens,
          attempts: attempt,
        };
      } catch (error) {
        if (callbackError !== null) {
          throw callbackError;
        }
        const errorName = error instanceof Error ? error.name : '';
        const isAbort = errorName === 'AbortError';
        if (!isAbort && attempt < this.maxAttempts) {
          await delay(retryDelayMs(attempt));
          continue;
        }
        this.breaker.failure(true);
        return {
          ok: false,
          text: '',
          model: this.model,
          error: isAbort ? 'Request timed out' : String(error),
          reason: isAbort ? 'timeout' : 'network_error',
          retryable: true,
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
    return 'Ollama (local)';
  }

  getModelName(): string {
    return this.model;
  }

  private contentToString(content: LlmProviderContent): string {
    if (typeof content === 'string') return content;
    return content.map((block) => block.text).join('\n');
  }

  private nowMs(): number {
    return Date.now();
  }
}
