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
      type: 'TAKE';
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
  x?: number;
  y?: number;
  lore?: string;
  objectives?: string[];
  memory?: string;
  heardEntries: SceneLogEntry[];
  visibleEntities: Array<{
    id: string;
    title: string;
    x?: number;
    y?: number;
    location?: {
      relation: string;
      targetId: string;
      targetTitle?: string;
    };
    states?: Array<{ id: string; value: string | number | boolean }>;
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
  recentSceneLog: SceneLogEntry[];
  unreadSceneLog: SceneLogEntry[];
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
};
