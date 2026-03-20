import { describe, expect, it } from 'vitest';
import { createParserFixture } from '../fixtures/parserFactory';

describe('Parser core contracts', () => {
  it('returns the generic unknown response on pre-API handoff when stage2 is disabled', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();

    const result = await fixture.run('sing a song');

    expect(result.messages.at(-1)).toBe("I don't understand.");
  });

  it('returns the generic unknown response on post-API escalation', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer();
    const mystery = fixture.addEntity('mystery_box', {
      title: 'Mystery Box',
    });
    mystery.description = '';
    fixture.textAssets.setObject('mystery_box', {
      title: 'Mystery Box',
    });

    const result = await fixture.run('examine mystery');

    expect(result.messages.at(-1)).toBe("I don't understand.");
  });

  it('stops a linear plan after a failed validation step', async () => {
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
    expect(fixture.game.inventory).toHaveLength(0);
    expect(fixture.game.sceneManager.currentScene).toBe(fixture.scene);
  });
});
