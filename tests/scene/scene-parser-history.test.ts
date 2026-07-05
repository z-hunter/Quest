import { describe, expect, it } from 'vitest';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('Scene parser mini-history', () => {
  it('stores the last 8 turns and truncates responses to 340 characters', () => {
    const fixture = createSceneFixture();

    for (let index = 1; index <= 9; index += 1) {
      fixture.scene.addParserRecentTurn(`command ${index}`, `response ${index}`);
    }
    fixture.scene.addParserRecentTurn('long response', 'x'.repeat(350));

    const turns = fixture.scene.getParserRecentTurns();

    expect(turns).toHaveLength(8);
    expect(turns[0]).toEqual({ command: 'command 3', response: 'response 3' });
    expect(turns[7]).toEqual({ command: 'long response', response: 'x'.repeat(340) });
  });

  it('clears when leaving a scene and later returning to it', () => {
    const fixture = createSceneFixture('scene-a');
    const sceneA = fixture.scene;
    const sceneB = fixture.addScene('scene-b', 'Scene B');

    sceneA.addParserRecentTurn('look', 'Scene A response.');
    sceneB.addParserRecentTurn('look', 'Scene B response.');

    fixture.game.sceneManager.switchTo('scene-b');
    expect(sceneA.getParserRecentTurns()).toEqual([
      { command: 'look', response: 'Scene A response.' },
    ]);
    expect(sceneB.getParserRecentTurns()).toEqual([]);

    sceneB.addParserRecentTurn('examine', 'Scene B second response.');
    fixture.game.sceneManager.switchTo('scene-a');

    expect(sceneA.getParserRecentTurns()).toEqual([]);
    expect(sceneB.getParserRecentTurns()).toEqual([
      { command: 'examine', response: 'Scene B second response.' },
    ]);
  });
});
