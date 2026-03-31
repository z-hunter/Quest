import { describe, expect, it } from 'vitest';
import { createGameSemanticFixture } from '../fixtures/gameSemanticFactory';

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

  it('describeSpatialRelation flattens untitled ancestors in the text layer', () => {
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

    const populated = fixture.game.describeSpatialRelation('Desk', 'on');

    expect(populated.status).toBe('ok');
    expect(populated.message).toBe('On the Desk you see: Piece of paper.');
  });
});
