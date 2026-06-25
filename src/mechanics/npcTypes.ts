import type { LlmProviderContent, LlmProviderMessage } from './llm/ILlmProvider';
import type { SceneLogEntry } from '../scene/SceneLog';

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
      type: 'LOOK';
      targetId: string;
    }
  | {
      type: 'EXAMINE';
      targetId: string;
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
      type: 'USE';
      itemId: string;
      targetId: string;
    }
  | {
      type: 'WAIT';
      ms: number;
    }
  | {
      type: 'MEMORY_SET';
      memory: string;
    }
  | {
      type: 'OBJECTIVES_SET';
      objectives: string[];
    };

export type NpcPlan = {
  npcId: string;
  steps: NpcPlanStep[];
  memory?: string;
};

export type NpcPuppetMasterResponse = {
  kind: 'pm_response';
  plans: NpcPlan[];
};

export type NpcActorContext = {
  id: string;
  title: string;
  lore?: string;
  objectives?: string[];
  memory?: string;
  inventory?: {
    available: boolean;
    itemIds: string[];
  };
  actors: Array<{ id: string; title: string }>;
  newEvents: SceneLogEntry[];
  recentEvents: SceneLogEntry[];
  entities: Array<{
    id: string;
    title: string;
    location?: {
      relation: string;
      targetId: string;
      targetTitle?: string;
    };
    interaction: 'held' | 'reachable' | 'blocked';
    approach: 'already_reachable' | 'route_available' | 'unreachable';
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
      requires?: Array<{
        entityId: string;
        scope: string;
        satisfied?: boolean;
        via?: string;
      }>;
      effects?: Array<{ type: string; stateId?: string; value?: string | number | boolean }>;
    }>;
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
  acceptedPlans?: NpcPlan[];
  filteredPlans?: unknown[];
  error?: string;
  durationMs?: number;
  inputTokens?: number;
  tokensGenerated?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

export type NpcPlanExecutionOutcome = {
  status: 'ok' | 'failed' | 'unsupported' | 'scheduled';
  code: string;
  npcId: string;
  message?: string;
  targetId?: string;
  itemId?: string;
  commandId?: string;
  actionType?: NpcPlanStep['type'];
  worldChanged?: boolean;
  discoveredEntityIds?: string[];
  repeatKey?: string;
  repeatCount?: number;
};
