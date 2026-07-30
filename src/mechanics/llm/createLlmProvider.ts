import { AnthropicProvider } from './AnthropicProvider';
import type { ILlmProvider } from './ILlmProvider';
import { OllamaProvider } from './OllamaProvider';

export function createLlmProvider(name = import.meta.env.VITE_LLM_PROVIDER): ILlmProvider {
  switch ((name || 'anthropic').trim().toLowerCase()) {
    case 'anthropic':
      return new AnthropicProvider();
    case 'ollama':
      return new OllamaProvider();
    default:
      throw new Error(`Unsupported VITE_LLM_PROVIDER: ${name}`);
  }
}
