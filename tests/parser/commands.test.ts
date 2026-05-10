import { describe, expect, it } from 'vitest';
import { createParserFixture } from '../fixtures/parserFactory';

describe('Parser custom commands', () => {
  it('prompts when TELEPORT is missing its item', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();

    const result = await fixture.run('teleport');

    expect(result.messages.at(-1)).toBe('Teleport with what?');
    expect(result.pendingIntent).toBe('custom');
  });

  it('teleports with the allowed ID card and consumes it', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    const yourId = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your card.',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    fixture.game.sceneManager.scenes.set('test1', fixture.scene);
    fixture.game.sceneManager.sceneRegistry.set('test1', {
      id: 'test1',
      path: 'test1.json',
      name: 'Test Destination',
      title: 'Test Destination',
      sourceData: null,
      lastIndexed: Date.now(),
    });

    const result = await fixture.run('teleport with id');

    expect(result.messages.at(-1)).toBe('You vanish in a flash and arrive somewhere else.');
    expect(fixture.game.inventory).not.toContain(yourId);
  });

  it('rejects TELEPORT with the wrong matching item', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.addEntity('wrong_id', {
      title: 'Someone ID card',
      description: 'Wrong card.',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    fixture.game.sceneManager.scenes.set('test1', fixture.scene);
    fixture.game.sceneManager.sceneRegistry.set('test1', {
      id: 'test1',
      path: 'test1.json',
      name: 'Test Destination',
      title: 'Test Destination',
      sourceData: null,
      lastIndexed: Date.now(),
    });

    const result = await fixture.run('teleport with id');

    expect(result.messages.at(-1)).toBe("That doesn't work.");
  });

  it('parses USE X ON Y and renders the no-effect pair message', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    const idCard = fixture.addEntity('test_id', {
      title: 'Someone ID card',
      description: 'Card.',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    fixture.scene.removeEntity(idCard);
    fixture.game.inventory.push(idCard);
    fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'Recorder.',
    });

    const result = await fixture.run('use id on boombox');

    expect(result.messages.at(-1)).toBe('Using the Someone ID card on the Boombox does nothing.');
  });

  it('prompts when USE is missing required arguments', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();

    const result = await fixture.run('use');

    expect(result.messages.at(-1)).toBe('Use what on what?');
    expect(result.pendingIntent).toBe('custom');
  });

  it('drops a held item onto an available surface', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A key.',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);
    fixture.addEntity('desk', {
      title: 'Desk',
      description: 'A desk.',
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });

    const result = await fixture.run('drop key');

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_surface', { item: 'key', target: 'Desk' })
    );
    expect(fixture.game.inventory).not.toContain(key);
  });

  it('uses the previewed inventory item as default target for LOOK and EXAMINE', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    const book = fixture.addEntity('book', {
      title: 'Book',
      description: 'A thumbed paperback.',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    fixture.textAssets.setObject('book', {
      title: 'Book',
      description: 'A thumbed paperback.',
      details: 'Someone has underlined every pessimistic sentence.',
    });
    fixture.scene.removeEntity(book);
    fixture.game.inventory.push(book);
    fixture.game.openInventoryPreview(book, null);

    const look = await fixture.run('look');
    const examine = await fixture.run('examine');

    expect(look.messages.at(-1)).toBe('A thumbed paperback.');
    expect(examine.messages.at(-1)).toBe('Someone has underlined every pessimistic sentence.');
  });

  it('appends fresh Parser Notes to object LOOK and EXAMINE responses', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.addEntity('sofa', {
      title: 'Sofa',
      description: 'An old sofa.',
      details: 'The sofa has seen better nights.',
    });
    fixture.textAssets.setObject('sofa', {
      title: 'Sofa',
      description: 'An old sofa.',
      details: 'The sofa has seen better nights.',
    });
    fixture.scene.setEntityParserNote('sofa', 'One cushion has a shallow crease.');

    const look = await fixture.run('look sofa');
    const examine = await fixture.run('examine sofa');

    expect(look.messages.at(-1)).toBe('An old sofa.\nOne cushion has a shallow crease.');
    expect(examine.messages.at(-1)).toBe(
      'The sofa has seen better nights.\nOne cushion has a shallow crease.'
    );
  });

  it('does not append stale Parser Notes to object LOOK and EXAMINE responses', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.addEntity('boombox', {
      title: 'Boombox',
      description: 'A radio and cassette recorder.',
      details: 'The controls are worn smooth.',
    });
    fixture.textAssets.setObject('boombox', {
      title: 'Boombox',
      description: 'A radio and cassette recorder.',
      details: 'The controls are worn smooth.',
    });
    fixture.scene.setEntityParserNote('boombox', 'The cassette inside is playing.');
    fixture.scene.markEntityParserNoteNeedsCheck('boombox');

    const look = await fixture.run('look boombox');
    const examine = await fixture.run('examine boombox');

    expect(look.messages.at(-1)).toBe('A radio and cassette recorder.');
    expect(examine.messages.at(-1)).toBe('The controls are worn smooth.');
  });

  it('appends visible inventory contents to object LOOK and EXAMINE responses', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.addEntity('recorder', {
      title: 'Recorder',
      description: 'A recorder.',
      details: 'The recorder has a hungry little tape door.',
      components: [
        { type: 'Inventory', relation: 'in', capacity: 2, groups: [], protected: false, items: [] },
      ],
    });
    fixture.textAssets.setObject('recorder', {
      title: 'Recorder',
      description: 'A recorder.',
      details: 'The recorder has a hungry little tape door.',
    });
    fixture.addEntity('cassette', {
      title: 'Cassette',
      description: 'A tape.',
      components: [{ type: 'Item', ignoreDistance: true }],
      spatial: { parentNodeId: 'recorder', relation: 'in' },
    });

    const look = await fixture.run('look recorder');
    const examine = await fixture.run('examine recorder');

    expect(look.messages.at(-1)).toBe('A recorder.\nIn the Recorder you see: Cassette.');
    expect(examine.messages.at(-1)).toBe(
      'The recorder has a hungry little tape door.\nIn the Recorder you see: Cassette.'
    );
  });

  it('appends inventory contents before Parser Notes for object LOOK and EXAMINE responses', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.addEntity('recorder', {
      title: 'Recorder',
      description: 'A recorder.',
      details: 'The recorder has a hungry little tape door.',
      components: [
        { type: 'Inventory', relation: 'in', capacity: 2, groups: [], protected: false, items: [] },
      ],
    });
    fixture.textAssets.setObject('recorder', {
      title: 'Recorder',
      description: 'A recorder.',
      details: 'The recorder has a hungry little tape door.',
    });
    fixture.addEntity('cassette', {
      title: 'Cassette',
      description: 'A tape.',
      components: [{ type: 'Item', ignoreDistance: true }],
      spatial: { parentNodeId: 'recorder', relation: 'in' },
    });
    fixture.scene.setEntityParserNote('recorder', 'The speaker smells faintly of warm dust.');

    const look = await fixture.run('look recorder');
    const examine = await fixture.run('examine recorder');

    expect(look.messages.at(-1)).toBe(
      'A recorder.\nIn the Recorder you see: Cassette.\nThe speaker smells faintly of warm dust.'
    );
    expect(examine.messages.at(-1)).toBe(
      'The recorder has a hungry little tape door.\nIn the Recorder you see: Cassette.\nThe speaker smells faintly of warm dust.'
    );
  });

  it('does not append empty inventory contents to object LOOK and EXAMINE responses', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.addEntity('recorder', {
      title: 'Recorder',
      description: 'A recorder.',
      details: 'The recorder has a hungry little tape door.',
      components: [
        { type: 'Inventory', relation: 'in', capacity: 2, groups: [], protected: false, items: [] },
      ],
    });
    fixture.textAssets.setObject('recorder', {
      title: 'Recorder',
      description: 'A recorder.',
      details: 'The recorder has a hungry little tape door.',
    });

    const look = await fixture.run('look recorder');
    const examine = await fixture.run('examine recorder');

    expect(look.messages.at(-1)).toBe('A recorder.');
    expect(examine.messages.at(-1)).toBe('The recorder has a hungry little tape door.');
  });

  it('drops the previewed inventory item when DROP has no explicit item', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    const key = fixture.addEntity('key', {
      title: 'Key',
      description: 'A key.',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    fixture.scene.removeEntity(key);
    fixture.game.inventory.push(key);
    fixture.game.openInventoryPreview(key, null);
    fixture.addEntity('desk', {
      title: 'Desk',
      description: 'A desk.',
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });

    const result = await fixture.run('drop');

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_surface', { item: 'key', target: 'Desk' })
    );
    expect(fixture.game.inventory).not.toContain(key);
  });

  it('uses the previewed inventory item for the first missing custom command argument', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    const yourId = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your card.',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    fixture.scene.removeEntity(yourId);
    fixture.game.inventory.push(yourId);
    fixture.game.openInventoryPreview(yourId, null);
    fixture.game.sceneManager.scenes.set('test1', fixture.scene);
    fixture.game.sceneManager.sceneRegistry.set('test1', {
      id: 'test1',
      path: 'test1.json',
      name: 'Test Destination',
      title: 'Test Destination',
      sourceData: null,
      lastIndexed: Date.now(),
    });

    const result = await fixture.run('teleport');

    expect(result.messages.at(-1)).toBe('You vanish in a flash and arrive somewhere else.');
    expect(fixture.game.inventory).not.toContain(yourId);
  });

  it('drops a held item onto a walkbox surface as floor text', async () => {
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
    floor.components = [{ type: 'Surface', capacity: 4, groups: [], items: [] }];

    const result = await fixture.run('drop key');

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_surface', {
        item: 'key',
        target: fixture.game.text('engine.floor_label'),
      })
    );
    expect(fixture.game.inventory).not.toContain(key);
  });

  it('puts a held item into a target inventory container', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    const cassette = fixture.addEntity('cassette', {
      title: 'Cassette',
      description: 'A tape.',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    fixture.scene.removeEntity(cassette);
    fixture.game.inventory.push(cassette);
    const recorder = fixture.addEntity('recorder', {
      title: 'Recorder',
      description: 'A recorder.',
      components: [{ type: 'Inventory', capacity: 2, groups: [], protected: false, items: [] }],
    });

    const result = await fixture.run('put cassette into recorder');

    expect(result.messages.at(-1)).toBe(
      fixture.game.text('parser.put_success_inventory', { item: 'cassette', target: 'Recorder' })
    );
    expect(fixture.game.inventory).not.toContain(cassette);
    expect((recorder.components[0] as { items: string[] }).items).toContain('cassette');
  });

  it('QUIT closes the open inventory preview', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    const idCard = fixture.addEntity('miles_id', {
      title: 'your ID card',
      description: 'Your ID.',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    fixture.scene.removeEntity(idCard);
    fixture.game.inventory.push(idCard);
    fixture.game.inventoryManager.openInventoryPreview(idCard, 'Your ID.');

    const result = await fixture.run('quit');

    expect(result.messages).toEqual([]);
    expect(fixture.game.inventoryManager.getInventoryPreviewEntity()).toBe(null);
  });

  it('EXIT closes the active subscene', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    fixture.scene.activeSubscene = 'desk_subscene';

    const result = await fixture.run('exit');

    expect(result.messages).toEqual([]);
    expect(fixture.scene.activeSubscene).toBe(null);
  });

  it('QUIT in a plain scene escalates to the parser fallback', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();

    const result = await fixture.run('quit');

    expect(result.messages.at(-1)).toBe(fixture.game.text('parser.parse_unknown'));
    expect(fixture.scene.activeSubscene).toBe(null);
    expect(fixture.game.inventoryManager.getInventoryPreviewEntity()).toBe(null);
  });
});
