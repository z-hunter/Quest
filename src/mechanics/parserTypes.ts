import type { GameActionOutcome } from '../core/GameActionTypes';

export type ParserEntityContext = {
  id: string;
  type: string;
  title: string | null;
  description: string | null;
  details: string | null;
  interactions: string[];
};

export type ParserInventoryItemContext = {
  id: string;
  title: string | null;
  description: string | null;
  details: string | null;
};

export type ParserPendingState = {
  intent: 'look' | 'examine' | 'take' | 'goTo';
  question: string;
  originalInput: string;
};

export type ParserContext = {
  rawInput: string;
  normalizedInput: string;
  scene: {
    id: string;
    name: string;
    title: string | null;
    description: string | null;
  } | null;
  entities: ParserEntityContext[];
  inventory: ParserInventoryItemContext[];
  pending: ParserPendingState | null;
};

export type ParserToolAction =
  | {
      type: 'lookScene';
    }
  | {
      type: 'lookTarget';
      target: string;
    }
  | {
      type: 'examineTarget';
      target: string | null;
    }
  | {
      type: 'takeTarget';
      target: string | null;
    }
  | {
      type: 'showInventory';
    }
  | {
      type: 'goToTarget';
      target: string | null;
    }
  | {
      type: 'handoff';
      reason: string;
      verb: string;
      noun: string;
      rawInput: string;
    };

export type ParserActionEnvelope = {
  stage: 'regex-v1' | 'pending-resolution' | 'nlp-v2';
  actions: ParserToolAction[];
  debug: {
    rawInput: string;
    normalizedInput: string;
    verb: string;
    noun: string;
    pendingIntent?: string;
    intent?: string;
    score?: number;
    source?: 'nlpjs';
  };
};

export type ParserResult =
  | {
      type: 'outcomes';
      handled: boolean;
      outcomes: GameActionOutcome[];
      actionsExecuted: string[];
    }
  | {
      type: 'handoff';
      handled: false;
      outcomes: GameActionOutcome[];
      actionsExecuted: string[];
      reason: string;
      debug: Record<string, unknown>;
    };

export type ParserResponse = {
  playerMessage?: string;
  debugMessages?: string[];
  nextPendingState?: ParserPendingState | null;
};
