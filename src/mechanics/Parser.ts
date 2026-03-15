import type { GameActionOutcome } from '../core/GameActionTypes';
import { NlpCascade } from './NlpCascade';
import { normalizeTargetForIntent } from './nlp/normalizeTarget';
import type { Entity } from '../entities/Entity';
import type { SceneDescriptor } from '../scene/SceneManager';
import type {
  ParserActionEnvelope,
  ParserContext,
  ParserEntityContext,
  ParserInventoryItemContext,
  ParserPendingState,
  ParserResponse,
  ParserResult,
  ParserToolAction,
} from './parserTypes';

const STAGE1_COMMAND_WORDS = new Set([
  'LOOK',
  'EXAMINE',
  'INSPECT',
  'CHECK',
  'X',
  'TAKE',
  'GET',
  'PICKUP',
  'INV',
  'INVENTORY',
  'I',
  'GO',
  'WALK',
  'MOVE',
]);

export class Parser {
  game: any;
  inputField: HTMLInputElement | null;
  pendingState: ParserPendingState | null;
  nlpCascade: NlpCascade;

  constructor(game: any) {
    this.game = game;
    this.inputField = null;
    this.pendingState = null;
    this.nlpCascade = new NlpCascade();
  }

  async parse(input: string): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed) return;
    try {
      this.nlpCascade.clearLastDebugInfo();
      const actionEnvelope = this.resolvePendingAction(trimmed);
      const context = this.buildContext(trimmed);
      const contextJson = JSON.stringify(context);
      let actionJson =
        actionEnvelope ||
        (this.game.console?.parserStage1Enabled === false
          ? this.buildStage1BypassAction(trimmed)
          : this.runStage1(trimmed));

      if (!actionEnvelope && this.isHandoffAction(actionJson)) {
        const stage2Envelope = await this.nlpCascade.parse(trimmed, context);
        if (stage2Envelope) {
          actionJson = JSON.stringify(stage2Envelope);
        }
      }

      const resultJson = this.executeActionJson(actionJson);
      const response = this.buildResponse(resultJson, actionJson, contextJson);

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
      this.game.console?.log(`[Parser error] ${String(error)}`, 'error');
      this.game.log(this.game.text('parser.parse_unknown'));
    }
  }

  private buildContext(rawInput: string): ParserContext {
    const scene = this.game.sceneManager.currentScene;
    const normalizedInput = rawInput.trim().toUpperCase();

    return {
      rawInput,
      normalizedInput,
      scene: scene
        ? {
            id: scene.id,
            name: scene.name,
            title: this.game.textAssets.getResolvedSceneField(scene, 'title'),
            description: this.game.textAssets.getResolvedSceneField(scene, 'description'),
          }
        : null,
      entities: scene
        ? (scene.entities || [])
            .map((entity: any) => ({
              id: entity.name,
              type: entity.type,
              title: this.game.textAssets.getResolvedObjectField(entity, 'title'),
              description: this.game.textAssets.getResolvedObjectField(entity, 'description'),
              details: this.game.textAssets.getResolvedObjectField(entity, 'details'),
              interactions: Object.keys(entity.interactions || {}),
            }))
            .filter((entity: ParserEntityContext) => !!entity.title?.trim())
        : [],
      inventory: (this.game.inventory || [])
        .map((entity: any) => ({
          id: entity.name,
          title: this.game.textAssets.getResolvedObjectField(entity, 'title'),
          description: this.game.textAssets.getResolvedObjectField(entity, 'description'),
          details: this.game.textAssets.getResolvedObjectField(entity, 'details'),
        }))
        .filter((entity: ParserInventoryItemContext) => !!entity.title?.trim()),
      pending: this.pendingState
        ? {
            intent: this.pendingState.intent,
            question: this.pendingState.question,
            originalInput: this.pendingState.originalInput,
          }
        : null,
    };
  }

  private resolvePendingAction(input: string): string | null {
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

    const envelope: ParserActionEnvelope = {
      stage: 'pending-resolution',
      actions: [action],
      debug: {
        rawInput: input,
        normalizedInput: input.trim().toUpperCase(),
        verb: this.pendingState.intent.toUpperCase(),
        noun: input.trim(),
        pendingIntent: this.pendingState.intent,
      },
    };

    return JSON.stringify(envelope);
  }

  private runStage1(input: string): string {
    const words = input.trim().split(/\s+/);
    const verb = (words[0] || '').toUpperCase();
    const noun = words.slice(1).join(' ').trim();
    const normalizedNoun = noun.toUpperCase();

    let actions: ParserToolAction[];

    switch (verb) {
      case 'LOOK':
        actions = [
          !normalizedNoun ||
          normalizedNoun === 'AROUND' ||
          normalizedNoun === 'HERE' ||
          normalizedNoun === 'SCENE'
            ? { type: 'lookScene' as const }
            : {
                type: 'lookTarget' as const,
                target: normalizeTargetForIntent(input, 'look') || noun,
              },
        ];
        break;
      case 'EXAMINE':
      case 'INSPECT':
      case 'CHECK':
      case 'X':
        actions = [
          {
            type: 'examineTarget',
            target: normalizeTargetForIntent(input, 'examine') || noun || null,
          },
        ];
        break;
      case 'TAKE':
      case 'GET':
      case 'PICKUP':
        actions = [
          { type: 'takeTarget', target: normalizeTargetForIntent(input, 'take') || noun || null },
        ];
        break;
      case 'INV':
      case 'INVENTORY':
      case 'I':
        actions = [{ type: 'showInventory' }];
        break;
      case 'GO':
      case 'WALK':
      case 'MOVE': {
        const target = normalizeTargetForIntent(input, 'goTo') || noun;
        actions = [{ type: 'goToTarget', target: target || null }];
        break;
      }
      default:
        actions = [
          {
            type: 'handoff',
            reason: 'unsupported_by_stage1',
            verb,
            noun,
            rawInput: input,
          },
        ];
        break;
    }

    const envelope: ParserActionEnvelope = {
      stage: 'regex-v1',
      actions,
      debug: {
        rawInput: input,
        normalizedInput: input.trim().toUpperCase(),
        verb,
        noun,
      },
    };

    return JSON.stringify(envelope);
  }

  private buildStage1BypassAction(input: string): string {
    const words = input.trim().split(/\s+/);
    const verb = (words[0] || '').toUpperCase();
    const noun = words.slice(1).join(' ').trim();

    const envelope: ParserActionEnvelope = {
      stage: 'regex-v1',
      actions: [
        {
          type: 'handoff',
          reason: 'stage1_disabled',
          verb,
          noun,
          rawInput: input,
        },
      ],
      debug: {
        rawInput: input,
        normalizedInput: input.trim().toUpperCase(),
        verb,
        noun,
      },
    };

    return JSON.stringify(envelope);
  }

  private isHandoffAction(actionJson: string): boolean {
    try {
      const envelope = JSON.parse(actionJson) as ParserActionEnvelope;
      return envelope.actions.length === 1 && envelope.actions[0]?.type === 'handoff';
    } catch {
      return false;
    }
  }

  private executeActionJson(actionJson: string): string {
    const envelope = JSON.parse(actionJson) as ParserActionEnvelope;
    const executedActions: string[] = [];

    if (!envelope.actions.length) {
      const result: ParserResult = {
        type: 'handoff',
        handled: false,
        outcomes: [],
        actionsExecuted: executedActions,
        reason: 'empty_action_plan',
        debug: { actionJson },
      };
      return JSON.stringify(result);
    }

    const outcomes: GameActionOutcome[] = [];

    for (const action of envelope.actions) {
      if (action.type === 'handoff') {
        const result: ParserResult = {
          type: 'handoff',
          handled: false,
          outcomes,
          actionsExecuted: executedActions,
          reason: action.reason,
          debug: {
            actionJson,
            action,
          },
        };
        return JSON.stringify(result);
      }

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
      case 'handoff':
        return {
          status: 'escalate',
          code: action.reason,
          message: this.game.text('parser.parse_unknown'),
          recoverable: true,
        };
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
      case 'handoff':
        return 'handoff';
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
    return title ? [title.toUpperCase()] : [];
  }

  private getResolutionOptionTitles(entities: Entity[]): string[] | null {
    const titles = entities
      .map((entity) => this.getPlayerFacingEntityTitle(entity))
      .filter((title): title is string => !!title);
    if (titles.length !== entities.length) return null;
    return Array.from(new Set(titles));
  }

  private getSceneEntitiesForResolution(options: { includeTakeablesOnly: boolean }): Entity[] {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return [];

    return (scene.entities || []).filter((entity: Entity) => {
      if (entity.disabled || !this.getPlayerFacingEntityTitle(entity)) return false;
      if (!options.includeTakeablesOnly) return true;
      const isItem = entity.components && entity.components.find((c: any) => c.type === 'Item');
      return !!isItem || !!entity.isTakeable;
    });
  }

  private getInventoryEntitiesForResolution(): Entity[] {
    return (this.game.inventory || []).filter(
      (entity: Entity) => !!this.getPlayerFacingEntityTitle(entity)
    );
  }

  private resolveSceneEntityTarget(
    rawTarget: string,
    options: {
      includeTakeablesOnly: boolean;
      includeInventory: boolean;
      clarificationKey: string;
    }
  ):
    | { status: 'found'; entity: Entity }
    | { status: 'not_found' }
    | { status: 'ambiguous'; message: string; options: string[] }
    | { status: 'escalate'; code: string } {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return { status: 'not_found' };

    const normalizedTarget = String(rawTarget || '')
      .trim()
      .toUpperCase();
    if (!normalizedTarget) return { status: 'not_found' };

    const sceneCandidates = this.getSceneEntitiesForResolution({
      includeTakeablesOnly: options.includeTakeablesOnly,
    });
    const inventoryCandidates = options.includeInventory
      ? this.getInventoryEntitiesForResolution()
      : [];
    const exactCandidates = Array.from(new Set([...sceneCandidates, ...inventoryCandidates]));
    const partialCandidates = exactCandidates;

    const exactMatches = exactCandidates.filter((entity: Entity) =>
      this.getEntityLookupTokens(entity).includes(normalizedTarget)
    );
    if (exactMatches.length === 1) return { status: 'found', entity: exactMatches[0] };
    if (exactMatches.length > 1) {
      const optionTitles = this.getResolutionOptionTitles(exactMatches);
      if (!optionTitles) return { status: 'escalate', code: 'ambiguous_targets_missing_titles' };
      return {
        status: 'ambiguous',
        message: this.game.text(options.clarificationKey, { options: optionTitles.join(', ') }),
        options: optionTitles,
      };
    }

    const partialMatches = partialCandidates.filter((entity: Entity) => {
      const title = this.getPlayerFacingEntityTitle(entity);
      return !!title && title.toUpperCase().includes(normalizedTarget);
    });
    if (partialMatches.length === 1) return { status: 'found', entity: partialMatches[0] };
    if (partialMatches.length > 1) {
      const optionTitles = this.getResolutionOptionTitles(partialMatches);
      if (!optionTitles) return { status: 'escalate', code: 'ambiguous_targets_missing_titles' };
      return {
        status: 'ambiguous',
        message: this.game.text(options.clarificationKey, { options: optionTitles.join(', ') }),
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
    for (const descriptor of this.game.sceneManager.sceneRegistry.values()) {
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
    const resolved = this.resolveSceneEntityTarget(rawTarget, {
      includeTakeablesOnly: false,
      includeInventory: true,
      clarificationKey: 'parser.look_which_one',
    });
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

    const resolved = this.resolveSceneEntityTarget(rawTarget, {
      includeTakeablesOnly: false,
      includeInventory: true,
      clarificationKey: 'parser.examine_which_one',
    });
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
    const resolved = this.resolveSceneEntityTarget(rawTarget, {
      includeTakeablesOnly: true,
      includeInventory: false,
      clarificationKey: 'parser.take_which_one',
    });
    const broadResolved =
      resolved.status === 'not_found'
        ? this.resolveSceneEntityTarget(rawTarget, {
            includeTakeablesOnly: false,
            includeInventory: false,
            clarificationKey: 'parser.take_which_one',
          })
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

    const resolved = this.resolveSceneEntityTarget(rawTarget, {
      includeTakeablesOnly: false,
      includeInventory: false,
      clarificationKey: 'parser.go_to_which_one',
    });
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
      const envelope = JSON.parse(actionJson) as ParserActionEnvelope;
      return envelope.debug.rawInput;
    } catch {
      return '';
    }
  }

  private extractPendingIntent(actionJson: string): 'look' | 'examine' | 'take' | 'goTo' {
    try {
      const envelope = JSON.parse(actionJson) as ParserActionEnvelope;
      const firstAction = envelope.actions[0];
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
    return STAGE1_COMMAND_WORDS.has(firstWord);
  }
}
