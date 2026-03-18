import { describe, expect, it } from 'vitest';
import { createParserFixture } from '../fixtures/parserFactory';

describe('Parser + game integration smoke', () => {
  it('describes direct spatial contents with LOOK UNDER', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.addEntity('Chair', {
      title: 'Chair',
      description: 'A wooden chair.',
    });
    fixture.addEntity('note', {
      title: 'Piece of paper',
      description: 'A folded note.',
      spatial: { parentNodeId: 'Chair', relation: 'under' },
    });

    const result = await fixture.run('look under chair');

    expect(result.messages.at(-1)).toBe('Under the Chair you see: Piece of paper.');
  });

  it('surfaces the distance error for a far but visible EXAMINE target', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const boombox = fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'Cassette recorder.',
      details: 'A detailed boombox description.',
    } as any);
    boombox.x = 200;
    fixture.textAssets.setObject('boombox', {
      title: 'Boombox',
      description: 'Cassette recorder.',
      details: 'A detailed boombox description.',
      synonyms: ['recorder'],
    });

    const result = await fixture.run('examine boombox');

    expect(result.messages.at(-1)).toBe('You are too far away from the Boombox.');
  });
});
