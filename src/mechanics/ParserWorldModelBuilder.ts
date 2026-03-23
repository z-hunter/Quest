import type { Game } from '../core/Game';
import { Entity } from '../entities/Entity';
import type { SceneObject } from '../entities/SceneObject';
import type { Scene } from '../scene/Scene';
import { ComponentSystem } from '../systems/ComponentSystem';
import type {
  ParserContext,
  ParserEntityContext,
  ParserInventoryItemContext,
  ParserPendingState,
  ParserRelationType,
  ParserScope,
  ParserSpatialNodeContext,
  ParserSpatialRelationContext,
  ParserWorldModel,
} from './parserTypes';

export class ParserWorldModelBuilder {
  private readonly game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  build(rawInput: string, pendingState: ParserPendingState | null): ParserWorldModel {
    return {
      context: this.buildContext(rawInput, pendingState),
      scope: this.buildScope(),
    };
  }

  private buildContext(rawInput: string, pendingState: ParserPendingState | null): ParserContext {
    const scene = this.game.sceneManager.currentScene;
    const normalizedInput = rawInput.trim().toUpperCase();
    const playerContext = scene?.player
      ? this.compactRecord({
          x: Math.round(scene.player.x),
          y: Math.round(scene.player.y),
        })
      : undefined;
    const sceneContext = scene ? this.buildSceneContext(scene) : undefined;
    const entities = scene ? this.buildEntityContexts(scene) : [];
    const inventory = this.buildInventoryContexts();
    const spatialRelations = scene ? this.buildSpatialRelations(scene) : [];
    const spatialNodes = scene ? this.buildSpatialNodes(scene) : [];
    const pending = pendingState
      ? {
          intent: pendingState.intent,
          question: pendingState.question,
          originalInput: pendingState.originalInput,
        }
      : undefined;

    return this.compactRecord({
      rawInput,
      normalizedInput,
      player: playerContext,
      scene: sceneContext,
      entities,
      inventory,
      spatialNodes,
      spatialRelations,
      pending,
    });
  }

  private buildSceneContext(scene: Scene): NonNullable<ParserContext['scene']> {
    return this.compactRecord({
      id: scene.id,
      title: this.game.textAssets.getResolvedSceneField(scene, 'title') || undefined,
      description: this.game.textAssets.getResolvedSceneField(scene, 'description') || undefined,
      activeSubscene: scene.activeSubscene || undefined,
    });
  }

  private buildEntityContexts(scene: Scene): ParserEntityContext[] {
    const sceneObjects: SceneObject[] = [...(scene.entities || []), ...(scene.triggerboxes || [])];
    return sceneObjects
      .map((sceneObject) => {
        const title = this.getPlayerFacingObjectTitle(sceneObject);
        if (!title) return null;
        const synonyms = this.game.textAssets.getResolvedObjectListField(sceneObject as any, 'synonyms');
        const interactions = Object.keys(sceneObject.interactions || {});
        const isItem = !!sceneObject.components?.find((component: any) => component?.type === 'Item');
        const isDirectSceneObject = this.isDirectSceneObject(scene, sceneObject);
        const coordinates = isDirectSceneObject ? this.getSceneObjectCoordinates(sceneObject) : undefined;
        const reachable =
          isDirectSceneObject &&
          !ComponentSystem.getInteractionDistanceError(sceneObject as any, scene.player)
            ? true
            : undefined;
        return this.compactRecord<ParserEntityContext>({
          id: sceneObject.name,
          title,
          item: isItem || undefined,
          reachable,
          ...coordinates,
          synonyms,
          description:
            this.game.textAssets.getResolvedObjectField(sceneObject as any, 'description') || undefined,
          details:
            this.game.textAssets.getResolvedObjectField(sceneObject as any, 'details') || undefined,
          interactions,
        });
      })
      .filter((entity): entity is ParserEntityContext => !!entity);
  }

  private buildInventoryContexts(): ParserInventoryItemContext[] {
    return (this.game.inventory || [])
      .map((entity: any) => {
        const title = this.game.textAssets.getResolvedObjectField(entity, 'title')?.trim();
        if (!title) return null;
        return this.compactRecord<ParserInventoryItemContext>({
          id: entity.name,
          title,
          synonyms: this.game.textAssets.getResolvedObjectListField(entity, 'synonyms'),
          description: this.game.textAssets.getResolvedObjectField(entity, 'description') || undefined,
          details: this.game.textAssets.getResolvedObjectField(entity, 'details') || undefined,
        });
      })
      .filter((entity): entity is ParserInventoryItemContext => !!entity);
  }

  private buildSpatialNodes(scene: Scene): ParserSpatialNodeContext[] {
    const descriptors = scene.getSpatialNodeDescriptors();
    const spatialIndex = scene.getSpatialIndex();
    const connectedNodeIds = new Set<string>();
    for (const [parentId, children] of spatialIndex.childrenByParentId.entries()) {
      if (children.length) connectedNodeIds.add(parentId);
      for (const child of children) {
        connectedNodeIds.add(child.id);
      }
    }

    return descriptors
      .filter((descriptor) => connectedNodeIds.has(descriptor.id))
      .map((descriptor) => {
        if (descriptor.kind === 'entity') {
          return this.compactRecord<ParserSpatialNodeContext>({
            id: descriptor.id,
            parentNodeId: descriptor.placement?.parentNodeId || undefined,
            relation:
              (descriptor.placement?.relation as Exclude<ParserRelationType, 'near'> | null) ||
              undefined,
          });
        }

        return this.compactRecord<ParserSpatialNodeContext>({
          id: descriptor.id,
          subscene: true,
          title: descriptor.title || undefined,
          parentNodeId: descriptor.placement?.parentNodeId || undefined,
          relation:
            (descriptor.placement?.relation as Exclude<ParserRelationType, 'near'> | null) ||
            undefined,
        });
      });
  }

  private buildSpatialRelations(scene: Scene): ParserSpatialRelationContext[] {
    const spatialIndex = scene.getSpatialIndex();
    const relations: ParserSpatialRelationContext[] = [];

    for (const [anchorNodeId, relationMap] of spatialIndex.childrenByParentAndRelation.entries()) {
      for (const [relation, nodes] of relationMap.entries()) {
        relations.push({
          anchorNodeId,
          relation,
          childNodeIds: nodes.map((node) => node.id),
        });
      }
    }

    return relations;
  }

  private buildScope(): ParserScope {
    const scene = this.game.sceneManager.currentScene;
    const visible = scene ? this.getTextVisibleSceneObjects(scene) : [];
    const held = (this.game.inventory || []).filter(
      (entity: Entity) => !!this.getPlayerFacingObjectTitle(entity)
    );
    const takable = visible.filter((sceneObject): sceneObject is Entity => sceneObject instanceof Entity).filter((entity: Entity) => {
      const isItem =
        entity.components && entity.components.find((component: any) => component.type === 'Item');
      return !!isItem || !!entity.isTakeable;
    });
    const subscene = scene?.activeSubscene
      ? visible.filter((sceneObject: SceneObject) => scene.subsceneEntities.has(sceneObject as any))
      : [];
    const reachable = scene
      ? visible.filter(
          (sceneObject: SceneObject) =>
            !ComponentSystem.getInteractionDistanceError(sceneObject as any, scene.player)
        )
      : [];
    const examinable = this.uniqueObjects([...held, ...subscene, ...reachable]);
    return {
      visible,
      held,
      takable,
      reachable,
      examinable,
      subscene,
    };
  }

  private getTextVisibleSceneObjects(scene: Scene): SceneObject[] {
    return [...(scene.entities || []), ...(scene.triggerboxes || [])].filter(
      (sceneObject: SceneObject) => !sceneObject.disabled && !!this.getPlayerFacingObjectTitle(sceneObject)
    );
  }

  private getPlayerFacingObjectTitle(sceneObject: SceneObject): string | null {
    const title = this.game.textAssets.getResolvedObjectField(sceneObject as any, 'title');
    return title && title.trim() ? title.trim() : null;
  }

  private isDirectSceneObject(scene: Scene, sceneObject: SceneObject): boolean {
    const placement = scene.getSpatialPlacementForObject(sceneObject);
    return !placement?.parentNodeId;
  }

  private getSceneObjectCoordinates(sceneObject: SceneObject): { x: number; y: number } | undefined {
    if (typeof (sceneObject as any).x === 'number' && typeof (sceneObject as any).y === 'number') {
      return {
        x: Math.round((sceneObject as any).x),
        y: Math.round((sceneObject as any).y),
      };
    }

    const poly = Array.isArray((sceneObject as any).poly) ? (sceneObject as any).poly : null;
    if (!poly?.length) return undefined;

    const xs = poly.map((point: { x: number; y: number }) => point.x);
    const ys = poly.map((point: { x: number; y: number }) => point.y);
    return {
      x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
      y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
    };
  }

  private compactRecord<T extends Record<string, unknown>>(value: T): T {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === null || entry === undefined) continue;
      if (Array.isArray(entry)) {
        if (!entry.length) continue;
        result[key] = entry;
        continue;
      }
      if (typeof entry === 'object') {
        const nested = this.compactRecord(entry as Record<string, unknown>);
        if (!Object.keys(nested).length) continue;
        result[key] = nested;
        continue;
      }
      result[key] = entry;
    }
    return result as T;
  }

  private uniqueObjects<T extends SceneObject>(sceneObjects: T[]): T[] {
    return Array.from(new Set(sceneObjects));
  }
}
