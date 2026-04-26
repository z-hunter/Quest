import { describe, expect, it } from 'vitest';
import { Actor } from '../../src/entities/Actor';
import { Entity } from '../../src/entities/Entity';
import { SceneEditor } from '../../src/tools/SceneEditor';
import { createSceneFixture } from '../fixtures/sceneFactory';

function createHeadlessEditor(fixture: ReturnType<typeof createSceneFixture>): SceneEditor {
  (fixture.game.sceneManager as any).exposeEntitiesToWindow = () => {};
  return {
    game: fixture.game,
    saveUndoState: () => {},
    selectObject(obj: any) {
      (this as any).selectedObject = obj;
    },
    refreshHierarchy: () => {},
  } as SceneEditor;
}

describe('SceneEditor object creation', () => {
  it('restores serialized spatial placement for polygon scene objects', () => {
    const fixture = createSceneFixture();
    const editor = createHeadlessEditor(fixture);

    const restoredWalkbox = SceneEditor.prototype.createObjectFromData.call(editor, {
      type: 'Walkbox',
      name: 'Walk_Inside',
      mode: 'Subtract',
      poly: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      spatial: { parentNodeId: 'DeskCloseup', relation: 'in' },
      customName: 'Inner walk area',
      visible: false,
    });

    const restoredTriggerbox = SceneEditor.prototype.createObjectFromData.call(editor, {
      type: 'Triggerbox',
      name: 'DrawerSubscene',
      script: '',
      poly: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ],
      components: [{ type: 'Subscene', title: 'Drawer' }],
      spatial: { parentNodeId: 'DeskCloseup', relation: 'on' },
      hidden: 'lookable',
    });

    expect(restoredWalkbox.spatial).toEqual({ parentNodeId: 'DeskCloseup', relation: 'in' });
    expect(restoredWalkbox.mode).toBe('Subtract');
    expect(restoredWalkbox.customName).toBe('Inner walk area');
    expect(restoredWalkbox.visible).toBe(false);

    expect(restoredTriggerbox.spatial).toEqual({ parentNodeId: 'DeskCloseup', relation: 'on' });
    expect(restoredTriggerbox.components).toEqual([
      { type: 'Subscene', title: 'Drawer', targetGroupId: '' },
    ]);
    expect(restoredTriggerbox.hidden).toBe('lookable');
  });

  it('converts an Entity to an Actor through the Actor component marker', () => {
    const fixture = createSceneFixture();
    const editor = createHeadlessEditor(fixture);
    const entity = new Entity(fixture.game as any, 12, 34, 56, 78, 'Lamp');
    entity.color = '#123456';
    entity.components = [{ type: 'Item' }];
    entity.interactions = { LOOK: 'lamp.look' };
    fixture.scene.addEntity(entity);

    const actor = SceneEditor.prototype.convertEntityToActor.call(editor, entity);

    expect(actor).toBeInstanceOf(Actor);
    expect(fixture.scene.entities[0]).toBe(actor);
    expect(actor?.name).toBe('Lamp');
    expect(actor?.x).toBe(12);
    expect(actor?.y).toBe(34);
    expect(actor?.color).toBe('#123456');
    expect(actor?.interactions).toEqual({ LOOK: 'lamp.look' });
    expect(actor?.components).toEqual([{ type: 'Actor' }, { type: 'Item' }]);
    expect(actor?.direction).toBe('down');
    expect(actor?.speed).toBe(0.1);
  });

  it('converts an Actor back to an Entity and drops Actor-only data', () => {
    const fixture = createSceneFixture();
    const editor = createHeadlessEditor(fixture);
    const actor = new Actor(fixture.game as any, 10, 20, 30, 40, 'Npc');
    actor.direction = 'left';
    actor.speed = 0.25;
    actor.animSets = {
      idle: { id: 'idle', up: null, down: 'npc_down', left: null, right: null },
    };
    actor.components = [
      { type: 'Actor' },
      { type: 'Shadow', shadowQuadId: 'shadow', offsetX: 1, offsetY: 2, triggerId: '' },
      { type: 'Item' },
    ];
    actor.isPlayer = true;
    fixture.scene.addEntity(actor);

    const entity = SceneEditor.prototype.convertActorToEntity.call(editor, actor);

    expect(entity).toBeInstanceOf(Entity);
    expect(entity).not.toBeInstanceOf(Actor);
    expect(fixture.scene.entities[0]).toBe(entity);
    expect(fixture.scene.player).toBeNull();
    expect(entity?.components).toEqual([{ type: 'Item' }]);
    const serialized = entity?.toJSON();
    expect(serialized.type).toBe('Entity');
    expect(serialized.direction).toBeUndefined();
    expect(serialized.speed).toBeUndefined();
    expect(serialized.animSets).toBeUndefined();
    expect(serialized.isPlayer).toBeUndefined();
  });
});
