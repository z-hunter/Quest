import type { IGame } from '../core/IGame';
import { ScriptRegistry } from '../core/ScriptRegistry';
import type { SceneObject } from '../entities/SceneObject';
import type { Scene } from '../scene/Scene';
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
    this.applyStateParserNoteTextAsset(game, entity, component.id);

    return {
      ok: true,
      changed: true,
      value,
      previousValue,
      valueType: component.valueType,
      dispatchedScripts,
    };
  }

  static syncSceneStateParserNotes(game: IGame, scene: Scene | null | undefined): void {
    for (const entity of this.getSceneStateObjects(scene)) {
      for (const component of ComponentSystem.getStateComponents(entity)) {
        this.applyStateParserNoteTextAsset(game, entity, component.id, scene);
      }
    }
  }

  static dispatchSceneStateEvents(
    game: IGame,
    scene: Scene | null | undefined,
    source: StateChangeSource = 'scene-load'
  ): string[] {
    const dispatchedScripts: string[] = [];

    for (const entity of this.getSceneStateObjects(scene)) {
      for (const component of ComponentSystem.getStateComponents(entity)) {
        const value = ComponentSystem.getStateValue(entity, component.id) ?? component.initialValue;
        dispatchedScripts.push(
          ...this.dispatchStateEvents(game, entity, component.id, {
            stateId: component.id,
            previousValue: value,
            value,
            valueType: component.valueType,
            source,
          })
        );
      }
    }

    return dispatchedScripts;
  }

  private static getSceneStateObjects(scene: Scene | null | undefined): SceneObject[] {
    if (!scene) return [];
    return [
      ...scene.entities,
      ...scene.triggerboxes,
      ...(scene.walkbox as unknown as SceneObject[]),
    ];
  }

  private static applyStateParserNoteTextAsset(
    game: IGame,
    entity: SceneObject,
    stateId: string,
    scene: Scene | null | undefined = game.sceneManager?.currentScene
  ): void {
    const component = ComponentSystem.getStateComponent(entity, stateId);
    if (!component?.parserNoteTextAssets || !scene) return;

    const value = ComponentSystem.getStateValue(entity, stateId) ?? component.initialValue;
    const textAssetField = component.parserNoteTextAssets[String(value)]?.trim();
    if (!textAssetField) return;

    const note = game.textAssets.getResolvedObjectField(entity, textAssetField)?.trim();
    if (!note) {
      console.warn(
        `[StateEventSystem] Parser Note Text Asset field '${textAssetField}' for ${entity.name}.${component.id}=${String(value)} was not found or is empty.`
      );
      return;
    }

    scene.setEntityParserNote(entity.name, note);
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
