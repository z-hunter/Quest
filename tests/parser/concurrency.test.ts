import { describe, expect, it, vi } from 'vitest';
import { createParserFixture } from '../fixtures/parserFactory';

describe('Parser concurrency', () => {
  it('waits for a delayed command before starting the next parse', async () => {
    const fixture = createParserFixture();
    fixture.game.console.parserStage2Enabled = true;
    (fixture.parser as any).isHandoffEnvelope = () => true;

    let releaseStage2!: () => void;
    const stage2Gate = new Promise<null>((resolve) => {
      releaseStage2 = () => resolve(null);
    });
    const stage2 = vi.spyOn(fixture.parser.nlpCascade, 'parse').mockReturnValue(stage2Gate);

    const first = fixture.parser.parse('look');
    await vi.waitFor(() => expect(stage2).toHaveBeenCalledTimes(1));
    const second = fixture.parser.parse('examine');

    expect(stage2).toHaveBeenCalledTimes(1);
    expect(fixture.parser.activeWorldModel?.context.rawInput).toBe('look');
    releaseStage2();
    await Promise.all([first, second]);

    expect(stage2).toHaveBeenCalledTimes(2);
  });

  it('continues processing queued commands after a SAY callback rejects', async () => {
    const fixture = createParserFixture();
    const sayAsPlayer = (fixture.game.sayAsPlayer = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(undefined));

    const first = fixture.parser.parse('say first');
    const second = fixture.parser.parse('say second');
    const results = await Promise.allSettled([first, second]);

    expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled']);
    expect(sayAsPlayer.mock.calls).toEqual([['first'], ['second']]);
  });
});
