import type { LlmProviderErrorReason } from './ILlmProvider';

export type ProviderFailure = {
  reason: LlmProviderErrorReason;
  retryable: boolean;
  retryAfterMs?: number;
};

export function classifyHttpFailure(status: number, retryAfter: string | null): ProviderFailure {
  const retryAfterMs = parseRetryAfterMs(retryAfter);
  if (status === 401 || status === 403) return { reason: 'authentication', retryable: false };
  if (status === 408) return { reason: 'timeout', retryable: true, retryAfterMs };
  if (status === 429) return { reason: 'rate_limited', retryable: true, retryAfterMs };
  if (status >= 500) return { reason: 'unavailable', retryable: true, retryAfterMs };
  return { reason: 'api_error', retryable: false };
}

export function parseRetryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export function retryDelayMs(attempt: number, serverDelay?: number): number {
  if (serverDelay !== undefined) return Math.min(serverDelay, 30_000);
  return Math.min(250 * 2 ** Math.max(0, attempt - 1), 4_000);
}

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class ProviderCircuitBreaker {
  private failures = 0;
  private openUntil = 0;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  constructor(threshold = 4, cooldownMs = 15_000) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
  }
  isOpen(now = Date.now()): boolean {
    return this.openUntil > now;
  }
  success(): void {
    this.failures = 0;
    this.openUntil = 0;
  }
  failure(retryable: boolean, now = Date.now()): void {
    if (!retryable) return;
    this.failures++;
    if (this.failures >= this.threshold) this.openUntil = now + this.cooldownMs;
  }
  remainingMs(now = Date.now()): number {
    return Math.max(0, this.openUntil - now);
  }
}
