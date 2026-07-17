import { describe, expect, it } from 'vitest';
import {
  ProviderCircuitBreaker,
  classifyHttpFailure,
  parseRetryAfterMs,
} from '../../src/mechanics/llm/providerPolicy';

describe('LLM provider policy', () => {
  it('classifies transient and permanent HTTP failures', () => {
    expect(classifyHttpFailure(429, '2')).toMatchObject({
      reason: 'rate_limited',
      retryable: true,
      retryAfterMs: 2000,
    });
    expect(classifyHttpFailure(401, null)).toMatchObject({
      reason: 'authentication',
      retryable: false,
    });
    expect(parseRetryAfterMs('invalid')).toBeUndefined();
  });
  it('opens after the configured transient-failure threshold and resets on success', () => {
    const breaker = new ProviderCircuitBreaker(2, 1000);
    breaker.failure(true, 10);
    breaker.failure(true, 10);
    expect(breaker.isOpen(11)).toBe(true);
    breaker.success();
    expect(breaker.isOpen(11)).toBe(false);
  });
});
