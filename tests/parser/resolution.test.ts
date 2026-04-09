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

  it('looks up a taken item from inventory instead of stale closed-drawer scene context', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('Desk', {
      title: 'Desk',
      description: 'A desk.',
    });
    const drawer = fixture.addEntity('Drawer', {
      title: 'Upper drawer',
      description: 'A desk drawer.',
      components: [{ type: 'Switch', state: 2, clearlyOpenable: true }],
      spatial: { parentNodeId: 'Desk', relation: 'in' },
    });
    const note = fixture.addEntity('Note', {
      title: 'Note',
      description: 'Inventory note.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'Drawer', relation: 'in' },
    });

    const taken = fixture.game.takeEntity(note);
    expect(taken.status).toBe('ok');
    expect((note as any).spatial).toBeNull();

    (
      drawer.components?.find((component: any) => component?.type === 'Switch') as {
        state?: number;
      }
    ).state = 1;

    const result = await fixture.run('look note');

    expect(result.messages.at(-1)).toBe('Inventory note.');
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

  it('matches a triggerbox by title in the text layer', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.addTriggerbox('tb_desk_drawer', {
      title: 'Desk Drawer',
      description: 'A shallow desk drawer.',
      details: 'The upper desk drawer is open and mostly empty.',
    });

    const lookResult = await fixture.run('look desk drawer');
    expect(lookResult.messages.at(-1)).toBe('A shallow desk drawer.');

    const examineResult = await fixture.run('examine desk drawer');
    expect(examineResult.messages.at(-1)).toBe('The upper desk drawer is open and mostly empty.');
  });
});
