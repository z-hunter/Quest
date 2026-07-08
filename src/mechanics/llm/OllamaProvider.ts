import type {
  ILlmProvider,
  LlmProviderContent,
  LlmProviderMessage,
  LlmProviderResponse,
  LlmStreamDeltaCallback,
} from './ILlmProvider';

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
};

export class OllamaProvider implements ILlmProvider {
  private baseUrl: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private timeoutMs: number;
  private jsonMode: boolean;
  private fetchImpl: FetchLike;

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.model = options.model || DEFAULT_MODEL;
    this.temperature = options.temperature ?? DEFAULT_TEMPERATURE;
    this.maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.jsonMode = options.jsonMode ?? true;
    this.fetchImpl = options.fetchImpl || fetch.bind(globalThis);
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

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

      const response = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          ok: false,
          text: '',
          model: this.model,
          error: errorText || `Ollama returned HTTP ${response.status}`,
          reason: 'api_error',
          durationMs: this.nowMs() - startedAt,
        };
      }

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content || '';
      const usage = data?.usage;

      if (text) {
        onDelta(text, text);
      }

      return {
        ok: true,
        text,
        model: data?.model || this.model,
        durationMs: this.nowMs() - startedAt,
        tokensGenerated: usage?.completion_tokens,
        inputTokens: usage?.prompt_tokens,
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
