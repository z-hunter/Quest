import { Actor } from '../entities/Actor';
import type { IGame } from '../core/IGame';
import type { SceneObject } from '../entities/SceneObject';
import type { Scene } from '../scene/Scene';
import { ComponentSystem } from '../systems/ComponentSystem';
import type { NpcActorContext, NpcWorldModel } from './npcTypes';

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
    const npcs = this.getNpcActors(scene).map((npc) => this.buildNpcContext(scene, npc));

    return compactRecord<NpcWorldModel>({
      scene: compactRecord({
        id: scene.id,
        title: this.game.textAssets.getResolvedSceneField(scene, 'title') || undefined,
        description: this.game.textAssets.getResolvedSceneField(scene, 'description') || undefined,
        lore: this.game.textAssets.getResolvedSceneField(scene, 'lore') || undefined,
      }),
      npcs,
    });
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
      return this.game.actorWorld.getActionObservers(source).map((npc) => npc.name);
    }
    return this.getNpcActors(scene).map((npc) => npc.name);
  }

  private buildNpcContext(scene: Scene, npc: Actor): NpcActorContext {
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

    return compactRecord<NpcActorContext>({
      id: npc.name,
      title,
      lore: this.game.textAssets.getResolvedObjectField(npc, 'lore') || undefined,
      objectives,
      memory: component?.memory || undefined,
      inventory: this.game.actorWorld.getInventoryKnowledge(npc),
      actors: scene.entities
        .filter(
          (entity): entity is Actor =>
            entity instanceof Actor &&
            !entity.disabled &&
            (entity === npc ||
              this.game.actorWorld.getObjectPerception(npc, entity).visibility === 'visible')
        )
        .map((actor) => ({
          id: actor.name,
          title: this.getObjectTitle(actor) || actor.name,
        })),
      newEvents,
      recentEvents,
      entities: this.buildKnownEntities(npc),
    });
  }

  private buildKnownEntities(npc: Actor): NpcActorContext['entities'] {
    return this.game.actorWorld
      .getKnownObjects(npc)
      .map((object) => {
        const title = this.getObjectTitle(object);
        if (!title || !this.shouldIncludeVisibleEntity(object)) return null;
        const perception = this.game.actorWorld.getObjectPerception(npc, object);
        return compactRecord({
          id: object.name,
          title,
          location: perception.location,
          interaction: perception.interaction,
          approach: perception.approach,
          inspection: this.game.actorWorld.getInspectionAffordance(object),
          switch: this.game.actorWorld.getSwitchAffordance(npc, object),
          states: ComponentSystem.getStateComponents(object).map((component) => ({
            id: component.id,
            value: ComponentSystem.getStateValue(object, component.id) ?? component.initialValue,
          })),
          commands: this.game.actorCommands.getAffordancesForEntity(object, npc),
        });
      })
      .filter((entry): entry is NonNullable<typeof entry> => !!entry);
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
}
