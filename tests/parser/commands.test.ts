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
});
