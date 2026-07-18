import { Actor } from '../entities/Actor';
import type { IGame } from '../core/IGame';
import { Entity } from '../entities/Entity';
import type { SceneObject } from '../entities/SceneObject';
import type { Scene } from '../scene/Scene';
import type { SceneLogEntry } from '../scene/SceneLog';
import { ComponentSystem, type NpcKnownEntityMemory } from '../systems/ComponentSystem';
import type { NpcActorContext, NpcStaticEntityContext, NpcWorldModel } from './npcTypes';

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

  build(scene: Scene, options: { npcIds?: Iterable<string> } = {}): NpcWorldModel {
    const startedAt = this.now();
    const npcIdFilter = options.npcIds ? new Set(options.npcIds) : null;
    const npcs = this.getNpcActors(scene)
      .filter((npc) => !npcIdFilter || npcIdFilter.has(npc.name))
      .map((npc) => this.buildNpcContext(scene, npc));
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

  buildStaticEntityProjection(scene: Scene): NpcStaticEntityContext[] {
    return scene
      .getAllSceneObjects()
      .map((object) => {
        const title = this.getObjectTitle(object);
        if (
          !title ||
          !this.shouldIncludeVisibleEntity(object) ||
          this.isItem(object) ||
          this.isInsideProtectedInventory(object)
        )
          return null;
        const description = this.game.textAssets.getResolvedObjectField(object, 'description');
        const switchComponent = this.game.getSwitchComponent(object) as any;
        const inspection = this.game.actorWorld.getInspectionAffordance(object);
        const requiredKeyId = String(switchComponent?.idKey || switchComponent?.keyId || '').trim();
        const commands = this.game.actorCommands
          .getAffordancesForEntity(object)
          .map((command) =>
            compactRecord({
              id: command.id,
              label: command.label,
              requires: command.requires?.map(({ entityId, scope }) => ({ entityId, scope })),
              effects: command.effects,
            })
          )
          .sort((a, b) => a.id.localeCompare(b.id));
        return compactRecord<NpcStaticEntityContext>({
          id: object.name,
          title,
          description:
            description && description !== 'You see nothing special.' ? description : undefined,
          lore: this.game.textAssets.getResolvedObjectField(object, 'lore') || undefined,
          inspection:
            inspection.look &&
            inspection.examine &&
            inspection.possibleRelations.length === 4 &&
            inspection.possibleRelations.join(',') === 'in,on,under,behind'
              ? undefined
              : [
                  ...(inspection.look ? ['look'] : []),
                  ...(inspection.examine ? ['examine'] : []),
                  ...inspection.possibleRelations,
                ],
          switch: switchComponent
            ? compactRecord({
                canOpen: true,
                canClose: true,
                requiredKeyId: requiredKeyId || undefined,
                blockedRelation: switchComponent.blockedRelation || undefined,
                transparent: switchComponent.transparent === true ? true : undefined,
              })
            : undefined,
          commands,
          exit: this.getExitContext(scene, object),
        });
      })
      .filter((entry): entry is NpcStaticEntityContext => !!entry)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private isInsideProtectedInventory(object: SceneObject): boolean {
    if (!(object instanceof Entity)) return false;
    const directOwner = object.getInventoryPositionOwner();
    if (directOwner) {
      return ComponentSystem.getInventoryComponents(directOwner).some(
        (component) => component.protected === true
      );
    }

    const scene = this.game.sceneManager.currentScene;
    const parentId =
      typeof object.spatial?.parentNodeId === 'string' ? object.spatial.parentNodeId.trim() : '';
    const parent = parentId ? scene?.getObjectByName(parentId) : null;
    if (!(parent instanceof Entity) || object.spatial?.relation !== 'in') return false;

    return ComponentSystem.getInventoryComponents(parent).some(
      (component) =>
        component.protected === true &&
        (component.items || []).some((itemId) => String(itemId || '').trim() === object.name)
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
          (entry.actorId === npc.name || entry.knownByActorIds.includes(npc.name))
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
        lastSeenSceneId: undefined, // Default is current scene
      }));
    this.trace('pm_context_actor_perception', {
      npcId: npc.name,
      actors: actors.map((actor) => actor.id),
    });

    const entityBuild = this.buildKnownEntities(npc);
    this.rememberObservedEntities(scene, npc, actors, entityBuild.observedObjects);
    this.rememberObservedActionLocations(scene, npc);
    const mutableComponent = npc.components?.find(
      (candidate: any) => candidate?.type === 'NPC'
    ) as typeof component;
    const knownEntities = Object.values(mutableComponent?.knownEntities || {}).map((entry) => ({
      id: entry.id,
      title: entry.title,
      kind: entry.kind,
      lastSeenSceneId: entry.lastSeenSceneId === scene.id ? undefined : entry.lastSeenSceneId,
      lastSeenLocation: entry.lastSeenLocation,
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
        const inspection = this.game.actorWorld.getInspectionAffordance(object);
        const isDefaultInspection =
          inspection.look &&
          inspection.examine &&
          inspection.possibleRelations.length === 4 &&
          inspection.possibleRelations.join(',') === 'in,on,under,behind';

        return compactRecord({
          id: object.name,
          title,
          lastSeenSceneId: undefined, // Default is current scene
          visibility: perception.visibility === 'visible' ? undefined : perception.visibility,
          location: perception.location,
          interaction: perception.interaction,
          approach:
            perception.approach === 'already_reachable' &&
            (perception.interaction === 'held' || perception.interaction === 'reachable')
              ? undefined
              : perception.approach,
          inspection: isDefaultInspection ? undefined : inspection,
          switch: switchAffordance,
          states: ComponentSystem.getStateComponents(object).map((component) => ({
            id: component.id,
            value: ComponentSystem.getStateValue(object, component.id) ?? component.initialValue,
          })),
          commands,
          exit: this.getExitContext(this.game.sceneManager.currentScene!, object),
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
      const actorObject = scene.getObjectByName(actor.id);
      known[actor.id] = {
        id: actor.id,
        title: actor.title,
        kind: 'actor',
        lastSeenSceneId: scene.id,
        lastSeenAt,
        ...(actorObject ? this.getLastSeenLocation(scene, npc, actorObject) : {}),
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
        ...this.getLastSeenLocation(scene, npc, object),
      };
    }
    component.knownEntities = known;
  }

  private rememberObservedActionLocations(scene: Scene, npc: Actor): void {
    const component = npc.components?.find(
      (candidate: any) => candidate?.type === 'NPC'
    ) as ReturnType<typeof ComponentSystem.getNpcComponent>;
    if (!component) return;
    const known = Object.fromEntries(
      Object.entries(component.knownEntities || {}).filter(
        ([, entry]) => entry.kind === 'item' || entry.kind === 'actor'
      )
    );
    const events = scene.sceneLog.entries
      .filter(
        (entry) =>
          entry.kind === 'action' &&
          (entry.actorId === npc.name || entry.knownByActorIds.includes(npc.name))
      )
      .sort((left, right) => left.timestamp - right.timestamp);

    for (const event of events) {
      this.applyObservedActionLocation(scene, known, event);
    }
    component.knownEntities = known;
  }

  private applyObservedActionLocation(
    scene: Scene,
    known: Record<string, NpcKnownEntityMemory>,
    event: SceneLogEntry
  ): void {
    const payload = event.payload || {};
    const action = typeof payload.action === 'string' ? payload.action : '';
    const itemId = typeof payload.itemId === 'string' ? payload.itemId.trim() : '';
    if (!itemId || (action !== 'take' && action !== 'put' && action !== 'give')) return;

    const item = scene.getObjectByName(itemId);
    const existing = known[itemId];
    const title = (item ? this.getObjectTitle(item) : '') || existing?.title || itemId;
    const lastSeenAt = event.timestamp || Date.now();

    if (action === 'take') {
      const actor = scene.getObjectByName(event.actorId);
      const actorTitle =
        (actor ? this.getObjectTitle(actor) : '') || event.displayName || event.actorId;
      known[itemId] = {
        id: itemId,
        title,
        kind: 'item',
        lastSeenSceneId: scene.id,
        lastSeenAt,
        lastSeenLocation: {
          sceneId: scene.id,
          relation: 'in',
          targetId: event.actorId,
          ...(actorTitle ? { targetTitle: actorTitle } : {}),
        },
      };
      return;
    }

    if (action === 'give') {
      const targetId = typeof payload.targetId === 'string' ? payload.targetId.trim() : '';
      if (!targetId) return;
      const target = scene.getObjectByName(targetId);
      const targetTitle = (target ? this.getObjectTitle(target) : '') || targetId;
      known[itemId] = {
        id: itemId,
        title,
        kind: 'item',
        lastSeenSceneId: scene.id,
        lastSeenAt,
        lastSeenLocation: {
          sceneId: scene.id,
          relation: 'in',
          targetId,
          ...(targetTitle ? { targetTitle } : {}),
        },
      };
      return;
    }

    const targetId =
      typeof payload.targetId === 'string'
        ? payload.targetId.trim()
        : payload.targetId === null
          ? ''
          : '';
    const target = targetId ? scene.getObjectByName(targetId) : null;
    const rawRelation = typeof payload.relation === 'string' ? payload.relation.trim() : '';
    const relation =
      rawRelation === 'in' ||
      rawRelation === 'on' ||
      rawRelation === 'under' ||
      rawRelation === 'behind'
        ? rawRelation
        : target instanceof Entity && ComponentSystem.getInventoryComponent(target)
          ? 'in'
          : 'on';
    const targetTitle =
      (target ? this.getObjectTitle(target) : '') ||
      (targetId
        ? targetId
        : this.game.textAssets.getResolvedSceneField(scene, 'title') || scene.id);

    known[itemId] = {
      id: itemId,
      title,
      kind: 'item',
      lastSeenSceneId: scene.id,
      lastSeenAt,
      lastSeenLocation: {
        sceneId: scene.id,
        relation,
        targetId: targetId || scene.id,
        ...(targetTitle ? { targetTitle } : {}),
      },
    };
  }

  private getLastSeenLocation(
    scene: Scene,
    npc: Actor,
    object: SceneObject
  ):
    | {
        lastSeenLocation: NpcKnownEntityMemory['lastSeenLocation'];
      }
    | Record<string, never> {
    const location = this.game.actorWorld.getObjectPerception(npc, object, true).location;
    if (!location) return {};
    return {
      lastSeenLocation: {
        sceneId: scene.id,
        relation: location.relation,
        targetId: location.targetId,
        ...(location.targetTitle ? { targetTitle: location.targetTitle } : {}),
      },
    };
  }

  private isItem(object: SceneObject): boolean {
    return !!object.components?.some((component: any) => component?.type === 'Item');
  }

  private getExitContext(scene: Scene, object: SceneObject): NpcStaticEntityContext['exit'] {
    const exit = object.components?.find((component: any) => component?.type === 'Exit') as
      | { targetSceneId?: string; targetEntryId?: string; portal?: boolean; collider?: boolean }
      | undefined;
    if (!exit) return undefined;
    const targetSceneId = String(exit.targetSceneId || scene.id)
      .trim()
      .replace(/\.json$/i, '');
    const target = this.game.sceneManager.scenes.get(targetSceneId);
    const descriptor = this.game.sceneManager.sceneRegistry.get(targetSceneId);
    const targetSceneTitle =
      (target && this.game.textAssets.getResolvedSceneField(target, 'title')) ||
      descriptor?.title ||
      undefined;
    return compactRecord({
      targetSceneId,
      targetEntryId: String(exit.targetEntryId || '').trim() || undefined,
      targetSceneTitle,
      portal: exit.portal === true,
      collider: exit.collider !== false,
    });
  }

  private getOrInitializeNpcObjectives(
    npc: Actor,
    component: ReturnType<typeof ComponentSystem.getNpcComponent>
  ): string[] {
    if (component?.objectives && component.objectives.length > 0) {
      return component.objectives;
    }

    const initialObjectives = this.game.textAssets.getResolvedObjectListField(npc, 'objectives');
    const taRevision = this.game.textAssets.getResolvedObjectListRevision(npc, 'objectives');
    const mutableComponent = npc.components?.find((candidate: any) => candidate?.type === 'NPC') as
      | {
          type: 'NPC';
          objectives?: string[];
          objectivesInitializedFromTA?: boolean;
          objectivesTARevision?: string;
        }
      | undefined;
    if (mutableComponent?.objectivesTARevision === taRevision) {
      return mutableComponent.objectives || [];
    }
    if (mutableComponent) {
      mutableComponent.objectives = [...initialObjectives];
      mutableComponent.objectivesInitializedFromTA = true;
      mutableComponent.objectivesTARevision = taRevision;
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
