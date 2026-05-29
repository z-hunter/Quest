import type { IGame } from '../core/IGame';
import { ScriptRegistry } from '../core/ScriptRegistry';
import type { SceneObject } from '../entities/SceneObject';
import { ComponentSystem, type StateValue, type StateValueType } from './ComponentSystem';

export type StateChangeSource = 'parser' | 'script-api' | 'llm' | 'custom-command' | string;

export type StateChangeResult =
  | {
      ok: true;
      changed: boolean;
      value: StateValue;
      previousValue: StateValue;
      valueType: StateValueType;
      dispatchedScripts: string[];
    }
  | {
      ok: false;
      reason: 'missing-state' | 'invalid-type';
      expectedType?: StateValueType;
    };

export class StateEventSystem {
  static setState(
    game: IGame,
    entity: SceneObject | null | undefined,
    stateId: string,
    value: StateValue,
    source: StateChangeSource = 'parser'
  ): StateChangeResult {
    const component = ComponentSystem.getStateComponent(entity, stateId);
    if (!component) {
      return { ok: false, reason: 'missing-state' };
    }

    if (!ComponentSystem.isStateValueOfType(value, component.valueType)) {
      return { ok: false, reason: 'invalid-type', expectedType: component.valueType };
    }

    const previousValue = ComponentSystem.getStateValue(entity, stateId) ?? component.initialValue;
    const ok = ComponentSystem.setStateValue(entity, stateId, value);
    if (!ok) {
      return { ok: false, reason: 'missing-state', expectedType: component.valueType };
    }

    if (previousValue === value || !entity) {
      return {
        ok: true,
        changed: false,
        value,
        previousValue,
        valueType: component.valueType,
        dispatchedScripts: [],
      };
    }

    const dispatchedScripts = this.dispatchStateEvents(game, entity, component.id, {
      stateId: component.id,
      previousValue,
      value,
      valueType: component.valueType,
      source,
    });

    return {
      ok: true,
      changed: true,
      value,
      previousValue,
      valueType: component.valueType,
      dispatchedScripts,
    };
  }

  private static dispatchStateEvents(
    game: IGame,
    entity: SceneObject,
    stateId: string,
    args: {
      stateId: string;
      previousValue: StateValue;
      value: StateValue;
      valueType: StateValueType;
      source: StateChangeSource;
    }
  ): string[] {
    const interactions = (entity as any).interactions || {};
    const genericKey = this.normalizeEventKey(`state:${stateId}`);
    const valueKey = this.normalizeEventKey(`state:${stateId}=${String(args.value)}`);
    const scriptIds: string[] = [];
    const seen = new Set<string>();

    for (const eventKey of [genericKey, valueKey]) {
      for (const [rawKey, rawScriptId] of Object.entries(interactions)) {
        const key = this.normalizeEventKey(rawKey);
        const scriptId = typeof rawScriptId === 'string' ? rawScriptId.trim() : '';
        if (!scriptId || key !== eventKey || seen.has(scriptId)) continue;
        seen.add(scriptId);
        scriptIds.push(scriptId);
      }
    }

    for (const scriptId of scriptIds) {
      if (ScriptRegistry.has(scriptId)) {
        ScriptRegistry.execute(scriptId, { game, entity, args });
      } else {
        console.warn(`[StateEventSystem] Script not found for state event: ${scriptId}`);
      }
    }

    return scriptIds;
  }

  private static normalizeEventKey(key: string): string {
    return String(key || '')
      .trim()
      .toLowerCase();
  }
}
