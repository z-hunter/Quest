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

  it('supports OPEN and CLOSE for reachable switches', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('Drawer', {
      title: 'Drawer',
      description: 'A drawer.',
      components: [{ type: 'Switch', state: 1 }],
    });

    const openResult = await fixture.run('open drawer');
    expect(openResult.messages.at(-1)).toBe('You open the Drawer.');

    const closeResult = await fixture.run('close drawer');
    expect(closeResult.messages.at(-1)).toBe('You close the Drawer.');
  });

  it('elevates OPEN on non-switch objects to the next parser cascade', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('Chair', {
      title: 'Chair',
      description: 'A wooden chair.',
    });

    const result = await fixture.run('open chair');

    expect(result.messages.at(-1)).toBe("I don't understand.");
  });

  it('reports a clearly openable closed container on LOOK IN and direct LOOK of hidden contents', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('Desk', {
      title: 'Desk',
      description: 'A desk.',
    });
    fixture.addEntity('Drawer', {
      title: 'Drawer',
      description: 'A desk drawer.',
      components: [{ type: 'Switch', state: 1, clearlyOpenable: true }],
      spatial: { parentNodeId: 'Desk', relation: 'in' },
    });
    fixture.addEntity('note', {
      title: 'Note',
      description: 'A folded note.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'Drawer', relation: 'in' },
    });

    const relationResult = await fixture.run('look in drawer');
    expect(relationResult.messages.at(-1)).toBe('The Drawer is closed.');

    const directResult = await fixture.run('look note');
    expect(directResult.messages.at(-1)).toBe('The Drawer is closed.');
  });
});
