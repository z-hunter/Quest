import type { GameActionOutcome } from '../core/GameActionTypes';
import { NlpCascade } from './NlpCascade';
import { matchParserCommandSpec } from './parserCommands';
import {
  extractPutCommand,
  extractTakeCommand,
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
import {
  buildSceneTextLayerSnapshot,
  getInactiveSubsceneAncestors,
  getSceneTextLayerAccessState,
  getSceneTextRelationDescendants,
} from '../scene/SceneTextLayer';
import type {
  ParserCascadeEnvelope,
  ParserClarificationOption,
  ParserClarificationScope,
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
  pendingClarificationRetryMessage: string | null;

  constructor(game: any) {
    this.game = game;
    this.inputField = null;
    this.pendingState = null;
    this.nlpCascade = new NlpCascade(
      () => this.game.textAssets,
      () => this.game.console
    );
    this.worldModelBuilder = new ParserWorldModelBuilder(this.game);
    this.activeWorldModel = null;
    this.activeScope = null;
    this.pendingClarificationRetryMessage = null;
  }

  async parse(input: string): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed) return;
    try {
      this.nlpCascade.clearLastDebugInfo();
      const actionEnvelope = this.resolvePendingAction(trimmed);
      if (this.pendingClarificationRetryMessage) {
        const retryMessage = this.pendingClarificationRetryMessage;
        this.pendingClarificationRetryMessage = null;
        this.game.log(retryMessage);
        return;
      }
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

      if (response.playerMessages?.length) {
        for (const message of response.playerMessages) {
          this.game.log(message);
        }
      } else if (response.playerMessage) {
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
      if (action.type === 'takeTarget') return { ...action, target: label };
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
      const matches = this.findPluralAwareMatchesInCandidates(groupQuery.query, candidates);
      if (!matches.length) {
        return [
          {
            type: 'takeTarget',
            target: groupQuery.query,
            anchor: rawAnchor,
            relation,
          },
        ];
      }
      if (groupQuery.kind === 'both' && matches.length !== 2) {
        if (matches.length > 1) {
          return [
            this.buildTakeTargetAction(
              this.singularizeSimplePluralQuery(groupQuery.query),
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
      const matches = this.findPluralAwareMatchesInCandidates(groupQuery.query, candidates);
      if (!matches.length) {
        return [this.buildPutTargetAction(groupQuery.query, rawTarget, relation)];
      }
      if (groupQuery.kind === 'both' && matches.length !== 2) {
        return [
          this.buildPutTargetAction(
            this.singularizeSimplePluralQuery(groupQuery.query),
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
      if (!query) return null;
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
        if (!this.hasClosableView()) {
          return {
            stage: 'regex-v1',
            output: {
              kind: 'handoff_up',
              reason: 'quit_not_applicable',
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
        return {
          stage: 'regex-v1',
          output: {
            kind: 'plan',
            actions: [{ type: 'quitCurrentView' }],
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
        return this.resolveTakeTarget(
          action.target,
          action.anchor || null,
          action.relation || null
        );
      case 'parserFailure':
        return {
          status: 'failed',
          code: action.code,
          message: action.message,
          recoverable: true,
        };
      case 'putTarget':
        return this.resolvePutTarget(action.item, action.target, action.relation);
      case 'openTarget':
        return this.resolveOpenCloseTarget('open', action.target);
      case 'closeTarget':
        return this.resolveOpenCloseTarget('close', action.target);
      case 'quitCurrentView':
        return this.game.closeFocusedView();
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
      case 'parserFailure':
        return 'parserFailure';
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

  private resolveSemanticHiddenTarget(
    rawTarget: string,
    allowedModes: Array<'lookable' | 'examinable'>
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
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return { status: 'not_found' };

    const candidates = [...scene.entities, ...scene.triggerboxes].filter(
      (sceneObject: SceneObject) => {
        const title = this.getPlayerFacingObjectTitle(sceneObject);
        if (!title) return false;
        const accessState = getSceneTextLayerAccessState(scene, this.game, sceneObject);
        return (
          accessState.hidden &&
          !!accessState.hiddenReason &&
          allowedModes.includes(accessState.hiddenReason as 'lookable' | 'examinable')
        );
      }
    );

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
      const semanticHiddenResolved = this.resolveSemanticHiddenTarget(rawTarget, ['lookable']);
      if (semanticHiddenResolved.status === 'found') {
        return this.game.lookEntity(semanticHiddenResolved.entity as any);
      }
      if (semanticHiddenResolved.status === 'ambiguous') {
        return {
          status: 'needs_clarification',
          code: 'ambiguous_look_target',
          message: semanticHiddenResolved.message,
          data: {
            target: rawTarget,
            options: semanticHiddenResolved.options,
            clarificationOptions: this.withClarificationScope(
              semanticHiddenResolved.clarificationOptions,
              'source'
            ),
          },
          recoverable: true,
        };
      }
      if (semanticHiddenResolved.status === 'escalate') {
        return { status: 'escalate', code: semanticHiddenResolved.code, recoverable: true };
      }
      const inactiveSwitchResolved = this.resolveInactiveSubsceneSwitchTarget(rawTarget);
      if (inactiveSwitchResolved.status === 'found') {
        return this.game.lookEntity(inactiveSwitchResolved.entity as any);
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
      const semanticHiddenResolved = this.resolveSemanticHiddenTarget(rawTarget, [
        'lookable',
        'examinable',
      ]);
      if (semanticHiddenResolved.status === 'found') {
        return this.game.examineEntity(semanticHiddenResolved.entity as any);
      }
      if (semanticHiddenResolved.status === 'ambiguous') {
        return {
          status: 'needs_clarification',
          code: 'ambiguous_examine_target',
          message: semanticHiddenResolved.message,
          data: {
            target: rawTarget,
            options: semanticHiddenResolved.options,
            clarificationOptions: this.withClarificationScope(
              semanticHiddenResolved.clarificationOptions,
              'source'
            ),
          },
          recoverable: true,
        };
      }
      if (semanticHiddenResolved.status === 'escalate') {
        return { status: 'escalate', code: semanticHiddenResolved.code, recoverable: true };
      }
      const hiddenGatedResolved = this.resolveHiddenSwitchGatedTarget(rawTarget);
      if (hiddenGatedResolved.status === 'found') {
        return this.game.examineEntity(hiddenGatedResolved.entity as any);
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

    return this.game.describeSpatialRelation(resolved.node.id, relation);
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
      const scopedResolved = this.resolveEntityTargetInCandidates(
        rawTarget,
        this.filterCurrentlyTakeableCandidates(scopedCandidates),
        'parser.take_which_one'
      );
      const broadScopedResolved =
        scopedResolved.status === 'not_found'
          ? this.resolveEntityTargetInCandidates(
              rawTarget,
              scopedCandidates,
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
        return this.game.takeEntity(scopedResolved.entity as Entity);
      }
      if (scopedResolved.status === 'not_found') {
        if (broadScopedResolved?.status === 'ambiguous') {
          const failure = this.resolveFailedTakeDiagnostic(rawTarget, scopedCandidates);
          if (failure) return failure;
        }
        if (broadScopedResolved?.status === 'found') {
          return this.resolveTakeFailureForKnownEntity(broadScopedResolved.entity as Entity);
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
    const resolved = this.resolveEntityTargetInCandidates(
      rawTarget,
      takableCandidates,
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
        const failure = this.resolveFailedTakeDiagnostic(
          rawTarget,
          this.getScopeCandidates(['visible'])
        );
        if (failure) return failure;
      }
      if (broadResolved?.status === 'found') {
        return this.resolveTakeFailureForKnownEntity(broadResolved.entity as Entity);
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
        return this.game.takeEntity(hiddenGatedResolved.entity as Entity);
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
    return this.game.takeEntity(resolved.entity as Entity);
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
    candidates: SceneObject[]
  ): GameActionOutcome | null {
    const matches = this.findResolutionMatchesInCandidates(rawTarget, candidates).filter(
      (candidate): candidate is Entity =>
        candidate instanceof Entity && !this.game.inventory.includes(candidate)
    );
    if (!matches.length) return null;

    const preferred = (this.choosePreferredObject(matches) || matches[0]) as Entity;
    return this.resolveTakeFailureForKnownEntity(preferred);
  }

  private resolveTakeFailureForKnownEntity(entity: Entity): GameActionOutcome {
    const canTakeOutcome = (this.game as any).canTakeEntity?.(entity);
    if (canTakeOutcome) return canTakeOutcome;

    if (this.game.inventory.includes(entity)) {
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

    return this.game.takeEntity(entity);
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
      const canTakeOutcome = (this.game as any).canTakeEntity?.(candidate);
      return !canTakeOutcome;
    });
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
        const scene = this.game.sceneManager.currentScene;
        const distanceError = scene
          ? ComponentSystem.getInteractionDistanceError(
              preResolvedTarget.entity as any,
              scene.player
            )
          : null;
        if (distanceError) {
          return {
            status: 'failed',
            code: 'put_target_too_far',
            message: distanceError,
            data: { target: rawTarget, relation, item: rawItem },
            recoverable: true,
          };
        }
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
          const preferred = this.choosePreferredObject(sourceMatches);
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
      return {
        status: 'escalate',
        code: 'target_is_not_switch',
        recoverable: true,
      };
    }
    return intent === 'open'
      ? this.game.openEntity(entity as any)
      : this.game.closeEntity(entity as any);
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
      this.getScopeCandidates(['visible']).filter(
        (candidate): candidate is Entity => candidate instanceof Entity
      ),
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
          target: rawTarget,
          options: resolved.options,
          clarificationOptions: resolved.clarificationOptions,
        },
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
    scopeJson: string
  ): ParserResponse {
    const result = JSON.parse(resultJson) as ParserResult;
    const nlpDebug = this.nlpCascade.getLastDebugInfo();
    const coreDecision = result.coreDecision;

    const formatSection = (title: string, json: string | object) => {
      const obj = typeof json === 'string' ? JSON.parse(json) : json;
      return `--- ${title.toUpperCase()} ---\n${this.formatPeekObject(obj)}`;
    };

    const peekMessages = this.game.console?.parserPeekEnabled
      ? [
          formatSection('context', contextJson),
          formatSection('scope', scopeJson),
          formatSection('envelope', envelopeJson),
          ...(coreDecision ? [formatSection('core', coreDecision)] : []),
          formatSection('result', resultJson),
          ...(nlpDebug ? [formatSection('nlp', nlpDebug)] : []),
        ]
      : undefined;

    if (result.type === 'handoff') {
      return {
        playerMessage: this.game.text('parser.parse_unknown'),
        nextPendingState: null,
        debugMessages: peekMessages || [
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
      const pendingArg =
        typeof clarificationData.pendingArg === 'string' ? clarificationData.pendingArg : undefined;
      const commandId =
        typeof clarificationData.commandId === 'string' ? clarificationData.commandId : undefined;
      const relation =
        typeof clarificationData.relation === 'string' ? clarificationData.relation : undefined;
      const clarificationOptions = this.parseClarificationOptionsFromData(clarificationData);
      const clarificationAllowsMultiple = this.isMultiSourceClarification(clarification.code);
      const nextPendingState =
        pendingArg && commandId
          ? {
              intent: 'custom' as const,
              question: clarification.message || this.game.text('parser.parse_unknown'),
              originalInput: this.extractRawInput(envelopeJson),
              pendingEnvelopeJson: envelopeJson,
              pendingArg,
              commandId,
              clarificationOptions,
              clarificationAllowsMultiple,
            }
          : relation
            ? {
                intent: this.extractPendingIntent(envelopeJson),
                question: clarification.message || this.game.text('parser.parse_unknown'),
                originalInput: this.extractRawInput(envelopeJson),
                pendingEnvelopeJson: envelopeJson,
                clarificationOptions,
                clarificationAllowsMultiple,
              }
            : {
                intent: this.extractPendingIntent(envelopeJson),
                question: clarification.message || this.game.text('parser.parse_unknown'),
                originalInput: this.extractRawInput(envelopeJson),
                pendingEnvelopeJson: envelopeJson,
                clarificationOptions,
                clarificationAllowsMultiple,
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
        debugMessages: peekMessages,
      };
    }

    return {
      playerMessage: outcomeMessages.length === 1 ? outcomeMessages[0] : undefined,
      playerMessages: outcomeMessages.length > 1 ? outcomeMessages : undefined,
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
