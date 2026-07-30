import { describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../../src/mechanics/llm/AnthropicProvider';
import { createLlmProvider } from '../../src/mechanics/llm/createLlmProvider';
import { OllamaProvider } from '../../src/mechanics/llm/OllamaProvider';

describe('createLlmProvider', () => {
  it('creates the configured provider and defaults an empty setting to Anthropic', () => {
    expect(createLlmProvider('')).toBeInstanceOf(AnthropicProvider);
    expect(createLlmProvider('ollama')).toBeInstanceOf(OllamaProvider);
  });

  it('rejects unsupported providers at startup', () => {
    expect(() => createLlmProvider('unknown')).toThrow('Unsupported VITE_LLM_PROVIDER: unknown');
  });
});
