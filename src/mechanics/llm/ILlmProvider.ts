export type LlmProviderCacheControl = {
  type: 'ephemeral';
  ttl?: '5m' | '1h';
};

export type LlmProviderTextBlock = {
  type: 'text';
  text: string;
  cacheControl?: LlmProviderCacheControl;
};

export type LlmProviderContent = string | LlmProviderTextBlock[];

export type LlmProviderMessage = {
  role: 'user' | 'assistant';
  content: LlmProviderContent;
};

export type LlmProviderErrorReason =
  | 'authentication'
  | 'rate_limited'
  | 'unavailable'
  | 'network_error'
  | 'invalid_response'
  | 'api_error'
  | 'timeout';

export type LlmProviderResponse = {
  ok: boolean;
  text: string;
  model?: string;
  error?: string;
  reason?: LlmProviderErrorReason;
  statusCode?: number;
  requestId?: string;
  retryAfterMs?: number;
  retryable?: boolean;
  attempts?: number;
  durationMs: number;
  tokensGenerated?: number;
  inputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

export type LlmStreamDeltaCallback = (delta: string, accumulated: string) => void;

export interface ILlmProvider {
  sendMessage(
    system: LlmProviderContent,
    messages: LlmProviderMessage[]
  ): Promise<LlmProviderResponse>;

  sendMessageStream(
    system: LlmProviderContent,
    messages: LlmProviderMessage[],
    onDelta: LlmStreamDeltaCallback
  ): Promise<LlmProviderResponse>;

  isAvailable(): boolean;

  getProviderName(): string;

  getModelName(): string;
}
