import type { GameActionOutcome } from '../core/GameActionTypes';
import { NlpCascade } from './NlpCascade';
import { matchParserCommandSpec } from './parserCommands';
import {
  extractRelationTargetForIntent,
  getStage1CommandWords,
  isLookSceneWord,
  matchStage1Intent,
  normalizeTargetForIntent,
} from './parserLanguage';
import { ParserWorldModelBuilder } from './ParserWorldModelBuilder';
import { Entity } from '../entities/Entity';
import { SceneObject } from '../entities/SceneObject';
import { ComponentSystem } from '../systems/ComponentSystem';
import { buildSceneTextLayerSnapshot, getInactiveSubsceneAncestors } from '../scene/SceneTextLayer';
import type {
  ParserCascadeEnvelope,
  ParserCommandActionSpec,
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

export class Parser {
  game: any;
  inputField: HTMLInputElement | null;
  pendingState: ParserPendingState | null;
  nlpCascade: NlpCascade;
  worldModelBuilder: ParserWorldModelBuilder;
  activeWorldModel: ParserWorldModel | null;
  activeScope: ParserScope | null;

  constructor(game: any) {
    this.game = game;
    this.inputField = null;
    this.pendingState = null;
    this.nlpCascade = new NlpCascade(() => this.game.textAssets);
    this.worldModelBuilder = new ParserWorldModelBuilder(this.game);
    this.activeWorldModel = null;
    this.activeScope = null;
  }

  async parse(input: string): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed) return;
    try {
      this.nlpCascade.clearLastDebugInfo();
      const actionEnvelope = this.resolvePendingAction(trimmed);
      const worldModel = this.worldModelBuilder.build(trimmed, this.pendingState);
      this.activeWorldModel = worldModel;
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

      const scopeJson = JSON.stringify(this.buildPeekScopeSummary(worldModel.scope));
      const envelopeJson = JSON.stringify(envelope);
      const resultJson = this.runParserCore(envelope);
      const response = this.buildResponse(resultJson, envelopeJson, contextJson, scopeJson);

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
      this.activeWorldModel = null;
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

    if (this.pendingState.pendingEnvelopeJson) {
      const pendingEnvelopeJson = this.pendingState.pendingEnvelopeJson;
      try {
        const envelope = JSON.parse(pendingEnvelopeJson) as ParserCascadeEnvelope;
        if (envelope.output.kind !== 'plan') {
          this.pendingState = null;
          return null;
        }

        const patchedActions = envelope.output.actions.map((action) => {
          if (action.type === 'resolveArgumentEntity') {
            if (!this.pendingState?.pendingArg || action.arg === this.pendingState.pendingArg) {
              return {
                ...action,
                query: input.trim(),
              };
            }
            return action;
          }
          if (action.type === 'lookRelationTarget') {
            return { ...action, anchor: input.trim() || null };
          }
          if (action.type === 'examineRelationTarget') {
            return { ...action, anchor: input.trim() || null };
          }
          return action;
        });

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

    const action: ParserToolAction = {
      type:
        this.pendingState.intent === 'look'
          ? 'lookTarget'
          : this.pendingState.intent === 'examine'
            ? 'examineTarget'
            : this.pendingState.intent === 'take'
              ? 'takeTarget'
              : this.pendingState.intent === 'open'
                ? 'openTarget'
                : this.pendingState.intent === 'close'
                  ? 'closeTarget'
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

  private runParserCore(envelope: ParserCascadeEnvelope): string {
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
      actions: envelope.output.actions,
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

    for (const action of actions) {
      const outcome = this.executeParserAction(action, planState);
      executedActions.push(this.getExecutedActionName(action));
      outcomes.push(outcome);

      if (outcome.status !== 'ok') {
        break;
      }
    }

    return outcomes;
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
        return this.resolveExamineTarget(action.target);
      case 'examineRelationTarget':
        return this.resolveRelationTarget('examine', action.relation, action.anchor);
      case 'takeTarget':
        return this.resolveTakeTarget(action.target);
      case 'openTarget':
        return this.resolveOpenCloseTarget('open', action.target);
      case 'closeTarget':
        return this.resolveOpenCloseTarget('close', action.target);
      case 'showInventory':
        return this.game.showInventory();
      case 'goToTarget':
        return this.resolveGoToTarget(action.target);
      case 'resolveArgumentEntity':
        return this.executeResolveArgumentEntity(action, planState);
      case 'ensureHeldEntity':
        return this.executeEnsureHeldEntity(action, planState);
      case 'goToSceneById':
        return this.game.goToScene(action.sceneId);
      case 'removeInventoryEntity':
        return this.executeRemoveInventoryEntity(action, planState);
      case 'showText': {
        const resolvedParams = this.resolveShowTextParams(
          action.params,
          action.paramsFromRefs,
          planState
        );
        return {
          status: 'ok',
          code: 'custom_message',
          message:
            (action.message
              ? this.interpolateTemplate(action.message, resolvedParams)
              : undefined) ||
            (action.textKey ? this.game.text(action.textKey, resolvedParams) : undefined),
        };
      }
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
      case 'lookRelationTarget':
        return 'lookRelation';
      case 'examineTarget':
        return 'examine';
      case 'examineRelationTarget':
        return 'examineRelation';
      case 'takeTarget':
        return 'take';
      case 'openTarget':
        return 'open';
      case 'closeTarget':
        return 'close';
      case 'showInventory':
        return 'showInventory';
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
      case 'showText':
        return 'showText';
      default:
        return 'unknown';
    }
  }

  private getPlayerFacingObjectTitle(sceneObject: SceneObject): string | null {
    const title = this.game.textAssets.getResolvedObjectField(sceneObject as any, 'title');
    return title && title.trim() ? title.trim() : null;
  }

  private getObjectLookupTokens(sceneObject: SceneObject): string[] {
    const title = this.getPlayerFacingObjectTitle(sceneObject);
    const synonyms = this.game.textAssets.getResolvedObjectListField(sceneObject as any, 'synonyms');
    return Array.from(
      new Set([title, ...synonyms].filter((item): item is string => !!item && !!item.trim()))
    ).map((item) => item.toUpperCase());
  }

  private getResolutionOptionTitles(sceneObjects: SceneObject[]): string[] | null {
    const titles = sceneObjects
      .map((sceneObject) => this.getPlayerFacingObjectTitle(sceneObject))
      .filter((title): title is string => !!title);
    if (titles.length !== sceneObjects.length) return null;
    return Array.from(new Set(titles));
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
    | { status: 'ambiguous'; message: string; options: string[] }
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
      const options = Array.from(new Set(exactMatches.map((node) => this.getSpatialNodeDisplayTitle(node))));
      if (options.some((option) => !option) || options.length !== exactMatches.length) {
        return { status: 'escalate', code: 'ambiguous_spatial_nodes_missing_titles' };
      }
      return {
        status: 'ambiguous',
        message: this.game.text(clarificationKey, { options: options.join(', ') }),
        options,
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
      return {
        status: 'ambiguous',
        message: this.game.text(clarificationKey, { options: options.join(', ') }),
        options,
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
    | { status: 'ambiguous'; message: string; options: string[] }
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
      const optionTitles = this.getResolutionOptionTitles(exactMatches);
      if (!optionTitles) return { status: 'escalate', code: 'ambiguous_targets_missing_titles' };
      return {
        status: 'ambiguous',
        message: this.game.text(clarificationKey, { options: optionTitles.join(', ') }),
        options: optionTitles,
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
    | { status: 'needs_clarification'; message: string; options: string[] }
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
        messages?.ambiguous?.replace('{options}', resolved.options.join(', ')) || resolved.message,
      options: resolved.options,
    };
  }

  private resolveInactiveSubsceneSwitchTarget(
    rawTarget: string
  ):
    | { status: 'found'; entity: SceneObject }
    | { status: 'not_found' }
    | { status: 'ambiguous'; message: string; options: string[] }
    | { status: 'escalate'; code: string } {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return { status: 'not_found' };
    const textLayer = buildSceneTextLayerSnapshot(scene, this.game);

    const candidates = [...scene.entities, ...scene.triggerboxes].filter((sceneObject: SceneObject) => {
      if (!sceneObject.components?.some((component: any) => component?.type === 'Switch')) {
        return false;
      }
      if (!textLayer.entryById.has(sceneObject.name)) return false;
      return getInactiveSubsceneAncestors(scene, sceneObject).length > 0;
    });

    return this.resolveEntityTargetInCandidates(rawTarget, candidates, 'parser.examine_which_one');
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
      const inactiveSwitchResolved = this.resolveInactiveSubsceneSwitchTarget(rawTarget);
      if (inactiveSwitchResolved.status === 'found') {
        return this.game.lookEntity(inactiveSwitchResolved.entity as any);
      }
      if (inactiveSwitchResolved.status === 'ambiguous') {
        return {
          status: 'needs_clarification',
          code: 'ambiguous_look_target',
          message: inactiveSwitchResolved.message,
          data: { target: rawTarget, options: inactiveSwitchResolved.options },
          recoverable: true,
        };
      }
      if (inactiveSwitchResolved.status === 'escalate') {
        return { status: 'escalate', code: inactiveSwitchResolved.code, recoverable: true };
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
        data: { target: rawTarget, options: resolved.options },
        recoverable: true,
      };
    }
    return this.game.lookEntity(resolved.entity as any);
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
    const broadResolved =
      resolved.status === 'not_found'
        ? this.resolveEntityTargetInCandidates(
            rawTarget,
            this.getScopeCandidates(['visible', 'held']),
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
          data: { target: rawTarget, options: broadResolved.options },
          recoverable: true,
        };
      }
      if (broadResolved?.status === 'found') {
        return this.game.examineEntity(broadResolved.entity as any);
      }
      const inactiveSwitchResolved = this.resolveInactiveSubsceneSwitchTarget(rawTarget);
      if (inactiveSwitchResolved.status === 'found') {
        return this.game.examineEntity(inactiveSwitchResolved.entity as any);
      }
      if (inactiveSwitchResolved.status === 'ambiguous') {
        return {
          status: 'needs_clarification',
          code: 'ambiguous_examine_target',
          message: inactiveSwitchResolved.message,
          data: { target: rawTarget, options: inactiveSwitchResolved.options },
          recoverable: true,
        };
      }
      if (inactiveSwitchResolved.status === 'escalate') {
        return { status: 'escalate', code: inactiveSwitchResolved.code, recoverable: true };
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
        data: { target: rawTarget, options: resolved.options },
        recoverable: true,
      };
    }
    return this.game.examineEntity(resolved.entity as any);
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
        data: { relation, anchor, options: resolved.options },
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

    return this.game.describeSpatialRelation(resolved.node.id, relation);
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
      const inactiveSwitchResolved = this.resolveInactiveSubsceneSwitchTarget(rawTarget);
      if (inactiveSwitchResolved.status === 'found') {
        return this.game.takeEntity(inactiveSwitchResolved.entity as Entity);
      }
      if (inactiveSwitchResolved.status === 'ambiguous') {
        return {
          status: 'needs_clarification',
          code: 'ambiguous_take_target',
          message: inactiveSwitchResolved.message,
          data: { target: rawTarget, options: inactiveSwitchResolved.options },
          recoverable: true,
        };
      }
      if (inactiveSwitchResolved.status === 'escalate') {
        return { status: 'escalate', code: inactiveSwitchResolved.code, recoverable: true };
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
    return this.game.takeEntity(resolved.entity as Entity);
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

    const clarificationKey =
      intent === 'open' ? 'parser.open_which_one' : 'parser.close_which_one';
    const resolved = this.resolveEntityTargetInCandidates(
      rawTarget,
      this.getScopeCandidates(['reachable']),
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
        data: { target: rawTarget, options: resolved.options },
        recoverable: true,
      };
    }

    if (resolved.status === 'not_found') {
      if (broadResolved?.status === 'ambiguous') {
        return {
          status: 'needs_clarification',
          code: intent === 'open' ? 'ambiguous_open_target' : 'ambiguous_close_target',
          message: broadResolved.message,
          data: { target: rawTarget, options: broadResolved.options },
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
          data: { target: rawTarget, options: inactiveSwitchResolved.options },
          recoverable: true,
        };
      }
      if (inactiveSwitchResolved.status === 'escalate') {
        return { status: 'escalate', code: inactiveSwitchResolved.code, recoverable: true };
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
      return {
        status: 'escalate',
        code: 'target_is_not_switch',
        recoverable: true,
      };
    }
    return intent === 'open' ? this.game.openEntity(entity as any) : this.game.closeEntity(entity as any);
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

    const sceneOutcome = this.game.goToSceneTarget(rawTarget);
    if (sceneOutcome.status === 'ok') {
      return sceneOutcome;
    }

    const resolved = this.resolveEntityTargetInCandidates(
      rawTarget,
      this.getScopeCandidates(['visible']).filter((candidate): candidate is Entity => candidate instanceof Entity),
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
      return this.game.goToEntity(resolved.entity as any);
    }
    return {
      status: 'failed',
      code: 'destination_not_found',
      message: this.game.text('parser.go_to_not_found', { target: rawTarget }),
      data: { target: rawTarget },
      recoverable: true,
    };
  }

  private executeResolveArgumentEntity(
    action: Extract<ParserToolAction, { type: 'resolveArgumentEntity' }>,
    planState: ParserPlanState
  ): GameActionOutcome {
    const resolution = this.resolveEntityTargetWithMessages(
      action.query,
      this.getScopeCandidates(action.scopes).filter((candidate): candidate is Entity => candidate instanceof Entity),
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

  private buildCustomCommandEnvelope(
    input: string,
    command: ParserCommandSpec,
    argumentValues: Record<string, string | null>
  ): ParserCascadeEnvelope {
    const actions = command.plan
      .map((step) => this.mapCommandPlanStep(command, step, argumentValues))
      .filter((action): action is ParserToolAction => !!action);

    return {
      stage: 'regex-v1',
      output: {
        kind: 'plan',
        actions,
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

  private mapCommandPlanStep(
    command: ParserCommandSpec,
    step: ParserCommandActionSpec,
    argumentValues: Record<string, string | null>
  ): ParserToolAction | null {
    switch (step.type) {
      case 'resolveArgumentEntity': {
        const argSpec = command.arguments.find((arg) => arg.name === step.arg);
        if (!argSpec) return null;
        return {
          type: 'resolveArgumentEntity',
          commandId: command.id,
          arg: step.arg,
          query: argumentValues[step.arg] || null,
          scopes: argSpec.scopes,
          saveAs: step.saveAs,
          validation: argSpec.validation,
          messages: argSpec.messages,
        };
      }
      case 'ensureHeldEntity':
        return {
          type: 'ensureHeldEntity',
          ref: step.ref,
          noEffectMessage:
            (step.noEffectMessageId && command.messages?.[step.noEffectMessageId]) ||
            command.arguments[0]?.messages?.noEffect,
        };
      case 'goToSceneById':
        return {
          type: 'goToSceneById',
          sceneId: step.sceneId,
        };
      case 'removeInventoryEntity':
        return {
          type: 'removeInventoryEntity',
          ref: step.ref,
        };
      case 'showText':
        return {
          type: 'showText',
          message: step.messageId ? command.messages?.[step.messageId] : step.text,
          params: step.params,
          paramsFromRefs: step.paramsFromRefs,
        };
      default:
        return null;
    }
  }

  private buildResponse(
    resultJson: string,
    envelopeJson: string,
    contextJson: string,
    scopeJson: string
  ): ParserResponse {
    const result = JSON.parse(resultJson) as ParserResult;
    const nlpDebug = this.nlpCascade.getLastDebugInfo();
    const coreDecisionJson = result.coreDecision ? JSON.stringify(result.coreDecision) : undefined;
    const peekMessages = this.game.console?.parserPeekEnabled
      ? [
          `[Parser peek] context=${contextJson}`,
          `[Parser peek] scope=${scopeJson}`,
          `[Parser peek] envelope=${envelopeJson}`,
          ...(coreDecisionJson ? [`[Parser peek] core=${coreDecisionJson}`] : []),
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
          `[Parser handoff] scope=${scopeJson}`,
          `[Parser handoff] envelope=${envelopeJson}`,
          ...(coreDecisionJson ? [`[Parser handoff] core=${coreDecisionJson}`] : []),
          `[Parser handoff] result=${resultJson}`,
        ],
      };
    }

    const clarification = result.outcomes.find(
      (outcome) => outcome.status === 'needs_clarification'
    );
    if (clarification) {
      const clarificationData = (clarification.data || {}) as Record<string, unknown>;
      const pendingArg =
        typeof clarificationData.pendingArg === 'string' ? clarificationData.pendingArg : undefined;
      const commandId =
        typeof clarificationData.commandId === 'string' ? clarificationData.commandId : undefined;
      const relation =
        typeof clarificationData.relation === 'string' ? clarificationData.relation : undefined;
      const nextPendingState =
        pendingArg && commandId
          ? {
              intent: 'custom' as const,
              question: clarification.message || this.game.text('parser.parse_unknown'),
              originalInput: this.extractRawInput(envelopeJson),
              pendingEnvelopeJson: envelopeJson,
              pendingArg,
              commandId,
            }
          : relation
            ? {
                intent: this.extractPendingIntent(envelopeJson),
                question: clarification.message || this.game.text('parser.parse_unknown'),
                originalInput: this.extractRawInput(envelopeJson),
                pendingEnvelopeJson: envelopeJson,
              }
            : {
                intent: this.extractPendingIntent(envelopeJson),
                question: clarification.message || this.game.text('parser.parse_unknown'),
                originalInput: this.extractRawInput(envelopeJson),
              };
      return {
        playerMessage: clarification.message || this.game.text('parser.parse_unknown'),
        nextPendingState,
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
          `[Parser handoff] scope=${scopeJson}`,
          `[Parser handoff] envelope=${envelopeJson}`,
          ...(coreDecisionJson ? [`[Parser handoff] core=${coreDecisionJson}`] : []),
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

  private extractPendingIntent(actionJson: string): 'look' | 'examine' | 'take' | 'open' | 'close' | 'goTo' {
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
          firstAction.type === 'openTarget' ||
          firstAction.type === 'closeTarget' ||
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
                  : firstAction.type === 'openTarget'
                    ? 'open'
                    : firstAction.type === 'closeTarget'
                      ? 'close'
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

  private buildPeekScopeSummary(scope: ParserScope): Record<string, unknown> {
    return {
      visible: scope.visible.map((entity) => entity.name),
      held: scope.held.map((entity) => entity.name),
      takable: scope.takable.map((entity) => entity.name),
      reachable: scope.reachable.map((entity) => entity.name),
      examinable: scope.examinable.map((entity) => entity.name),
      subscene: scope.subscene.map((entity) => entity.name),
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
