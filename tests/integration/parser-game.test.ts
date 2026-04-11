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

  it('supports PUT IN object when the object contains a nested surface', async () => {
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
      title: 'Tray',
      description: 'A tray.',
      spatial: { parentNodeId: 'drawer', relation: 'in' },
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });

    const result = await fixture.run('put key in drawer');

    expect(result.messages.at(-1)).toBe('You put the key on the Tray.');
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
      title: 'Tray',
      description: 'A tray inside the drawer.',
      spatial: { parentNodeId: 'drawer', relation: 'in' },
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });

    const result = await fixture.run('put key in drawer');

    expect(result.messages.at(-1)).toBe('You put the key on the Tray.');
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
