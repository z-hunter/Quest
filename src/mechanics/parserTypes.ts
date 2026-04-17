import type { GameActionOutcome } from '../core/GameActionTypes';
import type { Entity } from '../entities/Entity';
import type { SceneObject } from '../entities/SceneObject';

export type ParserEntityContext = {
  id: string;
  title: string;
  item?: true;
  reachable?: true;
  x?: number;
  y?: number;
  synonyms?: string[];
  description?: string;
  details?: string;
  interactions?: string[];
};

export type ParserInventoryItemContext = {
  id: string;
  title: string;
  synonyms?: string[];
  description?: string;
  details?: string;
};

export type ParserSpatialNodeContext = {
  id: string;
  subscene?: true;
  title?: string;
  parentNodeId?: string;
  relation?: Exclude<ParserRelationType, 'near'>;
};

export type ParserSpatialRelationContext = {
  anchorNodeId: string;
  relation: Exclude<ParserRelationType, 'near'>;
  childNodeIds: string[];
};

export type ParserPendingState = {
  intent: 'look' | 'examine' | 'take' | 'put' | 'open' | 'close' | 'quit' | 'goTo' | 'custom';
  question: string;
  originalInput: string;
  pendingEnvelopeJson?: string;
  pendingArg?: string;
  commandId?: string;
  clarificationOptions?: ParserClarificationOption[];
  clarificationAllowsMultiple?: boolean;
};

export type ParserClarificationScope = 'source' | 'target';

export type ParserClarificationOption = {
  index: number;
  label: string;
  entityId: string;
  scope: ParserClarificationScope;
};

export type ParserRelationType = 'on' | 'under' | 'in' | 'behind' | 'near';

export type ParserScopeSlice = keyof ParserScope;

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
  separatorsBefore?: string[];
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
      paramsFromRefs?: Record<string, string>;
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
  player?: {
    x: number;
    y: number;
  };
  scene?: {
    id: string;
    title?: string;
    description?: string;
    activeSubscene?: string;
  };
  entities?: ParserEntityContext[];
  inventory?: ParserInventoryItemContext[];
  spatialNodes?: ParserSpatialNodeContext[];
  spatialRelations?: ParserSpatialRelationContext[];
  pending?: ParserPendingState;
};

export type ParserScope = {
  visible: SceneObject[];
  held: Entity[];
  takable: Entity[];
  reachable: SceneObject[];
  examinable: SceneObject[];
  subscene: SceneObject[];
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
      type: 'lookRelationTarget';
      relation: ParserRelationType;
      anchor: string | null;
    }
  | {
      type: 'examineTarget';
      target: string | null;
    }
  | {
      type: 'examineRelationTarget';
      relation: ParserRelationType;
      anchor: string | null;
    }
  | {
      type: 'takeTarget';
      target: string | null;
      anchor?: string | null;
      relation?: ParserRelationType | null;
    }
  | {
      type: 'parserFailure';
      code: string;
      message: string;
    }
  | {
      type: 'putTarget';
      item: string | null;
      target: string | null;
      relation?: ParserRelationType | null;
    }
  | {
      type: 'openTarget';
      target: string | null;
    }
  | {
      type: 'closeTarget';
      target: string | null;
    }
  | {
      type: 'quitCurrentView';
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
      paramsFromRefs?: Record<string, string>;
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
    relation?: ParserRelationType;
    anchor?: string | null;
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
  playerMessages?: string[];
  debugMessages?: string[];
  nextPendingState?: ParserPendingState | null;
};
