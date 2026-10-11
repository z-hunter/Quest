import { describe, expect, it } from 'vitest';
import { validateSlmCompatibilityManifest } from '../../src/mechanics/slm/SlmInferenceEngine';
import {
  SLM_VOCABULARY_SHA256,
  SLM_VOCABULARY_VERSION,
} from '../../src/mechanics/slm/SlmVocabulary';

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { SLM_TOKENS } from '../../src/mechanics/slm/SlmVocabulary';

const valid = {
  schemaVersion: 1,
  modelId: 'slm_routine_v1',
  vocabularyVersion: SLM_VOCABULARY_VERSION,
  vocabularySha256: SLM_VOCABULARY_SHA256,
  modelSha256: '932e0c7ad289a3f258e78f1cf0ef3b192615224733e4a14f8e3893b87246ceeb',
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
  it('keeps Python pipeline TOKENS in sync with SLM_TOKENS', () => {
    const pipelinePath = path.resolve(__dirname, '../../scripts/slm/pipeline.py');
    const content = fs.readFileSync(pipelinePath, 'utf8');
    const tokensMatch = content.match(/TOKENS = \{([\s\S]*?)\}/);
    if (!tokensMatch) throw new Error('Could not find TOKENS in pipeline.py');

    const pyTokens: Record<string, number> = {};
    const pairRegex = /"(\w+)":\s*(\d+)/g;
    let match;
    while ((match = pairRegex.exec(tokensMatch[1])) !== null) {
      pyTokens[match[1]] = parseInt(match[2], 10);
    }

    expect(pyTokens).toEqual(SLM_TOKENS);
  });
  it('validates that SLM_VOCABULARY_SHA256 is correct', () => {
    const sortedTokens = Object.keys(SLM_TOKENS)
      .sort()
      .reduce((acc: any, key) => {
        acc[key] = (SLM_TOKENS as any)[key];
        return acc;
      }, {});
    const canonicalStr = JSON.stringify(sortedTokens);
    const hash = crypto.createHash('sha256').update(canonicalStr).digest('hex');
    expect(SLM_VOCABULARY_SHA256).toBe(hash);
  });
});
