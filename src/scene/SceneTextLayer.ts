import type { IGame } from '../core/IGame';
import type { SceneObject } from '../entities/SceneObject';
import type { Triggerbox } from '../entities/Triggerbox';
import type { BlockerComponent, SwitchComponent } from '../systems/ComponentSystem';
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
};

function getSceneObjectTitle(game: IGame, object: SceneObject): string | null {
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

function getSwitchComponent(object: SceneObject | null): SwitchComponent | null {
  if (!object?.components?.length) return null;
  const component = object.components.find((candidate: any) => candidate?.type === 'Switch');
  return (component as SwitchComponent | undefined) || null;
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

  const switchComponent = getSwitchComponent(object);
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
      if (!gatingSwitch) gatingSwitch = parentObject;
      gatingSwitchTransparent = blockingComponent.transparent;
      gatingSwitchClearlyOpenable = blockingComponent.clearlyOpenable;
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
  };
}
