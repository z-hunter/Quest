import type { Game } from '../core/Game';
import { Entity } from '../entities/Entity';
import type { SceneObject } from '../entities/SceneObject';
import type { Scene } from '../scene/Scene';
import { createSceneTextLayerQuery, getSceneTextLayerAccessState } from '../scene/SceneTextLayer';
import { ComponentSystem } from '../systems/ComponentSystem';
import type {
  ParserContext,
  ParserEntityContext,
  ParserInventoryItemContext,
  ParserPendingState,
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
    const knownEntities = scene ? this.buildKnownEntityContexts(scene) : [];
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
      knownEntities,
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
    const textLayer = createSceneTextLayerQuery(scene, this.game);
    return textLayer.entries
      .map((entry) => {
        const sceneObject = entry.object;
        const synonyms = this.game.textAssets.getResolvedObjectListField(
          sceneObject as any,
          'synonyms'
        );
        const interactions = Object.keys(sceneObject.interactions || {});
        const isItem = !!sceneObject.components?.find(
          (component: any) => component?.type === 'Item'
        );
        const isDirectSceneObject = !entry.effectiveParentId;
        const coordinates = isDirectSceneObject
          ? this.getSceneObjectCoordinates(sceneObject)
          : undefined;
        const reachable =
          isDirectSceneObject &&
          !sceneObject.disabled &&
          !entry.blocked &&
          !entry.inInactiveSubscene &&
          !ComponentSystem.getInteractionDistanceError(sceneObject as any, scene.player)
            ? true
            : undefined;
        return this.compactRecord<ParserEntityContext>({
          id: sceneObject.name,
          title: entry.title,
          item: isItem || undefined,
          reachable,
          ...coordinates,
          synonyms,
          description:
            this.game.textAssets.getResolvedObjectField(sceneObject as any, 'description') ||
            undefined,
          details:
            this.game.textAssets.getResolvedObjectField(sceneObject as any, 'details') || undefined,
          interactions,
        });
      })
      .filter((entity): entity is ParserEntityContext => !!entity);
  }

  private buildKnownEntityContexts(scene: Scene): ParserEntityContext[] {
    const visibleIds = new Set(this.buildEntityContexts(scene).map((entity) => entity.id));
    return scene
      .getAllSceneObjects()
      .map((sceneObject) => {
        const title = this.getPlayerFacingObjectTitle(sceneObject);
        if (!title) return null;
        if (visibleIds.has(sceneObject.name)) return null;
        if ((this.game as any).isEntityInInventory?.(sceneObject)) return null;

        const accessState = getSceneTextLayerAccessState(scene, this.game, sceneObject);
        const isItem = !!sceneObject.components?.find(
          (component: any) => component?.type === 'Item'
        );
        return this.compactRecord<ParserEntityContext>({
          id: sceneObject.name,
          title,
          item: isItem || undefined,
          visibility: accessState.hidden ? 'hidden' : 'visible',
          accessibility: accessState.blocked
            ? 'blocked'
            : accessState.hidden || sceneObject.disabled || accessState.inInactiveSubscene
              ? 'inaccessible'
              : undefined,
          hiddenReason: accessState.hiddenReason || undefined,
          synonyms: this.game.textAssets.getResolvedObjectListField(sceneObject as any, 'synonyms'),
          description:
            this.game.textAssets.getResolvedObjectField(sceneObject as any, 'description') ||
            undefined,
          details:
            this.game.textAssets.getResolvedObjectField(sceneObject as any, 'details') || undefined,
          interactions: Object.keys(sceneObject.interactions || {}),
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
          description:
            this.game.textAssets.getResolvedObjectField(entity, 'description') || undefined,
          details: this.game.textAssets.getResolvedObjectField(entity, 'details') || undefined,
        });
      })
      .filter((entity): entity is ParserInventoryItemContext => !!entity);
  }

  private buildSpatialNodes(scene: Scene): ParserSpatialNodeContext[] {
    const textLayer = createSceneTextLayerQuery(scene, this.game);
    const connectedNodeIds = new Set<string>();
    for (const [parentId, children] of textLayer.childrenByParentId.entries()) {
      if (children.length) connectedNodeIds.add(parentId);
      for (const child of children) {
        connectedNodeIds.add(child.object.name);
      }
    }

    return textLayer.entries
      .filter((entry) => connectedNodeIds.has(entry.object.name))
      .map((entry) =>
        this.compactRecord<ParserSpatialNodeContext>({
          id: entry.object.name,
          title: entry.title || undefined,
          parentNodeId: entry.effectiveParentId || undefined,
          relation: entry.effectiveRelation || undefined,
        })
      );
  }

  private buildSpatialRelations(scene: Scene): ParserSpatialRelationContext[] {
    const textLayer = createSceneTextLayerQuery(scene, this.game);
    const relations: ParserSpatialRelationContext[] = [];

    for (const [anchorNodeId, relationMap] of textLayer.childrenByParentAndRelation.entries()) {
      for (const relation of relationMap.keys()) {
        relations.push({
          anchorNodeId,
          relation,
          childNodeIds: textLayer
            .getRelationDescendants(anchorNodeId, relation)
            .map((node) => node.object.name),
        });
      }
    }

    return relations;
  }

  private buildScope(): ParserScope {
    const scene = this.game.sceneManager.currentScene;
    const visible = scene ? this.getTextVisibleSceneObjects(scene) : [];
    const textLayer = scene ? createSceneTextLayerQuery(scene, this.game) : null;
    const held = (this.game.inventory || []).filter(
      (entity: Entity) => !!this.getPlayerFacingObjectTitle(entity)
    );
    const externalTakable = Array.isArray((this.game as any).getAccessibleInventoryItems?.())
      ? ((this.game as any).getAccessibleInventoryItems() as Entity[])
      : [];
    const subscene = scene?.activeSubscene
      ? visible.filter((sceneObject: SceneObject) => scene.subsceneEntities.has(sceneObject as any))
      : [];
    const reachable = scene
      ? visible.filter(
          (sceneObject: SceneObject) =>
            !sceneObject.disabled &&
            !textLayer?.entryById.get(sceneObject.name)?.blocked &&
            !ComponentSystem.getInteractionDistanceError(sceneObject as any, scene.player)
        )
      : [];
    const reachableSet = new Set(reachable);
    const subsceneSet = new Set(subscene);
    const visibleItems = visible
      .filter((sceneObject): sceneObject is Entity => sceneObject instanceof Entity)
      .filter((entity: Entity) => {
        if (entity.disabled) return false;
        const isItem =
          entity.components &&
          entity.components.find((component: any) => component.type === 'Item');
        const entry = textLayer?.entryById.get(entity.name);
        return (!!isItem || !!entity.isTakeable) && !entry?.blocked;
      });
    const takable = visibleItems.filter((entity) => !(this.game as any).canTakeEntity?.(entity));
    const putSource = visibleItems
      .filter((entity) => reachableSet.has(entity) || subsceneSet.has(entity))
      .filter((entity) => !(this.game as any).canPutSourceEntity?.(entity));
    const examinable = this.uniqueObjects([...held, ...subscene, ...reachable]);
    return {
      visible,
      held,
      takable: this.uniqueObjects([
        ...takable,
        ...externalTakable.filter((entity: Entity) => !(this.game as any).canTakeEntity?.(entity)),
      ]),
      putSource: this.uniqueObjects([
        ...putSource,
        ...externalTakable.filter(
          (entity: Entity) => !(this.game as any).canPutSourceEntity?.(entity)
        ),
      ]),
      reachable,
      examinable,
      subscene,
      worldKnown: scene ? scene.getAllSceneObjects() : [],
      hiddenKnown: scene
        ? scene
            .getAllSceneObjects()
            .filter((sceneObject) => !!this.getPlayerFacingObjectTitle(sceneObject))
            .filter(
              (sceneObject) => !visible.some((visibleObject) => visibleObject === sceneObject)
            )
        : [],
    };
  }

  private getTextVisibleSceneObjects(scene: Scene): SceneObject[] {
    const textLayer = createSceneTextLayerQuery(scene, this.game);
    return textLayer.entries
      .filter((entry) => entry.inInactiveSubscene || !entry.object.disabled)
      .map((entry) => entry.object);
  }

  private getPlayerFacingObjectTitle(sceneObject: SceneObject): string | null {
    const title = this.game.textAssets.getResolvedObjectField(sceneObject as any, 'title');
    return title && title.trim() ? title.trim() : null;
  }

  private getSceneObjectCoordinates(
    sceneObject: SceneObject
  ): { x: number; y: number } | undefined {
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
