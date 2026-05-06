import type { TextAssetManager } from '../core/TextAssetManager';
import type { ILlmProvider } from './llm/ILlmProvider';
import type {
  LlmCascadeDebugInfo,
  ParserCascadeEnvelope,
  ParserContext,
  ParserRelationType,
  ParserToolAction,
} from './parserTypes';

const SYSTEM_PROMPT_URL = '/text/system/parser-llm-system.md';
const PROMPT_ASSET_DOMAIN = 'parser-llm';

const FALLBACK_SYSTEM_PROMPT = [
  'You are a command-line parser and Game Master for a retro adventure game.',
  'Respond with exactly one JSON object and no extra text.',
  'Return either {"kind":"plan","actions":[...]}, {"kind":"final_response","message":"..."}, {"kind":"clarification","question":"..."}, or {"kind":"fallback"}.',
  'Use only real titles from the provided context and only safe parser action types.',
].join('\n');

const ALLOWED_ACTION_TYPES = new Set([
  'lookScene',
  'lookTarget',
  'lookRelationTarget',
  'examineTarget',
  'examineRelationTarget',
  'takeTarget',
  'putTarget',
  'openTarget',
  'closeTarget',
  'showInventory',
  'goToTarget',
  'showText',
]);

const RELATIONS = new Set<ParserRelationType>(['on', 'under', 'in', 'behind', 'near']);

type ConsoleLike = {
  log: (text: string, type?: any) => void;
};

export type LlmCascadePreviousAttempt = {
  kind?:
    | 'post_api_escalation'
    | 'post_api_not_found'
    | 'post_api_recovery'
    | 'forced_cascade_handoff';
  envelope: ParserCascadeEnvelope;
  result: unknown;
};

export class LlmCascade {
  private provider: ILlmProvider;
  private getTextAssets: () => TextAssetManager | undefined;
  private getConsole: () => ConsoleLike | undefined;
  private lastDebugInfo: LlmCascadeDebugInfo | null = null;
  private systemPromptCache: string | null = null;

  constructor(
    provider: ILlmProvider,
    getTextAssets: () => TextAssetManager | undefined,
    getConsole: () => ConsoleLike | undefined
  ) {
    this.provider = provider;
    this.getTextAssets = getTextAssets;
    this.getConsole = getConsole;
  }

  async parse(
    input: string,
    context: ParserContext,
    onThinkingDelta?: (delta: string, accumulated: string) => void,
    previousAttempt?: LlmCascadePreviousAttempt
  ): Promise<ParserCascadeEnvelope | null> {
    const normalizedInput = context.normalizedInput || input.trim().toUpperCase();
    const baseDebug = this.createBaseDebug(input, normalizedInput);

    if (!this.provider.isAvailable()) {
      this.lastDebugInfo = {
        ...baseDebug,
        reason: 'provider_unavailable',
      };
      return null;
    }

    const [systemPrompt, promptAssets] = await Promise.all([
      this.loadSystemPrompt(),
      this.loadPromptAssets(),
    ]);
    const userMessage = [
      `Player command: "${input}"`,
      '',
      'Game world context:',
      JSON.stringify(context, null, 2),
      ...this.promptList(promptAssets, 'world_fact_instructions'),
      ...(previousAttempt
        ? [
            '',
            this.promptText(
              promptAssets,
              previousAttempt.kind === 'forced_cascade_handoff'
                ? 'forced_handoff_label'
                : 'previous_attempt_label'
            ),
            JSON.stringify(previousAttempt, null, 2),
            '',
            ...(previousAttempt.kind === 'forced_cascade_handoff'
              ? this.promptList(promptAssets, 'forced_handoff_instructions')
              : this.promptList(
                  promptAssets,
                  previousAttempt.kind === 'post_api_not_found'
                    ? 'post_api_not_found_instructions'
                    : previousAttempt.kind === 'post_api_recovery'
                      ? 'post_api_recovery_instructions'
                      : 'post_api_escalation_instructions'
                )),
          ]
        : []),
      '',
      this.promptText(promptAssets, 'response_reminder'),
    ].join('\n');

    const messages = [{ role: 'user' as const, content: userMessage }];
    const prompt = {
      system: systemPrompt,
      messages,
    };

    const response = await this.provider.sendMessageStream(
      systemPrompt,
      messages,
      (delta, accumulated) => {
        onThinkingDelta?.(delta, accumulated);
      }
    );

    if (!response.ok) {
      this.lastDebugInfo = {
        ...baseDebug,
        prompt,
        durationMs: response.durationMs,
        tokensGenerated: response.tokensGenerated,
        rawResponse: response.text,
        error: response.error,
        reason: response.reason || 'api_error',
      };
      return null;
    }

    const rawResponse = response.text;
    const extractedJson = this.extractJson(rawResponse);
    const parsed = this.parseJson(extractedJson);
    if (!parsed) {
      this.lastDebugInfo = {
        ...baseDebug,
        prompt,
        durationMs: response.durationMs,
        tokensGenerated: response.tokensGenerated,
        rawResponse,
        extractedJson,
        error: 'LLM response is not valid JSON',
        reason: 'invalid_response',
      };
      return null;
    }

    const normalized = this.normalizeResponse(parsed);
    this.lastDebugInfo = {
      ...baseDebug,
      prompt,
      matched: normalized.actions.length > 0,
      durationMs: response.durationMs,
      tokensGenerated: response.tokensGenerated,
      rawResponse,
      extractedJson,
      acceptedActions: normalized.actions,
      filteredActions: normalized.filteredActions,
      reason:
        normalized.actions.length > 0
          ? undefined
          : normalized.fallback
            ? 'fallback'
            : 'invalid_response',
      error:
        normalized.actions.length > 0 || normalized.fallback
          ? undefined
          : 'LLM response did not contain valid actions',
    };

    if (!normalized.actions.length) {
      return null;
    }

    return {
      stage: 'llm-v3',
      output: {
        kind: 'plan',
        actions: normalized.actions,
      },
      debug: {
        rawInput: input,
        normalizedInput,
        verb: 'LLM',
        noun: '',
        source: undefined,
      },
    };
  }

  getLastDebugInfo(): LlmCascadeDebugInfo | null {
    return this.lastDebugInfo;
  }

  clearLastDebugInfo(): void {
    this.lastDebugInfo = null;
  }

  private createBaseDebug(input: string, normalizedInput: string): LlmCascadeDebugInfo {
    return {
      input,
      normalizedInput,
      matched: false,
      provider: this.provider.getProviderName(),
      model: this.provider.getModelName(),
    };
  }

  private async loadSystemPrompt(): Promise<string> {
    this.getTextAssets();
    if (this.systemPromptCache) return this.systemPromptCache;
    if (typeof fetch !== 'function') {
      this.systemPromptCache = FALLBACK_SYSTEM_PROMPT;
      return this.systemPromptCache;
    }

    try {
      const response = await fetch(SYSTEM_PROMPT_URL);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const prompt = await response.text();
      this.systemPromptCache = prompt.trim() || FALLBACK_SYSTEM_PROMPT;
    } catch (error) {
      this.getConsole()?.log(`[LLM prompt fallback] ${String(error)}`, 'info');
      this.systemPromptCache = FALLBACK_SYSTEM_PROMPT;
    }
    return this.systemPromptCache;
  }

  private async loadPromptAssets(): Promise<Record<string, unknown>> {
    const textAssets = this.getTextAssets();
    if (!textAssets?.readServiceAsset) return {};
    try {
      return await textAssets.readServiceAsset(PROMPT_ASSET_DOMAIN);
    } catch (error) {
      this.getConsole()?.log(`[LLM prompt asset fallback] ${String(error)}`, 'info');
      return {};
    }
  }

  private promptText(assets: Record<string, unknown>, key: string): string {
    const value = assets[key];
    return typeof value === 'string' ? value : '';
  }

  private promptList(assets: Record<string, unknown>, key: string): string[] {
    const value = assets[key];
    if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
    if (typeof value === 'string') return [value];
    return [];
  }

  private extractJson(text: string): string {
    const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/.exec(text);
    if (fenceMatch) return fenceMatch[1].trim();
    const braceMatch = /\{[\s\S]*\}/.exec(text);
    if (braceMatch) return braceMatch[0].trim();
    return text.trim();
  }

  private parseJson(text: string): unknown | null {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private normalizeResponse(parsed: unknown): {
    actions: ParserToolAction[];
    filteredActions: unknown[];
    fallback: boolean;
  } {
    if (!this.isRecord(parsed)) {
      return { actions: [], filteredActions: [parsed], fallback: false };
    }

    if (parsed.kind === 'fallback') {
      return { actions: [], filteredActions: [], fallback: true };
    }

    if (parsed.kind === 'final_response') {
      const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
      return message
        ? { actions: [{ type: 'showText', message }], filteredActions: [], fallback: false }
        : { actions: [], filteredActions: [parsed], fallback: false };
    }

    if (parsed.kind === 'clarification') {
      const question = typeof parsed.question === 'string' ? parsed.question.trim() : '';
      return question
        ? {
            actions: [{ type: 'showText', message: question }],
            filteredActions: [],
            fallback: false,
          }
        : { actions: [], filteredActions: [parsed], fallback: false };
    }

    if (parsed.kind !== 'plan' || !Array.isArray(parsed.actions)) {
      return { actions: [], filteredActions: [parsed], fallback: false };
    }

    const actions: ParserToolAction[] = [];
    const filteredActions: unknown[] = [];

    for (const action of parsed.actions) {
      const validated = this.validateAction(action);
      if (validated) {
        actions.push(validated);
      } else {
        filteredActions.push(action);
      }
    }

    return { actions, filteredActions, fallback: false };
  }

  private validateAction(action: unknown): ParserToolAction | null {
    if (!this.isRecord(action)) return null;
    if (typeof action.type !== 'string' || !ALLOWED_ACTION_TYPES.has(action.type)) return null;

    switch (action.type) {
      case 'lookScene':
        return { type: 'lookScene' };
      case 'showInventory':
        return { type: 'showInventory' };
      case 'lookTarget': {
        const target = this.asString(action.target);
        return target ? { type: 'lookTarget', target } : null;
      }
      case 'lookRelationTarget': {
        const relation = this.asRelation(action.relation);
        if (!relation) return null;
        return {
          type: 'lookRelationTarget',
          relation,
          anchor: this.asNullableString(action.anchor),
        };
      }
      case 'examineTarget':
        return {
          type: 'examineTarget',
          target: this.asNullableString(action.target),
        };
      case 'examineRelationTarget': {
        const relation = this.asRelation(action.relation);
        if (!relation) return null;
        return {
          type: 'examineRelationTarget',
          relation,
          anchor: this.asNullableString(action.anchor),
        };
      }
      case 'takeTarget':
        return {
          type: 'takeTarget',
          target: this.asNullableString(action.target),
          anchor: this.asNullableString(action.anchor),
          relation: this.asNullableRelation(action.relation),
        };
      case 'putTarget':
        return {
          type: 'putTarget',
          item: this.asNullableString(action.item),
          target: this.asNullableString(action.target),
          relation: this.asNullableRelation(action.relation),
        };
      case 'openTarget':
        return {
          type: 'openTarget',
          target: this.asNullableString(action.target),
        };
      case 'closeTarget':
        return {
          type: 'closeTarget',
          target: this.asNullableString(action.target),
        };
      case 'goToTarget':
        return {
          type: 'goToTarget',
          target: this.asNullableString(action.target),
        };
      case 'showText': {
        const message = this.asString(action.message);
        return message ? { type: 'showText', message } : null;
      }
      default:
        return null;
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private asNullableString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    return this.asString(value);
  }

  private asRelation(value: unknown): ParserRelationType | null {
    return typeof value === 'string' && RELATIONS.has(value as ParserRelationType)
      ? (value as ParserRelationType)
      : null;
  }

  private asNullableRelation(value: unknown): ParserRelationType | null {
    if (value === null || value === undefined) return null;
    return this.asRelation(value);
  }
}
