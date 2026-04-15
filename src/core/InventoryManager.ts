import { Entity } from '../entities/Entity';
import { SceneObject } from '../entities/SceneObject';
import { ComponentSystem } from '../systems/ComponentSystem';
import type {
  InventoryComponent,
  SurfaceComponent,
  SurfaceItemPlacement,
} from '../systems/ComponentSystem';
import { Geometry } from '../utils/Geometry';
import type { GameActionOutcome } from './GameActionTypes';
import type { TextAssetManager } from './TextAssetManager';
import type { SceneManager } from '../scene/SceneManager';
import type { SpatialRelationType } from '../scene/spatialTypes';

type ContainerRelation = Exclude<SpatialRelationType, 'near'>;

type InventorySlotRef = {
  owner: Entity;
  component: InventoryComponent;
  relation: ContainerRelation;
};

type SurfaceSlotRef = {
  surface: SceneObject;
  component: SurfaceComponent;
  relation: ContainerRelation;
};

export class InventoryManager {
  /** Player inventory — the canonical list used by IGame.inventory getter-proxy. */
  inventory: Entity[] = [];

  private readonly inventoryEntityStore = new Map<string, Entity[]>();
  private inventoryPreviewEntity: Entity | null = null;
  private inventoryPreviewText: string | null = null;
  private readonly inventoryUiListeners = new Set<() => void>();
  private putDebugEnabled = false;

  private sceneManager: SceneManager;
  private textAssets: TextAssetManager;
  private getText: (key: string, params?: Record<string, string | number>) => string;

  constructor(
    sceneManager: SceneManager,
    textAssets: TextAssetManager,
    getText: (key: string, params?: Record<string, string | number>) => string
  ) {
    this.sceneManager = sceneManager;
    this.textAssets = textAssets;
    this.getText = getText;
  }

  // ─── Debug ──────────────────────────────────────────────────────────────────

  enablePutDebug(): void {
    this.putDebugEnabled = true;
  }

  disablePutDebug(): void {
    this.putDebugEnabled = false;
  }

  private debugPut(event: string, payload?: Record<string, unknown>): void {
    if (!this.putDebugEnabled) return;
    console.log(`[PUT:${event}]`, payload);
  }

  // ─── Inventory UI subscription ───────────────────────────────────────────

  notifyInventoryUiChange(): void {
    this.inventoryUiListeners.forEach((listener) => listener());
  }

  subscribeInventoryUi(listener: () => void): () => void {
    this.inventoryUiListeners.add(listener);
    return () => {
      this.inventoryUiListeners.delete(listener);
    };
  }

  // ─── Preview state ───────────────────────────────────────────────────────

  reconcileInventoryPreview(): void {
    if (
      this.inventoryPreviewEntity &&
      (!this.inventory.includes(this.inventoryPreviewEntity) ||
        this.inventoryPreviewEntity.disabled)
    ) {
      this.inventoryPreviewEntity = null;
      this.inventoryPreviewText = null;
    }
  }

  getInventoryPreviewEntity(): Entity | null {
    this.reconcileInventoryPreview();
    return this.inventoryPreviewEntity;
  }

  getInventoryPreviewText(): string | null {
    this.reconcileInventoryPreview();
    return this.inventoryPreviewText;
  }

  private resolveInventoryPreviewText(entity: Entity): string | null {
    const details = this.textAssets.getResolvedObjectField(entity, 'details');
    if (details && details.trim()) return details;

    const objectDescription = this.textAssets.getResolvedObjectField(entity, 'description');
    const runtimeDescription = typeof entity.description === 'string' ? entity.description : null;
    const description = objectDescription || runtimeDescription;
    return description && description.trim() ? description : null;
  }

  openInventoryPreview(entity: Entity, previewText?: string | null): void {
    if (!this.inventory.includes(entity) || entity.disabled) return;
    this.inventoryPreviewEntity = entity;
    this.inventoryPreviewText =
      previewText !== undefined ? previewText : this.resolveInventoryPreviewText(entity);
    this.notifyInventoryUiChange();
  }

  closeInventoryPreview(): void {
    if (!this.inventoryPreviewEntity) return;
    this.inventoryPreviewEntity = null;
    this.inventoryPreviewText = null;
    this.notifyInventoryUiChange();
  }

  // ─── Player / owner helpers ──────────────────────────────────────────────

  isEntityInInventory(entity: Entity): boolean {
    return this.inventory.includes(entity);
  }

  getPlayerEntity(): Entity | null {
    const player = this.sceneManager.currentScene?.player;
    return player instanceof Entity ? player : null;
  }

  isPlayerInventoryOwner(owner: Entity | null | undefined): boolean {
    const player = this.getPlayerEntity();
    return !!owner && !!player && owner === player;
  }

  private getInventoryStoreKey(owner: Entity, relation: ContainerRelation): string {
    return `${owner.name}::${relation}`;
  }

  private getInventoryRelations(owner: Entity): ContainerRelation[] {
    const components = ComponentSystem.getInventoryComponents(owner);
    if (!components.length) return ['in'];
    return Array.from(
      new Set(components.map((component) => ComponentSystem.normalizeInventoryRelation(component)))
    );
  }

  private hasPlayerFacingTitle(object: SceneObject | null | undefined): boolean {
    if (!object) return false;
    const title = this.textAssets.getResolvedObjectField(object as any, 'title');
    return !!title?.trim();
  }

  getInventorySlotForEntity(entity: Entity): InventorySlotRef | null {
    const player = this.getPlayerEntity();
    if (player && this.inventory.includes(entity)) {
      return {
        owner: player,
        component: this.ensureInventoryComponent(player, 'in'),
        relation: 'in',
      };
    }

    const scene = this.sceneManager.currentScene;
    if (!scene) return null;
    for (const candidate of scene.entities) {
      if (!(candidate instanceof Entity) || candidate.disabled) continue;
      for (const relation of this.getInventoryRelations(candidate)) {
        const component = ComponentSystem.getInventoryComponent(candidate, relation);
        if (!component) continue;
        if (this.getStoredInventoryEntities(candidate, relation).includes(entity)) {
          return {
            owner: candidate,
            component,
            relation,
          };
        }
      }
    }

    return null;
  }

  private getSurfaceSlotPlacementRelation(slot: SurfaceSlotRef): ContainerRelation {
    return this.hasPlayerFacingTitle(slot.surface)
      ? ComponentSystem.normalizeSurfaceRelation(slot.component)
      : 'on';
  }

  // ─── Component bootstrapping ─────────────────────────────────────────────

  ensureInventoryComponent(owner: Entity, relation: ContainerRelation = 'in'): InventoryComponent {
    let component = ComponentSystem.getInventoryComponent(owner, relation);
    if (!component) {
      component = {
        type: 'Inventory',
        relation,
        capacity: Number.MAX_SAFE_INTEGER,
        groups: [],
        protected: false,
        items: [],
      };
      owner.components = owner.components || [];
      owner.components.push(component);
    }
    if (!Array.isArray(component.groups)) component.groups = [];
    if (!Array.isArray(component.items)) component.items = [];
    if (typeof component.capacity !== 'number' || !Number.isFinite(component.capacity)) {
      component.capacity = Number.MAX_SAFE_INTEGER;
    }
    component.protected = !!component.protected;
    component.relation = ComponentSystem.normalizeInventoryRelation(component);
    return component;
  }

  ensureSurfaceComponent(
    surface: SceneObject,
    relation: ContainerRelation = 'on'
  ): SurfaceComponent {
    let component = ComponentSystem.getSurfaceComponent(surface, relation);
    if (!component) {
      component = {
        type: 'Surface',
        relation,
        capacity: Number.MAX_SAFE_INTEGER,
        groups: [],
        items: [],
      };
      surface.components = surface.components || [];
      surface.components.push(component);
    }
    if (!Array.isArray(component.groups)) component.groups = [];
    if (!Array.isArray(component.items)) component.items = [];
    if (typeof component.capacity !== 'number' || !Number.isFinite(component.capacity)) {
      component.capacity = Number.MAX_SAFE_INTEGER;
    }
    component.relation = ComponentSystem.normalizeSurfaceRelation(component);
    return component;
  }

  // ─── Inventory store sync ────────────────────────────────────────────────

  private resolveInventoryEntitiesFromComponent(
    owner: Entity,
    relation: ContainerRelation
  ): Entity[] {
    const component = this.ensureInventoryComponent(owner, relation);
    const scene = this.sceneManager.currentScene;
    return (component.items || [])
      .map((id) => {
        const candidate = scene?.getObjectByName(id);
        return candidate instanceof Entity ? candidate : null;
      })
      .filter((entity): entity is Entity => !!entity);
  }

  private getPreferredInventoryRelationForEntity(
    owner: Entity,
    entity: Entity
  ): ContainerRelation | null {
    const availableRelations = this.getInventoryRelations(owner);
    if (!availableRelations.length) return null;

    const storedHint =
      typeof (entity as any).__inventoryRelation === 'string'
        ? ((entity as any).__inventoryRelation as ContainerRelation)
        : null;
    if (storedHint && availableRelations.includes(storedHint)) {
      return storedHint;
    }

    if (availableRelations.length === 1) return availableRelations[0];
    if (availableRelations.includes('in')) return 'in';
    return availableRelations[0] || null;
  }

  private syncInventoryEntitySceneState(
    owner: Entity,
    entity: Entity,
    relation: ContainerRelation
  ): void {
    const scene = this.sceneManager.currentScene;
    if (!scene) return;
    if (!scene.entities.includes(entity)) {
      scene.addEntity(entity);
    }
    (entity as any).__inventoryRelation = relation;
    entity.visible = false;
    entity.spatial = {
      parentNodeId: owner.name,
      relation: 'in',
    };
    scene.subsceneEntities.delete(entity);
  }

  private releaseInventoryEntitySceneState(entity: Entity): void {
    if (this.getInventorySlotForEntity(entity)) return;
    delete (entity as any).__inventoryRelation;
    entity.visible = true;
  }

  handleSceneChange(): void {
    this.inventoryEntityStore.clear();
    this.inventory = [];

    const scene = this.sceneManager.currentScene;
    if (!scene) {
      this.reconcileInventoryPreview();
      this.notifyInventoryUiChange();
      return;
    }

    for (const owner of scene.entities) {
      if (!(owner instanceof Entity) || owner.disabled) continue;

      for (const relation of this.getInventoryRelations(owner)) {
        const component = ComponentSystem.getInventoryComponent(owner, relation);
        if (!component) continue;

        const resolved = this.resolveInventoryEntitiesFromComponent(owner, relation);
        component.items = resolved.map((entity) => entity.name);

        if (this.isPlayerInventoryOwner(owner) && relation === 'in') {
          this.inventory = resolved;
        } else {
          this.inventoryEntityStore.set(this.getInventoryStoreKey(owner, relation), resolved);
        }

        for (const entity of resolved) {
          this.syncInventoryEntitySceneState(owner, entity, relation);
        }
      }
    }

    this.reconcileInventoryPreview();
    this.notifyInventoryUiChange();
  }

  syncPlayerInventoryComponent(relation: ContainerRelation = 'in'): void {
    const player = this.getPlayerEntity();
    if (!player) return;
    const component = this.ensureInventoryComponent(player, relation);
    component.items = this.inventory.map((entity) => entity.name);
    for (const entity of this.inventory) {
      this.syncInventoryEntitySceneState(player, entity, relation);
    }
  }

  syncInventoryStore(owner: Entity, entities: Entity[], relation: ContainerRelation = 'in'): void {
    const previous =
      this.isPlayerInventoryOwner(owner) && relation === 'in'
        ? [...this.inventory]
        : [
            ...(this.inventoryEntityStore.get(this.getInventoryStoreKey(owner, relation)) ||
              this.resolveInventoryEntitiesFromComponent(owner, relation)),
          ];

    if (this.isPlayerInventoryOwner(owner) && relation === 'in') {
      this.inventory = entities;
      this.syncPlayerInventoryComponent(relation);
      previous
        .filter((entity) => !entities.includes(entity))
        .forEach((entity) => this.releaseInventoryEntitySceneState(entity));
      this.reconcileInventoryPreview();
      this.notifyInventoryUiChange();
      return;
    }
    this.inventoryEntityStore.set(this.getInventoryStoreKey(owner, relation), entities);
    this.ensureInventoryComponent(owner, relation).items = entities.map((entity) => entity.name);
    for (const entity of entities) {
      this.syncInventoryEntitySceneState(owner, entity, relation);
    }
    previous
      .filter((entity) => !entities.includes(entity))
      .forEach((entity) => this.releaseInventoryEntitySceneState(entity));
  }

  getStoredInventoryEntities(owner: Entity, relation: ContainerRelation = 'in'): Entity[] {
    if (this.isPlayerInventoryOwner(owner) && relation === 'in') {
      this.syncPlayerInventoryComponent(relation);
      return this.inventory;
    }

    const storeKey = this.getInventoryStoreKey(owner, relation);
    const existing = this.inventoryEntityStore.get(storeKey);
    if (existing) {
      this.ensureInventoryComponent(owner, relation).items = existing.map((entity) => entity.name);
      for (const entity of existing) {
        this.syncInventoryEntitySceneState(owner, entity, relation);
      }
      return existing;
    }

    const resolved = this.resolveInventoryEntitiesFromComponent(owner, relation);
    const component = this.ensureInventoryComponent(owner, relation);

    this.inventoryEntityStore.set(storeKey, resolved);
    component.items = resolved.map((entity) => entity.name);
    for (const entity of resolved) {
      this.syncInventoryEntitySceneState(owner, entity, relation);
    }
    return resolved;
  }

  syncEntityStorageFromSpatialPlacement(entity: Entity): void {
    const scene = this.sceneManager.currentScene;
    if (!scene) return;

    const parentId =
      typeof entity.spatial?.parentNodeId === 'string' ? entity.spatial.parentNodeId.trim() : '';
    const relation = entity.spatial?.relation || null;

    this.removeEntityFromCurrentStorage(entity);

    const owner = parentId ? scene.getObjectByName(parentId) : null;
    if (!(owner instanceof Entity) || relation !== 'in') {
      this.releaseInventoryEntitySceneState(entity);
      return;
    }

    const inventoryRelation = this.getPreferredInventoryRelationForEntity(owner, entity);
    if (!inventoryRelation || !ComponentSystem.getInventoryComponent(owner, inventoryRelation)) {
      this.releaseInventoryEntitySceneState(entity);
      return;
    }

    const entities = this.getStoredInventoryEntities(owner, inventoryRelation);
    if (!entities.includes(entity)) {
      this.syncInventoryStore(owner, [...entities, entity], inventoryRelation);
      return;
    }

    this.syncInventoryEntitySceneState(owner, entity, inventoryRelation);
  }

  findInventoryOwnerForEntity(entity: Entity): Entity | null {
    const player = this.getPlayerEntity();
    if (player && this.inventory.includes(entity)) {
      return player;
    }

    const scene = this.sceneManager.currentScene;
    if (!scene) return null;
    for (const candidate of scene.entities) {
      if (!(candidate instanceof Entity) || candidate.disabled) continue;
      const relations = this.getInventoryRelations(candidate);
      if (
        relations.some((relation) =>
          this.getStoredInventoryEntities(candidate, relation).includes(entity)
        )
      ) {
        return candidate;
      }
    }
    return null;
  }

  // ─── Group / switch group helpers ────────────────────────────────────────

  parseGroupIds(value: string | null | undefined): string[] {
    return String(value || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith('#'));
  }

  setEntityGroupIds(entity: Entity, groupIds: string[]): void {
    const normalized = Array.from(
      new Set(
        groupIds.map((entry) => String(entry || '').trim()).filter((entry) => entry.startsWith('#'))
      )
    );
    entity.groupID = normalized.length ? normalized.join(',') : null;
  }

  clearInheritedSurfaceSwitchGroups(entity: Entity): void {
    const inherited = Array.isArray((entity as any).__surfaceInheritedSwitchGroups)
      ? ((entity as any).__surfaceInheritedSwitchGroups as string[])
      : [];
    if (!inherited.length) return;

    const remaining = ComponentSystem.getGroupIds(entity).filter(
      (groupId) => !inherited.includes(groupId)
    );
    this.setEntityGroupIds(entity, remaining);
    (entity as any).__surfaceInheritedSwitchGroups = [];
  }

  clearActiveContainerSwitchGroups(
    entity: Entity,
    getSwitchComponent: (
      obj: SceneObject
    ) => import('../systems/ComponentSystem').SwitchComponent | null
  ): void {
    const scene = this.sceneManager.currentScene;
    if (!scene) return;

    const groupsToRemove = new Set<string>();
    let current: SceneObject | null = entity;
    while (current) {
      const switchComponent = getSwitchComponent(current);
      if (switchComponent) {
        const activeTarget =
          switchComponent.state === 2 ? switchComponent.groupId2 : switchComponent.groupId1;
        for (const groupId of this.parseGroupIds(activeTarget)) {
          groupsToRemove.add(groupId);
        }
      }

      const parentId: string =
        typeof (current as any).spatial?.parentNodeId === 'string'
          ? (current as any).spatial.parentNodeId.trim()
          : '';
      current = parentId ? scene.getObjectByName(parentId) : null;
    }

    if (!groupsToRemove.size) return;

    const remaining = ComponentSystem.getGroupIds(entity).filter(
      (groupId) => !groupsToRemove.has(groupId)
    );
    this.setEntityGroupIds(entity, remaining);
  }

  getContainingSubsceneRootIds(entity: SceneObject): string[] {
    const scene = this.sceneManager.currentScene;
    if (!scene) return [];

    const roots: string[] = [];
    let current: SceneObject | null = entity;
    while (current) {
      if (current.components?.some((component: any) => component?.type === 'Subscene')) {
        roots.push(current.name);
      }
      const parentId: string =
        typeof (current as any).spatial?.parentNodeId === 'string'
          ? (current as any).spatial.parentNodeId.trim()
          : '';
      current = parentId ? scene.getObjectByName(parentId) : null;
    }

    return Array.from(new Set(roots));
  }

  markEntityDetachedFromSubscenes(entity: Entity, subsceneRootIds: string[]): void {
    const normalized = Array.from(
      new Set(subsceneRootIds.map((value) => String(value || '').trim()).filter((value) => !!value))
    );
    (entity as any).__detachedSubsceneRootIds = normalized;
  }

  clearEntityDetachedSubsceneRoot(entity: Entity, subsceneRootId: string): void {
    const detached = Array.isArray((entity as any).__detachedSubsceneRootIds)
      ? ((entity as any).__detachedSubsceneRootIds as string[])
      : [];
    if (!detached.length) return;

    const normalizedRoot = String(subsceneRootId || '').trim();
    const next = detached.filter((value) => value !== normalizedRoot);
    (entity as any).__detachedSubsceneRootIds = next;
  }

  private collectActiveSurfaceSwitchGroups(
    surface: SceneObject,
    getSwitchComponent: (
      obj: SceneObject
    ) => import('../systems/ComponentSystem').SwitchComponent | null
  ): string[] {
    const scene = this.sceneManager.currentScene;
    if (!scene) return [];

    const collected: string[] = [];
    let current: SceneObject | null = surface;
    while (current) {
      const switchComponent = getSwitchComponent(current);
      if (switchComponent) {
        const activeTarget =
          switchComponent.state === 2 ? switchComponent.groupId2 : switchComponent.groupId1;
        collected.push(...this.parseGroupIds(activeTarget));
      }

      const parentId: string =
        typeof (current as any).spatial?.parentNodeId === 'string'
          ? (current as any).spatial.parentNodeId.trim()
          : '';
      current = parentId ? scene.getObjectByName(parentId) : null;
    }

    return Array.from(new Set(collected));
  }

  assignInheritedSurfaceSwitchGroups(
    entity: Entity,
    surface: SceneObject,
    getSwitchComponent: (
      obj: SceneObject
    ) => import('../systems/ComponentSystem').SwitchComponent | null
  ): void {
    this.clearInheritedSurfaceSwitchGroups(entity);
    const inherited = this.collectActiveSurfaceSwitchGroups(surface, getSwitchComponent);
    if (!inherited.length) return;

    this.setEntityGroupIds(entity, [...ComponentSystem.getGroupIds(entity), ...inherited]);
    (entity as any).__surfaceInheritedSwitchGroups = inherited;
  }

  // ─── Storage group matching ──────────────────────────────────────────────

  itemMatchesStorageGroups(groups: string[] | string | undefined, entity: Entity): boolean {
    const normalizedGroups = Array.isArray(groups)
      ? groups
      : typeof groups === 'string'
        ? groups.split(/[,\s]+/)
        : [];
    const acceptedGroups = normalizedGroups
      .map((value) => String(value || '').trim())
      .filter((value) => value.startsWith('#'));
    if (!acceptedGroups.length) return true;
    const entityGroups = ComponentSystem.getGroupIds(entity);
    return entityGroups.some((groupId) => acceptedGroups.includes(groupId));
  }

  // ─── Accessibility checks ────────────────────────────────────────────────

  isSurfaceAccessible(
    surface: SceneObject,
    getBlockedAccessOutcome: (entity: SceneObject) => GameActionOutcome | null
  ): boolean {
    if (surface.disabled) return false;
    if (this.isEntityInInventory(surface as Entity)) return true;
    const scene = this.sceneManager.currentScene;
    if (!scene) return false;
    const accessOutcome = getBlockedAccessOutcome(surface);
    if (accessOutcome) return false;
    if (scene.activeSubscene && scene.subsceneEntities.has(surface as any)) {
      return true;
    }
    return !ComponentSystem.getInteractionDistanceError(surface as any, scene.player);
  }

  isSurfaceAccessibleFromAnchor(
    surface: SceneObject,
    anchor: SceneObject,
    getBlockedAccessOutcome: (entity: SceneObject) => GameActionOutcome | null,
    getPlayerFacingObjectTitle: (target: SceneObject) => string | null
  ): boolean {
    if (surface.disabled) return false;
    if (this.isEntityInInventory(surface as Entity)) return true;

    const scene = this.sceneManager.currentScene;
    if (!scene) return false;
    const accessOutcome = getBlockedAccessOutcome(surface);
    if (accessOutcome) return false;
    if (scene.activeSubscene && scene.subsceneEntities.has(surface as any)) {
      return true;
    }

    const surfaceTitle = getPlayerFacingObjectTitle(surface);
    if (!surfaceTitle) {
      return !ComponentSystem.getInteractionDistanceError(anchor as any, scene.player);
    }

    return !ComponentSystem.getInteractionDistanceError(surface as any, scene.player);
  }

  isInventoryAccessible(
    owner: Entity,
    getBlockedAccessOutcome: (entity: SceneObject) => GameActionOutcome | null,
    relation: ContainerRelation = 'in'
  ): boolean {
    if (owner.disabled) return false;
    if (this.isPlayerInventoryOwner(owner) && relation === 'in') return true;
    if (this.isEntityInInventory(owner)) return true;

    const component = ComponentSystem.getInventoryComponent(owner, relation);
    if (!component || component.protected) return false;

    const scene = this.sceneManager.currentScene;
    if (!scene) return false;
    const accessOutcome = getBlockedAccessOutcome(owner);
    if (accessOutcome) return false;
    if (scene.activeSubscene && scene.subsceneEntities.has(owner as any)) {
      return true;
    }
    return !ComponentSystem.getInteractionDistanceError(owner as any, scene.player);
  }

  isInventoryAccessibleFromAnchor(
    owner: Entity,
    anchor: SceneObject,
    getBlockedAccessOutcome: (entity: SceneObject) => GameActionOutcome | null,
    getPlayerFacingObjectTitle: (target: SceneObject) => string | null,
    relation: ContainerRelation = 'in'
  ): boolean {
    if (owner.disabled) return false;
    if (this.isPlayerInventoryOwner(owner) && relation === 'in') return true;
    if (this.isEntityInInventory(owner)) return true;

    const component = ComponentSystem.getInventoryComponent(owner, relation);
    if (!component || component.protected) return false;

    const scene = this.sceneManager.currentScene;
    if (!scene) return false;
    const accessOutcome = getBlockedAccessOutcome(owner);
    if (accessOutcome) return false;
    if (scene.activeSubscene && scene.subsceneEntities.has(owner as any)) {
      return true;
    }

    const ownerTitle = getPlayerFacingObjectTitle(owner);
    if (!ownerTitle) {
      return !ComponentSystem.getInteractionDistanceError(anchor as any, scene.player);
    }

    return !ComponentSystem.getInteractionDistanceError(owner as any, scene.player);
  }

  getAccessibleSceneSurfaces(
    getBlockedAccessOutcome: (entity: SceneObject) => GameActionOutcome | null,
    relation: ContainerRelation | null = null
  ): SceneObject[] {
    const scene = this.sceneManager.currentScene;
    if (!scene) return [];
    return scene
      .getAllSceneObjects()
      .filter((candidate) => !!ComponentSystem.getSurfaceComponent(candidate, relation))
      .filter((candidate) => this.isSurfaceAccessible(candidate, getBlockedAccessOutcome));
  }

  getAccessibleInventoryOwners(
    getBlockedAccessOutcome: (entity: SceneObject) => GameActionOutcome | null,
    relation: ContainerRelation = 'in'
  ): Entity[] {
    const scene = this.sceneManager.currentScene;
    if (!scene) return [];
    return scene.entities.filter(
      (candidate): candidate is Entity =>
        candidate instanceof Entity &&
        !!ComponentSystem.getInventoryComponent(candidate, relation) &&
        this.isInventoryAccessible(candidate, getBlockedAccessOutcome, relation)
    );
  }

  getAccessibleInventoryItems(
    getBlockedAccessOutcome: (entity: SceneObject) => GameActionOutcome | null,
    relation: ContainerRelation = 'in'
  ): Entity[] {
    return this.getAccessibleInventoryOwners(getBlockedAccessOutcome, relation)
      .filter((owner) => !this.isPlayerInventoryOwner(owner))
      .flatMap((owner) => this.getStoredInventoryEntities(owner, relation))
      .filter((entity) => !entity.disabled);
  }

  removeEntityFromCurrentStorage(entity: Entity): void {
    const inventoryOwner = this.findInventoryOwnerForEntity(entity);
    if (inventoryOwner) {
      for (const relation of this.getInventoryRelations(inventoryOwner)) {
        const entities = this.getStoredInventoryEntities(inventoryOwner, relation).filter(
          (candidate) => candidate !== entity
        );
        this.syncInventoryStore(inventoryOwner, entities, relation);
      }
    }

    const scene = this.sceneManager.currentScene;
    if (!scene) return;

    for (const candidate of scene.getAllSceneObjects()) {
      for (const component of ComponentSystem.getSurfaceComponents(candidate)) {
        if (!component.items?.length) continue;
        const nextItems = component.items.filter((item) => item.id !== entity.name);
        if (nextItems.length !== component.items.length) {
          component.items = nextItems;
        }
      }
    }
  }

  // ─── Spatial helpers ─────────────────────────────────────────────────────

  isObjectInsideActiveSubscene(object: SceneObject): boolean {
    const scene = this.sceneManager.currentScene;
    const activeSubscene = scene?.activeSubscene;
    if (!scene || !activeSubscene) return false;
    if (scene.subsceneEntities.has(object as any)) return true;

    let current: SceneObject | null = object;
    while (current) {
      if (
        current.components?.some((component: any) => component?.type === 'Subscene') &&
        current.name === activeSubscene
      ) {
        return true;
      }
      const parentId: string =
        typeof (current as any).spatial?.parentNodeId === 'string'
          ? (current as any).spatial.parentNodeId.trim()
          : '';
      current = parentId ? scene.getObjectByName(parentId) : null;
    }
    return false;
  }

  getSceneObjectReferencePoint(sceneObject: SceneObject): { x: number; y: number } {
    const polygon = (sceneObject as any).poly;
    if (Array.isArray(polygon) && polygon.length) {
      const sum = polygon.reduce(
        (acc: { x: number; y: number }, point: { x: number; y: number }) => ({
          x: acc.x + (point?.x || 0),
          y: acc.y + (point?.y || 0),
        }),
        { x: 0, y: 0 }
      );
      return {
        x: sum.x / polygon.length,
        y: sum.y / polygon.length,
      };
    }
    return {
      x: Number((sceneObject as any).x) || 0,
      y: Number((sceneObject as any).y) || 0,
    };
  }

  getSceneObjectSelectionPriority(sceneObject: SceneObject): number {
    const scene = this.sceneManager.currentScene;
    const player = scene?.player;
    if (!player) return Number.MAX_SAFE_INTEGER;
    const location = this.getSceneObjectReferencePoint(sceneObject);
    return Math.hypot(location.x - (player.x || 0), location.y - (player.y || 0));
  }

  // ─── Surface geometry ────────────────────────────────────────────────────

  getSurfaceBounds(surface: SceneObject): {
    type: 'rect' | 'poly';
    rect: { left: number; top: number; right: number; bottom: number };
    poly?: Array<{ x: number; y: number }>;
  } | null {
    const poly = Array.isArray((surface as any).poly) ? (surface as any).poly : null;
    if (poly?.length) {
      const xs = poly.map((point: { x: number; y: number }) => point.x);
      const ys = poly.map((point: { x: number; y: number }) => point.y);
      return {
        type: 'poly',
        rect: {
          left: Math.min(...xs),
          top: Math.min(...ys),
          right: Math.max(...xs),
          bottom: Math.max(...ys),
        },
        poly,
      };
    }

    if (typeof (surface as any).x === 'number' && typeof (surface as any).y === 'number') {
      const width = Number((surface as any).width) || 0;
      const height = Number((surface as any).height) || 0;
      return {
        type: 'rect',
        rect: {
          left: (surface as any).x - width / 2,
          top: (surface as any).y - height,
          right: (surface as any).x + width / 2,
          bottom: (surface as any).y,
        },
      };
    }

    return null;
  }

  private getEntityPlacementSizeAtY(
    entity: Entity,
    targetY: number
  ): { width: number; height: number } {
    const scene = this.sceneManager.currentScene;
    const baseWidth =
      typeof entity.baseWidth === 'number' && Number.isFinite(entity.baseWidth)
        ? entity.baseWidth
        : entity.width;
    const baseHeight =
      typeof entity.baseHeight === 'number' && Number.isFinite(entity.baseHeight)
        ? entity.baseHeight
        : entity.height;
    const modelScale =
      typeof entity.modelScale === 'number' && Number.isFinite(entity.modelScale)
        ? entity.modelScale
        : 1;
    const depthFactor =
      !entity.ignoreScaling && scene?.scaling?.enabled ? scene.getScaling(targetY) : 1;

    return {
      width: baseWidth * modelScale * depthFactor,
      height: baseHeight * modelScale * depthFactor,
    };
  }

  private getSurfaceFootprintRect(
    surface: SceneObject,
    size: { width: number; height: number },
    x: number,
    y: number
  ): { x: number; y: number; w: number; h: number } {
    const hasPoly = Array.isArray((surface as any).poly) && (surface as any).poly.length > 0;
    const placementRelation = ((surface as any).spatial?.relation ||
      null) as SpatialRelationType | null;
    if (surface.type === 'Walkbox' || (hasPoly && placementRelation !== 'in')) {
      const footprintWidth = Math.max(12, size.width * 0.7);
      const footprintHeight = Math.max(10, Math.min(24, size.height * 0.18));
      return {
        x: x - footprintWidth / 2,
        y: y - footprintHeight,
        w: footprintWidth,
        h: footprintHeight,
      };
    }

    return {
      x: x - size.width / 2,
      y: y - size.height,
      w: size.width,
      h: size.height,
    };
  }

  private isCandidateRectInside(
    candidateRect: { x: number; y: number; w: number; h: number },
    bounds: {
      type: 'rect' | 'poly';
      rect: { left: number; top: number; right: number; bottom: number };
      poly?: Array<{ x: number; y: number }>;
    },
    surface: SceneObject,
    placementRelation: SpatialRelationType | null
  ): boolean {
    if (surface.type === 'Walkbox') {
      return (
        candidateRect.x >= bounds.rect.left &&
        candidateRect.y >= bounds.rect.top &&
        candidateRect.x + candidateRect.w <= bounds.rect.right &&
        candidateRect.y + candidateRect.h <= bounds.rect.bottom
      );
    }

    if (bounds.type === 'poly' && bounds.poly) {
      if (placementRelation !== 'in') {
        return this.isPolygonSurfaceFootprintSupported(candidateRect, bounds.poly);
      }
      return Geometry.rectInsidePolygon(candidateRect, bounds.poly);
    }

    return (
      candidateRect.x >= bounds.rect.left &&
      candidateRect.y >= bounds.rect.top &&
      candidateRect.x + candidateRect.w <= bounds.rect.right &&
      candidateRect.y + candidateRect.h <= bounds.rect.bottom
    );
  }

  evaluateSurfacePlacement(
    surface: SceneObject,
    entity: Entity,
    x: number,
    y: number,
    placements: SurfaceItemPlacement[]
  ): {
    fits: boolean;
    candidateSize: { width: number; height: number };
    candidateRect: { x: number; y: number; w: number; h: number };
    inside: boolean;
    collisions: Array<Record<string, unknown>>;
  } {
    const bounds = this.getSurfaceBounds(surface);
    const candidateSize = this.getEntityPlacementSizeAtY(entity, y);
    const candidateRect = this.getSurfaceFootprintRect(surface, candidateSize, x, y);
    const placementRelation = ((surface as any).spatial?.relation ||
      null) as SpatialRelationType | null;

    if (!bounds) {
      return {
        fits: false,
        candidateSize,
        candidateRect,
        inside: false,
        collisions: [],
      };
    }

    const inside = this.isCandidateRectInside(candidateRect, bounds, surface, placementRelation);

    if (!inside) {
      return {
        fits: false,
        candidateSize,
        candidateRect,
        inside,
        collisions: [],
      };
    }

    const collisions = placements
      .map((placement) => {
        const placedEntity =
          this.sceneManager.currentScene?.getObjectByName(placement.id) ||
          this.inventory.find((candidate) => candidate.name === placement.id) ||
          null;
        const placedSize =
          placedEntity instanceof Entity
            ? this.getEntityPlacementSizeAtY(placedEntity, placement.y)
            : candidateSize;
        const placedRect = this.getSurfaceFootprintRect(
          surface,
          placedSize,
          placement.x,
          placement.y
        );
        const intersects = Geometry.rectIntersectsRect(candidateRect, placedRect);
        return {
          id: placement.id,
          placement: { x: placement.x, y: placement.y },
          placedSize,
          placedRect,
          intersects,
        };
      })
      .filter((entry) => entry.intersects);

    return {
      fits: collisions.length === 0,
      candidateSize,
      candidateRect,
      inside,
      collisions,
    };
  }

  private isPolygonSurfaceFootprintSupported(
    rect: { x: number; y: number; w: number; h: number },
    poly: Array<{ x: number; y: number }>
  ): boolean {
    const supportY = rect.y + rect.h;
    const samplePoints = [
      { x: rect.x, y: supportY },
      { x: rect.x + rect.w / 2, y: supportY },
      { x: rect.x + rect.w, y: supportY },
    ];

    return samplePoints.every((point) => Geometry.isPointInPolygon(point, poly));
  }

  private canFitEntityOnSurfaceAt(
    surface: SceneObject,
    entity: Entity,
    x: number,
    y: number,
    placements: SurfaceItemPlacement[]
  ): boolean {
    return this.evaluateSurfacePlacement(surface, entity, x, y, placements).fits;
  }

  placeEntityOnSurface(surface: SceneObject, entity: Entity): SurfaceItemPlacement | null {
    const component = this.ensureSurfaceComponent(surface);
    const bounds = this.getSurfaceBounds(surface);
    if (!bounds) return null;

    const placements = component.items || [];
    const samples: Array<{ x: number; y: number }> = [];
    const seen = new Set<string>();
    const addSample = (x: number, y: number) => {
      const candidateSize = this.getEntityPlacementSizeAtY(entity, y);
      const footprint = this.getSurfaceFootprintRect(surface, candidateSize, 0, y);
      const minX = bounds.rect.left + footprint.w / 2;
      const maxX = bounds.rect.right - footprint.w / 2;
      const minY = bounds.rect.top + footprint.h;
      const maxY = bounds.rect.bottom;
      if (minX > maxX || minY > maxY) {
        return;
      }

      const clampedX = Math.max(minX, Math.min(maxX, x));
      const clampedY = Math.max(minY, Math.min(maxY, y));
      const key = `${Math.round(clampedX)}:${Math.round(clampedY)}`;
      if (seen.has(key)) return;
      seen.add(key);
      samples.push({ x: clampedX, y: clampedY });
    };

    const maxEntitySize = this.getEntityPlacementSizeAtY(entity, bounds.rect.bottom);
    const minEntitySize = this.getEntityPlacementSizeAtY(entity, bounds.rect.top);
    const maxFootprint = this.getSurfaceFootprintRect(
      surface,
      maxEntitySize,
      0,
      bounds.rect.bottom
    );
    const minFootprint = this.getSurfaceFootprintRect(surface, minEntitySize, 0, bounds.rect.top);
    const rowMinY = Math.min(bounds.rect.bottom, bounds.rect.top + minFootprint.h);
    const rowMaxY = bounds.rect.bottom;
    const centerX = (bounds.rect.left + bounds.rect.right) / 2;
    const centerY = (rowMinY + rowMaxY) / 2;
    addSample(centerX, rowMaxY);
    addSample(centerX, centerY);
    addSample(bounds.rect.left, rowMaxY);
    addSample(bounds.rect.right, rowMaxY);
    addSample(bounds.rect.left, rowMinY);
    addSample(bounds.rect.right, rowMinY);

    const rangeY = Math.max(0, rowMaxY - rowMinY);
    const columnStep = Math.max(maxFootprint.w * 0.75, 12);
    const rowStep = Math.max(maxFootprint.h * 0.75, 12);
    const rowCount = Math.max(1, Math.ceil(rangeY / rowStep));

    for (let row = rowCount; row >= 0; row -= 1) {
      const y = rowCount === 0 ? rowMaxY : rowMinY + (rangeY * row) / Math.max(rowCount, 1);
      const candidateSize = this.getEntityPlacementSizeAtY(entity, y);
      const footprint = this.getSurfaceFootprintRect(surface, candidateSize, 0, y);
      const minX = bounds.rect.left + footprint.w / 2;
      const maxX = bounds.rect.right - footprint.w / 2;
      if (minX > maxX) continue;
      const rangeX = Math.max(0, maxX - minX);
      const columnCount = Math.max(1, Math.ceil(rangeX / columnStep));
      for (let column = 0; column <= columnCount; column += 1) {
        const x = columnCount === 0 ? centerX : minX + (rangeX * column) / Math.max(columnCount, 1);
        addSample(x, y);
      }
    }

    const fittingSamples = samples.filter((sample) =>
      this.canFitEntityOnSurfaceAt(surface, entity, sample.x, sample.y, placements)
    );
    const openSpot =
      fittingSamples.length > 0
        ? fittingSamples[Math.floor(Math.random() * fittingSamples.length)]
        : null;
    const insideOnlySamples = samples.filter((sample) => {
      const evaluation = this.evaluateSurfacePlacement(
        surface,
        entity,
        sample.x,
        sample.y,
        placements
      );
      return evaluation.inside;
    });
    const fallbackSpot =
      openSpot ||
      (insideOnlySamples.length > 0
        ? insideOnlySamples[Math.floor(Math.random() * insideOnlySamples.length)]
        : null);

    if (!fallbackSpot) return null;

    this.debugPut('surface-placement-samples', {
      entityId: entity.name,
      surfaceId: surface.name,
      sampleCount: samples.length,
      fittingCount: fittingSamples.length,
      chosen: fallbackSpot,
    });

    return {
      id: entity.name,
      x: Math.round(fallbackSpot.x),
      y: Math.round(fallbackSpot.y),
    };
  }

  // ─── Scene search helpers ────────────────────────────────────────────────

  findPreferredStorageForRelation(
    anchor: SceneObject,
    relation: SpatialRelationType,
    getBlockedAccessOutcome: (entity: SceneObject) => GameActionOutcome | null,
    getPlayerFacingObjectTitle: (target: SceneObject) => string | null,
    requireAccessible: boolean = true
  ): { inventory: InventorySlotRef | null; surface: SurfaceSlotRef | null } {
    const scene = this.sceneManager.currentScene;
    if (!scene) return { inventory: null, surface: null };

    const normalizedRelation =
      relation === 'in' || relation === 'on' || relation === 'under' || relation === 'behind'
        ? relation
        : 'in';
    const inventoryCandidates: InventorySlotRef[] = [];
    const surfaceCandidates: SurfaceSlotRef[] = [];

    if (anchor instanceof Entity) {
      const directInventory = ComponentSystem.getInventoryComponent(anchor, normalizedRelation);
      if (
        directInventory &&
        (!requireAccessible ||
          this.isInventoryAccessible(anchor, getBlockedAccessOutcome, normalizedRelation))
      ) {
        inventoryCandidates.push({
          owner: anchor,
          component: directInventory,
          relation: normalizedRelation,
        });
      }
    }
    const directSurface = ComponentSystem.getSurfaceComponent(anchor, normalizedRelation);
    if (
      directSurface &&
      (!requireAccessible || this.isSurfaceAccessible(anchor, getBlockedAccessOutcome))
    ) {
      surfaceCandidates.push({
        surface: anchor,
        component: directSurface,
        relation: normalizedRelation,
      });
    }

    for (const candidate of scene.getAllSceneObjects()) {
      const parentId =
        typeof (candidate as any).spatial?.parentNodeId === 'string'
          ? (candidate as any).spatial.parentNodeId.trim()
          : '';
      const candidateRelation = ((candidate as any).spatial?.relation ||
        null) as SpatialRelationType | null;
      if (parentId !== anchor.name || candidateRelation !== normalizedRelation) continue;

      if (candidate instanceof Entity) {
        const inventoryComponent = ComponentSystem.getInventoryComponent(
          candidate,
          normalizedRelation
        );
        if (
          inventoryComponent &&
          (!requireAccessible ||
            this.isInventoryAccessible(candidate, getBlockedAccessOutcome, normalizedRelation))
        ) {
          inventoryCandidates.push({
            owner: candidate,
            component: inventoryComponent,
            relation: normalizedRelation,
          });
        }
      }

      const surfaceComponent = ComponentSystem.getSurfaceComponent(candidate, normalizedRelation);
      if (
        surfaceComponent &&
        (!requireAccessible || this.isSurfaceAccessible(candidate, getBlockedAccessOutcome))
      ) {
        surfaceCandidates.push({
          surface: candidate,
          component: surfaceComponent,
          relation: normalizedRelation,
        });
      }
    }

    const collapsedExtensions = this.getCollapsedContainerExtensions(
      anchor,
      relation,
      getBlockedAccessOutcome,
      getPlayerFacingObjectTitle,
      requireAccessible
    );
    inventoryCandidates.push(...collapsedExtensions.inventoryOwners);
    surfaceCandidates.push(...collapsedExtensions.surfaces);

    const byPriority = (left: SceneObject, right: SceneObject) =>
      this.getSceneObjectSelectionPriority(left) - this.getSceneObjectSelectionPriority(right);
    const dedupeInventory = new Map<string, InventorySlotRef>();
    for (const candidate of inventoryCandidates) {
      dedupeInventory.set(`${candidate.owner.name}::${candidate.relation}`, candidate);
    }
    const dedupeSurface = new Map<string, SurfaceSlotRef>();
    for (const candidate of surfaceCandidates) {
      dedupeSurface.set(`${candidate.surface.name}::${candidate.relation}`, candidate);
    }

    return {
      inventory:
        Array.from(dedupeInventory.values()).sort((left, right) =>
          byPriority(left.owner, right.owner)
        )[0] || null,
      surface:
        Array.from(dedupeSurface.values()).sort((left, right) =>
          byPriority(left.surface, right.surface)
        )[0] || null,
    };
  }

  findPreferredSurfaceForRelation(
    anchor: SceneObject,
    relation: SpatialRelationType | null | undefined,
    getBlockedAccessOutcome: (anchor: SceneObject) => GameActionOutcome | null,
    getPlayerFacingObjectTitle: (anchor: SceneObject) => string | null,
    requireAccessible: boolean = true
  ): SurfaceSlotRef | null {
    const scene = this.sceneManager.currentScene;
    if (!scene || !relation) return null;

    const normalizedRelation =
      relation === 'in' || relation === 'on' || relation === 'under' || relation === 'behind'
        ? relation
        : null;
    if (!normalizedRelation) return null;

    const directComponent = ComponentSystem.getSurfaceComponent(anchor, normalizedRelation);
    const directSurface = directComponent ? anchor : null;
    if (
      directSurface &&
      (!requireAccessible || this.isSurfaceAccessible(directSurface, getBlockedAccessOutcome))
    ) {
      return {
        surface: directSurface,
        component: directComponent!,
        relation: normalizedRelation,
      };
    }

    const candidates = scene
      .getAllSceneObjects()
      .map((candidate: SceneObject) => ({
        surface: candidate,
        component: ComponentSystem.getSurfaceComponent(candidate, normalizedRelation),
        relation: normalizedRelation,
      }))
      .filter(
        (candidate): candidate is SurfaceSlotRef =>
          candidate.component !== null && candidate.component !== undefined
      )
      .filter((candidate) => (candidate.surface as any).spatial?.parentNodeId === anchor.name)
      .filter(
        (candidate) => ((candidate.surface as any).spatial?.relation || null) === normalizedRelation
      )
      .filter(
        (candidate) =>
          !requireAccessible || this.isSurfaceAccessible(candidate.surface, getBlockedAccessOutcome)
      );
    candidates.push(
      ...this.getCollapsedContainerExtensions(
        anchor,
        relation,
        getBlockedAccessOutcome,
        getPlayerFacingObjectTitle,
        requireAccessible
      ).surfaces
    );

    if (!candidates.length) return null;
    const deduped = Array.from(
      new Map(
        candidates.map((candidate) => [
          `${candidate.surface.name}::${candidate.relation}`,
          candidate,
        ])
      ).values()
    );
    return (
      deduped.sort((left: SurfaceSlotRef, right: SurfaceSlotRef) => {
        const a = this.getSceneObjectSelectionPriority(left.surface);
        const b = this.getSceneObjectSelectionPriority(right.surface);
        return a - b;
      })[0] || null
    );
  }

  getAutoDropSurface(
    getBlockedAccessOutcome: (entity: SceneObject) => GameActionOutcome | null
  ): SurfaceSlotRef | null {
    const scene = this.sceneManager.currentScene;
    if (!scene) return null;

    const surfaces = this.getAccessibleSceneSurfaces(getBlockedAccessOutcome, 'on')
      .map((surface) => {
        const component = ComponentSystem.getSurfaceComponent(surface, 'on');
        if (!component) return null;
        return {
          surface,
          component,
          relation: 'on' as const,
        };
      })
      .filter(
        (
          candidate
        ): candidate is {
          surface: SceneObject;
          component: SurfaceComponent;
          relation: 'on';
        } => !!candidate
      );
    if (!surfaces.length) return null;

    const subsceneFirst = scene.activeSubscene
      ? surfaces.filter((candidate) => scene.subsceneEntities.has(candidate.surface as any))
      : [];
    const pool = subsceneFirst.length ? subsceneFirst : surfaces;
    return (
      pool.sort((left, right) => {
        const a = this.getSceneObjectSelectionPriority(left.surface as any);
        const b = this.getSceneObjectSelectionPriority(right.surface as any);
        return a - b;
      })[0] || null
    );
  }

  private getCollapsedContainerExtensions(
    anchor: SceneObject,
    relation: SpatialRelationType,
    getBlockedAccessOutcome: (entity: SceneObject) => GameActionOutcome | null,
    getPlayerFacingObjectTitle: (target: SceneObject) => string | null,
    requireAccessible: boolean = true
  ): { inventoryOwners: InventorySlotRef[]; surfaces: SurfaceSlotRef[] } {
    const scene = this.sceneManager.currentScene;
    if (!scene) return { inventoryOwners: [], surfaces: [] };

    const inventoryOwners: InventorySlotRef[] = [];
    const surfaces: SurfaceSlotRef[] = [];
    const queue: SceneObject[] = scene
      .getAllSceneObjects()
      .filter((candidate) => ((candidate as any).spatial?.parentNodeId || null) === anchor.name)
      .filter(
        (candidate) =>
          (((candidate as any).spatial?.relation || null) as SpatialRelationType | null) ===
          relation
      )
      .filter((candidate) => !getPlayerFacingObjectTitle(candidate));

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;

      if (current instanceof Entity) {
        const inventoryComponent = ComponentSystem.getInventoryComponent(current, relation);
        if (
          inventoryComponent &&
          (!requireAccessible ||
            this.isInventoryAccessibleFromAnchor(
              current,
              anchor,
              getBlockedAccessOutcome,
              getPlayerFacingObjectTitle,
              relation
            ))
        ) {
          inventoryOwners.push({
            owner: current,
            component: inventoryComponent,
            relation,
          });
        }
      }

      const surfaceComponent = ComponentSystem.getSurfaceComponent(current, relation);
      if (
        surfaceComponent &&
        (!requireAccessible ||
          this.isSurfaceAccessibleFromAnchor(
            current,
            anchor,
            getBlockedAccessOutcome,
            getPlayerFacingObjectTitle
          ))
      ) {
        surfaces.push({
          surface: current,
          component: surfaceComponent,
          relation,
        });
      }

      const children = scene
        .getAllSceneObjects()
        .filter((candidate) => ((candidate as any).spatial?.parentNodeId || null) === current.name)
        .filter((candidate) => !getPlayerFacingObjectTitle(candidate));
      queue.push(...children);
    }

    return { inventoryOwners, surfaces };
  }

  // ─── Public IGame CRUD methods ───────────────────────────────────────────

  getInventoryEntities(owner: Entity, relation: ContainerRelation = 'in'): Entity[] {
    return [...this.getStoredInventoryEntities(owner, relation)];
  }

  hasInventoryEntity(owner: Entity, entity: Entity, relation: ContainerRelation = 'in'): boolean {
    return this.getStoredInventoryEntities(owner, relation).includes(entity);
  }

  addInventoryEntity(
    owner: Entity,
    entity: Entity,
    relation: ContainerRelation = 'in'
  ): GameActionOutcome {
    const component = this.ensureInventoryComponent(owner, relation);
    const currentItems = this.getStoredInventoryEntities(owner, relation);
    if (currentItems.includes(entity)) {
      return {
        status: 'failed',
        code: 'inventory_item_already_present',
        recoverable: true,
      };
    }
    if (currentItems.length >= (component.capacity || Number.MAX_SAFE_INTEGER)) {
      return {
        status: 'failed',
        code: 'inventory_full',
        message: this.getText('parser.put_no_place'),
        recoverable: true,
      };
    }
    if (!this.itemMatchesStorageGroups(component.groups, entity)) {
      return {
        status: 'failed',
        code: 'inventory_group_rejected',
        message: this.getText('parser.put_no_place'),
        recoverable: true,
      };
    }

    this.removeEntityFromCurrentStorage(entity);
    this.clearInheritedSurfaceSwitchGroups(entity);
    this.syncInventoryStore(owner, [...currentItems, entity], relation);
    return {
      status: 'ok',
      code: 'inventory_item_added',
      data: { entityId: entity.name, ownerId: owner.name },
      effects: ['moved_to_inventory'],
    };
  }

  removeEntityFromInventory(
    owner: Entity,
    entity: Entity,
    relation: ContainerRelation = 'in'
  ): GameActionOutcome {
    const currentItems = this.getStoredInventoryEntities(owner, relation);
    if (!currentItems.includes(entity)) {
      for (const fallbackRelation of this.getInventoryRelations(owner)) {
        if (fallbackRelation === relation) continue;
        const fallbackItems = this.getStoredInventoryEntities(owner, fallbackRelation);
        if (!fallbackItems.includes(entity)) continue;
        this.syncInventoryStore(
          owner,
          fallbackItems.filter((candidate) => candidate !== entity),
          fallbackRelation
        );
        return {
          status: 'ok',
          code: 'inventory_item_removed',
          data: { entityId: entity.name, ownerId: owner.name },
          effects: ['removed_from_inventory'],
        };
      }
      return {
        status: 'failed',
        code: 'inventory_item_not_found',
        recoverable: true,
      };
    }
    this.syncInventoryStore(
      owner,
      currentItems.filter((candidate) => candidate !== entity),
      relation
    );
    return {
      status: 'ok',
      code: 'inventory_item_removed',
      data: { entityId: entity.name, ownerId: owner.name },
      effects: ['removed_from_inventory'],
    };
  }

  addEntityToSurface(
    surface: SceneObject,
    entity: Entity,
    relation: ContainerRelation = 'on',
    getSwitchComponent: (
      obj: SceneObject
    ) => import('../systems/ComponentSystem').SwitchComponent | null
  ): GameActionOutcome {
    const component = this.ensureSurfaceComponent(surface, relation);
    if ((component.items || []).some((item) => item.id === entity.name)) {
      return {
        status: 'failed',
        code: 'surface_item_already_present',
        recoverable: true,
      };
    }
    if ((component.items || []).length >= (component.capacity || Number.MAX_SAFE_INTEGER)) {
      return {
        status: 'failed',
        code: 'surface_full',
        message: this.getText('parser.put_no_place'),
        recoverable: true,
      };
    }
    if (!this.itemMatchesStorageGroups(component.groups, entity)) {
      return {
        status: 'failed',
        code: 'surface_group_rejected',
        message: this.getText('parser.put_no_place'),
        recoverable: true,
      };
    }

    const placement = this.placeEntityOnSurface(surface, entity);
    if (!placement) {
      this.debugPut('surface-no-fit', {
        entityId: entity.name,
        surfaceId: surface.name,
        surfaceRelation: ((surface as any).spatial?.relation || null) as SpatialRelationType | null,
        bounds: this.getSurfaceBounds(surface),
        entity: {
          width: entity.width,
          height: entity.height,
          baseWidth: entity.baseWidth,
          baseHeight: entity.baseHeight,
          modelScale: entity.modelScale,
          scale: entity.scale,
          x: entity.x,
          y: entity.y,
        },
      });
      return {
        status: 'failed',
        code: 'surface_no_fit',
        message: this.getText('parser.put_no_place'),
        recoverable: true,
      };
    }

    this.removeEntityFromCurrentStorage(entity);
    this.assignInheritedSurfaceSwitchGroups(entity, surface, getSwitchComponent);
    const scene = this.sceneManager.currentScene;
    if (scene && !scene.entities.includes(entity)) {
      scene.addEntity(entity);
    }
    entity.visible = true;
    entity.x = placement.x;
    entity.y = placement.y;
    entity.layer = surface.layer || 0;
    entity.spatial = {
      parentNodeId: surface.name,
      relation: this.getSurfaceSlotPlacementRelation({ surface, component, relation }),
    };
    if (scene?.activeSubscene) {
      if (this.isObjectInsideActiveSubscene(surface)) {
        entity.subsceneItemScale = scene.getActiveSubsceneItemScale();
        entity.update(0);
        entity.disabled = false;
        scene.subsceneEntities.add(entity);
        this.clearEntityDetachedSubsceneRoot(entity, scene.activeSubscene);
      } else if (scene.subsceneEntities.has(entity)) {
        scene.subsceneEntities.delete(entity);
      }
    }
    scene?.playDropAnimation(entity);
    component.items = [
      ...(component.items || []).filter((item) => item.id !== entity.name),
      placement,
    ];
    return {
      status: 'ok',
      code: 'surface_item_added',
      data: { entityId: entity.name, surfaceId: surface.name },
      effects: ['placed_on_surface'],
    };
  }

  removeEntityFromSurface(
    surface: SceneObject,
    entity: Entity,
    relation: ContainerRelation = 'on'
  ): GameActionOutcome {
    const component = this.ensureSurfaceComponent(surface, relation);
    if (!(component.items || []).some((item) => item.id === entity.name)) {
      return {
        status: 'failed',
        code: 'surface_item_not_found',
        recoverable: true,
      };
    }
    component.items = (component.items || []).filter((item) => item.id !== entity.name);
    return {
      status: 'ok',
      code: 'surface_item_removed',
      data: { entityId: entity.name, surfaceId: surface.name },
      effects: ['removed_from_surface'],
    };
  }
}
