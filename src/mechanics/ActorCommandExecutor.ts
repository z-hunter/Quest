import type { GameActionOutcome } from '../core/GameActionTypes';
import type { IGame } from '../core/IGame';
import { ScriptRegistry } from '../core/ScriptRegistry';
import { Actor } from '../entities/Actor';
import { Entity } from '../entities/Entity';
import type { SceneObject } from '../entities/SceneObject';
import { ComponentSystem, type StateValue } from '../systems/ComponentSystem';
import { StateEventSystem } from '../systems/StateEventSystem';
import type {
  ParserCommandActionSpec,
  ParserCommandArgumentValidation,
  ParserCommandSpec,
  ParserScopeSlice,
} from './parserTypes';

type ActorCommandPlanState = Record<string, Entity | string | undefined>;

export type ActorCommandOutcome = GameActionOutcome & {
  displayMessages?: string[];
};

export type ActorUseOutcome = ActorCommandOutcome;

export type ActorCommandAffordance = {
  id: string;
  label: string;
  requires?: Array<{ entityId: string; scope: string }>;
  effects?: Array<{ type: string; stateId?: string; value?: StateValue }>;
};

export class ActorCommandExecutor {
  private readonly game: IGame;

  constructor(game: IGame) {
    this.game = game;
  }

  executeCommand(
    actor: Actor,
    commandId: string,
    argumentsByName: Record<string, string | null> = {}
  ): ActorCommandOutcome {
    const command = this.game.textAssets
      .getParserCommands()
      .find((candidate) => candidate.id === commandId);
    if (!command || command.id === 'use_on') {
      return {
        status: 'failed',
        code: 'actor_command_not_found',
        data: { commandId },
        recoverable: true,
      };
    }

    const state: ActorCommandPlanState = {};
    const displayMessages: string[] = [];
    for (const step of command.plan) {
      const outcome = this.executeCommandStep(actor, command, step, argumentsByName, state);
      if (outcome.displayMessages?.length) {
        displayMessages.push(...outcome.displayMessages);
      }
      if (outcome.status !== 'ok') {
        return { ...outcome, displayMessages };
      }
    }

    return {
      status: 'ok',
      code: 'actor_command_executed',
      data: { commandId },
      effects: ['actor_command_executed'],
      displayMessages,
    };
  }

  useItemOn(actor: Actor, itemId: string, targetId: string): ActorUseOutcome {
    const scene = this.game.sceneManager.currentScene;
    const item = scene?.getObjectByName(itemId);
    const target = scene?.getObjectByName(targetId);
    if (!(item instanceof Entity)) {
      return {
        status: 'failed',
        code: 'use_item_not_found',
        data: { itemId, targetId },
        recoverable: true,
      };
    }
    if (!target) {
      return {
        status: 'failed',
        code: 'use_target_not_found',
        data: { itemId, targetId },
        recoverable: true,
      };
    }
    if (!this.isEntityInActorInventory(actor, item) && !this.isReachable(actor, item)) {
      return {
        status: 'failed',
        code: 'use_item_unavailable',
        message: this.game.text('parser.command_no_effect'),
        data: { itemId, targetId },
        recoverable: true,
      };
    }
    if (
      !(target instanceof Entity && this.isEntityInActorInventory(actor, target)) &&
      !this.isReachable(actor, target)
    ) {
      return {
        status: 'failed',
        code: 'use_target_unreachable',
        message: ComponentSystem.getInteractionDistanceError(target, actor) || undefined,
        data: { itemId, targetId },
        recoverable: true,
      };
    }

    const interactionId =
      target.interactions?.USE ||
      target.interactions?.use ||
      target.interactions?.[`USE:${item.name}`] ||
      target.interactions?.[`use:${item.name}`];
    if (interactionId) {
      if (!ScriptRegistry.has(interactionId)) {
        return {
          status: 'failed',
          code: 'use_script_not_found',
          data: { itemId, targetId, scriptId: interactionId },
          recoverable: true,
        };
      }
      ScriptRegistry.execute(interactionId, {
        game: this.game,
        entity: target,
        args: { actorId: actor.name, itemId: item.name, targetId: target.name },
      });
      return {
        status: 'ok',
        code: 'use_script_executed',
        data: { itemId, targetId, scriptId: interactionId },
        effects: ['script_started'],
      };
    }

    return {
      status: 'failed',
      code: 'use_no_effect',
      message: this.game.text('parser.command_no_effect'),
      data: { itemId, targetId },
      recoverable: true,
    };
  }

  getAffordancesForEntity(entity: SceneObject): ActorCommandAffordance[] {
    const commands = this.game.textAssets.getParserCommands();
    return commands
      .filter((command) => command.id !== 'use_on' && this.commandTargetsEntity(command, entity))
      .map((command) => this.buildAffordance(command, entity));
  }

  private executeCommandStep(
    actor: Actor,
    command: ParserCommandSpec,
    step: ParserCommandActionSpec,
    argumentsByName: Record<string, string | null>,
    state: ActorCommandPlanState
  ): ActorCommandOutcome {
    switch (step.type) {
      case 'resolveArgumentEntity':
        return this.resolveArgumentEntity(actor, command, step, argumentsByName, state);
      case 'ensureHeldEntity':
        return this.ensureHeldEntity(actor, command, step, state);
      case 'removeInventoryEntity':
        return this.removeInventoryEntity(actor, step, state);
      case 'showText':
        return this.captureShowText(command, step, state);
      case 'requireEntityAvailable':
        return this.requireEntityAvailable(actor, command, step, state);
      case 'requireAnyEntityAvailable':
        return this.requireAnyEntityAvailable(actor, command, step, state);
      case 'setEntityState':
        return this.setEntityState(command, step);
      case 'setGroupDisabled':
        return this.setGroupDisabled(step);
      case 'runScript':
        return this.runScript(step);
      case 'stopScript':
        return this.stopScript(step);
      case 'goToSceneById':
        return {
          status: 'failed',
          code: 'actor_command_go_to_scene_unsupported',
          data: { commandId: command.id, sceneId: step.sceneId },
          recoverable: true,
        };
      default:
        return {
          status: 'failed',
          code: 'actor_command_step_unsupported',
          data: { commandId: command.id },
          recoverable: true,
        };
    }
  }

  private resolveArgumentEntity(
    actor: Actor,
    command: ParserCommandSpec,
    step: Extract<ParserCommandActionSpec, { type: 'resolveArgumentEntity' }>,
    argumentsByName: Record<string, string | null>,
    state: ActorCommandPlanState
  ): ActorCommandOutcome {
    const argSpec = command.arguments.find((arg) => arg.name === step.arg);
    const query = argumentsByName[step.arg];
    if (!argSpec || !query) {
      return {
        status: 'failed',
        code: 'actor_command_missing_argument',
        data: { commandId: command.id, arg: step.arg },
        recoverable: true,
      };
    }
    const entity = this.getScopeCandidates(actor, argSpec.scopes).find(
      (candidate) => candidate.name === query
    );
    if (!(entity instanceof Entity)) {
      return {
        status: 'failed',
        code: 'actor_command_target_not_found',
        data: { commandId: command.id, arg: step.arg, query },
        recoverable: true,
      };
    }
    if (!this.isEntityValidForCommandArgument(entity, argSpec.validation)) {
      return {
        status: 'failed',
        code: 'actor_command_invalid_argument',
        data: { commandId: command.id, arg: step.arg, entityId: entity.name },
        recoverable: true,
      };
    }
    state[step.saveAs] = entity;
    return {
      status: 'ok',
      code: 'argument_resolved',
      data: { commandId: command.id, arg: step.arg, entityId: entity.name },
    };
  }

  private ensureHeldEntity(
    actor: Actor,
    command: ParserCommandSpec,
    step: Extract<ParserCommandActionSpec, { type: 'ensureHeldEntity' }>,
    state: ActorCommandPlanState
  ): ActorCommandOutcome {
    const entity = state[step.ref];
    if (!(entity instanceof Entity)) {
      return {
        status: 'failed',
        code: 'missing_plan_entity_ref',
        data: { commandId: command.id, ref: step.ref },
        recoverable: true,
      };
    }
    if (this.isEntityInActorInventory(actor, entity)) {
      return {
        status: 'ok',
        code: 'entity_already_held',
        data: { commandId: command.id, entityId: entity.name },
      };
    }
    return {
      status: 'failed',
      code: 'actor_command_auto_take_unsupported',
      data: { commandId: command.id, entityId: entity.name },
      recoverable: true,
    };
  }

  private removeInventoryEntity(
    actor: Actor,
    step: Extract<ParserCommandActionSpec, { type: 'removeInventoryEntity' }>,
    state: ActorCommandPlanState
  ): ActorCommandOutcome {
    const entity = state[step.ref];
    if (!(entity instanceof Entity)) {
      return { status: 'failed', code: 'missing_plan_entity_ref', recoverable: true };
    }
    return this.game.inventoryManager.removeEntityFromInventory(actor, entity, 'in');
  }

  private requireEntityAvailable(
    actor: Actor,
    command: ParserCommandSpec,
    step: Extract<ParserCommandActionSpec, { type: 'requireEntityAvailable' }>,
    state: ActorCommandPlanState
  ): ActorCommandOutcome {
    const entity = this.getScopeCandidates(actor, step.scopes).find(
      (candidate) => candidate.name === step.entityId
    );
    if (!entity) {
      return {
        status: 'failed',
        code: 'custom_command_required_entity_missing',
        message:
          (step.missingMessageId && command.messages?.[step.missingMessageId]) ||
          step.missingMessage ||
          this.game.text('parser.look_not_found', { target: step.entityId }),
        data: { commandId: command.id, entityId: step.entityId, scopes: step.scopes },
        recoverable: true,
      };
    }
    if (step.saveAs) state[step.saveAs] = entity as Entity;
    return {
      status: 'ok',
      code: 'required_entity_available',
      data: { commandId: command.id, entityId: entity.name, scopes: step.scopes },
    };
  }

  private requireAnyEntityAvailable(
    actor: Actor,
    command: ParserCommandSpec,
    step: Extract<ParserCommandActionSpec, { type: 'requireAnyEntityAvailable' }>,
    state: ActorCommandPlanState
  ): ActorCommandOutcome {
    for (const option of step.options) {
      const entity = this.getScopeCandidates(actor, option.scopes).find(
        (candidate) => candidate.name === option.entityId
      );
      if (!entity) continue;
      if (step.saveAs) state[step.saveAs] = option.saveAsValue || entity.name;
      return {
        status: 'ok',
        code: 'required_entity_available',
        data: {
          commandId: command.id,
          entityId: entity.name,
          scopes: option.scopes,
          matchedValue: option.saveAsValue,
        },
      };
    }
    return {
      status: 'failed',
      code: 'custom_command_required_entity_missing',
      message:
        (step.missingMessageId && command.messages?.[step.missingMessageId]) ||
        step.missingMessage ||
        this.game.text('parser.command_no_effect'),
      data: {
        commandId: command.id,
        options: step.options.map((option) => ({
          entityId: option.entityId,
          scopes: option.scopes,
        })),
      },
      recoverable: true,
    };
  }

  private setEntityState(
    command: ParserCommandSpec,
    step: Extract<ParserCommandActionSpec, { type: 'setEntityState' }>
  ): ActorCommandOutcome {
    const scene = this.game.sceneManager.currentScene;
    const entity = scene?.getObjectByName(step.entityId);
    if (!entity) {
      return {
        status: 'failed',
        code: 'state_target_not_found',
        message:
          (step.missingMessageId && command.messages?.[step.missingMessageId]) ||
          step.missingMessage ||
          this.game.text('parser.look_not_found', { target: step.entityId }),
        data: { commandId: command.id, entityId: step.entityId, stateId: step.stateId },
        recoverable: true,
      };
    }
    const component = ComponentSystem.getStateComponent(entity, step.stateId);
    if (!component || !ComponentSystem.isStateValueOfType(step.value, component.valueType)) {
      return {
        status: 'failed',
        code: 'state_not_set',
        message:
          (step.missingMessageId && command.messages?.[step.missingMessageId]) ||
          step.missingMessage ||
          this.game.text('parser.command_no_effect'),
        data: {
          commandId: command.id,
          entityId: step.entityId,
          stateId: step.stateId,
          expectedType: component?.valueType,
        },
        recoverable: true,
      };
    }
    const result = StateEventSystem.setState(
      this.game,
      entity,
      step.stateId,
      step.value,
      'actor-command'
    );
    if (!result.ok) {
      return {
        status: 'failed',
        code: 'state_not_set',
        data: { commandId: command.id, entityId: step.entityId, stateId: step.stateId },
        recoverable: true,
      };
    }
    return {
      status: 'ok',
      code: 'entity_state_set',
      data: {
        commandId: command.id,
        entityId: step.entityId,
        stateId: step.stateId,
        value: step.value,
        changed: result.changed,
        dispatchedScripts: result.dispatchedScripts,
      },
      effects: ['entity_state_changed'],
    };
  }

  private setGroupDisabled(
    step: Extract<ParserCommandActionSpec, { type: 'setGroupDisabled' }>
  ): ActorCommandOutcome {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return { status: 'failed', code: 'no_current_scene', recoverable: false };
    const normalizedGroupId = String(step.groupId || '')
      .trim()
      .toLowerCase();
    const targets = scene
      .getAllSceneObjects()
      .filter((candidate) => this.objectHasGroupId(candidate, normalizedGroupId));
    targets.forEach((target) => {
      target.disabled = step.disabled;
    });
    return {
      status: 'ok',
      code: step.disabled ? 'group_disabled' : 'group_enabled',
      data: { groupId: normalizedGroupId, disabled: step.disabled, count: targets.length },
      effects: ['group_disabled_changed'],
    };
  }

  private runScript(
    step: Extract<ParserCommandActionSpec, { type: 'runScript' }>
  ): ActorCommandOutcome {
    if (!ScriptRegistry.has(step.scriptId)) {
      return {
        status: 'failed',
        code: 'script_not_found',
        data: { scriptId: step.scriptId },
        recoverable: true,
      };
    }
    if (step.restart && ScriptRegistry.isRunning(step.scriptId)) {
      ScriptRegistry.stop(step.scriptId);
    }
    if (!ScriptRegistry.isRunning(step.scriptId)) {
      ScriptRegistry.execute(step.scriptId, { game: this.game });
    }
    return {
      status: 'ok',
      code: 'script_started',
      data: { scriptId: step.scriptId, restart: !!step.restart },
      effects: ['script_started'],
    };
  }

  private stopScript(
    step: Extract<ParserCommandActionSpec, { type: 'stopScript' }>
  ): ActorCommandOutcome {
    const wasRunning = ScriptRegistry.isRunning(step.scriptId);
    ScriptRegistry.stop(step.scriptId);
    return {
      status: 'ok',
      code: 'script_stopped',
      data: { scriptId: step.scriptId, wasRunning },
      effects: ['script_stopped'],
    };
  }

  private captureShowText(
    command: ParserCommandSpec,
    step: Extract<ParserCommandActionSpec, { type: 'showText' }>,
    state: ActorCommandPlanState
  ): ActorCommandOutcome {
    const message = this.resolveShowText(command, step, state);
    return {
      status: 'ok',
      code: 'custom_message',
      message,
      displayMessages: message ? [message] : [],
    };
  }

  private resolveShowText(
    command: ParserCommandSpec,
    step: Extract<ParserCommandActionSpec, { type: 'showText' }>,
    state: ActorCommandPlanState
  ): string | undefined {
    let message = step.messageId ? command.messages?.[step.messageId] : step.text;
    if (step.messageIdByRef) {
      const refValue = state[step.messageIdByRef.ref];
      const key = typeof refValue === 'string' ? refValue : undefined;
      const mappedId = key ? step.messageIdByRef.values[key] : undefined;
      message =
        (mappedId ? command.messages?.[mappedId] || mappedId : undefined) ||
        (step.messageIdByRef.fallbackMessageId
          ? command.messages?.[step.messageIdByRef.fallbackMessageId]
          : undefined) ||
        message;
    }
    if (!message) return undefined;
    return message.replace(/\{([^}]+)\}/g, (_match, key) => {
      const param = step.params?.[key] || step.paramsFromRefs?.[key];
      if (!param) return `{${key}}`;
      const value = state[param];
      return value instanceof Entity ? this.getTitle(value) : String(value || `{${key}}`);
    });
  }

  private getScopeCandidates(actor: Actor, scopes: ParserScopeSlice[]): SceneObject[] {
    const scene = this.game.sceneManager.currentScene;
    if (!scene) return [];
    const candidates = new Map<string, SceneObject>();
    const add = (object: SceneObject | null | undefined) => {
      if (object && !object.disabled) candidates.set(object.name, object);
    };
    for (const scope of scopes) {
      if (scope === 'held') {
        for (const item of this.game.inventoryManager.getInventoryEntities(actor, 'in')) add(item);
      } else if (scope === 'visible' || scope === 'reachable' || scope === 'takable') {
        for (const object of scene.getAllSceneObjects()) {
          if (object === actor) continue;
          if (object.disabled) continue;
          if (scope === 'reachable' && !this.isReachable(actor, object)) continue;
          if (scope === 'takable' && !(object instanceof Entity)) continue;
          add(object);
        }
      }
    }
    return [...candidates.values()];
  }

  private isReachable(actor: Actor, object: SceneObject): boolean {
    if (object instanceof Entity && this.isEntityInActorInventory(actor, object)) return true;
    return !ComponentSystem.getInteractionDistanceError(object, actor);
  }

  private isEntityInActorInventory(actor: Actor, entity: Entity): boolean {
    return this.game.inventoryManager.hasInventoryEntity(actor, entity, 'in');
  }

  private isEntityValidForCommandArgument(
    entity: Entity,
    validation?: ParserCommandArgumentValidation
  ): boolean {
    if (!validation) return true;
    if (validation.allowedEntityIds?.length && !validation.allowedEntityIds.includes(entity.name)) {
      return false;
    }
    const title = this.getTitle(entity).toLowerCase();
    if (
      validation.allowedTitles?.length &&
      !validation.allowedTitles.some((candidate) => candidate.toLowerCase() === title)
    ) {
      return false;
    }
    return true;
  }

  private commandTargetsEntity(command: ParserCommandSpec, entity: SceneObject): boolean {
    const stateTargets = command.plan
      .filter(
        (step): step is Extract<ParserCommandActionSpec, { type: 'setEntityState' }> =>
          step.type === 'setEntityState'
      )
      .map((step) => step.entityId);
    if (stateTargets.length) return stateTargets.includes(entity.name);

    for (const step of command.plan) {
      if (step.type === 'requireEntityAvailable' && step.entityId === entity.name) return true;
      if (
        step.type === 'requireAnyEntityAvailable' &&
        step.options.some((option) => option.entityId === entity.name)
      ) {
        return true;
      }
    }
    return false;
  }

  private buildAffordance(command: ParserCommandSpec, entity: SceneObject): ActorCommandAffordance {
    const requires = new Map<string, { entityId: string; scope: string }>();
    const effects: ActorCommandAffordance['effects'] = [];
    for (const step of command.plan) {
      if (step.type === 'requireEntityAvailable' && step.entityId !== entity.name) {
        requires.set(step.entityId, {
          entityId: step.entityId,
          scope: this.compactScope(step.scopes),
        });
      }
      if (step.type === 'requireAnyEntityAvailable') {
        for (const option of step.options) {
          if (option.entityId === entity.name) continue;
          requires.set(option.entityId, {
            entityId: option.entityId,
            scope: this.compactScope(option.scopes),
          });
        }
      }
      if (step.type === 'setEntityState' && step.entityId === entity.name) {
        effects.push({ type: 'setEntityState', stateId: step.stateId, value: step.value });
      }
    }
    return {
      id: command.id,
      label: command.phrases[0] || command.id,
      ...(requires.size ? { requires: [...requires.values()] } : {}),
      ...(effects.length ? { effects } : {}),
    };
  }

  private compactScope(scopes: ParserScopeSlice[]): string {
    if (scopes.includes('held') && scopes.includes('reachable')) return 'held_or_reachable';
    return scopes.join('_or_');
  }

  private objectHasGroupId(object: SceneObject, normalizedGroupId: string): boolean {
    const groupIds = Array.isArray((object as any).groupIds) ? (object as any).groupIds : [];
    const legacyGroupId = (object as any).groupID;
    return [...groupIds, legacyGroupId].some(
      (groupId) =>
        String(groupId || '')
          .trim()
          .toLowerCase() === normalizedGroupId
    );
  }

  private getTitle(entity: SceneObject): string {
    return this.game.textAssets.getResolvedObjectField(entity, 'title') || entity.name;
  }
}
