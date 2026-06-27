import { Actor } from '../entities/Actor';
import type { IGame } from '../core/IGame';
import { Entity } from '../entities/Entity';
import type { SceneObject } from '../entities/SceneObject';
import type { Scene } from '../scene/Scene';
import { ComponentSystem } from '../systems/ComponentSystem';
import type { NpcActorContext, NpcWorldModel } from './npcTypes';

type NpcContextTrace = {
  npcId: string;
  durationMs: number;
  knownObjects: number;
  includedEntities: number;
  skippedUntitled: number;
  skippedTechnical: number;
  interactions: Record<string, number>;
  approaches: Record<string, number>;
  commandEntities: Array<{ id: string; commandIds: string[] }>;
  switchEntities: string[];
  blockedEntities: string[];
  unreachableEntities: string[];
  actors: string[];
};

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || entry === undefined) continue;
    if (Array.isArray(entry)) {
      if (!entry.length) continue;
      result[key] = entry;
      continue;
    }
    if (typeof entry === 'object') {
      const nested = compactRecord(entry as Record<string, unknown>);
      if (!Object.keys(nested).length) continue;
      result[key] = nested;
      continue;
    }
    result[key] = entry;
  }
  return result as T;
}

export class NpcWorldModelBuilder {
  private readonly game: IGame;

  constructor(game: IGame) {
    this.game = game;
  }

  build(scene: Scene): NpcWorldModel {
    const startedAt = this.now();
    const npcs = this.getNpcActors(scene).map((npc) => this.buildNpcContext(scene, npc));
    const model = compactRecord<NpcWorldModel>({
      scene: compactRecord({
        id: scene.id,
        title: this.game.textAssets.getResolvedSceneField(scene, 'title') || undefined,
        description: this.game.textAssets.getResolvedSceneField(scene, 'description') || undefined,
        lore: this.game.textAssets.getResolvedSceneField(scene, 'lore') || undefined,
      }),
      npcs,
    });
    this.trace('pm_context_built', {
      sceneId: scene.id,
      npcCount: npcs.length,
      durationMs: this.elapsedMs(startedAt),
    });
    return model;
  }

  getNpcActors(scene: Scene): Actor[] {
    return scene.entities.filter(
      (entity): entity is Actor =>
        entity instanceof Actor && !entity.disabled && ComponentSystem.isNpc(entity)
    );
  }

  getNpcListenerIds(scene: Scene, actorId?: string | null): string[] {
    const source = actorId ? scene.getObjectByName(actorId) : null;
    if (source instanceof Actor) {
      return this.game.actorWorld.getActorListeners(source).map((npc) => npc.name);
    }
    return this.getNpcActors(scene).map((npc) => npc.name);
  }

  private buildNpcContext(scene: Scene, npc: Actor): NpcActorContext {
    const startedAt = this.now();
    const component = ComponentSystem.getNpcComponent(npc);
    const title = this.getObjectTitle(npc) || npc.name;
    const objectives = this.getOrInitializeNpcObjectives(npc, component);
    const newEvents = scene.sceneLog.getUnreadEntries(npc.name);
    const newEventIds = new Set(newEvents.map((entry) => entry.id));
    const recentEvents = scene.sceneLog.entries
      .filter(
        (entry) =>
          !newEventIds.has(entry.id) &&
          (entry.actorId === npc.name || entry.knownByNpcIds.includes(npc.name))
      )
      .slice(-12);

    const actors = scene.entities
      .filter(
        (entity): entity is Actor =>
          entity instanceof Actor &&
          !entity.disabled &&
          (entity === npc ||
            this.game.actorWorld.getObjectPerception(npc, entity, true).visibility === 'visible')
      )
      .map((actor) => ({
        id: actor.name,
        title: this.getObjectTitle(actor) || actor.name,
        lastSeenSceneId: scene.id,
      }));
    this.trace('pm_context_actor_perception', {
      npcId: npc.name,
      actors: actors.map((actor) => actor.id),
    });

    const entityBuild = this.buildKnownEntities(npc);
    this.rememberObservedEntities(scene, npc, actors, entityBuild.observedObjects);
    const mutableComponent = npc.components?.find(
      (candidate: any) => candidate?.type === 'NPC'
    ) as typeof component;
    const knownEntities = Object.values(mutableComponent?.knownEntities || {}).map((entry) => ({
      id: entry.id,
      title: entry.title,
      kind: entry.kind,
      lastSeenSceneId: entry.lastSeenSceneId,
    }));
    this.trace('pm_context_entity_summary', {
      ...entityBuild.trace,
      durationMs: this.elapsedMs(startedAt),
    });

    return compactRecord<NpcActorContext>({
      id: npc.name,
      title,
      lore: this.game.textAssets.getResolvedObjectField(npc, 'lore') || undefined,
      objectives,
      memory: component?.memory || undefined,
      inventory: this.game.actorWorld.getInventoryKnowledge(npc),
      actors,
      visibleItemIds: entityBuild.observedObjects
        .filter((object) => object instanceof Entity && this.isItem(object))
        .map((object) => object.name),
      knownEntities,
      newEvents,
      recentEvents,
      entities: entityBuild.entities,
    });
  }

  private buildKnownEntities(npc: Actor): {
    entities: NpcActorContext['entities'];
    observedObjects: SceneObject[];
    trace: NpcContextTrace;
  } {
    const knownObjects = this.game.actorWorld.getKnownObjects(npc);
    const trace: NpcContextTrace = {
      npcId: npc.name,
      durationMs: 0,
      knownObjects: knownObjects.length,
      includedEntities: 0,
      skippedUntitled: 0,
      skippedTechnical: 0,
      interactions: {},
      approaches: {},
      commandEntities: [],
      switchEntities: [],
      blockedEntities: [],
      unreachableEntities: [],
      actors: [],
    };
    const entities = knownObjects
      .map((object) => {
        const title = this.getObjectTitle(object);
        if (!title) {
          trace.skippedUntitled++;
          return null;
        }
        if (!this.shouldIncludeVisibleEntity(object)) {
          trace.skippedTechnical++;
          return null;
        }
        const perception = this.game.actorWorld.getObjectPerception(npc, object, true);
        trace.interactions[perception.interaction] =
          (trace.interactions[perception.interaction] || 0) + 1;
        trace.approaches[perception.approach] = (trace.approaches[perception.approach] || 0) + 1;
        if (perception.interaction === 'blocked') trace.blockedEntities.push(object.name);
        if (perception.approach === 'unreachable') trace.unreachableEntities.push(object.name);
        const switchAffordance = this.game.actorWorld.getSwitchAffordance(npc, object);
        const commands = this.game.actorCommands.getAffordancesForEntity(object, npc);
        if (switchAffordance) trace.switchEntities.push(object.name);
        if (commands.length) {
          trace.commandEntities.push({
            id: object.name,
            commandIds: commands.map((command) => command.id),
          });
        }
        trace.includedEntities++;
        return compactRecord({
          id: object.name,
          title,
          lastSeenSceneId: this.game.sceneManager.currentScene?.id || '',
          location: perception.location,
          interaction: perception.interaction,
          approach: perception.approach,
          inspection: this.game.actorWorld.getInspectionAffordance(object),
          switch: switchAffordance,
          states: ComponentSystem.getStateComponents(object).map((component) => ({
            id: component.id,
            value: ComponentSystem.getStateValue(object, component.id) ?? component.initialValue,
          })),
          commands,
        });
      })
      .filter((entry): entry is NonNullable<typeof entry> => !!entry);
    return { entities, observedObjects: knownObjects, trace };
  }

  private rememberObservedEntities(
    scene: Scene,
    npc: Actor,
    actors: Array<{ id: string; title: string }>,
    objects: SceneObject[]
  ): void {
    const component = npc.components?.find(
      (candidate: any) => candidate?.type === 'NPC'
    ) as ReturnType<typeof ComponentSystem.getNpcComponent>;
    if (!component) return;
    const known = Object.fromEntries(
      Object.entries(component.knownEntities || {}).filter(
        ([, entry]) => entry.kind === 'item' || entry.kind === 'actor'
      )
    );
    const lastSeenAt = Date.now();
    for (const actor of actors) {
      known[actor.id] = {
        id: actor.id,
        title: actor.title,
        kind: 'actor',
        lastSeenSceneId: scene.id,
        lastSeenAt,
      };
    }
    for (const object of objects) {
      if (!(object instanceof Actor) && !(object instanceof Entity && this.isItem(object))) {
        continue;
      }
      const title = this.getObjectTitle(object);
      if (!title) continue;
      known[object.name] = {
        id: object.name,
        title,
        kind: object instanceof Actor ? 'actor' : 'item',
        lastSeenSceneId: scene.id,
        lastSeenAt,
      };
    }
    component.knownEntities = known;
  }

  private isItem(object: SceneObject): boolean {
    return !!object.components?.some((component: any) => component?.type === 'Item');
  }

  private getOrInitializeNpcObjectives(
    npc: Actor,
    component: ReturnType<typeof ComponentSystem.getNpcComponent>
  ): string[] {
    if (
      component?.objectives &&
      (component.objectives.length > 0 || component.objectivesInitializedFromTA)
    ) {
      return component.objectives;
    }

    const initialObjectives = this.game.textAssets.getResolvedObjectListField(npc, 'objectives');
    const mutableComponent = npc.components?.find((candidate: any) => candidate?.type === 'NPC') as
      | { type: 'NPC'; objectives?: string[]; objectivesInitializedFromTA?: boolean }
      | undefined;
    if (
      mutableComponent &&
      (!Array.isArray(mutableComponent.objectives) ||
        mutableComponent.objectives.length === 0 ||
        mutableComponent.objectivesInitializedFromTA !== true)
    ) {
      mutableComponent.objectives = [...initialObjectives];
      mutableComponent.objectivesInitializedFromTA = true;
    }
    return initialObjectives;
  }

  private getObjectTitle(object: SceneObject): string | null {
    const title = this.game.textAssets.getResolvedObjectField(object, 'title')?.trim();
    return title || null;
  }

  private shouldIncludeVisibleEntity(object: SceneObject): boolean {
    if (this.hasAuthoredObjectTitle(object)) return true;
    return object.type === 'Walkbox' && ComponentSystem.getSurfaceComponents(object).length > 0;
  }

  private hasAuthoredObjectTitle(object: SceneObject): boolean {
    const textAssets = this.game.textAssets as typeof this.game.textAssets & {
      hasAuthoredObjectTitle?: (object: SceneObject) => boolean;
    };
    if (typeof textAssets.hasAuthoredObjectTitle === 'function') {
      return textAssets.hasAuthoredObjectTitle(object);
    }
    return object.type !== 'Walkbox' && !!this.getObjectTitle(object);
  }

  private trace(stage: string, details: Record<string, unknown>): void {
    const console = (this.game as any).console;
    if (!console?.parserPeekPmEnabled) return;
    const message = `--- PM CONTEXT TRACE ---\n${stage} ${JSON.stringify(details)}`;
    if (typeof console.logDebug === 'function') {
      console.logDebug(message);
    } else if (typeof console.log === 'function') {
      console.log(message, 'info', { showInClosed: false });
    }
  }

  private now(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  private elapsedMs(startedAt: number): number {
    return Math.round((this.now() - startedAt) * 100) / 100;
  }
}
