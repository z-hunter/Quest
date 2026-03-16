import type { GameActionOutcome } from '../core/GameActionTypes';
import type { Entity } from '../entities/Entity';
import type { SceneDescriptor } from '../scene/SceneManager';

export type ParserEntityContext = {
  id: string;
  type: string;
  title: string | null;
  synonyms: string[];
  description: string | null;
  details: string | null;
  interactions: string[];
};

export type ParserInventoryItemContext = {
  id: string;
  title: string | null;
  synonyms: string[];
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

export type ParserScope = {
  visible: Entity[];
  held: Entity[];
  takable: Entity[];
  reachable: Entity[];
  examinable: Entity[];
  subscene: Entity[];
  sceneTargets: SceneDescriptor[];
};

export type ParserWorldModel = {
  context: ParserContext;
  scope: ParserScope;
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
    };

export type ParserCascadeEnvelope = {
  stage: 'regex-v1' | 'pending-resolution' | 'nlp-v2';
  output:
    | {
        kind: 'plan';
        actions: ParserToolAction[];
      }
    | {
        kind: 'handoff_up';
        reason: string;
        rawInput: string;
        verb: string;
        noun: string;
      };
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
      coreDecision?: ParserCoreDecision;
    }
  | {
      type: 'handoff';
      handled: false;
      outcomes: GameActionOutcome[];
      actionsExecuted: string[];
      reason: string;
      debug: Record<string, unknown>;
      coreDecision?: ParserCoreDecision;
    };

export type ParserCoreDecision =
  | {
      kind: 'handoff_up';
      reason: string;
      envelope: ParserCascadeEnvelope;
    }
  | {
      kind: 'execute_plan';
      envelope: ParserCascadeEnvelope;
      actions: ParserToolAction[];
    };

export type ParserResponse = {
  playerMessage?: string;
  debugMessages?: string[];
  nextPendingState?: ParserPendingState | null;
};
