import { describe, expect, it } from 'vitest';
import { createParserFixture } from '../fixtures/parserFactory';

describe('Parser resolution', () => {
  it('matches an entity by synonym', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    const boombox = fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'Cassette recorder.',
    });
    fixture.textAssets.setObject(boombox.name, {
      title: 'Boombox',
      description: 'Cassette recorder.',
      synonyms: ['recorder', 'radio', 'GF-7'],
    });

    const result = await fixture.run('look recorder');

    expect(result.messages.at(-1)).toBe('Cassette recorder.');
  });

  it('matches an entity by partial title', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'Cassette recorder.',
    });

    const result = await fixture.run('look boom');

    expect(result.messages.at(-1)).toBe('Cassette recorder.');
  });

  it('asks for clarification when multiple distinct targets match', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.addEntity('your_id', {
      title: 'your ID card',
      description: 'Your card.',
    });
    fixture.addEntity('other_id', {
      title: 'Someone ID card',
      description: 'Another card.',
    });

    const result = await fixture.run('look id');

    expect(result.messages.at(-1)).toBe('Which one do you mean: your ID card, Someone ID card?');
    expect(result.pendingIntent).toBe('look');
  });

  it('prefers the inventory copy when duplicate titles are indistinguishable', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    const inventoryCoin = fixture.addEntity('coin_inventory', {
      title: 'Coin',
      description: 'Inventory coin.',
      components: [{ type: 'Item' }],
    });
    const sceneCoin = fixture.addEntity('coin_scene', {
      title: 'Coin',
      description: 'Scene coin.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(inventoryCoin);
    fixture.game.inventory.push(inventoryCoin);

    const result = await fixture.run('look coin');

    expect(result.messages.at(-1)).toBe('Inventory coin.');
    expect(fixture.game.inventory).toContain(inventoryCoin);
    expect(fixture.scene.entities).toContain(sceneCoin);
  });

  it('prefers the nearest scene object when duplicate titles are both in scene', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const nearCoin = fixture.addEntity('near_coin', {
      title: 'Coin',
      description: 'Near coin.',
      components: [{ type: 'Item' }],
    });
    nearCoin.x = 5;
    const farCoin = fixture.addEntity('far_coin', {
      title: 'Coin',
      description: 'Far coin.',
      components: [{ type: 'Item' }],
    });
    farCoin.x = 80;

    const result = await fixture.run('look coin');

    expect(result.messages.at(-1)).toBe('Near coin.');
  });
});
