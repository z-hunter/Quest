import { describe, expect, it } from 'vitest';
import { Entity } from '../../src/entities/Entity';
import { Walkbox } from '../../src/entities/Walkbox';
import { Triggerbox } from '../../src/entities/Triggerbox';
import { findDuplicateSceneObjectName } from '../../src/components/editor/properties/SectionIdentityUtils';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('SectionIdentity', () => {
  it('finds duplicate ids across all spatially validated scene object categories', () => {
    const fixture = createSceneFixture();
    const current = new Entity(fixture.game as any, 0, 0, 10, 10, 'current');
    const entity = new Entity(fixture.game as any, 0, 0, 10, 10, 'test_entity');
    const walkbox = new Walkbox([], 'test_walkbox');
    const triggerbox = new Triggerbox([], 'test_triggerbox');
    fixture.scene.entities.push(current, entity);
    fixture.scene.walkbox.push(walkbox);
    fixture.scene.triggerboxes.push(triggerbox);

    expect(findDuplicateSceneObjectName(fixture.scene, 'test_entity', current)).toBe(entity);
    expect(findDuplicateSceneObjectName(fixture.scene, 'test_walkbox', current)).toBe(walkbox);
    expect(findDuplicateSceneObjectName(fixture.scene, 'test_triggerbox', current)).toBe(
      triggerbox
    );
    expect(findDuplicateSceneObjectName(fixture.scene, 'current', current)).toBeNull();
  });
});
