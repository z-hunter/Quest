import { describe, expect, it } from 'vitest';
import { createParserFixture } from '../fixtures/parserFactory';

describe('SAY command pre-parser handling', () => {
  it('routes dash-prefixed speech without invoking normal parser commands', async () => {
    const fixture = createParserFixture();
    const player = fixture.addPlayer('Hero');
    fixture.textAssets.setObject(player.name, { title: 'Miles', description: 'The protagonist.' });
    const calls: string[] = [];
    (fixture.game as any).sayAsPlayer = async (text: string) => {
      calls.push(text);
      fixture.logs.push(`You: ${text}`);
    };

    const result = await fixture.run('- Hello there!');

    expect(calls).toEqual(['Hello there!']);
    expect(result.logs).toEqual(['You: Hello there!']);
    expect(result.messages).toEqual([]);
  });

  it('routes SAY text while preserving the original free text casing', async () => {
    const fixture = createParserFixture();
    fixture.addPlayer('Hero');
    const calls: string[] = [];
    (fixture.game as any).sayAsPlayer = async (text: string) => {
      calls.push(text);
    };

    await fixture.run('SAY Open the pod bay doors, please.');

    expect(calls).toEqual(['Open the pod bay doors, please.']);
  });
});
