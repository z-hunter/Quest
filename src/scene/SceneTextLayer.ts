import type { IGame } from '../core/IGame';
import type { SceneObject } from '../entities/SceneObject';
import type { Triggerbox } from '../entities/Triggerbox';
import { ComponentSystem, type BlockerComponent } from '../systems/ComponentSystem';
import type { SwitchTrigger } from '../entities/TriggerComponents';
import type { Scene } from './Scene';
import type { SpatialPlacement, SpatialRelationType } from './spatialTypes';

type EffectiveRelation = Exclude<SpatialRelationType, 'near'>;

export type SceneTextLayerEntry = {
  object: SceneObject;
  title: string;
  effectiveParentId: string | null;
  effectiveRelation: EffectiveRelation | null;
  blocked: boolean;
  inInactiveSubscene: boolean;
};

export type SceneTextLayerAccessState = {
  object: SceneObject;
  title: string | null;
  effectiveParentId: string | null;
  effectiveRelation: EffectiveRelation | null;
  blocked: boolean;
  hidden: boolean;
  hiddenReason: 'switch' | 'blocker' | 'lookable' | 'examinable' | null;
  inInactiveSubscene: boolean;
  gatingSwitch: SceneObject | null;
  gatingSwitchTitle: string | null;
  gatingSwitchTransparent: boolean;
  gatingSwitchClearlyOpenable: boolean;
};

export type SceneTextLayerSnapshot = {
  entries: SceneTextLayerEntry[];
  entryById: Map<string, SceneTextLayerEntry>;
  childrenByParentId: Map<string, SceneTextLayerEntry[]>;
  childrenByParentAndRelation: Map<string, Map<EffectiveRelation, SceneTextLayerEntry[]>>;
  objectById: Map<string, SceneObject>;
  titleById: Map<string, string | null>;
};

export type SceneTextTargetDescriptor = {
  title: string;
  relation: EffectiveRelation;
};

type SceneTextRelationAccessState = SceneTextLayerAccessState & {
  object: SceneObject;
  title: string;
};

function getSceneObjectTitle(game: IGame, object: SceneObject): string | null {
  if (ComponentSystem.isNavigationOnlyExit(object)) return null;
  const title = game.textAssets.getResolvedObjectField(object as any, 'title');
  return title && title.trim() ? title.trim() : null;
}

function getInventorySlotProjection(
  game: IGame,
  object: SceneObject
): {
  owner: SceneObject;
  relation: EffectiveRelation;
  protected: boolean;
  playerOwned: boolean;
} | null {
  const slot = game.inventoryManager?.getInventorySlotForEntity?.(object as any);
  if (!slot) return null;
  return {
    owner: slot.owner,
    relation: slot.relation,
    protected: !!slot.component?.protected,
    playerOwned: !!game.inventoryManager?.isPlayerInventoryOwner?.(slot.owner),
  };
}

function getBlockerComponent(object: SceneObject | null): BlockerComponent | null {
  if (!object?.components?.length) return null;
  const component = object.components.find((candidate: any) => candidate?.type === 'Blocker');
  return (component as BlockerComponent | undefined) || null;
}

function normalizeBlockedRelation(value: unknown): EffectiveRelation | 'none' {
  return value === 'on' || value === 'under' || value === 'behind' || value === 'none'
    ? value
    : 'in';
}

export type ActiveBlockingComponentState = {
  kind: 'switch' | 'blocker';
  transparent: boolean;
  clearlyOpenable: boolean;
};

export function getActiveBlockingComponentState(
  object: SceneObject | null,
  relation: EffectiveRelation | null
): ActiveBlockingComponentState | null {
  if (!object || !relation) return null;

  const blockerComponent = getBlockerComponent(object);
  if (blockerComponent && normalizeBlockedRelation(blockerComponent.blockedRelation) === relation) {
    return {
      kind: 'blocker',
      transparent: !!blockerComponent.transparent,
      clearlyOpenable: false,
    };
  }

  const switchComponent = object.components?.find((c: any) => c.type === 'Switch') as
    | SwitchTrigger
    | undefined;
  if (
    switchComponent &&
    (switchComponent.state || 1) !== 2 &&
    normalizeBlockedRelation(switchComponent.blockedRelation) === relation
  ) {
    return {
      kind: 'switch',
      transparent: !!switchComponent.transparent,
      clearlyOpenable: !!switchComponent.clearlyOpenable,
    };
  }

  return null;
}

function getSemanticHiddenMode(object: SceneObject | null): false | 'lookable' | 'examinable' {
  if (!object) return false;
  return object.hidden === 'lookable' || object.hidden === 'examinable' ? object.hidden : false;
}

function isSubsceneTriggerbox(object: SceneObject | null): object is Triggerbox {
  return !!object?.components?.some((component: any) => component?.type === 'Subscene');
}

function getPlacement(scene: Scene, object: SceneObject | null): SpatialPlacement | null {
  return object ? scene.getSpatialPlacementForObject(object) : null;
}

function normalizeRelation(
  relation: SpatialPlacement['relation'] | null | undefined
): EffectiveRelation | null {
  return relation === 'in' || relation === 'on' || relation === 'under' || relation === 'behind'
    ? relation
    : null;
}

function getSubsceneRootId(triggerbox: Triggerbox): string {
  const subsceneComponent = triggerbox.components?.find(
    (component: any) => component?.type === 'Subscene'
  ) as { targetGroupId?: string } | undefined;
  return String(triggerbox.name || subsceneComponent?.targetGroupId || '').trim();
}

function collectInactiveSubsceneRootIds(scene: Scene, object: SceneObject): string[] {
  const roots: string[] = [];
  let currentParentId = getPlacement(scene, object)?.parentNodeId || null;

  while (currentParentId) {
    const parentObject = scene.getObjectByName(currentParentId);
    if (!parentObject) break;
    if (isSubsceneTriggerbox(parentObject)) {
      const subsceneRootId = getSubsceneRootId(parentObject);
      if (subsceneRootId && scene.activeSubscene !== subsceneRootId) {
        roots.push(subsceneRootId);
      }
    }
    currentParentId = getPlacement(scene, parentObject)?.parentNodeId || null;
  }

  return roots.reverse();
}

export function getInactiveSubsceneAncestors(scene: Scene, object: SceneObject): Triggerbox[] {
  const allObjects = scene.getAllSceneObjects();
  const byId = new Map(allObjects.map((candidate) => [candidate.name, candidate] as const));

  return collectInactiveSubsceneRootIds(scene, object)
    .map((rootId) => byId.get(rootId))
    .filter((candidate): candidate is Triggerbox => !!candidate && isSubsceneTriggerbox(candidate));
}

export function getSceneTextLayerAccessState(
  scene: Scene,
  game: IGame,
  object: SceneObject,
  objectById?: Map<string, SceneObject>,
  titleById?: Map<string, string | null>
): SceneTextLayerAccessState {
  const allObjectById =
    objectById ||
    new Map(scene.getAllSceneObjects().map((candidate) => [candidate.name, candidate] as const));
  const allTitleById =
    titleById ||
    new Map(
      scene
        .getAllSceneObjects()
        .map((candidate) => [candidate.name, getSceneObjectTitle(game, candidate)] as const)
    );

  const title = allTitleById.get(object.name) || null;
  const inventorySlot = getInventorySlotProjection(game, object);
  const placement = getPlacement(scene, object);
  let currentParentId = placement?.parentNodeId || null;
  let relationToAncestor = normalizeRelation(placement?.relation) || null;
  let effectiveParentId: string | null = null;
  let effectiveRelation: EffectiveRelation | null = relationToAncestor;
  let blocked = false;
  let hidden = false;
  let hiddenReason: 'switch' | 'blocker' | 'lookable' | 'examinable' | null = null;
  let inInactiveSubscene = false;
  let gatingSwitch: SceneObject | null = null;
  let gatingSwitchTransparent = false;
  let gatingSwitchClearlyOpenable = false;

  while (currentParentId) {
    const parentObject = allObjectById.get(currentParentId) || null;
    if (!parentObject) break;

    if (isSubsceneTriggerbox(parentObject)) {
      const subsceneRootId = getSubsceneRootId(parentObject);
      if (subsceneRootId && scene.activeSubscene !== subsceneRootId) {
        inInactiveSubscene = true;
      }
    }

    const blockingComponent = getActiveBlockingComponentState(parentObject, relationToAncestor);
    if (blockingComponent) {
      if (!gatingSwitch) {
        gatingSwitch = parentObject;
        gatingSwitchTransparent = blockingComponent.transparent;
        gatingSwitchClearlyOpenable = blockingComponent.clearlyOpenable;
      }
      if (blockingComponent.transparent) {
        blocked = true;
      } else {
        hidden = true;
        hiddenReason = blockingComponent.kind;
      }
    }

    if (!effectiveParentId && allTitleById.get(parentObject.name)) {
      effectiveParentId = parentObject.name;
      effectiveRelation =
        inventorySlot && inventorySlot.owner === parentObject
          ? inventorySlot.relation
          : relationToAncestor;
    }

    const parentPlacement = getPlacement(scene, parentObject);
    currentParentId = parentPlacement?.parentNodeId || null;
    relationToAncestor = normalizeRelation(parentPlacement?.relation) || null;
  }

  if (!hidden && title) {
    const semanticHiddenMode = getSemanticHiddenMode(object);
    const isRevealed = scene.isHiddenEntityRevealed(object);
    if (semanticHiddenMode && !isRevealed) {
      hidden = true;
      hiddenReason = semanticHiddenMode;
    }
  }

  return {
    object,
    title,
    effectiveParentId,
    effectiveRelation,
    blocked,
    hidden,
    hiddenReason,
    inInactiveSubscene,
    gatingSwitch,
    gatingSwitchTitle: gatingSwitch ? allTitleById.get(gatingSwitch.name) || null : null,
    gatingSwitchTransparent,
    gatingSwitchClearlyOpenable,
  };
}

export function buildSceneTextLayerSnapshot(scene: Scene, game: IGame): SceneTextLayerSnapshot {
  const allObjects = scene.getAllSceneObjects();
  const objectById = new Map(allObjects.map((object) => [object.name, object] as const));
  const titleById = new Map(
    allObjects.map((object) => [object.name, getSceneObjectTitle(game, object)] as const)
  );

  const entries: SceneTextLayerEntry[] = [];

  for (const object of allObjects) {
    const accessState = getSceneTextLayerAccessState(scene, game, object, objectById, titleById);
    const title = accessState.title;
    if (!title) continue;
    const inventorySlot = getInventorySlotProjection(game, object);
    if (inventorySlot?.playerOwned) continue;
    if (inventorySlot?.protected) continue;

    if (accessState.hidden) continue;

    entries.push({
      object,
      title,
      effectiveParentId: accessState.effectiveParentId,
      effectiveRelation: accessState.effectiveRelation,
      blocked: accessState.blocked,
      inInactiveSubscene: accessState.inInactiveSubscene,
    });
  }

  const entryById = new Map(entries.map((entry) => [entry.object.name, entry] as const));
  const childrenByParentId = new Map<string, SceneTextLayerEntry[]>();
  const childrenByParentAndRelation = new Map<
    string,
    Map<EffectiveRelation, SceneTextLayerEntry[]>
  >();

  for (const entry of entries) {
    if (!entry.effectiveParentId || !entry.effectiveRelation) continue;

    const children = childrenByParentId.get(entry.effectiveParentId) || [];
    children.push(entry);
    childrenByParentId.set(entry.effectiveParentId, children);

    const relationMap = childrenByParentAndRelation.get(entry.effectiveParentId) || new Map();
    const relationChildren = relationMap.get(entry.effectiveRelation) || [];
    relationChildren.push(entry);
    relationMap.set(entry.effectiveRelation, relationChildren);
    childrenByParentAndRelation.set(entry.effectiveParentId, relationMap);
  }

  return {
    entries,
    entryById,
    childrenByParentId,
    childrenByParentAndRelation,
    objectById,
    titleById,
  };
}

export function getSceneTextRelationDescendants(
  snapshot: SceneTextLayerSnapshot,
  anchorNodeId: string,
  relation: EffectiveRelation
): SceneTextLayerEntry[] {
  const directChildren =
    snapshot.childrenByParentAndRelation.get(anchorNodeId)?.get(relation) || [];
  const results: SceneTextLayerEntry[] = [];
  const visited = new Set<string>();
  const stack = [...directChildren];

  for (let i = 0; i < stack.length; i++) {
    const entry = stack[i];
    if (!entry || visited.has(entry.object.name)) continue;

    visited.add(entry.object.name);
    results.push(entry);
    stack.push(...(snapshot.childrenByParentId.get(entry.object.name) || []));
  }

  return results;
}

export function getSceneTextRelationDirectDescendants(
  snapshot: SceneTextLayerSnapshot,
  anchorNodeId: string,
  relation: EffectiveRelation
): SceneTextLayerEntry[] {
  return snapshot.entries.filter(
    (entry) =>
      entry.effectiveParentId === anchorNodeId &&
      entry.effectiveRelation === relation &&
      !hasTitledIntermediate(entry.object, anchorNodeId, snapshot.objectById, snapshot.titleById)
  );
}

function hasTitledIntermediate(
  object: SceneObject,
  anchorNodeId: string,
  objectById: Map<string, SceneObject>,
  titleById: Map<string, string | null>
): boolean {
  let parentId =
    typeof (object as any).spatial?.parentNodeId === 'string'
      ? (object as any).spatial.parentNodeId.trim()
      : '';
  const visited = new Set<string>();

  while (parentId && parentId !== anchorNodeId && !visited.has(parentId)) {
    visited.add(parentId);
    if (titleById.get(parentId)) return true;
    const parent = objectById.get(parentId);
    parentId =
      typeof (parent as any)?.spatial?.parentNodeId === 'string'
        ? (parent as any).spatial.parentNodeId.trim()
        : '';
  }

  return false;
}

export function getSceneTextRelationAccessStates(
  scene: Scene,
  game: IGame,
  anchorNodeId: string,
  relation: EffectiveRelation,
  options: { includeHidden?: boolean } = {}
): SceneTextRelationAccessState[] {
  const allObjects = scene.getAllSceneObjects();
  const objectById = new Map(allObjects.map((object) => [object.name, object] as const));
  const titleById = new Map(
    allObjects.map((object) => [object.name, getSceneObjectTitle(game, object)] as const)
  );
  const includeHidden = !!options.includeHidden;

  const states = allObjects
    .map((object) => {
      const accessState = getSceneTextLayerAccessState(scene, game, object, objectById, titleById);
      if (!accessState.title) return null;
      const inventorySlot = getInventorySlotProjection(game, object);
      if (inventorySlot?.playerOwned || inventorySlot?.protected) return null;
      if (accessState.hidden && !includeHidden) return null;
      return accessState as SceneTextRelationAccessState;
    })
    .filter((state): state is SceneTextRelationAccessState => !!state);

  const childrenByParentId = new Map<string, SceneTextRelationAccessState[]>();
  const childrenByParentAndRelation = new Map<
    string,
    Map<EffectiveRelation, SceneTextRelationAccessState[]>
  >();

  for (const state of states) {
    if (!state.effectiveParentId || !state.effectiveRelation) continue;

    const children = childrenByParentId.get(state.effectiveParentId) || [];
    children.push(state);
    childrenByParentId.set(state.effectiveParentId, children);

    const relationMap = childrenByParentAndRelation.get(state.effectiveParentId) || new Map();
    const relationChildren = relationMap.get(state.effectiveRelation) || [];
    relationChildren.push(state);
    relationMap.set(state.effectiveRelation, relationChildren);
    childrenByParentAndRelation.set(state.effectiveParentId, relationMap);
  }

  const directChildren = childrenByParentAndRelation.get(anchorNodeId)?.get(relation) || [];
  const results: SceneTextRelationAccessState[] = [];
  const visited = new Set<string>();
  const stack = [...directChildren];

  for (let idx = 0; idx < stack.length; idx++) {
    const state = stack[idx];
    if (!state || visited.has(state.object.name)) continue;

    visited.add(state.object.name);
    results.push(state);
    stack.push(...(childrenByParentId.get(state.object.name) || []));
  }

  return results;
}

export function getSceneTextRelationDirectAccessStates(
  scene: Scene,
  game: IGame,
  anchorNodeId: string,
  relation: EffectiveRelation,
  options: { includeHidden?: boolean } = {}
): SceneTextRelationAccessState[] {
  const allObjects = scene.getAllSceneObjects();
  const objectById = new Map(allObjects.map((object) => [object.name, object] as const));
  const titleById = new Map(
    allObjects.map((object) => [object.name, getSceneObjectTitle(game, object)] as const)
  );
  const includeHidden = !!options.includeHidden;

  return allObjects
    .map((object) => {
      const accessState = getSceneTextLayerAccessState(scene, game, object, objectById, titleById);
      if (!accessState.title) return null;
      if (accessState.effectiveParentId !== anchorNodeId) return null;
      if (accessState.effectiveRelation !== relation) return null;
      if (hasTitledIntermediate(object, anchorNodeId, objectById, titleById)) return null;
      const inventorySlot = getInventorySlotProjection(game, object);
      if (inventorySlot?.playerOwned || inventorySlot?.protected) return null;
      if (accessState.hidden && !includeHidden) return null;
      return accessState as SceneTextRelationAccessState;
    })
    .filter((state): state is SceneTextRelationAccessState => !!state);
}

export function getSceneTextTargetDescriptor(
  scene: Scene,
  game: IGame,
  target: SceneObject | null | undefined,
  fallbackRelation?: SpatialPlacement['relation'] | null
): SceneTextTargetDescriptor | null {
  if (!target) return null;

  const relation = normalizeRelation(fallbackRelation) || 'on';
  if (target.type === 'Walkbox') {
    return { title: game.text('engine.floor_label'), relation: 'on' };
  }

  const title = getSceneObjectTitle(game, target);
  if (title) return { title, relation };

  const accessState = getSceneTextLayerAccessState(scene, game, target);
  if (accessState.effectiveParentId && accessState.effectiveRelation) {
    const parent = scene.getObjectByName(accessState.effectiveParentId);
    const parentTitle = parent ? getSceneObjectTitle(game, parent) : null;
    if (parentTitle) {
      return {
        title: parentTitle,
        relation: accessState.effectiveRelation,
      };
    }
  }

  return null;
}

export class SceneTextLayerQuery {
  private readonly scene: Scene;
  private readonly game: IGame;
  private snapshot: SceneTextLayerSnapshot;
  private snapshotKey: string;

  constructor(scene: Scene, game: IGame) {
    this.scene = scene;
    this.game = game;
    this.snapshot = buildSceneTextLayerSnapshot(scene, game);
    this.snapshotKey = this.getSnapshotKey();
  }

  private getSnapshotKey(): string {
    const activeSubscene = this.scene.activeSubscene || '';
    return [
      activeSubscene,
      ...this.scene.getAllSceneObjects().map((object) => {
        const spatial = (object as any).spatial || {};
        return [
          object.name,
          object.disabled ? '1' : '0',
          object.visible ? '1' : '0',
          String(spatial.parentNodeId || ''),
          String(spatial.relation || ''),
        ].join(':');
      }),
    ].join('|');
  }

  private ensureSnapshot(): void {
    const nextKey = this.getSnapshotKey();
    if (nextKey === this.snapshotKey) return;
    this.snapshot = buildSceneTextLayerSnapshot(this.scene, this.game);
    this.snapshotKey = nextKey;
  }

  get entries(): SceneTextLayerEntry[] {
    this.ensureSnapshot();
    return this.snapshot.entries;
  }

  get entryById(): Map<string, SceneTextLayerEntry> {
    this.ensureSnapshot();
    return this.snapshot.entryById;
  }

  get childrenByParentId(): Map<string, SceneTextLayerEntry[]> {
    this.ensureSnapshot();
    return this.snapshot.childrenByParentId;
  }

  get childrenByParentAndRelation(): Map<string, Map<EffectiveRelation, SceneTextLayerEntry[]>> {
    this.ensureSnapshot();
    return this.snapshot.childrenByParentAndRelation;
  }

  getAccessState(object: SceneObject): SceneTextLayerAccessState {
    this.ensureSnapshot();
    return getSceneTextLayerAccessState(
      this.scene,
      this.game,
      object,
      this.snapshot.objectById,
      this.snapshot.titleById
    );
  }

  getRelationDescendants(anchorNodeId: string, relation: EffectiveRelation): SceneTextLayerEntry[] {
    this.ensureSnapshot();
    return getSceneTextRelationDescendants(this.snapshot, anchorNodeId, relation);
  }

  getRelationAccessStates(
    anchorNodeId: string,
    relation: EffectiveRelation,
    options?: { includeHidden?: boolean }
  ): SceneTextRelationAccessState[] {
    this.ensureSnapshot();
    return getSceneTextRelationAccessStates(this.scene, this.game, anchorNodeId, relation, options);
  }

  getTargetDescriptor(
    target: SceneObject | null | undefined,
    fallbackRelation?: SpatialPlacement['relation'] | null
  ): SceneTextTargetDescriptor | null {
    this.ensureSnapshot();
    return getSceneTextTargetDescriptor(this.scene, this.game, target, fallbackRelation);
  }
}

export function createSceneTextLayerQuery(scene: Scene, game: IGame): SceneTextLayerQuery {
  return new SceneTextLayerQuery(scene, game);
}
