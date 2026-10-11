import { describe, expect, it, vi } from 'vitest';
import { createParserFixture } from '../fixtures/parserFactory';
import { createGameSemanticFixture } from '../fixtures/gameSemanticFactory';
import { Parser } from '../../src/mechanics/Parser';
import { createLlmProvider } from '../../src/mechanics/llm/createLlmProvider';
import { ComponentSystem } from '../../src/systems/ComponentSystem';
import { Actor } from '../../src/entities/Actor';

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
    parserPeekPnEnabled: false,
    log() {},
  } as any;
  const parser = new Parser(fixture.game, createLlmProvider());
  await parser.parse(input);
  return fixture.messages;
}

async function finishAutoApproach(fixture: any): Promise<void> {
  for (let index = 0; index < 20 && fixture.scene.player?.state === 'walk'; index += 1) {
    fixture.scene.update(1000);
  }
  await vi.advanceTimersByTimeAsync(100);
}

describe('Parser + game integration smoke', () => {
  it('executes the player GIVE command into a protected Actor inventory', async () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const guard = new Actor(fixture.game, 10, 0, 10, 10, 'guard');
    guard.components = [
      { type: 'NPC', enabled: true },
      { type: 'Inventory', relation: 'in', capacity: 1, groups: [], protected: true, items: [] },
    ];
    fixture.scene.addEntity(guard);
    fixture.textAssets.setObject(guard.name, { title: 'Guard', description: 'A guard.' });
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A brass key.',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    fixture.game.addInventoryEntity(player, key, 'in');

    const messages = await runSemanticParser(fixture, 'give key to guard');

    expect(messages.at(-1)).toBe('You give the Key to Guard.');
    expect(fixture.game.inventoryManager.hasInventoryEntity(guard, key, 'in')).toBe(true);
  });

  it('takes revealed contents from a held editor-authored container without auto-approach', async () => {
    const fixture = createParserFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const remote = fixture.addEntity('tv_rc', {
      title: 'TV remote',
      description: 'A remote.',
      details: 'A remote with a battery compartment.',
      synonyms: ['remote', 'rc'],
      components: [
        { type: 'Item' },
        {
          type: 'Inventory',
          relation: 'in',
          capacity: 1,
          groups: ['#aaa'],
          protected: false,
          items: [],
        },
      ],
    });
    const batteries = fixture.addEntity('batteryAAA', {
      title: 'AAA batteries',
      description: 'Two AAA batteries.',
      synonyms: ['aaa', 'batteries'],
      groupID: '#aaa',
      spatial: { parentNodeId: remote.name, relation: 'in' },
      components: [{ type: 'Item' }],
    } as any);
    batteries.hidden = 'examinable';
    batteries.x = 1019;
    batteries.y = 344;

    fixture.game.inventoryManager.handleSceneChange();
    expect(fixture.game.addInventoryEntity(player, remote, 'in').status).toBe('ok');
    const moveTo = vi.spyOn(player, 'moveTo');

    fixture.scene.revealHiddenEntity(batteries);
    await fixture.run('take aaa');

    expect(moveTo).not.toHaveBeenCalled();
    expect(fixture.game.inventory).toContain(batteries);
    expect(fixture.game.getInventoryEntities(remote, 'in')).not.toContain(batteries);
  });

  it('takes a visible item from a reachable spatial parent even when its own coordinates are distant', async () => {
    const fixture = createParserFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const pillow = fixture.addEntity('right_pillow', {
      title: 'right pillow',
      description: 'A sofa pillow.',
    });
    pillow.x = 0;
    pillow.y = 0;
    const remote = fixture.addEntity('tv_rc', {
      title: 'TV remote',
      description: 'A remote tucked under the pillow.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: pillow.name, relation: 'under' },
    });
    remote.x = 500;
    remote.y = 500;
    fixture.textAssets.setObject(pillow.name, {
      title: 'right pillow',
      description: 'A sofa pillow.',
      synonyms: ['pillow'],
    });
    fixture.textAssets.setObject(remote.name, {
      title: 'TV remote',
      description: 'A remote tucked under the pillow.',
      synonyms: ['remote'],
    });
    const moveTo = vi.spyOn(player, 'moveTo');

    const result = await fixture.run('take remote');

    expect(result.messages.at(-1)).toContain('You picked up the TV remote');
    expect(fixture.game.inventory).toContain(remote);
    expect(moveTo).not.toHaveBeenCalled();
  });

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

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.relation_contents', {
        Relation: 'Under',
        target: 'Chair',
        items: 'Piece of paper',
      })
    );
  });

  it('includes visible spatial contents for all relations on direct LOOK target', async () => {
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
    fixture.addEntity('hat', {
      title: 'Hat',
      description: 'A hat.',
      spatial: { parentNodeId: 'Chair', relation: 'on' },
    });
    fixture.addEntity('remote', {
      title: 'Remote control',
      description: 'A remote.',
      spatial: { parentNodeId: 'Chair', relation: 'behind' },
    });
    fixture.addEntity('coin', {
      title: 'Coin',
      description: 'A coin.',
      spatial: { parentNodeId: 'Chair', relation: 'in' },
    });

    const result = await fixture.run('look chair');

    expect(result.messages.at(-1)).toBe(
      [
        'A wooden chair.',
        fixture.game.text('parser.relation_contents', {
          Relation: 'In',
          target: 'Chair',
          items: 'Coin',
        }),
        fixture.game.text('parser.relation_contents', {
          Relation: 'On',
          target: 'Chair',
          items: 'Hat',
        }),
        fixture.game.text('parser.relation_contents', {
          Relation: 'Under',
          target: 'Chair',
          items: 'Piece of paper',
        }),
        fixture.game.text('parser.relation_contents', {
          Relation: 'Behind',
          target: 'Chair',
          items: 'Remote control',
        }),
      ].join('\n')
    );
  });

  it('discovers hidden lookable spatial contents on direct LOOK target only once', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.addEntity('Chair', {
      title: 'Chair',
      description: 'A wooden chair.',
    });
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A hidden key.',
      spatial: { parentNodeId: 'Chair', relation: 'under' },
    });
    key.hidden = 'lookable';

    const firstLook = await fixture.run('look chair');
    expect(firstLook.messages.at(-1)).toBe(
      [
        'A wooden chair.',
        fixture.game.text('parser.relation_discovered_contents', {
          Relation: 'Under',
          target: 'Chair',
          items: 'Key',
        }),
      ].join('\n')
    );
    expect(fixture.scene.isHiddenEntityRevealed(key)).toBe(true);

    const secondLook = await fixture.run('look chair');
    expect(secondLook.messages.at(-1)).toBe(
      [
        'A wooden chair.',
        fixture.game.text('parser.relation_contents', {
          Relation: 'Under',
          target: 'Chair',
          items: 'Key',
        }),
      ].join('\n')
    );
  });

  it('includes visible spatial contents after EXAMINE description', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.addEntity('desk', {
      title: 'Desk',
      description: 'A desk.',
      details: 'A walnut writing desk.',
    });
    fixture.textAssets.setObject('desk', {
      title: 'Desk',
      description: 'A desk.',
      details: 'A walnut writing desk.',
    });
    fixture.addEntity('letter', {
      title: 'Letter',
      description: 'A folded letter.',
      spatial: { parentNodeId: 'desk', relation: 'on' },
    });

    const result = await fixture.run('examine desk');

    expect(result.messages.at(-1)).toBe(
      [
        'A walnut writing desk.',
        fixture.game.text('parser.relation_contents', {
          Relation: 'On',
          target: 'Desk',
          items: 'Letter',
        }),
      ].join('\n')
    );
  });

  it('discovers hidden lookable spatial contents through EXAMINE target', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.addEntity('desk', {
      title: 'Desk',
      description: 'A desk.',
      details: 'A walnut writing desk.',
    });
    fixture.textAssets.setObject('desk', {
      title: 'Desk',
      description: 'A desk.',
      details: 'A walnut writing desk.',
    });
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A hidden key.',
      spatial: { parentNodeId: 'desk', relation: 'under' },
    });
    key.hidden = 'lookable';

    const result = await fixture.run('examine desk');

    expect(result.messages.at(-1)).toBe(
      [
        'A walnut writing desk.',
        fixture.game.text('parser.relation_discovered_contents', {
          Relation: 'Under',
          target: 'Desk',
          items: 'Key',
        }),
      ].join('\n')
    );
    expect(fixture.scene.isHiddenEntityRevealed(key)).toBe(true);
  });

  it('automatically approaches and examines a far reachable target', async () => {
    vi.useFakeTimers();
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
    expect(result.messages).toEqual([]);

    await finishAutoApproach(fixture);

    expect(fixture.messages.at(-1)).toBe('A detailed boombox description.');
    vi.useRealTimers();
  });

  it('automatically approaches and takes a far reachable target', async () => {
    vi.useFakeTimers();
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const cassette = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
    });
    cassette.x = 200;

    const result = await fixture.run('take cassette');
    expect(result.messages).toEqual([]);

    await finishAutoApproach(fixture);

    expect(fixture.messages.at(-1)).toBe(
      fixture.game.text('parser.take_pickup_success', { item: 'Compact cassette' })
    );
    expect(fixture.game.inventory).toContain(cassette);
    vi.useRealTimers();
  });

  it('automatically approaches the preferred far TAKE diagnostic match', async () => {
    vi.useFakeTimers();
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const nearest = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
    });
    nearest.x = 200;
    const farther = fixture.addEntity('backup_cassette', {
      title: 'Backup cassette',
      description: 'A backup cassette.',
      components: [{ type: 'Item' }],
    });
    farther.x = 300;

    const result = await fixture.run('take cassette');
    expect(result.messages).toEqual([]);

    await finishAutoApproach(fixture);

    expect(fixture.game.inventory).toContain(nearest);
    expect(fixture.game.inventory).not.toContain(farther);
    vi.useRealTimers();
  });

  it('does not automatically approach a TAKE target while a Subscene is open', async () => {
    const fixture = createParserFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const cassette = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
    });
    cassette.x = 200;
    fixture.scene.activeSubscene = 'desk_closeup';

    await fixture.run('take cassette');

    expect(fixture.messages.at(-1)).toBe('You are too far away from the Compact cassette.');
    expect(player.getMoveResult().status).toBe('idle');
    expect(fixture.game.inventory).not.toContain(cassette);
  });

  it('blocks GO TO while a Subscene is open', async () => {
    const fixture = createParserFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('door', {
      title: 'Door',
      description: 'A door.',
      components: [{ type: 'Exit', targetSceneId: 'Corridor' }],
    });
    fixture.scene.activeSubscene = 'desk_closeup';

    await fixture.run('go to door');

    expect(fixture.messages.at(-1)).toBe('Close the current view before moving.');
    expect(player.getMoveResult().status).toBe('idle');
    expect(fixture.scene.activeSubscene).toBe('desk_closeup');
  });

  it('moves a taken item into player inventory without removing the scene entity', async () => {
    const fixture = createParserFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const cassette = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
    });

    await fixture.run('take cassette');

    expect(fixture.messages.at(-1)).toBe(
      fixture.game.text('parser.take_pickup_success', { item: 'Compact cassette' })
    );
    expect(fixture.game.inventory).toContain(cassette);
    expect(fixture.scene.entities).toContain(cassette);
    expect(cassette.visible).toBe(false);
    expect((cassette as any).spatial).toEqual({ parentNodeId: player.name, relation: 'in' });
  });

  it('takes an item from a reachable container even when the stored item has stale far coordinates', async () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const recorder = fixture.addEntity('recorder', {
      title: 'Tape recorder',
      description: 'A tape recorder.',
      components: [{ type: 'Inventory', capacity: 2, groups: [], protected: false, items: [] }],
    });
    recorder.x = 10;
    fixture.textAssets.setObject('recorder', {
      title: 'Tape recorder',
      description: 'A tape recorder.',
      synonyms: ['boombox', 'recorder'],
    });
    const cassette = fixture.addEntity('cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      components: [{ type: 'Item' }],
    });
    cassette.x = 250;
    cassette.y = 0;
    fixture.textAssets.setObject('cassette', {
      title: 'Compact cassette',
      description: 'A compact cassette.',
      synonyms: ['cassette', 'cassete'],
    });
    fixture.game.addInventoryEntity(recorder, cassette);

    const messages = await runSemanticParser(fixture, 'take cassete from boombox');

    expect(messages.at(-1)).toBe(
      fixture.game.text('parser.take_pickup_success_from', {
        item: 'Compact cassette',
        source: 'Tape recorder',
      })
    );
    expect(fixture.game.inventory).toContain(cassette);
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

  it('does not retake a scene duplicate when the same item id is already held', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const heldCassette = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A held cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(heldCassette);
    fixture.game.inventory.push(heldCassette);
    fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A stale scene duplicate.',
      components: [{ type: 'Item' }],
    });

    const result = await fixture.run('take cassette');

    expect(result.messages.at(-1)).toBe("You don't see any cassette here.");
    expect(fixture.game.inventory).toEqual([heldCassette]);
  });

  it('does not ask TAKE clarification between held and unreachable matches', async () => {
    vi.useFakeTimers();
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
    expect(result.messages).toEqual([]);

    await finishAutoApproach(fixture);

    expect(fixture.messages.at(-1)).toBe(
      fixture.game.text('parser.take_pickup_success', { item: "Cassette 'Music'" })
    );
    expect(fixture.game.inventory).toContain(farCassette);
    vi.useRealTimers();
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
    expect(openResult.messages.at(-1)).toBe(
      fixture.game.text('parser.open_success', { target: 'Drawer' })
    );

    const closeResult = await fixture.run('close drawer');
    expect(closeResult.messages.at(-1)).toBe(
      fixture.game.text('parser.close_success', { target: 'Drawer' })
    );
  });

  it('automatically approaches and opens a far reachable switch', async () => {
    vi.useFakeTimers();
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const drawer = fixture.addEntity('Drawer', {
      title: 'Drawer',
      description: 'A drawer.',
      components: [{ type: 'Switch', state: 1 }],
    });
    drawer.x = 200;

    const result = await fixture.run('open drawer');
    expect(result.messages).toEqual([]);

    await finishAutoApproach(fixture);

    expect(fixture.messages.at(-1)).toBe(
      fixture.game.text('parser.open_success', { target: 'Drawer' })
    );
    expect((drawer.components[0] as any).state).toBe(2);
    vi.useRealTimers();
  });

  it('elevates OPEN on non-switch objects to the next parser cascade', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('Chair', {
      title: 'Chair',
      description: 'A wooden chair.',
    });

    const result = await fixture.run('open chair');

    expect(result.messages.at(-1)).toBe(fixture.game.text('parser.parse_unknown'));
  });

  it('uses OPEN on an accessible non-switch container to list its contents', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const remote = fixture.addEntity('remote', {
      title: 'TV remote',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    const batterySlot = fixture.addEntity('remote_battery_slot', {
      title: null,
      spatial: { parentNodeId: remote.name, relation: 'in' },
      components: [{ type: 'Inventory', relation: 'in', capacity: 2, groups: [], items: [] }],
    });
    const batteries = fixture.addEntity('aaa_batteries', {
      title: 'AAA batteries',
      components: [{ type: 'Item' }],
    });
    fixture.game.addInventoryEntity(batterySlot, batteries);

    const result = await fixture.run('open remote');

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.relation_contents', {
        Relation: 'In',
        relation: 'in',
        target: 'TV remote',
        items: 'AAA batteries',
      })
    );
  });

  it('uses OPEN on a held switch matched by a synonym', async () => {
    const fixture = createParserFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const remote = fixture.addEntity('remote', {
      title: 'TV remote',
      components: [
        { type: 'Item', ignoreDistance: true },
        { type: 'Switch', state: 1 },
      ],
    });
    fixture.textAssets.setObject(remote.name, { title: 'TV remote', synonyms: ['rc'] });
    fixture.game.inventoryManager.handleSceneChange();
    fixture.game.addInventoryEntity(player, remote);

    const result = await fixture.run('open rc');

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.open_success', { target: 'TV remote' })
    );
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
    expect(relationResult.messages.at(-1)).toBe(
      fixture.game.text('engine.closed_container', { target: 'Drawer' })
    );

    const directResult = await fixture.run('look note');
    expect(directResult.messages.at(-1)).toBe("You don't see any note here.");
  });

  it('reveals a lookable hidden target through relation LOOK, not direct LOOK', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('Chair', {
      title: 'Chair',
      description: 'A wooden chair.',
    });
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A hidden key.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'Chair', relation: 'under' },
    });
    key.hidden = 'lookable';

    const directResult = await fixture.run('look key');
    expect(directResult.messages.at(-1)).toBe("You don't see any key here.");
    expect(fixture.scene.isHiddenEntityRevealed(key)).toBe(false);

    const relationResult = await fixture.run('look under chair');
    expect(relationResult.messages.at(-1)).toBe(
      fixture.game.text('parser.relation_discovered_contents', {
        Relation: 'Under',
        target: 'Chair',
        items: 'Key',
      })
    );
    expect(fixture.scene.isHiddenEntityRevealed(key)).toBe(true);

    const revealedResult = await fixture.run('look key');
    expect(revealedResult.messages.at(-1)).toBe('A hidden key.');
  });

  it('keeps hidden lookable relation contents absent from direct LOOK until discovered', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'Cassette recorder.',
    });
    const cables = fixture.addEntity('audio_cables', {
      title: 'audio cables',
      description: 'Two standard tape recorder cables.',
      spatial: { parentNodeId: 'boombox', relation: 'behind' },
    });
    cables.hidden = 'lookable';

    const directResult = await fixture.run('look cables');
    expect(directResult.messages.at(-1)).toBe("You don't see any cables here.");
    expect(fixture.scene.isHiddenEntityRevealed(cables)).toBe(false);

    const relationResult = await fixture.run('look behind boombox');
    expect(relationResult.messages.at(-1)).toBe(
      fixture.game.text('parser.relation_discovered_contents', {
        Relation: 'Behind',
        target: 'Boombox',
        items: 'audio cables',
      })
    );
    expect(fixture.scene.isHiddenEntityRevealed(cables)).toBe(true);

    const revealedResult = await fixture.run('look cables');
    expect(revealedResult.messages.at(-1)).toBe('Two standard tape recorder cables.');
  });

  it('limits LOOK and EXAMINE contents to first-level titled spatial children', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('sofa', {
      title: 'Sofa',
      description: 'A tired sofa.',
      details: 'A tired sofa with suspiciously arranged pillows.',
    });
    fixture.textAssets.setObject('sofa', {
      title: 'Sofa',
      description: 'A tired sofa.',
      details: 'A tired sofa with suspiciously arranged pillows.',
    });
    fixture.addEntity('right_pillow', {
      title: 'right pillow',
      description: 'A sofa pillow.',
      details: 'The right pillow is lumpy.',
      spatial: { parentNodeId: 'sofa', relation: 'on' },
    });
    fixture.textAssets.setObject('right_pillow', {
      title: 'right pillow',
      description: 'A sofa pillow.',
      details: 'The right pillow is lumpy.',
      synonyms: ['right pillow', 'pillow'],
    });
    const remote = fixture.addEntity('tv_rc', {
      title: 'TV remote',
      description: 'A rectangular Sony remote control.',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: 'right_pillow', relation: 'under' },
    });
    fixture.textAssets.setObject('tv_rc', {
      title: 'TV remote',
      description: 'A rectangular Sony remote control.',
      synonyms: ['remote', 'rc'],
    });
    remote.hidden = 'lookable';

    const lookSofa = await fixture.run('look sofa');
    expect(lookSofa.messages.at(-1)).toBe(
      [
        'A tired sofa.',
        fixture.game.text('parser.relation_contents', {
          Relation: 'On',
          target: 'Sofa',
          items: 'right pillow',
        }),
      ].join('\n')
    );
    expect(fixture.scene.isHiddenEntityRevealed(remote)).toBe(false);

    const examineSofa = await fixture.run('examine sofa');
    expect(examineSofa.messages.at(-1)).toBe(
      [
        'A tired sofa with suspiciously arranged pillows.',
        fixture.game.text('parser.relation_contents', {
          Relation: 'On',
          target: 'Sofa',
          items: 'right pillow',
        }),
      ].join('\n')
    );
    expect(fixture.scene.isHiddenEntityRevealed(remote)).toBe(false);

    const lookPillow = await fixture.run('look right pillow');
    expect(lookPillow.messages.at(-1)).toBe(
      [
        'A sofa pillow.',
        fixture.game.text('parser.relation_discovered_contents', {
          Relation: 'Under',
          target: 'right pillow',
          items: 'TV remote',
        }),
      ].join('\n')
    );
    expect(fixture.scene.isHiddenEntityRevealed(remote)).toBe(true);
  });

  it('does not reveal a direct hidden examinable target through LOOK or EXAMINE', async () => {
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
    expect(examineResult.messages.at(-1)).toBe("You don't see any cache here.");
    expect(fixture.scene.isHiddenEntityRevealed(cache)).toBe(false);
  });

  it('reveals examinable hidden relation contents by examining their anchor', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'Cassette recorder.',
      details: 'A dusty cassette recorder.',
    } as any);
    fixture.textAssets.setObject('boombox', {
      title: 'Boombox',
      description: 'Cassette recorder.',
      details: 'A dusty cassette recorder.',
    });
    const cables = fixture.addEntity('audio_cables', {
      title: 'audio cables',
      description: 'Two standard tape recorder cables.',
      spatial: { parentNodeId: 'boombox', relation: 'behind' },
    });
    cables.hidden = 'examinable';

    const lookResult = await fixture.run('look cables');
    expect(lookResult.messages.at(-1)).toBe("You don't see any cables here.");
    expect(fixture.scene.isHiddenEntityRevealed(cables)).toBe(false);

    const examineAnchorResult = await fixture.run('examine boombox');
    expect(examineAnchorResult.messages.at(-1)).toBe(
      [
        'A dusty cassette recorder.',
        fixture.game.text('parser.relation_contents', {
          Relation: 'Behind',
          target: 'Boombox',
          items: 'audio cables',
        }),
      ].join('\n')
    );
    expect(fixture.scene.isHiddenEntityRevealed(cables)).toBe(true);

    const revealedResult = await fixture.run('look cables');
    expect(revealedResult.messages.at(-1)).toBe('Two standard tape recorder cables.');
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

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_inventory', { item: 'key', target: 'Drawer' })
    );
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

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_under', { item: 'key', target: 'Desk' })
    );
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

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_inventory', { item: 'key', target: 'upper drawer' })
    );
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

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_inventory', {
        item: 'cassette',
        target: 'Tape recorder',
      })
    );
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
    expect(resolved.messages.at(-1)).toBe(fixture.game.text('parser.put_no_place'));
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
    expect(first.messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_inventory', { item: 'cassette', target: 'Boombox' })
    );

    fixture.game.inventory.push(cassette);
    const selfTarget = await fixture.run('put compact cassette into record');
    expect(selfTarget.messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_inventory', { item: 'cassette', target: 'Boombox' })
    );
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
    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.put_target_full_in', { target: 'Boombox' })
    );
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
    expect(messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_under', {
        item: 'Compact cassette',
        target: 'Chair',
      })
    );
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
    expect(messages.at(-1)).toBe(fixture.game.text('parser.put_no_place'));
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
    musicCassette.x = 200;
    musicCassette.y = 0;
    const floor = fixture.addWalkbox('Walk_main', 'in');
    floor.components = [
      {
        type: 'Surface',
        relation: 'in',
        capacity: 10,
        groups: [],
        items: [{ id: 'music_cassette', x: 5, y: 0 }],
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
    expect(messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_under', {
        item: 'Compact cassette',
        target: 'Chair',
      })
    );
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
    expect(messages.at(-1)).toBe(
      fixture.game.text('engine.too_far_from_entity', { target: "Cassette 'Music'" })
    );
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

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_inventory', {
        item: 'cassette_held',
        target: 'Tape recorder',
      })
    );
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
    expect(resolved.messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_inventory', {
        item: 'cassette_b',
        target: 'Tape recorder',
      })
    );
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
    expect(resolved.messages.at(-1)).toBe(
      fixture.game.text('parser.put_target_full_in', { target: 'Tape recorder' })
    );
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
      fixture.game.text('parser.put_success_inventory', {
        item: 'cassette_a',
        target: 'Tape recorder',
      }),
      fixture.game.text('parser.put_success_inventory', {
        item: 'cassette_b',
        target: 'Tape recorder',
      }),
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
      fixture.game.text('parser.put_success_inventory', { item: 'blue_pill', target: 'Box' }),
      fixture.game.text('parser.put_success_inventory', { item: 'red_pill', target: 'Box' }),
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

    expect(result.messages).toEqual([
      fixture.game.text('parser.put_success_inventory', {
        item: 'music_cassette',
        target: 'Boombox',
      }),
    ]);
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

    expect(result.messages).toEqual([
      fixture.game.text('parser.put_success_inventory', {
        item: 'yellow_paper',
        target: 'upper drawer',
      }),
    ]);
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

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('engine.too_far_from_entity', { target: 'Tray' })
    );
  });

  it('reports missing storage before distance for PUT into a distant non-container target', async () => {
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

    expect(result.messages.at(-1)).toBe(fixture.game.text('parser.put_no_place'));
    expect(result.pendingIntent).toBeNull();
    expect(fixture.game.inventory).toContain(paper);
    expect(fixture.scene.entities).toContain(cassette);
  });

  it('reports missing storage before distance for PUT into a distant visible target synonym', async () => {
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

    expect(result.messages.at(-1)).toBe(fixture.game.text('parser.put_no_place'));
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

    expect(messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_under', {
        item: 'Compact cassette',
        target: 'Chair',
      })
    );
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

    expect(messages.at(-1)).toBe(
      fixture.game.text('engine.too_far_from_entity', { target: 'Desk' })
    );
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
    const expectedFloorPut = fixture.game.text('parser.put_success_surface', {
      item: 'key',
      target: fixture.game.text('engine.floor_label'),
    });

    const floorResult = await fixture.run('put key on floor');
    expect(floorResult.messages.at(-1)).toBe(expectedFloorPut);

    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);
    const groundResult = await fixture.run('put key on ground');
    expect(groundResult.messages.at(-1)).toBe(expectedFloorPut);
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

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_surface', {
        item: 'key',
        target: fixture.game.text('engine.floor_label'),
      })
    );
  });

  it('describes the current walkbox pseudo-floor before a real Floor object for LOOK', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 5, 5);
    const floorZone = fixture.addWalkbox('FloorZone');
    floorZone.components = [
      { type: 'Surface', relation: 'in', capacity: 4, groups: [], items: [] },
    ];
    fixture.textAssets.setObject('FloorZone', {
      description: 'The floor under your feet is scuffed.',
    });
    fixture.addEntity('real_floor', {
      title: 'Floor',
      description: 'A real floor object.',
    });

    const result = await fixture.run('look floor');

    expect(result.messages.at(-1)).toBe('The floor under your feet is scuffed.');
  });

  it('falls back to a real Floor object when the current pseudo-floor has no LOOK description', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 5, 5);
    const floorZone = fixture.addWalkbox('FloorZone');
    floorZone.components = [
      { type: 'Surface', relation: 'in', capacity: 4, groups: [], items: [] },
    ];
    fixture.addEntity('real_floor', {
      title: 'Floor',
      description: 'A real floor object.',
    });

    const result = await fixture.run('look floor');

    expect(result.messages.at(-1)).toBe('A real floor object.');
  });

  it('uses the default floor description when neither pseudo-floor nor real Floor can describe LOOK', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 5, 5);
    const floorZone = fixture.addWalkbox('FloorZone');
    floorZone.components = [
      { type: 'Surface', relation: 'in', capacity: 4, groups: [], items: [] },
    ];

    const result = await fixture.run('look floor');

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.look_default_object', {
        target: fixture.game.text('engine.floor_label'),
      })
    );
  });

  it('describes the current walkbox pseudo-floor details before a real Floor object for EXAMINE', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 5, 5);
    const floorZone = fixture.addWalkbox('FloorZone');
    floorZone.components = [
      { type: 'Surface', relation: 'in', capacity: 4, groups: [], items: [] },
    ];
    fixture.textAssets.setObject('FloorZone', {
      details: 'Tiny scratches show where furniture has been dragged around.',
    });
    fixture.addEntity('real_floor', {
      title: 'Floor',
      description: 'A real floor object.',
    });
    fixture.textAssets.setObject('real_floor', {
      title: 'Floor',
      description: 'A real floor object.',
      details: 'Real floor details.',
    });

    const result = await fixture.run('examine floor');

    expect(result.messages.at(-1)).toBe(
      'Tiny scratches show where furniture has been dragged around.'
    );
  });

  it('falls back to a real Floor object when the current pseudo-floor has no EXAMINE details', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 5, 5);
    const floorZone = fixture.addWalkbox('FloorZone');
    floorZone.components = [
      { type: 'Surface', relation: 'in', capacity: 4, groups: [], items: [] },
    ];
    fixture.addEntity('real_floor', {
      title: 'Floor',
      description: 'A real floor object.',
    });
    fixture.textAssets.setObject('real_floor', {
      title: 'Floor',
      description: 'A real floor object.',
      details: 'Real floor details.',
    });

    const result = await fixture.run('examine floor');

    expect(result.messages.at(-1)).toBe('Real floor details.');
  });

  it('uses the default floor description when neither pseudo-floor nor real Floor can describe EXAMINE', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 5, 5);
    const floorZone = fixture.addWalkbox('FloorZone');
    floorZone.components = [
      { type: 'Surface', relation: 'in', capacity: 4, groups: [], items: [] },
    ];

    const result = await fixture.run('examine floor');

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.look_default_object', {
        target: fixture.game.text('engine.floor_label'),
      })
    );
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

    expect(messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_surface', {
        item: 'Key',
        target: fixture.game.text('engine.floor_label'),
      })
    );
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

    expect(dropMessage).toBe(
      fixture.game.text('parser.put_success_surface', {
        item: 'Compact cassette',
        target: fixture.game.text('engine.floor_label'),
      })
    );
    expect(takeMessages.at(-1)).toBe(
      fixture.game.text('parser.take_pickup_success', { item: 'Compact cassette' })
    );
    expect(fixture.game.inventory).toContain(compactCassette);
    expect(fixture.game.inventory).not.toContain(musicCassette);
  });

  it('DROP moves the held item instance, not a stale scene duplicate with the same id', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const heldCassette = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'The held cassette.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(heldCassette);
    fixture.game.inventory.push(heldCassette);
    const staleDuplicate = fixture.addEntity('compact_cassette', {
      title: 'Compact cassette',
      description: 'A stale scene duplicate.',
      components: [{ type: 'Item' }],
    });
    staleDuplicate.x = 100;
    staleDuplicate.y = 100;
    const floor = fixture.addWalkbox('Walk_main');
    floor.poly = [
      { x: -40, y: -40 },
      { x: 40, y: -40 },
      { x: 40, y: 40 },
      { x: -40, y: 40 },
    ];
    floor.components = [{ type: 'Surface', relation: 'in', capacity: 4, groups: [], items: [] }];

    const result = await fixture.run('drop cassette');

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_surface', {
        item: 'compact_cassette',
        target: fixture.game.text('engine.floor_label'),
      })
    );
    expect(fixture.game.inventory).toEqual([]);
    expect((heldCassette as any).spatial).toEqual({ parentNodeId: 'Walk_main', relation: 'on' });
    expect((staleDuplicate as any).spatial).toEqual({});
    expect(staleDuplicate.x).toBe(100);
    expect(staleDuplicate.y).toBe(100);
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

    expect(messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_inventory', {
        item: 'Key',
        target: 'Drawer front',
      })
    );
    expect(tray.components?.[0]?.items?.some((item: any) => item.id === key.name)).toBe(true);
    expect(floor.components?.[0]?.items?.some((item: any) => item.id === key.name)).toBe(false);
  });

  it('prefers an IN surface inside the active subscene before the floor for DROP', async () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const drawerZone = fixture.addTriggerbox('DrawerZone', {
      title: 'middle drawer',
      description: 'A middle drawer.',
      components: [{ type: 'Subscene', targetGroupId: '' }],
    });
    const tray = fixture.addEntity('drawer_surface', {
      title: null,
      description: 'The inside of the drawer.',
      disabled: true,
      spatial: { parentNodeId: 'DrawerZone', relation: 'in' },
      components: [{ type: 'Surface', relation: 'in', capacity: 2, groups: [], items: [] }],
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

    expect(messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_inventory', {
        item: 'Key',
        target: 'middle drawer',
      })
    );
    expect(tray.components?.[0]?.items?.some((item: any) => item.id === key.name)).toBe(true);
    expect(floor.components?.[0]?.items?.some((item: any) => item.id === key.name)).toBe(false);
    expect((key as any).spatial).toEqual({ parentNodeId: 'drawer_surface', relation: 'on' });
  });

  it('puts a held item onto a far target inside the active subscene', async () => {
    const fixture = createGameSemanticFixture();
    fixture.addPlayer('Hero', 0, 0);
    const drawerZone = fixture.addTriggerbox('DrawerZone', {
      title: 'Drawer front',
      description: 'A drawer front.',
      components: [{ type: 'Subscene', targetGroupId: '' }],
    });
    const tray = fixture.addEntity('tray', {
      title: 'Tray',
      description: 'A tray.',
      disabled: true,
      spatial: { parentNodeId: 'DrawerZone', relation: 'in' },
      components: [{ type: 'Surface', relation: 'on', capacity: 2, groups: [], items: [] }],
    });
    tray.x = 500;
    tray.y = 500;
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A key.',
      components: [{ type: 'Item' }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);

    ComponentSystem.handleActivation(drawerZone, fixture.scene);

    const messages = await runSemanticParser(fixture, 'put key on tray');

    expect(messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_surface', { item: 'Key', target: 'Tray' })
    );
    expect(tray.components?.[0]?.items?.some((item: any) => item.id === key.name)).toBe(true);
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
      fixture.game.text('parser.take_pickup_success', { item: 'Compact cassette' }),
      fixture.game.text('parser.take_pickup_success', { item: "Cassette 'Music'" }),
    ]);
    expect(inventoryNames(fixture)).toEqual(['compact_cassette', 'music_cassette']);
  });

  it('reports distance for TAKE ALL when plural matches are visible but not currently takable', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    const orangePaper = fixture.addEntity('orange_paper', {
      title: 'Orange paper',
      description: 'An orange paper.',
      components: [{ type: 'Item' }],
    });
    const yellowPaper = fixture.addEntity('yellow_paper', {
      title: 'Yellow paper',
      description: 'A yellow paper.',
      components: [{ type: 'Item' }],
    });
    orangePaper.x = 250;
    yellowPaper.x = 260;

    const result = await fixture.run('take all papers');

    expect(result.messages).toEqual([
      fixture.game.text('engine.too_far_from_entity', { target: 'Orange paper' }),
    ]);
    expect(inventoryNames(fixture)).toEqual([]);
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

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.take_pickup_success', { item: 'Compact cassette' })
    );
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
      fixture.game.text('parser.take_pickup_success', { item: 'Cassette A' }),
      fixture.game.text('parser.take_pickup_success', { item: 'Cassette B' }),
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
      fixture.game.text('parser.take_pickup_success', { item: 'Blue pill' }),
      fixture.game.text('parser.take_pickup_success', { item: 'Red pill' }),
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

    expect(result.messages).toEqual([
      fixture.game.text('parser.take_pickup_success', { item: 'Blue pill' }),
    ]);
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
      fixture.game.text('parser.take_pickup_success', { item: 'Cassette A' }),
      fixture.game.text('parser.take_pickup_success', { item: 'Cassette B' }),
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
      fixture.game.text('parser.take_pickup_success', { item: 'Cassette A' }),
      fixture.game.text('parser.take_pickup_success', { item: 'Cassette B' }),
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

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.take_pickup_success', { item: 'pencil' })
    );
    expect(fixture.game.inventory.map((entity: any) => entity.name)).toContain('pencil_b');
    expect(fixture.game.inventory.map((entity: any) => entity.name)).not.toContain('pencil_a');
  });

  it('resolves numbered TAKE FROM container clarification without repeating the prompt', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('upper_drawer', {
      title: 'upper drawer',
      description: 'The upper drawer.',
    });
    fixture.addEntity('middle_drawer', {
      title: 'middle drawer',
      description: 'The middle drawer.',
    });
    fixture.addEntity('upper_drawer_surface', {
      title: 'Upper drawer tray',
      description: 'A tray inside the upper drawer.',
      spatial: { parentNodeId: 'upper_drawer', relation: 'in' },
      components: [
        { type: 'Surface', capacity: 5, groups: [], items: [{ id: 'id_card', x: 0, y: 0 }] },
      ],
    });
    fixture.addEntity('middle_drawer_surface', {
      title: 'Middle drawer tray',
      description: 'A tray inside the middle drawer.',
      spatial: { parentNodeId: 'middle_drawer', relation: 'in' },
      components: [{ type: 'Surface', capacity: 5, groups: [], items: [] }],
    });
    fixture.addEntity('id_card', {
      title: 'ID card',
      description: 'A plastic ID card.',
      components: [{ type: 'Item', ignoreDistance: true }],
      spatial: { parentNodeId: 'upper_drawer_surface', relation: 'on' },
    });

    const ambiguous = await fixture.run('take id card from drawer');

    expect(ambiguous.messages.at(-1)).toContain('Which container do you mean: 1: upper drawer');
    expect(ambiguous.messages.at(-1)).toContain('2: middle drawer');
    expect(ambiguous.pendingIntent).toBe('take');

    const resolved = await fixture.run('1');

    expect(resolved.messages.at(-1)).toBe(
      fixture.game.text('parser.take_pickup_success', { item: 'ID card' })
    );
    expect(resolved.pendingIntent).toBeNull();
    expect(inventoryNames(fixture)).toEqual(['id_card']);
  });

  it('refreshes scope between LLM plan actions so open drawer then take sees revealed items', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero', 0, 0);
    fixture.addEntity('upper_drawer', {
      title: 'upper drawer',
      description: 'The upper drawer.',
      components: [{ type: 'Switch', state: 1, clearlyOpenable: true }],
    });
    fixture.addEntity('id_card', {
      title: 'ID card',
      description: 'A plastic ID card.',
      synonyms: ['id', 'badge'],
      components: [{ type: 'Item', ignoreDistance: true }],
      spatial: { parentNodeId: 'upper_drawer', relation: 'in' },
    });
    const parser = fixture.parser as any;
    const initialWorldModel = parser.worldModelBuilder.build('open drawer and take id', null);
    parser.activeWorldModel = initialWorldModel;
    parser.activeScope = initialWorldModel.scope;
    expect(initialWorldModel.scope.takable.map((entity: any) => entity.name)).not.toContain(
      'id_card'
    );

    const result = JSON.parse(
      parser.runParserCore({
        stage: 'llm-v3',
        output: {
          kind: 'plan',
          actions: [
            { type: 'openTarget', target: 'upper drawer' },
            { type: 'takeTarget', target: 'ID card', anchor: null, relation: null },
          ],
        },
        debug: {
          rawInput: 'open drawer and take id',
          normalizedInput: 'OPEN DRAWER AND TAKE ID',
          verb: 'LLM',
          noun: '',
        },
      })
    );

    expect(result.outcomes.map((outcome: any) => outcome.code)).toEqual([
      'switch_opened',
      'item_taken',
    ]);
    expect(inventoryNames(fixture)).toEqual(['id_card']);
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
    expect(look.messages.at(-1)).toBe(
      fixture.game.text('parser.relation_contents', {
        Relation: 'In',
        target: 'Cabinet',
        items: 'Book A',
      })
    );

    const result = await fixture.run('take book b from cabinet');

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.take_pickup_success', { item: 'Book B' })
    );
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

    expect(result.messages).toEqual([
      fixture.game.text('parser.take_pickup_success', { item: 'Book B' }),
      fixture.game.text('parser.take_pickup_success', { item: 'Book A' }),
    ]);
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
    expect(look.messages.at(-1)).toBe(
      fixture.game.text('parser.relation_contents', {
        Relation: 'On',
        target: 'Book A',
        items: 'Book B',
      })
    );

    const result = await fixture.run('take book b from book a');

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.take_pickup_success', { item: 'Book B' })
    );
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

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('engine.closed_container', { target: 'Drawer' })
    );
  });
});
