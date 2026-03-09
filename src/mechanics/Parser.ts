import { ScriptRegistry } from '../core/ScriptRegistry';
import { ComponentSystem } from '../systems/ComponentSystem';

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
};

type ParserAction =
  | { type: 'lookScene' }
  | { type: 'lookEntity'; target: string }
  | { type: 'takeEntity'; target: string | null }
  | { type: 'showInventory' }
  | { type: 'handoff'; reason: string; verb: string; noun: string; rawInput: string };

type ParserActionEnvelope = {
  stage: 'regex-v1';
  actions: ParserAction[];
  debug: {
    rawInput: string;
    normalizedInput: string;
    verb: string;
    noun: string;
  };
};

type ParserResult =
  | {
      type: 'message';
      handled: true;
      messages: string[];
      actionsExecuted: string[];
    }
  | {
      type: 'scriptDelegated';
      handled: true;
      messages: string[];
      actionsExecuted: string[];
      delegatedScriptId: string;
    }
  | {
      type: 'handoff';
      handled: false;
      messages: string[];
      actionsExecuted: string[];
      reason: string;
      debug: Record<string, unknown>;
    };

type ParserResponse = {
  playerMessage?: string;
  debugMessages?: string[];
};

export class Parser {
  game: any;
  inputField: HTMLInputElement | null;

  constructor(game: any) {
    this.game = game;
    this.inputField = null;
  }

  parse(input: string): void {
    const trimmed = input.trim();
    if (!trimmed) return;

    const contextJson = this.buildContextJson(trimmed);
    const actionJson = this.runStage1(trimmed, contextJson);
    const resultJson = this.executeActionJson(actionJson, contextJson);
    const response = this.buildResponse(resultJson, actionJson, contextJson);

    if (response.playerMessage) {
      this.game.log(response.playerMessage);
    }

    if (response.debugMessages?.length) {
      for (const message of response.debugMessages) {
        this.game.console?.log(message, 'info');
      }
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
    };

    return JSON.stringify(context);
  }

  private runStage1(input: string, _contextJson: string): string {
    const words = input.trim().split(/\s+/);
    const verb = (words[0] || '').toUpperCase();
    const noun = words.slice(1).join(' ').trim();
    const normalizedNoun = noun.toUpperCase();

    let actions: ParserAction[];

    switch (verb) {
      case 'LOOK':
      case 'EXAMINE':
      case 'X':
        if (
          !normalizedNoun ||
          normalizedNoun === 'AROUND' ||
          normalizedNoun === 'HERE' ||
          normalizedNoun === 'SCENE'
        ) {
          actions = [{ type: 'lookScene' }];
        } else {
          actions = [{ type: 'lookEntity', target: noun }];
        }
        break;
      case 'TAKE':
      case 'GET':
      case 'PICKUP':
        actions = [{ type: 'takeEntity', target: noun || null }];
        break;
      case 'INV':
      case 'INVENTORY':
      case 'I':
        actions = [{ type: 'showInventory' }];
        break;
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

  private executeActionJson(actionJson: string, _contextJson: string): string {
    const envelope = JSON.parse(actionJson) as ParserActionEnvelope;
    const scene = this.game.sceneManager.currentScene;
    const executedActions: string[] = [];

    if (!scene) {
      const result: ParserResult = {
        type: 'handoff',
        handled: false,
        messages: [],
        actionsExecuted: executedActions,
        reason: 'no_current_scene',
        debug: { actionJson },
      };
      return JSON.stringify(result);
    }

    const firstAction = envelope.actions[0];
    if (!firstAction) {
      const result: ParserResult = {
        type: 'handoff',
        handled: false,
        messages: [],
        actionsExecuted: executedActions,
        reason: 'empty_action_plan',
        debug: { actionJson },
      };
      return JSON.stringify(result);
    }

    switch (firstAction.type) {
      case 'lookScene': {
        executedActions.push('lookScene');
        const sceneDescription =
          this.game.textAssets.getResolvedSceneField(scene, 'description') ||
          scene.description ||
          this.game.text('parser.look_default_scene', { scene: scene.name });
        const result: ParserResult = {
          type: 'message',
          handled: true,
          messages: [sceneDescription],
          actionsExecuted: executedActions,
        };
        return JSON.stringify(result);
      }
      case 'lookEntity': {
        executedActions.push('lookEntity');
        const entity = scene.findEntity(firstAction.target);
        if (!entity) {
          const result: ParserResult = {
            type: 'message',
            handled: true,
            messages: [this.game.text('parser.look_not_found', { target: firstAction.target })],
            actionsExecuted: executedActions,
          };
          return JSON.stringify(result);
        }

        const interactionId =
          entity.interactions && (entity.interactions.look || entity.interactions.LOOK);
        if (interactionId) {
          ScriptRegistry.execute(interactionId, { game: this.game, entity });
          const result: ParserResult = {
            type: 'scriptDelegated',
            handled: true,
            messages: [],
            actionsExecuted: executedActions,
            delegatedScriptId: interactionId,
          };
          return JSON.stringify(result);
        }

        const description =
          this.game.textAssets.getResolvedObjectField(entity, 'description') || entity.description;
        const result: ParserResult = {
          type: 'message',
          handled: true,
          messages: [
            description ||
              this.game.text('parser.look_default_object', { target: firstAction.target }),
          ],
          actionsExecuted: executedActions,
        };
        return JSON.stringify(result);
      }
      case 'takeEntity': {
        executedActions.push('takeEntity');
        if (!firstAction.target) {
          const result: ParserResult = {
            type: 'message',
            handled: true,
            messages: [this.game.text('parser.take_prompt')],
            actionsExecuted: executedActions,
          };
          return JSON.stringify(result);
        }

        const entity = scene.findEntity(firstAction.target);
        if (!entity) {
          const result: ParserResult = {
            type: 'message',
            handled: true,
            messages: [this.game.text('parser.look_not_found', { target: firstAction.target })],
            actionsExecuted: executedActions,
          };
          return JSON.stringify(result);
        }

        const interactionId =
          entity.interactions && (entity.interactions.pickup || entity.interactions.PICKUP);
        if (interactionId) {
          ScriptRegistry.execute(interactionId, { game: this.game, entity });
          const result: ParserResult = {
            type: 'scriptDelegated',
            handled: true,
            messages: [],
            actionsExecuted: executedActions,
            delegatedScriptId: interactionId,
          };
          return JSON.stringify(result);
        }

        const errorMsg = ComponentSystem.canTakeItem(entity, scene.player);
        if (errorMsg) {
          const result: ParserResult = {
            type: 'message',
            handled: true,
            messages: [errorMsg],
            actionsExecuted: executedActions,
          };
          return JSON.stringify(result);
        }

        const isItem = entity.components && entity.components.find((c: any) => c.type === 'Item');
        if (isItem || entity.isTakeable) {
          scene.removeEntity(entity);
          this.game.inventory.push(entity);
          const result: ParserResult = {
            type: 'message',
            handled: true,
            messages: [
              this.game.text('parser.take_pickup_success', {
                item: entity.customName || entity.name,
              }),
            ],
            actionsExecuted: executedActions,
          };
          return JSON.stringify(result);
        }

        const result: ParserResult = {
          type: 'message',
          handled: true,
          messages: [this.game.text('parser.take_cannot')],
          actionsExecuted: executedActions,
        };
        return JSON.stringify(result);
      }
      case 'showInventory': {
        executedActions.push('showInventory');
        const result: ParserResult = {
          type: 'message',
          handled: true,
          messages:
            this.game.inventory.length === 0
              ? [this.game.text('parser.inventory_empty')]
              : [
                  this.game.text('parser.inventory_items', {
                    items: this.game.inventory.map((e: any) => e.customName || e.name).join(', '),
                  }),
                ],
          actionsExecuted: executedActions,
        };
        return JSON.stringify(result);
      }
      case 'handoff':
      default: {
        const result: ParserResult = {
          type: 'handoff',
          handled: false,
          messages: [],
          actionsExecuted: executedActions,
          reason: firstAction.type === 'handoff' ? firstAction.reason : 'unsupported_action_type',
          debug: {
            actionJson,
            action: firstAction,
          },
        };
        return JSON.stringify(result);
      }
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

    if (result.type === 'message') {
      return {
        playerMessage: result.messages[0],
        debugMessages: peekMessages,
      };
    }

    if (result.type === 'scriptDelegated') {
      return result.messages.length > 0
        ? { playerMessage: result.messages[0], debugMessages: peekMessages }
        : { debugMessages: peekMessages };
    }

    return {
      playerMessage: this.game.text('parser.parse_unknown'),
      debugMessages: peekMessages || [
        `[Parser handoff] context=${contextJson}`,
        `[Parser handoff] actions=${actionJson}`,
        `[Parser handoff] result=${resultJson}`,
      ],
    };
  }
}
