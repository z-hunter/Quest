import type { GameActionOutcome } from '../../src/core/GameActionTypes';
import { Parser } from '../../src/mechanics/Parser';
import { ComponentSystem } from '../../src/systems/ComponentSystem';
import { getSceneTextLayerAccessState, buildSceneTextLayerSnapshot } from '../../src/scene/SceneTextLayer';
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

  const getAccessOutcome = (entity: Entity, _mode: 'look' | 'interact') => {
    const accessState = getSceneTextLayerAccessState(fixture.scene, fixture.game, entity);
    if (!accessState.hidden && !accessState.blocked) return null;

    if (accessState.hidden) {
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
    const accessOutcome = getAccessOutcome(entity, 'interact');
    if (accessOutcome) return accessOutcome;
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

  fixture.game.openEntity = (entity: Entity) => {
    const accessOutcome = getAccessOutcome(entity, 'interact');
    if (accessOutcome) return accessOutcome;
    const switchComponent = entity.components?.find((component: any) => component?.type === 'Switch') as
      | { state?: number; idKey?: string }
      | undefined;
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
    const switchComponent = entity.components?.find((component: any) => component?.type === 'Switch') as
      | { state?: number; idKey?: string }
      | undefined;
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
    const accessOutcome = getAccessOutcome(entity, 'interact');
    if (accessOutcome) return accessOutcome;
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
    const textLayer = buildSceneTextLayerSnapshot(fixture.scene, fixture.game);
    const anchorTitle = textLayer.entryById.get(anchorNodeId)?.title?.trim();
    if (!anchorTitle) {
      return { status: 'escalate', code: 'spatial_node_missing_title', recoverable: true };
    }
    if (relation === 'in') {
      const anchorObject = fixture.scene.getObjectByName(anchorNodeId);
      const switchComponent = anchorObject?.components?.find(
        (component: any) => component?.type === 'Switch'
      ) as { state?: number; transparent?: boolean; clearlyOpenable?: boolean } | undefined;
      if (switchComponent && (switchComponent.state || 1) !== 2 && !switchComponent.transparent) {
        if (switchComponent.clearlyOpenable) {
          return {
            status: 'failed',
            code: 'blocked_by_closed_container',
            message: fixture.game.text('engine.closed_container', { target: anchorTitle }),
            recoverable: true,
          };
        }
      }
    }
    const childTitles =
      textLayer.childrenByParentAndRelation
        .get(anchorNodeId)
        ?.get(relation as 'in' | 'on' | 'under' | 'behind')
        ?.map((entry) => entry.title)
        .filter((title): title is string => !!title) || [];
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
