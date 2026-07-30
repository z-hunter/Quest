import type { GameActionOutcome } from '../core/GameActionTypes';
import type { ILlmProvider } from './llm/ILlmProvider';
import type { LlmCascadePreviousAttempt } from './LlmCascade';
import { LlmCascade } from './LlmCascade';
import { NlpCascade } from './NlpCascade';
import { matchParserCommandSpec } from './parserCommands';
import {
  extractPutCommand,
  extractGiveCommand,
  extractTakeCommand,
  extractRelationTargetForIntent,
  getStage1CommandWords,
  isLookSceneWord,
  matchStage1Intent,
  normalizeTargetForIntent,
} from './parserLanguage';
import { ParserWorldModelBuilder } from './ParserWorldModelBuilder';
import { Entity } from '../entities/Entity';
import { Actor } from '../entities/Actor';
import { SceneObject } from '../entities/SceneObject';
import { ScriptRegistry } from '../core/ScriptRegistry';
import { ComponentSystem } from '../systems/ComponentSystem';
import { StateEventSystem } from '../systems/StateEventSystem';
import { Geometry } from '../utils/Geometry';
import {
  buildSceneTextLayerSnapshot,
  getInactiveSubsceneAncestors,
  getSceneTextLayerAccessState,
  getSceneTextRelationDirectAccessStates,
  getSceneTextRelationDirectDescendants,
  getSceneTextRelationDescendants,
} from '../scene/SceneTextLayer';
import type {
  ParserCascadeEnvelope,
  ParserClarificationOption,
  ParserClarificationScope,
  ParserCommandArgumentValidation,
  ParserCommandSpec,
  ParserCoreDecision,
  ParserPlanState,
  ParserPendingState,
  ParserRelationType,
  ParserResponse,
  ParserResult,
  ParserScope,
  ParserSpatialNodeContext,
  ParserToolAction,
  ParserWorldModel,
} from './parserTypes';
import { assertParserCascadeEnvelope } from '../contracts/runtimeSchemas';

type ParserNoteDebugEntry = {
  operation: 'context' | 'created' | 'updated' | 'cleared' | 'needsCheck';
  targetType: 'scene' | 'entity' | 'inventory' | 'focusedTarget';
  id: string;
  note: string;
  needsCheck?: boolean;
};

type ParserTimingEntry = {
  label: string;
  ms: number;
};

export class Parser {
  private allowAutoApproachForCurrentPlan = true;
  game: any;
  inputField: HTMLInputElement | null;
  pendingState: ParserPendingState | null;
  nlpCascade: NlpCascade;
  llmCascade: LlmCascade;
  worldModelBuilder: ParserWorldModelBuilder;
  activeWorldModel: ParserWorldModel | null;
  activeScope: ParserScope | null;
  pendingClarificationRetryMessage: string | null;
  pendingClarificationCancelMessage: string | null;

  constructor(game: any, provider: ILlmProvider) {
    this.game = game;
    this.inputField = null;
    this.pendingState = null;
    this.nlpCascade = new NlpCascade(
      () => this.game.textAssets,
      () => this.game.console
    );
    this.llmCascade = new LlmCascade(
      provider,
      () => this.game.textAssets,
      () => this.game.console
    );
    this.worldModelBuilder = new ParserWorldModelBuilder(this.game);
    this.activeWorldModel = null;
    this.activeScope = null;
    this.pendingClarificationRetryMessage = null;
    this.pendingClarificationCancelMessage = null;
  }

  prepareLlmStaticPromptForCurrentScene(): void {
    try {
      const worldModel = this.worldModelBuilder.build('', this.pendingState);
      void this.llmCascade.prepareStaticPrompt(worldModel.context);
    } catch (error) {
      this.game.console?.log?.(`[LLM static prompt prepare skipped] ${String(error)}`, 'info');
    }
  }

  async parse(input: string): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed && !this.pendingState) return;
    if (
      !this.pendingState &&
      this.isSayInput(trimmed) &&
      typeof this.game.sayAsPlayer === 'function'
    ) {
      await this.game.sayAsPlayer(this.extractSayText(trimmed));
      return;
    }
    const originScene = this.game.sceneManager.currentScene;
    try {
      const parseStartedAt = this.now();
      const timings: ParserTimingEntry[] = [];
      const measure = <T>(label: string, fn: () => T): T => {
        const startedAt = this.now();
        try {
          return fn();
        } finally {
          timings.push({ label, ms: this.now() - startedAt });
        }
      };
      this.nlpCascade.clearLastDebugInfo();
      this.llmCascade.clearLastDebugInfo();
      const actionEnvelope = measure('pending', () => this.resolvePendingAction(trimmed));
      if (this.pendingClarificationCancelMessage) {
        const cancelMessage = this.pendingClarificationCancelMessage;
        this.pendingClarificationCancelMessage = null;
        this.game.log(cancelMessage);
        return;
      }
      if (this.pendingClarificationRetryMessage) {
        const retryMessage = this.pendingClarificationRetryMessage;
        this.pendingClarificationRetryMessage = null;
        this.game.log(retryMessage);
        return;
      }
      const worldModel = measure('worldModel', () =>
        this.worldModelBuilder.build(trimmed, this.pendingState)
      );
      this.activeWorldModel = worldModel;
      const context = worldModel.context;
      this.activeScope = worldModel.scope;
      const contextJson = measure('contextJson', () => JSON.stringify(context));
      let envelope =
        actionEnvelope ||
        measure('stage1', () =>
          this.game.console?.parserStage1Enabled === false
            ? this.buildStage1BypassAction(trimmed)
            : this.runStage1(trimmed)
        );
      envelope = measure('focusedDefaults', () => this.applyFocusedDefaultTargets(envelope));

      if (
        !actionEnvelope &&
        this.game.console?.parserStage2Enabled !== false &&
        this.isHandoffEnvelope(envelope)
      ) {
        const stage2StartedAt = this.now();
        const stage2Envelope = await this.nlpCascade.parse(trimmed, context);
        timings.push({ label: 'stage2', ms: this.now() - stage2StartedAt });
        if (stage2Envelope) {
          envelope = measure('focusedDefaults', () =>
            this.applyFocusedDefaultTargets(stage2Envelope)
          );
        }
      }

      let llmAttempted = false;
      const forceCascade1ToLlm =
        !actionEnvelope &&
        this.game.console?.parserLlmEnabled === true &&
        this.game.console?.parserCascade1ForceLlm === true;

      if (forceCascade1ToLlm) {
        llmAttempted = true;
        const cascade1Envelope = envelope;
        const llmStartedAt = this.now();
        const llmEnvelope = await this.runLlmCascade(trimmed, context, {
          kind: 'forced_cascade_handoff',
          envelope: cascade1Envelope,
          result: {
            type: 'forced_cascade_handoff',
            reason: 'c1_off',
          },
        });
        timings.push({ label: 'llm', ms: this.now() - llmStartedAt });
        envelope = measure('focusedDefaults', () =>
          this.applyFocusedDefaultTargets(
            llmEnvelope || this.buildForcedLlmHandoff(trimmed, cascade1Envelope)
          )
        );
      }

      if (
        !actionEnvelope &&
        this.game.console?.parserLlmEnabled === true &&
        !llmAttempted &&
        this.isHandoffEnvelope(envelope)
      ) {
        llmAttempted = true;
        const llmStartedAt = this.now();
        const llmEnvelope = await this.runLlmCascade(trimmed, context);
        timings.push({ label: 'llm', ms: this.now() - llmStartedAt });
        if (llmEnvelope) {
          envelope = measure('focusedDefaults', () => this.applyFocusedDefaultTargets(llmEnvelope));
        }
      }

      const scopeJson = measure('scopeJson', () =>
        JSON.stringify(this.buildPeekScopeSummary(worldModel.scope))
      );
      let resultJson = measure('core', () => this.runParserCore(envelope));

      if (
        !actionEnvelope &&
        this.game.console?.parserLlmEnabled === true &&
        !llmAttempted &&
        this.resultShouldRetryWithLlm(resultJson)
      ) {
        llmAttempted = true;
        const parsedResult = measure('parseResult', () => this.safeParseJson(resultJson));
        const llmStartedAt = this.now();
        const llmEnvelope = await this.runLlmCascade(trimmed, context, {
          kind: this.getPostApiLlmRetryKind(parsedResult),
          envelope,
          result: parsedResult,
        });
        timings.push({ label: 'llmRetry', ms: this.now() - llmStartedAt });
        if (llmEnvelope) {
          envelope = measure('focusedDefaults', () => this.applyFocusedDefaultTargets(llmEnvelope));
          resultJson = measure('coreRetry', () => this.runParserCore(envelope));
        }
      }

      const envelopeJson = measure('envelopeJson', () => JSON.stringify(envelope));
      timings.push({ label: 'totalBeforeResponse', ms: this.now() - parseStartedAt });
      const response = this.buildResponse(
        resultJson,
        envelopeJson,
        contextJson,
        scopeJson,
        timings
      );

      if (response.debugMessages?.length) {
        for (const message of response.debugMessages) {
          if (typeof this.game.console?.logDebug === 'function') {
            this.game.console.logDebug(message);
          } else if (this.game.console?.isOpen !== false) {
            this.game.console?.log(message, 'info', { showInClosed: false });
          }
        }
      }

      this.pendingState =
        response.nextPendingState === undefined ? this.pendingState : response.nextPendingState;

      const playerMessages = response.playerMessages?.length
        ? response.playerMessages
        : response.playerMessage
          ? [response.playerMessage]
          : [];
      this.recordSceneParserTurn(originScene, trimmed, playerMessages);
      if (playerMessages.length) {
        if (typeof this.game.logResponse === 'function') {
          this.game.logResponse(playerMessages);
        } else {
          for (const message of playerMessages) {
            this.game.log(message);
          }
        }
      }
    } catch (error) {
      this.pendingState = null;
      this.activeWorldModel = null;
      this.activeScope = null;
      this.game.console?.log(`[Parser error] ${String(error)}`, 'error');
      this.game.log(this.game.text('parser.parse_unknown'));
    }
  }

  private isSayInput(input: string): boolean {
    return /^\s*-\s*\S/.test(input) || /^\s*SAY(?:\s+|$)/i.test(input);
  }

  private extractSayText(input: string): string {
    if (/^\s*-/.test(input)) return input.replace(/^\s*-\s*/, '').trim();
    return input.replace(/^\s*SAY\s*/i, '').trim();
  }

  private now(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  private recordSceneParserTurn(scene: any, command: string, playerMessages: string[]): void {
    if (!scene || !playerMessages.length) return;
    if (command.trim().startsWith('#')) return;

    const response = playerMessages.join(' ');
    if (typeof scene.addParserRecentTurn === 'function') {
      scene.addParserRecentTurn(command, response);
    }
  }

  private getFocusedDefaultTargetTitle(): string | null {
    const entity = this.game.getInventoryPreviewEntity?.();
    if (!entity || !(entity instanceof Entity)) return null;
    if (!this.game.inventory?.includes(entity)) return null;
    const title = this.getPlayerFacingObjectTitle(entity);
    return title && title.trim() ? title.trim() : null;
  }

  private applyFocusedDefaultTargets(envelope: ParserCascadeEnvelope): ParserCascadeEnvelope {
    if (envelope.output.kind !== 'plan') return envelope;
    const focusedTitle = this.getFocusedDefaultTargetTitle();
    if (!focusedTitle) return envelope;

    let customDefaultConsumed = false;
    const actions = envelope.output.actions.map((action): ParserToolAction => {
      switch (action.type) {
        case 'lookScene':
          if (envelope.debug.verb === 'LOOK' && !envelope.debug.noun) {
            return { type: 'lookTarget', target: focusedTitle };
          }
          return action;
        case 'examineTarget':
          return action.target ? action : { ...action, target: focusedTitle };
        case 'takeTarget':
          return action.target ? action : { ...action, target: focusedTitle };
        case 'giveTarget':
          return action.item ? action : { ...action, item: focusedTitle };
        case 'putTarget':
          return action.item ? action : { ...action, item: focusedTitle };
        case 'openTarget':
          return action.target ? action : { ...action, target: focusedTitle };
        case 'closeTarget':
          return action.target ? action : { ...action, target: focusedTitle };
        case 'goToTarget':
          return action.target ? action : { ...action, target: focusedTitle };
        case 'resolveArgumentEntity':
          if (action.query || customDefaultConsumed) return action;
          customDefaultConsumed = true;
          return { ...action, query: focusedTitle };
        default:
          return action;
      }
    });

    return {
      ...envelope,
      output: {
        ...envelope.output,
        actions,
      },
      debug: {
        ...envelope.debug,
        focusedDefaultTarget: focusedTitle,
      },
    };
  }

  private resolvePendingAction(input: string): ParserCascadeEnvelope | null {
    if (!this.pendingState) return null;
    if (this.isPendingClarificationCancelReply(input)) {
      this.pendingState = null;
      this.pendingClarificationCancelMessage = this.game.text('parser.clarification_cancelled');
      return null;
    }
    if (this.looksLikeFreshCommand(input)) {
      this.pendingState = null;
      return null;
    }

    if (this.pendingState.pendingEnvelopeJson) {
      const pendingEnvelopeJson = this.pendingState.pendingEnvelopeJson;
      try {
        const envelope = JSON.parse(pendingEnvelopeJson) as ParserCascadeEnvelope;
        if (envelope.output.kind !== 'plan') {
          this.pendingState = null;
          return null;
        }

        const selectedOptions = this.resolvePendingClarificationReply(input.trim());
        if (selectedOptions === null) {
          this.pendingClarificationRetryMessage =
            this.pendingState.question || this.game.text('parser.parse_unknown');
          return null;
        }
        const patchedActions = envelope.output.actions.flatMap((action) =>
          this.patchPendingActionWithSelections(action, selectedOptions, input.trim())
        );

        return {
          ...envelope,
          stage: 'pending-resolution',
          output: {
            kind: 'plan',
            actions: patchedActions,
          },
          debug: {
            ...envelope.debug,
            rawInput: input,
            normalizedInput: input.trim().toUpperCase(),
            noun: input.trim(),
            pendingIntent: this.pendingState.commandId || this.pendingState.intent,
          },
        };
      } catch {
        this.pendingState = null;
        return null;
      }
    }

    const action: ParserToolAction =
      this.pendingState.intent === 'look'
        ? { type: 'lookTarget', target: input.trim() }
        : this.pendingState.intent === 'examine'
          ? { type: 'examineTarget', target: input.trim() }
          : this.pendingState.intent === 'take'
            ? { type: 'takeTarget', target: input.trim() }
            : this.pendingState.intent === 'give'
              ? { type: 'giveTarget', item: input.trim(), target: null }
              : this.pendingState.intent === 'put'
                ? { type: 'putTarget', item: input.trim(), target: null, relation: null }
                : this.pendingState.intent === 'open'
                  ? { type: 'openTarget', target: input.trim() }
                  : this.pendingState.intent === 'close'
                    ? { type: 'closeTarget', target: input.trim() }
                    : { type: 'goToTarget', target: input.trim() };

    const envelope: ParserCascadeEnvelope = {
      stage: 'pending-resolution',
      output: {
        kind: 'plan',
        actions: [action],
      },
      debug: {
        rawInput: input,
        normalizedInput: input.trim().toUpperCase(),
        verb: this.pendingState.intent.toUpperCase(),
        noun: input.trim(),
        pendingIntent: this.pendingState.intent,
      },
    };
    return envelope;
  }

  private patchPendingActionWithSelections(
    action: ParserToolAction,
    selectedOptions: ParserClarificationOption[],
    fallbackInput: string
  ): ParserToolAction[] {
    const options = selectedOptions.length
      ? selectedOptions
      : [
          {
            index: 1,
            label: fallbackInput,
            entityId: '',
            scope: 'target' as const,
          },
        ];
    const labels = options.map((option) => option.label);
    const scope = options[0]?.scope || 'target';
    const patchSingle = (label: string): ParserToolAction => {
      if (action.type === 'lookTarget') return { ...action, target: label };
      if (action.type === 'examineTarget') return { ...action, target: label };
      if (action.type === 'takeTarget') {
        return action.anchor && action.relation && scope === 'target'
          ? { ...action, anchor: label }
          : { ...action, target: label };
      }
      if (action.type === 'giveTarget') {
        return scope === 'target' ? { ...action, target: label } : { ...action, item: label };
      }
      if (action.type === 'putTarget') {
        return scope === 'target' ? { ...action, target: label } : { ...action, item: label };
      }
      if (action.type === 'openTarget') return { ...action, target: label };
      if (action.type === 'closeTarget') return { ...action, target: label };
      if (action.type === 'goToTarget') return { ...action, target: label };
      if (action.type === 'resolveArgumentEntity') {
        if (!this.pendingState?.pendingArg || action.arg === this.pendingState.pendingArg) {
          return { ...action, query: label };
        }
        return action;
      }
      if (action.type === 'lookRelationTarget') return { ...action, anchor: label || null };
      if (action.type === 'examineRelationTarget') return { ...action, anchor: label || null };
      return action;
    };

    if (labels.length === 1) return [patchSingle(labels[0])];
    if (
      action.type === 'lookTarget' ||
      action.type === 'examineTarget' ||
      action.type === 'takeTarget' ||
      action.type === 'giveTarget' ||
      action.type === 'putTarget'
    ) {
      if (action.type === 'putTarget' && scope === 'target') {
        return [patchSingle(labels[0])];
      }
      return labels.map((label) => patchSingle(label));
    }
    return [patchSingle(labels[0])];
  }

  private resolvePendingClarificationReply(input: string): ParserClarificationOption[] | null {
    const options = this.pendingState?.clarificationOptions || [];
    if (!options.length) {
      return [
        {
          index: 1,
          label: input,
          entityId: '',
          scope: 'target',
        },
      ];
    }

    const normalizedInput = input.trim().toUpperCase();
    if (!normalizedInput) return null;

    const allowsMultiple = !!this.pendingState?.clarificationAllowsMultiple;
    const allMatched = this.findClarificationOptionByText(input);
    if (allMatched.length === 1) return allMatched;
    if (allMatched.length > 1) return null;

    let selections: ParserClarificationOption[] | null = null;
    if (normalizedInput === 'ALL') {
      selections = [...options];
    } else if (normalizedInput === 'BOTH') {
      if (options.length !== 2) return null;
      selections = [...options];
    } else {
      const parts = input
        .split(/\s*(?:,|\band\b)\s*/i)
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length > 1) {
        selections = [];
        for (const part of parts) {
          const matched = this.findClarificationOptionByText(part);
          if (matched.length !== 1) return null;
          selections.push(matched[0]);
        }
      }
    }

    if (!selections) {
      const matched = this.findClarificationOptionByText(input);
      if (matched.length !== 1) return null;
      selections = matched;
    }

    const deduped: ParserClarificationOption[] = [];
    const seen = new Set<string>();
    for (const selection of selections) {
      const key = selection.entityId || selection.label;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(selection);
    }
    if (deduped.length > 1 && !allowsMultiple) return null;
    return deduped;
  }

  private isPendingClarificationCancelReply(input: string): boolean {
    if (!this.pendingState) return false;
    const normalizedInput = input.trim().toUpperCase();
    if (!normalizedInput) return true;

    const aliases = this.game.textAssets?.getServiceList?.('parser.clarification_cancel_replies');
    return Array.isArray(aliases)
      ? aliases.some((alias: string) => alias.trim().toUpperCase() === normalizedInput)
      : false;
  }

  private findClarificationOptionByText(input: string): ParserClarificationOption[] {
    const options = this.pendingState?.clarificationOptions || [];
    const normalizedInput = input.trim().toUpperCase();
    if (!normalizedInput) return [];

    if (/^\d+$/.test(normalizedInput)) {
      const index = Number(normalizedInput);
      const option = options.find((candidate) => candidate.index === index);
      return option ? [option] : [];
    }

    const exactMatches = options.filter((option) =>
      this.getClarificationOptionLookupTokens(option).includes(normalizedInput)
    );
    if (exactMatches.length) return exactMatches;

    return options.filter((option) =>
      this.getClarificationOptionLookupTokens(option).some((token) =>
        token.includes(normalizedInput)
      )
    );
  }

  private getClarificationOptionLookupTokens(option: ParserClarificationOption): string[] {
    const scene = this.game.sceneManager.currentScene;
    const object = option.entityId ? scene?.getObjectByName(option.entityId) : null;
    const tokens = object ? this.getObjectLookupTokens(object) : [];
    return Array.from(
      new Set([option.label, ...tokens].filter((token): token is string => !!token?.trim()))
    ).map((token) => token.trim().toUpperCase());
  }

  private buildTakeGroupActions(
    rawItem: string | null,
    rawAnchor: string | null,
    relation: ParserRelationType | null
  ): ParserToolAction[] | null {
    const groupQuery = this.parseTakeGroupQuery(rawItem);
    if (!groupQuery) return null;

    const candidates = this.getTakeGroupSourceCandidates(rawAnchor, relation);
    if (!candidates) return null;

    const buildTakeActions = (entities: Entity[]): ParserToolAction[] =>
      this.orderRelationScopedTakeEntities(entities, rawAnchor).map((entity) => ({
        type: 'takeTarget' as const,
        target: this.getPlayerFacingObjectTitle(entity) || entity.name,
        anchor: rawAnchor,
        relation,
      }));

    if (groupQuery.kind !== 'list') {
      const matches = !groupQuery.query
        ? candidates
        : this.findPluralAwareMatchesInCandidates(groupQuery.query, candidates);
      if (!matches.length) {
        const diagnosticMatches = !groupQuery.query
          ? []
          : this.findPluralAwareMatchesInCandidates(
              groupQuery.query,
              this.getVisibleTakeGroupDiagnosticCandidates(rawAnchor, relation)
            );
        if (diagnosticMatches.length) {
          return buildTakeActions(diagnosticMatches);
        }
        return [
          {
            type: 'takeTarget',
            target: groupQuery.query || 'all',
            anchor: rawAnchor,
            relation,
          },
        ];
      }
      if (groupQuery.kind === 'both' && matches.length !== 2) {
        if (matches.length > 1) {
          return [
            this.buildTakeTargetAction(
              groupQuery.query ? this.singularizeSimplePluralQuery(groupQuery.query) : 'all',
              rawAnchor,
              relation
            ),
          ];
        }
        return [this.buildTakeGroupSelectionFailure(matches)];
      }
      return buildTakeActions(matches);
    }

    const selected: Entity[] = [];
    for (const query of groupQuery.queries) {
      const matches = this.findPluralAwareMatchesInCandidates(query, candidates);
      if (matches.length !== 1) {
        return [
          this.buildTakeTargetAction(
            matches.length > 1 ? this.singularizeSimplePluralQuery(query) : query,
            rawAnchor,
            relation
          ),
        ];
      }
      selected.push(matches[0]);
    }

    const deduped: Entity[] = [];
    const seen = new Set<string>();
    for (const entity of selected) {
      if (seen.has(entity.name)) continue;
      seen.add(entity.name);
      deduped.push(entity);
    }
    return deduped.length ? buildTakeActions(deduped) : null;
  }

  private buildTakeTargetAction(
    target: string | null,
    anchor: string | null,
    relation: ParserRelationType | null
  ): Extract<ParserToolAction, { type: 'takeTarget' }> {
    return {
      type: 'takeTarget',
      target,
      anchor,
      relation,
    };
  }

  private orderRelationScopedTakeEntities(entities: Entity[], rawAnchor: string | null): Entity[] {
    if (!rawAnchor || entities.length < 2) return entities;
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return entities;

    const depthFromAnchor = (entity: Entity): number => {
      let depth = 0;
      let current: SceneObject | null = entity;
      const visited = new Set<string>();

      while (current && !visited.has(current.name)) {
        visited.add(current.name);
        const parentId: string =
          typeof (current as any).spatial?.parentNodeId === 'string'
            ? (current as any).spatial.parentNodeId.trim()
            : '';
        if (!parentId) break;
        depth += 1;
        if (parentId === rawAnchor) return depth;
        current = scene.getObjectByName(parentId);
      }

      return depth;
    };

    return [...entities].sort((left, right) => depthFromAnchor(right) - depthFromAnchor(left));
  }

  private buildPutGroupActions(
    rawItem: string | null,
    rawTarget: string | null,
    relation: ParserRelationType | null
  ): ParserToolAction[] | null {
    const groupQuery = this.parseTakeGroupQuery(rawItem);
    if (!groupQuery) return null;

    const sourceCandidates = this.getPutGroupSourceCandidates(rawTarget);
    const initialMatches = this.collectPutGroupInitialMatches(groupQuery, sourceCandidates);
    const targetResolution = rawTarget
      ? this.resolvePutGroupTarget(rawTarget, relation, initialMatches)
      : null;

    if (targetResolution?.status === 'failed') {
      return [
        {
          type: 'parserFailure',
          code: targetResolution.code,
          message: targetResolution.message,
        },
      ];
    }
    if (targetResolution?.status === 'ambiguous') {
      return [
        {
          type: 'parserFailure',
          code: 'ambiguous_put_target',
          message: targetResolution.message,
        },
      ];
    }
    if (targetResolution?.status === 'escalate') {
      return [
        {
          type: 'parserFailure',
          code: targetResolution.code,
          message: this.game.text('parser.parse_unknown'),
        },
      ];
    }

    const candidates =
      targetResolution?.status === 'found'
        ? sourceCandidates.filter(
            (candidate) =>
              !this.isPutSourceAlreadyInTarget(candidate, targetResolution.entity, relation)
          )
        : sourceCandidates;

    const buildPutActions = (entities: Entity[]): ParserToolAction[] =>
      entities.map((entity) =>
        this.buildPutTargetAction(
          this.getPlayerFacingObjectTitle(entity) || entity.name,
          rawTarget,
          relation
        )
      );

    if (groupQuery.kind !== 'list') {
      const matches = !groupQuery.query
        ? candidates
        : this.findPluralAwareMatchesInCandidates(groupQuery.query, candidates);
      if (!matches.length) {
        return [this.buildPutTargetAction(groupQuery.query || 'all', rawTarget, relation)];
      }
      if (groupQuery.kind === 'both' && matches.length !== 2) {
        return [
          this.buildPutTargetAction(
            groupQuery.query ? this.singularizeSimplePluralQuery(groupQuery.query) : 'all',
            rawTarget,
            relation
          ),
        ];
      }
      return buildPutActions(matches);
    }

    const selected: Entity[] = [];
    for (const query of groupQuery.queries) {
      const matches = this.findPluralAwareMatchesInCandidates(query, candidates);
      if (matches.length !== 1) {
        return [
          this.buildPutTargetAction(
            matches.length > 1 ? this.singularizeSimplePluralQuery(query) : query,
            rawTarget,
            relation
          ),
        ];
      }
      selected.push(matches[0]);
    }

    const deduped: Entity[] = [];
    const seen = new Set<string>();
    for (const entity of selected) {
      if (seen.has(entity.name)) continue;
      seen.add(entity.name);
      deduped.push(entity);
    }
    return deduped.length ? buildPutActions(deduped) : null;
  }

  private buildPutTargetAction(
    item: string | null,
    target: string | null,
    relation: ParserRelationType | null
  ): Extract<ParserToolAction, { type: 'putTarget' }> {
    return {
      type: 'putTarget',
      item,
      target,
      relation,
    };
  }

  private getPutGroupSourceCandidates(rawTarget: string | null): Entity[] {
    const sourceScopes: Array<keyof ParserScope> = rawTarget ? ['held', 'putSource'] : ['held'];
    return this.getScopeCandidates(sourceScopes).filter(
      (candidate): candidate is Entity => candidate instanceof Entity
    );
  }

  private collectPutGroupInitialMatches(
    groupQuery: { kind: 'all' | 'both'; query: string } | { kind: 'list'; queries: string[] },
    candidates: Entity[]
  ): Entity[] {
    const matches =
      groupQuery.kind === 'list'
        ? groupQuery.queries.flatMap((query) =>
            this.findPluralAwareMatchesInCandidates(query, candidates)
          )
        : !groupQuery.query
          ? candidates
          : this.findPluralAwareMatchesInCandidates(groupQuery.query, candidates);
    return Array.from(new Set(matches));
  }

  private resolvePutGroupTarget(
    rawTarget: string,
    relation: ParserRelationType | null,
    sourceMatches: Entity[]
  ):
    | { status: 'found'; entity: SceneObject }
    | { status: 'failed'; code: string; message: string }
    | { status: 'ambiguous'; message: string }
    | { status: 'escalate'; code: string } {
    const targetScopes: Array<keyof ParserScope> =
      relation === 'in'
        ? ['held', 'visible', 'subscene']
        : ['visible', 'reachable', 'held', 'subscene'];
    const resolvedTarget = this.resolveContainerAnchor(
      rawTarget,
      targetScopes,
      'parser.put_which_target',
      new Set(sourceMatches)
    );

    if (resolvedTarget.status === 'found') return resolvedTarget;
    if (resolvedTarget.status === 'ambiguous') {
      return {
        status: 'ambiguous',
        message: resolvedTarget.message,
      };
    }
    if (resolvedTarget.status === 'escalate') {
      return {
        status: 'escalate',
        code: resolvedTarget.code,
      };
    }
    return {
      status: 'failed',
      code: 'put_target_not_found',
      message: this.game.text('parser.look_not_found', { target: rawTarget }),
    };
  }

  private parseTakeGroupQuery(
    rawItem: string | null
  ): { kind: 'all' | 'both'; query: string } | { kind: 'list'; queries: string[] } | null {
    const item = String(rawItem || '')
      .replace(/[?.!,]+$/g, '')
      .trim();
    if (!item) return null;

    const quantifierMatch = /^(all|both)\b\s*(.*)$/i.exec(item);
    if (quantifierMatch) {
      const query = this.stripLeadingArticles(quantifierMatch[2]);
      return {
        kind: quantifierMatch[1].toLowerCase() === 'all' ? 'all' : 'both',
        query,
      };
    }

    const queries = this.parseTakeListQueries(item);
    return queries.length > 1 ? { kind: 'list', queries } : null;
  }

  private parseTakeListQueries(rawItem: string): string[] {
    if (!/(?:,|\band\b)/i.test(rawItem)) return [];
    const parts = rawItem
      .split(/\s*(?:,|\band\b)\s*/i)
      .map((part) => this.stripLeadingArticles(part))
      .filter(Boolean);
    if (parts.length <= 1) return [];

    const lastWords = parts[parts.length - 1].split(/\s+/).filter(Boolean);
    const sharedHead = lastWords.length >= 2 ? lastWords[lastWords.length - 1] : null;
    if (!sharedHead) return parts;

    return parts.map((part, index) => {
      if (index === parts.length - 1) return part;
      const words = part.split(/\s+/).filter(Boolean);
      const lastWord = words[words.length - 1] || '';
      return this.arePluralEquivalentWords(lastWord, sharedHead) ? part : `${part} ${sharedHead}`;
    });
  }

  private stripLeadingArticles(input: string): string {
    let value = String(input || '').trim();
    const articles = this.game.textAssets.getParserLexicon().articles || [];
    let changed = true;
    while (changed && value) {
      changed = false;
      for (const article of articles) {
        const normalizedArticle = String(article || '').trim();
        if (!normalizedArticle) continue;
        const pattern = new RegExp(`^${this.escapeRegex(normalizedArticle)}\\s+`, 'i');
        if (pattern.test(value)) {
          value = value.replace(pattern, '').trim();
          changed = true;
          break;
        }
      }
    }
    return value;
  }

  private getTakeGroupSourceCandidates(
    rawAnchor: string | null,
    relation: ParserRelationType | null
  ): Entity[] | null {
    if (!rawAnchor || !relation) {
      return this.getScopeCandidates(['takable']).filter(
        (candidate): candidate is Entity => candidate instanceof Entity
      );
    }

    const targetScopes: Array<keyof ParserScope> =
      relation === 'in'
        ? ['held', 'visible', 'subscene']
        : ['visible', 'reachable', 'held', 'subscene'];
    const resolvedAnchor = this.resolveContainerAnchor(
      rawAnchor,
      targetScopes,
      'parser.take_which_target'
    );
    if (resolvedAnchor.status !== 'found') return null;

    const scoped = this.getScopedTakeCandidates(resolvedAnchor.entity, relation);
    if (scoped.status !== 'resolved' || !scoped.hasStorage) return null;
    return scoped.candidates;
  }

  private getVisibleTakeGroupDiagnosticCandidates(
    rawAnchor: string | null,
    relation: ParserRelationType | null
  ): Entity[] {
    if (rawAnchor || relation) return [];
    return this.getScopeCandidates(['visible']).filter(
      (candidate): candidate is Entity => candidate instanceof Entity
    );
  }

  private findPluralAwareMatchesInCandidates(query: string, candidates: Entity[]): Entity[] {
    const normalizedQuery = this.normalizeSimplePluralText(query);
    if (!normalizedQuery) return [];

    const exactMatches = candidates.filter((candidate) =>
      this.getObjectLookupTokens(candidate).some(
        (token) => this.normalizeSimplePluralText(token) === normalizedQuery
      )
    );
    if (exactMatches.length) return exactMatches;

    return candidates.filter((candidate) =>
      this.getObjectLookupTokens(candidate).some((token) =>
        this.normalizeSimplePluralText(token).includes(normalizedQuery)
      )
    );
  }

  private buildTakeGroupSelectionFailure(matches: Entity[]): ParserToolAction {
    const clarificationOptions = this.getResolutionClarificationOptions(matches, 'source');
    return {
      type: 'parserFailure',
      code: 'take_group_invalid_both',
      message:
        clarificationOptions && clarificationOptions.length
          ? this.game.text('parser.take_which_one', {
              options: this.getNumberedClarificationDisplay(clarificationOptions),
            })
          : this.game.text('parser.parse_unknown'),
    };
  }

  private normalizeSimplePluralText(input: string): string {
    return String(input || '')
      .trim()
      .toUpperCase()
      .split(/\s+/)
      .map((word) => this.normalizeSimplePluralWord(word))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeSimplePluralWord(word: string): string {
    const value = String(word || '').trim();
    if (value.length > 3 && value.endsWith('S') && !value.endsWith('SS')) {
      return value.slice(0, -1);
    }
    return value;
  }

  private singularizeSimplePluralQuery(input: string): string {
    return String(input || '')
      .trim()
      .split(/\s+/)
      .map((word) => this.singularizeSimplePluralWord(word))
      .join(' ')
      .trim();
  }

  private singularizeSimplePluralWord(word: string): string {
    const value = String(word || '').trim();
    if (value.length > 3 && /s$/i.test(value) && !/ss$/i.test(value)) {
      return value.slice(0, -1);
    }
    return value;
  }

  private arePluralEquivalentWords(left: string, right: string): boolean {
    return (
      this.normalizeSimplePluralWord(left.toUpperCase()) ===
      this.normalizeSimplePluralWord(right.toUpperCase())
    );
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private runStage1(input: string): ParserCascadeEnvelope {
    const lexicon = this.game.textAssets.getParserLexicon();
    const match = matchStage1Intent(input, lexicon);
    const commandMatch = matchParserCommandSpec(input, this.game.textAssets.getParserCommands());
    const words = input.trim().split(/\s+/);
    const verb = (words[0] || '').toUpperCase();
    const noun = words.slice(1).join(' ').trim();

    switch (match?.intent) {
      case 'look': {
        const relationQuery = extractRelationTargetForIntent(input, 'look', lexicon);
        const target = normalizeTargetForIntent(input, 'look', lexicon) || match.remainder || noun;
        return {
          stage: 'regex-v1',
          output: {
            kind: 'plan',
            actions: [
              relationQuery
                ? {
                    type: 'lookRelationTarget' as const,
                    relation: relationQuery.relation,
                    anchor: relationQuery.anchor,
                  }
                : !target || isLookSceneWord(target, lexicon)
                  ? { type: 'lookScene' as const }
                  : { type: 'lookTarget' as const, target },
            ],
          },
          debug: {
            rawInput: input,
            normalizedInput: input.trim().toUpperCase(),
            verb,
            noun,
            relation: relationQuery?.relation,
            anchor: relationQuery?.anchor,
          },
        };
      }
      case 'examine': {
        const relationQuery = extractRelationTargetForIntent(input, 'examine', lexicon);
        return {
          stage: 'regex-v1',
          output: {
            kind: 'plan',
            actions: [
              relationQuery
                ? {
                    type: 'examineRelationTarget' as const,
                    relation: relationQuery.relation,
                    anchor: relationQuery.anchor,
                  }
                : {
                    type: 'examineTarget',
                    target:
                      normalizeTargetForIntent(input, 'examine', lexicon) ||
                      match?.remainder ||
                      noun ||
                      null,
                  },
            ],
          },
          debug: {
            rawInput: input,
            normalizedInput: input.trim().toUpperCase(),
            verb,
            noun,
            relation: relationQuery?.relation,
            anchor: relationQuery?.anchor,
          },
        };
      }
      case 'take': {
        const takeCommand = extractTakeCommand(input, lexicon);
        const takeActions = this.buildTakeGroupActions(
          takeCommand.item,
          takeCommand.target,
          takeCommand.relation
        );
        return {
          stage: 'regex-v1',
          output: {
            kind: 'plan',
            actions: takeActions || [
              {
                type: 'takeTarget',
                target:
                  takeCommand.item ||
                  normalizeTargetForIntent(input, 'take', lexicon) ||
                  match?.remainder ||
                  noun ||
                  null,
                anchor: takeCommand.target,
                relation: takeCommand.relation,
              },
            ],
          },
          debug: {
            rawInput: input,
            normalizedInput: input.trim().toUpperCase(),
            verb,
            noun,
            relation: takeCommand.relation || undefined,
            anchor: takeCommand.target,
          },
        };
      }
      case 'give': {
        const giveCommand = extractGiveCommand(input, lexicon);
        return {
          stage: 'regex-v1',
          output: {
            kind: 'plan',
            actions: [{ type: 'giveTarget', item: giveCommand.item, target: giveCommand.target }],
          },
          debug: {
            rawInput: input,
            normalizedInput: input.trim().toUpperCase(),
            verb,
            noun,
            anchor: giveCommand.target,
          },
        };
      }
      case 'put': {
        const putCommand = extractPutCommand(input, lexicon);
        const putActions = this.buildPutGroupActions(
          putCommand.item,
          putCommand.target,
          putCommand.relation
        );
        return {
          stage: 'regex-v1',
          output: {
            kind: 'plan',
            actions: putActions || [
              {
                type: 'putTarget',
                item: putCommand.item,
                target: putCommand.target,
                relation: putCommand.relation,
              },
            ],
          },
          debug: {
            rawInput: input,
            normalizedInput: input.trim().toUpperCase(),
            verb,
            noun,
            relation: putCommand.relation || undefined,
            anchor: putCommand.target,
          },
        };
      }
      case 'open':
        return {
          stage: 'regex-v1',
          output: {
            kind: 'plan',
            actions: [
              {
                type: 'openTarget',
                target:
                  normalizeTargetForIntent(input, 'open', lexicon) ||
                  match?.remainder ||
                  noun ||
                  null,
              },
            ],
          },
          debug: {
            rawInput: input,
            normalizedInput: input.trim().toUpperCase(),
            verb,
            noun,
          },
        };
      case 'close':
        return {
          stage: 'regex-v1',
          output: {
            kind: 'plan',
            actions: [
              {
                type: 'closeTarget',
                target:
                  normalizeTargetForIntent(input, 'close', lexicon) ||
                  match?.remainder ||
                  noun ||
                  null,
              },
            ],
          },
          debug: {
            rawInput: input,
            normalizedInput: input.trim().toUpperCase(),
            verb,
            noun,
          },
        };
      case 'quit':
        return {
          stage: 'regex-v1',
          output: {
            kind: 'plan',
            actions: [{ type: 'quitCurrentView', target: match?.remainder || noun || null }],
          },
          debug: {
            rawInput: input,
            normalizedInput: input.trim().toUpperCase(),
            verb,
            noun,
          },
        };
      case 'showInventory':
        return {
          stage: 'regex-v1',
          output: {
            kind: 'plan',
            actions: [{ type: 'showInventory' }],
          },
          debug: {
            rawInput: input,
            normalizedInput: input.trim().toUpperCase(),
            verb,
            noun,
          },
        };
      case 'goTo': {
        const target = normalizeTargetForIntent(input, 'goTo', lexicon) || match?.remainder || noun;
        return {
          stage: 'regex-v1',
          output: {
            kind: 'plan',
            actions: [{ type: 'goToTarget', target: target || null }],
          },
          debug: {
            rawInput: input,
            normalizedInput: input.trim().toUpperCase(),
            verb,
            noun,
          },
        };
      }
      default:
        if (commandMatch) {
          return this.buildCustomCommandEnvelope(
            input,
            commandMatch.command,
            commandMatch.argumentValues
          );
        }
        return {
          stage: 'regex-v1',
          output: {
            kind: 'handoff_up',
            reason: 'unsupported_by_stage1',
            verb,
            noun,
            rawInput: input,
          },
          debug: {
            rawInput: input,
            normalizedInput: input.trim().toUpperCase(),
            verb,
            noun,
          },
        };
    }
  }

  private buildStage1BypassAction(input: string): ParserCascadeEnvelope {
    const words = input.trim().split(/\s+/);
    const verb = (words[0] || '').toUpperCase();
    const noun = words.slice(1).join(' ').trim();

    const envelope: ParserCascadeEnvelope = {
      stage: 'regex-v1',
      output: {
        kind: 'handoff_up',
        reason: 'stage1_disabled',
        verb,
        noun,
        rawInput: input,
      },
      debug: {
        rawInput: input,
        normalizedInput: input.trim().toUpperCase(),
        verb,
        noun,
      },
    };
    return envelope;
  }

  private isHandoffEnvelope(envelope: ParserCascadeEnvelope): boolean {
    return envelope.output.kind === 'handoff_up';
  }

  private buildForcedLlmHandoff(
    input: string,
    cascade1Envelope: ParserCascadeEnvelope
  ): ParserCascadeEnvelope {
    return {
      stage: 'llm-v3',
      output: {
        kind: 'handoff_up',
        reason: 'forced_llm_handoff_unhandled',
        rawInput: input,
        verb: 'LLM',
        noun: '',
      },
      debug: {
        rawInput: input,
        normalizedInput: input.trim().toUpperCase(),
        verb: 'LLM',
        noun: '',
        pendingIntent: cascade1Envelope.debug.intent,
      },
    };
  }

  private async runLlmCascade(
    input: string,
    context: ParserWorldModel['context'],
    previousAttempt?: LlmCascadePreviousAttempt
  ): Promise<ParserCascadeEnvelope | null> {
    let thinkingLineIndex: number | undefined;
    let thinkingTicks = 0;
    const consoleRef = this.game.console;
    if (consoleRef?.log) {
      const index = consoleRef.log('...', 'output');
      thinkingLineIndex = typeof index === 'number' ? index : undefined;
    }

    try {
      return await this.llmCascade.parse(
        input,
        context,
        () => {
          thinkingTicks += 1;
          const dots = '.'.repeat(3 + (thinkingTicks % 4));
          if (thinkingLineIndex !== undefined && typeof consoleRef?.updateLine === 'function') {
            consoleRef.updateLine(thinkingLineIndex, dots, 'output');
          }
        },
        previousAttempt
      );
    } catch (llmError) {
      this.game.console?.log(`[LLM error] ${String(llmError)}`, 'error');
      return null;
    } finally {
      if (thinkingLineIndex !== undefined && typeof consoleRef?.updateLine === 'function') {
        consoleRef.updateLine(thinkingLineIndex, '...', 'output');
      }
    }
  }

  private resultShouldRetryWithLlm(resultJson: string): boolean {
    try {
      const result = JSON.parse(resultJson) as ParserResult;
      return (
        this.resultHasEscalation(result) ||
        this.resultHasSoftNotFoundFailure(result) ||
        this.resultHasRecoverableFailureForLlm(result)
      );
    } catch {
      return false;
    }
  }

  private resultHasEscalation(result: unknown): boolean {
    return (
      this.isParserOutcomeResult(result) &&
      result.outcomes.some((outcome) => outcome.status === 'escalate')
    );
  }

  private getPostApiLlmRetryKind(result: unknown): LlmCascadePreviousAttempt['kind'] {
    if (this.resultHasEscalation(result)) return 'post_api_escalation';
    if (this.resultHasSoftNotFoundFailure(result)) return 'post_api_not_found';
    return 'post_api_recovery';
  }

  private resultHasSoftNotFoundFailure(result: unknown): boolean {
    if (!this.isParserOutcomeResult(result)) return false;
    return result.outcomes.some((outcome) => {
      if (outcome.status !== 'failed') return false;
      const code = String(outcome.code || '');
      if (
        code === 'entity_not_found' ||
        code === 'take_target_not_found' ||
        code === 'relation_anchor_not_found'
      ) {
        return true;
      }
      const message = String(outcome.message || '');
      return /^You don't see any .+ here\.$/i.test(message);
    });
  }

  private resultHasRecoverableFailureForLlm(result: unknown): boolean {
    if (!this.isParserOutcomeResult(result)) return false;
    const recoveryCodes = new Set([
      'cannot_take',
      'not_takeable',
      'inventory_not_accessible',
      'put_target_is_source',
      'put_item_not_held',
      'put_target_not_accessible',
      'put_target_not_found',
      'relation_not_supported',
      'destination_not_found',
      'custom_command_invalid_argument',
      'custom_command_target_too_far',
      'take_group_invalid_both',
    ]);

    return result.outcomes.some((outcome) => {
      if (outcome.status !== 'failed' || outcome.recoverable === false) return false;
      return recoveryCodes.has(String(outcome.code || ''));
    });
  }

  private isParserOutcomeResult(
    result: unknown
  ): result is Extract<ParserResult, { type: 'outcomes' }> {
    return (
      !!result &&
      typeof result === 'object' &&
      (result as ParserResult).type === 'outcomes' &&
      Array.isArray((result as ParserResult).outcomes)
    );
  }

  private safeParseJson(json: string): unknown {
    try {
      return JSON.parse(json);
    } catch {
      return { raw: json };
    }
  }

  private runParserCore(envelope: ParserCascadeEnvelope): string {
    assertParserCascadeEnvelope(envelope);
    const decision = this.makeCoreDecision(envelope);
    return this.executeCoreDecision(decision);
  }

  private makeCoreDecision(envelope: ParserCascadeEnvelope): ParserCoreDecision {
    if (envelope.output.kind === 'handoff_up') {
      return {
        kind: 'handoff_up',
        reason: envelope.output.reason,
        envelope,
      };
    }

    return {
      kind: 'execute_plan',
      envelope,
      actions: this.expandCustomCommandActions(envelope.output.actions),
    };
  }

  private executeCoreDecision(decision: ParserCoreDecision): string {
    const executedActions: string[] = [];
    const planState: ParserPlanState = {};

    if (decision.kind === 'handoff_up') {
      const result: ParserResult = {
        type: 'handoff',
        handled: false,
        outcomes: [],
        actionsExecuted: executedActions,
        reason: decision.reason,
        coreDecision: decision,
        debug: {
          envelope: decision.envelope,
          phase: 'pre_api',
        },
      };
      return JSON.stringify(result);
    }

    if (!decision.actions.length) {
      const result: ParserResult = {
        type: 'handoff',
        handled: false,
        outcomes: [],
        actionsExecuted: executedActions,
        reason: 'empty_action_plan',
        coreDecision: decision,
        debug: {
          envelope: decision.envelope,
          phase: 'pre_api',
        },
      };
      return JSON.stringify(result);
    }

    const outcomes = this.executeCorePlan(decision.actions, executedActions, planState);

    const result: ParserResult = {
      type: 'outcomes',
      handled: true,
      outcomes,
      actionsExecuted: executedActions,
      coreDecision: decision,
    };
    return JSON.stringify(result);
  }

  private executeCorePlan(
    actions: ParserToolAction[],
    executedActions: string[],
    planState: ParserPlanState
  ): GameActionOutcome[] {
    const outcomes: GameActionOutcome[] = [];
    const previousAutoApproach = this.allowAutoApproachForCurrentPlan;
    this.allowAutoApproachForCurrentPlan = actions.length === 1;

    try {
      for (const action of actions) {
        const outcome = this.executeParserAction(action, planState);
        executedActions.push(this.getExecutedActionName(action));
        this.markTouchedParserNotesNeedCheck(action, outcome);
        outcomes.push(outcome);

        if (outcome.status !== 'ok') {
          break;
        }
        if (outcome.effects?.length) {
          this.refreshActiveWorldModel();
        }
      }
    } finally {
      this.allowAutoApproachForCurrentPlan = previousAutoApproach;
    }

    return outcomes;
  }

  private refreshActiveWorldModel(): void {
    const worldModel = this.worldModelBuilder.build('', this.pendingState);
    this.activeWorldModel = worldModel;
    this.activeScope = worldModel.scope;
  }

  private executeParserAction(
    action: ParserToolAction,
    planState: ParserPlanState
  ): GameActionOutcome {
    switch (action.type) {
      case 'lookScene':
        return this.game.lookScene();
      case 'lookTarget':
        return this.resolveLookTarget(action.target);
      case 'lookRelationTarget':
        return this.resolveRelationTarget('look', action.relation, action.anchor);
      case 'examineTarget':
        return this.resolveExamineTarget(action.target, action.narration);
      case 'examineRelationTarget':
        return this.resolveRelationTarget('examine', action.relation, action.anchor);
      case 'takeTarget':
        return this.resolveTakeTarget(
          action.target,
          action.anchor || null,
          action.relation || null
        );
      case 'giveTarget':
        return this.resolveGiveTarget(action.item, action.target);
      case 'parserFailure':
        return {
          status: 'failed',
          code: action.code,
          message: action.message,
          recoverable: true,
        };
      case 'llmClarification':
        return this.executeLlmClarification(action);
      case 'putTarget':
        return this.resolvePutTarget(action.item, action.target, action.relation);
      case 'openTarget':
        return this.resolveOpenCloseTarget('open', action.target);
      case 'closeTarget':
        return this.resolveOpenCloseTarget('close', action.target);
      case 'quitCurrentView':
        return this.hasClosableView()
          ? this.game.closeFocusedView()
          : this.resolveQuitTarget(action.target || null);
      case 'showInventory':
        return this.game.showInventory();
      case 'setSceneParserNote':
        return this.executeSetSceneParserNote(action.note);
      case 'setEntityParserNote':
        return this.executeSetEntityParserNote(action.entityId, action.note);
      case 'goToTarget':
        return this.resolveGoToTarget(action.target);
      case 'runCustomCommand': {
        const player = this.game.sceneManager.currentScene?.player;
        if (!player) {
          return {
            status: 'failed',
            code: 'actor_not_found',
            recoverable: false,
          };
        }
        const argumentsByName = { ...(action.arguments || {}) };
        for (const [argumentName, ref] of Object.entries(action.argumentRefs || {})) {
          const value = planState[ref];
          argumentsByName[argumentName] = value instanceof Entity ? value.name : null;
        }
        const outcome = this.game.actorCommands.executeCommand(
          player,
          action.commandId,
          argumentsByName
        );
        if (!outcome) {
          return {
            status: 'failed',
            code: 'command_failed',
            recoverable: false,
            message: 'Command execution yielded no outcome.',
          };
        }
        return {
          ...outcome,
          message: outcome.message || outcome.displayMessages?.join('\n'),
        };
      }
      case 'resolveArgumentEntity':
        return this.executeResolveArgumentEntity(action, planState);
      case 'ensureHeldEntity':
        return this.executeEnsureHeldEntity(action, planState);
      case 'goToSceneById':
        return this.game.goToScene(action.sceneId);
      case 'removeInventoryEntity':
        return this.executeRemoveInventoryEntity(action, planState);
      case 'actorUseOn':
        return this.executeActorUseOn(action, planState);
      case 'showText': {
        const resolvedParams = this.resolveShowTextParams(
          action.params,
          action.paramsFromRefs,
          planState
        );
        const message = this.resolveShowTextMessage(action, planState);
        return {
          status: 'ok',
          code: 'custom_message',
          message:
            (message ? this.interpolateTemplate(message, resolvedParams) : undefined) ||
            (action.textKey ? this.game.text(action.textKey, resolvedParams) : undefined),
        };
      }
      case 'requireEntityAvailable':
        return this.executeRequireEntityAvailable(action, planState);
      case 'requireAnyEntityAvailable':
        return this.executeRequireAnyEntityAvailable(action, planState);
      case 'setEntityState':
        return this.executeSetEntityState(action);
      case 'setGroupDisabled':
        return this.executeSetGroupDisabled(action);
      case 'runScript':
        return this.executeRunScript(action);
      case 'stopScript':
        return this.executeStopScript(action);
      default:
        return {
          status: 'escalate',
          code: 'unknown_parser_action',
          message: this.game.text('parser.parse_unknown'),
          recoverable: false,
        };
    }
  }

  private applyExamineNarration(
    outcome: GameActionOutcome,
    narration: Extract<ParserToolAction, { type: 'examineTarget' }>['narration']
  ): GameActionOutcome {
    if (outcome.status !== 'ok' || !narration) return outcome;
    const discoveredEntityIds = Array.isArray(outcome.data?.discoveredEntityIds)
      ? outcome.data.discoveredEntityIds.filter(
          (entityId): entityId is string => typeof entityId === 'string'
        )
      : [];
    const discovered = new Set(discoveredEntityIds);
    if (!narration.requiresDiscoveredEntityIds.every((entityId) => discovered.has(entityId))) {
      return outcome;
    }
    return { ...outcome, message: narration.message };
  }

  private executeLlmClarification(
    action: Extract<ParserToolAction, { type: 'llmClarification' }>
  ): GameActionOutcome {
    const pendingEnvelope = this.buildLlmClarificationPendingEnvelope(action);
    const clarification = this.buildLlmClarificationDisplay(action);
    return {
      status: 'needs_clarification',
      code: 'llm_structured_clarification',
      message: clarification.message,
      recoverable: true,
      data: {
        pendingEnvelopeJson: JSON.stringify(pendingEnvelope),
        clarificationOptions: clarification.options,
      },
    };
  }

  private buildLlmClarificationPendingEnvelope(
    action: Extract<ParserToolAction, { type: 'llmClarification' }>
  ): ParserCascadeEnvelope {
    const rawInput = this.activeWorldModel?.context.rawInput || '';
    return {
      stage: 'llm-v3',
      output: {
        kind: 'plan',
        actions: action.pendingActions,
      },
      debug: {
        rawInput,
        normalizedInput: rawInput.trim().toUpperCase(),
        verb: 'LLM',
        noun: '',
        pendingIntent: this.inferPendingIntentFromActions(action.pendingActions),
      },
    };
  }

  private inferPendingIntentFromActions(actions: ParserToolAction[]): string | undefined {
    const firstAction = actions[0];
    if (!firstAction) return undefined;
    switch (firstAction.type) {
      case 'lookTarget':
      case 'lookRelationTarget':
        return 'look';
      case 'examineTarget':
      case 'examineRelationTarget':
        return 'examine';
      case 'takeTarget':
        return 'take';
      case 'giveTarget':
        return 'give';
      case 'putTarget':
        return 'put';
      case 'openTarget':
        return 'open';
      case 'closeTarget':
        return 'close';
      case 'goToTarget':
        return 'go';
      default:
        return undefined;
    }
  }

  private buildLlmClarificationDisplay(
    action: Extract<ParserToolAction, { type: 'llmClarification' }>
  ): { message: string; options?: ParserClarificationOption[] } {
    const firstAction = action.pendingActions[0];
    if (firstAction?.type === 'putTarget' && firstAction.item) {
      const options = this.getLlmPutSourceClarificationOptions(firstAction.item);
      if (options && options.length > 1) {
        return {
          message: this.game.text('parser.put_which_item', {
            options: this.getNumberedClarificationDisplay(options),
          }),
          options,
        };
      }
    }

    return { message: action.question || this.game.text('parser.parse_unknown') };
  }

  private getLlmPutSourceClarificationOptions(
    rawItem: string
  ): ParserClarificationOption[] | undefined {
    const candidates = this.getScopeCandidates(['held', 'putSource', 'visible']);
    const matches = this.findPluralAwareMatchesInSceneObjects(rawItem, candidates);
    const distinctMatches = this.dedupeSceneObjects(matches);
    const options = this.getResolutionClarificationOptions(distinctMatches, 'source');
    return options && options.length > 1 ? options : undefined;
  }

  private findPluralAwareMatchesInSceneObjects(
    query: string,
    candidates: SceneObject[]
  ): SceneObject[] {
    const normalizedQuery = this.normalizeSimplePluralText(query);
    if (!normalizedQuery) return [];

    const exactMatches = candidates.filter((candidate) =>
      this.getObjectLookupTokens(candidate).some(
        (token) => this.normalizeSimplePluralText(token) === normalizedQuery
      )
    );
    if (exactMatches.length) return exactMatches;

    return candidates.filter((candidate) =>
      this.getObjectLookupTokens(candidate).some((token) =>
        this.normalizeSimplePluralText(token).includes(normalizedQuery)
      )
    );
  }

  private dedupeSceneObjects(sceneObjects: SceneObject[]): SceneObject[] {
    const seen = new Set<string>();
    const deduped: SceneObject[] = [];
    for (const sceneObject of sceneObjects) {
      if (seen.has(sceneObject.name)) continue;
      seen.add(sceneObject.name);
      deduped.push(sceneObject);
    }
    return deduped;
  }

  private getExecutedActionName(action: ParserToolAction): string {
    switch (action.type) {
      case 'lookScene':
        return 'lookScene';
      case 'lookTarget':
        return 'look';
      case 'lookRelationTarget':
        return 'lookRelation';
      case 'examineTarget':
        return 'examine';
      case 'examineRelationTarget':
        return 'examineRelation';
      case 'takeTarget':
        return 'take';
      case 'giveTarget':
        return 'give';
      case 'parserFailure':
        return 'parserFailure';
      case 'llmClarification':
        return 'llmClarification';
      case 'putTarget':
        return 'put';
      case 'openTarget':
        return 'open';
      case 'closeTarget':
        return 'close';
      case 'quitCurrentView':
        return 'quit';
      case 'showInventory':
        return 'showInventory';
      case 'setSceneParserNote':
        return 'setSceneParserNote';
      case 'setEntityParserNote':
        return 'setEntityParserNote';
      case 'goToTarget':
        return 'goTo';
      case 'resolveArgumentEntity':
        return 'resolveArgumentEntity';
      case 'ensureHeldEntity':
        return 'ensureHeldEntity';
      case 'goToSceneById':
        return 'goToSceneById';
      case 'removeInventoryEntity':
        return 'removeInventoryEntity';
      case 'actorUseOn':
        return 'actorUseOn';
      case 'showText':
        return 'showText';
      case 'runCustomCommand':
        return 'runCustomCommand';
      case 'requireEntityAvailable':
        return 'requireEntityAvailable';
      case 'requireAnyEntityAvailable':
        return 'requireAnyEntityAvailable';
      case 'setEntityState':
        return 'setEntityState';
      case 'setGroupDisabled':
        return 'setGroupDisabled';
      case 'runScript':
        return 'runScript';
      case 'stopScript':
        return 'stopScript';
      default:
        return 'unknown';
    }
  }

  private getPlayerFacingObjectTitle(sceneObject: SceneObject): string | null {
    const title = this.game.textAssets.getResolvedObjectField(sceneObject as any, 'title');
    return title && title.trim() ? title.trim() : null;
  }

  private executeSetSceneParserNote(note: string): GameActionOutcome {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'parser_note_scene_missing',
        recoverable: false,
      };
    }

    const previousNote = this.getCurrentSceneParserNote(scene);
    const sanitizedNote = this.sanitizeParserNote(note);
    const operation = this.getParserNoteMutationOperation(previousNote, sanitizedNote);
    if (typeof scene.setParserNote === 'function') {
      scene.setParserNote(sanitizedNote);
    } else {
      scene.parserNote = sanitizedNote;
      scene.parserNoteNeedsCheck = false;
    }

    return {
      status: 'ok',
      code: sanitizedNote ? 'parser_note_scene_updated' : 'parser_note_scene_cleared',
      effects: [this.formatParserNoteEffect(operation, 'scene', scene.id, sanitizedNote)],
      data: {
        targetType: 'scene',
        sceneId: scene.id,
        parserNote: sanitizedNote,
        parserNoteNeedsCheck: false,
        parserNoteOperation: operation,
      },
    };
  }

  private executeSetEntityParserNote(entityId: string, note: string): GameActionOutcome {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'parser_note_scene_missing',
        recoverable: false,
      };
    }

    const normalizedEntityId = String(entityId || '').trim();
    if (!this.isAllowedParserNoteEntityId(normalizedEntityId)) {
      return {
        status: 'failed',
        code: 'parser_note_entity_not_allowed',
        recoverable: false,
      };
    }

    const previousNote = this.getCurrentEntityParserNote(scene, normalizedEntityId);
    const sanitizedNote = this.sanitizeParserNote(note);
    const operation = this.getParserNoteMutationOperation(previousNote, sanitizedNote);
    if (typeof scene.setEntityParserNote === 'function') {
      scene.setEntityParserNote(normalizedEntityId, sanitizedNote);
    } else {
      scene.entityParserNotes = scene.entityParserNotes || {};
      if (sanitizedNote) {
        scene.entityParserNotes[normalizedEntityId] = sanitizedNote;
      } else {
        delete scene.entityParserNotes[normalizedEntityId];
      }
      if (scene.entityParserNoteNeedsCheck) {
        delete scene.entityParserNoteNeedsCheck[normalizedEntityId];
      }
    }

    return {
      status: 'ok',
      code: sanitizedNote ? 'parser_note_entity_updated' : 'parser_note_entity_cleared',
      effects: [
        this.formatParserNoteEffect(operation, 'entity', normalizedEntityId, sanitizedNote),
      ],
      data: {
        targetType: 'entity',
        entityId: normalizedEntityId,
        parserNote: sanitizedNote,
        parserNoteNeedsCheck: false,
        parserNoteOperation: operation,
      },
    };
  }

  private markTouchedParserNotesNeedCheck(
    action: ParserToolAction,
    outcome: GameActionOutcome
  ): void {
    if (outcome.status !== 'ok') return;
    if (action.type === 'setSceneParserNote' || action.type === 'setEntityParserNote') return;

    const touchedEntityIds = this.getParserNoteTouchedEntityIds(action, outcome);
    if (!touchedEntityIds.size) return;

    const scene = this.game.sceneManager.currentScene;
    if (!scene) return;

    const effects = outcome.effects || [];
    for (const entityId of touchedEntityIds) {
      if (!this.markEntityParserNoteNeedsCheck(scene, entityId)) continue;
      effects.push(
        this.formatParserNoteEffect(
          'needsCheck',
          'entity',
          entityId,
          this.getCurrentEntityParserNote(scene, entityId),
          true
        )
      );
    }
    if (effects.length) {
      outcome.effects = effects;
    }
  }

  private getParserNoteTouchedEntityIds(
    action: ParserToolAction,
    outcome: GameActionOutcome
  ): Set<string> {
    const ids = new Set<string>();
    const add = (value: unknown) => {
      const id = typeof value === 'string' ? value.trim() : '';
      if (id) ids.add(id);
    };

    const data = (outcome.data || {}) as Record<string, unknown>;

    if (
      action.type === 'takeTarget' &&
      outcome.effects?.includes('moved_to_inventory') &&
      typeof data.entityId === 'string'
    ) {
      add(data.entityId);
      const previousContext = this.findContextEntityById(data.entityId);
      add(previousContext?.location?.parentId);
    }

    if (
      action.type === 'putTarget' &&
      (outcome.effects?.includes('moved_to_inventory') ||
        outcome.effects?.includes('placed_on_surface') ||
        outcome.effects?.includes('moved_between_containers') ||
        outcome.effects?.includes('moved_between_scene_targets'))
    ) {
      add(data.entityId);
      add(data.ownerId);
      add(data.targetId);
    }

    if (
      action.type === 'giveTarget' &&
      outcome.effects?.includes('item_given') &&
      typeof data.entityId === 'string'
    ) {
      add(data.entityId);
      add(data.targetId);
    }

    if (
      (action.type === 'openTarget' || action.type === 'closeTarget') &&
      (outcome.effects?.includes('switch_opened') || outcome.effects?.includes('switch_closed'))
    ) {
      add(data.entityId);
    }

    if (
      action.type === 'removeInventoryEntity' &&
      outcome.effects?.includes('removed_from_inventory')
    ) {
      add(data.entityId);
    }

    return ids;
  }

  private findContextEntityById(entityId: string): any | null {
    const context = this.activeWorldModel?.context;
    if (!context) return null;
    return (
      context.entities?.find((entity) => entity.id === entityId) ||
      context.knownEntities?.find((entity) => entity.id === entityId) ||
      context.inventory?.find((entity) => entity.id === entityId) ||
      null
    );
  }

  private markEntityParserNoteNeedsCheck(scene: any, entityId: string): boolean {
    const normalizedId = String(entityId || '').trim();
    if (!normalizedId || !this.getCurrentEntityParserNote(scene, normalizedId)) return false;
    if (typeof scene.markEntityParserNoteNeedsCheck === 'function') {
      return !!scene.markEntityParserNoteNeedsCheck(normalizedId);
    }
    scene.entityParserNoteNeedsCheck = scene.entityParserNoteNeedsCheck || {};
    const changed = !scene.entityParserNoteNeedsCheck[normalizedId];
    scene.entityParserNoteNeedsCheck[normalizedId] = true;
    return changed;
  }

  private sanitizeParserNote(note: string): string {
    return String(note || '')
      .trim()
      .slice(0, 600);
  }

  private isAllowedParserNoteEntityId(entityId: string): boolean {
    if (!entityId) return false;
    const context = this.activeWorldModel?.context;
    if (!context) return false;

    const visibleIds = new Set((context.entities || []).map((entity) => entity.id));
    const inventoryIds = new Set((context.inventory || []).map((entity) => entity.id));
    const focusedId = context.focusedTarget?.id;

    return visibleIds.has(entityId) || inventoryIds.has(entityId) || focusedId === entityId;
  }

  private getCurrentSceneParserNote(scene: any): string {
    const note =
      typeof scene?.getParserNote === 'function' ? scene.getParserNote() : scene?.parserNote;
    return typeof note === 'string' ? note.trim() : '';
  }

  private getCurrentEntityParserNote(scene: any, entityId: string): string {
    const note =
      typeof scene?.getEntityParserNote === 'function'
        ? scene.getEntityParserNote(entityId)
        : scene?.entityParserNotes?.[entityId];
    return typeof note === 'string' ? note.trim() : '';
  }

  private getParserNoteMutationOperation(
    previousNote: string,
    nextNote: string
  ): ParserNoteDebugEntry['operation'] {
    if (!nextNote) return 'cleared';
    return previousNote ? 'updated' : 'created';
  }

  private formatParserNoteEffect(
    operation: ParserNoteDebugEntry['operation'],
    targetType: ParserNoteDebugEntry['targetType'],
    id: string,
    note: string,
    needsCheck?: boolean
  ): string {
    return JSON.stringify({
      operation,
      targetType,
      id,
      note,
      ...(needsCheck ? { needsCheck: true } : {}),
    } satisfies ParserNoteDebugEntry);
  }

  private getObjectLookupTokens(sceneObject: SceneObject): string[] {
    const title = this.getPlayerFacingObjectTitle(sceneObject);
    const synonyms = this.game.textAssets.getResolvedObjectListField(
      sceneObject as any,
      'synonyms'
    );
    const walkboxAliases = sceneObject.type === 'Walkbox' ? ['ground'] : [];
    return Array.from(
      new Set(
        [title, ...synonyms, ...walkboxAliases].filter(
          (item): item is string => !!item && !!item.trim()
        )
      )
    ).map((item) => item.toUpperCase());
  }

  private getResolutionOptionTitles(sceneObjects: SceneObject[]): string[] | null {
    const titles = sceneObjects
      .map((sceneObject) => this.getPlayerFacingObjectTitle(sceneObject))
      .filter((title): title is string => !!title);
    if (titles.length !== sceneObjects.length) return null;
    return Array.from(new Set(titles));
  }

  private getResolutionClarificationOptions(
    sceneObjects: SceneObject[],
    scope: ParserClarificationScope = 'target'
  ): ParserClarificationOption[] | null {
    const options: ParserClarificationOption[] = [];
    for (const sceneObject of sceneObjects) {
      const label = this.getPlayerFacingObjectTitle(sceneObject);
      if (!label) return null;
      options.push({
        index: options.length + 1,
        label,
        entityId: sceneObject.name,
        scope,
      });
    }
    return options;
  }

  private getNumberedClarificationDisplay(options: ParserClarificationOption[]): string {
    return options.map((option) => `${option.index}: ${option.label}`).join(', ');
  }

  private withClarificationScope(
    options: ParserClarificationOption[] | undefined,
    scope: ParserClarificationScope
  ): ParserClarificationOption[] | undefined {
    return options?.map((option, index) => ({
      ...option,
      index: index + 1,
      scope,
    }));
  }

  private areResolutionOptionsDistinct(sceneObjects: SceneObject[]): boolean {
    const titles = this.getResolutionOptionTitles(sceneObjects);
    if (!titles) return false;
    return titles.length === sceneObjects.length;
  }

  private getSceneObjectSelectionPriority(sceneObject: SceneObject): {
    bucket: number;
    order: number;
    distance: number;
  } {
    const inventoryIndex = this.game.inventory.indexOf(sceneObject as any);
    if (inventoryIndex >= 0) {
      return {
        bucket: 0,
        order: inventoryIndex,
        distance: 0,
      };
    }

    const scene = this.game.sceneManager.currentScene;
    const player = scene?.player;
    if (player) {
      const location = this.getSceneObjectReferencePoint(sceneObject);
      const dx = location.x - (player.x || 0);
      const dy = location.y - (player.y || 0);
      return {
        bucket: 1,
        order: Number.MAX_SAFE_INTEGER,
        distance: Math.hypot(dx, dy),
      };
    }

    return {
      bucket: 1,
      order: Number.MAX_SAFE_INTEGER,
      distance: Number.MAX_SAFE_INTEGER,
    };
  }

  private getSceneObjectReferencePoint(sceneObject: SceneObject): { x: number; y: number } {
    const polygon = (sceneObject as any).poly;
    if (Array.isArray(polygon) && polygon.length) {
      const sum = polygon.reduce(
        (acc: { x: number; y: number }, point: { x: number; y: number }) => ({
          x: acc.x + (point?.x || 0),
          y: acc.y + (point?.y || 0),
        }),
        { x: 0, y: 0 }
      );
      return {
        x: sum.x / polygon.length,
        y: sum.y / polygon.length,
      };
    }
    return {
      x: Number((sceneObject as any).x) || 0,
      y: Number((sceneObject as any).y) || 0,
    };
  }

  private choosePreferredObject<T extends SceneObject>(sceneObjects: T[]): T | null {
    if (!sceneObjects.length) return null;
    return [...sceneObjects].sort((left, right) => {
      const a = this.getSceneObjectSelectionPriority(left);
      const b = this.getSceneObjectSelectionPriority(right);

      if (a.bucket !== b.bucket) return a.bucket - b.bucket;
      if (a.order !== b.order) return a.order - b.order;
      if (a.distance !== b.distance) return a.distance - b.distance;
      return left.name.localeCompare(right.name);
    })[0];
  }

  private getScopeCandidates(sliceNames: Array<keyof ParserScope>): SceneObject[] {
    const scope = this.activeScope || this.worldModelBuilder.build('', this.pendingState).scope;
    const candidates: SceneObject[] = [];
    for (const sliceName of sliceNames) {
      candidates.push(...(scope[sliceName] as SceneObject[]));
    }
    return Array.from(new Set(candidates));
  }

  private getLookTargetCandidates(): SceneObject[] {
    return this.getScopeCandidates(['visible', 'held']).filter(
      (sceneObject) => sceneObject.type !== 'Walkbox'
    );
  }

  private isFloorTarget(rawTarget: string | null): boolean {
    const normalizedTarget = String(rawTarget || '')
      .trim()
      .toUpperCase();
    if (!normalizedTarget) return false;
    const floorLabel = this.game.textAssets
      .getServiceText('engine.floor_label')
      .trim()
      .toUpperCase();
    return normalizedTarget === floorLabel || normalizedTarget === 'GROUND';
  }

  private getCurrentPlayerWalkboxFloor(): SceneObject | null {
    const scene = this.game.sceneManager.currentScene;
    const player = scene?.player;
    if (!scene || !player) return null;
    const playerPoint = {
      x: Number((player as any).x) || 0,
      y: Number((player as any).y) || 0,
    };
    const walkboxes = Array.isArray(scene.walkbox) ? scene.walkbox : [];
    return (
      walkboxes.find(
        (walkbox: SceneObject) =>
          !walkbox.disabled &&
          Array.isArray((walkbox as any).poly) &&
          Geometry.isPointInPolygon(playerPoint, (walkbox as any).poly)
      ) || null
    );
  }

  private resolveCurrentFloorText(field: 'description' | 'details'): GameActionOutcome | null {
    const floor = this.getCurrentPlayerWalkboxFloor();
    if (!floor) return null;
    const text = this.game.textAssets.getResolvedObjectField(floor as any, field);
    if (!text?.trim()) return null;
    return {
      status: 'ok',
      code: field === 'details' ? 'entity_details' : 'entity_description',
      message: text,
      data: { targetType: 'entity', entityId: floor.name },
    };
  }

  private getFloorDefaultOutcome(rawTarget: string): GameActionOutcome {
    const target =
      this.game.textAssets.getServiceText('engine.floor_label').trim() ||
      String(rawTarget || 'floor');
    return {
      status: 'ok',
      code: 'entity_generic_description',
      message: this.game.text('parser.look_default_object', { target }),
      data: { target },
    };
  }

  private getContextEntityById(id: string): { title: string; synonyms?: string[] } | null {
    const entities = this.activeWorldModel?.context.entities || [];
    return entities.find((entity) => entity.id === id) || null;
  }

  private getSpatialNodeLookupTokens(node: ParserSpatialNodeContext): string[] {
    const entityContext = this.getContextEntityById(node.id);
    const title = entityContext?.title || node.title;
    const synonyms = entityContext?.synonyms || [];
    return Array.from(
      new Set([title, ...synonyms].filter((item): item is string => !!item?.trim()))
    ).map((item) => item.trim().toUpperCase());
  }

  private getSpatialNodes(): ParserSpatialNodeContext[] {
    return this.activeWorldModel?.context.spatialNodes || [];
  }

  private getSpatialNodeDisplayTitle(node: ParserSpatialNodeContext): string {
    const entityContext = this.getContextEntityById(node.id);
    return entityContext?.title?.trim() || node.title?.trim() || '';
  }

  private resolveSpatialNodeTarget(
    rawTarget: string,
    clarificationKey: string
  ):
    | { status: 'found'; node: ParserSpatialNodeContext }
    | { status: 'not_found' }
    | {
        status: 'ambiguous';
        message: string;
        options: string[];
        clarificationOptions?: ParserClarificationOption[];
      }
    | { status: 'escalate'; code: string } {
    const normalizedTarget = String(rawTarget || '')
      .trim()
      .toUpperCase();
    if (!normalizedTarget) return { status: 'not_found' };

    const nodes = this.getSpatialNodes();
    const exactMatches = nodes.filter((node) =>
      this.getSpatialNodeLookupTokens(node).includes(normalizedTarget)
    );
    if (exactMatches.length === 1) return { status: 'found', node: exactMatches[0] };
    if (exactMatches.length > 1) {
      const options = Array.from(
        new Set(exactMatches.map((node) => this.getSpatialNodeDisplayTitle(node)))
      );
      if (options.some((option) => !option) || options.length !== exactMatches.length) {
        return { status: 'escalate', code: 'ambiguous_spatial_nodes_missing_titles' };
      }
      const clarificationOptions = exactMatches.map((node, index) => ({
        index: index + 1,
        label: this.getSpatialNodeDisplayTitle(node),
        entityId: node.id,
        scope: 'target' as const,
      }));
      return {
        status: 'ambiguous',
        message: this.game.text(clarificationKey, {
          options: this.getNumberedClarificationDisplay(clarificationOptions),
        }),
        options,
        clarificationOptions,
      };
    }

    const partialMatches = nodes.filter((node) =>
      this.getSpatialNodeLookupTokens(node).some((token) => token.includes(normalizedTarget))
    );
    if (partialMatches.length === 1) return { status: 'found', node: partialMatches[0] };
    if (partialMatches.length > 1) {
      const options = Array.from(
        new Set(partialMatches.map((node) => this.getSpatialNodeDisplayTitle(node)))
      );
      if (options.some((option) => !option) || options.length !== partialMatches.length) {
        return { status: 'escalate', code: 'ambiguous_spatial_nodes_missing_titles' };
      }
      const clarificationOptions = partialMatches.map((node, index) => ({
        index: index + 1,
        label: this.getSpatialNodeDisplayTitle(node),
        entityId: node.id,
        scope: 'target' as const,
      }));
      return {
        status: 'ambiguous',
        message: this.game.text(clarificationKey, {
          options: this.getNumberedClarificationDisplay(clarificationOptions),
        }),
        options,
        clarificationOptions,
      };
    }

    const broadResolved = this.resolveEntityTargetInCandidates(
      rawTarget,
      this.getScopeCandidates(['visible', 'held']),
      clarificationKey
    );
    if (broadResolved.status === 'found') {
      return {
        status: 'found',
        node: {
          id: broadResolved.entity.name,
          title: this.getPlayerFacingObjectTitle(broadResolved.entity) || undefined,
        },
      };
    }
    if (broadResolved.status === 'ambiguous') {
      return {
        status: 'ambiguous',
        message: broadResolved.message,
        options: broadResolved.options,
        clarificationOptions: broadResolved.clarificationOptions,
      };
    }
    if (broadResolved.status === 'escalate') {
      return {
        status: 'escalate',
        code: broadResolved.code,
      };
    }

    return { status: 'not_found' };
  }

  private resolveEntityTargetInCandidates(
    rawTarget: string,
    candidates: SceneObject[],
    clarificationKey: string
  ):
    | { status: 'found'; entity: SceneObject }
    | { status: 'not_found' }
    | {
        status: 'ambiguous';
        message: string;
        options: string[];
        clarificationOptions?: ParserClarificationOption[];
      }
    | { status: 'escalate'; code: string } {
    const normalizedTarget = String(rawTarget || '')
      .trim()
      .toUpperCase();
    if (!normalizedTarget) return { status: 'not_found' };

    const exactMatches = candidates.filter((sceneObject: SceneObject) =>
      this.getObjectLookupTokens(sceneObject).includes(normalizedTarget)
    );
    if (exactMatches.length === 1) return { status: 'found', entity: exactMatches[0] };
    if (exactMatches.length > 1) {
      if (!this.areResolutionOptionsDistinct(exactMatches)) {
        const preferred = this.choosePreferredObject(exactMatches);
        if (preferred) return { status: 'found', entity: preferred };
      }
      const clarificationOptions = this.getResolutionClarificationOptions(exactMatches);
      if (!clarificationOptions) {
        return { status: 'escalate', code: 'ambiguous_targets_missing_titles' };
      }
      return {
        status: 'ambiguous',
        message: this.game.text(clarificationKey, {
          options: this.getNumberedClarificationDisplay(clarificationOptions),
        }),
        options: clarificationOptions.map((option) => option.label),
        clarificationOptions,
      };
    }

    const partialMatches = candidates.filter((sceneObject: SceneObject) => {
      const lookupTokens = this.getObjectLookupTokens(sceneObject);
      return lookupTokens.some((token) => token.includes(normalizedTarget));
    });
    if (partialMatches.length === 1) return { status: 'found', entity: partialMatches[0] };
    if (partialMatches.length > 1) {
      if (!this.areResolutionOptionsDistinct(partialMatches)) {
        const preferred = this.choosePreferredObject(partialMatches);
        if (preferred) return { status: 'found', entity: preferred };
      }
      const clarificationOptions = this.getResolutionClarificationOptions(partialMatches);
      if (!clarificationOptions) {
        return { status: 'escalate', code: 'ambiguous_targets_missing_titles' };
      }
      return {
        status: 'ambiguous',
        message: this.game.text(clarificationKey, {
          options: this.getNumberedClarificationDisplay(clarificationOptions),
        }),
        options: clarificationOptions.map((option) => option.label),
        clarificationOptions,
      };
    }

    return { status: 'not_found' };
  }

  private resolveEntityTargetWithMessages(
    rawTarget: string | null,
    candidates: SceneObject[],
    messages?: {
      missing?: string;
      ambiguous?: string;
      notFound?: string;
    }
  ):
    | { status: 'found'; entity: SceneObject }
    | { status: 'not_found'; message: string }
    | {
        status: 'needs_clarification';
        message: string;
        options: string[];
        clarificationOptions?: ParserClarificationOption[];
      }
    | { status: 'escalate'; code: string } {
    if (!rawTarget) {
      return {
        status: 'not_found',
        message: messages?.missing || this.game.text('parser.parse_unknown'),
      };
    }

    const resolved = this.resolveEntityTargetInCandidates(
      rawTarget,
      candidates,
      'parser.look_which_one'
    );
    if (resolved.status === 'found') return resolved;
    if (resolved.status === 'escalate') return resolved;
    if (resolved.status === 'not_found') {
      return {
        status: 'not_found',
        message:
          messages?.notFound || this.game.text('parser.look_not_found', { target: rawTarget }),
      };
    }

    return {
      status: 'needs_clarification',
      message:
        messages?.ambiguous?.replace(
          '{options}',
          resolved.clarificationOptions
            ? this.getNumberedClarificationDisplay(resolved.clarificationOptions)
            : resolved.options.join(', ')
        ) || resolved.message,
      options: resolved.options,
      clarificationOptions: resolved.clarificationOptions,
    };
  }

  private resolveInactiveSubsceneSwitchTarget(rawTarget: string):
    | { status: 'found'; entity: SceneObject }
    | { status: 'not_found' }
    | {
        status: 'ambiguous';
        message: string;
        options: string[];
        clarificationOptions?: ParserClarificationOption[];
      }
    | { status: 'escalate'; code: string } {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return { status: 'not_found' };
    const textLayer = buildSceneTextLayerSnapshot(scene, this.game);

    const candidates = [...scene.entities, ...scene.triggerboxes].filter(
      (sceneObject: SceneObject) => {
        if (!sceneObject.components?.some((component: any) => component?.type === 'Switch')) {
          return false;
        }
        if (!textLayer.entryById.has(sceneObject.name)) return false;
        return getInactiveSubsceneAncestors(scene, sceneObject).length > 0;
      }
    );

    return this.resolveEntityTargetInCandidates(rawTarget, candidates, 'parser.examine_which_one');
  }

  private resolveHiddenSwitchGatedTarget(rawTarget: string):
    | { status: 'found'; entity: SceneObject }
    | { status: 'not_found' }
    | {
        status: 'ambiguous';
        message: string;
        options: string[];
        clarificationOptions?: ParserClarificationOption[];
      }
    | { status: 'escalate'; code: string } {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return { status: 'not_found' };

    const candidates = [...scene.entities, ...scene.triggerboxes].filter(
      (sceneObject: SceneObject) => {
        const title = this.getPlayerFacingObjectTitle(sceneObject);
        if (!title) return false;
        const accessState = getSceneTextLayerAccessState(scene, this.game, sceneObject);
        return accessState.hiddenReason === 'switch';
      }
    );

    return this.resolveEntityTargetInCandidates(rawTarget, candidates, 'parser.examine_which_one');
  }

  private resolveLookTarget(rawTarget: string): GameActionOutcome {
    const currentFloorOutcome = this.isFloorTarget(rawTarget)
      ? this.resolveCurrentFloorText('description')
      : null;
    if (currentFloorOutcome) return currentFloorOutcome;

    const resolved = this.resolveEntityTargetInCandidates(
      rawTarget,
      this.getLookTargetCandidates(),
      'parser.look_which_one'
    );
    if (resolved.status === 'escalate') {
      return { status: 'escalate', code: resolved.code, recoverable: true };
    }
    if (resolved.status === 'not_found') {
      const inactiveSwitchResolved = this.resolveInactiveSubsceneSwitchTarget(rawTarget);
      if (inactiveSwitchResolved.status === 'found') {
        return this.withEntityLookExtras(
          this.game.lookEntity(inactiveSwitchResolved.entity as any),
          inactiveSwitchResolved.entity
        );
      }
      if (inactiveSwitchResolved.status === 'ambiguous') {
        return {
          status: 'needs_clarification',
          code: 'ambiguous_look_target',
          message: inactiveSwitchResolved.message,
          data: {
            target: rawTarget,
            options: inactiveSwitchResolved.options,
            clarificationOptions: this.withClarificationScope(
              inactiveSwitchResolved.clarificationOptions,
              'source'
            ),
          },
          recoverable: true,
        };
      }
      if (inactiveSwitchResolved.status === 'escalate') {
        return { status: 'escalate', code: inactiveSwitchResolved.code, recoverable: true };
      }
      if (this.isFloorTarget(rawTarget)) {
        return this.getFloorDefaultOutcome(rawTarget);
      }
      return {
        status: 'failed',
        code: 'entity_not_found',
        message: this.game.text('parser.look_not_found', { target: rawTarget }),
        data: { target: rawTarget },
        recoverable: true,
      };
    }
    if (resolved.status === 'ambiguous') {
      return {
        status: 'needs_clarification',
        code: 'ambiguous_look_target',
        message: resolved.message,
        data: {
          target: rawTarget,
          options: resolved.options,
          clarificationOptions: this.withClarificationScope(
            resolved.clarificationOptions,
            'source'
          ),
        },
        recoverable: true,
      };
    }
    return this.withEntityLookExtras(this.game.lookEntity(resolved.entity as any), resolved.entity);
  }

  private resolveExamineTarget(
    rawTarget: string | null,
    narration?: Extract<ParserToolAction, { type: 'examineTarget' }>['narration']
  ): GameActionOutcome {
    if (!rawTarget) {
      return {
        status: 'needs_clarification',
        code: 'missing_examine_target',
        message: this.game.text('parser.examine_prompt'),
        recoverable: true,
      };
    }

    const currentFloorOutcome = this.isFloorTarget(rawTarget)
      ? this.resolveCurrentFloorText('details')
      : null;
    if (currentFloorOutcome) return currentFloorOutcome;

    const resolved = this.resolveEntityTargetInCandidates(
      rawTarget,
      this.getScopeCandidates(['examinable']).filter(
        (sceneObject) => sceneObject.type !== 'Walkbox'
      ),
      'parser.examine_which_one'
    );
    const broadResolved =
      resolved.status === 'not_found'
        ? this.resolveEntityTargetInCandidates(
            rawTarget,
            this.getLookTargetCandidates(),
            'parser.examine_which_one'
          )
        : null;
    if (resolved.status === 'escalate') {
      return { status: 'escalate', code: resolved.code, recoverable: true };
    }
    if (resolved.status === 'not_found') {
      if (broadResolved?.status === 'escalate') {
        return { status: 'escalate', code: broadResolved.code, recoverable: true };
      }
      if (broadResolved?.status === 'ambiguous') {
        return {
          status: 'needs_clarification',
          code: 'ambiguous_examine_target',
          message: broadResolved.message,
          data: {
            target: rawTarget,
            options: broadResolved.options,
            clarificationOptions: this.withClarificationScope(
              broadResolved.clarificationOptions,
              'source'
            ),
          },
          recoverable: true,
        };
      }
      if (broadResolved?.status === 'found') {
        return this.executePlayerActionWithApproach(broadResolved.entity, () =>
          this.applyExamineNarration(
            this.withEntityLookExtras(
              this.game.examineEntity(broadResolved.entity as any),
              broadResolved.entity
            ),
            narration
          )
        );
      }
      const inactiveSwitchResolved = this.resolveInactiveSubsceneSwitchTarget(rawTarget);
      if (inactiveSwitchResolved.status === 'found') {
        return this.executePlayerActionWithApproach(inactiveSwitchResolved.entity, () =>
          this.applyExamineNarration(
            this.withEntityLookExtras(
              this.game.examineEntity(inactiveSwitchResolved.entity as any),
              inactiveSwitchResolved.entity
            ),
            narration
          )
        );
      }
      if (inactiveSwitchResolved.status === 'ambiguous') {
        return {
          status: 'needs_clarification',
          code: 'ambiguous_examine_target',
          message: inactiveSwitchResolved.message,
          data: {
            target: rawTarget,
            options: inactiveSwitchResolved.options,
            clarificationOptions: this.withClarificationScope(
              inactiveSwitchResolved.clarificationOptions,
              'source'
            ),
          },
          recoverable: true,
        };
      }
      if (inactiveSwitchResolved.status === 'escalate') {
        return { status: 'escalate', code: inactiveSwitchResolved.code, recoverable: true };
      }
      const hiddenGatedResolved = this.resolveHiddenSwitchGatedTarget(rawTarget);
      if (hiddenGatedResolved.status === 'found') {
        return this.executePlayerActionWithApproach(hiddenGatedResolved.entity, () =>
          this.applyExamineNarration(
            this.withEntityLookExtras(
              this.game.examineEntity(hiddenGatedResolved.entity as any),
              hiddenGatedResolved.entity
            ),
            narration
          )
        );
      }
      if (hiddenGatedResolved.status === 'ambiguous') {
        return {
          status: 'needs_clarification',
          code: 'ambiguous_examine_target',
          message: hiddenGatedResolved.message,
          data: {
            target: rawTarget,
            options: hiddenGatedResolved.options,
            clarificationOptions: this.withClarificationScope(
              hiddenGatedResolved.clarificationOptions,
              'source'
            ),
          },
          recoverable: true,
        };
      }
      if (hiddenGatedResolved.status === 'escalate') {
        return { status: 'escalate', code: hiddenGatedResolved.code, recoverable: true };
      }
      if (this.isFloorTarget(rawTarget)) {
        return this.getFloorDefaultOutcome(rawTarget);
      }
      return {
        status: 'failed',
        code: 'entity_not_found',
        message: this.game.text('parser.look_not_found', { target: rawTarget }),
        data: { target: rawTarget },
        recoverable: true,
      };
    }
    if (resolved.status === 'ambiguous') {
      return {
        status: 'needs_clarification',
        code: 'ambiguous_examine_target',
        message: resolved.message,
        data: {
          target: rawTarget,
          options: resolved.options,
          clarificationOptions: this.withClarificationScope(
            resolved.clarificationOptions,
            'source'
          ),
        },
        recoverable: true,
      };
    }
    return this.executePlayerActionWithApproach(resolved.entity, () =>
      this.applyExamineNarration(
        this.withEntityLookExtras(this.game.examineEntity(resolved.entity as any), resolved.entity),
        narration
      )
    );
  }

  private executePlayerActionWithApproach(
    target: SceneObject,
    action: () => GameActionOutcome
  ): GameActionOutcome {
    if (!this.allowAutoApproachForCurrentPlan) return action();
    const scene = this.game.sceneManager.currentScene;
    const player = scene?.player || null;
    if (!scene || !player) return action();
    if (scene.activeSubscene) return action();

    const perception = this.game.actorWorld.getObjectPerception(player, target);
    if (
      perception.interaction === 'held' ||
      perception.interaction === 'reachable' ||
      perception.approach === 'already_reachable'
    ) {
      return action();
    }

    const approach = this.game.actorNavigation.planApproach(player, target);
    if (approach.status !== 'route_available' || !approach.point) return action();

    const moveResult = player.moveTo(approach.point.x, approach.point.y);
    if (moveResult.status !== 'started') return action();

    const sourceScene = scene;
    const poll = () => {
      const result = player.getMoveResult();
      if (result.status === 'started' && player.state === 'walk') {
        globalThis.setTimeout(poll, 50);
        return;
      }
      const currentScene = this.game.sceneManager.currentScene;
      if (result.status === 'arrived' && currentScene === sourceScene) {
        const outcome = action();
        if (outcome.message) this.game.showMessage(outcome.message);
        return;
      }
      this.game.showMessage(this.game.text('engine.too_far_generic'));
    };
    globalThis.setTimeout(poll, 50);

    return {
      status: 'ok',
      code: 'player_approaching_for_action',
      data: { targetType: 'entity', entityId: target.name },
      effects: ['player_move_started', 'action_scheduled_after_arrival'],
    };
  }

  private withEntityLookExtras(outcome: GameActionOutcome, entity: SceneObject): GameActionOutcome {
    if (outcome.status !== 'ok' || !outcome.message) return outcome;
    const extraMessages: string[] = [];

    if (
      outcome.code === 'entity_description' ||
      outcome.code === 'entity_generic_description' ||
      outcome.code === 'entity_details' ||
      outcome.code === 'entity_description_fallback'
    ) {
      extraMessages.push(...this.getEntitySpatialContentsText(entity, { revealLookable: true }));
    }

    const scene = this.game.sceneManager.currentScene;
    if (scene && entity?.name && !this.getEntityParserNoteNeedsCheck(scene, entity.name)) {
      const note = this.getCurrentEntityParserNote(scene, entity.name);
      if (note) extraMessages.push(note);
    }

    if (!extraMessages.length) return outcome;
    return {
      ...outcome,
      message: [outcome.message, ...extraMessages].join('\n'),
    };
  }

  private getEntitySpatialContentsText(
    entity: SceneObject,
    options: { revealLookable?: boolean } = {}
  ): string[] {
    const scene = this.game.sceneManager.currentScene;
    if (!scene || !entity?.name) return [];

    let textLayer = buildSceneTextLayerSnapshot(scene, this.game);
    const anchorTitle =
      textLayer.entryById.get(entity.name)?.title?.trim() ||
      this.getPlayerFacingObjectTitle(entity)?.trim() ||
      null;
    if (!anchorTitle) return [];

    return (['in', 'on', 'under', 'behind'] as const)
      .map((relation) => {
        let discovered = false;
        if (options.revealLookable) {
          const revealableLookables = getSceneTextRelationDirectAccessStates(
            scene,
            this.game,
            entity.name,
            relation,
            { includeHidden: true }
          ).filter((accessState) => accessState.hiddenReason === 'lookable');

          if (revealableLookables.length) {
            revealableLookables.forEach((accessState) =>
              scene.revealHiddenEntity(accessState.object)
            );
            textLayer = buildSceneTextLayerSnapshot(scene, this.game);
            discovered = true;
          }
        }

        const childTitles = getSceneTextRelationDirectDescendants(textLayer, entity.name, relation)
          .map((entry) => entry.title)
          .filter((title): title is string => !!title);

        if (!childTitles.length) return null;

        return this.game.text(
          discovered ? 'parser.relation_discovered_contents' : 'parser.relation_contents',
          {
            Relation: this.capitalize(this.getRelationDisplayText(relation)),
            relation: this.getRelationDisplayText(relation),
            target: anchorTitle,
            items: this.formatTitleList(childTitles),
          }
        );
      })
      .filter((message): message is string => !!message?.trim());
  }

  private capitalize(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  }

  private formatTitleList(items: string[]): string {
    if (items.length <= 1) return items[0] || '';
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  }

  private getEntityParserNoteNeedsCheck(scene: any, entityId: string): boolean {
    if (!this.getCurrentEntityParserNote(scene, entityId)) return false;
    if (typeof scene?.getEntityParserNoteNeedsCheck === 'function') {
      return !!scene.getEntityParserNoteNeedsCheck(entityId);
    }
    return !!scene?.entityParserNoteNeedsCheck?.[entityId];
  }

  private resolveRelationTarget(
    intent: 'look' | 'examine',
    relation: ParserRelationType,
    anchor: string | null
  ): GameActionOutcome {
    if (!anchor) {
      return {
        status: 'needs_clarification',
        code:
          intent === 'look' ? 'missing_look_relation_anchor' : 'missing_examine_relation_anchor',
        message:
          intent === 'look'
            ? this.game.text('parser.look_relation_prompt')
            : this.game.text('parser.examine_relation_prompt'),
        data: { relation },
        recoverable: true,
      };
    }

    const clarificationKey =
      intent === 'look' ? 'parser.look_which_one' : 'parser.examine_which_one';
    const resolved = this.resolveSpatialNodeTarget(anchor, clarificationKey);

    if (resolved.status === 'escalate') {
      return { status: 'escalate', code: resolved.code, recoverable: true };
    }
    if (resolved.status === 'not_found') {
      return {
        status: 'failed',
        code: 'relation_anchor_not_found',
        message: this.game.text('parser.look_not_found', { target: anchor }),
        data: { relation, anchor },
        recoverable: true,
      };
    }
    if (resolved.status === 'ambiguous') {
      return {
        status: 'needs_clarification',
        code: 'ambiguous_relation_anchor',
        message: resolved.message,
        data: {
          relation,
          anchor,
          options: resolved.options,
          clarificationOptions: resolved.clarificationOptions,
        },
        recoverable: true,
      };
    }

    if (relation === 'near') {
      const nodeTitle = this.getSpatialNodeDisplayTitle(resolved.node);
      if (!nodeTitle) {
        return {
          status: 'escalate',
          code: 'spatial_node_missing_title',
          recoverable: true,
        };
      }
      return {
        status: 'failed',
        code: 'relation_not_supported',
        message: this.game.text('parser.relation_not_supported', {
          relation: this.getRelationDisplayText(relation),
          target: nodeTitle,
        }),
        data: {
          relation,
          anchorNodeId: resolved.node.id,
        },
        recoverable: true,
      };
    }

    const outcome = this.game.describeSpatialRelation(resolved.node.id, relation);
    const actor = this.game.sceneManager.currentScene?.player || null;
    const anchorObject = this.game.sceneManager.currentScene?.getObjectByName(resolved.node.id);
    if (outcome.status === 'ok' && actor && anchorObject) {
      this.game.emitActorAction?.(actor, intent, anchorObject, {
        targetId: anchorObject.name,
        relation,
      });
    }
    return outcome;
  }

  private resolveContainerAnchor(
    rawTarget: string,
    candidateScopes: Array<keyof ParserScope>,
    clarificationKey: string,
    excludedTargets: Set<SceneObject> = new Set()
  ):
    | { status: 'found'; entity: SceneObject }
    | { status: 'not_found' }
    | {
        status: 'ambiguous';
        message: string;
        options: string[];
        clarificationOptions?: ParserClarificationOption[];
      }
    | { status: 'escalate'; code: string } {
    const candidates = this.getScopeCandidates(candidateScopes).filter(
      (candidate) => !excludedTargets.has(candidate)
    );
    const resolved = this.resolveEntityTargetInCandidates(rawTarget, candidates, clarificationKey);
    if (resolved.status !== 'not_found') {
      return resolved;
    }

    const nodeResolved = this.resolveSpatialNodeTarget(rawTarget, clarificationKey);
    if (nodeResolved.status !== 'found') {
      return nodeResolved;
    }

    const scene = this.game.sceneManager.currentScene;
    const entity = scene?.getObjectByName(nodeResolved.node.id) || null;
    if (!entity) {
      return { status: 'escalate', code: 'spatial_node_target_missing_object' };
    }
    if (excludedTargets.has(entity)) {
      return { status: 'not_found' };
    }
    return { status: 'found', entity };
  }

  private getSemanticRelationTakeCandidates(
    anchor: SceneObject,
    relation: ParserRelationType
  ): Entity[] {
    if (relation === 'near') return [];

    const scene = this.game.sceneManager.currentScene;
    if (!scene) return [];

    const textLayer = buildSceneTextLayerSnapshot(scene, this.game);
    const relationEntries = getSceneTextRelationDescendants(
      textLayer,
      anchor.name,
      relation as Exclude<ParserRelationType, 'near'>
    );

    return relationEntries
      .map((entry) => entry.object)
      .filter((candidate): candidate is Entity => candidate instanceof Entity)
      .filter((candidate) => !candidate.disabled)
      .filter(
        (candidate) =>
          candidate.components?.some((component: any) => component?.type === 'Item') ||
          candidate.isTakeable
      );
  }

  private getScopedTakeCandidates(
    anchor: SceneObject,
    relation: ParserRelationType
  ): { status: 'resolved'; candidates: Entity[]; hasStorage: boolean } | GameActionOutcome {
    const gameScoped = (this.game as any).getRelationScopedTakeCandidates;
    if (typeof gameScoped === 'function') {
      return gameScoped.call(this.game, anchor, relation);
    }

    if (relation === 'in') {
      const relationOutcome = this.game.describeSpatialRelation(anchor.name, 'in');
      if (relationOutcome.status === 'failed') {
        return relationOutcome;
      }
    }

    const semanticCandidates = this.getSemanticRelationTakeCandidates(anchor, relation);
    if (semanticCandidates.length) {
      return {
        status: 'resolved',
        candidates: semanticCandidates,
        hasStorage: true,
      };
    }

    return {
      status: 'resolved',
      candidates: [],
      hasStorage: false,
    };
  }

  private resolveTakeTarget(
    rawTarget: string | null,
    rawAnchor: string | null = null,
    relation: ParserRelationType | null = null
  ): GameActionOutcome {
    if (!rawTarget) {
      return {
        status: 'needs_clarification',
        code: 'missing_take_target',
        message: this.game.text('parser.take_prompt'),
        recoverable: true,
      };
    }

    if (rawAnchor && relation) {
      const targetScopes: Array<keyof ParserScope> =
        relation === 'in'
          ? ['held', 'visible', 'subscene']
          : ['visible', 'reachable', 'held', 'subscene'];
      const resolvedAnchor = this.resolveContainerAnchor(
        rawAnchor,
        targetScopes,
        'parser.take_which_target'
      );

      if (resolvedAnchor.status === 'escalate') {
        return { status: 'escalate', code: resolvedAnchor.code, recoverable: true };
      }
      if (resolvedAnchor.status === 'ambiguous') {
        return {
          status: 'needs_clarification',
          code: 'ambiguous_take_target_container',
          message: resolvedAnchor.message,
          data: {
            target: rawAnchor,
            options: resolvedAnchor.options,
            clarificationOptions: resolvedAnchor.clarificationOptions,
          },
          recoverable: true,
        };
      }
      if (resolvedAnchor.status === 'not_found') {
        return {
          status: 'failed',
          code: 'take_target_not_found',
          message: this.game.text('parser.take_target_not_found', { target: rawAnchor }),
          data: { target: rawAnchor, relation },
          recoverable: true,
        };
      }

      const scoped = this.getScopedTakeCandidates(resolvedAnchor.entity, relation);
      if (scoped.status !== 'resolved') {
        return scoped;
      }
      if (!scoped.hasStorage) {
        return {
          status: 'failed',
          code: 'take_target_not_found',
          message: this.game.text('parser.take_target_not_found', { target: rawAnchor }),
          data: { target: rawAnchor, relation, anchorId: resolvedAnchor.entity.name },
          recoverable: true,
        };
      }

      const scopedCandidates = scoped.candidates;
      const scopedTakeDiagnosticCandidates = this.filterNeverTakeCandidates(scopedCandidates);
      const scopedResolved = this.resolveEntityTargetInCandidates(
        rawTarget,
        this.filterCurrentlyTakeableCandidates(scopedTakeDiagnosticCandidates),
        'parser.take_which_one'
      );
      const broadScopedResolved =
        scopedResolved.status === 'not_found'
          ? this.resolveEntityTargetInCandidates(
              rawTarget,
              scopedTakeDiagnosticCandidates,
              'parser.take_which_one'
            )
          : null;
      if (scopedResolved.status === 'escalate') {
        return { status: 'escalate', code: scopedResolved.code, recoverable: true };
      }
      if (scopedResolved.status === 'ambiguous') {
        return {
          status: 'needs_clarification',
          code: 'ambiguous_take_target',
          message: scopedResolved.message,
          data: {
            target: rawTarget,
            anchor: rawAnchor,
            relation,
            options: scopedResolved.options,
            clarificationOptions: this.withClarificationScope(
              scopedResolved.clarificationOptions,
              'source'
            ),
          },
          recoverable: true,
        };
      }
      if (scopedResolved.status === 'found') {
        return this.executePlayerActionWithApproach(scopedResolved.entity, () =>
          this.game.takeEntity(scopedResolved.entity as Entity)
        );
      }
      if (scopedResolved.status === 'not_found') {
        if (broadScopedResolved?.status === 'ambiguous') {
          const failure = this.resolveFailedTakeDiagnostic(
            rawTarget,
            scopedTakeDiagnosticCandidates,
            true
          );
          if (failure) return failure;
        }
        if (broadScopedResolved?.status === 'found') {
          return this.resolveTakeFailureForKnownEntity(broadScopedResolved.entity as Entity, true);
        }
        if (broadScopedResolved?.status === 'escalate') {
          return {
            status: 'escalate',
            code: broadScopedResolved.code,
            recoverable: true,
          };
        }
      }

      return {
        status: 'failed',
        code: 'entity_not_found',
        message: this.game.text('parser.look_not_found', { target: rawTarget }),
        data: { target: rawTarget, anchor: rawAnchor, relation },
        recoverable: true,
      };
    }

    const takableCandidates = this.filterCurrentlyTakeableCandidates(
      this.getScopeCandidates(['takable'])
    );
    const takeDiagnosticCandidates = this.filterNeverTakeCandidates(
      this.getScopeCandidates(['visible'])
    );
    const resolved = this.resolveEntityTargetInCandidates(
      rawTarget,
      takableCandidates,
      'parser.take_which_one'
    );
    const broadResolved =
      resolved.status === 'not_found'
        ? this.resolveEntityTargetInCandidates(
            rawTarget,
            takeDiagnosticCandidates,
            'parser.take_which_one'
          )
        : null;

    if (resolved.status === 'escalate' || broadResolved?.status === 'escalate') {
      return {
        status: 'escalate',
        code:
          resolved.status === 'escalate'
            ? resolved.code
            : broadResolved?.status === 'escalate'
              ? broadResolved.code
              : 'take_target_missing_title',
        recoverable: true,
      };
    }
    if (resolved.status === 'not_found') {
      if (broadResolved?.status === 'ambiguous') {
        const failure = this.resolveFailedTakeDiagnostic(rawTarget, takeDiagnosticCandidates, true);
        if (failure) return failure;
      }
      if (broadResolved?.status === 'found') {
        return this.resolveTakeFailureForKnownEntity(broadResolved.entity as Entity, true);
      }
      const inactiveSwitchResolved = this.resolveInactiveSubsceneSwitchTarget(rawTarget);
      if (inactiveSwitchResolved.status === 'found') {
        return this.executePlayerActionWithApproach(inactiveSwitchResolved.entity, () =>
          this.game.takeEntity(inactiveSwitchResolved.entity as Entity)
        );
      }
      if (inactiveSwitchResolved.status === 'ambiguous') {
        return {
          status: 'needs_clarification',
          code: 'ambiguous_take_target',
          message: inactiveSwitchResolved.message,
          data: {
            target: rawTarget,
            options: inactiveSwitchResolved.options,
            clarificationOptions: this.withClarificationScope(
              inactiveSwitchResolved.clarificationOptions,
              'source'
            ),
          },
          recoverable: true,
        };
      }
      if (inactiveSwitchResolved.status === 'escalate') {
        return { status: 'escalate', code: inactiveSwitchResolved.code, recoverable: true };
      }
      const hiddenGatedResolved = this.resolveHiddenSwitchGatedTarget(rawTarget);
      if (hiddenGatedResolved.status === 'found') {
        return this.executePlayerActionWithApproach(hiddenGatedResolved.entity, () =>
          this.game.takeEntity(hiddenGatedResolved.entity as Entity)
        );
      }
      if (hiddenGatedResolved.status === 'ambiguous') {
        return {
          status: 'needs_clarification',
          code: 'ambiguous_take_target',
          message: hiddenGatedResolved.message,
          data: {
            target: rawTarget,
            options: hiddenGatedResolved.options,
            clarificationOptions: this.withClarificationScope(
              hiddenGatedResolved.clarificationOptions,
              'source'
            ),
          },
          recoverable: true,
        };
      }
      if (hiddenGatedResolved.status === 'escalate') {
        return { status: 'escalate', code: hiddenGatedResolved.code, recoverable: true };
      }
      return {
        status: 'failed',
        code: 'entity_not_found',
        message: this.game.text('parser.look_not_found', { target: rawTarget }),
        data: { target: rawTarget },
        recoverable: true,
      };
    }
    if (resolved.status === 'ambiguous') {
      return {
        status: 'needs_clarification',
        code: 'ambiguous_take_target',
        message: resolved.message,
        data: {
          target: rawTarget,
          options: resolved.options,
          clarificationOptions: this.withClarificationScope(
            resolved.clarificationOptions,
            'source'
          ),
        },
        recoverable: true,
      };
    }
    return this.executePlayerActionWithApproach(resolved.entity, () =>
      this.game.takeEntity(resolved.entity as Entity)
    );
  }

  private findResolutionMatchesInCandidates(
    rawTarget: string,
    candidates: SceneObject[]
  ): SceneObject[] {
    const normalizedTarget = String(rawTarget || '')
      .trim()
      .toUpperCase();
    if (!normalizedTarget) return [];

    const exactMatches = candidates.filter((sceneObject: SceneObject) =>
      this.getObjectLookupTokens(sceneObject).includes(normalizedTarget)
    );
    if (exactMatches.length) return exactMatches;

    return candidates.filter((sceneObject: SceneObject) => {
      const lookupTokens = this.getObjectLookupTokens(sceneObject);
      return lookupTokens.some((token) => token.includes(normalizedTarget));
    });
  }

  private resolveFailedTakeDiagnostic(
    rawTarget: string,
    candidates: SceneObject[],
    autoApproach: boolean = false
  ): GameActionOutcome | null {
    const matches = this.findResolutionMatchesInCandidates(rawTarget, candidates).filter(
      (candidate): candidate is Entity =>
        candidate instanceof Entity && !this.isEntityHeldForTake(candidate)
    );
    if (!matches.length) return null;

    const preferred = (this.choosePreferredObject(matches) || matches[0]) as Entity;
    return this.resolveTakeFailureForKnownEntity(preferred, autoApproach);
  }

  private resolveTakeFailureForKnownEntity(
    entity: Entity,
    autoApproach: boolean = false
  ): GameActionOutcome {
    const canTakeOutcome = (this.game as any).canTakeEntity?.(entity);
    if (canTakeOutcome) {
      if (!autoApproach) return canTakeOutcome;
      const player = this.game.sceneManager.currentScene?.player;
      if (!player) return canTakeOutcome;
      const approach = this.game.actorNavigation.planApproach(player, entity);
      if (approach.status !== 'route_available') return canTakeOutcome;
    }

    if (this.isEntityHeldForTake(entity)) {
      return {
        status: 'failed',
        code: 'item_already_held',
        message: this.game.text('parser.take_already_held', {
          item: this.getPlayerFacingObjectTitle(entity) || entity.name,
        }),
        data: { entityId: entity.name },
        recoverable: true,
      };
    }

    return this.executePlayerActionWithApproach(entity, () => this.game.takeEntity(entity));
  }

  private resolvePutSourceFailureForKnownEntity(entity: Entity): GameActionOutcome | null {
    const canPutSourceOutcome = (this.game as any).canPutSourceEntity?.(entity);
    if (canPutSourceOutcome) return canPutSourceOutcome;
    return null;
  }

  private resolveFailedPutSourceDiagnostic(
    rawTarget: string,
    candidates: SceneObject[]
  ): GameActionOutcome | null {
    const matches = this.findResolutionMatchesInCandidates(rawTarget, candidates).filter(
      (candidate): candidate is Entity => candidate instanceof Entity
    );
    if (!matches.length) return null;

    const preferred = (this.choosePreferredObject(matches) || matches[0]) as Entity;
    return this.resolvePutSourceFailureForKnownEntity(preferred);
  }

  private filterCurrentlyTakeableCandidates(candidates: SceneObject[]): Entity[] {
    return candidates.filter((candidate): candidate is Entity => {
      if (!(candidate instanceof Entity)) return false;
      if (this.isEntityHeldForTake(candidate)) return false;
      const canTakeOutcome = (this.game as any).canTakeEntity?.(candidate);
      return !canTakeOutcome;
    });
  }

  private filterNeverTakeCandidates(candidates: SceneObject[]): SceneObject[] {
    return candidates.filter((candidate) => {
      if (!(candidate instanceof Entity)) return true;
      return !this.isEntityHeldForTake(candidate);
    });
  }

  private isEntityHeldForTake(entity: Entity): boolean {
    const inventoryManagerCheck = (this.game as any).inventoryManager?.hasEntityIdInInventory;
    if (typeof inventoryManagerCheck === 'function') {
      return !!inventoryManagerCheck.call((this.game as any).inventoryManager, entity);
    }
    if (this.game.inventory.includes(entity)) return true;
    const entityName = String(entity?.name || '').trim();
    if (!entityName) return false;
    return this.game.inventory.some(
      (held: Entity) => String(held?.name || '').trim() === entityName
    );
  }

  private resolveGiveTarget(rawItem: string | null, rawTarget: string | null): GameActionOutcome {
    if (!rawItem || !rawTarget) {
      return {
        status: 'needs_clarification',
        code: 'missing_give_target',
        message: this.game.text('parser.give_prompt'),
        recoverable: true,
      };
    }

    const sourceCandidates = this.getScopeCandidates(['held', 'putSource']).filter(
      (candidate): candidate is Entity =>
        candidate instanceof Entity && !(candidate instanceof Actor)
    );
    const source = this.resolveEntityTargetInCandidates(
      rawItem,
      sourceCandidates,
      'parser.give_which_item'
    );
    if (source.status === 'escalate') {
      return { status: 'escalate', code: source.code, recoverable: true };
    }
    if (source.status === 'ambiguous') {
      return {
        status: 'needs_clarification',
        code: 'ambiguous_give_item',
        message: source.message,
        data: {
          item: rawItem,
          options: source.options,
          clarificationOptions: this.withClarificationScope(source.clarificationOptions, 'source'),
        },
        recoverable: true,
      };
    }
    if (source.status === 'not_found') {
      return {
        status: 'failed',
        code: 'give_item_not_found',
        message: this.game.text('parser.look_not_found', { target: rawItem }),
        data: { item: rawItem },
        recoverable: true,
      };
    }

    const targetCandidates = this.getScopeCandidates(['visible', 'reachable']).filter(
      (candidate): candidate is Actor => candidate instanceof Actor
    );
    const target = this.resolveEntityTargetInCandidates(
      rawTarget,
      targetCandidates,
      'parser.give_which_target'
    );
    if (target.status === 'escalate') {
      return { status: 'escalate', code: target.code, recoverable: true };
    }
    if (target.status === 'ambiguous') {
      return {
        status: 'needs_clarification',
        code: 'ambiguous_give_target',
        message: target.message,
        data: {
          target: rawTarget,
          options: target.options,
          clarificationOptions: this.withClarificationScope(target.clarificationOptions, 'target'),
        },
        recoverable: true,
      };
    }
    if (target.status === 'not_found') {
      return {
        status: 'failed',
        code: 'give_target_not_found',
        message: this.game.text('parser.give_target_not_found'),
        data: { target: rawTarget },
        recoverable: true,
      };
    }

    return this.game.giveEntityForActor(
      this.game.sceneManager.currentScene?.player || null,
      source.entity,
      target.entity
    );
  }

  private resolvePutTarget(
    rawItem: string | null,
    rawTarget: string | null,
    relation?: ParserRelationType | null
  ): GameActionOutcome {
    if (!rawItem) {
      return {
        status: 'needs_clarification',
        code: 'missing_put_item',
        message: this.game.text('parser.put_prompt'),
        recoverable: true,
      };
    }

    const normalizedItem = String(rawItem || '')
      .trim()
      .toUpperCase();
    const sourceScopes: Array<keyof ParserScope> = rawTarget ? ['held', 'putSource'] : ['held'];
    const sourceCandidates = this.getScopeCandidates(sourceScopes);
    if (rawTarget && normalizedItem) {
      let sourceMatches = sourceCandidates.filter((sceneObject: SceneObject) =>
        this.getObjectLookupTokens(sceneObject).includes(normalizedItem)
      );
      const preResolvedTarget = sourceMatches.length
        ? this.resolveContainerAnchor(
            rawTarget,
            relation === 'in'
              ? ['held', 'visible', 'subscene']
              : ['visible', 'reachable', 'held', 'subscene'],
            'parser.put_which_target',
            new Set(sourceMatches)
          )
        : null;
      if (sourceMatches.length > 1 && preResolvedTarget?.status === 'escalate') {
        return { status: 'escalate', code: preResolvedTarget.code, recoverable: true };
      }
      if (sourceMatches.length > 1 && preResolvedTarget?.status === 'ambiguous') {
        return {
          status: 'needs_clarification',
          code: 'ambiguous_put_target',
          message: preResolvedTarget.message,
          data: {
            target: rawTarget,
            options: preResolvedTarget.options,
            clarificationOptions: preResolvedTarget.clarificationOptions,
          },
          recoverable: true,
        };
      }
      if (sourceMatches.length > 1 && preResolvedTarget?.status === 'not_found') {
        return {
          status: 'failed',
          code: 'put_target_not_found',
          message: this.game.text('parser.look_not_found', { target: rawTarget }),
          data: { target: rawTarget },
          recoverable: true,
        };
      }
      if (
        preResolvedTarget?.status === 'found' &&
        relation &&
        typeof (this.game as any).hasPutStorageForRelation === 'function' &&
        !(this.game as any).hasPutStorageForRelation(preResolvedTarget.entity, relation)
      ) {
        return {
          status: 'failed',
          code: 'put_target_not_found',
          message: this.game.text('parser.put_no_place'),
          data: { target: rawTarget, relation, item: rawItem },
          recoverable: true,
        };
      }
      const viableSourceMatches =
        preResolvedTarget?.status === 'found'
          ? sourceMatches.filter(
              (sceneObject) =>
                !this.isPutSourceAlreadyInTarget(
                  sceneObject,
                  preResolvedTarget.entity,
                  relation || null
                )
            )
          : sourceMatches;
      if (viableSourceMatches.length && viableSourceMatches.length < sourceMatches.length) {
        const viableSet = new Set(viableSourceMatches);
        for (let index = sourceCandidates.length - 1; index >= 0; index -= 1) {
          const candidate = sourceCandidates[index];
          if (sourceMatches.includes(candidate) && !viableSet.has(candidate)) {
            sourceCandidates.splice(index, 1);
          }
        }
        sourceMatches = viableSourceMatches;
      }
      const hasHeldMatch = sourceMatches.some((sceneObject) =>
        this.game.inventory.includes(sceneObject as Entity)
      );
      const hasSceneMatch = sourceMatches.some(
        (sceneObject) => !this.game.inventory.includes(sceneObject as Entity)
      );
      if (sourceMatches.length > 1 && hasHeldMatch && hasSceneMatch) {
        if (!this.areResolutionOptionsDistinct(sourceMatches)) {
          const preferred =
            sourceMatches.find((sceneObject) =>
              this.game.inventory.includes(sceneObject as Entity)
            ) || this.choosePreferredObject(sourceMatches);
          if (preferred) sourceCandidates.splice(0, sourceCandidates.length, preferred);
        } else {
          const clarificationOptions = this.getResolutionClarificationOptions(
            sourceMatches,
            'source'
          );
          if (!clarificationOptions) {
            return {
              status: 'escalate',
              code: 'ambiguous_targets_missing_titles',
              recoverable: true,
            };
          }
          return {
            status: 'needs_clarification',
            code: 'ambiguous_put_item',
            message: this.game.text('parser.put_which_item', {
              options: this.getNumberedClarificationDisplay(clarificationOptions),
            }),
            data: {
              item: rawItem,
              options: clarificationOptions.map((option) => option.label),
              clarificationOptions,
            },
            recoverable: true,
          };
        }
      }
    }

    const heldResolved = this.resolveEntityTargetInCandidates(
      rawItem,
      sourceCandidates,
      'parser.put_which_item'
    );
    const broadResolved =
      rawTarget && heldResolved.status === 'not_found'
        ? this.resolveEntityTargetInCandidates(
            rawItem,
            this.getScopeCandidates(['held', 'visible']),
            'parser.put_which_item'
          )
        : null;

    if (heldResolved.status === 'escalate' || broadResolved?.status === 'escalate') {
      return {
        status: 'escalate',
        code:
          heldResolved.status === 'escalate'
            ? heldResolved.code
            : broadResolved?.status === 'escalate'
              ? broadResolved.code
              : 'put_item_missing_title',
        recoverable: true,
      };
    }
    if (heldResolved.status === 'ambiguous') {
      return {
        status: 'needs_clarification',
        code: 'ambiguous_put_item',
        message: heldResolved.message || this.game.text('parser.put_which_item', { options: '' }),
        data: {
          item: rawItem,
          options: heldResolved.options || [],
          clarificationOptions: this.withClarificationScope(
            heldResolved.clarificationOptions,
            'source'
          ),
        },
        recoverable: true,
      };
    }
    if (broadResolved?.status === 'ambiguous') {
      const failure = this.resolveFailedPutSourceDiagnostic(
        rawItem,
        this.getScopeCandidates(['visible'])
      );
      if (failure) return failure;
      return {
        status: 'failed',
        code: rawTarget ? 'entity_not_found' : 'put_item_not_held',
        message: rawTarget
          ? this.game.text('parser.look_not_found', { target: rawItem })
          : this.game.text('parser.put_item_not_held', { item: rawItem }),
        data: { item: rawItem },
        recoverable: true,
      };
    }
    if (heldResolved.status === 'not_found' && broadResolved?.status !== 'found') {
      return {
        status: 'failed',
        code: rawTarget ? 'entity_not_found' : 'put_item_not_held',
        message: rawTarget
          ? this.game.text('parser.look_not_found', { target: rawItem })
          : this.game.text('parser.put_item_not_held', { item: rawItem }),
        data: { item: rawItem },
        recoverable: true,
      };
    }

    const sourceEntity =
      heldResolved.status === 'found'
        ? (heldResolved.entity as Entity)
        : broadResolved?.status === 'found'
          ? (broadResolved.entity as Entity)
          : null;

    if (heldResolved.status !== 'found' && sourceEntity) {
      const sourceFailure = this.resolvePutSourceFailureForKnownEntity(sourceEntity);
      if (sourceFailure) return sourceFailure;
    }

    if (!sourceEntity) {
      return {
        status: 'failed',
        code: rawTarget ? 'entity_not_found' : 'put_item_not_held',
        message: rawTarget
          ? this.game.text('parser.look_not_found', { target: rawItem })
          : this.game.text('parser.put_item_not_held', { item: rawItem }),
        data: { item: rawItem },
        recoverable: true,
      };
    }

    if (!rawTarget) {
      return this.game.putEntity(sourceEntity, null, {
        relation: relation || null,
      });
    }

    const targetScopes: Array<keyof ParserScope> =
      relation === 'in'
        ? ['held', 'visible', 'subscene']
        : ['visible', 'reachable', 'held', 'subscene'];
    const resolvedTarget = this.resolveContainerAnchor(
      rawTarget,
      targetScopes,
      'parser.put_which_target',
      new Set([sourceEntity])
    );

    if (resolvedTarget.status === 'escalate') {
      return { status: 'escalate', code: resolvedTarget.code, recoverable: true };
    }
    if (resolvedTarget.status === 'ambiguous') {
      return {
        status: 'needs_clarification',
        code: 'ambiguous_put_target',
        message: resolvedTarget.message,
        data: {
          target: rawTarget,
          options: resolvedTarget.options,
          clarificationOptions: resolvedTarget.clarificationOptions,
        },
        recoverable: true,
      };
    }
    if (resolvedTarget.status === 'not_found') {
      return {
        status: 'failed',
        code: 'put_target_not_found',
        message: this.game.text('parser.look_not_found', { target: rawTarget }),
        data: { target: rawTarget },
        recoverable: true,
      };
    }

    return this.game.putEntity(sourceEntity, resolvedTarget.entity, {
      relation: relation || null,
    });
  }

  private isPutSourceAlreadyInTarget(
    source: SceneObject,
    target: SceneObject,
    relation: ParserRelationType | null
  ): boolean {
    if (!(source instanceof Entity)) return false;
    if (this.game.inventory.includes(source)) return false;

    const gameCheck = (this.game as any).isEntityInPutTarget;
    if (typeof gameCheck === 'function') {
      return !!gameCheck.call(this.game, source, target, relation);
    }

    const scene = this.game.sceneManager.currentScene;
    if (!scene) return false;
    const textLayer = buildSceneTextLayerSnapshot(scene, this.game);
    const relations: Array<Exclude<ParserRelationType, 'near'>> =
      relation === 'in' || relation === 'on' || relation === 'under' || relation === 'behind'
        ? [relation]
        : ['in', 'on', 'under', 'behind'];

    return relations.some((candidateRelation) =>
      getSceneTextRelationDescendants(textLayer, target.name, candidateRelation).some(
        (entry) => entry.object === source
      )
    );
  }

  private resolveOpenCloseTarget(
    intent: 'open' | 'close',
    rawTarget: string | null
  ): GameActionOutcome {
    if (!rawTarget) {
      return {
        status: 'needs_clarification',
        code: intent === 'open' ? 'missing_open_target' : 'missing_close_target',
        message: this.game.text(intent === 'open' ? 'parser.open_prompt' : 'parser.close_prompt'),
        recoverable: true,
      };
    }

    const clarificationKey = intent === 'open' ? 'parser.open_which_one' : 'parser.close_which_one';
    const resolved = this.resolveEntityTargetInCandidates(
      rawTarget,
      this.getScopeCandidates(['reachable', 'held']),
      clarificationKey
    );
    const broadResolved =
      resolved.status === 'not_found'
        ? this.resolveEntityTargetInCandidates(
            rawTarget,
            this.getScopeCandidates(['visible']),
            clarificationKey
          )
        : null;

    if (resolved.status === 'escalate' || broadResolved?.status === 'escalate') {
      return {
        status: 'escalate',
        code:
          resolved.status === 'escalate'
            ? resolved.code
            : broadResolved?.status === 'escalate'
              ? broadResolved.code
              : 'switch_target_resolution_failed',
        recoverable: true,
      };
    }

    if (resolved.status === 'ambiguous') {
      return {
        status: 'needs_clarification',
        code: intent === 'open' ? 'ambiguous_open_target' : 'ambiguous_close_target',
        message: resolved.message,
        data: {
          target: rawTarget,
          options: resolved.options,
          clarificationOptions: resolved.clarificationOptions,
        },
        recoverable: true,
      };
    }

    if (resolved.status === 'not_found') {
      if (broadResolved?.status === 'ambiguous') {
        return {
          status: 'needs_clarification',
          code: intent === 'open' ? 'ambiguous_open_target' : 'ambiguous_close_target',
          message: broadResolved.message,
          data: {
            target: rawTarget,
            options: broadResolved.options,
            clarificationOptions: broadResolved.clarificationOptions,
          },
          recoverable: true,
        };
      }
      if (broadResolved?.status === 'found') {
        return this.getOpenCloseOutcome(intent, broadResolved.entity);
      }
      const inactiveSwitchResolved = this.resolveInactiveSubsceneSwitchTarget(rawTarget);
      if (inactiveSwitchResolved.status === 'found') {
        return this.getOpenCloseOutcome(intent, inactiveSwitchResolved.entity);
      }
      if (inactiveSwitchResolved.status === 'ambiguous') {
        return {
          status: 'needs_clarification',
          code: intent === 'open' ? 'ambiguous_open_target' : 'ambiguous_close_target',
          message: inactiveSwitchResolved.message,
          data: {
            target: rawTarget,
            options: inactiveSwitchResolved.options,
            clarificationOptions: inactiveSwitchResolved.clarificationOptions,
          },
          recoverable: true,
        };
      }
      if (inactiveSwitchResolved.status === 'escalate') {
        return { status: 'escalate', code: inactiveSwitchResolved.code, recoverable: true };
      }
      const hiddenGatedResolved = this.resolveHiddenSwitchGatedTarget(rawTarget);
      if (hiddenGatedResolved.status === 'found') {
        return this.getOpenCloseOutcome(intent, hiddenGatedResolved.entity);
      }
      if (hiddenGatedResolved.status === 'ambiguous') {
        return {
          status: 'needs_clarification',
          code: intent === 'open' ? 'ambiguous_open_target' : 'ambiguous_close_target',
          message: hiddenGatedResolved.message,
          data: {
            target: rawTarget,
            options: hiddenGatedResolved.options,
            clarificationOptions: hiddenGatedResolved.clarificationOptions,
          },
          recoverable: true,
        };
      }
      if (hiddenGatedResolved.status === 'escalate') {
        return { status: 'escalate', code: hiddenGatedResolved.code, recoverable: true };
      }
      return {
        status: 'failed',
        code: 'entity_not_found',
        message: this.game.text('parser.look_not_found', { target: rawTarget }),
        data: { target: rawTarget },
        recoverable: true,
      };
    }

    return this.getOpenCloseOutcome(intent, resolved.entity);
  }

  private getOpenCloseOutcome(intent: 'open' | 'close', entity: SceneObject): GameActionOutcome {
    if (!entity.components?.some((component: any) => component?.type === 'Switch')) {
      if (intent === 'open') {
        return this.executePlayerActionWithApproach(entity, () =>
          this.game.openEntity(entity as any)
        );
      }
      return {
        status: 'escalate',
        code: 'target_is_not_switch',
        recoverable: true,
      };
    }
    return this.executePlayerActionWithApproach(entity, () =>
      intent === 'open' ? this.game.openEntity(entity as any) : this.game.closeEntity(entity as any)
    );
  }

  private resolveGoToTarget(rawTarget: string | null): GameActionOutcome {
    if (this.game.sceneManager?.currentScene?.activeSubscene) {
      return {
        status: 'failed',
        code: 'movement_blocked_by_active_subscene',
        message: this.game.text('engine.close_subscene_before_moving'),
        recoverable: true,
      };
    }
    if (!rawTarget) {
      return {
        status: 'needs_clarification',
        code: 'missing_destination',
        message: this.game.text('parser.go_to_prompt'),
        recoverable: true,
      };
    }

    const startsWithThrough = /^\s*through\s+/i.test(rawTarget);
    const cleanTarget = rawTarget.replace(/^\s*through\s+/i, '');

    const normalizedDestination = cleanTarget.trim().toUpperCase();
    const destinationExit = this.getScopeCandidates(['visible']).find((candidate) => {
      const exit = candidate.components?.find((component: any) => component?.type === 'Exit') as
        | { targetSceneId?: string }
        | undefined;
      if (!exit) return false;
      const targetSceneId = String(exit.targetSceneId || '')
        .trim()
        .replace(/\.json$/i, '');
      const scene = this.game.sceneManager.scenes.get(targetSceneId);
      const descriptor = this.game.sceneManager.sceneRegistry.get(targetSceneId);
      const title =
        (scene && this.game.textAssets.getResolvedSceneField(scene, 'title')) || descriptor?.title;
      return (
        targetSceneId.toUpperCase() === normalizedDestination ||
        String(title || '')
          .trim()
          .toUpperCase() === normalizedDestination
      );
    });
    if (destinationExit)
      return this.game.goToEntity(destinationExit, { traverseExit: startsWithThrough });

    const sceneOutcome = this.game.goToSceneTarget(cleanTarget);
    if (sceneOutcome.status === 'ok') {
      return sceneOutcome;
    }

    const resolved = this.resolveEntityTargetInCandidates(
      cleanTarget,
      this.getScopeCandidates(['visible']),
      'parser.go_to_which_one'
    );
    if (resolved.status === 'escalate') {
      return { status: 'escalate', code: resolved.code, recoverable: true };
    }
    if (resolved.status === 'ambiguous') {
      return {
        status: 'needs_clarification',
        code: 'ambiguous_destination',
        message: resolved.message,
        data: {
          target: cleanTarget,
          options: resolved.options,
          clarificationOptions: resolved.clarificationOptions,
        },
        recoverable: true,
      };
    }
    if (resolved.status === 'found') {
      return this.game.goToEntity(resolved.entity as any, { traverseExit: startsWithThrough });
    }
    return {
      status: 'failed',
      code: 'destination_not_found',
      message: this.game.text('parser.go_to_not_found', { target: cleanTarget }),
      data: { target: cleanTarget },
      recoverable: true,
    };
  }

  private resolveQuitTarget(rawTarget: string | null): GameActionOutcome {
    const exits = this.getScopeCandidates(['visible']).filter((candidate) =>
      candidate.components?.some((component: any) => component?.type === 'Exit')
    );
    if (!rawTarget) {
      if (exits.length === 1) return this.game.goToEntity(exits[0], { traverseExit: true });
      return exits.length > 1
        ? {
            status: 'needs_clarification',
            code: 'ambiguous_destination',
            message: this.game.text('parser.go_to_prompt'),
            data: { options: exits.map((exit) => exit.name) },
            recoverable: true,
          }
        : {
            status: 'failed',
            code: 'quit_not_applicable',
            recoverable: true,
          };
    }
    const resolved = this.resolveEntityTargetInCandidates(
      rawTarget.replace(/^THROUGH\s+/i, ''),
      exits,
      'parser.go_to_which_one'
    );
    if (resolved.status === 'found')
      return this.game.goToEntity(resolved.entity, { traverseExit: true });
    if (resolved.status === 'ambiguous') {
      return {
        status: 'needs_clarification',
        code: 'ambiguous_destination',
        message: resolved.message,
        data: { options: resolved.options, clarificationOptions: resolved.clarificationOptions },
        recoverable: true,
      };
    }
    return { status: 'failed', code: 'destination_not_found', recoverable: true };
  }

  private executeResolveArgumentEntity(
    action: Extract<ParserToolAction, { type: 'resolveArgumentEntity' }>,
    planState: ParserPlanState
  ): GameActionOutcome {
    const resolution = this.resolveEntityTargetWithMessages(
      action.query,
      this.getScopeCandidates(action.scopes).filter(
        (candidate): candidate is Entity => candidate instanceof Entity
      ),
      action.messages
    );

    if (resolution.status === 'escalate') {
      return { status: 'escalate', code: resolution.code, recoverable: true };
    }

    if (resolution.status === 'not_found') {
      const distanceFailure = action.query
        ? this.resolveDistanceFailureForArgument(action.query, action.scopes)
        : null;
      if (distanceFailure) {
        return distanceFailure;
      }
      return {
        status: action.query ? 'failed' : 'needs_clarification',
        code: action.query ? 'custom_command_target_not_found' : 'custom_command_missing_argument',
        message: resolution.message,
        data: {
          pendingArg: action.arg,
          commandId: action.commandId,
        },
        recoverable: true,
      };
    }

    if (resolution.status === 'needs_clarification') {
      return {
        status: 'needs_clarification',
        code: 'custom_command_ambiguous_argument',
        message: resolution.message,
        data: {
          pendingArg: action.arg,
          commandId: action.commandId,
          options: resolution.options,
          clarificationOptions: resolution.clarificationOptions,
        },
        recoverable: true,
      };
    }

    if (!this.isEntityValidForCommandArgument(resolution.entity as Entity, action.validation)) {
      return {
        status: 'failed',
        code: 'custom_command_invalid_argument',
        message: action.messages?.noEffect || this.game.text('parser.command_no_effect'),
        data: {
          arg: action.arg,
          commandId: action.commandId,
          entityId: resolution.entity.name,
        },
        recoverable: true,
      };
    }

    planState[action.saveAs] = resolution.entity;
    return {
      status: 'ok',
      code: 'argument_resolved',
      data: {
        arg: action.arg,
        saveAs: action.saveAs,
        entityId: resolution.entity.name,
      },
    };
  }

  private resolveDistanceFailureForArgument(
    rawTarget: string,
    scopes: Array<keyof ParserScope>
  ): GameActionOutcome | null {
    if (!scopes.includes('reachable') || scopes.includes('visible')) {
      return null;
    }

    const broadResolved = this.resolveEntityTargetInCandidates(
      rawTarget,
      this.getScopeCandidates(['held', 'visible']),
      'parser.look_which_one'
    );
    if (broadResolved.status !== 'found') {
      return null;
    }

    if (this.game.inventory.includes(broadResolved.entity)) {
      return null;
    }

    const scene = this.game.sceneManager.currentScene;
    const player = scene?.player;
    if (!scene || !player) {
      return null;
    }

    const distanceError = ComponentSystem.getInteractionDistanceError(
      broadResolved.entity as any,
      player
    );

    if (!distanceError) {
      return null;
    }

    return {
      status: 'failed',
      code: 'custom_command_target_too_far',
      message: distanceError,
      data: {
        target: rawTarget,
        entityId: broadResolved.entity.name,
      },
      recoverable: true,
    };
  }

  private executeEnsureHeldEntity(
    action: Extract<ParserToolAction, { type: 'ensureHeldEntity' }>,
    planState: ParserPlanState
  ): GameActionOutcome {
    const entity = planState[action.ref];
    if (!(entity instanceof Entity)) {
      return {
        status: 'escalate',
        code: 'missing_plan_entity_ref',
        data: { ref: action.ref },
        recoverable: true,
      };
    }

    if (this.game.inventory.includes(entity)) {
      return {
        status: 'ok',
        code: 'entity_already_held',
        data: { ref: action.ref, entityId: entity.name },
      };
    }

    const outcome = this.game.takeEntity(entity);
    if (outcome.status === 'failed' && action.noEffectMessage) {
      return {
        ...outcome,
        message: action.noEffectMessage,
      };
    }
    return outcome;
  }

  private executeRemoveInventoryEntity(
    action: Extract<ParserToolAction, { type: 'removeInventoryEntity' }>,
    planState: ParserPlanState
  ): GameActionOutcome {
    const entity = planState[action.ref];
    if (!(entity instanceof Entity)) {
      return {
        status: 'escalate',
        code: 'missing_plan_entity_ref',
        data: { ref: action.ref },
        recoverable: true,
      };
    }
    return this.game.removeInventoryEntity(entity);
  }

  private executeActorUseOn(
    action: Extract<ParserToolAction, { type: 'actorUseOn' }>,
    planState: ParserPlanState
  ): GameActionOutcome {
    const item = planState[action.itemRef];
    const target = planState[action.targetRef];
    const player = this.game.sceneManager.currentScene?.player;
    if (!(item instanceof Entity) || !(target instanceof Entity) || !(player instanceof Actor)) {
      return {
        status: 'failed',
        code: 'missing_plan_entity_ref',
        message: this.game.text('parser.command_no_effect'),
        recoverable: true,
      };
    }

    const outcome = this.game.actorCommands.useItemOn(player, item.name, target.name);
    if (outcome.status === 'ok') return outcome;

    const message = action.noEffectMessage
      ? action.noEffectMessage
          .replace(
            /\{item\}/g,
            this.game.textAssets.getResolvedObjectField(item, 'title') || item.name
          )
          .replace(
            /\{target\}/g,
            this.game.textAssets.getResolvedObjectField(target, 'title') || target.name
          )
      : outcome.message;
    return {
      status: 'ok',
      code: 'custom_message',
      message,
    };
  }

  private executeRequireEntityAvailable(
    action: Extract<ParserToolAction, { type: 'requireEntityAvailable' }>,
    planState: ParserPlanState
  ): GameActionOutcome {
    const entity = this.getScopeCandidates(action.scopes).find(
      (candidate) => candidate.name === action.entityId
    );
    if (!entity) {
      return {
        status: 'failed',
        code: 'custom_command_required_entity_missing',
        message:
          action.missingMessage ||
          this.game.text('parser.look_not_found', { target: action.entityId }),
        data: {
          commandId: action.commandId,
          entityId: action.entityId,
          scopes: action.scopes,
        },
        recoverable: true,
      };
    }

    if (action.saveAs) {
      planState[action.saveAs] = entity;
    }

    return {
      status: 'ok',
      code: 'required_entity_available',
      data: {
        commandId: action.commandId,
        entityId: entity.name,
        scopes: action.scopes,
      },
    };
  }

  private executeRequireAnyEntityAvailable(
    action: Extract<ParserToolAction, { type: 'requireAnyEntityAvailable' }>,
    planState: ParserPlanState
  ): GameActionOutcome {
    for (const option of action.options) {
      const entity = this.getScopeCandidates(option.scopes).find(
        (candidate) => candidate.name === option.entityId
      );
      if (!entity) continue;

      if (action.saveAs) {
        planState[action.saveAs] = option.saveAsValue || entity;
      }

      return {
        status: 'ok',
        code: 'required_entity_available',
        data: {
          commandId: action.commandId,
          entityId: entity.name,
          scopes: option.scopes,
          matchedValue: option.saveAsValue,
        },
      };
    }

    return {
      status: 'failed',
      code: 'custom_command_required_entity_missing',
      message: action.missingMessage || this.game.text('parser.command_no_effect'),
      data: {
        commandId: action.commandId,
        options: action.options.map((option) => ({
          entityId: option.entityId,
          scopes: option.scopes,
        })),
      },
      recoverable: true,
    };
  }

  private executeSetEntityState(
    action: Extract<ParserToolAction, { type: 'setEntityState' }>
  ): GameActionOutcome {
    const scene = this.game.sceneManager.currentScene;
    const entity = scene?.getObjectByName(action.entityId);
    if (!entity) {
      return {
        status: 'failed',
        code: 'state_target_not_found',
        message:
          action.missingMessage ||
          this.game.text('parser.look_not_found', { target: action.entityId }),
        data: { entityId: action.entityId, stateId: action.stateId },
        recoverable: true,
      };
    }

    const component = ComponentSystem.getStateComponent(entity, action.stateId);
    if (!component || !ComponentSystem.isStateValueOfType(action.value, component.valueType)) {
      return {
        status: 'failed',
        code: 'state_not_set',
        message: action.missingMessage || this.game.text('parser.command_no_effect'),
        data: {
          entityId: action.entityId,
          stateId: action.stateId,
          expectedType: component?.valueType,
        },
        recoverable: true,
      };
    }

    const result = StateEventSystem.setState(
      this.game,
      entity,
      action.stateId,
      action.value,
      action.source || 'parser'
    );
    if (!result.ok) {
      return {
        status: 'failed',
        code: 'state_not_set',
        message: action.missingMessage || this.game.text('parser.command_no_effect'),
        data: { entityId: action.entityId, stateId: action.stateId },
        recoverable: true,
      };
    }

    return {
      status: 'ok',
      code: 'entity_state_set',
      data: {
        entityId: action.entityId,
        stateId: action.stateId,
        value: action.value,
        changed: result.changed,
        dispatchedScripts: result.dispatchedScripts,
      },
      effects: ['entity_state_changed'],
    };
  }

  private executeSetGroupDisabled(
    action: Extract<ParserToolAction, { type: 'setGroupDisabled' }>
  ): GameActionOutcome {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) {
      return {
        status: 'failed',
        code: 'no_current_scene',
        recoverable: false,
      };
    }

    const normalizedGroupId = this.normalizeGroupId(action.groupId);
    const targets = this.setSceneGroupDisabled(normalizedGroupId, action.disabled);

    return {
      status: 'ok',
      code: action.disabled ? 'group_disabled' : 'group_enabled',
      data: {
        groupId: normalizedGroupId,
        disabled: action.disabled,
        count: targets.length,
        entityIds: targets.map((target: SceneObject) => target.name),
      },
      effects: ['group_disabled_changed'],
    };
  }

  private setSceneGroupDisabled(groupId: string, disabled: boolean): SceneObject[] {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return [];

    const normalizedGroupId = this.normalizeGroupId(groupId);
    const targets = scene
      .getAllSceneObjects()
      .filter((candidate: SceneObject) => this.objectHasGroupId(candidate, normalizedGroupId));

    targets.forEach((target: SceneObject) => {
      target.disabled = disabled;
    });

    return targets;
  }

  private executeRunScript(
    action: Extract<ParserToolAction, { type: 'runScript' }>
  ): GameActionOutcome {
    if (!ScriptRegistry.has(action.scriptId)) {
      return {
        status: 'failed',
        code: 'script_not_found',
        data: { scriptId: action.scriptId },
        recoverable: true,
      };
    }

    if (action.restart && ScriptRegistry.isRunning(action.scriptId)) {
      ScriptRegistry.stop(action.scriptId);
    }

    if (!ScriptRegistry.isRunning(action.scriptId)) {
      ScriptRegistry.execute(action.scriptId, { game: this.game });
    }

    return {
      status: 'ok',
      code: 'script_started',
      data: { scriptId: action.scriptId, restart: !!action.restart },
      effects: ['script_started'],
    };
  }

  private executeStopScript(
    action: Extract<ParserToolAction, { type: 'stopScript' }>
  ): GameActionOutcome {
    const wasRunning = ScriptRegistry.isRunning(action.scriptId);
    ScriptRegistry.stop(action.scriptId);
    return {
      status: 'ok',
      code: 'script_stopped',
      data: { scriptId: action.scriptId, wasRunning },
      effects: ['script_stopped'],
    };
  }

  private buildCustomCommandEnvelope(
    input: string,
    command: ParserCommandSpec,
    argumentValues: Record<string, string | null>
  ): ParserCascadeEnvelope {
    const argumentRefs: Record<string, string> = {};
    const resolutionActions = command.plan.flatMap((step): ParserToolAction[] => {
      if (step.type !== 'resolveArgumentEntity') return [];
      const argSpec = command.arguments.find((arg) => arg.name === step.arg);
      if (!argSpec) return [];
      argumentRefs[step.arg] = step.saveAs;
      return [
        {
          type: 'resolveArgumentEntity',
          commandId: command.id,
          arg: step.arg,
          query: argumentValues[step.arg] || null,
          scopes: argSpec.scopes,
          saveAs: step.saveAs,
          validation: argSpec.validation,
          messages: argSpec.messages,
        },
      ];
    });

    return {
      stage: 'regex-v1',
      output: {
        kind: 'plan',
        actions: [
          ...resolutionActions,
          {
            type: 'runCustomCommand',
            commandId: command.id,
            arguments: argumentValues,
            argumentRefs,
          },
        ],
      },
      debug: {
        rawInput: input,
        normalizedInput: input.trim().toUpperCase(),
        verb: command.id.toUpperCase(),
        noun: Object.values(argumentValues)
          .filter((value): value is string => !!value)
          .join(' '),
      },
    };
  }

  private expandCustomCommandActions(actions: ParserToolAction[]): ParserToolAction[] {
    return actions;
  }

  private parseClarificationOptionsFromData(
    data: Record<string, unknown>
  ): ParserClarificationOption[] | undefined {
    const rawOptions = data.clarificationOptions;
    if (!Array.isArray(rawOptions)) return undefined;
    const options = rawOptions
      .map((entry, index) => {
        if (!entry || typeof entry !== 'object') return null;
        const option = entry as Partial<ParserClarificationOption>;
        if (typeof option.label !== 'string' || !option.label.trim()) return null;
        if (typeof option.entityId !== 'string') return null;
        const scope = option.scope === 'source' ? 'source' : 'target';
        return {
          index: typeof option.index === 'number' ? option.index : index + 1,
          label: option.label,
          entityId: option.entityId,
          scope,
        } satisfies ParserClarificationOption;
      })
      .filter((option): option is ParserClarificationOption => !!option);
    return options.length ? options : undefined;
  }

  private isMultiSourceClarification(code: string): boolean {
    return (
      code === 'ambiguous_look_target' ||
      code === 'ambiguous_examine_target' ||
      code === 'ambiguous_take_target' ||
      code === 'ambiguous_put_item'
    );
  }

  private formatPeekObject(obj: any): string {
    const truncateStrings = (input: any): any => {
      if (typeof input === 'string') {
        return input.length > 20 ? input.substring(0, 20) + '...' : input;
      }
      if (Array.isArray(input)) {
        return input.map(truncateStrings);
      }
      if (input !== null && typeof input === 'object') {
        const result: any = {};
        for (const key of Object.keys(input)) {
          result[key] = truncateStrings(input[key]);
        }
        return result;
      }
      return input;
    };

    const data = truncateStrings(obj);
    if (data === null || typeof data !== 'object') return String(data);

    if (Array.isArray(data)) {
      if (data.length === 0) return '[]';
      const items = data.map((item) => JSON.stringify(item));
      return `[\n  ${items.join(',\n  ')}\n]`;
    }

    const entries = Object.entries(data);
    if (entries.length === 0) return '{}';

    const lines = entries.map(([key, value]) => `  "${key}": ${JSON.stringify(value)}`);
    return `{\n${lines.join(',\n')}\n}`;
  }

  private buildResponse(
    resultJson: string,
    envelopeJson: string,
    contextJson: string,
    scopeJson: string,
    timings: ParserTimingEntry[] = []
  ): ParserResponse {
    const result = JSON.parse(resultJson) as ParserResult;
    const nlpDebug = this.nlpCascade.getLastDebugInfo();
    const llmDebug = this.llmCascade.getLastDebugInfo();
    const coreDecision = result.coreDecision;

    const formatSection = (title: string, json: string | object) => {
      const obj = typeof json === 'string' ? JSON.parse(json) : json;
      return `--- ${title.toUpperCase()} ---\n${this.formatPeekObject(obj)}`;
    };

    const formatFullSection = (title: string, value: unknown) => {
      const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      return `--- ${title.toUpperCase()} ---\n${body}`;
    };

    const parserNoteEffects = result.outcomes
      .flatMap((outcome) => outcome.effects || [])
      .filter((effect) => this.isParserNoteEffect(effect));
    const parserNoteMutations = parserNoteEffects
      .map((effect) => this.parseParserNoteEffect(effect))
      .filter((entry): entry is ParserNoteDebugEntry => !!entry);
    const parserNoteContextEntries = this.collectParserNoteContextEntries(contextJson);

    const formatParserNoteSection = (title: string, entries: ParserNoteDebugEntry[]) =>
      formatFullSection(title, entries);

    const peekMessages = this.game.console?.parserPeekEnabled
      ? (() => {
          let rawInput = '';
          let stage = '';
          try {
            const envelope = JSON.parse(envelopeJson);
            rawInput = envelope.debug?.rawInput || '';
            stage = envelope.stage || '';
          } catch (e) {
            // ignore
          }

          let sceneId = '';
          let inventoryItems: string[] = [];
          try {
            const context = JSON.parse(contextJson);
            sceneId = context.scene?.id || '';
            if (Array.isArray(context.inventory)) {
              inventoryItems = context.inventory.map((i: any) => i.title || i.id);
            }
            if (!rawInput && context.rawInput) {
              rawInput = context.rawInput;
            }
          } catch (e) {
            // ignore
          }

          let scopeItems: string[] = [];
          let heldItems: string[] = [];
          try {
            const scope = JSON.parse(scopeJson);
            if (Array.isArray(scope.visible)) {
              scopeItems = scope.visible;
            }
            if (Array.isArray(scope.held)) {
              heldItems = scope.held;
            }
          } catch (e) {
            // ignore
          }

          const peekLines: string[] = ['--- PARSER PEEK ---'];
          peekLines.push(`Input: "${rawInput}"`);

          const activeStr = `Active: ${sceneId || 'none'}`;
          const invStr = inventoryItems.length
            ? ` | Inventory: [${inventoryItems.join(', ')}]`
            : '';
          peekLines.push(`${activeStr}${invStr}`);

          const scopeStr = scopeItems.length ? `Scope: [${scopeItems.join(', ')}]` : 'Scope: []';
          const heldStr = heldItems.length ? ` | Held: [${heldItems.join(', ')}]` : '';
          peekLines.push(`${scopeStr}${heldStr}`);

          let stageStr = `Stage: ${stage || 'unknown'}`;
          if (nlpDebug && nlpDebug.matched) {
            stageStr += ` (NLP Match: ${nlpDebug.rawIntent} | score: ${nlpDebug.score.toFixed(2)})`;
          }
          peekLines.push(stageStr);

          const visibleTimings = timings.filter((entry) => entry.ms >= 0.05);
          if (visibleTimings.length) {
            const timingStr = visibleTimings
              .map((entry) => `${entry.label} ${entry.ms.toFixed(1)}ms`)
              .join(' | ');
            peekLines.push(`Timing: ${timingStr}`);
          }

          if (parserNoteMutations.length > 0) {
            for (const mut of parserNoteMutations) {
              peekLines.push(
                `Parser Note: ${mut.operation} ${mut.targetType} ${mut.id} -> "${mut.note}"`
              );
            }
          }

          try {
            const res = JSON.parse(resultJson) as ParserResult;
            if (res.type === 'handoff') {
              peekLines.push(`Result: Handoff -> ${res.reason || 'unhandled'}`);
            } else {
              const outcomesStr = Array.isArray(res.outcomes)
                ? res.outcomes
                    .map((o: any) => {
                      const parts: string[] = [o.code || o.status];
                      if (o.data) {
                        const dataKeys = Object.keys(o.data);
                        if (dataKeys.length > 0) {
                          parts.push(JSON.stringify(o.data));
                        }
                      }
                      return parts.join(' ');
                    })
                    .join(', ')
                : '';
              peekLines.push(
                `Result: ${res.handled ? 'Success' : 'Unhandled'} -> ${outcomesStr || 'no outcomes'}`
              );
            }
          } catch (e) {
            peekLines.push(`Result: error parsing result`);
          }

          if (llmDebug) {
            const durationSec =
              llmDebug.durationMs !== undefined ? (llmDebug.durationMs / 1000).toFixed(2) : '?';
            const cacheCreationStr = llmDebug.cacheCreationInputTokens
              ? `, ${llmDebug.cacheCreationInputTokens} created`
              : '';
            peekLines.push(
              `[${llmDebug.model || 'unknown'} (${llmDebug.provider || 'unknown'}) | ${durationSec}s | Tokens: ${llmDebug.inputTokens ?? '?'} in, ${llmDebug.tokensGenerated ?? '?'} out (Cache: ${llmDebug.cacheReadInputTokens ? llmDebug.cacheReadInputTokens + ' read' : '0 read'}${cacheCreationStr})]`
            );
          }

          return [peekLines.join('\n')];
        })()
      : undefined;

    const peekLlmMessages =
      this.game.console?.parserPeekLlmEnabled && llmDebug
        ? [
            formatFullSection('llm prompt', llmDebug.prompt || null),
            formatFullSection('llm response', {
              rawResponse: llmDebug.rawResponse || '',
              extractedJson: llmDebug.extractedJson,
              acceptedActions: llmDebug.acceptedActions,
              filteredActions: llmDebug.filteredActions,
              parserNoteMutations,
              error: llmDebug.error,
              reason: llmDebug.reason,
              provider: llmDebug.provider,
              model: llmDebug.model,
              durationMs: llmDebug.durationMs,
              inputTokens: llmDebug.inputTokens,
              tokensGenerated: llmDebug.tokensGenerated,
              cacheCreationInputTokens: llmDebug.cacheCreationInputTokens,
              cacheReadInputTokens: llmDebug.cacheReadInputTokens,
              staticPrompt: llmDebug.prompt?.staticPrompt,
            }),
          ]
        : undefined;

    const peekPnMessages = this.game.console?.parserPeekPnEnabled
      ? [
          ...(parserNoteContextEntries.length
            ? [formatParserNoteSection('parser notes context', parserNoteContextEntries)]
            : []),
          ...(parserNoteMutations.length
            ? [formatParserNoteSection('parser notes mutations', parserNoteMutations)]
            : []),
        ]
      : undefined;

    const debugMessages =
      peekMessages || peekLlmMessages || peekPnMessages
        ? [...(peekMessages || []), ...(peekLlmMessages || []), ...(peekPnMessages || [])]
        : undefined;

    if (result.type === 'handoff') {
      return {
        playerMessage: this.game.text('parser.parse_unknown'),
        nextPendingState: null,
        debugMessages: debugMessages || [
          formatSection('handoff context', contextJson),
          formatSection('handoff scope', scopeJson),
          formatSection('handoff envelope', envelopeJson),
          ...(coreDecision ? [formatSection('handoff core', coreDecision)] : []),
          formatSection('handoff result', resultJson),
        ],
      };
    }

    const clarification = result.outcomes.find(
      (outcome) => outcome.status === 'needs_clarification'
    );
    if (clarification) {
      const clarificationData = (clarification.data || {}) as Record<string, unknown>;
      const pendingEnvelopeJson =
        typeof clarificationData.pendingEnvelopeJson === 'string'
          ? clarificationData.pendingEnvelopeJson
          : envelopeJson;
      const pendingArg =
        typeof clarificationData.pendingArg === 'string' ? clarificationData.pendingArg : undefined;
      const commandId =
        typeof clarificationData.commandId === 'string' ? clarificationData.commandId : undefined;
      const clarificationOptions = this.parseClarificationOptionsFromData(clarificationData);
      const clarificationAllowsMultiple = this.isMultiSourceClarification(clarification.code);
      const nextPendingState =
        pendingArg && commandId
          ? {
              intent: 'custom' as const,
              question: clarification.message || this.game.text('parser.parse_unknown'),
              originalInput: this.extractRawInput(pendingEnvelopeJson),
              pendingEnvelopeJson,
              pendingArg,
              commandId,
              clarificationOptions,
              clarificationAllowsMultiple,
            }
          : {
              intent: this.extractPendingIntent(pendingEnvelopeJson),
              question: clarification.message || this.game.text('parser.parse_unknown'),
              originalInput: this.extractRawInput(pendingEnvelopeJson),
              pendingEnvelopeJson,
              clarificationOptions,
              clarificationAllowsMultiple,
            };
      return {
        playerMessage: clarification.message || this.game.text('parser.parse_unknown'),
        nextPendingState,
        debugMessages,
      };
    }

    const escalation = result.outcomes.find((outcome) => outcome.status === 'escalate');
    if (escalation) {
      return {
        playerMessage: escalation.message || this.game.text('parser.parse_unknown'),
        nextPendingState: null,
        debugMessages: debugMessages || [
          `[Parser handoff] context=${contextJson}`,
          `[Parser handoff] scope=${scopeJson}`,
          `[Parser handoff] envelope=${envelopeJson}`,
          ...(coreDecision ? [`[Parser handoff] core=${JSON.stringify(coreDecision)}`] : []),
          `[Parser handoff] result=${resultJson}`,
        ],
      };
    }

    const outcomeMessages = result.outcomes
      .map((outcome) => outcome.message)
      .filter((message): message is string => !!message);
    const firstFailure = result.outcomes.find((outcome) => outcome.status === 'failed');
    if (firstFailure) {
      const failureMessage = firstFailure.message || this.game.text('parser.parse_unknown');
      const playerMessages = outcomeMessages.length ? outcomeMessages : [failureMessage];
      return {
        playerMessage: playerMessages.length === 1 ? playerMessages[0] : undefined,
        playerMessages: playerMessages.length > 1 ? playerMessages : undefined,
        nextPendingState: null,
        debugMessages,
      };
    }

    return {
      playerMessage: outcomeMessages.length === 1 ? outcomeMessages[0] : undefined,
      playerMessages: outcomeMessages.length > 1 ? outcomeMessages : undefined,
      nextPendingState: null,
      debugMessages,
    };
  }

  private isParserNoteEffect(effect: string): boolean {
    return !!this.parseParserNoteEffect(effect);
  }

  private parseParserNoteEffect(effect: string): ParserNoteDebugEntry | null {
    try {
      const parsed = JSON.parse(effect) as Partial<ParserNoteDebugEntry>;
      if (
        (parsed.operation === 'created' ||
          parsed.operation === 'updated' ||
          parsed.operation === 'cleared' ||
          parsed.operation === 'needsCheck') &&
        (parsed.targetType === 'scene' || parsed.targetType === 'entity') &&
        typeof parsed.id === 'string' &&
        typeof parsed.note === 'string'
      ) {
        return {
          operation: parsed.operation,
          targetType: parsed.targetType,
          id: parsed.id,
          note: parsed.note,
          ...(parsed.needsCheck ? { needsCheck: true } : {}),
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  private collectParserNoteContextEntries(contextJson: string): ParserNoteDebugEntry[] {
    const context = this.safeParseJson(contextJson) as any;
    const entries: ParserNoteDebugEntry[] = [];

    const addEntry = (
      targetType: ParserNoteDebugEntry['targetType'],
      id: unknown,
      note: unknown,
      needsCheck: unknown
    ) => {
      if (typeof id !== 'string' || typeof note !== 'string' || !note.trim()) return;
      entries.push({
        operation: 'context',
        targetType,
        id,
        note,
        ...(needsCheck === true ? { needsCheck: true } : {}),
      });
    };

    addEntry(
      'scene',
      context?.scene?.id,
      context?.scene?.parserNote,
      context?.scene?.parserNoteNeedsCheck
    );
    for (const entity of context?.entities || []) {
      addEntry('entity', entity?.id, entity?.parserNote, entity?.parserNoteNeedsCheck);
    }
    for (const entity of context?.knownEntities || []) {
      addEntry('entity', entity?.id, entity?.parserNote, entity?.parserNoteNeedsCheck);
    }
    for (const entity of context?.inventory || []) {
      addEntry('inventory', entity?.id, entity?.parserNote, entity?.parserNoteNeedsCheck);
    }
    addEntry(
      'focusedTarget',
      context?.focusedTarget?.id,
      context?.focusedTarget?.parserNote,
      context?.focusedTarget?.parserNoteNeedsCheck
    );

    return entries;
  }

  private extractRawInput(actionJson: string): string {
    try {
      const envelope = JSON.parse(actionJson) as ParserCascadeEnvelope;
      return envelope.debug.rawInput;
    } catch {
      return '';
    }
  }

  private extractPendingIntent(
    actionJson: string
  ): 'look' | 'examine' | 'take' | 'put' | 'open' | 'close' | 'quit' | 'goTo' {
    try {
      const envelope = JSON.parse(actionJson) as ParserCascadeEnvelope;
      if (envelope.output.kind !== 'plan') {
        return 'take';
      }
      const firstAction = envelope.output.actions[0];
      if (
        firstAction &&
        (firstAction.type === 'lookTarget' ||
          firstAction.type === 'lookRelationTarget' ||
          firstAction.type === 'examineTarget' ||
          firstAction.type === 'examineRelationTarget' ||
          firstAction.type === 'takeTarget' ||
          firstAction.type === 'putTarget' ||
          firstAction.type === 'openTarget' ||
          firstAction.type === 'closeTarget' ||
          firstAction.type === 'quitCurrentView' ||
          firstAction.type === 'goToTarget')
      ) {
        return firstAction.type === 'lookTarget'
          ? 'look'
          : firstAction.type === 'lookRelationTarget'
            ? 'look'
            : firstAction.type === 'examineTarget'
              ? 'examine'
              : firstAction.type === 'examineRelationTarget'
                ? 'examine'
                : firstAction.type === 'takeTarget'
                  ? 'take'
                  : firstAction.type === 'putTarget'
                    ? 'put'
                    : firstAction.type === 'openTarget'
                      ? 'open'
                      : firstAction.type === 'closeTarget'
                        ? 'close'
                        : firstAction.type === 'quitCurrentView'
                          ? 'quit'
                          : 'goTo';
      }
    } catch {
      // Fall through to default.
    }
    return 'take';
  }

  private looksLikeFreshCommand(input: string): boolean {
    const trimmed = input.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('#') || trimmed.startsWith('-')) return true;
    const firstWord = trimmed.split(/\s+/)[0]?.toUpperCase() || '';
    if (getStage1CommandWords(this.game.textAssets.getParserLexicon()).has(firstWord)) {
      return true;
    }
    return !!matchParserCommandSpec(trimmed, this.game.textAssets.getParserCommands());
  }

  private hasClosableView(): boolean {
    if ((this.game as any).getInventoryPreviewEntity?.()) {
      return true;
    }

    return !!this.game.sceneManager?.currentScene?.activeSubscene;
  }

  private buildPeekScopeSummary(scope: ParserScope): Record<string, unknown> {
    return {
      visible: scope.visible.map((entity) => entity.name),
      held: scope.held.map((entity) => entity.name),
      takable: scope.takable.map((entity) => entity.name),
      putSource: scope.putSource.map((entity) => entity.name),
      reachable: scope.reachable.map((entity) => entity.name),
      examinable: scope.examinable.map((entity) => entity.name),
      subscene: scope.subscene.map((entity) => entity.name),
      worldKnown: scope.worldKnown.map((entity) => entity.name),
      hiddenKnown: scope.hiddenKnown.map((entity) => entity.name),
    };
  }

  private resolveShowTextParams(
    directParams: Record<string, string> | undefined,
    paramsFromRefs: Record<string, string> | undefined,
    planState: ParserPlanState
  ): Record<string, string> | undefined {
    const resolved: Record<string, string> = { ...(directParams || {}) };

    for (const [paramName, refName] of Object.entries(paramsFromRefs || {})) {
      const value = planState[refName];
      const displayValue = this.getPlanStateDisplayValue(value);
      if (displayValue) {
        resolved[paramName] = displayValue;
      }
    }

    return Object.keys(resolved).length ? resolved : undefined;
  }

  private resolveShowTextMessage(
    action: Extract<ParserToolAction, { type: 'showText' }>,
    planState: ParserPlanState
  ): string | undefined {
    if (!action.messageByRef) return action.message;

    const value = planState[action.messageByRef.ref];
    const key =
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : this.getPlanStateDisplayValue(value);

    return (
      (key ? action.messageByRef.values[key] : undefined) ||
      action.messageByRef.fallback ||
      action.message
    );
  }

  private getPlanStateDisplayValue(value: unknown): string | null {
    if (value instanceof Entity) {
      return this.getPlayerFacingObjectTitle(value) || null;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (value && typeof value === 'object') {
      const maybeScene = value as { title?: unknown; name?: unknown; id?: unknown };
      if (typeof maybeScene.title === 'string' && maybeScene.title.trim())
        return maybeScene.title.trim();
      if (typeof maybeScene.name === 'string' && maybeScene.name.trim())
        return maybeScene.name.trim();
      if (typeof maybeScene.id === 'string' && maybeScene.id.trim()) return maybeScene.id.trim();
    }
    return null;
  }

  private interpolateTemplate(template: string, params?: Record<string, string>): string {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_match, token: string) => {
      const value = params[token];
      return value === undefined || value === null ? `{${token}}` : String(value);
    });
  }

  private normalizeGroupId(groupId: string): string {
    const trimmed = String(groupId || '').trim();
    if (!trimmed) return '';
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  }

  private objectHasGroupId(sceneObject: SceneObject, groupId: string): boolean {
    if (!groupId) return false;
    return String(sceneObject.groupID || '')
      .split(',')
      .map((entry) => entry.trim())
      .includes(groupId);
  }

  private getRelationDisplayText(relation: ParserRelationType): string {
    switch (relation) {
      case 'on':
        return 'on';
      case 'under':
        return 'under';
      case 'in':
        return 'in';
      case 'behind':
        return 'behind';
      case 'near':
        return 'near';
      default:
        return relation;
    }
  }

  private isEntityValidForCommandArgument(
    entity: Entity,
    validation?: ParserCommandArgumentValidation
  ): boolean {
    if (!validation) return true;

    const normalizedEntityId = entity.name.trim().toUpperCase();
    const normalizedTitle = (this.getPlayerFacingObjectTitle(entity) || '').trim().toUpperCase();
    const normalizedSynonyms = this.game.textAssets
      .getResolvedObjectListField(entity as any, 'synonyms')
      .map((item: string) => item.trim().toUpperCase())
      .filter(Boolean);

    const matchesAllowedEntityIds =
      !validation.allowedEntityIds?.length ||
      validation.allowedEntityIds.some(
        (item) => String(item).trim().toUpperCase() === normalizedEntityId
      );
    const matchesAllowedTitles =
      !validation.allowedTitles?.length ||
      validation.allowedTitles.some(
        (item) => String(item).trim().toUpperCase() === normalizedTitle
      );
    const matchesAllowedSynonyms =
      !validation.allowedSynonyms?.length ||
      validation.allowedSynonyms.some((item) =>
        normalizedSynonyms.includes(String(item).trim().toUpperCase())
      );

    return matchesAllowedEntityIds && matchesAllowedTitles && matchesAllowedSynonyms;
  }
}
