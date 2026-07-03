import type { GameActionOutcome } from '../core/GameActionTypes';
import type { Entity } from '../entities/Entity';
import type { SceneObject } from '../entities/SceneObject';
import type { StateValue } from '../systems/ComponentSystem';

export type ParserEntityLocationContext = {
  relation: Exclude<ParserRelationType, 'near'>;
  parentId: string;
  parentTitle?: string;
};

export type ParserEntityContentContext = {
  relation: Exclude<ParserRelationType, 'near'>;
  id: string;
  title: string;
};

export type ParserStateContext = {
  id: string;
  type: 'string' | 'number' | 'boolean';
  value: string | number | boolean;
};

export type ParserEntityContext = {
  id: string;
  title: string;
  item?: true;
  location?: ParserEntityLocationContext;
  contents?: ParserEntityContentContext[];
  reachable?: true;
  visibility?: 'visible' | 'hidden';
  accessibility?: 'reachable' | 'blocked' | 'inaccessible';
  hiddenReason?: 'switch' | 'blocker' | 'lookable' | 'examinable';
  x?: number;
  y?: number;
  synonyms?: string[];
  semanticTags?: string[];
  description?: string;
  details?: string;
  lore?: string;
  parserNote?: string;
  parserNoteNeedsCheck?: true;
  interactions?: string[];
  states?: ParserStateContext[];
};

export type ParserInventoryItemContext = {
  id: string;
  title: string;
  synonyms?: string[];
  description?: string;
  details?: string;
  lore?: string;
  parserNote?: string;
  parserNoteNeedsCheck?: true;
  states?: ParserStateContext[];
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

export type ParserSceneTurnContext = {
  command: string;
  response: string;
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
      type: 'actorUseOn';
      itemRef: string;
      targetRef: string;
      noEffectMessageId?: string;
      noEffectMessage?: string;
    }
  | {
      type: 'showText';
      messageId?: string;
      text?: string;
      messageIdByRef?: {
        ref: string;
        values: Record<string, string>;
        fallbackMessageId?: string;
      };
      params?: Record<string, string>;
      paramsFromRefs?: Record<string, string>;
    }
  | {
      type: 'requireEntityAvailable';
      entityId: string;
      scopes: ParserScopeSlice[];
      saveAs?: string;
      missingMessageId?: string;
      missingMessage?: string;
    }
  | {
      type: 'requireAnyEntityAvailable';
      options: Array<{
        entityId: string;
        scopes: ParserScopeSlice[];
        saveAsValue?: string;
      }>;
      saveAs?: string;
      missingMessageId?: string;
      missingMessage?: string;
    }
  | {
      type: 'setEntityState';
      entityId: string;
      stateId: string;
      value: StateValue;
      missingMessageId?: string;
      missingMessage?: string;
    }
  | {
      type: 'setGroupDisabled';
      groupId: string;
      disabled: boolean;
    }
  | {
      type: 'runScript';
      scriptId: string;
      restart?: boolean;
    }
  | {
      type: 'stopScript';
      scriptId: string;
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
  focusedTarget?: ParserInventoryItemContext & {
    source: 'inventoryPreview';
  };
  player?: {
    x: number;
    y: number;
  };
  scene?: {
    id: string;
    title?: string;
    description?: string;
    lore?: string;
    parserNote?: string;
    parserNoteNeedsCheck?: true;
    activeSubscene?: string;
    recentTurns?: ParserSceneTurnContext[];
  };
  entities?: ParserEntityContext[];
  knownEntities?: ParserEntityContext[];
  inventory?: ParserInventoryItemContext[];
  worldFacts?: string[];
  spatialNodes?: ParserSpatialNodeContext[];
  spatialRelations?: ParserSpatialRelationContext[];
  pending?: ParserPendingState;
};

export type ParserScope = {
  visible: SceneObject[];
  held: Entity[];
  takable: Entity[];
  putSource: Entity[];
  reachable: SceneObject[];
  examinable: SceneObject[];
  subscene: SceneObject[];
  worldKnown: SceneObject[];
  hiddenKnown: SceneObject[];
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
      type: 'llmClarification';
      question: string;
      pendingActions: ParserToolAction[];
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
      type: 'setSceneParserNote';
      note: string;
    }
  | {
      type: 'setEntityParserNote';
      entityId: string;
      note: string;
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
      type: 'actorUseOn';
      itemRef: string;
      targetRef: string;
      noEffectMessage?: string;
    }
  | {
      type: 'showText';
      message?: string;
      textKey?: string;
      messageByRef?: {
        ref: string;
        values: Record<string, string>;
        fallback?: string;
      };
      params?: Record<string, string>;
      paramsFromRefs?: Record<string, string>;
    }
  | {
      type: 'runCustomCommand';
      commandId: string;
      arguments?: Record<string, string | null>;
    }
  | {
      type: 'requireEntityAvailable';
      commandId?: string;
      entityId: string;
      scopes: ParserScopeSlice[];
      saveAs?: string;
      missingMessage?: string;
    }
  | {
      type: 'requireAnyEntityAvailable';
      commandId?: string;
      options: Array<{
        entityId: string;
        scopes: ParserScopeSlice[];
        saveAsValue?: string;
      }>;
      saveAs?: string;
      missingMessage?: string;
    }
  | {
      type: 'setEntityState';
      entityId: string;
      stateId: string;
      value: StateValue;
      missingMessage?: string;
      source?: 'parser' | 'llm' | 'custom-command' | string;
    }
  | {
      type: 'setGroupDisabled';
      groupId: string;
      disabled: boolean;
    }
  | {
      type: 'runScript';
      scriptId: string;
      restart?: boolean;
    }
  | {
      type: 'stopScript';
      scriptId: string;
    };

export type ParserCascadeEnvelope = {
  stage: 'regex-v1' | 'pending-resolution' | 'nlp-v2' | 'llm-v3';
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
    focusedDefaultTarget?: string;
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

export type LlmCascadeDebugInfo = {
  input: string;
  normalizedInput: string;
  matched: boolean;
  provider: string;
  model?: string;
  prompt?: {
    system:
      | string
      | Array<{
          type: 'text';
          text: string;
          cacheControl?: {
            type: 'ephemeral';
            ttl?: '5m' | '1h';
          };
        }>;
    messages: Array<{
      role: 'user' | 'assistant';
      content:
        | string
        | Array<{
            type: 'text';
            text: string;
            cacheControl?: {
              type: 'ephemeral';
              ttl?: '5m' | '1h';
            };
          }>;
    }>;
    staticPrompt?: {
      sceneId?: string;
      hash: string;
      tokenEstimate: number;
      minCacheTokens: number;
      cacheEligibleEstimate: boolean;
      cacheIneligibleReason?: string;
    };
  };
  durationMs?: number;
  tokensGenerated?: number;
  inputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  rawResponse?: string;
  extractedJson?: string;
  acceptedActions?: ParserToolAction[];
  filteredActions?: unknown[];
  error?: string;
  reason?:
    | 'provider_unavailable'
    | 'api_error'
    | 'invalid_response'
    | 'timeout'
    | 'disabled'
    | 'fallback';
};
