import { Actor } from '../entities/Actor';
import type { IGame } from '../core/IGame';
import type { SceneObject } from '../entities/SceneObject';
import type { Scene } from '../scene/Scene';
import { ComponentSystem } from '../systems/ComponentSystem';
import { ActorCommandExecutor } from './ActorCommandExecutor';
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
  private readonly commandExecutor: ActorCommandExecutor;

  constructor(game: IGame) {
    this.game = game;
    this.commandExecutor = new ActorCommandExecutor(game);
  }

  build(scene: Scene): NpcWorldModel {
    const unreadSceneLog = scene.sceneLog.getUnreadEntries();
    const recentSceneLog = scene.sceneLog.entries;
    const npcs = this.getNpcActors(scene).map((npc) =>
      this.buildNpcContext(scene, npc, unreadSceneLog)
    );

    return compactRecord<NpcWorldModel>({
      scene: compactRecord({
        id: scene.id,
        title: this.game.textAssets.getResolvedSceneField(scene, 'title') || undefined,
        description: this.game.textAssets.getResolvedSceneField(scene, 'description') || undefined,
        lore: this.game.textAssets.getResolvedSceneField(scene, 'lore') || undefined,
      }),
      npcs,
      recentSceneLog,
      unreadSceneLog,
    });
  }

  getNpcActors(scene: Scene): Actor[] {
    return scene.entities.filter(
      (entity): entity is Actor =>
        entity instanceof Actor && !entity.disabled && ComponentSystem.isNpc(entity)
    );
  }

  getNpcListenerIds(scene: Scene, actorId?: string | null): string[] {
    return this.getNpcActors(scene)
      .filter((npc) => npc.name !== actorId)
      .map((npc) => npc.name);
  }

  private buildNpcContext(
    scene: Scene,
    npc: Actor,
    unreadEntries: NpcWorldModel['unreadSceneLog']
  ): NpcActorContext {
    const component = ComponentSystem.getNpcComponent(npc);
    const title = this.getObjectTitle(npc) || npc.name;
    const objectives = this.getOrInitializeNpcObjectives(npc, component);
    const heardEntries = unreadEntries.filter((entry) => entry.knownByNpcIds.includes(npc.name));

    return compactRecord<NpcActorContext>({
      id: npc.name,
      title,
      x: Math.round(npc.x),
      y: Math.round(npc.y),
      lore: this.game.textAssets.getResolvedObjectField(npc, 'lore') || undefined,
      objectives,
      memory: component?.memory || undefined,
      heardEntries,
      visibleEntities: this.buildVisibleEntities(scene, npc),
    });
  }

  private buildVisibleEntities(scene: Scene, npc: Actor): NpcActorContext['visibleEntities'] {
    return scene
      .getAllSceneObjects()
      .filter((object) => object !== npc && !object.disabled)
      .map((object) => {
        const title = this.getObjectTitle(object);
        if (!title || !this.shouldIncludeVisibleEntity(object)) return null;
        return compactRecord({
          id: object.name,
          title,
          ...this.getObjectCoordinates(object),
          location: this.getObjectLocation(scene, object),
          states: ComponentSystem.getStateComponents(object).map((component) => ({
            id: component.id,
            value: ComponentSystem.getStateValue(object, component.id) ?? component.initialValue,
          })),
          commands: this.commandExecutor.getAffordancesForEntity(object),
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

  private getObjectLocation(
    scene: Scene,
    object: SceneObject
  ): NonNullable<NpcActorContext['visibleEntities'][number]['location']> | undefined {
    const relation =
      object.spatial?.relation === 'in' ||
      object.spatial?.relation === 'on' ||
      object.spatial?.relation === 'under' ||
      object.spatial?.relation === 'behind'
        ? object.spatial.relation
        : null;
    const targetId =
      typeof object.spatial?.parentNodeId === 'string' ? object.spatial.parentNodeId.trim() : '';
    if (!relation || !targetId) return undefined;

    const target = scene.getObjectByName(targetId);
    const targetTitle = target ? this.getObjectTitle(target) || undefined : undefined;
    return compactRecord({
      relation,
      targetId,
      targetTitle,
    });
  }

  private getObjectCoordinates(object: SceneObject): { x?: number; y?: number } {
    const record = object as unknown as {
      x?: number;
      y?: number;
      poly?: Array<{ x: number; y: number }>;
    };
    if (typeof record.x === 'number' && typeof record.y === 'number') {
      return { x: Math.round(record.x), y: Math.round(record.y) };
    }
    if (Array.isArray(record.poly) && record.poly.length) {
      const xs = record.poly.map((point) => point.x);
      const ys = record.poly.map((point) => point.y);
      return {
        x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
        y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
      };
    }
    return {};
  }
}
