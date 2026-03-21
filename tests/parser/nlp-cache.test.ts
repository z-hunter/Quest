import { afterEach, describe, expect, it, vi } from 'vitest';
import { NlpCascade } from '../../src/mechanics/NlpCascade';
import { Nlp } from '@nlpjs/nlp';

function createStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
}

describe('NlpCascade model cache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error test cleanup
    delete globalThis.window;
  });

  it('stores a trained model and reuses the cache on the next initialize', async () => {
    const localStorage = createStorage();
    // @ts-expect-error minimal window mock for node test env
    globalThis.window = { localStorage };

    const trainingData = {
      look: ['look chair'],
      take: ['take key'],
    };
    const getTextAssets = () =>
      ({
        readParserTrainingAsset: async () => trainingData,
      }) as any;

    const trainSpy = vi.spyOn(Nlp.prototype as any, 'train');

    const firstCascade = new NlpCascade(getTextAssets);
    await firstCascade.initialize();

    expect(trainSpy).toHaveBeenCalledTimes(1);
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);

    const secondCascade = new NlpCascade(getTextAssets);
    await secondCascade.initialize();

    expect(localStorage.getItem).toHaveBeenCalled();
    expect(trainSpy).toHaveBeenCalledTimes(1);
  });
});
