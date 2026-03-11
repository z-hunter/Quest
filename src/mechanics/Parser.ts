import type { GameActionOutcome } from '../core/GameActionTypes';

type ParserEntityContext = {
  id: string;
  type: string;
  title: string | null;
  description: string | null;
  interactions: string[];
};

type ParserInventoryItemContext = {
  id: string;
  title: string | null;
};

type ParserPendingState = {
  intent: 'take' | 'goTo';
  question: string;
  originalInput: string;
};

type ParserContext = {
  rawInput: string;
  normalizedInput: string;
  scene: {
    id: string;
    name: string;
    title: string | null;
    description: string | null;
  } | null;
  entities: ParserEntityContext[];
  inventory: ParserInventoryItemContext[];
  pending: ParserPendingState | null;
};

type ParserToolAction =
  | {
      type: 'callGameMethod';
      method: 'look' | 'take' | 'showInventory' | 'goTo';
      args: Array<string | null>;
    }
  | {
      type: 'handoff';
      reason: string;
      verb: string;
      noun: string;
      rawInput: string;
    };

type ParserActionEnvelope = {
  stage: 'regex-v1' | 'pending-resolution';
  actions: ParserToolAction[];
  debug: {
    rawInput: string;
    normalizedInput: string;
    verb: string;
    noun: string;
    pendingIntent?: string;
  };
};

type ParserResult =
  | {
      type: 'outcomes';
      handled: boolean;
      outcomes: GameActionOutcome[];
      actionsExecuted: string[];
    }
  | {
      type: 'handoff';
      handled: false;
      outcomes: GameActionOutcome[];
      actionsExecuted: string[];
      reason: string;
      debug: Record<string, unknown>;
    };

type ParserResponse = {
  playerMessage?: string;
  debugMessages?: string[];
  nextPendingState?: ParserPendingState | null;
};

const STAGE1_COMMAND_WORDS = new Set([
  'LOOK',
  'EXAMINE',
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

  constructor(game: any) {
    this.game = game;
    this.inputField = null;
    this.pendingState = null;
  }

  parse(input: string): void {
    const trimmed = input.trim();
    if (!trimmed) return;

    const actionEnvelope = this.resolvePendingAction(trimmed);
    const contextJson = this.buildContextJson(trimmed);
    const actionJson = actionEnvelope || this.runStage1(trimmed);
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
  }

  private buildContextJson(rawInput: string): string {
    const scene = this.game.sceneManager.currentScene;
    const normalizedInput = rawInput.trim().toUpperCase();

    const context: ParserContext = {
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
              interactions: Object.keys(entity.interactions || {}),
            }))
            .filter((entity: ParserEntityContext) => !!entity.title?.trim())
        : [],
      inventory: (this.game.inventory || [])
        .map((entity: any) => ({
          id: entity.name,
          title: this.game.textAssets.getResolvedObjectField(entity, 'title'),
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

    return JSON.stringify(context);
  }

  private resolvePendingAction(input: string): string | null {
    if (!this.pendingState) return null;
    if (this.looksLikeFreshCommand(input)) {
      this.pendingState = null;
      return null;
    }

    const action: ParserToolAction = {
      type: 'callGameMethod',
      method: this.pendingState.intent,
      args: [input.trim()],
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
      case 'EXAMINE':
      case 'X':
        actions = [
          {
            type: 'callGameMethod',
            method: 'look',
            args: [
              !normalizedNoun ||
              normalizedNoun === 'AROUND' ||
              normalizedNoun === 'HERE' ||
              normalizedNoun === 'SCENE'
                ? null
                : noun,
            ],
          },
        ];
        break;
      case 'TAKE':
      case 'GET':
      case 'PICKUP':
        actions = [{ type: 'callGameMethod', method: 'take', args: [noun || null] }];
        break;
      case 'INV':
      case 'INVENTORY':
      case 'I':
        actions = [{ type: 'callGameMethod', method: 'showInventory', args: [] }];
        break;
      case 'GO':
      case 'WALK':
      case 'MOVE': {
        let target = noun;
        if (target.toUpperCase().startsWith('TO ')) {
          target = target.slice(3).trim();
        }
        actions = [{ type: 'callGameMethod', method: 'goTo', args: [target || null] }];
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

      executedActions.push(action.method);
      const outcome = this.callGameMethod(action.method, action.args);
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

  private callGameMethod(
    method: 'look' | 'take' | 'showInventory' | 'goTo',
    args: Array<string | null>
  ): GameActionOutcome {
    switch (method) {
      case 'look':
        return this.game.look(args[0] || null);
      case 'take':
        return this.game.take(args[0] || null);
      case 'showInventory':
        return this.game.showInventory();
      case 'goTo':
        return this.game.goTo(args[0] || null);
      default:
        return {
          status: 'escalate',
          code: 'unknown_game_method',
          message: this.game.text('parser.parse_unknown'),
          recoverable: false,
        };
    }
  }

  private buildResponse(
    resultJson: string,
    actionJson: string,
    contextJson: string
  ): ParserResponse {
    const result = JSON.parse(resultJson) as ParserResult;
    const peekMessages = this.game.console?.parserPeekEnabled
      ? [
          `[Parser peek] context=${contextJson}`,
          `[Parser peek] actions=${actionJson}`,
          `[Parser peek] result=${resultJson}`,
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

    const clarification = result.outcomes.find((outcome) => outcome.status === 'needs_clarification');
    if (clarification) {
      return {
        playerMessage: clarification.message || this.game.text('parser.parse_unknown'),
        nextPendingState: {
          intent: clarification.code === 'missing_destination' ? 'goTo' : 'take',
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

    const finalOutcomeWithMessage = [...result.outcomes].reverse().find((outcome) => !!outcome.message);
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

  private looksLikeFreshCommand(input: string): boolean {
    const trimmed = input.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('#') || trimmed.startsWith('-')) return true;
    const firstWord = trimmed.split(/\s+/)[0]?.toUpperCase() || '';
    return STAGE1_COMMAND_WORDS.has(firstWord);
  }
}
