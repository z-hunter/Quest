import { Entity } from '../entities/Entity';
import { ComponentSystem } from '../systems/ComponentSystem';
import { SceneObject } from '../entities/SceneObject';
import { Actor } from '../entities/Actor';
import type { EntityData } from '../entities/Entity';
import { Folder } from '../entities/Folder';
import { Walkbox } from '../entities/Walkbox';
import { Triggerbox } from '../entities/Triggerbox';
import { Geometry } from '../utils/Geometry';
import { SceneRenderer } from '../graphics/SceneRenderer';
import type { IGame } from '../core/IGame';
import { toVisualPosition } from '../utils/Parallax';
import { updateSceneCamera } from './SceneCamera';
import { resolveSceneTargets, cleanupClosingSubscene } from './SceneSubscene';
import {
  handleSceneClick,
  activateSceneObject,
  getHoverCursorAtScreenPoint,
  type HoverCursor,
} from './SceneInteraction';
import { useEditorStore } from '../store/editorStore';
import type {
  SpatialIndex,
  SpatialNodeDescriptor,
  SpatialPlacement,
  SpatialRelationType,
} from './spatialTypes';
import type { SubsceneComponent } from '../systems/ComponentSystem';

interface PickupAnimation {
  entity: Entity;
  startY: number;
  lift: number;
  duration: number;
  elapsed: number;
  baseModelScale: number;
}

interface DropAnimation {
  entity: Entity;
  targetY: number;
  lift: number;
  duration: number;
  elapsed: number;
  baseModelScale: number;
  targetOpacity: number;
}

export interface SceneScaling {
  enabled: boolean;
  min: number;
  max: number;
  horizon: number;
  front: number;
}

export interface SceneData {
  id: string;
  name: string;
  description?: string;
  textRedirects?: Record<string, string>;
  filename?: string;
  walkbox: {
    poly: { x: number; y: number }[];
    name: string;
    mode?: 'Invert' | 'Add' | 'Subtract';
  }[];
  triggerboxes: {
    poly: { x: number; y: number }[];
    name: string;
    script: string;
    components?: any[];
  }[];
  scaling: SceneScaling;
  entities: EntityData[];
  folders?: any[];
  camera?: { x: number; y: number; zoom: number };
  autoCenter?: boolean;
  cameraSpeed?: number;
  camDeadzoneX?: number;
  camDeadzoneY?: number;
  camMinX?: number;
  camMaxX?: number;
  camMinY?: number;
  camMaxY?: number;
}

export class Scene {
  game: IGame;
  renderer: SceneRenderer;

  id: string;
  name: string;
  description: string;
  filename: string;
  background: HTMLImageElement | null;
  entities: Entity[];
  folders: Folder[] = [];
  pickupAnimations: PickupAnimation[] = [];
  dropAnimations: DropAnimation[] = [];
  walkbox: Walkbox[];
  triggerboxes: Triggerbox[];
  scaling: SceneScaling;
  player: Actor | null;

  // Runtime Camera (used for rendering)
  camera: { x: number; y: number; zoom: number };
  autoCenter: boolean;
  cameraSpeed: number;
  camDeadzoneX: number = 50;
  camDeadzoneY: number = 30;

  // Camera Bounds (undefined = infinite)
  camMinX?: number;
  camMaxX?: number;
  camMinY?: number;
  camMaxY?: number;

  // Internal state for "Smart Deadzone" (Catch-up mode)
  private _isCenteringX: boolean = false;
  private _isCenteringY: boolean = false;

  // Default Camera (saved to scene file, restored on load/reset)
  defaultCamera: { x: number; y: number; zoom: number };
  textRedirects: Record<string, string> = {};

  // Subscene State
  private _activeSubscene: string | null = null;
  public subsceneEntities: Set<SceneObject> = new Set();
  public revealedHiddenEntities: Set<string> = new Set();
  public parserNote: string = '';
  public entityParserNotes: Record<string, string> = {};
  public parserNoteNeedsCheck: boolean = false;
  public entityParserNoteNeedsCheck: Record<string, boolean> = {};

  get activeSubscene(): string | null {
    return this._activeSubscene;
  }

  // Unified Target Resolution (Groups & Objects)
  resolveTarget(targetStr: string): SceneObject[] {
    return resolveSceneTargets(this, targetStr);
  }

  set activeSubscene(value: string | null) {
    // If changing from a valid subscene to something else (or null), perform cleanup
    if (this._activeSubscene && this._activeSubscene !== value) {
      cleanupClosingSubscene(this, this._activeSubscene);
    }

    this._activeSubscene = value;
  }

  /**
   * Instantly centers camera on player without smoothing/deadzones,
   * respecting min/max bounds.
   */
  snapCameraToPlayer(): void {
    if (!this.player || !this.autoCenter) return;

    // Use current coordinates directly
    const pX = this.player.x;
    const pY = this.player.y;
    const pHeight = this.player.height || 0;

    let targetX = pX;
    let targetY = pY - pHeight / 2;

    if (this.camMinX !== undefined && targetX < this.camMinX) targetX = this.camMinX;
    if (this.camMaxX !== undefined && targetX > this.camMaxX) targetX = this.camMaxX;
    if (this.camMinY !== undefined && targetY < this.camMinY) targetY = this.camMinY;
    if (this.camMaxY !== undefined && targetY > this.camMaxY) targetY = this.camMaxY;

    this.camera.x = targetX;
    this.camera.y = targetY;

    // Explicitly reset any cached centering state
    this._isCenteringX = false;
    this._isCenteringY = false;
  }

  private normalizeSpatialPlacement(
    value: SpatialPlacement | undefined | null
  ): SpatialPlacement | null {
    if (!value) return null;
    const parentNodeId = typeof value.parentNodeId === 'string' ? value.parentNodeId.trim() : '';
    const relation =
      value.relation === 'in' ||
      value.relation === 'on' ||
      value.relation === 'under' ||
      value.relation === 'behind'
        ? value.relation
        : parentNodeId
          ? 'in'
          : null;
    if (!parentNodeId && !relation) return null;
    return {
      parentNodeId: parentNodeId || null,
      relation,
    };
  }

  getSubsceneComponents(): Array<{ triggerbox: Triggerbox; component: SubsceneComponent }> {
    const result: Array<{ triggerbox: Triggerbox; component: SubsceneComponent }> = [];
    for (const triggerbox of this.triggerboxes) {
      for (const component of triggerbox.components || []) {
        if (component?.type === 'Subscene') {
          result.push({ triggerbox, component: component as SubsceneComponent });
        }
      }
    }
    return result;
  }

  getSpatialNodeDescriptors(): SpatialNodeDescriptor[] {
    const entityNodes: SpatialNodeDescriptor[] = this.entities.map((entity) => ({
      id: entity.name,
      kind: 'entity',
      title: this.game.textAssets.getResolvedObjectField(entity, 'title')?.trim() || null,
      placement: this.normalizeSpatialPlacement((entity as any).spatial),
      sourceName: entity.name,
    }));

    const subsceneNodes: SpatialNodeDescriptor[] = this.getSubsceneComponents().map(
      ({ triggerbox, component }) => ({
        id: (triggerbox.name || component.targetGroupId || '').trim(),
        kind: 'subscene' as const,
        title: component.title?.trim() || null,
        placement: this.normalizeSpatialPlacement((triggerbox as any).spatial),
        sourceName: triggerbox.name,
      })
    );

    return [...entityNodes, ...subsceneNodes].filter((node) => !!node.id);
  }

  getSpatialIndex(): SpatialIndex {
    const nodeById = new Map<string, SpatialNodeDescriptor>();
    const childrenByParentId = new Map<string, SpatialNodeDescriptor[]>();
    const childrenByParentAndRelation = new Map<
      string,
      Map<SpatialRelationType, SpatialNodeDescriptor[]>
    >();

    for (const node of this.getSpatialNodeDescriptors()) {
      nodeById.set(node.id, node);
      const parentId = node.placement?.parentNodeId?.trim();
      const relation = node.placement?.relation || null;
      if (!parentId || !relation) continue;

      const existingChildren = childrenByParentId.get(parentId) || [];
      existingChildren.push(node);
      childrenByParentId.set(parentId, existingChildren);

      const relationMap = childrenByParentAndRelation.get(parentId) || new Map();
      const relationChildren = relationMap.get(relation) || [];
      relationChildren.push(node);
      relationMap.set(relation, relationChildren);
      childrenByParentAndRelation.set(parentId, relationMap);
    }

    return {
      nodeById,
      childrenByParentId,
      childrenByParentAndRelation,
    };
  }

  getSpatialNode(id: string): SpatialNodeDescriptor | null {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return null;
    return this.getSpatialIndex().nodeById.get(normalizedId) || null;
  }

  getDirectSpatialChildren(nodeId: string, relation?: SpatialRelationType): SceneObject[] {
    const normalizedId = String(nodeId || '').trim();
    if (!normalizedId) return [];

    const result = new Set<SceneObject>();
    const allObjects: SceneObject[] = [...this.entities, ...this.walkbox, ...this.triggerboxes];

    for (const obj of allObjects) {
      const placement = this.normalizeSpatialPlacement((obj as any).spatial);
      if (!placement?.parentNodeId || placement.parentNodeId !== normalizedId) continue;
      if (relation && placement.relation !== relation) continue;
      result.add(obj);
    }

    return Array.from(result);
  }

  getSpatialPlacementForObject(obj: SceneObject): SpatialPlacement | null {
    return this.normalizeSpatialPlacement((obj as any).spatial);
  }

  isHiddenEntityRevealed(object: SceneObject | null | undefined): boolean {
    if (!object) return false;
    return this.revealedHiddenEntities.has(object.name);
  }

  revealHiddenEntity(object: SceneObject | null | undefined): boolean {
    if (!object) return false;
    if (this.revealedHiddenEntities.has(object.name)) return false;
    this.revealedHiddenEntities.add(object.name);
    return true;
  }

  getParserNote(): string {
    return this.parserNote;
  }

  setParserNote(note: string): void {
    this.parserNote = note;
    this.parserNoteNeedsCheck = false;
  }

  getParserNoteNeedsCheck(): boolean {
    return !!this.parserNote && !!this.parserNoteNeedsCheck;
  }

  markParserNoteNeedsCheck(): boolean {
    if (!this.parserNote.trim()) return false;
    const changed = !this.parserNoteNeedsCheck;
    this.parserNoteNeedsCheck = true;
    return changed;
  }

  getEntityParserNote(entityId: string): string {
    return this.entityParserNotes[String(entityId || '').trim()] || '';
  }

  getEntityParserNoteNeedsCheck(entityId: string): boolean {
    const normalizedId = String(entityId || '').trim();
    return (
      !!this.entityParserNotes[normalizedId] && !!this.entityParserNoteNeedsCheck[normalizedId]
    );
  }

  setEntityParserNote(entityId: string, note: string): void {
    const normalizedId = String(entityId || '').trim();
    if (!normalizedId) return;
    if (note) {
      this.entityParserNotes[normalizedId] = note;
      delete this.entityParserNoteNeedsCheck[normalizedId];
    } else {
      delete this.entityParserNotes[normalizedId];
      delete this.entityParserNoteNeedsCheck[normalizedId];
    }
  }

  markEntityParserNoteNeedsCheck(entityId: string): boolean {
    const normalizedId = String(entityId || '').trim();
    if (!normalizedId || !this.entityParserNotes[normalizedId]?.trim()) return false;
    const changed = !this.entityParserNoteNeedsCheck[normalizedId];
    this.entityParserNoteNeedsCheck[normalizedId] = true;
    return changed;
  }

  getSpatialDescendantObjects(nodeId: string): SceneObject[] {
    const normalizedId = String(nodeId || '').trim();
    if (!normalizedId) return [];
    return this.getDirectSpatialChildren(normalizedId);
  }

  constructor(game: IGame, id: string, name: string) {
    this.game = game;
    this.id = id;
    this.name = name;
    this.description = `You are in ${name}.`;
    this.filename = ''; // Default empty
    this.background = null; // Image object
    this.entities = [];
    this.folders = [];
    this.walkbox = [];
    this.triggerboxes = [];
    this.scaling = {
      enabled: true,
      min: 0.5,
      max: 1.0,
      horizon: 150, // Y coordinate for min scale
      front: 300, // Y coordinate for max scale
    };
    this.player = null;
    this.camera = { x: 0, y: 0, zoom: 1.0 };
    this.defaultCamera = { x: 0, y: 0, zoom: 1.0 };
    this.renderer = new SceneRenderer(game);

    // Load Scene Data
    this.autoCenter = true; // Default to true
    this.cameraSpeed = 5.0; // Default speed
    this.camDeadzoneX = 50;
    this.camDeadzoneY = 30;
  }

  addEntity(entity: Entity): void {
    this.entities.push(entity);
    // @ts-ignore
    entity.scene = this;
    // If this entity is the player, store a reference
    if ((entity as any).isPlayer) {
      this.player = entity as Actor;
    }
  }

  addFolder(folder: Folder): void {
    this.folders.push(folder);
    // @ts-ignore
    folder.scene = this;
  }

  removeFolder(folder: Folder): void {
    const index = this.folders.indexOf(folder);
    if (index > -1) {
      this.folders.splice(index, 1);
    }
  }

  addTriggerbox(triggerbox: Triggerbox): void {
    this.triggerboxes.push(triggerbox);
    // @ts-ignore
    triggerbox.scene = this;
  }

  addWalkbox(walkbox: Walkbox): void {
    this.walkbox.push(walkbox);
    // @ts-ignore
    walkbox.scene = this;
  }

  removeEntity(entity: Entity): void {
    const index = this.entities.indexOf(entity);
    if (index > -1) {
      this.entities.splice(index, 1);
      this.revealedHiddenEntities.delete(entity.name);
      if (this.subsceneEntities.has(entity)) {
        this.subsceneEntities.delete(entity);
      }
      if (this.player === entity) {
        this.player = null;
      }
    }
  }

  removeTriggerbox(triggerbox: Triggerbox): void {
    const index = this.triggerboxes.indexOf(triggerbox);
    if (index > -1) {
      this.triggerboxes.splice(index, 1);
      this.revealedHiddenEntities.delete(triggerbox.name);
      if (this.subsceneEntities.has(triggerbox)) {
        this.subsceneEntities.delete(triggerbox);
      }
      if (this.activeSubscene && triggerbox.name === this.activeSubscene) {
        this.activeSubscene = null;
      }
    }
  }

  removeWalkbox(walkbox: Walkbox): void {
    const index = this.walkbox.indexOf(walkbox);
    if (index > -1) {
      this.walkbox.splice(index, 1);
      this.revealedHiddenEntities.delete(walkbox.name);
      if (this.subsceneEntities.has(walkbox)) {
        this.subsceneEntities.delete(walkbox);
      }
    }
  }

  getAllSceneObjects(): SceneObject[] {
    return [...this.entities, ...this.walkbox, ...this.triggerboxes];
  }

  getObjectByName(name: string): SceneObject | null {
    const normalized = String(name || '').trim();
    if (!normalized) return null;
    return (
      this.entities.find((obj) => obj.name === normalized) ||
      this.triggerboxes.find((obj) => obj.name === normalized) ||
      this.walkbox.find((obj) => obj.name === normalized) ||
      null
    );
  }

  playPickupAnimation(entity: Entity): void {
    const clone = Entity.fromJSON(this.game, entity.toJSON() as EntityData);
    clone.disabled = false;
    clone.visible = true;
    clone.interactionLocked = true;
    clone.groupID = null;
    clone.components = [];
    clone.interactions = {};
    clone.opacity = entity.opacity ?? 1.0;
    clone.subsceneItemScale = entity.subsceneItemScale || 1;
    clone.update(0);
    // @ts-ignore
    clone.scene = this;

    this.pickupAnimations.push({
      entity: clone,
      startY: clone.y,
      lift: 26,
      duration: 260,
      elapsed: 0,
      baseModelScale: clone.modelScale || 1,
    });
  }

  playDropAnimation(entity: Entity): void {
    this.dropAnimations = this.dropAnimations.filter((anim) => anim.entity !== entity);

    const targetOpacity = entity.opacity ?? 1.0;
    const baseModelScale = entity.modelScale || 1;
    const targetY = entity.y;

    entity.interactionLocked = true;
    entity.y = targetY - 26;
    entity.opacity = 0;
    entity.modelScale = baseModelScale * 1.1;
    entity.update(0);

    this.dropAnimations.push({
      entity,
      targetY,
      lift: 26,
      duration: 260,
      elapsed: 0,
      baseModelScale,
      targetOpacity,
    });
  }

  finishDropAnimation(entity: Entity): void {
    const active = this.dropAnimations.find((anim) => anim.entity === entity);
    if (!active) return;

    entity.y = active.targetY;
    entity.opacity = active.targetOpacity;
    entity.modelScale = active.baseModelScale;
    entity.interactionLocked = false;
    entity.update(0);
    this.dropAnimations = this.dropAnimations.filter((anim) => anim.entity !== entity);
  }

  findEntity(name: string): Entity | undefined {
    const normalized = name.toUpperCase();
    return this.entities.find((e) => {
      if (e.disabled) return false;
      return (
        e.name.toUpperCase() === normalized ||
        (e.customName && e.customName.toUpperCase() === normalized)
      );
    });
  }

  setTextRedirect(field: string, targetField: string): void {
    const source = String(field || '').trim();
    const target = String(targetField || '').trim();
    if (!source || !target) return;
    this.textRedirects[source] = target;
    this.notifyTextRedirectChanged();
  }

  clearTextRedirect(field: string): void {
    const source = String(field || '').trim();
    if (!source) return;
    if (this.textRedirects[source] === undefined) return;
    delete this.textRedirects[source];
    this.notifyTextRedirectChanged();
  }

  private notifyTextRedirectChanged(): void {
    useEditorStore.getState().incrementObjectVersion();
  }

  getScaling(y: number): number {
    if (!this.scaling.enabled) return 1.0;

    // Define horizon and front line from config
    const horizonY = this.scaling.horizon;
    const frontY = this.scaling.front;

    // Clamp Y
    const clampedY = Math.max(horizonY, Math.min(y, frontY));

    // Normalize Y (0.0 at horizon, 1.0 at front)
    const t = (clampedY - horizonY) / (frontY - horizonY);

    // Lerp scale
    return this.scaling.min + t * (this.scaling.max - this.scaling.min);
  }

  isWalkable(x: number, y: number, sourceEntity?: Entity): boolean {
    // console.log(`[Scene] isWalkable(${x}, ${y}) source=${sourceEntity?.name} Collider=${sourceEntity?.colliderWidth}x${sourceEntity?.colliderHeight}`);

    // 0. Zero Collider / Check
    // If entity has explicitly 0 size collider, it's a ghost.
    if (sourceEntity && sourceEntity.colliderWidth === 0 && sourceEntity.colliderHeight === 0) {
      // console.log("  -> Ghost (Zero Collider)");
      return true;
    }

    let sourceRect = null;
    if (sourceEntity && sourceEntity.colliderWidth > 0 && sourceEntity.colliderHeight > 0) {
      // Apply Source Parallax & Visual correction to Source Rect (Visual Collider)
      const sp = sourceEntity.parallax !== undefined ? sourceEntity.parallax : 1.0;
      const svOx = (sourceEntity as any).visualOffset ? (sourceEntity as any).visualOffset.x : 0;
      const svOy = (sourceEntity as any).visualOffset ? (sourceEntity as any).visualOffset.y : 0;
      const sourceVisual = toVisualPosition({ x, y }, this.camera, sp, { x: svOx, y: svOy });

      sourceRect = {
        x: sourceVisual.x - sourceEntity.colliderWidth / 2,
        y: sourceVisual.y - sourceEntity.colliderHeight,
        w: sourceEntity.colliderWidth,
        h: sourceEntity.colliderHeight,
      };
      // console.log(`  -> SourceRect: ${sourceRect.x},${sourceRect.y} ${sourceRect.w}x${sourceRect.h}`);

      // 1. Entity vs Entity Collision
      for (const other of this.entities) {
        if (other === sourceEntity) continue; // Skip self
        if (other.disabled) continue; // Skip disabled
        if (other.colliderWidth === 0 || other.colliderHeight === 0) continue; // Skip ghosts

        const vOx = (other as any).visualOffset ? (other as any).visualOffset.x : 0;
        const vOy = (other as any).visualOffset ? (other as any).visualOffset.y : 0;
        const p = other.parallax !== undefined ? other.parallax : 1.0;
        const otherVisual = toVisualPosition({ x: other.x, y: other.y }, this.camera, p, {
          x: vOx,
          y: vOy,
        });

        const otherRect = {
          x: otherVisual.x - other.colliderWidth / 2,
          y: otherVisual.y - other.colliderHeight,
          w: other.colliderWidth,
          h: other.colliderHeight,
        };

        if (Geometry.rectIntersectsRect(sourceRect, otherRect)) {
          // console.log(`  -> Collision with entity ${other.name}`);
          return false;
        }
      }
    }

    // Filter out disabled walkboxes first
    const activeWalkboxes = this.walkbox ? this.walkbox.filter((wb) => !wb.disabled) : [];

    // Integrated WalkBox Components (Quads)
    // We look for entities with 'WalkBox' component and treat them as walkboxes
    // Optimization: In a large scene, we might want to cache this list.
    this.entities.forEach((entity) => {
      if (entity.disabled) return;
      if (entity.components) {
        const wbComp = entity.components.find((c: any) => c.type === 'WalkBox');
        if (wbComp && (entity as any).vertices) {
          const vertices = (entity as any).vertices.map((v: any) => {
            const p = v.p !== undefined ? v.p : (entity as any).parallax || 1.0;
            let vx = v.x;
            let vy = v.y;
            if (this.camera && p !== 1.0) {
              vx = v.x - this.camera.x * (p - 1.0);
              vy = v.y - this.camera.y * (p - 1.0);
            }
            return { x: vx, y: vy };
          });

          activeWalkboxes.push({
            name: entity.name,
            poly: vertices, // Corrected Visual Vertices
            mode: wbComp.mode || 'Invert',
            disabled: false,
          } as any);
        }
      }
    });

    // If no active walkboxes, everything is walkable
    if (activeWalkboxes.length === 0) return true;

    if (sourceRect) {
      // --- COLLIDER MODE ---

      // 2. Subtract (Holes) - High Priority
      for (const wb of activeWalkboxes) {
        if (wb.mode === 'Subtract') {
          if (Geometry.rectIntersectsPolygon(sourceRect, wb.poly)) {
            return false; // Hit a hole
          }
        }
      }

      // 3. Positive Constraints (Add + Invert)
      // If ANY 'Invert' or 'Add' boxes exist, the default for the world becomes BLOCKED
      // unless we are inside at least one of them.
      const positives = activeWalkboxes.filter(
        (wb) => wb.mode === 'Add' || wb.mode === 'Invert' || !wb.mode
      );

      if (positives.length > 0) {
        let safe = false;

        // Check simple containment in ANY positive box
        for (const wb of positives) {
          if (Geometry.rectInsidePolygon(sourceRect, wb.poly)) {
            safe = true;
            break;
          }
        }

        if (!safe) {
          return false;
        }
      }

      return true;

      return true;
    } else {
      // --- POINT MODE (Legacy/Mouse/ZeroCollider) ---

      // 1. Subtract
      for (const wb of activeWalkboxes) {
        if (wb.mode === 'Subtract') {
          if (Geometry.isPointInPolygon({ x, y }, wb.poly)) {
            return false;
          }
        }
      }

      // 2. Add
      for (const wb of activeWalkboxes) {
        if (wb.mode === 'Add') {
          if (Geometry.isPointInPolygon({ x, y }, wb.poly)) {
            return true;
          }
        }
      }

      // 3. Invert (Standard Even-Odd)
      let inclusionCount = 0;
      let hasInvert = false;
      for (const wb of activeWalkboxes) {
        if (!wb.mode || wb.mode === 'Invert') {
          hasInvert = true;
          if (Geometry.isPointInPolygon({ x, y }, wb.poly)) {
            inclusionCount++;
          }
        }
      }

      if (hasInvert) {
        return inclusionCount % 2 !== 0; // Odd = Inside
      } else {
        return false;
      }
    }
  }

  /**
   * Finds the topmost interactive object at the given WORLD coordinates.
   * Uses the exact logic as onClick to determine what "blocks" a click.
   */
  getHitObject(worldX: number, worldY: number): SceneObject | null {
    // 1. Gather Candidates
    const candidates: SceneObject[] = [];
    this.entities.forEach((e) => {
      if (!e.disabled) candidates.push(e);
    });
    if (this.triggerboxes) {
      this.triggerboxes.forEach((t) => {
        if (!t.disabled) candidates.push(t);
      });
    }

    // 2. Sort Candidates (EXACT logic from user requirements / onClick)
    candidates.sort((a, b) => {
      const layerA = a.layer || 0;
      const layerB = b.layer || 0;
      if (layerA !== layerB) {
        return layerB - layerA; // Descending
      }

      const isEntityA = a instanceof Entity;
      const isEntityB = b instanceof Entity;

      if (isEntityA && !isEntityB) return -1;
      if (!isEntityA && isEntityB) return 1;

      return 0;
    });

    // 3. Iterate & Hit Test
    for (const obj of candidates) {
      if (obj.hitTest(worldX, worldY)) {
        // Check Interactivity
        const hasComponents = obj.components && obj.components.length > 0;

        // Unified Interactivity Check (Entity or Triggerbox)
        // Only Specific Components are considered "Interactive" (blocking clicks)
        // Items (pickups) are Passive for clicking - you walk to them.
        // WalkBox IS interactive because it must catch the click (layer blocking)
        const interactiveTypes = ['Switch', 'Subscene', 'Subtrigger', 'WalkBox'];
        let isComponentInteractive = false;

        if (hasComponents) {
          isComponentInteractive = obj.components!.some(
            (c) => c && interactiveTypes.includes(c.type)
          );
        }

        // Triggerboxes are also interactive if they have a script
        // Note: Triggerboxes with WalkBox ONLY should now NOT block (Fixed)
        const isScriptTrigger = obj instanceof Triggerbox && obj.script && obj.script.length > 0;

        const hasInteractions = obj.interactions && Object.keys(obj.interactions).length > 0;
        const isInteractive = isComponentInteractive || isScriptTrigger || hasInteractions;

        if (isInteractive) {
          return obj; // Found the blocking interactive object
        }

        // Debugging "Absorbed Click" false positives
        // if (hasComponents) {
        //    console.log(`[Scene] PASSTHROUGH ${obj.name} (${obj.type}). Components: ${obj.components.map(c=>c.type).join(',')}`);
        // }

        // Passive -> Continue
      }
    }
    return null;
  }

  checkHover(x: number, y: number): HoverCursor | null {
    return getHoverCursorAtScreenPoint(this, x, y);
  }

  onClick(x: number, y: number): void {
    handleSceneClick(this, x, y);
  }

  activateObject(obj: SceneObject, depth: number = 0, activator?: Actor): void {
    activateSceneObject(this, obj, depth, activator);
  }

  getActiveSubsceneItemScale(): number {
    const activeSubsceneId = String(this.activeSubscene || '').trim();
    if (!activeSubsceneId) return 1;

    const triggerbox = this.triggerboxes.find((candidate) => {
      if (candidate.name === activeSubsceneId) return true;
      return candidate.components?.some(
        (component: any) =>
          component?.type === 'Subscene' &&
          String(component.targetGroupId || '').trim() === activeSubsceneId
      );
    });
    const subsceneComponent = triggerbox?.components?.find(
      (component: any) => component?.type === 'Subscene'
    ) as { itemScale?: number } | undefined;
    const itemScale = subsceneComponent?.itemScale;
    return typeof itemScale === 'number' && Number.isFinite(itemScale) && itemScale > 0
      ? itemScale
      : 1;
  }

  private syncSubsceneItemScales(): void {
    const activeItemScale = this.getActiveSubsceneItemScale();

    for (const entity of this.entities) {
      const isItem = entity.components?.some((component: any) => component?.type === 'Item');
      const nextScale =
        !!this.activeSubscene && isItem && this.subsceneEntities.has(entity) ? activeItemScale : 1;
      if (entity.subsceneItemScale === nextScale) continue;
      entity.subsceneItemScale = nextScale;
      if (entity.disabled) {
        entity.update(0);
      }
    }
  }

  update(deltaTime: number): void {
    // Run Component System Logic (Shadows, Parallax, etc.)
    ComponentSystem.update(this, deltaTime);
    ComponentSystem.checkTriggerboxCollisions(this);
    this.syncSubsceneItemScales();

    const cameraState = updateSceneCamera(this, deltaTime, {
      isCenteringX: this._isCenteringX,
      isCenteringY: this._isCenteringY,
    });
    this._isCenteringX = cameraState.isCenteringX;
    this._isCenteringY = cameraState.isCenteringY;

    this.entities.forEach((entity) => {
      if (entity.disabled) return;
      if (entity instanceof Actor) {
        entity.update(deltaTime, (x: number, y: number) => this.isWalkable(x, y, entity));
      } else {
        entity.update(deltaTime);
      }
    });

    if (this.pickupAnimations.length > 0) {
      const nextAnimations: PickupAnimation[] = [];
      for (const anim of this.pickupAnimations) {
        anim.elapsed += deltaTime;
        const progress = Math.min(anim.elapsed / anim.duration, 1);
        const eased = 1 - Math.pow(1 - progress, 2);
        anim.entity.y = anim.startY - anim.lift * eased;
        anim.entity.opacity = Math.max(0, 1 - progress);
        anim.entity.modelScale = anim.baseModelScale * (1 + 0.1 * eased);
        anim.entity.update(deltaTime);
        if (progress < 1) {
          nextAnimations.push(anim);
        }
      }
      this.pickupAnimations = nextAnimations;
    }

    if (this.dropAnimations.length > 0) {
      const nextAnimations: DropAnimation[] = [];
      for (const anim of this.dropAnimations) {
        if (!this.entities.includes(anim.entity)) continue;

        anim.elapsed += deltaTime;
        const progress = Math.min(anim.elapsed / anim.duration, 1);
        const eased = 1 - Math.pow(1 - progress, 2);

        anim.entity.y = anim.targetY - anim.lift * (1 - eased);
        anim.entity.opacity = Math.min(anim.targetOpacity, anim.targetOpacity * progress);
        anim.entity.modelScale = anim.baseModelScale * (1 + 0.1 * (1 - eased));
        anim.entity.update(0);

        if (progress < 1) {
          nextAnimations.push(anim);
        } else {
          anim.entity.y = anim.targetY;
          anim.entity.opacity = anim.targetOpacity;
          anim.entity.modelScale = anim.baseModelScale;
          anim.entity.interactionLocked = false;
          anim.entity.update(0);
        }
      }
      this.dropAnimations = nextAnimations;
    }
  }

  // -----------------------------------------------------
  // RENDER LOOP
  // -----------------------------------------------------
  // -----------------------------------------------------

  render(ctx: CanvasRenderingContext2D): void {
    this.renderer.render(ctx, this);
  }

  toJSON(): SceneData {
    // We include Player in the entities list so state is saved (pos, etc)
    // Loader must handle 'Player' type specially to assign to scene.player
    const savedEntities = this.entities.map((e) => e.toJSON());
    const savedFolders = this.folders.map((f) => f.toJSON());

    return {
      id: this.id,
      name: this.name,
      description: this.description,
      textRedirects: this.textRedirects,
      filename: this.filename,
      walkbox: this.walkbox.map((wb) => wb.toJSON()),
      triggerboxes: this.triggerboxes.map((tb) => tb.toJSON()),
      scaling: this.scaling,
      entities: savedEntities,
      folders: savedFolders,
      camera: this.defaultCamera, // Save the DEFAULT settings, not the current runtime state
      autoCenter: this.autoCenter,
      cameraSpeed: this.cameraSpeed,
      camDeadzoneX: this.camDeadzoneX,
      camDeadzoneY: this.camDeadzoneY,
      camMinX: this.camMinX,
      camMaxX: this.camMaxX,
      camMinY: this.camMinY,
      camMaxY: this.camMaxY,
    };
  }
}
