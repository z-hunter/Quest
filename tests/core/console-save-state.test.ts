import { afterEach, describe, expect, it, vi } from 'vitest';
import { Console } from '../../src/core/Console';
import { ShadowLogger } from '../../src/mechanics/slm/ShadowLogger';

describe('Console save state', () => {
  afterEach(() => {
    ShadowLogger.isLoggingEnabled = true;
  });

  it('round-trips the buffer, player history, and runtime command settings', () => {
    const source = new Console({});
    source.log('A remembered output line');
    source.addHistory('LOOK');
    source.parserPeekEnabled = true;
    source.parserPeekPmEnabled = true;
    source.parserPeekNavEnabled = true;
    source.parserStage1Enabled = false;
    source.parserLlmEnabled = true;
    source.parserCascade1ForceLlm = true;
    ShadowLogger.isLoggingEnabled = false;

    const state = source.toJSON();
    const restored = new Console({});
    restored.fromJSON(state);

    expect(restored.buffer).toEqual(source.buffer);
    expect(restored.buffer).not.toBe(source.buffer);
    expect(restored.history).toEqual(['LOOK']);
    expect(restored.parserPeekEnabled).toBe(true);
    expect(restored.parserPeekPmEnabled).toBe(true);
    expect(restored.parserPeekNavEnabled).toBe(true);
    expect(restored.parserStage1Enabled).toBe(false);
    expect(restored.parserLlmEnabled).toBe(true);
    expect(restored.parserCascade1ForceLlm).toBe(true);
    expect(ShadowLogger.isLoggingEnabled).toBe(false);
  });

  it('accepts legacy console state without settings', () => {
    const restored = new Console({});
    restored.fromJSON({ buffer: [], history: ['WAIT'], isOpen: false });

    expect(restored.history).toEqual(['WAIT']);
    expect(restored.parserStage1Enabled).toBe(true);
    expect(restored.parserLlmEnabled).toBe(false);
  });

  it('routes #SAVE and #LOAD names to the game save manager', async () => {
    const save = vi.fn(async (name: string) => ({ metadata: { name } }));
    const load = vi.fn(async (name: string) => ({ metadata: { name } }));
    const consoleInstance = new Console({ saveManager: { save, load } });

    consoleInstance.processCommand('#SAVE first slot');
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith('first slot'));
    consoleInstance.processCommand('#LOAD first slot');
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith('first slot'));

    expect(consoleInstance.buffer.some((line) => line.text === "Game saved as 'first slot'.")).toBe(
      true
    );
    expect(
      consoleInstance.buffer.some((line) => line.text === "Game loaded from 'first slot'.")
    ).toBe(true);
  });
});
