import { describe, expect, it } from 'vitest';
import { validateSlmCompatibilityManifest } from '../../src/mechanics/slm/SlmInferenceEngine';
import {
  SLM_VOCABULARY_SHA256,
  SLM_VOCABULARY_VERSION,
} from '../../src/mechanics/slm/SlmVocabulary';

const valid = {
  schemaVersion: 1,
  modelId: 'slm_routine_v1',
  vocabularyVersion: SLM_VOCABULARY_VERSION,
  vocabularySha256: SLM_VOCABULARY_SHA256,
  onnxOpset: 17,
  maxDynamicEntities: 1948,
  inputs: [{ name: 'input_ids', dtype: 'int32', shape: ['batch', 256] }],
  outputs: [{ name: 'output_ids', dtype: 'int32', shape: ['batch', 64] }],
};

describe('SLM compatibility manifest', () => {
  it('accepts the runtime tensor and vocabulary contract', () => {
    expect(validateSlmCompatibilityManifest(valid).modelId).toBe('slm_routine_v1');
  });
  it('rejects a model trained with another vocabulary', () => {
    expect(() =>
      validateSlmCompatibilityManifest({ ...valid, vocabularySha256: 'stale' })
    ).toThrowError(/vocabulary is incompatible/);
  });
});
