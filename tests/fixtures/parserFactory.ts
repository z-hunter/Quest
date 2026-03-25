import type { GameActionOutcome } from '../../src/core/GameActionTypes';
import { Parser } from '../../src/mechanics/Parser';
import { ComponentSystem } from '../../src/systems/ComponentSystem';
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

function okOutcome(code: string, message?: string, data?: Record<string, unknown>): GameActionOutcome {
  return { status: 'ok', code, message, data };
}

export function createParserFixture(): ParserFixture {
  const fixture = createSceneFixture();

  fixture.game.console = {
    parserStage1Enabled: true,
    parserStage2Enabled: false,
    parserPeekEnabled: false,
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
    const distanceError = ComponentSystem.getInteractionDistanceError(
      entity as any,
      fixture.scene.player
    );
    if (distanceError && !fixture.game.inventory.includes(entity)) {
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

  fixture.game.takeEntity = (entity: Entity) => {
    const error = ComponentSystem.canTakeItem(entity as any, fixture.scene.player);
    if (error) {
      return { status: 'failed', code: 'cannot_take', message: error, recoverable: true };
    }
    fixture.scene.removeEntity(entity);
    fixture.game.inventory.push(entity);
    const title = fixture.textAssets.getResolvedObjectField(entity, 'title') || entity.name;
    return okOutcome('item_taken', fixture.game.text('parser.take_pickup_success', { item: title }), {
      entityId: entity.name,
    });
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
    const normalized = String(target || '').trim().toUpperCase();
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
    return okOutcome('player_moving', fixture.game.text('parser.go_to_success', { target: title }), {
      entityId: entity.name,
    });
  };

  fixture.game.describeSpatialRelation = (anchorNodeId, relation) => {
    const anchorNode = fixture.scene.getSpatialNode(anchorNodeId);
    const anchorTitle = anchorNode?.title?.trim();
    if (!anchorTitle) {
      return { status: 'escalate', code: 'spatial_node_missing_title', recoverable: true };
    }
    const childTitles = fixture.scene
      .getDirectSpatialChildren(anchorNodeId, relation)
      .map((child) => fixture.textAssets.getResolvedObjectField(child, 'title'))
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
        items: childTitles.join(', '),
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
