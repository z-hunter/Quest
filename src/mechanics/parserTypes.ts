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
  intent: 'look' | 'examine' | 'take' | 'goTo' | 'custom';
  question: string;
  originalInput: string;
  pendingEnvelopeJson?: string;
  pendingArg?: string;
  commandId?: string;
};

export type ParserScopeSlice = keyof Omit<ParserScope, 'sceneTargets'>;

export type ParserCommandArgumentMessages = {
  missing?: string;
  ambiguous?: string;
  notFound?: string;
  noEffect?: string;
};

export type ParserCommandArgumentValidation = {
  allowedEntityIds?: string[];
  allowedTitles?: string[];
  allowedSynonyms?: string[];
};

export type ParserCommandArgumentSpec = {
  name: string;
  kind: 'entity';
  required: boolean;
  scopes: ParserScopeSlice[];
  messages?: ParserCommandArgumentMessages;
  validation?: ParserCommandArgumentValidation;
};

export type ParserCommandActionSpec =
  | {
      type: 'resolveArgumentEntity';
      arg: string;
      saveAs: string;
    }
  | {
      type: 'ensureHeldEntity';
      ref: string;
      noEffectMessageId?: string;
    }
  | {
      type: 'goToSceneById';
      sceneId: string;
    }
  | {
      type: 'removeInventoryEntity';
      ref: string;
    }
  | {
      type: 'showText';
      messageId?: string;
      text?: string;
      params?: Record<string, string>;
    };

export type ParserCommandSpec = {
  id: string;
  phrases: string[];
  arguments: ParserCommandArgumentSpec[];
  plan: ParserCommandActionSpec[];
  messages?: Record<string, string>;
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
    }
  | {
      type: 'resolveArgumentEntity';
      commandId: string;
      arg: string;
      query: string | null;
      scopes: ParserScopeSlice[];
      saveAs: string;
      messages?: ParserCommandArgumentMessages;
      validation?: ParserCommandArgumentValidation;
    }
  | {
      type: 'ensureHeldEntity';
      ref: string;
      noEffectMessage?: string;
    }
  | {
      type: 'goToSceneById';
      sceneId: string;
    }
  | {
      type: 'removeInventoryEntity';
      ref: string;
    }
  | {
      type: 'showText';
      message?: string;
      textKey?: string;
      params?: Record<string, string>;
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

export type ParserPlanState = Record<string, unknown>;

export type ParserResponse = {
  playerMessage?: string;
  debugMessages?: string[];
  nextPendingState?: ParserPendingState | null;
};
