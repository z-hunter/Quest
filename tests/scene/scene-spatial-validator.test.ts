import { describe, expect, it } from 'vitest';
import { SceneSpatialValidator } from '../../src/scene/SceneSpatialValidator';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('SceneSpatialValidator', () => {
  it('accepts a valid relation-aware container setup', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    player.components = [{ type: 'Inventory', relation: 'in', capacity: 10, items: [] }];

    const desk = fixture.addEntity('desk', {
      title: 'Desk',
      components: [{ type: 'Surface', relation: 'on', capacity: 2, items: [] }],
    });
    fixture.addEntity('key', {
      title: 'Key',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: desk.name, relation: 'on' },
    });

    const result = SceneSpatialValidator.validate(fixture.scene, fixture.game as any);

    expect(result.ok).toBe(true);
    expect(result.issues.map((issue) => issue.code)).not.toContain('duplicate_container_relation');
  });

  it('reports duplicate built-in containers for the same semantic relation', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    player.components = [{ type: 'Inventory', relation: 'in', capacity: 10, items: [] }];

    fixture.addEntity('cabinet', {
      title: 'Cabinet',
      components: [
        { type: 'Inventory', relation: 'behind', capacity: 2, items: [] },
        { type: 'Surface', relation: 'behind', capacity: 2, items: [] },
      ],
    });

    const result = SceneSpatialValidator.validate(fixture.scene, fixture.game as any);

    expect(result.ok).toBe(false);
    expect(result.errors.some((issue) => issue.code === 'duplicate_container_relation')).toBe(true);
  });

  it('reports external untitled container extensions that conflict with built-in slots', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    player.components = [{ type: 'Inventory', relation: 'in', capacity: 10, items: [] }];

    fixture.addEntity('desk', {
      title: 'Desk',
      components: [{ type: 'Surface', relation: 'on', capacity: 2, items: [] }],
    });
    fixture.addEntity('desk_surface', {
      title: null,
      spatial: { parentNodeId: 'desk', relation: 'on' },
      components: [{ type: 'Surface', capacity: 2, items: [] }],
    });

    const result = SceneSpatialValidator.validate(fixture.scene, fixture.game as any);

    expect(result.errors.some((issue) => issue.code === 'duplicate_container_relation')).toBe(true);
  });

  it('reports broken storage references and non-item contents', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    player.components = [{ type: 'Inventory', relation: 'in', capacity: 10, items: [] }];

    fixture.addEntity('box', {
      title: 'Box',
      components: [
        { type: 'Inventory', relation: 'in', capacity: 2, items: ['missing_key', 'rock'] },
      ],
    });
    fixture.addEntity('rock', {
      title: 'Rock',
      components: [],
    });

    const result = SceneSpatialValidator.validate(fixture.scene, fixture.game as any);
    const codes = result.errors.map((issue) => issue.code);

    expect(codes).toContain('missing_inventory_item');
    expect(codes).toContain('inventory_item_not_item');
  });

  it('warns when semantic hidden is set on an untitled object', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    player.components = [{ type: 'Inventory', relation: 'in', capacity: 10, items: [] }];

    const secret = fixture.addEntity('secret_tech_node', {
      title: null,
      components: [{ type: 'Item' }],
    });
    secret.hidden = 'lookable';

    const result = SceneSpatialValidator.validate(fixture.scene, fixture.game as any);

    expect(result.warnings.some((issue) => issue.code === 'hidden_without_title')).toBe(true);
  });

  it('reports spatial cycles and missing parents', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    player.components = [{ type: 'Inventory', relation: 'in', capacity: 10, items: [] }];

    fixture.addEntity('a', {
      title: 'A',
      spatial: { parentNodeId: 'b', relation: 'in' },
    });
    fixture.addEntity('b', {
      title: 'B',
      spatial: { parentNodeId: 'a', relation: 'on' },
    });
    fixture.addEntity('orphan', {
      title: 'Orphan',
      spatial: { parentNodeId: 'missing_parent', relation: 'behind' },
    });

    const result = SceneSpatialValidator.validate(fixture.scene, fixture.game as any);
    const codes = result.errors.map((issue) => issue.code);

    expect(codes).toContain('spatial_cycle');
    expect(codes).toContain('missing_spatial_parent');
  });
});
