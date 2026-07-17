import { describe, expect, it } from 'vitest';
import {
  ContractValidationError,
  assertNpcPuppetMasterResponse,
  assertParserCascadeEnvelope,
  assertSceneData,
  assertTextAssetData,
} from '../../src/contracts/runtimeSchemas';

describe('runtime contract schemas', () => {
  it('accepts a minimal valid scene', () => {
    expect(() =>
      assertSceneData({
        id: 'room',
        name: 'Room',
        entities: [],
        walkbox: [],
        triggerboxes: [],
        scaling: { enabled: false, min: 1, max: 1, horizon: 0, front: 1 },
      })
    ).not.toThrow();
  });

  it('reports precise scene paths', () => {
    expect(() =>
      assertSceneData({ id: '', name: 'Room', entities: [], walkbox: [], triggerboxes: [] })
    ).toThrowError(ContractValidationError);
    try {
      assertSceneData({ id: '', name: 'Room', entities: [], walkbox: [], triggerboxes: [] });
    } catch (error) {
      expect((error as ContractValidationError).issues.map((issue) => issue.path)).toContain(
        '$.scaling'
      );
    }
  });

  it('validates parser envelopes and their action discriminants', () => {
    expect(() =>
      assertParserCascadeEnvelope({
        stage: 'llm-v3',
        output: { kind: 'plan', actions: [{ type: 'not_a_tool' }] },
        debug: { rawInput: 'x', normalizedInput: 'x', verb: '', noun: '' },
      })
    ).toThrowError(/supported parser action/);
  });

  it('validates NPC structured-plan DSL', () => {
    expect(() =>
      assertNpcPuppetMasterResponse({
        kind: 'pm_response',
        plans: [{ npcId: 'guard', steps: [{ type: 'WAIT', ms: -1 }] }],
      })
    ).toThrowError(/non-negative/);
  });

  it('rejects malformed known Text Asset fields', () => {
    expect(() => assertTextAssetData({ title: { unexpected: true } }, 'TA')).toThrowError(/title/);
  });
});
