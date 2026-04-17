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

  it('reports a clearly openable closed container on LOOK IN but not on direct LOOK of hidden contents', async () => {
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
    expect(directResult.messages.at(-1)).toBe("You don't see any note here.");
  });

  it('reveals a lookable hidden target through LOOK', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A hidden key.',
      components: [{ type: 'Item' }],
    });
    key.hidden = 'lookable';

    const result = await fixture.run('look key');

    expect(result.messages.at(-1)).toBe('A hidden key.');
    expect(fixture.scene.isHiddenEntityRevealed(key)).toBe(true);
  });

  it('reveals an examinable hidden target through EXAMINE but not LOOK', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const cache = fixture.addEntity('cache', {
      title: 'Secret cache',
      description: 'A concealed niche.',
    } as any);
    fixture.textAssets.setObject('cache', {
      title: 'Secret cache',
      description: 'A concealed niche.',
      details: 'A concealed niche with a tiny latch.',
    });
    cache.hidden = 'examinable';

    const lookResult = await fixture.run('look cache');
    expect(lookResult.messages.at(-1)).toBe("You don't see any cache here.");
    expect(fixture.scene.isHiddenEntityRevealed(cache)).toBe(false);

    const examineResult = await fixture.run('examine cache');
    expect(examineResult.messages.at(-1)).toBe('A concealed niche with a tiny latch.');
    expect(fixture.scene.isHiddenEntityRevealed(cache)).toBe(true);
  });

  it('supports PUT IN object when the object contains an untitled nested surface', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'key',
      description: 'A key.',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);
    fixture.addEntity('drawer', {
      title: 'Drawer',
      description: 'A drawer.',
    });
    fixture.addEntity('tray', {
      title: null,
      description: 'A tray.',
      spatial: { parentNodeId: 'drawer', relation: 'in' },
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });

    const result = await fixture.run('put key in drawer');

    expect(result.messages.at(-1)).toBe('You drop the key.');
  });

  it('supports PUT UNDER a titled object when it has a built-in UNDER surface', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'key',
      description: 'A key.',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);
    const desk = fixture.addEntity('desk', {
      title: 'Desk',
      description: 'A desk.',
      components: [{ type: 'Surface', relation: 'under', capacity: 2, groups: [], items: [] }],
    });

    const result = await fixture.run('put key under desk');

    expect(result.messages.at(-1)).toBe('You put the key on the Desk.');
    expect((desk.components?.[0] as { items: Array<{ id: string }> }).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'key' })])
    );
  });

  it('supports PUT IN a titled spatial node even when the anchor object itself is not in visible scope', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'key',
      description: 'A key.',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);
    fixture.addEntity('desk', {
      title: 'Desk',
      description: 'A desk.',
    });
    fixture.addEntity('drawer', {
      title: 'upper drawer',
      description: 'A drawer.',
      spatial: { parentNodeId: 'desk', relation: 'in' },
      disabled: true,
    } as any);
    fixture.addEntity('tray', {
      title: null,
      description: 'A tray inside the drawer.',
      spatial: { parentNodeId: 'drawer', relation: 'in' },
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });

    const result = await fixture.run('put key in drawer');

    expect(result.messages.at(-1)).toBe('You drop the key.');
  });

  it('supports PUT from a nearby scene item into a nearby container without taking it first', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const cassette = fixture.addEntity('cassette', {
      title: 'cassette',
      description: 'A cassette.',
      components: [{ type: 'Item' }],
    });
    cassette.x = 10;
    cassette.y = 0;
    const recorder = fixture.addEntity('recorder', {
      title: 'Tape recorder',
      description: 'A tape recorder.',
      components: [{ type: 'Inventory', capacity: 2, groups: [], protected: false, items: [] }],
    });
    recorder.x = 20;
    recorder.y = 0;

    const result = await fixture.run('put cassette in recorder');

    expect(result.messages.at(-1)).toBe('You put the cassette into the recorder.');
    expect((recorder.components?.[0] as { items?: string[] } | undefined)?.items || []).toContain(
      cassette.name
    );
  });

  it('does not resolve a PUT target to the source item itself', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const cassette = fixture.addEntity('cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      components: [
        { type: 'Item' },
        { type: 'Inventory', relation: 'in', capacity: 2, groups: [], protected: false, items: [] },
      ],
    });
    fixture.textAssets.setObject('cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      synonyms: ['cassette', 'record'],
    });
    fixture.scene.removeEntity(cassette);
    fixture.game.inventory.push(cassette);
    const recorder = fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'A cassette recorder.',
      components: [
        { type: 'Inventory', relation: 'in', capacity: 2, groups: [], protected: false, items: [] },
      ],
    });
    fixture.textAssets.setObject('boombox', {
      title: 'Boombox',
      description: 'A cassette recorder.',
      synonyms: ['recorder'],
    });
    recorder.x = 10;
    recorder.y = 0;

    const first = await fixture.run('put compact cassette into recorder');
    expect(first.messages.at(-1)).toBe('You put the cassette into the boombox.');

    fixture.game.inventory.push(cassette);
    const selfTarget = await fixture.run('put compact cassette into record');
    expect(selfTarget.messages.at(-1)).toBe('You put the cassette into the boombox.');
    expect(selfTarget.messages.at(-1)).not.toContain('into the Compact cassette');
    expect(
      (cassette.components?.[1] as { items?: string[] } | undefined)?.items || []
    ).not.toContain(cassette.name);
    expect((recorder.components?.[0] as { items?: string[] } | undefined)?.items || []).toContain(
      cassette.name
    );
  });

  it('does not ask which PUT source when only one matching source is not already in the target', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const compactCassette = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      spatial: { parentNodeId: 'boombox', relation: 'in' },
      components: [
        { type: 'Item' },
        { type: 'Inventory', relation: 'in', capacity: 2, groups: [], protected: false, items: [] },
      ],
    });
    fixture.textAssets.setObject('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      synonyms: ['cassette', 'compact'],
    });
    const musicCassette = fixture.addEntity('music_cassette', {
      title: "Cassette 'Music'",
      description: 'A music cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.textAssets.setObject('music_cassette', {
      title: "Cassette 'Music'",
      description: 'A music cassette.',
      synonyms: ['cassette', 'music'],
    });
    fixture.scene.removeEntity(musicCassette);
    fixture.game.inventory.push(musicCassette);
    const recorder = fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'A cassette recorder.',
      components: [
        {
          type: 'Inventory',
          relation: 'in',
          capacity: 1,
          groups: [],
          protected: false,
          items: [compactCassette.name],
        },
      ],
    });
    fixture.textAssets.setObject('boombox', {
      title: 'Boombox',
      description: 'A cassette recorder.',
      synonyms: ['recorder'],
    });

    const result = await fixture.run('put cassette into recorder');
    expect(result.messages.at(-1)).toBe('There is no more room in the Boombox.');
    expect(result.pendingIntent).toBeNull();
    expect(
      (compactCassette.components?.[1] as { items?: string[] } | undefined)?.items || []
    ).not.toContain(musicCassette.name);
    expect((recorder.components?.[0] as { items?: string[] } | undefined)?.items || []).toEqual([
      compactCassette.name,
    ]);

    const typoTarget = await fixture.run('put cassette into recirder');
    expect(typoTarget.messages.at(-1)).toBe("You don't see any recirder here.");
    expect(typoTarget.pendingIntent).toBeNull();
  });

  it('does not ask for PUT clarification when all source matches have the same title', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const heldCassette = fixture.addEntity('cassette_held', {
      title: 'cassette',
      description: 'A held cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(heldCassette);
    fixture.game.inventory.push(heldCassette);
    const nearbyCassette = fixture.addEntity('cassette_scene', {
      title: 'cassette',
      description: 'A nearby cassette.',
      components: [{ type: 'Item' }],
    });
    nearbyCassette.x = 5;
    nearbyCassette.y = 0;
    const recorder = fixture.addEntity('recorder', {
      title: 'Tape recorder',
      description: 'A tape recorder.',
      components: [{ type: 'Inventory', capacity: 2, groups: [], protected: false, items: [] }],
    });
    recorder.x = 10;
    recorder.y = 0;

    const result = await fixture.run('put cassette in recorder');

    expect(result.messages.at(-1)).toBe('You put the cassette_held into the recorder.');
    expect(result.pendingIntent).toBeNull();
    expect((recorder.components?.[0] as { items?: string[] } | undefined)?.items || []).toContain(
      heldCassette.name
    );
    expect(
      (recorder.components?.[0] as { items?: string[] } | undefined)?.items || []
    ).not.toContain(nearbyCassette.name);
  });

  it('keeps the original PUT target after clarification and can use the nearby scene item', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const heldCassette = fixture.addEntity('cassette_a', {
      title: 'Cassette A',
      description: 'A held cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(heldCassette);
    fixture.game.inventory.push(heldCassette);
    const nearbyCassette = fixture.addEntity('cassette_b', {
      title: 'Cassette B',
      description: 'A nearby cassette.',
      components: [{ type: 'Item' }],
    });
    nearbyCassette.x = 10;
    nearbyCassette.y = 0;
    const recorder = fixture.addEntity('recorder', {
      title: 'Tape recorder',
      description: 'A tape recorder.',
      components: [{ type: 'Inventory', capacity: 2, groups: [], protected: false, items: [] }],
    });
    recorder.x = 15;
    recorder.y = 0;

    const ambiguous = await fixture.run('put cassette into recorder');
    expect(ambiguous.messages.at(-1)).toContain('Which item do you want to put down');
    expect(ambiguous.pendingIntent).toBe('put');

    const resolved = await fixture.run('Cassette B');
    expect(resolved.messages.at(-1)).toBe('You put the cassette_b into the recorder.');
    expect((recorder.components?.[0] as { items?: string[] } | undefined)?.items || []).toContain(
      nearbyCassette.name
    );
    expect(fixture.game.inventory.map((entity: any) => entity.name)).toContain(heldCassette.name);
    expect(fixture.game.inventory.map((entity: any) => entity.name)).not.toContain(
      nearbyCassette.name
    );
  });

  it('expands multi-select PUT source clarification into sequential PUT actions', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const firstCassette = fixture.addEntity('cassette_a', {
      title: 'Cassette A',
      description: 'A held cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(firstCassette);
    fixture.game.inventory.push(firstCassette);
    const secondCassette = fixture.addEntity('cassette_b', {
      title: 'Cassette B',
      description: 'Another held cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(secondCassette);
    fixture.game.inventory.push(secondCassette);
    const recorder = fixture.addEntity('recorder', {
      title: 'Tape recorder',
      description: 'A tape recorder.',
      components: [{ type: 'Inventory', capacity: 1, groups: [], protected: false, items: [] }],
    });
    recorder.x = 10;
    recorder.y = 0;

    const ambiguous = await fixture.run('put cassette into recorder');
    expect(ambiguous.messages.at(-1)).toContain('1: Cassette A, 2: Cassette B');
    expect(ambiguous.pendingIntent).toBe('put');

    const resolved = await fixture.run('1, 2');
    expect(resolved.messages.at(-1)).toBe('There is no more room in the Tape recorder.');
    expect((recorder.components?.[0] as { items?: string[] } | undefined)?.items || []).toEqual([
      firstCassette.name,
    ]);
    expect(fixture.game.inventory.map((entity: any) => entity.name)).toContain(secondCassette.name);
  });

  it('surfaces a distance-specific error for PUT when the target is too far away', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'key',
      description: 'A key.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);
    const tray = fixture.addEntity('tray', {
      title: 'Tray',
      description: 'A tray.',
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    tray.x = 250;
    tray.y = 0;

    const result = await fixture.run('put key on tray');

    expect(result.messages.at(-1)).toBe('You are too far away from the Tray.');
  });

  it('resolves TAKE FROM container without unnecessary ambiguity', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('table', {
      title: 'Table',
      description: 'A table.',
    });
    fixture.addEntity('drawer', {
      title: 'Drawer',
      description: 'A drawer.',
    });
    fixture.addEntity('surface_top', {
      title: 'Surface top',
      description: 'A top surface.',
      spatial: { parentNodeId: 'table', relation: 'on' },
      components: [
        { type: 'Surface', capacity: 5, groups: [], items: [{ id: 'pencil_a', x: 0, y: 0 }] },
      ],
    });
    fixture.addEntity('surface_drawer', {
      title: 'Tray',
      description: 'A drawer tray.',
      spatial: { parentNodeId: 'drawer', relation: 'in' },
      components: [
        { type: 'Surface', capacity: 5, groups: [], items: [{ id: 'pencil_b', x: 0, y: 0 }] },
      ],
    });
    fixture.addEntity('pencil_a', {
      title: 'pencil',
      description: 'A pencil on the table.',
      components: [{ type: 'Item', ignoreDistance: true }],
      spatial: { parentNodeId: 'surface_top', relation: 'on' },
    });
    fixture.addEntity('pencil_b', {
      title: 'pencil',
      description: 'A pencil in the drawer.',
      components: [{ type: 'Item', ignoreDistance: true }],
      spatial: { parentNodeId: 'surface_drawer', relation: 'on' },
    });

    const result = await fixture.run('take pencil from drawer');

    expect(result.messages.at(-1)).toBe('You picked up the pencil.');
    expect(fixture.game.inventory.map((entity: any) => entity.name)).toContain('pencil_b');
    expect(fixture.game.inventory.map((entity: any) => entity.name)).not.toContain('pencil_a');
  });

  it('surfaces a closed-container failure for TAKE FROM drawer', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('drawer', {
      title: 'Drawer',
      description: 'A drawer.',
      components: [{ type: 'Switch', state: 1, clearlyOpenable: true }],
    });
    fixture.addEntity('tray', {
      title: 'Tray',
      description: 'A drawer tray.',
      spatial: { parentNodeId: 'drawer', relation: 'in' },
      components: [
        { type: 'Surface', capacity: 5, groups: [], items: [{ id: 'note', x: 0, y: 0 }] },
      ],
      disabled: true,
    } as any);
    fixture.addEntity('note', {
      title: 'note',
      description: 'A note.',
      components: [{ type: 'Item', ignoreDistance: true }],
      spatial: { parentNodeId: 'tray', relation: 'on' },
      disabled: true,
    } as any);

    const result = await fixture.run('take note from drawer');

    expect(result.messages.at(-1)).toBe('The Drawer is closed.');
  });
});
