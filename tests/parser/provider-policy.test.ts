import { describe, expect, it } from 'vitest';
import {
  ProviderCircuitBreaker,
  classifyHttpFailure,
  parseRetryAfterMs,
  retryDelayMs,
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

  it('parses HTTP-date Retry-After header with a fixed clock', () => {
    const fixedNow = new Date('Wed, 21 Oct 2015 07:27:00 GMT').getTime();
    const targetDate = 'Wed, 21 Oct 2015 07:28:00 GMT';
    // Difference is 60 seconds = 60,000 milliseconds
    expect(parseRetryAfterMs(targetDate, fixedNow)).toBe(60_000);

    const pastDate = 'Wed, 21 Oct 2015 07:26:00 GMT';
    expect(parseRetryAfterMs(pastDate, fixedNow)).toBe(0);
  });

  it('calculates exponential backoff and caps appropriately', () => {
    expect(retryDelayMs(1)).toBe(250);
    expect(retryDelayMs(2)).toBe(500);
    expect(retryDelayMs(3)).toBe(1000);
    expect(retryDelayMs(4)).toBe(2000);
    expect(retryDelayMs(5)).toBe(4000);
    expect(retryDelayMs(6)).toBe(4000); // capped at 4,000

    expect(retryDelayMs(1, 10_000)).toBe(10_000);
    expect(retryDelayMs(1, 45_000)).toBe(30_000); // server delay capped at 30,000
  });

  it('opens after the configured transient-failure threshold and resets on success', () => {
    const breaker = new ProviderCircuitBreaker(2, 1000);
    expect(breaker.isOpen(10)).toBe(false);
    expect(breaker.remainingMs(10)).toBe(0);

    breaker.failure(true, 10);
    expect(breaker.isOpen(10)).toBe(false);
    expect(breaker.remainingMs(10)).toBe(0);

    breaker.failure(true, 10);
    expect(breaker.isOpen(11)).toBe(true);
    expect(breaker.remainingMs(11)).toBe(999);

    breaker.success();
    expect(breaker.isOpen(11)).toBe(false);
    expect(breaker.remainingMs(11)).toBe(0);
  });

  it('follows deterministic boundary checks during cooldown, expiration, and reopening', () => {
    const breaker = new ProviderCircuitBreaker(2, 1000);

    // Initial check
    expect(breaker.isOpen(10)).toBe(false);

    // 1st failure
    breaker.failure(true, 10);
    expect(breaker.isOpen(10)).toBe(false);

    // 2nd failure triggers cooldown until 20 + 1000 = 1020
    breaker.failure(true, 20);
    expect(breaker.isOpen(20)).toBe(true);
    expect(breaker.isOpen(500)).toBe(true);
    expect(breaker.remainingMs(500)).toBe(520);

    // Boundary check: right at 1020 the breaker should be closed
    expect(breaker.isOpen(1020)).toBe(false);
    expect(breaker.remainingMs(1020)).toBe(0);

    // A failure after cooldown expiration reopens the breaker
    breaker.failure(true, 1100);
    expect(breaker.isOpen(1100)).toBe(true);
    expect(breaker.remainingMs(1100)).toBe(1000);

    // Cooldown check for reopened breaker
    expect(breaker.isOpen(2100)).toBe(false);
  });
});
