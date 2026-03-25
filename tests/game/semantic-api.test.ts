import { describe, expect, it } from 'vitest';
import { createGameSemanticFixture } from '../fixtures/gameSemanticFactory';

describe('Game semantic API', () => {
  it('lookScene returns the scene description', () => {
    const fixture = createGameSemanticFixture();

    const outcome = fixture.game.lookScene();

    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe('You are in Test Scene.');
  });

  it('lookEntity stays descriptive even when spatial parent context exists', () => {
    const fixture = createGameSemanticFixture();
    fixture.addEntity('Table', {
      title: 'Table',
      description: 'A sturdy table.',
    });
    const note = fixture.addEntity('note', {
      title: 'Piece of paper',
      description: 'A folded note.',
      spatial: { parentNodeId: 'Table', relation: 'under' },
    });

    const outcome = fixture.game.lookEntity(note);

    expect(outcome.status).toBe('ok');
    expect(outcome.message).toBe('A folded note.');
  });

  it('examineEntity prefers details and falls back to description', () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer();
    const boombox = fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'Cassette recorder.',
    });
    fixture.textAssets.setObject('boombox', {
      title: 'Boombox',
      description: 'Cassette recorder.',
      details: 'Detailed boombox text.',
    });

    const detailed = fixture.game.examineEntity(boombox);

    expect(detailed.status).toBe('ok');
    expect(detailed.message).toBe('Detailed boombox text.');

    fixture.textAssets.setObject('boombox', {
      title: 'Boombox',
      description: 'Cassette recorder.',
    });

    const fallback = fixture.game.examineEntity(boombox);

    expect(fallback.status).toBe('ok');
    expect(fallback.message).toBe('Cassette recorder.');
  });

  it('showInventory returns empty and filled inventory messages', () => {
    const fixture = createGameSemanticFixture();
    const emptyOutcome = fixture.game.showInventory();
    expect(emptyOutcome.message).toBe('You are not carrying anything.');

    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your ID.',
    });
    fixture.scene.removeEntity(idCard);
    fixture.game.inventory.push(idCard);

    const filledOutcome = fixture.game.showInventory();
    expect(filledOutcome.message).toBe('You are carrying: your ID card');
  });

  it('removeInventoryEntity succeeds only for held items', () => {
    const fixture = createGameSemanticFixture();
    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your ID.',
    });
    fixture.scene.removeEntity(idCard);
    fixture.game.inventory.push(idCard);

    const removed = fixture.game.removeInventoryEntity(idCard);
    expect(removed.status).toBe('ok');
    expect(fixture.game.inventory).toHaveLength(0);

    const missing = fixture.game.removeInventoryEntity(idCard);
    expect(missing.status).toBe('failed');
    expect(missing.code).toBe('inventory_item_not_found');
  });
});
