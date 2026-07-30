import type { TextAssetManager } from '../core/TextAssetManager';
import type { ILlmProvider, LlmProviderContent, LlmProviderMessage } from './llm/ILlmProvider';
import { extractJson, parseJson } from './llm/llmJson';
import type {
  LlmCascadeDebugInfo,
  ParserCascadeEnvelope,
  ParserContext,
  ParserRelationType,
  ParserScopeSlice,
  ParserToolAction,
} from './parserTypes';
import { assertParserCascadeEnvelope } from '../contracts/runtimeSchemas';

const SYSTEM_PROMPT_URL = '/text/system/parser-llm-system.md';
const PROMPT_ASSET_DOMAIN = 'parser-llm';
const ANTHROPIC_HAIKU_45_MIN_CACHE_TOKENS = 4096;

const FALLBACK_SYSTEM_PROMPT = [
  'You are a command-line parser and Game Master for a retro adventure game.',
  'Respond with exactly one JSON object and no extra text.',
  'Return either {"kind":"plan","actions":[...]}, {"kind":"final_response","message":"..."}, {"kind":"clarification","question":"...","pendingAction":{...}}, or {"kind":"fallback"}.',
  'Use only real titles from the provided context and only safe parser action types.',
  'Reading, looking, examining, inspecting, or studying are observational intents. Never add TAKE merely to make an object easier to inspect.',
  'A named hidden thing may be sought by examining its visible or held anchor with conditional narration and requiresDiscoveredEntityIds; never target the hidden thing directly.',
].join('\n');

const ALLOWED_ACTION_TYPES = new Set([
  'lookScene',
  'lookTarget',
  'lookRelationTarget',
  'examineTarget',
  'examineRelationTarget',
  'takeTarget',
  'giveTarget',
  'putTarget',
  'openTarget',
  'closeTarget',
  'showInventory',
  'setSceneParserNote',
  'setEntityParserNote',
  'goToTarget',
  'showText',
  'runCustomCommand',
  'requireEntityAvailable',
  'requireAnyEntityAvailable',
  'setEntityState',
  'setGroupDisabled',
  'runScript',
  'stopScript',
]);

const RELATIONS = new Set<ParserRelationType>(['on', 'under', 'in', 'behind', 'near']);

type ConsoleLike = {
  log: (text: string, type?: any) => void;
};

type StaticPromptInfo = {
  sceneId?: string;
  hash: string;
  tokenEstimate: number;
  minCacheTokens: number;
  cacheEligibleEstimate: boolean;
  cacheIneligibleReason?: string;
};

type PromptParts = {
  system: LlmProviderContent;
  messages: LlmProviderMessage[];
  staticPrompt: StaticPromptInfo;
};

type PreparedStaticPrompt = {
  system: LlmProviderContent;
  staticPrompt: StaticPromptInfo;
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
  private preparedStaticPrompt: PreparedStaticPrompt | null = null;

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
    const promptParts = this.buildPromptParts(
      input,
      context,
      systemPrompt,
      promptAssets,
      previousAttempt
    );
    const { system, messages, staticPrompt } = promptParts;
    const prompt = {
      system,
      messages,
      staticPrompt,
    };

    const response = await this.provider.sendMessageStream(
      system,
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
        inputTokens: response.inputTokens,
        cacheCreationInputTokens: response.cacheCreationInputTokens,
        cacheReadInputTokens: response.cacheReadInputTokens,
        rawResponse: response.text,
        error: response.error,
        reason: response.reason || 'api_error',
      };
      return null;
    }

    const rawResponse = response.text;
    const extractedJson = extractJson(rawResponse);
    const parsed = parseJson(extractedJson);
    if (!parsed) {
      this.lastDebugInfo = {
        ...baseDebug,
        prompt,
        durationMs: response.durationMs,
        tokensGenerated: response.tokensGenerated,
        inputTokens: response.inputTokens,
        cacheCreationInputTokens: response.cacheCreationInputTokens,
        cacheReadInputTokens: response.cacheReadInputTokens,
        rawResponse,
        extractedJson,
        error: 'LLM response is not valid JSON',
        reason: 'invalid_response',
      };
      return null;
    }

    const normalized = this.normalizeResponse(parsed, input, context);
    this.lastDebugInfo = {
      ...baseDebug,
      prompt,
      matched: normalized.actions.length > 0,
      durationMs: response.durationMs,
      tokensGenerated: response.tokensGenerated,
      inputTokens: response.inputTokens,
      cacheCreationInputTokens: response.cacheCreationInputTokens,
      cacheReadInputTokens: response.cacheReadInputTokens,
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

    const envelope: ParserCascadeEnvelope = {
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
    assertParserCascadeEnvelope(envelope);
    return envelope;
  }

  getLastDebugInfo(): LlmCascadeDebugInfo | null {
    return this.lastDebugInfo;
  }

  clearLastDebugInfo(): void {
    this.lastDebugInfo = null;
  }

  async prepareStaticPrompt(context: ParserContext): Promise<void> {
    const [systemPrompt, promptAssets] = await Promise.all([
      this.loadSystemPrompt(),
      this.loadPromptAssets(),
    ]);
    this.preparedStaticPrompt = this.buildStaticPromptParts(context, systemPrompt, promptAssets);
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

  private buildPromptParts(
    input: string,
    context: ParserContext,
    systemPrompt: string,
    promptAssets: Record<string, unknown>,
    previousAttempt?: LlmCascadePreviousAttempt
  ): PromptParts {
    const freshStaticPrompt = this.buildStaticPromptParts(context, systemPrompt, promptAssets);
    const preparedStaticPrompt =
      this.preparedStaticPrompt?.staticPrompt.hash === freshStaticPrompt.staticPrompt.hash
        ? this.preparedStaticPrompt
        : freshStaticPrompt;
    this.preparedStaticPrompt = preparedStaticPrompt;

    const messages: LlmProviderMessage[] = [
      {
        role: 'user',
        content: this.buildDynamicUserMessage(input, context, promptAssets, previousAttempt),
      },
    ];

    return {
      system: preparedStaticPrompt.system,
      messages,
      staticPrompt: preparedStaticPrompt.staticPrompt,
    };
  }

  private buildStaticPromptParts(
    context: ParserContext,
    systemPrompt: string,
    promptAssets: Record<string, unknown>
  ): PreparedStaticPrompt {
    const staticContext = this.buildStaticContext(context);
    const staticInstructions = this.buildStaticInstructions(promptAssets);
    const staticSceneBlock = [
      '## Scene-Static Context',
      'This block is stable for the current scene-static prompt cache key.',
      'The per-call dynamic context may override it when game state, Parser Notes, text redirects, spatial relations, scope, inventory, or recent turns have changed.',
      JSON.stringify(staticContext, null, 2),
    ].join('\n');
    const staticPromptText = [systemPrompt, staticInstructions, staticSceneBlock].join('\n\n');
    const staticPrompt = this.describeStaticPrompt(
      this.getStaticSceneId(staticContext),
      staticPromptText
    );

    return {
      system: [
        {
          type: 'text',
          text: systemPrompt,
        },
        {
          type: 'text',
          text: staticInstructions,
        },
        {
          type: 'text',
          text: staticSceneBlock,
          cacheControl: {
            type: 'ephemeral',
            ttl: '5m',
          },
        },
      ],
      staticPrompt,
    };
  }

  private buildStaticInstructions(promptAssets: Record<string, unknown>): string {
    return [
      '## Static Prompt Asset Instructions',
      ...this.sectionFromList(
        'World Model Discipline Addendum',
        this.promptList(promptAssets, 'world_fact_instructions')
      ),
      ...this.sectionFromList(
        'Parser Notes Addendum',
        this.promptList(promptAssets, 'parser_note_instructions')
      ),
      ...this.sectionFromList(
        'Forced Cascade Handoff Instructions',
        this.promptList(promptAssets, 'forced_handoff_instructions')
      ),
      ...this.sectionFromList(
        'Post-API Escalation Instructions',
        this.promptList(promptAssets, 'post_api_escalation_instructions')
      ),
      ...this.sectionFromList(
        'Post-API Not-Found Instructions',
        this.promptList(promptAssets, 'post_api_not_found_instructions')
      ),
      ...this.sectionFromList(
        'Post-API Recovery Instructions',
        this.promptList(promptAssets, 'post_api_recovery_instructions')
      ),
      '',
      '### Hidden Object Spoiler Protection',
      '- `hiddenUnknown` lists objects the character has not discovered. Treat a named hidden object as a blind guess; never confirm its existence or location.',
      '- Broad non-spoiling hints may follow from visible scenery, but direct reveals are forbidden.',
      '',
      '### Direct Game Master World Actions',
      JSON.stringify(this.buildDirectGameMasterActions()),
      '',
      '### Available Authored Parser Commands',
      JSON.stringify(this.buildAvailableCustomCommands()),
    ]
      .filter(Boolean)
      .join('\n');
  }

  private sectionFromList(title: string, lines: string[]): string[] {
    if (!lines.length) return [];
    return ['', `### ${title}`, ...lines.map((line) => `- ${line}`)];
  }

  private buildDynamicUserMessage(
    input: string,
    context: ParserContext,
    promptAssets: Record<string, unknown>,
    previousAttempt?: LlmCascadePreviousAttempt
  ): string {
    return [
      `Player command: "${input}"`,
      '',
      'Per-call dynamic game world context:',
      JSON.stringify(this.buildDynamicContext(input, context)),
      ...(previousAttempt
        ? [
            '',
            this.promptText(
              promptAssets,
              previousAttempt.kind === 'forced_cascade_handoff'
                ? 'forced_handoff_label'
                : 'previous_attempt_label'
            ),
            JSON.stringify(this.compactPreviousAttempt(previousAttempt)),
          ]
        : []),
      '',
      this.promptText(promptAssets, 'response_reminder'),
    ].join('\n');
  }

  private buildStaticContext(context: ParserContext): Record<string, unknown> {
    return this.compactRecord({
      scene: context.scene
        ? {
            id: context.scene.id,
            title: context.scene.title,
            description: context.scene.description,
            lore: context.scene.lore,
          }
        : undefined,
      focusedTarget: this.staticEntityContext(context.focusedTarget),
      entities: (context.entities || []).map((entity) => this.staticEntityContext(entity)),
      knownEntities: (context.knownEntities || []).map((entity) =>
        this.llmKnownEntityContext(entity)
      ),
      inventory: (context.inventory || []).map((entity) => this.staticEntityContext(entity)),
    });
  }

  private staticEntityContext(entity: any): Record<string, unknown> | undefined {
    if (!entity) return undefined;
    return this.compactRecord({
      id: entity.id,
      title: entity.title,
      item: entity.item,
      source: entity.source,
      visibility: entity.visibility,
      hiddenReason: entity.hiddenReason,
      synonyms: entity.synonyms,
      semanticTags: entity.semanticTags,
      description: entity.description,
      lore: entity.lore,
      interactions: entity.interactions,
    });
  }

  private llmKnownEntityContext(entity: any): Record<string, unknown> | undefined {
    if (entity?.visibility !== 'hidden') return this.staticEntityContext(entity);
    return this.compactRecord({
      id: entity.id,
      title: entity.title,
      item: entity.item,
      visibility: entity.visibility,
      hiddenReason: entity.hiddenReason,
      synonyms: entity.synonyms,
      semanticTags: entity.semanticTags,
      parserNote: entity.parserNote,
      parserNoteNeedsCheck: entity.parserNoteNeedsCheck,
      states: entity.states,
    });
  }

  private buildDynamicContext(input: string, context: ParserContext): Record<string, unknown> {
    return this.compactRecord({
      focusedTarget: this.dynamicEntityContext(context.focusedTarget),
      player: context.player,
      scene: context.scene
        ? {
            id: context.scene.id,
            parserNote: context.scene.parserNote,
            parserNoteNeedsCheck: context.scene.parserNoteNeedsCheck,
            activeSubscene: context.scene.activeSubscene,
            recentTurns: context.scene.recentTurns,
          }
        : undefined,
      entities: (context.entities || []).map((entity) => this.dynamicEntityContext(entity)),
      knownEntities: (context.knownEntities || [])
        .filter((entity) => entity.visibility !== 'hidden')
        .map((entity) => this.dynamicEntityContext(entity)),
      inventory: (context.inventory || []).map((entity) => this.dynamicEntityContext(entity)),
      hiddenUnknown: (context.knownEntities || [])
        .filter((entity) => entity.visibility === 'hidden')
        .map((entity) =>
          this.compactRecord({
            id: entity.id,
            title: entity.title,
            hiddenReason: entity.hiddenReason,
            synonyms: entity.synonyms,
          })
        ),
      discoveryOpportunities: this.buildDiscoveryOpportunities(input, context),
      actionScope: context.actionScope,
      targetDetails: this.buildRecognizedTargetDetails(input, context),
      pending: context.pending,
    });
  }

  private buildDiscoveryOpportunities(
    input: string,
    context: ParserContext
  ): Array<{
    hiddenEntityId: string;
    hiddenTitle: string;
    anchorId: string;
    anchorTitle: string;
    relation: ParserRelationType;
  }> {
    const normalizedInput = this.normalizeMatchText(input);
    const availableAnchors = [...(context.entities || []), ...(context.inventory || [])];
    const anchorById = new Map(availableAnchors.map((entity) => [entity.id, entity]));

    return (context.knownEntities || [])
      .filter(
        (entity) =>
          entity.visibility === 'hidden' &&
          (entity.hiddenReason === 'lookable' || entity.hiddenReason === 'examinable') &&
          !!entity.location?.parentId
      )
      .flatMap((entity) => {
        const anchor = anchorById.get(entity.location!.parentId);
        if (!anchor) return [];
        const hiddenNames = [entity.title, ...(entity.synonyms || [])];
        const anchorNames = [anchor.title, ...(anchor.synonyms || [])];
        const mentionsHidden = hiddenNames.some((name) =>
          this.inputMentionsName(normalizedInput, name)
        );
        const mentionsAnchor = anchorNames.some((name) =>
          this.inputMentionsName(normalizedInput, name)
        );
        if (!mentionsHidden || !mentionsAnchor) return [];
        return [
          {
            hiddenEntityId: entity.id,
            hiddenTitle: entity.title,
            anchorId: anchor.id,
            anchorTitle: anchor.title,
            relation: entity.location!.relation,
          },
        ];
      });
  }

  private inputMentionsName(normalizedInput: string, name: string): boolean {
    const normalizedName = this.normalizeMatchText(name);
    if (!normalizedName) return false;
    if (normalizedInput.includes(normalizedName)) return true;
    const singularName = normalizedName.replace(/(?:ies|s)$/u, (ending) =>
      ending === 'ies' ? 'y' : ''
    );
    const singularInputWords = normalizedInput
      .split(' ')
      .map((word) => word.replace(/(?:ies|s)$/u, (ending) => (ending === 'ies' ? 'y' : '')));
    return singularInputWords.includes(singularName);
  }

  private dynamicEntityContext(entity: any): Record<string, unknown> | undefined {
    if (!entity) return undefined;
    return this.compactRecord({
      id: entity.id,
      location: entity.location,
      reachable: entity.reachable,
      visibility: entity.visibility,
      accessibility: entity.accessibility,
      parserNote: entity.parserNote,
      parserNoteNeedsCheck: entity.parserNoteNeedsCheck,
      states: entity.states,
      exit: entity.exit,
    });
  }

  private buildRecognizedTargetDetails(
    input: string,
    context: ParserContext
  ): Array<Record<string, unknown>> | undefined {
    const normalizedInput = this.normalizeMatchText(input);
    const candidates = [
      ...(context.focusedTarget ? [context.focusedTarget] : []),
      ...(context.entities || []),
      ...(context.inventory || []),
    ];
    const matches = candidates
      .filter((entity) => {
        if (!entity?.details) return false;
        return [entity.id, entity.title, ...(entity.synonyms || [])]
          .map((value) => this.normalizeMatchText(String(value || '')))
          .filter((value) => value.length >= 2)
          .some((value) => normalizedInput.includes(value));
      })
      .map((entity) => ({ id: entity.id, title: entity.title, details: entity.details }));
    return matches.length ? matches : undefined;
  }

  private normalizeMatchText(value: string): string {
    return value
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  private compactPreviousAttempt(
    previousAttempt: LlmCascadePreviousAttempt
  ): Record<string, unknown> {
    const envelope = previousAttempt.envelope;
    const result = previousAttempt.result as any;
    return this.compactRecord({
      kind: previousAttempt.kind,
      previous: this.compactRecord({
        stage: envelope.stage,
        output: envelope.output,
        interpretation: envelope.debug
          ? this.compactRecord({
              verb: envelope.debug.verb,
              noun: envelope.debug.noun,
              intent: envelope.debug.intent,
              score: envelope.debug.score,
            })
          : undefined,
      }),
      result: result
        ? this.compactRecord({
            type: result.type,
            handled: result.handled,
            outcomes: result.outcomes,
            reason: result.reason,
          })
        : undefined,
    });
  }

  private describeStaticPrompt(sceneId: string | undefined, text: string): StaticPromptInfo {
    const tokenEstimate = this.estimateTokens(text);
    const cacheEligibleEstimate = tokenEstimate >= ANTHROPIC_HAIKU_45_MIN_CACHE_TOKENS;
    return {
      sceneId,
      hash: this.hashText(text),
      tokenEstimate,
      minCacheTokens: ANTHROPIC_HAIKU_45_MIN_CACHE_TOKENS,
      cacheEligibleEstimate,
      cacheIneligibleReason: cacheEligibleEstimate
        ? undefined
        : `estimated static prompt is below ${ANTHROPIC_HAIKU_45_MIN_CACHE_TOKENS} tokens; Anthropic may ignore cache_control and run uncached`,
    };
  }

  private getStaticSceneId(staticContext: Record<string, unknown>): string | undefined {
    const scene = staticContext.scene;
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return undefined;
    const id = (scene as Record<string, unknown>).id;
    return typeof id === 'string' ? id : undefined;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(String(text || '').length / 4);
  }

  private hashText(text: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
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

  private compactRecord<T extends Record<string, unknown>>(value: T): T {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === null || entry === undefined) continue;
      if (Array.isArray(entry)) {
        const compacted = entry
          .map((item) =>
            item && typeof item === 'object' && !Array.isArray(item)
              ? this.compactRecord(item as Record<string, unknown>)
              : item
          )
          .filter((item) => {
            if (item === null || item === undefined) return false;
            if (Array.isArray(item)) return item.length > 0;
            if (typeof item === 'object') return Object.keys(item).length > 0;
            return true;
          });
        if (!compacted.length) continue;
        result[key] = compacted;
        continue;
      }
      if (typeof entry === 'object') {
        const nested = this.compactRecord(entry as Record<string, unknown>);
        if (!Object.keys(nested).length) continue;
        result[key] = nested;
        continue;
      }
      result[key] = entry;
    }
    return result as T;
  }

  private normalizeResponse(
    parsed: unknown,
    input: string = '',
    context?: ParserContext
  ): {
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
      let message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
      if (message)
        message = message
          .split('—')
          .map((s) => s.trim())
          .join('\u202F—\u202F');
      return message
        ? { actions: [{ type: 'showText', message }], filteredActions: [], fallback: false }
        : { actions: [], filteredActions: [parsed], fallback: false };
    }

    if (parsed.kind === 'clarification') {
      const pendingAction = this.isRecord(parsed.pendingAction)
        ? this.validateAction(parsed.pendingAction)
        : null;
      if (pendingAction) {
        const normalizedPendingAction = this.normalizeClarificationPendingAction(
          pendingAction,
          input
        );
        if (
          context &&
          this.isClarificationActionAlreadyResolved(normalizedPendingAction, context)
        ) {
          return {
            actions: [normalizedPendingAction],
            filteredActions: [
              {
                reason: 'llm_clarification_target_already_resolved',
                response: parsed,
                normalizedAction: normalizedPendingAction,
              },
            ],
            fallback: false,
          };
        }
        const question =
          typeof parsed.question === 'string' && parsed.question.trim()
            ? parsed.question.trim()
            : 'Which one do you mean?';
        return {
          actions: [
            {
              type: 'llmClarification',
              question,
              pendingActions: [normalizedPendingAction],
            },
          ],
          filteredActions: [
            {
              reason: 'llm_structured_clarification_uses_pending_action',
              response: parsed,
              normalizedAction: normalizedPendingAction,
            },
          ],
          fallback: false,
        };
      }
      return {
        actions: [],
        filteredActions: [
          {
            reason: 'llm_clarification_must_use_parser_pending_flow',
            response: parsed,
          },
        ],
        fallback: false,
      };
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

    if (this.isObservationalIntent(input)) {
      const ownershipChanges = actions.filter((action) => action.type === 'takeTarget');
      if (ownershipChanges.length) {
        filteredActions.push({
          reason: 'observational_intent_omits_take',
          actions: ownershipChanges,
        });
        for (let index = actions.length - 1; index >= 0; index--) {
          if (actions[index].type === 'takeTarget') actions.splice(index, 1);
        }
      }
    }

    const parserNotePlan = actions.some((action) => this.isParserNoteAction(action));
    if (parserNotePlan) {
      const hasShowText = actions.some((action) => action.type === 'showText');
      if (!hasShowText) {
        return {
          actions: [],
          filteredActions: [
            ...filteredActions,
            {
              reason: 'parser_note_plan_requires_showText',
              actions,
            },
          ],
          fallback: false,
        };
      }

      const parserNoteSafeActions = actions.filter(
        (action) => this.isParserNoteAction(action) || action.type === 'showText'
      );
      const unsafeActions = actions.filter(
        (action) => !this.isParserNoteAction(action) && action.type !== 'showText'
      );
      return {
        actions: parserNoteSafeActions,
        filteredActions: unsafeActions.length
          ? [
              ...filteredActions,
              {
                reason: 'parser_note_plan_omits_world_actions',
                actions: unsafeActions,
              },
            ]
          : filteredActions,
        fallback: false,
      };
    }

    if (
      filteredActions.some((action) => this.isDirectWorldActionLike(action)) &&
      actions.length > 0 &&
      actions.every((action) => action.type === 'showText')
    ) {
      return {
        actions: [],
        filteredActions: [
          ...filteredActions,
          {
            reason: 'direct_world_action_failed_validation_omits_showText',
            actions,
          },
        ],
        fallback: false,
      };
    }

    return { actions, filteredActions, fallback: false };
  }

  private isObservationalIntent(input: string): boolean {
    const firstWord = input
      .toLocaleLowerCase()
      .trim()
      .match(/[\p{L}\p{N}]+/u)?.[0];
    return (
      !!firstWord &&
      new Set([
        'read',
        'look',
        'examine',
        'inspect',
        'study',
        'check',
        'search',
        'читать',
        'прочитать',
        'осмотреть',
        'изучить',
        'посмотреть',
      ]).has(firstWord)
    );
  }

  private normalizeClarificationPendingAction(
    action: ParserToolAction,
    input: string
  ): ParserToolAction {
    if (action.type !== 'putTarget') return action;
    const loadItem = this.extractLoadLikeItem(input);
    if (!loadItem) return action;
    return {
      ...action,
      item: loadItem,
    };
  }

  private isClarificationActionAlreadyResolved(
    action: ParserToolAction,
    context: ParserContext
  ): boolean {
    let reference: string | null | undefined;
    switch (action.type) {
      case 'lookTarget':
      case 'examineTarget':
      case 'takeTarget':
      case 'openTarget':
      case 'closeTarget':
      case 'goToTarget':
        reference = action.target;
        break;
      default:
        return false;
    }

    const normalizedReference = this.normalizeMatchText(reference || '');
    if (!normalizedReference) return false;
    const candidates = [
      ...(context.focusedTarget ? [context.focusedTarget] : []),
      ...(context.entities || []),
      ...(context.inventory || []),
    ];
    const matchingIds = new Set(
      candidates
        .filter((entity) =>
          [entity.id, entity.title, ...(entity.synonyms || [])]
            .map((value) => this.normalizeMatchText(String(value || '')))
            .some((value) => value === normalizedReference)
        )
        .map((entity) => entity.id)
    );
    return matchingIds.size === 1;
  }

  private extractLoadLikeItem(input: string): string | null {
    let value = String(input || '')
      .replace(/[?.!,]+$/g, '')
      .trim();
    const match = /^(load|insert)\s+(.+)$/i.exec(value);
    if (!match) return null;

    value = match[2].trim();
    const relationMatch = /\s+(?:into|inside|in)\s+/i.exec(value);
    const rawItem = relationMatch ? value.slice(0, relationMatch.index).trim() : value;
    const item = rawItem.replace(/^(the|a|an|my)\s+/i, '').trim();
    return item || null;
  }

  private isParserNoteAction(action: ParserToolAction): boolean {
    return action.type === 'setSceneParserNote' || action.type === 'setEntityParserNote';
  }

  private isDirectWorldActionLike(action: unknown): boolean {
    if (!this.isRecord(action)) return false;
    return (
      action.type === 'requireEntityAvailable' ||
      action.type === 'requireAnyEntityAvailable' ||
      action.type === 'setEntityState' ||
      action.type === 'setGroupDisabled' ||
      action.type === 'runScript' ||
      action.type === 'stopScript'
    );
  }

  private validateAction(action: unknown): ParserToolAction | null {
    if (!this.isRecord(action)) return null;
    if (typeof action.type !== 'string' || !ALLOWED_ACTION_TYPES.has(action.type)) return null;

    switch (action.type) {
      case 'lookScene':
        return { type: 'lookScene' };
      case 'showInventory':
        return { type: 'showInventory' };
      case 'setSceneParserNote': {
        const note = this.asNoteString(action.note);
        return note !== null ? { type: 'setSceneParserNote', note } : null;
      }
      case 'setEntityParserNote': {
        const entityId = this.asString(action.entityId);
        const note = this.asNoteString(action.note);
        return entityId && note !== null ? { type: 'setEntityParserNote', entityId, note } : null;
      }
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
      case 'examineTarget': {
        const narration = this.asExamineNarration(action.narration);
        if (action.narration !== undefined && !narration) return null;
        return {
          type: 'examineTarget',
          target: this.asNullableString(action.target),
          ...(narration ? { narration } : {}),
        };
      }
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
      case 'giveTarget':
        return {
          type: 'giveTarget',
          item: this.asNullableString(action.item),
          target: this.asNullableString(action.target),
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
        let message = this.asString(action.message);
        if (message)
          message = message
            .split('—')
            .map((s) => s.trim())
            .join('\u202F—\u202F');
        return message ? { type: 'showText', message } : null;
      }
      case 'runCustomCommand': {
        const commandId = this.asString(action.commandId);
        if (!commandId || !this.isKnownCustomCommand(commandId)) return null;
        const args = this.asStringMap(action.arguments);
        return args === null
          ? null
          : {
              type: 'runCustomCommand',
              commandId,
              arguments: args,
            };
      }
      case 'requireEntityAvailable': {
        const payload = this.getActionPayload(action);
        const entityId = this.asString(payload.entityId);
        const scopes = this.asScopeArray(payload.scopes);
        if (!entityId || !scopes.length) return null;
        return {
          type: 'requireEntityAvailable',
          entityId,
          scopes,
          saveAs: this.asNullableString(payload.saveAs) || undefined,
          missingMessage: this.asNullableString(payload.missingMessage) || undefined,
        };
      }
      case 'requireAnyEntityAvailable': {
        const payload = this.getActionPayload(action);
        const options = this.asRequireAnyOptions(payload.options);
        if (!options.length) return null;
        return {
          type: 'requireAnyEntityAvailable',
          options,
          saveAs: this.asNullableString(payload.saveAs) || undefined,
          missingMessage: this.asNullableString(payload.missingMessage) || undefined,
        };
      }
      case 'setEntityState': {
        const payload = this.getActionPayload(action);
        const entityId = this.asString(payload.entityId);
        const stateId = this.asString(payload.stateId);
        const value = this.asStateValue(payload.value);
        if (!entityId || !stateId || value === undefined) return null;
        return {
          type: 'setEntityState',
          entityId,
          stateId,
          value,
          missingMessage: this.asNullableString(payload.missingMessage) || undefined,
          source: 'llm',
        };
      }
      case 'setGroupDisabled': {
        const payload = this.getActionPayload(action);
        const groupId = this.asString(payload.groupId);
        if (!groupId || typeof payload.disabled !== 'boolean') return null;
        return {
          type: 'setGroupDisabled',
          groupId,
          disabled: payload.disabled,
        };
      }
      case 'runScript': {
        const payload = this.getActionPayload(action);
        const scriptId = this.asString(payload.scriptId);
        if (!scriptId) return null;
        return {
          type: 'runScript',
          scriptId,
          restart: typeof payload.restart === 'boolean' ? payload.restart : undefined,
        };
      }
      case 'stopScript': {
        const payload = this.getActionPayload(action);
        const scriptId = this.asString(payload.scriptId);
        return scriptId ? { type: 'stopScript', scriptId } : null;
      }
      default:
        return null;
    }
  }

  private getActionPayload(action: Record<string, unknown>): Record<string, unknown> {
    return this.isRecord(action.fields) ? action.fields : action;
  }

  private buildDirectGameMasterActions(): Array<Record<string, unknown>> {
    return [
      {
        description:
          'Set an existing authored State value. Matching state:<id> interactions run automatically after the value changes.',
        action: {
          type: 'setEntityState',
          entityId: 'visible scene object id',
          stateId: 'existing State id',
          value: 'string | number | boolean matching the authored State type',
          missingMessage: 'optional player-facing failure text',
        },
      },
      {
        description: 'Enable or disable every current scene object with this groupID.',
        action: {
          type: 'setGroupDisabled',
          groupId: '#group_id',
          disabled: 'boolean',
        },
      },
      {
        description: 'Start a registered script. Use restart true to avoid duplicate instances.',
        action: {
          type: 'runScript',
          scriptId: 'registered script id',
          restart: 'optional boolean',
        },
      },
      {
        description: 'Stop all active instances of a registered script.',
        action: {
          type: 'stopScript',
          scriptId: 'registered script id',
        },
      },
      {
        description: 'Fail the plan unless an exact object id is available in one of these scopes.',
        action: {
          type: 'requireEntityAvailable',
          entityId: 'exact object id',
          scopes: ['visible', 'held', 'reachable'],
          saveAs: 'optional plan variable',
          missingMessage: 'optional player-facing failure text',
        },
      },
      {
        description: 'Fail the plan unless at least one exact object id option is available.',
        action: {
          type: 'requireAnyEntityAvailable',
          options: [
            {
              entityId: 'exact object id',
              scopes: ['visible', 'held', 'reachable'],
              saveAsValue: 'optional saved marker',
            },
          ],
          saveAs: 'optional plan variable',
          missingMessage: 'optional player-facing failure text',
        },
      },
    ];
  }

  private buildAvailableCustomCommands(): Array<Record<string, unknown>> {
    const commands = this.getTextAssets()?.getParserCommands?.() || [];
    return commands
      .filter((command) => command.id && Array.isArray(command.phrases))
      .map((command) =>
        this.compactRecord({
          id: command.id,
          phrases: command.phrases,
          arguments: (command.arguments || []).map((arg) =>
            this.compactRecord({
              name: arg.name,
              required: arg.required,
              scopes: arg.scopes,
              separatorsBefore: arg.separatorsBefore,
            })
          ),
          action: {
            type: 'runCustomCommand',
            commandId: command.id,
            arguments: Object.fromEntries(
              (command.arguments || []).map((arg) => [arg.name, `<${arg.name}>`])
            ),
          },
        })
      );
  }

  private isKnownCustomCommand(commandId: string): boolean {
    return (this.getTextAssets()?.getParserCommands?.() || []).some(
      (command) => command.id === commandId
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private asNoteString(value: unknown): string | null {
    return typeof value === 'string' ? value.trim() : null;
  }

  private asNullableString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    return this.asString(value);
  }

  private asStringMap(value: unknown): Record<string, string | null> | null {
    if (value === undefined) return {};
    if (!this.isRecord(value)) return null;
    const result: Record<string, string | null> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!key.trim()) return null;
      if (entry === null || entry === undefined) {
        result[key] = null;
      } else if (typeof entry === 'string') {
        result[key] = entry.trim() || null;
      } else {
        return null;
      }
    }
    return result;
  }

  private asStateValue(value: unknown): string | number | boolean | undefined {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? value
      : undefined;
  }

  private asExamineNarration(
    value: unknown
  ): Extract<ParserToolAction, { type: 'examineTarget' }>['narration'] | null {
    if (!this.isRecord(value)) return null;
    const message = this.asString(value.message);
    if (!message || !Array.isArray(value.requiresDiscoveredEntityIds)) return null;
    const requiresDiscoveredEntityIds = value.requiresDiscoveredEntityIds
      .map((entityId) => this.asString(entityId))
      .filter((entityId): entityId is string => !!entityId);
    if (
      requiresDiscoveredEntityIds.length === 0 ||
      requiresDiscoveredEntityIds.length !== value.requiresDiscoveredEntityIds.length
    ) {
      return null;
    }
    return {
      message,
      requiresDiscoveredEntityIds: [...new Set(requiresDiscoveredEntityIds)],
    };
  }

  private asScopeArray(value: unknown): ParserScopeSlice[] {
    if (!Array.isArray(value)) return [];
    const allowed = new Set<ParserScopeSlice>([
      'visible',
      'held',
      'takable',
      'putSource',
      'reachable',
      'examinable',
      'subscene',
      'worldKnown',
      'hiddenKnown',
    ]);
    return value.filter((item): item is ParserScopeSlice => allowed.has(item as ParserScopeSlice));
  }

  private asRequireAnyOptions(
    value: unknown
  ): Array<{ entityId: string; scopes: ParserScopeSlice[]; saveAsValue?: string }> {
    if (!Array.isArray(value)) return [];
    const options: Array<{ entityId: string; scopes: ParserScopeSlice[]; saveAsValue?: string }> =
      [];
    for (const item of value) {
      if (!this.isRecord(item)) continue;
      const entityId = this.asString(item.entityId);
      const scopes = this.asScopeArray(item.scopes);
      if (!entityId || !scopes.length) continue;
      options.push({
        entityId,
        scopes,
        saveAsValue: this.asNullableString(item.saveAsValue) || undefined,
      });
    }
    return options;
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
