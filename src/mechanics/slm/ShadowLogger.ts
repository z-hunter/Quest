import { appendProjectFile } from '../../platform/fileApi';
import type { NpcPlan } from '../npcTypes';

export type ShadowLogEntry = {
  timestamp: number;
  npcId: string;
  wakeTriggerType: string;
  wakeTriggerCode?: string;
  staticPrefixHash: string;
  minifiedDynamicContext: any;
  generatedPlans: NpcPlan[];
  outcome?: string;
  worldChanged: boolean;
};

export class ShadowLogger {
  private static pendingLogs = new Map<string, ShadowLogEntry>();
  public static isLoggingEnabled = true;
  public static sessionLogsCollected = 0;

  static logWake(
    npcId: string,
    trigger: any,
    staticPrefixHash: string,
    dynamicContext: any,
    plans: NpcPlan[]
  ) {
    if (!this.isLoggingEnabled) return;
    const gProcess = (globalThis as any).process;
    if (
      typeof gProcess !== 'undefined' &&
      (gProcess.env?.VITEST || gProcess.env?.NODE_ENV === 'test')
    ) {
      return;
    }
    this.pendingLogs.set(npcId, {
      timestamp: Date.now(),
      npcId,
      wakeTriggerType: trigger?.type || 'manual',
      wakeTriggerCode: trigger?.result?.code,
      staticPrefixHash,
      minifiedDynamicContext: dynamicContext,
      generatedPlans: plans,
      worldChanged: false,
    });
  }

  static async commit(npcId: string, outcome: string, worldChanged: boolean) {
    if (!this.isLoggingEnabled) return;
    const gProcess = (globalThis as any).process;
    if (
      typeof gProcess !== 'undefined' &&
      (gProcess.env?.VITEST || gProcess.env?.NODE_ENV === 'test')
    ) {
      return;
    }
    const entry = this.pendingLogs.get(npcId);
    if (!entry) return;
    this.pendingLogs.delete(npcId);

    // Differentiating Routine vs. Complex Scenarios (Filtering the Dataset):
    const triggerType = entry.wakeTriggerType;
    const code = entry.wakeTriggerCode;

    // Exclude Loop Watchdog Triggers
    if (
      code === 'repeated_without_progress' ||
      code === 'pattern_without_progress' ||
      code === 'pattern_loop_sleep'
    ) {
      return;
    }

    // Exclude Cognitive Fallbacks & Hallucinations
    if (
      triggerType === 'plan_continued' ||
      triggerType === 'plan_rejected_missing_items' ||
      triggerType === 'plan_interrupted'
    ) {
      return;
    }

    // Keep Only Successes
    if (outcome !== 'plan_completed') return;
    if (!worldChanged) return;

    // Check if plan contains THINK_STRATEGY (should be filtered out by PM already)
    const hasStrategy = entry.generatedPlans.some((plan) =>
      plan.steps.some((step) => step.type === 'THINK_STRATEGY')
    );
    if (hasStrategy) return;

    entry.outcome = outcome;
    entry.worldChanged = worldChanged;

    const line = JSON.stringify(entry) + '\n';
    try {
      await appendProjectFile('logs/slm_shadow_dataset.jsonl', line);
      this.sessionLogsCollected++;
    } catch (err) {
      console.warn('ShadowLogger failed to append log:', err);
    }
  }

  static discard(npcId: string) {
    if (!this.isLoggingEnabled) return;
    const gProcess = (globalThis as any).process;
    if (
      typeof gProcess !== 'undefined' &&
      (gProcess.env?.VITEST || gProcess.env?.NODE_ENV === 'test')
    ) {
      return;
    }
    this.pendingLogs.delete(npcId);
  }

  static async getStats(): Promise<{ enabled: boolean; sessionCount: number; totalCount: number }> {
    let totalCount = 0;
    try {
      // Need to import readProjectFileExisting to count lines
      const { readProjectFileExisting } = await import('../../platform/fileApi');
      const content = await readProjectFileExisting('logs/slm_shadow_dataset.jsonl');
      if (content) {
        totalCount = content.split('\n').filter((line) => line.trim().length > 0).length;
      }
    } catch (e) {
      // File may not exist yet
    }

    return {
      enabled: this.isLoggingEnabled,
      sessionCount: this.sessionLogsCollected,
      totalCount,
    };
  }
}
