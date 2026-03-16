import type { Game } from '../core/Game';
import type { Entity } from '../entities/Entity';
import { ComponentSystem } from '../systems/ComponentSystem';
import type {
  ParserContext,
  ParserEntityContext,
  ParserInventoryItemContext,
  ParserPendingState,
  ParserScope,
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

    return {
      rawInput,
      normalizedInput,
      scene: scene
        ? {
            id: scene.id,
            name: scene.name,
            title: this.game.textAssets.getResolvedSceneField(scene, 'title'),
            description: this.game.textAssets.getResolvedSceneField(scene, 'description'),
            activeSubscene: scene.activeSubscene || null,
          }
        : null,
      entities: scene
        ? (scene.entities || [])
            .map((entity: any) => ({
              id: entity.name,
              type: entity.type,
              title: this.game.textAssets.getResolvedObjectField(entity, 'title'),
              synonyms: this.game.textAssets.getResolvedObjectListField(entity, 'synonyms'),
              description: this.game.textAssets.getResolvedObjectField(entity, 'description'),
              details: this.game.textAssets.getResolvedObjectField(entity, 'details'),
              interactions: Object.keys(entity.interactions || {}),
            }))
            .filter((entity: ParserEntityContext) => !!entity.title?.trim())
        : [],
      inventory: (this.game.inventory || [])
        .map((entity: any) => ({
          id: entity.name,
          title: this.game.textAssets.getResolvedObjectField(entity, 'title'),
          synonyms: this.game.textAssets.getResolvedObjectListField(entity, 'synonyms'),
          description: this.game.textAssets.getResolvedObjectField(entity, 'description'),
          details: this.game.textAssets.getResolvedObjectField(entity, 'details'),
        }))
        .filter((entity: ParserInventoryItemContext) => !!entity.title?.trim()),
      pending: pendingState
        ? {
            intent: pendingState.intent,
            question: pendingState.question,
            originalInput: pendingState.originalInput,
          }
        : null,
    };
  }

  private buildScope(): ParserScope {
    const scene = this.game.sceneManager.currentScene;
    const visible = scene
      ? (scene.entities || []).filter(
          (entity: Entity) => !entity.disabled && !!this.getPlayerFacingEntityTitle(entity)
        )
      : [];
    const held = (this.game.inventory || []).filter(
      (entity: Entity) => !!this.getPlayerFacingEntityTitle(entity)
    );
    const takable = visible.filter((entity: Entity) => {
      const isItem =
        entity.components && entity.components.find((component: any) => component.type === 'Item');
      return !!isItem || !!entity.isTakeable;
    });
    const subscene = scene?.activeSubscene
      ? visible.filter((entity: Entity) => scene.subsceneEntities.has(entity as any))
      : [];
    const reachable = scene
      ? visible.filter(
          (entity: Entity) =>
            !ComponentSystem.getInteractionDistanceError(entity as any, scene.player)
        )
      : [];
    const examinable = this.uniqueEntities([...held, ...subscene, ...reachable]);
    const sceneTargets = Array.from(this.game.sceneManager.sceneRegistry.values());

    return {
      visible,
      held,
      takable,
      reachable,
      examinable,
      subscene,
      sceneTargets,
    };
  }

  private getPlayerFacingEntityTitle(entity: Entity): string | null {
    const title = this.game.textAssets.getResolvedObjectField(entity, 'title');
    return title && title.trim() ? title.trim() : null;
  }

  private uniqueEntities(entities: Entity[]): Entity[] {
    return Array.from(new Set(entities));
  }
}
