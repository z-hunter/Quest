import type { Game } from '../core/Game';
import { Entity } from '../entities/Entity';
import type { SceneObject } from '../entities/SceneObject';
import type { Scene } from '../scene/Scene';
import { createSceneTextLayerQuery, getSceneTextLayerAccessState } from '../scene/SceneTextLayer';
import { ComponentSystem } from '../systems/ComponentSystem';
import type {
  ParserContext,
  ParserEntityContentContext,
  ParserEntityContext,
  ParserEntityLocationContext,
  ParserInventoryItemContext,
  ParserPendingState,
  ParserRelationType,
  ParserScope,
  ParserSpatialNodeContext,
  ParserSpatialRelationContext,
  ParserStateContext,
  ParserWorldModel,
} from './parserTypes';

type ParserSemanticRelationFact = {
  relation: Exclude<ParserRelationType, 'near'>;
  childTags: string[];
  fact: string;
};

const SEMANTIC_RELATIONS: Array<ParserSemanticRelationFact['relation']> = [
  'on',
  'under',
  'in',
  'behind',
];

export class ParserWorldModelBuilder {
  private readonly game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  build(rawInput: string, pendingState: ParserPendingState | null): ParserWorldModel {
    const scope = this.buildScope();
    return {
      context: this.buildContext(rawInput, pendingState, scope),
      scope,
    };
  }

  private buildContext(
    rawInput: string,
    pendingState: ParserPendingState | null,
    scope: ParserScope
  ): ParserContext {
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
    const focusedTarget = this.buildFocusedTargetContext();
    const worldFacts = scene ? this.buildWorldFacts(scene, entities, knownEntities, inventory) : [];
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
      focusedTarget,
      player: playerContext,
      scene: sceneContext,
      entities,
      knownEntities,
      inventory,
      worldFacts,
      spatialNodes,
      spatialRelations,
      actionScope: {
        takable: scope.takable.map((entity) => entity.name),
        putSource: scope.putSource.map((entity) => entity.name),
        reachable: scope.reachable.map((entity) => entity.name),
        examinable: scope.examinable.map((entity) => entity.name),
      },
      pending,
    });
  }

  private buildFocusedTargetContext(): ParserContext['focusedTarget'] | undefined {
    const entity = this.game.getInventoryPreviewEntity?.();
    if (!entity || !(this.game.inventory || []).includes(entity)) return undefined;
    const title = this.game.textAssets.getResolvedObjectField(entity, 'title')?.trim();
    if (!title) return undefined;
    return this.compactRecord<NonNullable<ParserContext['focusedTarget']>>({
      id: entity.name,
      title,
      source: 'inventoryPreview',
      synonyms: this.game.textAssets.getResolvedObjectListField(entity, 'synonyms'),
      description: this.game.textAssets.getResolvedObjectField(entity, 'description') || undefined,
      details: this.game.textAssets.getResolvedObjectField(entity, 'details') || undefined,
      lore: this.game.textAssets.getResolvedObjectField(entity, 'lore') || undefined,
      parserNote:
        this.getEntityParserNote(this.game.sceneManager.currentScene, entity.name) || undefined,
      parserNoteNeedsCheck: this.getEntityParserNoteNeedsCheck(
        this.game.sceneManager.currentScene,
        entity.name
      )
        ? true
        : undefined,
      states: this.buildStateContexts(entity),
    });
  }

  private buildSceneContext(scene: Scene): NonNullable<ParserContext['scene']> {
    return this.compactRecord({
      id: scene.id,
      title: this.game.textAssets.getResolvedSceneField(scene, 'title') || undefined,
      description: this.game.textAssets.getResolvedSceneField(scene, 'description') || undefined,
      lore: this.game.textAssets.getResolvedSceneField(scene, 'lore') || undefined,
      parserNote: this.getSceneParserNote(scene) || undefined,
      parserNoteNeedsCheck: this.getSceneParserNoteNeedsCheck(scene) ? true : undefined,
      activeSubscene: scene.activeSubscene || undefined,
      recentTurns: this.getSceneParserRecentTurns(scene),
    });
  }

  private getSceneParserRecentTurns(
    scene: Scene
  ): NonNullable<ParserContext['scene']>['recentTurns'] {
    const turns =
      typeof (scene as any).getParserRecentTurns === 'function'
        ? (scene as any).getParserRecentTurns()
        : (scene as any).parserRecentTurns;
    if (!Array.isArray(turns)) return [];

    return turns
      .map((turn) => ({
        command: typeof turn?.command === 'string' ? turn.command.trim() : '',
        response: typeof turn?.response === 'string' ? turn.response.trim() : '',
      }))
      .filter((turn) => !!turn.command && !!turn.response);
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
        const perception = scene.player
          ? this.game.actorWorld.getObjectPerception(scene.player, sceneObject, true)
          : null;
        const reachable =
          isDirectSceneObject && perception?.interaction === 'reachable' ? true : undefined;

        const exitComponent = sceneObject.components?.find(
          (component: any) => component?.type === 'Exit'
        ) as any;
        let exitContext = undefined;
        if (exitComponent) {
          let sceneId =
            exitComponent.targetSceneId?.trim() || this.game.sceneManager.currentScene?.id || '';
          if (sceneId.toLowerCase().endsWith('.json')) sceneId = sceneId.slice(0, -5);

          const targetScene = this.game.sceneManager.scenes.get(sceneId);
          const descriptor = this.game.sceneManager.sceneRegistry.get(sceneId);
          exitContext = {
            targetSceneId:
              exitComponent.targetSceneId?.trim() || this.game.sceneManager.currentScene?.id,
            targetEntryId: exitComponent.targetEntryId || null,
            targetSceneTitle:
              (targetScene && this.game.textAssets.getResolvedSceneField(targetScene, 'title')) ||
              descriptor?.title ||
              null,
            portal: exitComponent.portal === true,
            collider: exitComponent.collider !== false,
          };
        }

        return this.compactRecord<ParserEntityContext>({
          id: sceneObject.name,
          title: entry.title,
          item: isItem || undefined,
          location: this.buildEntityLocationContext(entry, textLayer),
          contents: this.buildEntityContentsContext(sceneObject.name, textLayer),
          reachable,
          ...coordinates,
          synonyms,
          semanticTags: this.game.textAssets.getResolvedObjectListField(
            sceneObject as any,
            'semanticTags'
          ),
          description:
            this.game.textAssets.getResolvedObjectField(sceneObject as any, 'description') ||
            undefined,
          details:
            this.game.textAssets.getResolvedObjectField(sceneObject as any, 'details') || undefined,
          lore:
            this.game.textAssets.getResolvedObjectField(sceneObject as any, 'lore') || undefined,
          parserNote: this.getEntityParserNote(scene, sceneObject.name) || undefined,
          parserNoteNeedsCheck: this.getEntityParserNoteNeedsCheck(scene, sceneObject.name)
            ? true
            : undefined,
          interactions,
          states: this.buildStateContexts(sceneObject),
          exit: exitContext,
        });
      })
      .filter((entity): entity is ParserEntityContext => !!entity);
  }

  private buildKnownEntityContexts(scene: Scene): ParserEntityContext[] {
    const textLayer = createSceneTextLayerQuery(scene, this.game);
    const visibleIds = new Set(this.buildEntityContexts(scene).map((entity) => entity.id));
    return scene
      .getAllSceneObjects()
      .map((sceneObject) => {
        const title = this.getPlayerFacingObjectTitle(sceneObject);
        if (!title) return null;
        if (visibleIds.has(sceneObject.name)) return null;
        if ((this.game as any).isEntityInInventory?.(sceneObject)) return null;

        const accessState = getSceneTextLayerAccessState(scene, this.game, sceneObject);
        const perception = scene.player
          ? this.game.actorWorld.getObjectPerception(scene.player, sceneObject, true)
          : null;
        const isItem = !!sceneObject.components?.find(
          (component: any) => component?.type === 'Item'
        );

        const exitComponent = sceneObject.components?.find(
          (component: any) => component?.type === 'Exit'
        ) as any;
        let exitContext = undefined;
        if (exitComponent) {
          let sceneId =
            exitComponent.targetSceneId?.trim() || this.game.sceneManager.currentScene?.id || '';
          if (sceneId.toLowerCase().endsWith('.json')) sceneId = sceneId.slice(0, -5);

          const targetScene = this.game.sceneManager.scenes.get(sceneId);
          const descriptor = this.game.sceneManager.sceneRegistry.get(sceneId);
          exitContext = {
            targetSceneId:
              exitComponent.targetSceneId?.trim() || this.game.sceneManager.currentScene?.id,
            targetEntryId: exitComponent.targetEntryId || null,
            targetSceneTitle:
              (targetScene && this.game.textAssets.getResolvedSceneField(targetScene, 'title')) ||
              descriptor?.title ||
              null,
            portal: exitComponent.portal === true,
            collider: exitComponent.collider !== false,
          };
        }

        return this.compactRecord<ParserEntityContext>({
          id: sceneObject.name,
          title,
          item: isItem || undefined,
          location: this.buildLocationContext(
            accessState.effectiveParentId,
            accessState.effectiveRelation,
            textLayer
          ),
          contents: this.buildEntityContentsContext(sceneObject.name, textLayer),
          visibility:
            perception?.visibility === 'unknown'
              ? 'hidden'
              : perception?.visibility || (accessState.hidden ? 'hidden' : 'visible'),
          accessibility:
            perception?.visibility !== 'visible' ||
            sceneObject.disabled ||
            accessState.inInactiveSubscene
              ? 'inaccessible'
              : perception?.interaction === 'blocked'
                ? 'blocked'
                : undefined,
          hiddenReason: accessState.hiddenReason || undefined,
          synonyms: this.game.textAssets.getResolvedObjectListField(sceneObject as any, 'synonyms'),
          semanticTags: this.game.textAssets.getResolvedObjectListField(
            sceneObject as any,
            'semanticTags'
          ),
          description:
            this.game.textAssets.getResolvedObjectField(sceneObject as any, 'description') ||
            undefined,
          details:
            this.game.textAssets.getResolvedObjectField(sceneObject as any, 'details') || undefined,
          lore:
            this.game.textAssets.getResolvedObjectField(sceneObject as any, 'lore') || undefined,
          parserNote: this.getEntityParserNote(scene, sceneObject.name) || undefined,
          parserNoteNeedsCheck: this.getEntityParserNoteNeedsCheck(scene, sceneObject.name)
            ? true
            : undefined,
          interactions: Object.keys(sceneObject.interactions || {}),
          states: this.buildStateContexts(sceneObject),
          exit: exitContext,
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
          lore: this.game.textAssets.getResolvedObjectField(entity, 'lore') || undefined,
          parserNote:
            this.getEntityParserNote(this.game.sceneManager.currentScene, entity.name) || undefined,
          parserNoteNeedsCheck: this.getEntityParserNoteNeedsCheck(
            this.game.sceneManager.currentScene,
            entity.name
          )
            ? true
            : undefined,
          states: this.buildStateContexts(entity),
        });
      })
      .filter((entity): entity is ParserInventoryItemContext => !!entity);
  }

  private buildStateContexts(sceneObject: SceneObject): ParserStateContext[] {
    return ComponentSystem.getStateComponents(sceneObject).map((component) => ({
      id: component.id,
      type: component.valueType,
      value: ComponentSystem.getStateValue(sceneObject, component.id) ?? component.initialValue,
    }));
  }

  private getSceneParserNote(scene: Scene | null | undefined): string {
    if (!scene) return '';
    const note =
      typeof (scene as any).getParserNote === 'function'
        ? (scene as any).getParserNote()
        : (scene as any).parserNote;
    return typeof note === 'string' ? note.trim() : '';
  }

  private getSceneParserNoteNeedsCheck(scene: Scene | null | undefined): boolean {
    if (!scene || !this.getSceneParserNote(scene)) return false;
    if (typeof (scene as any).getParserNoteNeedsCheck === 'function') {
      return !!(scene as any).getParserNoteNeedsCheck();
    }
    return !!(scene as any).parserNoteNeedsCheck;
  }

  private getEntityParserNote(scene: Scene | null | undefined, entityId: string): string {
    if (!scene) return '';
    const note =
      typeof (scene as any).getEntityParserNote === 'function'
        ? (scene as any).getEntityParserNote(entityId)
        : (scene as any).entityParserNotes?.[entityId];
    return typeof note === 'string' ? note.trim() : '';
  }

  private getEntityParserNoteNeedsCheck(
    scene: Scene | null | undefined,
    entityId: string
  ): boolean {
    if (!scene || !this.getEntityParserNote(scene, entityId)) return false;
    if (typeof (scene as any).getEntityParserNoteNeedsCheck === 'function') {
      return !!(scene as any).getEntityParserNoteNeedsCheck(entityId);
    }
    return !!(scene as any).entityParserNoteNeedsCheck?.[entityId];
  }

  private buildEntityLocationContext(
    entry: ReturnType<typeof createSceneTextLayerQuery>['entries'][number],
    textLayer: ReturnType<typeof createSceneTextLayerQuery>
  ): ParserEntityLocationContext | undefined {
    return this.buildLocationContext(entry.effectiveParentId, entry.effectiveRelation, textLayer);
  }

  private buildLocationContext(
    parentId: string | null,
    relation: ParserEntityLocationContext['relation'] | null,
    textLayer: ReturnType<typeof createSceneTextLayerQuery>
  ): ParserEntityLocationContext | undefined {
    if (!parentId || !relation) return undefined;
    const parentEntry = textLayer.entryById.get(parentId);
    return this.compactRecord<ParserEntityLocationContext>({
      relation,
      parentId,
      parentTitle: parentEntry?.title || undefined,
    });
  }

  private buildEntityContentsContext(
    entityId: string,
    textLayer: ReturnType<typeof createSceneTextLayerQuery>
  ): ParserEntityContentContext[] {
    const relationMap = textLayer.childrenByParentAndRelation.get(entityId);
    if (!relationMap) return [];

    const contents: ParserEntityContentContext[] = [];
    for (const [relation] of relationMap.entries()) {
      for (const child of textLayer.getRelationDescendants(entityId, relation)) {
        contents.push(
          this.compactRecord<ParserEntityContentContext>({
            relation,
            id: child.object.name,
            title: child.title,
          })
        );
      }
    }
    return contents;
  }

  private buildWorldFacts(
    scene: Scene,
    entities: ParserEntityContext[],
    knownEntities: ParserEntityContext[],
    inventory: ParserInventoryItemContext[]
  ): string[] {
    const facts: string[] = [];
    const titleById = new Map(entities.map((entity) => [entity.id, entity.title] as const));
    const semanticTagsById = new Map(
      entities.map((entity) => [entity.id, entity.semanticTags || []] as const)
    );

    for (const item of inventory) {
      facts.push(`Player carries ${item.title}.`);
    }

    for (const entity of entities) {
      for (const state of entity.states || []) {
        facts.push(`${entity.title} state ${state.id} is ${String(state.value)}.`);
      }

      if (entity.location?.parentTitle) {
        facts.push(
          this.formatLocationFact(
            entity.title,
            entity.location.relation,
            entity.location.parentTitle
          )
        );
      }

      if (entity.contents?.length) {
        const contentsByRelation = new Map<string, string[]>();
        for (const content of entity.contents) {
          const title = titleById.get(content.id) || content.title;
          const titles = contentsByRelation.get(content.relation) || [];
          titles.push(title);
          contentsByRelation.set(content.relation, titles);
        }

        for (const [relation, titles] of contentsByRelation.entries()) {
          facts.push(this.formatContentsFact(entity.title, relation, titles));
        }

        for (const semanticFact of this.buildSemanticRelationFacts(
          scene,
          entity,
          entity.contents,
          titleById,
          semanticTagsById
        )) {
          facts.push(semanticFact);
        }
      }
    }

    for (const entity of knownEntities) {
      for (const state of entity.states || []) {
        facts.push(`${entity.title} state ${state.id} is ${String(state.value)}.`);
      }
    }

    for (const item of inventory) {
      for (const state of item.states || []) {
        facts.push(`${item.title} state ${state.id} is ${String(state.value)}.`);
      }
    }

    if (scene.activeSubscene) {
      facts.push(`Active subscene is ${scene.activeSubscene}.`);
    }

    return Array.from(new Set(facts));
  }

  private buildSemanticRelationFacts(
    scene: Scene,
    entity: ParserEntityContext,
    contents: ParserEntityContentContext[],
    titleById: Map<string, string>,
    semanticTagsById: Map<string, string[]>
  ): string[] {
    const sceneObject = scene.getObjectByName(entity.id);
    if (!sceneObject) return [];

    const relationFacts = this.getObjectRelationFacts(sceneObject);
    if (!relationFacts.length) return [];

    const facts: string[] = [];
    for (const relationFact of relationFacts) {
      for (const content of contents) {
        if (content.relation !== relationFact.relation) continue;
        const childTags = semanticTagsById.get(content.id) || [];
        if (!this.semanticTagsMatch(childTags, relationFact.childTags)) continue;
        facts.push(
          this.interpolateSemanticFact(relationFact.fact, {
            self: entity.title,
            child: titleById.get(content.id) || content.title,
            relation: content.relation,
          })
        );
      }
    }

    return facts;
  }

  private getObjectRelationFacts(sceneObject: SceneObject): ParserSemanticRelationFact[] {
    const accessor = (this.game.textAssets as any).getResolvedObjectStructuredListField;
    if (typeof accessor !== 'function') return [];
    return accessor.call(this.game.textAssets, sceneObject, 'relationFacts', (value: unknown) =>
      this.normalizeSemanticRelationFact(value)
    );
  }

  private normalizeSemanticRelationFact(value: unknown): ParserSemanticRelationFact | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const relation = String(record.relation || '').trim();
    const fact = typeof record.fact === 'string' ? record.fact.trim() : '';
    if (!SEMANTIC_RELATIONS.includes(relation as ParserSemanticRelationFact['relation']) || !fact) {
      return null;
    }
    const childTags = Array.isArray(record.childTags)
      ? record.childTags
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
      : [];
    return {
      relation: relation as ParserSemanticRelationFact['relation'],
      childTags,
      fact,
    };
  }

  private semanticTagsMatch(childTags: string[], requiredTags: string[]): boolean {
    if (!requiredTags.length) return true;
    const normalizedChildTags = new Set(childTags.map((tag) => tag.trim().toLowerCase()));
    return requiredTags.some((tag) => normalizedChildTags.has(tag));
  }

  private interpolateSemanticFact(
    template: string,
    params: Record<'self' | 'child' | 'relation', string>
  ): string {
    return template.replace(/\{(self|child|relation)\}/g, (_match, token: keyof typeof params) => {
      return params[token];
    });
  }

  private formatLocationFact(
    title: string,
    relation: ParserEntityLocationContext['relation'],
    parentTitle: string
  ): string {
    if (relation === 'in' && this.isFloorTitle(parentTitle)) {
      return `${title} is on ${parentTitle}.`;
    }
    switch (relation) {
      case 'in':
        return `${title} is inside ${parentTitle}.`;
      case 'on':
        return `${title} is on ${parentTitle}.`;
      case 'under':
        return `${title} is under ${parentTitle}.`;
      case 'behind':
        return `${title} is behind ${parentTitle}.`;
    }
  }

  private formatContentsFact(title: string, relation: string, contents: string[]): string {
    const listed = contents.join(', ');
    if (relation === 'in' && this.isFloorTitle(title)) {
      return `${listed} is on ${title}.`;
    }
    switch (relation) {
      case 'in':
        return `${title} contains ${listed}.`;
      case 'on':
        return `${listed} is on ${title}.`;
      case 'under':
        return `${listed} is under ${title}.`;
      case 'behind':
        return `${listed} is behind ${title}.`;
      default:
        return `${title} is related to ${listed}.`;
    }
  }

  private isFloorTitle(title: string): boolean {
    return (
      title.trim().toLowerCase() ===
      this.game.textAssets.getServiceText('engine.floor_label').trim().toLowerCase()
    );
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
    const takable = visibleItems
      .filter((entity) => !this.isEntityHeldForTake(entity))
      .filter((entity) => !(this.game as any).canTakeEntity?.(entity));
    const putSource = visibleItems
      .filter((entity) => reachableSet.has(entity) || subsceneSet.has(entity))
      .filter((entity) => !(this.game as any).canPutSourceEntity?.(entity));
    const examinable = this.uniqueObjects([...held, ...subscene, ...reachable]);
    return {
      visible,
      held,
      takable: this.uniqueObjects([
        ...takable,
        ...externalTakable
          .filter((entity: Entity) => !this.isEntityHeldForTake(entity))
          .filter((entity: Entity) => !(this.game as any).canTakeEntity?.(entity)),
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

  private isEntityHeldForTake(entity: Entity): boolean {
    const inventoryManager = (this.game as any).inventoryManager;
    const stableIdCheck = inventoryManager?.hasEntityIdInInventory;
    if (typeof stableIdCheck === 'function') {
      return !!stableIdCheck.call(inventoryManager, entity);
    }
    if ((this.game.inventory || []).includes(entity)) return true;
    const entityName = String(entity?.name || '').trim();
    if (!entityName) return false;
    return (this.game.inventory || []).some(
      (held: Entity) => String(held?.name || '').trim() === entityName
    );
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
