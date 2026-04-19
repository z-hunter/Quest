export type LlmProviderMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type LlmProviderErrorReason = 'api_error' | 'timeout';

export type LlmProviderResponse = {
  ok: boolean;
  text: string;
  model?: string;
  error?: string;
  reason?: LlmProviderErrorReason;
  durationMs: number;
  tokensGenerated?: number;
};

export type LlmStreamDeltaCallback = (delta: string, accumulated: string) => void;

export interface ILlmProvider {
  sendMessage(system: string, messages: LlmProviderMessage[]): Promise<LlmProviderResponse>;

  sendMessageStream(
    system: string,
    messages: LlmProviderMessage[],
    onDelta: LlmStreamDeltaCallback
  ): Promise<LlmProviderResponse>;

  isAvailable(): boolean;

  getProviderName(): string;

  getModelName(): string;
}
