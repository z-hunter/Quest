import type { GameActionOutcome } from '../../src/core/GameActionTypes';
import { Parser } from '../../src/mechanics/Parser';
import { ComponentSystem } from '../../src/systems/ComponentSystem';
import {
  getSceneTextLayerAccessState,
  buildSceneTextLayerSnapshot,
  getActiveBlockingComponentState,
  getSceneTextRelationDescendants,
  getSceneTextTargetDescriptor,
} from '../../src/scene/SceneTextLayer';
import { createSceneFixture, type SceneFixture } from './sceneFactory';
import { Entity } from '../../src/entities/Entity';

export type ParserFixture = SceneFixture & {
  parser: Parser;
  run(input: string): Promise<{
    messages: string[];
    logs: string[];
    pendingIntent: string | null;
  }>;
};

function okOutcome(
  code: string,
  message?: string,
  data?: Record<string, unknown>
): GameActionOutcome {
  return { status: 'ok', code, message, data };
}

export function createParserFixture(): ParserFixture {
  const fixture = createSceneFixture();

  const getSemanticHiddenMode = (entity: Entity): false | 'lookable' | 'examinable' =>
    entity.hidden === 'lookable' || entity.hidden === 'examinable' ? entity.hidden : false;

  const revealHiddenEntityForIntent = (entity: Entity, intent: 'look' | 'examine'): boolean => {
    const hiddenMode = getSemanticHiddenMode(entity);
    if (!hiddenMode) return false;
    if (fixture.scene.isHiddenEntityRevealed(entity)) return false;
    if (intent === 'look' && hiddenMode !== 'lookable') return false;
    fixture.scene.revealHiddenEntity(entity);
    return true;
  };

  const getAccessOutcome = (entity: Entity, _mode: 'look' | 'interact') => {
    const accessState = getSceneTextLayerAccessState(fixture.scene, fixture.game, entity);
    if (!accessState.hidden && !accessState.blocked) return null;

    if (accessState.hidden) {
      if (accessState.hiddenReason === 'lookable' || accessState.hiddenReason === 'examinable') {
        return {
          status: 'failed' as const,
          code: 'hidden_semantic_target',
          message: fixture.game.text('parser.look_not_found', {
            target: fixture.textAssets.getResolvedObjectField(entity, 'title') || entity.name,
          }),
          recoverable: true,
        };
      }
      if (accessState.gatingSwitchClearlyOpenable && accessState.gatingSwitchTitle) {
        return {
          status: 'failed' as const,
          code: 'blocked_by_closed_container',
          message: fixture.game.text('engine.closed_container', {
            target: accessState.gatingSwitchTitle,
          }),
          recoverable: true,
        };
      }
      return {
        status: 'failed' as const,
        code: 'cannot_reach_hidden_target',
        message: fixture.game.text('engine.cant_reach_generic'),
        recoverable: true,
      };
    }

    return {
      status: 'failed' as const,
      code: 'blocked_inside_closed',
      message: fixture.game.text(
        accessState.gatingSwitchClearlyOpenable
          ? 'engine.blocked_inside_closed'
          : 'engine.cant_reach_generic'
      ),
      recoverable: true,
    };
  };

  fixture.game.console = {
    parserStage1Enabled: true,
    parserStage2Enabled: false,
    parserPeekEnabled: false,
    parserPeekLlmEnabled: false,
    log() {},
  };

  fixture.game.lookScene = (scene = fixture.game.sceneManager.currentScene) => {
    const targetScene = (scene as any) || fixture.scene;
    const description =
      fixture.textAssets.getResolvedSceneField(targetScene as any, 'description') ||
      targetScene?.description ||
      `You are in ${targetScene?.name || 'Unknown Scene'}.`;
    return okOutcome('scene_description', description, {
      targetType: 'scene',
      sceneId: targetScene?.id,
    });
  };

  fixture.game.lookEntity = (entity: Entity) => {
    revealHiddenEntityForIntent(entity, 'look');
    if (fixture.game.inventoryManager.isEntityInInventory(entity)) {
      const details = fixture.textAssets.getResolvedObjectField(entity, 'details');
      const description = fixture.textAssets.getResolvedObjectField(entity, 'description');
      if (details) return okOutcome('entity_details', details, { entityId: entity.name });
      if (description)
        return okOutcome('entity_description', description, { entityId: entity.name });
    }
    const accessOutcome = getAccessOutcome(entity, 'look');
    if (accessOutcome) return accessOutcome;
    const description =
      fixture.textAssets.getResolvedObjectField(entity, 'description') || entity.description;
    if (description?.trim()) {
      return okOutcome('entity_description', description, {
        targetType: 'entity',
        entityId: entity.name,
      });
    }
    return { status: 'escalate', code: 'missing_description', recoverable: true };
  };

  fixture.game.examineEntity = (entity: Entity) => {
    revealHiddenEntityForIntent(entity, 'examine');
    const accessOutcome = getAccessOutcome(entity, 'interact');
    if (accessOutcome) return accessOutcome;
    const distanceError = ComponentSystem.getInteractionDistanceError(
      entity as any,
      fixture.scene.player
    );
    if (distanceError && !fixture.game.inventoryManager.isEntityInInventory(entity)) {
      return {
        status: 'failed',
        code: 'too_far_to_examine',
        message: distanceError,
        recoverable: true,
      };
    }
    const details = fixture.textAssets.getResolvedObjectField(entity, 'details');
    if (details?.trim()) {
      return okOutcome('entity_details', details, { entityId: entity.name });
    }
    const description =
      fixture.textAssets.getResolvedObjectField(entity, 'description') || entity.description;
    if (description?.trim()) {
      return okOutcome('entity_description_fallback', description, { entityId: entity.name });
    }
    return { status: 'escalate', code: 'missing_details', recoverable: true };
  };

  fixture.game.openEntity = (entity: Entity) => {
    const accessOutcome = getAccessOutcome(entity, 'interact');
    if (accessOutcome) return accessOutcome;
    const switchComponent = entity.components?.find(
      (component: any) => component?.type === 'Switch'
    ) as { state?: number; idKey?: string } | undefined;
    if (!switchComponent) {
      return { status: 'escalate', code: 'target_is_not_switch', recoverable: true };
    }
    const title = fixture.textAssets.getResolvedObjectField(entity, 'title') || entity.name;
    if ((switchComponent.state || 1) === 2) {
      return {
        status: 'failed',
        code: 'switch_already_open',
        message: fixture.game.text('parser.open_already', { target: title }),
        recoverable: true,
      };
    }
    switchComponent.state = 2;
    return okOutcome('switch_opened', fixture.game.text('parser.open_success', { target: title }));
  };

  fixture.game.closeEntity = (entity: Entity) => {
    const accessOutcome = getAccessOutcome(entity, 'interact');
    if (accessOutcome) return accessOutcome;
    const switchComponent = entity.components?.find(
      (component: any) => component?.type === 'Switch'
    ) as { state?: number; idKey?: string } | undefined;
    if (!switchComponent) {
      return { status: 'escalate', code: 'target_is_not_switch', recoverable: true };
    }
    const title = fixture.textAssets.getResolvedObjectField(entity, 'title') || entity.name;
    if ((switchComponent.state || 1) === 1) {
      return {
        status: 'failed',
        code: 'switch_already_closed',
        message: fixture.game.text('parser.close_already', { target: title }),
        recoverable: true,
      };
    }
    switchComponent.state = 1;
    return okOutcome('switch_closed', fixture.game.text('parser.close_success', { target: title }));
  };

  fixture.game.takeEntity = (entity: Entity) => {
    if (fixture.game.inventoryManager.hasEntityIdInInventory(entity)) {
      return {
        status: 'failed',
        code: 'item_already_held',
        message: fixture.game.text('parser.take_already_held', {
          item: fixture.textAssets.getResolvedObjectField(entity, 'title') || entity.name,
        }),
        data: { entityId: entity.name },
        recoverable: true,
      };
    }
    const accessOutcome = getAccessOutcome(entity, 'interact');
    if (accessOutcome) return accessOutcome;
    const error = ComponentSystem.canTakeItem(entity as any, fixture.scene.player);
    if (error) {
      return { status: 'failed', code: 'cannot_take', message: error, recoverable: true };
    }
    fixture.scene.removeEntity(entity);
    (entity as any).spatial = null;
    fixture.scene.subsceneEntities.delete(entity);
    fixture.game.inventory.push(entity);
    const title = fixture.textAssets.getResolvedObjectField(entity, 'title') || entity.name;
    return okOutcome(
      'item_taken',
      fixture.game.text('parser.take_pickup_success', { item: title }),
      {
        entityId: entity.name,
      }
    );
  };

  const normalizeInventoryRelation = (component: any): 'in' | 'on' | 'under' | 'behind' =>
    component?.relation === 'on' ||
    component?.relation === 'under' ||
    component?.relation === 'behind' ||
    component?.relation === 'in'
      ? component.relation
      : 'in';
  const normalizeSurfaceRelation = (component: any): 'in' | 'on' | 'under' | 'behind' =>
    component?.relation === 'in' ||
    component?.relation === 'on' ||
    component?.relation === 'under' ||
    component?.relation === 'behind'
      ? component.relation
      : 'on';
  const formatPutSuccess = (
    item: string,
    target: string,
    relation: 'in' | 'on' | 'under' | 'behind'
  ) => {
    switch (relation) {
      case 'in':
        return fixture.game.text('parser.put_success_inventory', { item, target });
      case 'under':
        return fixture.game.text('parser.put_success_under', { item, target });
      case 'behind':
        return fixture.game.text('parser.put_success_behind', { item, target });
      case 'on':
      default:
        return fixture.game.text('parser.put_success_surface', { item, target });
    }
  };
  const formatTitleList = (items: string[]) => {
    if (items.length <= 1) return items[0] || '';
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
  };
  const getPlacementTextTarget = (
    storageObject: any,
    explicitTarget: any,
    relation: any
  ): { title: string; relation: 'in' | 'on' | 'under' | 'behind' } | null => {
    return (
      getSceneTextTargetDescriptor(fixture.scene, fixture.game, explicitTarget, relation) ||
      getSceneTextTargetDescriptor(fixture.scene, fixture.game, storageObject, relation)
    );
  };
  const hasTitle = (object: any) =>
    !!fixture.textAssets.getResolvedObjectField(object, 'title')?.trim();

  const isRelation = (relation: any): relation is 'in' | 'on' | 'under' | 'behind' =>
    relation === 'in' || relation === 'on' || relation === 'under' || relation === 'behind';

  const getUntitledStorageExtensions = (
    anchor: any,
    relation: 'in' | 'on' | 'under' | 'behind'
  ) => {
    const queue = fixture.scene
      .getAllSceneObjects()
      .filter((candidate: any) => candidate?.spatial?.parentNodeId === anchor.name)
      .filter((candidate: any) => candidate?.spatial?.relation === relation)
      .filter((candidate: any) => !hasTitle(candidate));
    const results: any[] = [];

    while (queue.length) {
      const current = queue.shift();
      if (!current) continue;
      results.push(current);
      queue.push(
        ...fixture.scene
          .getAllSceneObjects()
          .filter((candidate: any) => candidate?.spatial?.parentNodeId === current.name)
          .filter((candidate: any) => !hasTitle(candidate))
      );
    }

    return results;
  };

  const getStorageCandidates = (anchor: any, relation: 'in' | 'on' | 'under' | 'behind') => {
    const inventoryOwners: Array<{ owner: Entity; relation: 'in' | 'on' | 'under' | 'behind' }> =
      [];
    const surfaces: Array<{ surface: any; relation: 'in' | 'on' | 'under' | 'behind' }> = [];

    if (
      anchor instanceof Entity &&
      anchor.components?.some(
        (entry: any) =>
          entry?.type === 'Inventory' &&
          normalizeInventoryRelation(entry) === relation &&
          !entry.protected
      )
    ) {
      inventoryOwners.push({ owner: anchor, relation });
    }
    if (ComponentSystem.getSurfaceComponent(anchor, relation)) {
      surfaces.push({ surface: anchor, relation });
    }

    for (const extension of getUntitledStorageExtensions(anchor, relation)) {
      if (extension instanceof Entity) {
        for (const component of extension.components || []) {
          if (component?.type !== 'Inventory' || component.protected) continue;
          inventoryOwners.push({
            owner: extension,
            relation: normalizeInventoryRelation(component),
          });
        }
      }
      for (const component of extension.components || []) {
        if (component?.type !== 'Surface') continue;
        surfaces.push({
          surface: extension,
          relation: normalizeSurfaceRelation(component),
        });
      }
    }

    return { inventoryOwners, surfaces };
  };

  fixture.game.getInventoryEntities = (
    owner: Entity,
    relation: 'in' | 'on' | 'under' | 'behind' = 'in'
  ) => {
    if (fixture.scene.player === owner) {
      return [...fixture.game.inventory];
    }
    const component = owner.components?.find(
      (entry: any) => entry?.type === 'Inventory' && normalizeInventoryRelation(entry) === relation
    ) as { items?: string[] } | undefined;
    return (component?.items || [])
      .map((id) => fixture.scene.getObjectByName(id))
      .filter((candidate): candidate is Entity => candidate instanceof Entity);
  };

  (fixture.game as any).getAccessibleInventoryItems = () =>
    fixture.scene
      .getAllSceneObjects()
      .filter(
        (candidate): candidate is Entity =>
          candidate instanceof Entity && candidate !== fixture.scene.player
      )
      .flatMap((owner) => fixture.game.getInventoryEntities(owner))
      .filter((entity: Entity) => !entity.disabled);

  fixture.game.hasInventoryEntity = (
    owner: Entity,
    entity: Entity,
    relation: 'in' | 'on' | 'under' | 'behind' = 'in'
  ) => fixture.game.getInventoryEntities(owner, relation).includes(entity);

  (fixture.game as any).getSurfaceEntities = (
    surface: any,
    relation: 'in' | 'on' | 'under' | 'behind' = 'on'
  ) => {
    const component = ComponentSystem.getSurfaceComponent(surface, relation) as
      | { items?: Array<{ id: string }> }
      | undefined;
    const collected = new Set<Entity>();
    for (const candidate of (component?.items || [])
      .map((item) => fixture.scene.getObjectByName(item.id))
      .filter(
        (candidate): candidate is Entity => candidate instanceof Entity && !candidate.disabled
      )) {
      collected.add(candidate);
    }
    for (const candidate of fixture.scene.entities) {
      if (!(candidate instanceof Entity) || candidate.disabled) continue;
      let current: any = candidate;
      const visitedParentIds = new Set<string>();
      while (current) {
        const parentId = String(current?.spatial?.parentNodeId || '').trim();
        if (!parentId) break;
        if (visitedParentIds.has(parentId)) break;
        visitedParentIds.add(parentId);
        if (parentId === surface.name) {
          collected.add(candidate);
          break;
        }
        current = fixture.scene.getObjectByName(parentId);
      }
    }
    return Array.from(collected);
  };

  (fixture.game as any).hasPutStorageForRelation = (
    target: any,
    relation: 'in' | 'on' | 'under' | 'behind' | 'near' | null
  ) => {
    if (!isRelation(relation)) return false;
    const storage = getStorageCandidates(target, relation);
    return !!storage.inventoryOwners.length || !!storage.surfaces.length;
  };

  (fixture.game as any).getRelationScopedTakeCandidates = (
    anchor: any,
    relation: 'in' | 'on' | 'under' | 'behind' | 'near'
  ) => {
    if (!isRelation(relation)) {
      return { status: 'resolved', candidates: [], hasStorage: false };
    }

    const textLayer = buildSceneTextLayerSnapshot(fixture.scene, fixture.game);
    const getRelationCandidates = (candidateRelation: 'in' | 'on' | 'under' | 'behind') =>
      getSceneTextRelationDescendants(textLayer, anchor.name, candidateRelation)
        .map((entry) => entry.object)
        .filter((candidate): candidate is Entity => candidate instanceof Entity)
        .filter((candidate) => !candidate.disabled)
        .filter(
          (candidate) =>
            candidate.components?.some((component: any) => component?.type === 'Item') ||
            candidate.isTakeable
        );
    const relationEntries = getSceneTextRelationDescendants(textLayer, anchor.name, relation);
    let semanticCandidates = getRelationCandidates(relation);

    if (!semanticCandidates.length && relation === 'in') {
      // describeSpatialRelation produces relationOutcome just to validate before semanticCandidates falls back to getRelationCandidates.
      const _relationOutcome = fixture.game.describeSpatialRelation(anchor.name, relation);
      const relationOutcome = _relationOutcome;
      if (relationOutcome.status === 'failed') return relationOutcome;
      semanticCandidates = ['on', 'under', 'behind'].flatMap((candidateRelation) =>
        getRelationCandidates(candidateRelation as 'on' | 'under' | 'behind')
      );
    }

    const storage = getStorageCandidates(anchor, relation);
    const candidates = [...semanticCandidates];
    for (const owner of storage.inventoryOwners) {
      candidates.push(...fixture.game.getInventoryEntities(owner.owner, owner.relation));
    }
    for (const surface of storage.surfaces) {
      candidates.push(
        ...(fixture.game as any).getSurfaceEntities(surface.surface, surface.relation)
      );
    }

    return {
      status: 'resolved',
      candidates: Array.from(new Set(candidates)),
      hasStorage:
        relationEntries.length > 0 ||
        semanticCandidates.length > 0 ||
        storage.inventoryOwners.length > 0 ||
        storage.surfaces.length > 0,
    };
  };

  (fixture.game as any).isEntityInPutTarget = (
    source: any,
    target: any,
    relation: 'in' | 'on' | 'under' | 'behind' | 'near' | null
  ) => {
    if (!(source instanceof Entity)) return false;
    const relations: Array<'in' | 'on' | 'under' | 'behind'> = isRelation(relation)
      ? [relation]
      : ['in', 'on', 'under', 'behind'];

    for (const candidateRelation of relations) {
      const storage = getStorageCandidates(target, candidateRelation);
      if (
        storage.inventoryOwners.some((owner) =>
          fixture.game.getInventoryEntities(owner.owner, owner.relation).includes(source)
        )
      ) {
        return true;
      }
      if (
        storage.surfaces.some((surface) =>
          (fixture.game as any)
            .getSurfaceEntities(surface.surface, surface.relation)
            .includes(source)
        )
      ) {
        return true;
      }

      const textLayer = buildSceneTextLayerSnapshot(fixture.scene, fixture.game);
      if (
        getSceneTextRelationDescendants(textLayer, target.name, candidateRelation).some(
          (entry) => entry.object === source
        )
      ) {
        return true;
      }
    }

    return false;
  };

  fixture.game.addInventoryEntity = (
    owner: Entity,
    entity: Entity,
    relation: 'in' | 'on' | 'under' | 'behind' = 'in'
  ) => {
    const component = (owner.components ||= []).find(
      (entry: any) => entry?.type === 'Inventory' && normalizeInventoryRelation(entry) === relation
    ) as { type: 'Inventory'; items?: string[]; capacity?: number; groups?: string[] } | undefined;
    if (!component) {
      return {
        status: 'failed',
        code: 'inventory_missing',
        message: fixture.game.text('parser.put_no_place'),
        recoverable: true,
      };
    }
    const inventoryComponent = component;
    inventoryComponent.items ||= [];
    const storedEntities =
      (fixture.game.inventoryManager as any).getStoredInventoryEntities?.(owner, relation) ||
      inventoryComponent.items
        .map((id) => fixture.scene.getObjectByName(id))
        .filter((candidate): candidate is Entity => candidate instanceof Entity);
    if (storedEntities.includes(entity)) {
      if (fixture.game.inventory.includes(entity)) {
        fixture.game.removeInventoryEntity(entity);
        (fixture.game.inventoryManager as any).syncInventoryStore?.(
          owner,
          storedEntities,
          relation
        );
        return okOutcome('inventory_item_added', undefined, {
          entityId: entity.name,
          ownerId: owner.name,
        });
      }
      return {
        status: 'failed',
        code: 'inventory_item_already_present',
        message: fixture.game.text('parser.put_no_place'),
        recoverable: true,
      };
    }
    if (storedEntities.length >= (inventoryComponent.capacity || Number.MAX_SAFE_INTEGER)) {
      return {
        status: 'failed',
        code: 'inventory_full',
        message: fixture.game.text('parser.put_target_full_in', {
          target: fixture.textAssets.getResolvedObjectField(owner, 'title') || owner.name,
        }),
        recoverable: true,
      };
    }
    if (fixture.game.inventory.includes(entity)) {
      fixture.game.removeInventoryEntity(entity);
    }
    if (!fixture.scene.entities.includes(entity)) {
      fixture.scene.addEntity(entity);
    }
    (entity as any).spatial = { parentNodeId: owner.name, relation };
    entity.visible = false;
    fixture.scene.subsceneEntities.delete(entity);
    (fixture.game.inventoryManager as any).syncInventoryStore?.(
      owner,
      [...storedEntities, entity],
      relation
    );
    return okOutcome('inventory_item_added', undefined, {
      entityId: entity.name,
      ownerId: owner.name,
    });
  };

  fixture.game.removeEntityFromInventory = (
    owner: Entity,
    entity: Entity,
    relation: 'in' | 'on' | 'under' | 'behind' = 'in'
  ) => {
    if (fixture.scene.player === owner) {
      return fixture.game.removeInventoryEntity(entity);
    }
    const component = owner.components?.find(
      (entry: any) => entry?.type === 'Inventory' && normalizeInventoryRelation(entry) === relation
    ) as { items?: string[] } | undefined;
    if (!component?.items?.includes(entity.name)) {
      return { status: 'failed', code: 'inventory_item_not_found', recoverable: true };
    }
    component.items = component.items.filter((id) => id !== entity.name);
    return okOutcome('inventory_item_removed', undefined, {
      entityId: entity.name,
      ownerId: owner.name,
    });
  };

  fixture.game.addEntityToSurface = (
    surface: any,
    entity: Entity,
    relation: 'in' | 'on' | 'under' | 'behind' = 'on'
  ) => {
    const component = ComponentSystem.getSurfaceComponent(surface, relation) as
      | { items?: Array<{ id: string; y: number; x: number }> }
      | undefined;
    if (!component) {
      return { status: 'failed', code: 'surface_missing', recoverable: true };
    }
    component.items ||= [];
    if (!fixture.scene.entities.includes(entity)) {
      fixture.scene.addEntity(entity);
    }
    (entity as any).spatial = {
      parentNodeId: surface.name,
      relation: hasTitle(surface) ? relation : 'on',
    };
    component.items.push({ id: entity.name, x: entity.x, y: entity.y });
    return okOutcome('surface_item_added', undefined, {
      entityId: entity.name,
      surfaceId: surface.name,
    });
  };

  fixture.game.removeEntityFromSurface = (
    surface: any,
    entity: Entity,
    relation: 'in' | 'on' | 'under' | 'behind' = 'on'
  ) => {
    const component = ComponentSystem.getSurfaceComponent(surface, relation) as
      | { items?: Array<{ id: string; y: number; x: number }> }
      | undefined;
    if (!component?.items?.some((item) => item.id === entity.name)) {
      return { status: 'failed', code: 'surface_item_not_found', recoverable: true };
    }
    component.items = component.items.filter((item) => item.id !== entity.name);
    return okOutcome('surface_item_removed', undefined, {
      entityId: entity.name,
      surfaceId: surface.name,
    });
  };

  fixture.game.putEntity = (
    entity: Entity,
    target?: any,
    options?: { relation?: string | null }
  ) => {
    if (target === entity) {
      return {
        status: 'failed',
        code: 'put_target_is_source',
        message: fixture.game.text('parser.put_no_place'),
        recoverable: true,
      };
    }
    const isHeld = fixture.game.inventory.includes(entity);
    if (!isHeld && !target) {
      return {
        status: 'failed',
        code: 'put_item_not_held',
        message: fixture.game.text('parser.put_item_not_held', { item: entity.name }),
        recoverable: true,
      };
    }
    if (!isHeld) {
      const takeError = ComponentSystem.canTakeItem(entity as any, fixture.scene.player || null);
      if (takeError) {
        return {
          status: 'failed',
          code: 'put_source_not_accessible',
          message: takeError,
          recoverable: true,
        };
      }
    }

    const getTargetDistanceFailure = () => {
      if (!target) return null;
      const player = fixture.scene.player || null;
      const distanceProbe =
        target?.title === null || !fixture.textAssets.getResolvedObjectField(target, 'title')
          ? target
          : target.object || target;
      const distanceError = ComponentSystem.getInteractionDistanceError(
        distanceProbe as any,
        player
      );
      if (!distanceError) return null;
      return {
        status: 'failed',
        code: 'put_target_too_far',
        message: distanceError,
        recoverable: true,
      };
    };

    if (options?.relation && target) {
      const storage = isRelation(options.relation)
        ? getStorageCandidates(target, options.relation)
        : { inventoryOwners: [], surfaces: [] };
      const nestedInventory = storage.inventoryOwners[0]?.owner || null;
      if (nestedInventory) {
        const distanceFailure = getTargetDistanceFailure();
        if (distanceFailure) return distanceFailure;
        const inventoryRelation = storage.inventoryOwners[0]?.relation || options.relation;
        const outcome = fixture.game.addInventoryEntity(
          nestedInventory as Entity,
          entity,
          inventoryRelation as 'in' | 'on' | 'under' | 'behind'
        );
        if (outcome.status !== 'ok') return outcome;
        const textTarget = getPlacementTextTarget(nestedInventory, target, inventoryRelation);
        return okOutcome(
          'item_put_into_inventory',
          textTarget
            ? formatPutSuccess(entity.name, textTarget.title, textTarget.relation)
            : fixture.game.text('parser.put_success_inventory', {
                item: entity.name,
                target: nestedInventory.name,
              })
        );
      }
    }

    const surfaceSlot =
      target && isRelation(options?.relation)
        ? getStorageCandidates(target, options.relation).surfaces[0] || null
        : null;
    const surface =
      surfaceSlot?.surface ||
      (target?.components?.some(
        (entry: any) => entry?.type === 'Surface' && normalizeSurfaceRelation(entry) === 'on'
      )
        ? target
        : null) ||
      (!target
        ? fixture.scene
            .getAllSceneObjects()
            .find((candidate) =>
              candidate.components?.some((entry: any) => entry?.type === 'Surface')
            ) || null
        : null);
    if (!surface) {
      return {
        status: 'failed',
        code: 'put_target_not_found',
        message: fixture.game.text('parser.put_no_place'),
        recoverable: true,
      };
    }

    const distanceFailure = getTargetDistanceFailure();
    if (distanceFailure) return distanceFailure;

    if (isHeld) {
      fixture.game.removeInventoryEntity(entity);
    }
    const surfaceStoreRelation =
      surfaceSlot?.relation ||
      (target &&
      surface === target &&
      (target?.components?.some(
        (entry: any) =>
          entry?.type === 'Surface' && normalizeSurfaceRelation(entry) === options?.relation
      ) ||
        (target?.type === 'Walkbox' &&
          options?.relation === 'on' &&
          target?.components?.some((entry: any) => entry?.type === 'Surface')))
        ? (options?.relation as 'in' | 'on' | 'under' | 'behind' | undefined) || 'on'
        : 'on');
    const surfaceOutcome = fixture.game.addEntityToSurface(surface, entity, surfaceStoreRelation);
    if (surfaceOutcome.status !== 'ok') return surfaceOutcome;
    const textTarget = getPlacementTextTarget(
      surface,
      target,
      options?.relation || surfaceStoreRelation
    );
    const message = textTarget
      ? formatPutSuccess(entity.name, textTarget.title, textTarget.relation)
      : fixture.game.text('parser.drop_success', { item: entity.name });
    return okOutcome('item_put_on_surface', message);
  };

  fixture.game.removeInventoryEntity = (entity: Entity) => {
    const index = fixture.game.inventory.indexOf(entity);
    if (index === -1) {
      return { status: 'failed', code: 'inventory_item_not_found', recoverable: true };
    }
    fixture.game.inventory.splice(index, 1);
    return okOutcome('inventory_item_removed', undefined, { entityId: entity.name });
  };

  fixture.game.showInventory = () => {
    const items = fixture.game.inventory
      .map((entity) => fixture.textAssets.getResolvedObjectField(entity, 'title'))
      .filter((title): title is string => !!title);
    if (!items.length) {
      return okOutcome('inventory_list', fixture.game.text('parser.inventory_empty'));
    }
    return okOutcome(
      'inventory_list',
      fixture.game.text('parser.inventory_items', { items: items.join(', ') })
    );
  };

  fixture.game.goToSceneTarget = (target: string) => {
    const normalized = String(target || '')
      .trim()
      .toUpperCase();
    for (const descriptor of fixture.game.sceneManager.sceneRegistry.values()) {
      if (
        descriptor.id.toUpperCase() === normalized ||
        descriptor.name.toUpperCase() === normalized ||
        (!!descriptor.title && descriptor.title.toUpperCase() === normalized)
      ) {
        return fixture.game.goToScene(descriptor.id);
      }
    }
    return { status: 'failed', code: 'destination_not_found', recoverable: true };
  };

  fixture.game.goToScene = (sceneId: string) => {
    const scene = fixture.game.sceneManager.scenes.get(sceneId);
    if (!scene) {
      return { status: 'failed', code: 'destination_not_found', recoverable: true };
    }
    fixture.game.sceneManager.currentScene = scene;
    return okOutcome('scene_switched', scene.description, { sceneId });
  };

  fixture.game.goToEntity = (entity: Entity) => {
    fixture.scene.player?.moveTo(entity.x, entity.y);
    const title = fixture.textAssets.getResolvedObjectField(entity, 'title') || entity.name;
    return okOutcome(
      'player_moving',
      fixture.game.text('parser.go_to_success', { target: title }),
      {
        entityId: entity.name,
      }
    );
  };

  fixture.game.describeSpatialRelation = (anchorNodeId, relation) => {
    const textLayer = buildSceneTextLayerSnapshot(fixture.scene, fixture.game);
    const anchorTitle = textLayer.entryById.get(anchorNodeId)?.title?.trim();
    if (!anchorTitle) {
      return { status: 'escalate', code: 'spatial_node_missing_title', recoverable: true };
    }
    if (relation !== 'near') {
      const anchorObject = fixture.scene.getObjectByName(anchorNodeId);
      const blockingComponent = anchorObject
        ? getActiveBlockingComponentState(anchorObject as any, relation)
        : null;
      if (blockingComponent && !blockingComponent.transparent) {
        if (blockingComponent.clearlyOpenable) {
          return {
            status: 'failed',
            code: 'blocked_by_closed_container',
            message: fixture.game.text('engine.closed_container', { target: anchorTitle }),
            recoverable: true,
          };
        }
      }
    }
    const childTitles = getSceneTextRelationDescendants(
      textLayer,
      anchorNodeId,
      relation as 'in' | 'on' | 'under' | 'behind'
    )
      .map((entry) => entry.title)
      .filter((title): title is string => !!title);
    if (!childTitles.length) {
      return okOutcome(
        'relation_empty',
        fixture.game.text('parser.relation_empty', { relation, target: anchorTitle })
      );
    }
    return okOutcome(
      'relation_contents',
      fixture.game.text('parser.relation_contents', {
        Relation: relation.charAt(0).toUpperCase() + relation.slice(1),
        relation,
        target: anchorTitle,
        items: formatTitleList(childTitles),
      })
    );
  };

  const parser = new Parser(fixture.game);

  return {
    ...fixture,
    parser,
    async run(input: string) {
      fixture.messages.length = 0;
      fixture.logs.length = 0;
      await parser.parse(input);
      return {
        messages: [...fixture.messages],
        logs: [...fixture.logs],
        pendingIntent: parser.pendingState?.intent || null,
      };
    },
  };
}
