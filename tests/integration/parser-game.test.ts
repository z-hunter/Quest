import { describe, expect, it } from 'vitest';
import { createParserFixture } from '../fixtures/parserFactory';
import { createGameSemanticFixture } from '../fixtures/gameSemanticFactory';
import { Parser } from '../../src/mechanics/Parser';
import { ComponentSystem } from '../../src/systems/ComponentSystem';

function inventoryNames(fixture: any): string[] {
  return fixture.game.inventory.map((entity: any) => entity.name);
}

async function runSemanticParser(
  fixture: ReturnType<typeof createGameSemanticFixture>,
  input: string
) {
  fixture.game.console = {
    parserStage1Enabled: true,
    parserStage2Enabled: false,
    parserPeekEnabled: false,
    log() {},
  } as any;
  const parser = new Parser(fixture.game);
  await parser.parse(input);
  return fixture.messages;
}

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

  it('surfaces the distance error for a far but visible TAKE target', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const cassette = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
    });
    cassette.x = 200;

    const result = await fixture.run('take cassette');

    expect(result.messages.at(-1)).toBe('You are too far away from the Compact cassette.');
    expect(fixture.game.inventory).not.toContain(cassette);
  });

  it('does not consider inventory items as TAKE source candidates', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const cassette = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(cassette);
    fixture.game.inventory.push(cassette);

    const result = await fixture.run('take cassette');

    expect(result.messages.at(-1)).toBe("You don't see any cassette here.");
  });

  it('does not ask TAKE clarification between held and unreachable matches', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const heldCassette = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(heldCassette);
    fixture.game.inventory.push(heldCassette);
    const farCassette = fixture.addEntity('music_cassette', {
      title: "Cassette 'Music'",
      description: 'A music cassette.',
      components: [{ type: 'Item' }],
    });
    farCassette.x = 200;

    const result = await fixture.run('take cassette');

    expect(result.messages.at(-1)).toBe("You are too far away from the Cassette 'Music'.");
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

    expect(result.messages.at(-1)).toBe('You put the key into the Drawer.');
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

    expect(result.messages.at(-1)).toBe('You put the key under the Desk.');
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

    expect(result.messages.at(-1)).toBe('You put the key into the upper drawer.');
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

    expect(result.messages.at(-1)).toBe('You put the cassette into the Tape recorder.');
    expect((recorder.components?.[0] as { items?: string[] } | undefined)?.items || []).toContain(
      cassette.name
    );
  });

  it('keeps the chosen PUT target after clarification instead of swapping it with the source', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const yellowPaper = fixture.addEntity('yellow_paper', {
      title: 'Yellow paper',
      description: 'A yellow paper.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(yellowPaper);
    fixture.game.inventory.push(yellowPaper);
    const compactCassette = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      components: [
        { type: 'Item' },
        { type: 'Inventory', relation: 'in', capacity: 2, groups: [], protected: false, items: [] },
      ],
    });
    fixture.textAssets.setObject('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      synonyms: ['cassette', 'record'],
    });
    fixture.game.inventory.push(compactCassette);
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
    musicCassette.x = 10;
    musicCassette.y = 0;

    const ambiguous = await fixture.run('put paper into cassette');
    expect(ambiguous.messages.at(-1)).toContain('Where exactly do you want to put it');
    expect(ambiguous.pendingIntent).toBe('put');

    const resolved = await fixture.run('2');
    expect(resolved.messages.at(-1)).toBe("You can't put that there.");
    expect(fixture.game.inventory.map((entity: any) => entity.name)).toContain(yellowPaper.name);
    expect(fixture.game.inventory.map((entity: any) => entity.name)).toContain(
      compactCassette.name
    );
    expect(fixture.game.inventory.map((entity: any) => entity.name)).not.toContain(
      musicCassette.name
    );
    expect(fixture.scene.entities).toContain(musicCassette);
    expect(
      (compactCassette.components?.[1] as { items?: string[] } | undefined)?.items || []
    ).toEqual([]);
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
    expect(first.messages.at(-1)).toBe('You put the cassette into the Boombox.');

    fixture.game.inventory.push(cassette);
    const selfTarget = await fixture.run('put compact cassette into record');
    expect(selfTarget.messages.at(-1)).toBe('You put the cassette into the Boombox.');
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

  it('does not ask PUT source clarification for visible but unreachable source matches', async () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const compactCassette = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.textAssets.setObject('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      synonyms: ['cassette', 'compact'],
    });
    fixture.scene.removeEntity(compactCassette);
    fixture.game.inventory.push(compactCassette);
    const musicCassette = fixture.addEntity('music_cassette', {
      title: "Cassette 'Music'",
      description: 'A far cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.textAssets.setObject('music_cassette', {
      title: "Cassette 'Music'",
      description: 'A far cassette.',
      synonyms: ['cassette', 'music'],
    });
    musicCassette.x = 200;
    const chair = fixture.addEntity('chair', {
      title: 'Chair',
      description: 'A chair.',
      components: [{ type: 'Surface', relation: 'under', capacity: 2, groups: [], items: [] }],
    });
    chair.x = 10;

    const messages = await runSemanticParser(fixture, 'put cassette under chair');

    expect(messages.some((message) => message.includes('Which item do you want'))).toBe(false);
    expect(messages.at(-1)).toBe('You put the Compact cassette under the Chair.');
    expect((chair.components?.[0] as { items: Array<{ id: string }> }).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'compact_cassette' })])
    );
    expect(fixture.game.inventory).not.toContain(compactCassette);
    expect(fixture.game.inventory).not.toContain(musicCassette);
  });

  it('does not ask PUT source clarification when the requested relation has no target storage', async () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const compactCassette = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.textAssets.setObject('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      synonyms: ['cassette', 'cassete', 'compact'],
    });
    fixture.scene.removeEntity(compactCassette);
    fixture.game.inventory.push(compactCassette);
    const musicCassette = fixture.addEntity('music_cassette', {
      title: "Cassette 'Music'",
      description: 'A far cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.textAssets.setObject('music_cassette', {
      title: "Cassette 'Music'",
      description: 'A far cassette.',
      synonyms: ['cassette', 'cassete', 'music'],
    });
    musicCassette.x = 200;
    const chair = fixture.addEntity('chair', {
      title: 'Chair',
      description: 'A chair.',
      components: [{ type: 'Surface', relation: 'on', capacity: 2, groups: [], items: [] }],
    });
    chair.x = 10;

    const messages = await runSemanticParser(fixture, 'put cassette under chair');

    expect(messages.some((message) => message.includes('Which item do you want'))).toBe(false);
    expect(messages.at(-1)).toBe("You can't put that there.");
    expect((chair.components?.[0] as { items: Array<{ id: string }> }).items).toEqual([]);
    expect(fixture.game.inventory).toContain(compactCassette);
  });

  it('does not ask PUT source clarification when a walkbox item placement is unreachable', async () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const compactCassette = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.textAssets.setObject('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      synonyms: ['cassette', 'cassete', 'compact'],
    });
    fixture.scene.removeEntity(compactCassette);
    fixture.game.inventory.push(compactCassette);
    const musicCassette = fixture.addEntity('music_cassette', {
      title: "Cassette 'Music'",
      description: 'A far cassette on the floor.',
      components: [{ type: 'Item' }],
    });
    fixture.textAssets.setObject('music_cassette', {
      title: "Cassette 'Music'",
      description: 'A far cassette on the floor.',
      synonyms: ['cassette', 'cassete', 'music'],
    });
    musicCassette.x = 5;
    musicCassette.y = 0;
    const floor = fixture.addWalkbox('Walk_main', 'in');
    floor.components = [
      {
        type: 'Surface',
        relation: 'in',
        capacity: 10,
        groups: [],
        items: [{ id: 'music_cassette', x: 200, y: 0 }],
      },
    ];
    musicCassette.spatial = { parentNodeId: 'Walk_main', relation: 'in' };
    const chair = fixture.addEntity('chair', {
      title: 'Chair',
      description: 'A chair.',
      components: [{ type: 'Surface', relation: 'under', capacity: 2, groups: [], items: [] }],
    });
    chair.x = 10;

    const messages = await runSemanticParser(fixture, 'put cassete under chair');

    expect(messages.some((message) => message.includes('Which item do you want'))).toBe(false);
    expect(messages.at(-1)).toBe('You put the Compact cassette under the Chair.');
    expect(fixture.game.inventory).not.toContain(compactCassette);
    expect(fixture.game.inventory).not.toContain(musicCassette);
  });

  it('reports why a visible PUT source cannot currently be used instead of clarifying', async () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const musicCassette = fixture.addEntity('music_cassette', {
      title: "Cassette 'Music'",
      description: 'A far cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.textAssets.setObject('music_cassette', {
      title: "Cassette 'Music'",
      description: 'A far cassette.',
      synonyms: ['cassette', 'music'],
    });
    musicCassette.x = 200;
    const chair = fixture.addEntity('chair', {
      title: 'Chair',
      description: 'A chair.',
      components: [{ type: 'Surface', relation: 'under', capacity: 2, groups: [], items: [] }],
    });
    chair.x = 10;

    const messages = await runSemanticParser(fixture, 'put cassette under chair');

    expect(messages.some((message) => message.includes('Which item do you want'))).toBe(false);
    expect(messages.at(-1)).toBe("You are too far away from the Cassette 'Music'.");
    expect((chair.components?.[0] as { items: Array<{ id: string }> }).items).toEqual([]);
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

    expect(result.messages.at(-1)).toBe('You put the cassette_held into the Tape recorder.');
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
    expect(resolved.messages.at(-1)).toBe('You put the cassette_b into the Tape recorder.');
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

  it('puts all matching plural source items into a target without clarification', async () => {
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
      components: [{ type: 'Inventory', capacity: 2, groups: [], protected: false, items: [] }],
    });
    recorder.x = 10;
    recorder.y = 0;

    const result = await fixture.run('put all cassettes into recorder');

    expect(result.messages).toEqual([
      'You put the cassette_a into the Tape recorder.',
      'You put the cassette_b into the Tape recorder.',
    ]);
    expect(inventoryNames(fixture)).toEqual([]);
    expect((recorder.components?.[0] as { items?: string[] } | undefined)?.items || []).toEqual([
      'cassette_a',
      'cassette_b',
    ]);
  });

  it('puts shared-noun and full item lists into a target in order', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const bluePill = fixture.addEntity('blue_pill', {
      title: 'Blue pill',
      description: 'A blue pill.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(bluePill);
    fixture.game.inventory.push(bluePill);
    const redPill = fixture.addEntity('red_pill', {
      title: 'Red pill',
      description: 'A red pill.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(redPill);
    fixture.game.inventory.push(redPill);
    const box = fixture.addEntity('box', {
      title: 'Box',
      description: 'A box.',
      components: [{ type: 'Inventory', capacity: 3, groups: [], protected: false, items: [] }],
    });

    const shared = await fixture.run('put blue and red pills in box');

    expect(shared.messages).toEqual([
      'You put the blue_pill into the Box.',
      'You put the red_pill into the Box.',
    ]);
    expect((box.components?.[0] as { items?: string[] } | undefined)?.items || []).toEqual([
      'blue_pill',
      'red_pill',
    ]);

    const fullFixture = createParserFixture();
    fullFixture.addPlayer('Hero', 0, 0);
    const fullBluePill = fullFixture.addEntity('blue_pill', {
      title: 'Blue pill',
      description: 'A blue pill.',
      components: [{ type: 'Item' }],
    });
    fullFixture.scene.removeEntity(fullBluePill);
    fullFixture.game.inventory.push(fullBluePill);
    const fullRedPill = fullFixture.addEntity('red_pill', {
      title: 'Red pill',
      description: 'A red pill.',
      components: [{ type: 'Item' }],
    });
    fullFixture.scene.removeEntity(fullRedPill);
    fullFixture.game.inventory.push(fullRedPill);
    fullFixture.addEntity('box', {
      title: 'Box',
      description: 'A box.',
      components: [{ type: 'Inventory', capacity: 3, groups: [], protected: false, items: [] }],
    });

    const full = await fullFixture.run('put blue pill and red pill in box');

    expect(full.messages).toEqual(shared.messages);
  });

  it('rejects partially invalid PUT lists before putting anything', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const bluePill = fixture.addEntity('blue_pill', {
      title: 'Blue pill',
      description: 'A blue pill.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(bluePill);
    fixture.game.inventory.push(bluePill);
    const box = fixture.addEntity('box', {
      title: 'Box',
      description: 'A box.',
      components: [{ type: 'Inventory', capacity: 3, groups: [], protected: false, items: [] }],
    });

    const result = await fixture.run('put blue and banana pills in box');

    expect(result.messages.at(-1)).toBe("You don't see any banana pills here.");
    expect(inventoryNames(fixture)).toEqual(['blue_pill']);
    expect((box.components?.[0] as { items?: string[] } | undefined)?.items || []).toEqual([]);
  });

  it('validates a PUT group target before source fallback', async () => {
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

    const result = await fixture.run('put all cassettes into recirder');

    expect(result.messages.at(-1)).toBe("You don't see any recirder here.");
    expect(result.pendingIntent).toBeNull();
    expect(inventoryNames(fixture)).toEqual(['cassette_a', 'cassette_b']);
  });

  it('filters PUT ALL sources that are already in the target', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const compactCassette = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      spatial: { parentNodeId: 'boombox', relation: 'in' },
      components: [{ type: 'Item' }],
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
          capacity: 2,
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

    const result = await fixture.run('put all cassettes into recorder');

    expect(result.messages).toEqual(['You put the music_cassette into the Boombox.']);
    expect((recorder.components?.[0] as { items?: string[] } | undefined)?.items || []).toEqual([
      compactCassette.name,
      musicCassette.name,
    ]);
  });

  it('filters PUT sources already stored through an untitled target extension', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('drawer', {
      title: 'upper drawer',
      description: 'A drawer.',
    });
    const drawerStorage = fixture.addEntity('drawer_storage', {
      title: null,
      spatial: { parentNodeId: 'drawer', relation: 'in' },
      components: [
        { type: 'Inventory', relation: 'in', capacity: 3, groups: [], protected: false, items: [] },
      ],
    });
    const orangePaper = fixture.addEntity('orange_paper', {
      title: 'Orange paper',
      description: 'Orange paper.',
      components: [{ type: 'Item' }],
    });
    fixture.textAssets.setObject('orange_paper', {
      title: 'Orange paper',
      description: 'Orange paper.',
      synonyms: ['paper', 'orange'],
    });
    const yellowPaper = fixture.addEntity('yellow_paper', {
      title: 'Yellow paper',
      description: 'Yellow paper.',
      components: [{ type: 'Item' }],
    });
    fixture.textAssets.setObject('yellow_paper', {
      title: 'Yellow paper',
      description: 'Yellow paper.',
      synonyms: ['paper', 'yellow'],
    });
    fixture.scene.removeEntity(yellowPaper);
    fixture.game.inventory.push(yellowPaper);
    fixture.game.addInventoryEntity(drawerStorage as any, orangePaper as any, 'in');

    const result = await fixture.run('put all paper in drawer');

    expect(result.messages).toEqual(['You put the yellow_paper into the upper drawer.']);
    expect(
      (drawerStorage.components?.[0] as { items?: string[] } | undefined)?.items || []
    ).toEqual([orangePaper.name, yellowPaper.name]);
  });

  it('keeps PUT BOTH ambiguous when more than two sources match', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    for (const id of ['cassette_a', 'cassette_b', 'cassette_c']) {
      const cassette = fixture.addEntity(id, {
        title: id.replace('_', ' '),
        description: 'A held cassette.',
        components: [{ type: 'Item' }],
      });
      fixture.scene.removeEntity(cassette);
      fixture.game.inventory.push(cassette);
    }
    fixture.addEntity('recorder', {
      title: 'Tape recorder',
      description: 'A tape recorder.',
      components: [{ type: 'Inventory', capacity: 3, groups: [], protected: false, items: [] }],
    });

    const result = await fixture.run('put both cassettes into recorder');

    expect(result.messages.at(-1)).toContain('Which item do you want to put down');
    expect(result.pendingIntent).toBe('put');
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

  it('surfaces a distance-specific error for PUT before checking whether the target can store anything', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const paper = fixture.addEntity('paper', {
      title: 'Paper',
      description: 'A paper.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(paper);
    fixture.game.inventory.push(paper);
    const cassette = fixture.addEntity('cassette', {
      title: "Cassette 'Music'",
      description: 'A cassette with no storage.',
      components: [{ type: 'Item' }],
    });
    cassette.x = 250;
    cassette.y = 0;

    const result = await fixture.run('put paper in cassette');

    expect(result.messages.at(-1)).toBe("You are too far away from the Cassette 'Music'.");
    expect(result.pendingIntent).toBeNull();
    expect(fixture.game.inventory).toContain(paper);
    expect(fixture.scene.entities).toContain(cassette);
  });

  it('surfaces a distance-specific error for PUT on a distant visible target synonym', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', -87, 257);
    const paper = fixture.addEntity('paper', {
      title: 'Yellow paper',
      description: 'A yellow paper.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(paper);
    fixture.game.inventory.push(paper);
    const cassette = fixture.addEntity('music_cassette', {
      title: "Cassette 'Music'",
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.textAssets.setObject('music_cassette', {
      title: "Cassette 'Music'",
      description: 'A compact cassette.',
      synonyms: ['music', 'cassette'],
    });
    cassette.x = 250;
    cassette.y = 0;

    const result = await fixture.run('put paper in music');

    expect(result.messages.at(-1)).toBe("You are too far away from the Cassette 'Music'.");
    expect(result.pendingIntent).toBeNull();
    expect(fixture.game.inventory).toContain(paper);
  });

  it('puts an item under a target using its built-in UNDER surface without creating inventory', async () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const cassette = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(cassette);
    fixture.game.inventory.push(cassette);
    const chair = fixture.addEntity('chair', {
      title: 'Chair',
      description: 'A chair.',
      components: [{ type: 'Surface', relation: 'under', capacity: 2, groups: [], items: [] }],
    });

    const messages = await runSemanticParser(fixture, 'put cassette under chair');

    expect(messages.at(-1)).toBe('You put the Compact cassette under the Chair.');
    expect((chair.components?.[0] as { items: Array<{ id: string }> }).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'compact_cassette' })])
    );
    expect(
      chair.components?.some((component: any) => component?.type === 'Inventory') ?? false
    ).toBe(false);
    expect((cassette as any).spatial).toEqual({ parentNodeId: 'chair', relation: 'under' });
  });

  it('surfaces a distance-specific error for DROP when the nearest drop surface is too far away', async () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const cassette = fixture.addEntity('cassette', {
      title: 'Cassette',
      description: 'A tape.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(cassette);
    fixture.game.inventory.push(cassette);
    fixture.addEntity('desk', {
      title: 'Desk',
      description: 'A desk.',
      components: [],
    });
    fixture.addEntity('drawer', {
      title: 'upper drawer',
      description: 'A closed drawer.',
      spatial: { parentNodeId: 'desk', relation: 'in' },
      components: [{ type: 'Switch', state: 1, clearlyOpenable: true }],
    });
    const drawerSurface = fixture.addTriggerbox('drawer_surface', {
      title: null,
      description: 'Drawer surface.',
      spatial: { parentNodeId: 'drawer', relation: 'in' },
      components: [{ type: 'Surface', relation: 'on', capacity: 2, groups: [], items: [] }],
    });
    drawerSurface.poly = [
      { x: 20, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 10 },
      { x: 20, y: 10 },
    ];
    const deskSurface = fixture.addTriggerbox('desk_surface', {
      title: null,
      description: 'Desk surface.',
      spatial: { parentNodeId: 'desk', relation: 'on' },
      components: [{ type: 'Surface', relation: 'on', capacity: 2, groups: [], items: [] }],
    });
    deskSurface.poly = [
      { x: 250, y: 0 },
      { x: 260, y: 0 },
      { x: 260, y: 10 },
      { x: 250, y: 10 },
    ];

    const messages = await runSemanticParser(fixture, 'drop cassette');

    expect(messages.at(-1)).toBe('You are too far away from the Desk.');
    expect(fixture.game.inventory).toContain(cassette);
  });

  it('accepts floor and ground as the walkbox target for PUT', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A key.',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);
    const floor = fixture.addWalkbox('FloorZone');
    floor.components = [{ type: 'Surface', relation: 'in', capacity: 4, groups: [], items: [] }];

    const floorResult = await fixture.run('put key on floor');
    expect(floorResult.messages.at(-1)).toBe('You put the key on the floor.');

    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);
    const groundResult = await fixture.run('put key on ground');
    expect(groundResult.messages.at(-1)).toBe('You put the key on the floor.');
  });

  it('reports floor placement for explicit PUT IN floor targets', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A key.',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);
    const floor = fixture.addWalkbox('FloorZone');
    floor.components = [{ type: 'Surface', relation: 'in', capacity: 4, groups: [], items: [] }];

    const result = await fixture.run('put key in floor');

    expect(result.messages.at(-1)).toBe('You put the key on the floor.');
  });

  it('prefers the walkbox floor for DROP when a separate surface is nearby', async () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A key.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);
    const floor = fixture.addWalkbox('Walk_main');
    floor.poly = [
      { x: -40, y: -40 },
      { x: 40, y: -40 },
      { x: 40, y: 40 },
      { x: -40, y: 40 },
    ];
    floor.components = [{ type: 'Surface', relation: 'in', capacity: 4, groups: [], items: [] }];
    fixture.addEntity('desk', {
      title: 'Desk',
      description: 'A desk.',
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });

    const messages = await runSemanticParser(fixture, 'drop key');

    expect(messages.at(-1)).toBe('You put the Key on the floor.');
    expect(fixture.game.inventory).not.toContain(key);
  });

  it('can TAKE an item immediately after dropping it onto the walkbox floor', async () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const compactCassette = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(compactCassette);
    fixture.game.inventory.push(compactCassette);
    const musicCassette = fixture.addEntity('music_cassette', {
      title: "Cassette 'Music'",
      description: 'A music cassette.',
      components: [{ type: 'Item' }],
    });
    musicCassette.x = 300;
    musicCassette.y = 0;
    fixture.addEntity('desk', {
      title: 'Desk',
      description: 'A desk.',
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    const floor = fixture.addWalkbox('Walk_main');
    floor.poly = [
      { x: -40, y: -40 },
      { x: 40, y: -40 },
      { x: 40, y: 40 },
      { x: -40, y: 40 },
    ];
    floor.components = [{ type: 'Surface', relation: 'in', capacity: 4, groups: [], items: [] }];

    const dropMessages = await runSemanticParser(fixture, 'drop cassette');
    const dropMessage = dropMessages.at(-1);
    const takeMessages = await runSemanticParser(fixture, 'take cassette');

    expect(dropMessage).toBe('You put the Compact cassette on the floor.');
    expect(takeMessages.at(-1)).toBe('You picked up the Compact cassette.');
    expect(fixture.game.inventory).toContain(compactCassette);
    expect(fixture.game.inventory).not.toContain(musicCassette);
  });

  it('prefers an untitled surface inside the active subscene before the floor for DROP', async () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const drawerZone = fixture.addTriggerbox('DrawerZone', {
      title: 'Drawer front',
      description: 'A drawer front.',
      components: [{ type: 'Subscene', targetGroupId: '' }],
    });
    const tray = fixture.addEntity('tray', {
      title: null,
      description: 'A tray.',
      disabled: true,
      spatial: { parentNodeId: 'DrawerZone', relation: 'in' },
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A key.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);
    const floor = fixture.addWalkbox('Walk_main');
    floor.poly = [
      { x: -40, y: -40 },
      { x: 40, y: -40 },
      { x: 40, y: 40 },
      { x: -40, y: 40 },
    ];
    floor.components = [{ type: 'Surface', relation: 'in', capacity: 4, groups: [], items: [] }];

    ComponentSystem.handleActivation(drawerZone, fixture.scene);

    const messages = await runSemanticParser(fixture, 'drop key');

    expect(messages.at(-1)).toBe('You put the Key into the Drawer front.');
    expect(tray.components?.[0]?.items?.some((item: any) => item.id === key.name)).toBe(true);
    expect(floor.components?.[0]?.items?.some((item: any) => item.id === key.name)).toBe(false);
  });

  it('takes all matching plural source items without clarification', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.addEntity('music_cassette', {
      title: "Cassette 'Music'",
      description: 'A music cassette.',
      components: [{ type: 'Item' }],
    });

    const result = await fixture.run('take all cassettes');

    expect(result.messages).toEqual([
      'You picked up the Compact cassette.',
      "You picked up the Cassette 'Music'.",
    ]);
    expect(inventoryNames(fixture)).toEqual(['compact_cassette', 'music_cassette']);
  });

  it('does not ask for TAKE clarification when only one matching item is currently takeable', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const nearCassette = fixture.addEntity('near_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette on the floor.',
      components: [{ type: 'Item' }],
    });
    const desk = fixture.addEntity('desk', {
      title: 'Desk',
      description: 'A desk.',
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    fixture.addEntity('far_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette on the desk.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'desk', relation: 'on' },
    });
    nearCassette.x = 0;
    nearCassette.y = 0;
    desk.x = 300;
    desk.y = 0;
    const farCassette = fixture.scene.getObjectByName('far_cassette') as any;
    farCassette.x = 300;
    farCassette.y = 0;

    const result = await fixture.run('take cassette');

    expect(result.messages.at(-1)).toBe('You picked up the Compact cassette.');
    expect(fixture.game.inventory).toContain(nearCassette);
    expect(fixture.game.inventory.map((entity) => entity.name)).not.toContain('far_cassette');
  });

  it('treats singular and plural ALL TAKE queries the same', async () => {
    const pluralFixture = createParserFixture();
    pluralFixture.addPlayer('Hero', 0, 0);
    pluralFixture.addEntity('cassette_a', {
      title: 'Cassette A',
      description: 'A cassette.',
      components: [{ type: 'Item' }],
    });
    pluralFixture.addEntity('cassette_b', {
      title: 'Cassette B',
      description: 'A cassette.',
      components: [{ type: 'Item' }],
    });
    const plural = await pluralFixture.run('take all cassettes');

    const singularFixture = createParserFixture();
    singularFixture.addPlayer('Hero', 0, 0);
    singularFixture.addEntity('cassette_a', {
      title: 'Cassette A',
      description: 'A cassette.',
      components: [{ type: 'Item' }],
    });
    singularFixture.addEntity('cassette_b', {
      title: 'Cassette B',
      description: 'A cassette.',
      components: [{ type: 'Item' }],
    });
    const singular = await singularFixture.run('take all cassette');

    expect(plural.messages).toEqual(singular.messages);
    expect(inventoryNames(pluralFixture)).toEqual(['cassette_a', 'cassette_b']);
    expect(inventoryNames(singularFixture)).toEqual(['cassette_a', 'cassette_b']);
  });

  it('takes both matching plural source items only when exactly two match', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('cassette_a', {
      title: 'Cassette A',
      description: 'A cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.addEntity('cassette_b', {
      title: 'Cassette B',
      description: 'A cassette.',
      components: [{ type: 'Item' }],
    });

    const result = await fixture.run('take both cassettes');

    expect(result.messages).toEqual([
      'You picked up the Cassette A.',
      'You picked up the Cassette B.',
    ]);
    expect(inventoryNames(fixture)).toEqual(['cassette_a', 'cassette_b']);
  });

  it('rejects BOTH TAKE when more than two source items match', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('cassette_a', {
      title: 'Cassette A',
      description: 'A cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.addEntity('cassette_b', {
      title: 'Cassette B',
      description: 'A cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.addEntity('cassette_c', {
      title: 'Cassette C',
      description: 'A cassette.',
      components: [{ type: 'Item' }],
    });

    const result = await fixture.run('take both cassettes');

    expect(result.messages.at(-1)).toBe(
      'Which item do you mean: 1: Cassette A, 2: Cassette B, 3: Cassette C?'
    );
    expect(result.pendingIntent).toBe('take');
    expect(inventoryNames(fixture)).toEqual([]);
  });

  it('takes shared-noun and full item lists in order', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('blue_pill', {
      title: 'Blue pill',
      description: 'A blue pill.',
      components: [{ type: 'Item' }],
    });
    fixture.addEntity('red_pill', {
      title: 'Red pill',
      description: 'A red pill.',
      components: [{ type: 'Item' }],
    });

    const shared = await fixture.run('take blue and red pills');

    expect(shared.messages).toEqual([
      'You picked up the Blue pill.',
      'You picked up the Red pill.',
    ]);
    expect(inventoryNames(fixture)).toEqual(['blue_pill', 'red_pill']);

    const fullFixture = createParserFixture();
    fullFixture.addPlayer('Hero', 0, 0);
    fullFixture.addEntity('blue_pill', {
      title: 'Blue pill',
      description: 'A blue pill.',
      components: [{ type: 'Item' }],
    });
    fullFixture.addEntity('red_pill', {
      title: 'Red pill',
      description: 'A red pill.',
      components: [{ type: 'Item' }],
    });

    const full = await fullFixture.run('take blue pill and red pill');

    expect(full.messages).toEqual(shared.messages);
    expect(inventoryNames(fullFixture)).toEqual(['blue_pill', 'red_pill']);
  });

  it('rejects partially invalid TAKE lists before taking anything', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('blue_pill', {
      title: 'Blue pill',
      description: 'A blue pill.',
      components: [{ type: 'Item' }],
    });

    const result = await fixture.run('take blue and banana pills');

    expect(result.messages.at(-1)).toBe("You don't see any banana pills here.");
    expect(inventoryNames(fixture)).toEqual([]);
  });

  it('deduplicates repeated TAKE list entries', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('blue_pill', {
      title: 'Blue pill',
      description: 'A blue pill.',
      components: [{ type: 'Item' }],
    });

    const result = await fixture.run('take blue pill and blue pill');

    expect(result.messages).toEqual(['You picked up the Blue pill.']);
    expect(inventoryNames(fixture)).toEqual(['blue_pill']);
  });

  it('takes all matching plural source items from a scoped container', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('box', {
      title: 'Box',
      description: 'A box.',
      components: [
        {
          type: 'Inventory',
          capacity: 4,
          groups: [],
          protected: false,
          items: ['cassette_a', 'cassette_b'],
        },
      ],
    });
    fixture.addEntity('cassette_a', {
      title: 'Cassette A',
      description: 'A cassette.',
      components: [{ type: 'Item', ignoreDistance: true }],
      spatial: { parentNodeId: 'box', relation: 'in' },
    });
    fixture.addEntity('cassette_b', {
      title: 'Cassette B',
      description: 'A cassette.',
      components: [{ type: 'Item', ignoreDistance: true }],
      spatial: { parentNodeId: 'box', relation: 'in' },
    });

    const result = await fixture.run('take all cassettes from box');

    expect(result.messages).toEqual([
      'You picked up the Cassette A.',
      'You picked up the Cassette B.',
    ]);
    expect(inventoryNames(fixture)).toEqual(['cassette_a', 'cassette_b']);
  });

  it('keeps ordinary TAKE ambiguity and clarification multi-select working', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('cassette_a', {
      title: 'Cassette A',
      description: 'A cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.addEntity('cassette_b', {
      title: 'Cassette B',
      description: 'A cassette.',
      components: [{ type: 'Item' }],
    });

    const ambiguous = await fixture.run('take cassette');
    expect(ambiguous.messages.at(-1)).toBe('Which item do you mean: 1: Cassette A, 2: Cassette B?');
    expect(ambiguous.pendingIntent).toBe('take');

    const resolved = await fixture.run('all');
    expect(resolved.messages).toEqual([
      'You picked up the Cassette A.',
      'You picked up the Cassette B.',
    ]);
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

  it('takes a nested semantic descendant from an outer anchor-relative container', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('cabinet', {
      title: 'Cabinet',
      description: 'A cabinet.',
    });
    fixture.addEntity('book_a', {
      title: 'Book A',
      description: 'A book inside the cabinet.',
      components: [{ type: 'Item', ignoreDistance: true }],
      spatial: { parentNodeId: 'cabinet', relation: 'in' },
    });
    fixture.addEntity('book_b', {
      title: 'Book B',
      description: 'A book on another book.',
      components: [{ type: 'Item', ignoreDistance: true }],
      spatial: { parentNodeId: 'book_a', relation: 'on' },
    });

    const look = await fixture.run('look in cabinet');
    expect(look.messages.at(-1)).toBe('In the Cabinet you see: Book A and Book B.');

    const result = await fixture.run('take book b from cabinet');

    expect(result.messages.at(-1)).toBe('You picked up the Book B.');
    expect(inventoryNames(fixture)).toEqual(['book_b']);
  });

  it('takes all matching nested semantic descendants from an outer anchor-relative container', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('cabinet', {
      title: 'Cabinet',
      description: 'A cabinet.',
    });
    fixture.addEntity('book_a', {
      title: 'Book A',
      description: 'A book inside the cabinet.',
      components: [{ type: 'Item', ignoreDistance: true }],
      spatial: { parentNodeId: 'cabinet', relation: 'in' },
    });
    fixture.addEntity('book_b', {
      title: 'Book B',
      description: 'A book on another book.',
      components: [{ type: 'Item', ignoreDistance: true }],
      spatial: { parentNodeId: 'book_a', relation: 'on' },
    });

    const result = await fixture.run('take all books from cabinet');

    expect(result.messages).toEqual(['You picked up the Book B.', 'You picked up the Book A.']);
    expect(inventoryNames(fixture)).toEqual(['book_b', 'book_a']);
  });

  it('keeps object-relative ON semantics while allowing generic TAKE FROM wording', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('cabinet', {
      title: 'Cabinet',
      description: 'A cabinet.',
    });
    fixture.addEntity('book_a', {
      title: 'Book A',
      description: 'A book inside the cabinet.',
      components: [{ type: 'Item', ignoreDistance: true }],
      spatial: { parentNodeId: 'cabinet', relation: 'in' },
    });
    fixture.addEntity('book_b', {
      title: 'Book B',
      description: 'A book on another book.',
      components: [{ type: 'Item', ignoreDistance: true }],
      spatial: { parentNodeId: 'book_a', relation: 'on' },
    });

    const look = await fixture.run('look on book a');
    expect(look.messages.at(-1)).toBe('On the Book A you see: Book B.');

    const result = await fixture.run('take book b from book a');

    expect(result.messages.at(-1)).toBe('You picked up the Book B.');
    expect(inventoryNames(fixture)).toEqual(['book_b']);
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
