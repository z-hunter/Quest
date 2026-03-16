import type { GameActionOutcome } from '../core/GameActionTypes';
import { NlpCascade } from './NlpCascade';
import {
  getStage1CommandWords,
  isLookSceneWord,
  matchStage1Intent,
  normalizeTargetForIntent,
} from './parserLanguage';
import { ParserWorldModelBuilder } from './ParserWorldModelBuilder';
import type { Entity } from '../entities/Entity';
import type { SceneDescriptor } from '../scene/SceneManager';
import type {
  ParserCascadeEnvelope,
  ParserPendingState,
  ParserResponse,
  ParserResult,
  ParserScope,
  ParserToolAction,
} from './parserTypes';

export class Parser {
  game: any;
  inputField: HTMLInputElement | null;
  pendingState: ParserPendingState | null;
  nlpCascade: NlpCascade;
  worldModelBuilder: ParserWorldModelBuilder;
  activeScope: ParserScope | null;

  constructor(game: any) {
    this.game = game;
    this.inputField = null;
    this.pendingState = null;
    this.nlpCascade = new NlpCascade(() => this.game.textAssets);
    this.worldModelBuilder = new ParserWorldModelBuilder(this.game);
    this.activeScope = null;
  }

  async parse(input: string): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed) return;
    try {
      this.nlpCascade.clearLastDebugInfo();
      const actionEnvelope = this.resolvePendingAction(trimmed);
      const worldModel = this.worldModelBuilder.build(trimmed, this.pendingState);
      const context = worldModel.context;
      this.activeScope = worldModel.scope;
      const contextJson = JSON.stringify(context);
      let envelope =
        actionEnvelope ||
        (this.game.console?.parserStage1Enabled === false
          ? this.buildStage1BypassAction(trimmed)
          : this.runStage1(trimmed));

      if (
        !actionEnvelope &&
        this.game.console?.parserStage2Enabled !== false &&
        this.isHandoffEnvelope(envelope)
      ) {
        const stage2Envelope = await this.nlpCascade.parse(trimmed, context);
        if (stage2Envelope) {
          envelope = stage2Envelope;
        }
      }

      const envelopeJson = JSON.stringify(envelope);
      const resultJson = this.executeEnvelope(envelope);
      const response = this.buildResponse(resultJson, envelopeJson, contextJson);

      if (response.debugMessages?.length) {
        for (const message of response.debugMessages) {
          this.game.console?.log(message, 'info');
        }
      }

      this.pendingState =
        response.nextPendingState === undefined ? this.pendingState : response.nextPendingState;

      if (response.playerMessage) {
        this.game.log(response.playerMessage);
      }
    } catch (error) {
      this.pendingState = null;
      this.activeScope = null;
      this.game.console?.log(`[Parser error] ${String(error)}`, 'error');
      this.game.log(this.game.text('parser.parse_unknown'));
    }
  }

  private resolvePendingAction(input: string): ParserCascadeEnvelope | null {
    if (!this.pendingState) return null;
    if (this.looksLikeFreshCommand(input)) {
      this.pendingState = null;
      return null;
    }

    const action: ParserToolAction = {
      type:
        this.pendingState.intent === 'look'
          ? 'lookTarget'
          : this.pendingState.intent === 'examine'
            ? 'examineTarget'
            : this.pendingState.intent === 'take'
              ? 'takeTarget'
              : 'goToTarget',
      target: input.trim(),
    };

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

  private runStage1(input: string): ParserCascadeEnvelope {
    const lexicon = this.game.textAssets.getParserLexicon();
    const match = matchStage1Intent(input, lexicon);
    const words = input.trim().split(/\s+/);
    const verb = (words[0] || '').toUpperCase();
    const noun = words.slice(1).join(' ').trim();

    switch (match?.intent) {
      case 'look': {
        const target = normalizeTargetForIntent(input, 'look', lexicon) || match.remainder || noun;
        return {
          stage: 'regex-v1',
          output: {
            kind: 'plan',
            actions: [
              !target || isLookSceneWord(target, lexicon)
                ? { type: 'lookScene' as const }
                : { type: 'lookTarget' as const, target },
            ],
          },
          debug: {
            rawInput: input,
            normalizedInput: input.trim().toUpperCase(),
            verb,
            noun,
          },
        };
      }
      case 'examine':
        return {
          stage: 'regex-v1',
          output: {
            kind: 'plan',
            actions: [
              {
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
          },
        };
      case 'take':
        return {
          stage: 'regex-v1',
          output: {
            kind: 'plan',
            actions: [
              {
                type: 'takeTarget',
                target:
                  normalizeTargetForIntent(input, 'take', lexicon) ||
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

  private executeEnvelope(envelope: ParserCascadeEnvelope): string {
    const executedActions: string[] = [];

    if (envelope.output.kind === 'handoff_up') {
      const result: ParserResult = {
        type: 'handoff',
        handled: false,
        outcomes: [],
        actionsExecuted: executedActions,
        reason: envelope.output.reason,
        debug: {
          envelope,
        },
      };
      return JSON.stringify(result);
    }

    const actions = envelope.output.actions;
    if (!actions.length) {
      const result: ParserResult = {
        type: 'handoff',
        handled: false,
        outcomes: [],
        actionsExecuted: executedActions,
        reason: 'empty_action_plan',
        debug: { envelope },
      };
      return JSON.stringify(result);
    }

    const outcomes: GameActionOutcome[] = [];

    for (const action of actions) {
      const outcome = this.executeParserAction(action);
      executedActions.push(this.getExecutedActionName(action));
      outcomes.push(outcome);

      if (outcome.status !== 'ok') {
        break;
      }
    }

    const result: ParserResult = {
      type: 'outcomes',
      handled: true,
      outcomes,
      actionsExecuted: executedActions,
    };
    return JSON.stringify(result);
  }

  private executeParserAction(action: ParserToolAction): GameActionOutcome {
    switch (action.type) {
      case 'lookScene':
        return this.game.lookScene();
      case 'lookTarget':
        return this.resolveLookTarget(action.target);
      case 'examineTarget':
        return this.resolveExamineTarget(action.target);
      case 'takeTarget':
        return this.resolveTakeTarget(action.target);
      case 'showInventory':
        return this.game.showInventory();
      case 'goToTarget':
        return this.resolveGoToTarget(action.target);
      default:
        return {
          status: 'escalate',
          code: 'unknown_parser_action',
          message: this.game.text('parser.parse_unknown'),
          recoverable: false,
        };
    }
  }

  private getExecutedActionName(action: ParserToolAction): string {
    switch (action.type) {
      case 'lookScene':
        return 'lookScene';
      case 'lookTarget':
        return 'look';
      case 'examineTarget':
        return 'examine';
      case 'takeTarget':
        return 'take';
      case 'showInventory':
        return 'showInventory';
      case 'goToTarget':
        return 'goTo';
      default:
        return 'unknown';
    }
  }

  private getPlayerFacingEntityTitle(entity: Entity): string | null {
    const title = this.game.textAssets.getResolvedObjectField(entity, 'title');
    return title && title.trim() ? title.trim() : null;
  }

  private getEntityLookupTokens(entity: Entity): string[] {
    const title = this.getPlayerFacingEntityTitle(entity);
    const synonyms = this.game.textAssets.getResolvedObjectListField(entity as any, 'synonyms');
    return Array.from(
      new Set([title, ...synonyms].filter((item): item is string => !!item && !!item.trim()))
    ).map((item) => item.toUpperCase());
  }

  private getResolutionOptionTitles(entities: Entity[]): string[] | null {
    const titles = entities
      .map((entity) => this.getPlayerFacingEntityTitle(entity))
      .filter((title): title is string => !!title);
    if (titles.length !== entities.length) return null;
    return Array.from(new Set(titles));
  }

  private getScopeCandidates(sliceNames: Array<keyof Omit<ParserScope, 'sceneTargets'>>): Entity[] {
    const scope = this.activeScope || this.worldModelBuilder.build('', this.pendingState).scope;
    const candidates: Entity[] = [];
    for (const sliceName of sliceNames) {
      candidates.push(...scope[sliceName]);
    }
    return Array.from(new Set(candidates));
  }

  private resolveEntityTargetInCandidates(
    rawTarget: string,
    candidates: Entity[],
    clarificationKey: string
  ):
    | { status: 'found'; entity: Entity }
    | { status: 'not_found' }
    | { status: 'ambiguous'; message: string; options: string[] }
    | { status: 'escalate'; code: string } {
    const normalizedTarget = String(rawTarget || '')
      .trim()
      .toUpperCase();
    if (!normalizedTarget) return { status: 'not_found' };

    const exactMatches = candidates.filter((entity: Entity) =>
      this.getEntityLookupTokens(entity).includes(normalizedTarget)
    );
    if (exactMatches.length === 1) return { status: 'found', entity: exactMatches[0] };
    if (exactMatches.length > 1) {
      const optionTitles = this.getResolutionOptionTitles(exactMatches);
      if (!optionTitles) return { status: 'escalate', code: 'ambiguous_targets_missing_titles' };
      return {
        status: 'ambiguous',
        message: this.game.text(clarificationKey, { options: optionTitles.join(', ') }),
        options: optionTitles,
      };
    }

    const partialMatches = candidates.filter((entity: Entity) => {
      const lookupTokens = this.getEntityLookupTokens(entity);
      return lookupTokens.some((token) => token.includes(normalizedTarget));
    });
    if (partialMatches.length === 1) return { status: 'found', entity: partialMatches[0] };
    if (partialMatches.length > 1) {
      const optionTitles = this.getResolutionOptionTitles(partialMatches);
      if (!optionTitles) return { status: 'escalate', code: 'ambiguous_targets_missing_titles' };
      return {
        status: 'ambiguous',
        message: this.game.text(clarificationKey, { options: optionTitles.join(', ') }),
        options: optionTitles,
      };
    }

    return { status: 'not_found' };
  }

  private resolveSceneTarget(rawTarget: string): SceneDescriptor | null {
    const normalized = String(rawTarget || '')
      .trim()
      .toUpperCase();
    if (!normalized) return null;
    const scope = this.activeScope || this.worldModelBuilder.build('', this.pendingState).scope;
    for (const descriptor of scope.sceneTargets) {
      if (
        descriptor.id.toUpperCase() === normalized ||
        descriptor.name.toUpperCase() === normalized ||
        (!!descriptor.title && descriptor.title.toUpperCase() === normalized)
      ) {
        return descriptor;
      }
    }
    return null;
  }

  private resolveLookTarget(rawTarget: string): GameActionOutcome {
    const resolved = this.resolveEntityTargetInCandidates(
      rawTarget,
      this.getScopeCandidates(['visible', 'held']),
      'parser.look_which_one'
    );
    if (resolved.status === 'escalate') {
      return { status: 'escalate', code: resolved.code, recoverable: true };
    }
    if (resolved.status === 'not_found') {
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
        data: { target: rawTarget, options: resolved.options },
        recoverable: true,
      };
    }
    return this.game.lookEntity(resolved.entity);
  }

  private resolveExamineTarget(rawTarget: string | null): GameActionOutcome {
    if (!rawTarget) {
      return {
        status: 'needs_clarification',
        code: 'missing_examine_target',
        message: this.game.text('parser.examine_prompt'),
        recoverable: true,
      };
    }

    const resolved = this.resolveEntityTargetInCandidates(
      rawTarget,
      this.getScopeCandidates(['examinable']),
      'parser.examine_which_one'
    );
    if (resolved.status === 'escalate') {
      return { status: 'escalate', code: resolved.code, recoverable: true };
    }
    if (resolved.status === 'not_found') {
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
        data: { target: rawTarget, options: resolved.options },
        recoverable: true,
      };
    }
    return this.game.examineEntity(resolved.entity);
  }

  private resolveTakeTarget(rawTarget: string | null): GameActionOutcome {
    if (!rawTarget) {
      return {
        status: 'needs_clarification',
        code: 'missing_take_target',
        message: this.game.text('parser.take_prompt'),
        recoverable: true,
      };
    }
    const resolved = this.resolveEntityTargetInCandidates(
      rawTarget,
      this.getScopeCandidates(['takable']),
      'parser.take_which_one'
    );
    const broadResolved =
      resolved.status === 'not_found'
        ? this.resolveEntityTargetInCandidates(
            rawTarget,
            this.getScopeCandidates(['visible']),
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
        return {
          status: 'needs_clarification',
          code: 'ambiguous_take_target',
          message: broadResolved.message,
          data: { target: rawTarget, options: broadResolved.options },
          recoverable: true,
        };
      }
      if (broadResolved?.status === 'found') {
        return {
          status: 'failed',
          code: 'not_takeable',
          message: this.game.text('parser.take_cannot'),
          data: { entityId: broadResolved.entity.name },
          recoverable: true,
        };
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
        data: { target: rawTarget, options: resolved.options },
        recoverable: true,
      };
    }
    return this.game.takeEntity(resolved.entity);
  }

  private resolveGoToTarget(rawTarget: string | null): GameActionOutcome {
    if (!rawTarget) {
      return {
        status: 'needs_clarification',
        code: 'missing_destination',
        message: this.game.text('parser.go_to_prompt'),
        recoverable: true,
      };
    }

    const sceneMatch = this.resolveSceneTarget(rawTarget);
    if (sceneMatch) {
      return this.game.goToScene(sceneMatch.id);
    }

    const resolved = this.resolveEntityTargetInCandidates(
      rawTarget,
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
        data: { target: rawTarget, options: resolved.options },
        recoverable: true,
      };
    }
    if (resolved.status === 'found') {
      return this.game.goToEntity(resolved.entity);
    }
    return {
      status: 'failed',
      code: 'destination_not_found',
      message: this.game.text('parser.go_to_not_found', { target: rawTarget }),
      data: { target: rawTarget },
      recoverable: true,
    };
  }

  private buildResponse(
    resultJson: string,
    actionJson: string,
    contextJson: string
  ): ParserResponse {
    const result = JSON.parse(resultJson) as ParserResult;
    const nlpDebug = this.nlpCascade.getLastDebugInfo();
    const peekMessages = this.game.console?.parserPeekEnabled
      ? [
          `[Parser peek] context=${contextJson}`,
          `[Parser peek] actions=${actionJson}`,
          `[Parser peek] result=${resultJson}`,
          ...(nlpDebug ? [`[Parser peek] nlp=${JSON.stringify(nlpDebug)}`] : []),
        ]
      : undefined;

    if (result.type === 'handoff') {
      return {
        playerMessage: this.game.text('parser.parse_unknown'),
        nextPendingState: null,
        debugMessages: peekMessages || [
          `[Parser handoff] context=${contextJson}`,
          `[Parser handoff] actions=${actionJson}`,
          `[Parser handoff] result=${resultJson}`,
        ],
      };
    }

    const clarification = result.outcomes.find(
      (outcome) => outcome.status === 'needs_clarification'
    );
    if (clarification) {
      return {
        playerMessage: clarification.message || this.game.text('parser.parse_unknown'),
        nextPendingState: {
          intent: this.extractPendingIntent(actionJson),
          question: clarification.message || this.game.text('parser.parse_unknown'),
          originalInput: this.extractRawInput(actionJson),
        },
        debugMessages: peekMessages,
      };
    }

    const escalation = result.outcomes.find((outcome) => outcome.status === 'escalate');
    if (escalation) {
      return {
        playerMessage: escalation.message || this.game.text('parser.parse_unknown'),
        nextPendingState: null,
        debugMessages: peekMessages || [
          `[Parser handoff] context=${contextJson}`,
          `[Parser handoff] actions=${actionJson}`,
          `[Parser handoff] result=${resultJson}`,
        ],
      };
    }

    const firstFailure = result.outcomes.find((outcome) => outcome.status === 'failed');
    if (firstFailure) {
      return {
        playerMessage: firstFailure.message || this.game.text('parser.parse_unknown'),
        nextPendingState: null,
        debugMessages: peekMessages,
      };
    }

    const finalOutcomeWithMessage = [...result.outcomes]
      .reverse()
      .find((outcome) => !!outcome.message);
    return {
      playerMessage: finalOutcomeWithMessage?.message,
      nextPendingState: null,
      debugMessages: peekMessages,
    };
  }

  private extractRawInput(actionJson: string): string {
    try {
      const envelope = JSON.parse(actionJson) as ParserCascadeEnvelope;
      return envelope.debug.rawInput;
    } catch {
      return '';
    }
  }

  private extractPendingIntent(actionJson: string): 'look' | 'examine' | 'take' | 'goTo' {
    try {
      const envelope = JSON.parse(actionJson) as ParserCascadeEnvelope;
      if (envelope.output.kind !== 'plan') {
        return 'take';
      }
      const firstAction = envelope.output.actions[0];
      if (
        firstAction &&
        (firstAction.type === 'lookTarget' ||
          firstAction.type === 'examineTarget' ||
          firstAction.type === 'takeTarget' ||
          firstAction.type === 'goToTarget')
      ) {
        return firstAction.type === 'lookTarget'
          ? 'look'
          : firstAction.type === 'examineTarget'
            ? 'examine'
            : firstAction.type === 'takeTarget'
              ? 'take'
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
    return getStage1CommandWords(this.game.textAssets.getParserLexicon()).has(firstWord);
  }
}
