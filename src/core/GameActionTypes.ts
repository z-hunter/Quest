export type GameActionStatus = 'ok' | 'failed' | 'needs_clarification' | 'escalate';

export interface GameActionOutcome {
  status: GameActionStatus;
  code: string;
  message?: string;
  data?: Record<string, unknown>;
  effects?: string[];
  recoverable?: boolean;
}
