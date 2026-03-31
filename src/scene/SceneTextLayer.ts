import type { IGame } from '../core/IGame';
import type { SceneObject } from '../entities/SceneObject';
import type { Triggerbox } from '../entities/Triggerbox';
import type { SwitchComponent } from '../systems/ComponentSystem';
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

function getSwitchComponent(object: SceneObject | null): SwitchComponent | null {
  if (!object?.components?.length) return null;
  const component = object.components.find((candidate: any) => candidate?.type === 'Switch');
  return (component as SwitchComponent | undefined) || null;
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
  const subsceneComponent = triggerbox.components?.find((component: any) => component?.type === 'Subscene') as
    | { targetGroupId?: string }
    | undefined;
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

export function buildSceneTextLayerSnapshot(
  scene: Scene,
  game: IGame
): SceneTextLayerSnapshot {
  const allObjects = scene.getAllSceneObjects();
  const objectById = new Map(allObjects.map((object) => [object.name, object] as const));
  const titleById = new Map(allObjects.map((object) => [object.name, getSceneObjectTitle(game, object)] as const));

  const entries: SceneTextLayerEntry[] = [];

  for (const object of allObjects) {
    const title = titleById.get(object.name);
    if (!title) continue;

    const placement = getPlacement(scene, object);
    let currentParentId = placement?.parentNodeId || null;
    let relationToAncestor = normalizeRelation(placement?.relation) || null;
    let effectiveParentId: string | null = null;
    let blocked = false;
    let hidden = false;
    let inInactiveSubscene = false;

    while (currentParentId) {
      const parentObject = objectById.get(currentParentId) || null;
      if (!parentObject) break;

      if (isSubsceneTriggerbox(parentObject)) {
        const subsceneRootId = getSubsceneRootId(parentObject);
        if (subsceneRootId && scene.activeSubscene !== subsceneRootId) {
          inInactiveSubscene = true;
        }
      }

      const switchComponent = getSwitchComponent(parentObject);
      if (switchComponent && relationToAncestor === 'in' && (switchComponent.state || 1) !== 2) {
        if ((switchComponent as SwitchComponent & { transparent?: boolean }).transparent) {
          blocked = true;
        } else {
          hidden = true;
        }
      }

      if (!effectiveParentId && titleById.get(parentObject.name)) {
        effectiveParentId = parentObject.name;
      }

      const parentPlacement = getPlacement(scene, parentObject);
      currentParentId = parentPlacement?.parentNodeId || null;
      relationToAncestor = normalizeRelation(parentPlacement?.relation) || null;
    }

    if (hidden) continue;

    entries.push({
      object,
      title,
      effectiveParentId,
      effectiveRelation: normalizeRelation(placement?.relation) || null,
      blocked,
      inInactiveSubscene,
    });
  }

  const entryById = new Map(entries.map((entry) => [entry.object.name, entry] as const));
  const childrenByParentId = new Map<string, SceneTextLayerEntry[]>();
  const childrenByParentAndRelation = new Map<string, Map<EffectiveRelation, SceneTextLayerEntry[]>>();

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
