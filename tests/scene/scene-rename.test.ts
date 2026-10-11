import { describe, expect, it } from 'vitest';
import { Entity } from '../../src/entities/Entity';
import { Walkbox } from '../../src/entities/Walkbox';
import { Triggerbox } from '../../src/entities/Triggerbox';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('Scene.renameObject', () => {
  it('renames object and updates children parentNodeId', () => {
    const fixture = createSceneFixture();
    const parent = new Entity(fixture.game as any, 0, 0, 10, 10, 'old_parent');
    const child = new Entity(fixture.game as any, 0, 0, 10, 10, 'child');
    child.spatial = { parentNodeId: 'old_parent', relation: 'on' };
    fixture.scene.entities.push(parent, child);

    fixture.scene.renameObject(parent, 'new_parent');

    expect(parent.name).toBe('new_parent');
    expect(child.spatial?.parentNodeId).toBe('new_parent');
  });

  it('rejects rename when another entity, walkbox, or triggerbox already uses the name', () => {
    const fixture = createSceneFixture();
    const entityA = new Entity(fixture.game as any, 0, 0, 10, 10, 'entity_a');
    const entityB = new Entity(fixture.game as any, 0, 0, 10, 10, 'entity_b');
    const walkbox = new Walkbox([], 'wb_zone');
    const triggerbox = new Triggerbox([], 'trig_exit');
    fixture.scene.entities.push(entityA, entityB);
    fixture.scene.walkbox.push(walkbox);
    fixture.scene.triggerboxes.push(triggerbox);

    // Attempting collision with another entity
    fixture.scene.renameObject(entityA, 'entity_b');
    expect(entityA.name).toBe('entity_a');

    // Attempting collision with walkbox
    fixture.scene.renameObject(entityA, 'wb_zone');
    expect(entityA.name).toBe('entity_a');

    // Attempting collision with triggerbox
    fixture.scene.renameObject(entityA, 'trig_exit');
    expect(entityA.name).toBe('entity_a');
  });

  it('preserves no-op behavior when renaming object to its current name', () => {
    const fixture = createSceneFixture();
    const entity = new Entity(fixture.game as any, 0, 0, 10, 10, 'my_item');
    fixture.scene.entities.push(entity);

    fixture.scene.renameObject(entity, 'my_item');
    expect(entity.name).toBe('my_item');

    fixture.scene.renameObject(entity, '  my_item  ');
    expect(entity.name).toBe('my_item');
  });

  it('migrates entityParserNotes and entityParserNoteNeedsCheck on entity rename', () => {
    const fixture = createSceneFixture();
    const entity = new Entity(fixture.game as any, 0, 0, 10, 10, 'old_chest');
    fixture.scene.entities.push(entity);

    fixture.scene.setEntityParserNote('old_chest', 'A sturdy wooden chest.');
    fixture.scene.markEntityParserNoteNeedsCheck('old_chest');

    expect(fixture.scene.getEntityParserNote('old_chest')).toBe('A sturdy wooden chest.');
    expect(fixture.scene.getEntityParserNoteNeedsCheck('old_chest')).toBe(true);

    fixture.scene.renameObject(entity, 'new_chest');

    expect(entity.name).toBe('new_chest');
    expect(fixture.scene.getEntityParserNote('new_chest')).toBe('A sturdy wooden chest.');
    expect(fixture.scene.getEntityParserNoteNeedsCheck('new_chest')).toBe(true);
    expect(fixture.scene.getEntityParserNote('old_chest')).toBe('');
    expect(fixture.scene.getEntityParserNoteNeedsCheck('old_chest')).toBe(false);
  });
});
