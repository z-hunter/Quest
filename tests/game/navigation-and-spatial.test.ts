import { describe, expect, it } from 'vitest';
import { createGameSemanticFixture } from '../fixtures/gameSemanticFactory';
import { Actor } from '../../src/entities/Actor';
import { Entity } from '../../src/entities/Entity';

describe('Game navigation and spatial API', () => {
  it('goToSceneTarget resolves scene by id and title', () => {
    const fixture = createGameSemanticFixture('start');
    const target = fixture.addScene('test1', 'New Scene', 'You are in New Scene.');

    const byId = fixture.game.goToSceneTarget('test1');
    expect(byId.status).toBe('ok');
    expect(fixture.game.sceneManager.currentScene).toBe(target);

    fixture.game.sceneManager.currentScene = fixture.scene;

    const byTitle = fixture.game.goToSceneTarget('New Scene');
    expect(byTitle.status).toBe('ok');
    expect(fixture.game.sceneManager.currentScene).toBe(target);
  });

  it('goToSceneTarget fails for an unknown destination', () => {
    const fixture = createGameSemanticFixture();

    const outcome = fixture.game.goToSceneTarget('nowhere');

    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe('destination_not_found');
  });

  it('goToEntity starts player movement and returns the player-facing title', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const chair = fixture.addEntity('Chair', {
      title: 'Chair',
      description: 'A wooden chair.',
    });
    chair.x = 42;
    chair.y = 84;

    const outcome = fixture.game.goToEntity(chair);

    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe('You go to Chair.');
    expect(player.target).toEqual({ x: 42, y: 84 });
  });

  it('describeSpatialRelation returns populated and empty relation messages', () => {
    const fixture = createGameSemanticFixture();
    fixture.addEntity('Desk', {
      title: 'Desk',
      description: 'An office desk.',
    });
    fixture.addEntity('note', {
      title: 'Piece of paper',
      description: 'A folded note.',
      spatial: { parentNodeId: 'Desk', relation: 'in' },
    });

    const populated = fixture.game.describeSpatialRelation('Desk', 'in');
    expect(populated.status).toBe('ok');
    expect(populated.message).toBe('In the Desk you see: Piece of paper.');

    const empty = fixture.game.describeSpatialRelation('Desk', 'under');
    expect(empty.status).toBe('ok');
    expect(empty.message).toBe('You see nothing under the Desk.');
  });

  it('describeSpatialRelation uses the collapsed ancestor relation for untitled intermediates', () => {
    const fixture = createGameSemanticFixture();
    fixture.addEntity('Desk', {
      title: 'Desk',
      description: 'An office desk.',
    });
    fixture.addEntity('HiddenHolder', {
      title: null,
      spatial: { parentNodeId: 'Desk', relation: 'in' },
    });
    fixture.addEntity('note', {
      title: 'Piece of paper',
      description: 'A folded note.',
      spatial: { parentNodeId: 'HiddenHolder', relation: 'on' },
    });

    const populated = fixture.game.describeSpatialRelation('Desk', 'in');

    expect(populated.status).toBe('ok');
    expect(populated.message).toBe('In the Desk you see: Piece of paper.');
  });

  it('describeSpatialRelation is relative to the queried semantic anchor', () => {
    const fixture = createGameSemanticFixture();
    fixture.addEntity('Cabinet', {
      title: 'Cabinet',
      description: 'A cabinet.',
    });
    fixture.addEntity('BookA', {
      title: 'Book A',
      description: 'A book inside the cabinet.',
      spatial: { parentNodeId: 'Cabinet', relation: 'in' },
    });
    fixture.addEntity('BookB', {
      title: 'Book B',
      description: 'A book on another book.',
      spatial: { parentNodeId: 'BookA', relation: 'on' },
    });

    const cabinetContents = fixture.game.describeSpatialRelation('Cabinet', 'in');
    const bookStack = fixture.game.describeSpatialRelation('BookA', 'on');

    expect(cabinetContents.status).toBe('ok');
    expect(cabinetContents.message).toBe('In the Cabinet you see: Book A and Book B.');
    expect(bookStack.status).toBe('ok');
    expect(bookStack.message).toBe('On the Book A you see: Book B.');
  });

  it('describeSpatialRelation treats items on untitled nested container extensions as lying on the titled object', () => {
    const fixture = createGameSemanticFixture();
    fixture.addEntity('Desk', {
      title: 'Desk',
      description: 'An office desk.',
    });
    fixture.addEntity('TechHolder', {
      title: null,
      spatial: { parentNodeId: 'Desk', relation: 'on' },
    });
    fixture.addEntity('TechSwitch', {
      title: null,
      spatial: { parentNodeId: 'TechHolder', relation: 'in' },
    });
    fixture.addEntity('SurfaceNode', {
      title: null,
      spatial: { parentNodeId: 'TechSwitch', relation: 'in' },
    });
    fixture.addEntity('note', {
      title: 'Piece of paper',
      description: 'A folded note.',
      spatial: { parentNodeId: 'SurfaceNode', relation: 'on' },
    });

    const populated = fixture.game.describeSpatialRelation('Desk', 'on');

    expect(populated.status).toBe('ok');
    expect(populated.message).toBe('On the Desk you see: Piece of paper.');
  });

  it('describeSpatialRelation reveals hidden lookable descendants through anchor-relative relations', () => {
    const fixture = createGameSemanticFixture();
    fixture.addEntity('Cabinet', {
      title: 'Cabinet',
      description: 'A cabinet.',
    });
    fixture.addEntity('BookA', {
      title: 'Book A',
      description: 'A book inside the cabinet.',
      spatial: { parentNodeId: 'Cabinet', relation: 'in' },
    });
    const bookB = fixture.addEntity('BookB', {
      title: 'Book B',
      description: 'A hidden book on another book.',
      spatial: { parentNodeId: 'BookA', relation: 'on' },
    });
    bookB.hidden = 'lookable';

    const populated = fixture.game.describeSpatialRelation('Cabinet', 'in');

    expect(populated.status).toBe('ok');
    expect(populated.message).toBe('In the Cabinet you see: Book A and Book B.');
    expect(fixture.scene.isHiddenEntityRevealed(bookB)).toBe(true);
  });

  it('switchTo hydrates external inventory contents from component items and projects their slot relation', () => {
    const fixture = createGameSemanticFixture('start');
    const target = fixture.addScene('storage', 'Storage', 'You are in Storage.');

    const player = new Actor(fixture.game as any, 0, 0, 10, 10, 'Hero');
    player.isPlayer = true;
    target.addEntity(player);
    fixture.textAssets.setObject('Hero', {
      title: 'Hero',
      description: 'Hero player',
    });

    const cabinet = new Entity(fixture.game as any, 10, 0, 10, 10, 'cabinet');
    cabinet.components = [
      {
        type: 'Inventory',
        relation: 'behind',
        capacity: 2,
        groups: [],
        protected: false,
        items: ['book'],
      },
    ];
    target.addEntity(cabinet);
    fixture.textAssets.setObject('cabinet', {
      title: 'Cabinet',
      description: 'A cabinet.',
    });

    const book = new Entity(fixture.game as any, 0, 0, 10, 10, 'book');
    book.components = [{ type: 'Item' }];
    target.addEntity(book);
    fixture.textAssets.setObject('book', {
      title: 'Book',
      description: 'A book.',
    });

    fixture.game.sceneManager.switchTo(target.id);

    expect(fixture.game.getInventoryEntities(cabinet as any, 'behind')).toContain(book);
    expect(book.visible).toBe(false);
    expect((book as any).spatial).toEqual({ parentNodeId: 'cabinet', relation: 'in' });

    const outcome = fixture.game.describeSpatialRelation('cabinet', 'behind');
    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe('Behind the Cabinet you see: Book.');
  });

  it('switchTo hydrates untitled nested inventory extensions and projects them through the titled anchor', () => {
    const fixture = createGameSemanticFixture('start');
    const target = fixture.addScene('workshop', 'Workshop', 'You are in Workshop.');

    const player = new Actor(fixture.game as any, 0, 0, 10, 10, 'Hero');
    player.isPlayer = true;
    target.addEntity(player);
    fixture.textAssets.setObject('Hero', {
      title: 'Hero',
      description: 'Hero player',
    });

    const desk = new Entity(fixture.game as any, 0, 0, 10, 10, 'desk');
    target.addEntity(desk);
    fixture.textAssets.setObject('desk', {
      title: 'Desk',
      description: 'A desk.',
    });

    const hiddenHolder = new Entity(fixture.game as any, 0, 0, 10, 10, 'hidden_holder');
    hiddenHolder.spatial = { parentNodeId: 'desk', relation: 'behind' };
    hiddenHolder.components = [
      {
        type: 'Inventory',
        relation: 'behind',
        capacity: 2,
        groups: [],
        protected: false,
        items: ['book'],
      },
    ];
    target.addEntity(hiddenHolder);
    fixture.textAssets.setObject('hidden_holder', {
      description: 'Untitled holder.',
    });

    const book = new Entity(fixture.game as any, 0, 0, 10, 10, 'book');
    book.components = [{ type: 'Item' }];
    target.addEntity(book);
    fixture.textAssets.setObject('book', {
      title: 'Book',
      description: 'A hidden book.',
    });

    fixture.game.sceneManager.switchTo(target.id);

    expect(fixture.game.getInventoryEntities(hiddenHolder as any, 'behind')).toContain(book);
    expect(book.visible).toBe(false);

    const outcome = fixture.game.describeSpatialRelation('desk', 'behind');
    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe('Behind the Desk you see: Book.');
  });
});
