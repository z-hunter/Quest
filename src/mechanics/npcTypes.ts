import type { LlmProviderContent, LlmProviderMessage } from './llm/ILlmProvider';
import type { SceneLogEntry } from '../scene/SceneLog';
import type { NpcObjective, NpcObjectiveDraft } from './npcState';

export type { NpcObjective, NpcObjectiveDraft } from './npcState';

export type NpcPlanStep =
  | {
      type: 'SAY';
      text: string;
    }
  | {
      type: 'MOVE_TO';
      x?: number;
      y?: number;
      targetId?: string;
    }
  | {
      type: 'TRAVERSE_EXIT';
      targetId: string;
    }
  | {
      type: 'LOOK';
      targetId: string;
      relation?: 'in' | 'on' | 'under' | 'behind' | null;
    }
  | {
      type: 'EXAMINE';
      targetId: string;
      relation?: 'in' | 'on' | 'under' | 'behind' | null;
    }
  | {
      type: 'OPEN';
      targetId: string;
    }
  | {
      type: 'CLOSE';
      targetId: string;
    }
  | {
      type: 'TAKE';
      targetId: string;
    }
  | {
      type: 'GIVE';
      itemId: string;
      targetId: string;
    }
  | {
      type: 'PUT';
      itemId: string;
      targetId?: string | null;
      relation?: 'in' | 'on' | 'under' | 'behind' | null;
    }
  | {
      type: 'COMMAND';
      commandId: string;
      arguments?: Record<string, string | null>;
    }
  | {
      type: 'WAIT';
      ms: number;
    }
  | {
      type: 'THINK_STRATEGY';
      reason?: string;
    }
  | {
      type: 'MEMORY_ADD';
      memory: string;
    }
  | {
      type: 'MEMORY_REMOVE';
      memory: string;
    }
  | {
      type: 'OBJECTIVE_ADD';
      parentId?: string | null;
      objective: NpcObjectiveDraft;
    }
  | {
      type: 'OBJECTIVE_UPDATE';
      objectiveId: string;
      text: string;
    }
  | {
      type: 'OBJECTIVE_REMOVE';
      objectiveId: string;
    }
  | {
      type: 'OBJECTIVE_MARK_COMPLETED';
      objectiveId: string;
    }
  | {
      type: 'MEMORY_SET';
      memory: string;
    }
  | {
      type: 'OBJECTIVES_SET';
      objectives: string[];
    };

export type NpcPlanInterruptCondition =
  | {
      type: 'ITEM_FOUND';
      itemId?: string;
    }
  | {
      type: 'WORLD_CHANGED';
    }
  | {
      type: 'STATE_CHANGED';
      targetId?: string;
      stateId?: string;
    }
  | {
      type: 'ACTION_FAILED';
    };

export type NpcPlan = {
  npcId: string;
  steps: NpcPlanStep[];
  memory?: string;
  interruptOn?: NpcPlanInterruptCondition[];
};

export type NpcContinuationState =
  | 'idle'
  | 'awaiting_barrier'
  | 'executing_tail'
  | 'needs_replan'
  | 'interrupted'
  | 'completed';

export type NpcContinuationStateSnapshot = {
  state: NpcContinuationState;
  changedAt: number;
  reason?: string;
};

export type NpcPuppetMasterResponse = {
  kind: 'pm_response';
  reasoning?: string;
  plans: NpcPlan[];
};

export type NpcActorContext = {
  id: string;
  title: string;
  lore?: string;
  objectives?: NpcObjective[];
  memory?: string[];
  transientMemory?: string[];
  inventory?: {
    available: boolean;
    itemIds: string[];
    items?: Array<{
      id: string;
      title: string;
      containerId: string;
      relation: string;
      groupIds?: string[];
      states?: Array<{ id: string; value: string | number | boolean }>;
    }>;
  };
  actors: Array<{ id: string; title: string; lastSeenSceneId?: string }>;
  visibleItemIds: string[];
  knownEntities: Array<{
    id: string;
    title: string;
    kind: 'item' | 'actor' | 'object';
    lastSeenSceneId?: string;
    lastSeenLocation?: {
      sceneId: string;
      relation: string;
      targetId: string;
      targetTitle?: string;
    };
  }>;
  newEvents: SceneLogEntry[];
  recentEvents: SceneLogEntry[];
  entities: Array<{
    id: string;
    title: string;
    lastSeenSceneId?: string;
    visibility?: 'visible' | 'hidden' | 'unknown';
    location?: {
      relation: string;
      targetId: string;
      targetTitle?: string;
    };
    interaction: 'held' | 'reachable' | 'blocked';
    approach?: 'already_reachable' | 'route_available' | 'unreachable';
    inspection?: {
      look: boolean;
      examine: boolean;
      possibleRelations: string[];
    };
    switch?: {
      state: 'open' | 'closed';
      canOpen: boolean;
      canClose: boolean;
      locked: boolean;
      keyHeld: boolean;
      requiredKeyId?: string;
    };
    states?: Array<{ id: string; value: string | number | boolean }>;
    commands?: Array<{
      id: string;
      label: string;
      available?: boolean;
      executable?: boolean;
      requires?: Array<{
        entityId: string;
        scope: string;
        satisfied?: boolean;
        via?: string;
      }>;
      effects?: Array<{ type: string; stateId?: string; value?: string | number | boolean }>;
      preconditions?: Array<{
        type: 'entity_available' | 'contained_group_entity' | 'numeric_state';
        satisfied: boolean;
        entityId?: string;
        containerId?: string;
        groupId?: string;
        itemId?: string;
        stateId?: string;
        operator?: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
        expectedValue?: number;
        actualValue?: number;
      }>;
    }>;
    exit?: {
      targetSceneId: string;
      targetEntryId?: string;
      targetSceneTitle?: string;
      portal: boolean;
      collider: boolean;
    };
  }>;
};

export type NpcStaticEntityContext = {
  id: string;
  title: string;
  description?: string;
  lore?: string;
  item?: true;
  exit?: {
    targetSceneId: string;
    targetEntryId?: string;
    targetSceneTitle?: string;
    portal: boolean;
    collider: boolean;
  };
  inspection?: string[];
  switch?: {
    canOpen: boolean;
    canClose: boolean;
    requiredKeyId?: string;
    blockedRelation?: string;
    transparent?: boolean;
  };
  commands?: Array<{
    id: string;
    label: string;
    requires?: Array<{ entityId: string; scope: string }>;
    effects?: Array<{ type: string; stateId?: string; value?: string | number | boolean }>;
  }>;
};

export type NpcWorldModel = {
  scene: {
    id: string;
    title?: string;
    description?: string;
    lore?: string;
  };
  npcs: NpcActorContext[];
};

export type NpcPuppetMasterDebugInfo = {
  matched: boolean;
  provider: string;
  model?: string;
  prompt?: {
    system: LlmProviderContent;
    messages: LlmProviderMessage[];
  };
  rawResponse?: string;
  extractedJson?: string;
  reasoning?: string;
  acceptedPlans?: NpcPlan[];
  rejectedPlans?: Array<{
    plan: NpcPlan;
    missingItems: Array<{ stepType: NpcPlanStep['type']; itemId: string }>;
    retryScheduled: boolean;
  }>;
  filteredPlans?: unknown[];
  error?: string;
  durationMs?: number;
  inputTokens?: number;
  tokensGenerated?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  staticPrefix?: NpcStaticPrefixDebugInfo;
  dynamicPrompt?: {
    characters: number;
    estimatedTokens: number;
    sections: Record<string, number>;
  };
  strategy?: NpcPuppetMasterStrategyDebugInfo;
};

export type NpcStaticPrefixDebugInfo = {
  hash: string;
  characters: number;
  estimatedTokens: number;
  cacheEligible: boolean;
};

export type NpcPuppetMasterStrategyDebugInfo = {
  npcId: string;
  reason?: string;
  prompt?: {
    system: LlmProviderContent;
    messages: LlmProviderMessage[];
  };
  rawResponse?: string;
  extractedJson?: string;
  error?: string;
  memoryUpdated: boolean;
  objectivesUpdated?: NpcObjective[];
  waitMs: number;
  fallback: boolean;
  durationMs?: number;
  inputTokens?: number;
  tokensGenerated?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  staticPrefix?: NpcStaticPrefixDebugInfo;
};

export type NpcPlanExecutionOutcome = {
  status: 'ok' | 'failed' | 'unsupported' | 'scheduled';
  code: string;
  npcId: string;
  message?: string;
  targetId?: string;
  itemId?: string;
  commandId?: string;
  relation?: 'in' | 'on' | 'under' | 'behind' | null;
  actionType?: NpcPlanStep['type'];
  worldChanged?: boolean;
  discoveredEntityIds?: string[];
  repeatKey?: string;
  repeatCount?: number;
  moveAttemptLimit?: number;
  moveAttemptsRemaining?: number;
};
