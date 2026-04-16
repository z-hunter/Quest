import { Entity } from '../entities/Entity';
import type { SceneObject } from '../entities/SceneObject';
import { ComponentSystem } from '../systems/ComponentSystem';
import type { InventoryComponent, SurfaceComponent } from '../systems/ComponentSystem';
import type { IGame } from '../core/IGame';
import type { Scene } from './Scene';
import type { SpatialRelationType } from './spatialTypes';

type ContainerRelation = Exclude<SpatialRelationType, 'near'>;

export type SceneSpatialValidationSeverity = 'error' | 'warning';

export interface SceneSpatialValidationIssue {
  severity: SceneSpatialValidationSeverity;
  code: string;
  message: string;
  objectId?: string;
  relatedObjectId?: string;
  relation?: ContainerRelation;
}

export interface SceneSpatialValidationResult {
  ok: boolean;
  errors: SceneSpatialValidationIssue[];
  warnings: SceneSpatialValidationIssue[];
  issues: SceneSpatialValidationIssue[];
}

type ContainerSlot = {
  owner: SceneObject;
  storage: SceneObject;
  component: InventoryComponent | SurfaceComponent;
  kind: 'Inventory' | 'Surface';
  relation: ContainerRelation;
  external: boolean;
};

function isValidRelation(value: unknown): value is ContainerRelation {
  return value === 'in' || value === 'on' || value === 'under' || value === 'behind';
}

function isValidBlockedRelation(value: unknown): value is ContainerRelation | 'none' {
  return value === 'none' || isValidRelation(value);
}

function hasItemComponent(object: SceneObject | null | undefined): boolean {
  return !!object?.components?.some((component: any) => component?.type === 'Item');
}

function getComponentLabel(component: unknown): string {
  if (component && typeof component === 'object' && 'type' in component) {
    return String((component as any).type || 'Unknown');
  }
  return 'Unknown';
}

export class SceneSpatialValidator {
  static validate(
    scene: Scene | null | undefined,
    game?: IGame | null
  ): SceneSpatialValidationResult {
    const validator = new SceneSpatialValidator(scene, game || (scene as any)?.game || null);
    return validator.validate();
  }

  private readonly scene: Scene | null | undefined;
  private readonly game: IGame | null;
  private readonly issues: SceneSpatialValidationIssue[] = [];
  private readonly objectById = new Map<string, SceneObject>();
  private readonly objectIds = new Set<string>();

  private constructor(scene: Scene | null | undefined, game: IGame | null) {
    this.scene = scene;
    this.game = game;
  }

  private validate(): SceneSpatialValidationResult {
    if (!this.scene) {
      this.addIssue('error', 'scene_missing', 'No scene is available for spatial validation.');
      return this.result();
    }

    this.indexObjects();
    this.validateSpatialReferences();
    this.validateComponentConfiguration();
    this.validateContainerSlots();
    this.validateStorageMembership();
    this.validateActorMainInventories();

    return this.result();
  }

  private result(): SceneSpatialValidationResult {
    const errors = this.issues.filter((issue) => issue.severity === 'error');
    const warnings = this.issues.filter((issue) => issue.severity === 'warning');
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      issues: [...this.issues],
    };
  }

  private addIssue(
    severity: SceneSpatialValidationSeverity,
    code: string,
    message: string,
    details: Omit<SceneSpatialValidationIssue, 'severity' | 'code' | 'message'> = {}
  ): void {
    this.issues.push({ severity, code, message, ...details });
  }

  private allObjects(): SceneObject[] {
    return this.scene?.getAllSceneObjects?.() || [];
  }

  private getTitle(object: SceneObject | null | undefined): string | null {
    if (!object) return null;
    const title = this.game?.textAssets?.getResolvedObjectField(object as any, 'title');
    return title && title.trim() ? title.trim() : null;
  }

  private isTitled(object: SceneObject | null | undefined): boolean {
    return !!this.getTitle(object);
  }

  private normalizeSpatialRelation(value: unknown): ContainerRelation | null {
    return isValidRelation(value) ? value : null;
  }

  private getParent(object: SceneObject): SceneObject | null {
    const parentId =
      typeof (object as any).spatial?.parentNodeId === 'string'
        ? (object as any).spatial.parentNodeId.trim()
        : '';
    return parentId ? this.objectById.get(parentId) || null : null;
  }

  private indexObjects(): void {
    for (const object of this.allObjects()) {
      const id = String(object.name || '').trim();
      if (!id) {
        this.addIssue('error', 'object_missing_id', 'Scene object has an empty id.');
        continue;
      }

      if (this.objectIds.has(id)) {
        this.addIssue('error', 'duplicate_object_id', `Duplicate scene object id '${id}'.`, {
          objectId: id,
        });
        continue;
      }

      this.objectIds.add(id);
      this.objectById.set(id, object);
    }
  }

  private validateSpatialReferences(): void {
    for (const object of this.allObjects()) {
      const parentId =
        typeof (object as any).spatial?.parentNodeId === 'string'
          ? (object as any).spatial.parentNodeId.trim()
          : '';
      const rawRelation = (object as any).spatial?.relation;

      if (rawRelation != null && !isValidRelation(rawRelation)) {
        this.addIssue(
          'error',
          'invalid_spatial_relation',
          `${object.name} has invalid spatial relation '${String(rawRelation)}'.`,
          { objectId: object.name }
        );
      }

      if (!parentId) continue;

      if (parentId === object.name) {
        this.addIssue('error', 'spatial_self_parent', `${object.name} cannot be its own parent.`, {
          objectId: object.name,
          relatedObjectId: parentId,
        });
      } else if (!this.objectById.has(parentId)) {
        this.addIssue(
          'error',
          'missing_spatial_parent',
          `${object.name} references missing spatial parent '${parentId}'.`,
          { objectId: object.name, relatedObjectId: parentId }
        );
      }

      if (!isValidRelation(rawRelation)) {
        this.addIssue(
          'warning',
          'spatial_parent_without_relation',
          `${object.name} has a spatial parent but no valid relation; runtime will usually treat this as IN.`,
          { objectId: object.name, relatedObjectId: parentId }
        );
      }
    }

    this.validateSpatialCycles();
  }

  private validateSpatialCycles(): void {
    for (const object of this.allObjects()) {
      const seen = new Set<string>();
      let current: SceneObject | null = object;

      while (current) {
        if (seen.has(current.name)) {
          this.addIssue(
            'error',
            'spatial_cycle',
            `${object.name} is part of a spatial parent cycle.`,
            { objectId: object.name, relatedObjectId: current.name }
          );
          break;
        }
        seen.add(current.name);
        current = this.getParent(current);
      }
    }
  }

  private validateComponentConfiguration(): void {
    for (const object of this.allObjects()) {
      if ((object as any).hidden && !this.isTitled(object)) {
        this.addIssue(
          'warning',
          'hidden_without_title',
          `${object.name} has hidden semantics but no Title, so parser/text layer cannot reveal it as a named object.`,
          { objectId: object.name }
        );
      }

      for (const component of object.components || []) {
        const type = getComponentLabel(component);
        if (type === 'Inventory' && (component as InventoryComponent).relation != null) {
          const relation = (component as InventoryComponent).relation;
          if (!isValidRelation(relation)) {
            this.addIssue(
              'error',
              'invalid_inventory_relation',
              `${object.name} has Inventory with invalid relation '${String(relation)}'.`,
              { objectId: object.name }
            );
          }
        }

        if (type === 'Surface' && (component as SurfaceComponent).relation != null) {
          const relation = (component as SurfaceComponent).relation;
          if (!isValidRelation(relation)) {
            this.addIssue(
              'error',
              'invalid_surface_relation',
              `${object.name} has Surface with invalid relation '${String(relation)}'.`,
              { objectId: object.name }
            );
          }
        }

        if (
          (type === 'Switch' || type === 'Blocker') &&
          (component as any).blockedRelation != null
        ) {
          const relation = (component as any).blockedRelation;
          if (!isValidBlockedRelation(relation)) {
            this.addIssue(
              'error',
              'invalid_blocked_relation',
              `${object.name} has ${type} with invalid blockedRelation '${String(relation)}'.`,
              { objectId: object.name }
            );
          }
        }
      }
    }
  }

  private validateContainerSlots(): void {
    const slotsByAnchor = new Map<string, ContainerSlot[]>();

    for (const object of this.allObjects()) {
      const slots = this.getDirectContainerSlots(object);
      for (const slot of slots) {
        this.addSlot(slotsByAnchor, slot);
      }
    }

    for (const anchor of this.allObjects()) {
      if (!this.isTitled(anchor)) continue;
      for (const slot of this.getExternalContainerSlots(anchor)) {
        this.addSlot(slotsByAnchor, slot);
      }
    }

    for (const [anchorId, slots] of slotsByAnchor) {
      const relationMap = new Map<ContainerRelation, ContainerSlot[]>();
      for (const slot of slots) {
        const existing = relationMap.get(slot.relation) || [];
        existing.push(slot);
        relationMap.set(slot.relation, existing);
      }

      for (const [relation, relationSlots] of relationMap) {
        if (relationSlots.length <= 1) continue;
        const storages = relationSlots
          .map((slot) => `${slot.kind}:${slot.storage.name}`)
          .join(', ');
        this.addIssue(
          'error',
          'duplicate_container_relation',
          `${anchorId} has multiple containers for relation '${relation}': ${storages}. Only one container per relation is allowed.`,
          { objectId: anchorId, relation }
        );
      }
    }
  }

  private addSlot(slotsByAnchor: Map<string, ContainerSlot[]>, slot: ContainerSlot): void {
    const anchorId = slot.owner.name;
    const slots = slotsByAnchor.get(anchorId) || [];
    slots.push(slot);
    slotsByAnchor.set(anchorId, slots);
  }

  private getDirectContainerSlots(object: SceneObject): ContainerSlot[] {
    if (!this.isTitled(object)) return [];

    const slots: ContainerSlot[] = [];
    for (const component of ComponentSystem.getInventoryComponents(object)) {
      slots.push({
        owner: object,
        storage: object,
        component,
        kind: 'Inventory',
        relation: ComponentSystem.normalizeInventoryRelation(component),
        external: false,
      });
    }
    for (const component of ComponentSystem.getSurfaceComponents(object)) {
      slots.push({
        owner: object,
        storage: object,
        component,
        kind: 'Surface',
        relation: ComponentSystem.normalizeSurfaceRelation(component),
        external: false,
      });
    }
    return slots;
  }

  private getExternalContainerSlots(anchor: SceneObject): ContainerSlot[] {
    const slots: ContainerSlot[] = [];
    const queue: Array<{ object: SceneObject; relation: ContainerRelation }> = [];

    for (const child of this.getDirectChildren(anchor)) {
      if (this.isTitled(child)) continue;
      const relation = this.normalizeSpatialRelation((child as any).spatial?.relation);
      if (!relation) continue;
      queue.push({ object: child, relation });
    }

    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current.object.name)) continue;
      visited.add(current.object.name);

      for (const component of ComponentSystem.getInventoryComponents(current.object)) {
        slots.push({
          owner: anchor,
          storage: current.object,
          component,
          kind: 'Inventory',
          relation: current.relation,
          external: true,
        });
      }

      for (const component of ComponentSystem.getSurfaceComponents(current.object)) {
        slots.push({
          owner: anchor,
          storage: current.object,
          component,
          kind: 'Surface',
          relation: current.relation,
          external: true,
        });
      }

      for (const child of this.getDirectChildren(current.object)) {
        if (this.isTitled(child)) continue;
        queue.push({ object: child, relation: current.relation });
      }
    }

    return slots;
  }

  private getDirectChildren(parent: SceneObject): SceneObject[] {
    return this.allObjects().filter((object) => {
      const parentId =
        typeof (object as any).spatial?.parentNodeId === 'string'
          ? (object as any).spatial.parentNodeId.trim()
          : '';
      return parentId === parent.name;
    });
  }

  private validateStorageMembership(): void {
    for (const object of this.allObjects()) {
      for (const component of ComponentSystem.getInventoryComponents(object)) {
        const relation = ComponentSystem.normalizeInventoryRelation(component);
        const ids = Array.isArray(component.items) ? component.items : [];
        const seen = new Set<string>();

        for (const itemId of ids) {
          const normalizedId = String(itemId || '').trim();
          if (!normalizedId) {
            this.addIssue(
              'error',
              'empty_inventory_item_id',
              `${object.name} has an empty Inventory item id.`,
              { objectId: object.name, relation }
            );
            continue;
          }

          if (seen.has(normalizedId)) {
            this.addIssue(
              'warning',
              'duplicate_inventory_item_id',
              `${object.name} Inventory lists '${normalizedId}' more than once.`,
              { objectId: object.name, relatedObjectId: normalizedId, relation }
            );
          }
          seen.add(normalizedId);

          const item = this.objectById.get(normalizedId);
          if (!item) {
            this.addIssue(
              'error',
              'missing_inventory_item',
              `${object.name} Inventory references missing item '${normalizedId}'.`,
              { objectId: object.name, relatedObjectId: normalizedId, relation }
            );
            continue;
          }

          if (!(item instanceof Entity) || !hasItemComponent(item)) {
            this.addIssue(
              'error',
              'inventory_item_not_item',
              `${object.name} Inventory references '${normalizedId}', but it is not an Entity with Item component.`,
              { objectId: object.name, relatedObjectId: normalizedId, relation }
            );
          }

          const parentId =
            typeof (item as any).spatial?.parentNodeId === 'string'
              ? (item as any).spatial.parentNodeId.trim()
              : '';
          const itemRelation = (item as any).spatial?.relation || null;
          if (parentId !== object.name || itemRelation !== 'in') {
            this.addIssue(
              'warning',
              'inventory_item_spatial_mismatch',
              `${normalizedId} is listed in ${object.name} Inventory but has spatial placement '${itemRelation || 'none'} ${parentId}'. Inventory items should be hidden IN-children of the owner.`,
              { objectId: object.name, relatedObjectId: normalizedId, relation }
            );
          }
        }
      }

      for (const component of ComponentSystem.getSurfaceComponents(object)) {
        const relation = ComponentSystem.normalizeSurfaceRelation(component);
        const placements = Array.isArray(component.items) ? component.items : [];
        const seen = new Set<string>();

        for (const placement of placements) {
          const itemId = String((placement as any)?.id || '').trim();
          if (!itemId) {
            this.addIssue(
              'error',
              'empty_surface_item_id',
              `${object.name} Surface has an empty placement item id.`,
              { objectId: object.name, relation }
            );
            continue;
          }

          if (seen.has(itemId)) {
            this.addIssue(
              'warning',
              'duplicate_surface_item_id',
              `${object.name} Surface lists '${itemId}' more than once.`,
              { objectId: object.name, relatedObjectId: itemId, relation }
            );
          }
          seen.add(itemId);

          const item = this.objectById.get(itemId);
          if (!item) {
            this.addIssue(
              'error',
              'missing_surface_item',
              `${object.name} Surface references missing item '${itemId}'.`,
              { objectId: object.name, relatedObjectId: itemId, relation }
            );
            continue;
          }

          if (!(item instanceof Entity) || !hasItemComponent(item)) {
            this.addIssue(
              'error',
              'surface_item_not_item',
              `${object.name} Surface references '${itemId}', but it is not an Entity with Item component.`,
              { objectId: object.name, relatedObjectId: itemId, relation }
            );
          }

          if (!Number.isFinite((placement as any).x) || !Number.isFinite((placement as any).y)) {
            this.addIssue(
              'error',
              'invalid_surface_item_placement',
              `${object.name} Surface placement for '${itemId}' has invalid coordinates.`,
              { objectId: object.name, relatedObjectId: itemId, relation }
            );
          }

          const parentId =
            typeof (item as any).spatial?.parentNodeId === 'string'
              ? (item as any).spatial.parentNodeId.trim()
              : '';
          const itemRelation = (item as any).spatial?.relation || null;
          if (parentId !== object.name || itemRelation !== relation) {
            this.addIssue(
              'warning',
              'surface_item_spatial_mismatch',
              `${itemId} is listed on ${object.name} Surface but has spatial placement '${itemRelation || 'none'} ${parentId || 'none'}'. Surface items should remain spatial children of the surface using the surface relation.`,
              { objectId: object.name, relatedObjectId: itemId, relation }
            );
          }
        }
      }
    }
  }

  private validateActorMainInventories(): void {
    if (!this.scene?.player) return;

    const player = this.scene.player;
    const mainInventoryCount = ComponentSystem.getInventoryComponents(player).filter(
      (component) => ComponentSystem.normalizeInventoryRelation(component) === 'in'
    ).length;

    if (mainInventoryCount === 0) {
      this.addIssue(
        'warning',
        'player_missing_main_inventory',
        `${player.name} has no main Inventory with relation IN.`,
        { objectId: player.name, relation: 'in' }
      );
    } else if (mainInventoryCount > 1) {
      this.addIssue(
        'error',
        'player_duplicate_main_inventory',
        `${player.name} has ${mainInventoryCount} main Inventory components with relation IN.`,
        { objectId: player.name, relation: 'in' }
      );
    }
  }
}
