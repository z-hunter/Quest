import { describe, expect, it } from 'vitest';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('Scene spatial index', () => {
  it('groups direct children by parent and relation', () => {
    const fixture = createSceneFixture();
    fixture.addEntity('Table', { title: 'Table' });
    fixture.addEntity('Key', {
      title: 'Key',
      spatial: { parentNodeId: 'Table', relation: 'under' },
    });
    fixture.addEntity('Note', {
      title: 'Note',
      spatial: { parentNodeId: 'Table', relation: 'on' },
    });

    const index = fixture.scene.getSpatialIndex();

    expect(index.childrenByParentId.get('Table')?.map((node) => node.id)).toEqual(['Key', 'Note']);
    expect(index.childrenByParentAndRelation.get('Table')?.get('under')?.map((node) => node.id)).toEqual(['Key']);
    expect(index.childrenByParentAndRelation.get('Table')?.get('on')?.map((node) => node.id)).toEqual(['Note']);
  });

  it('returns only direct children from the helper', () => {
    const fixture = createSceneFixture();
    fixture.addEntity('Desk', { title: 'Desk' });
    fixture.addEntity('Drawer', {
      title: 'Drawer',
      spatial: { parentNodeId: 'Desk', relation: 'in' },
    });
    fixture.addEntity('Paper', {
      title: 'Paper',
      spatial: { parentNodeId: 'Drawer', relation: 'in' },
    });

    const directChildren = fixture.scene.getDirectSpatialChildren('Desk');

    expect(directChildren.map((child) => child.name)).toEqual(['Drawer']);
  });

  it('treats legacy null relation with a parent as "in"', () => {
    const fixture = createSceneFixture();
    fixture.addEntity('Cabinet', { title: 'Cabinet' });
    fixture.addEntity('Folder', {
      title: 'Folder',
      spatial: { parentNodeId: 'Cabinet', relation: null },
    });

    const index = fixture.scene.getSpatialIndex();

    expect(index.childrenByParentAndRelation.get('Cabinet')?.get('in')?.map((node) => node.id)).toEqual(['Folder']);
  });
});
