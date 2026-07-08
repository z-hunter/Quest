import { describe, it, expect } from 'vitest';
import { SlmInputAdapter } from '../../src/mechanics/slm/SlmInputAdapter';
import { SlmOutputAdapter } from '../../src/mechanics/slm/SlmOutputAdapter';
import { SlmInferenceEngine } from '../../src/mechanics/slm/SlmInferenceEngine';
import { SLM_TOKENS } from '../../src/mechanics/slm/SlmVocabulary';
import type { NpcActorContext } from '../../src/mechanics/npcTypes';

describe('SLM Adapters & Inference Engine', () => {
  const mockContext: NpcActorContext = {
    id: 'npc_1',
    title: 'Bob the Guard',
    objectives: ['Find and take the Key'],
    inventory: {
      available: true,
      itemIds: ['Sword1'],
    },
    actors: [],
    visibleItemIds: ['Key1'],
    knownEntities: [],
    newEvents: [],
    recentEvents: [],
    entities: [
      {
        id: 'Key1',
        title: 'Rusty Key',
        interaction: 'reachable',
        approach: 'already_reachable',
      },
      {
        id: 'Chest1',
        title: 'Heavy Chest',
        interaction: 'blocked',
        approach: 'route_available',
        switch: {
          state: 'closed',
          canOpen: true,
          canClose: false,
          locked: true,
          keyHeld: false,
        },
      },
    ],
  };

  it('tokenizes world context and builds dynamic entity mapping', () => {
    const encoded = SlmInputAdapter.encode(mockContext);

    expect(encoded.tokens[0]).toBe(SLM_TOKENS.START);
    expect(encoded.tokens[encoded.tokens.length - 1]).toBe(SLM_TOKENS.END);

    // Verify entity mapping
    expect(encoded.mapping.idToIndex.has('Sword1')).toBe(true);
    expect(encoded.mapping.idToIndex.has('Key1')).toBe(true);
    expect(encoded.mapping.idToIndex.has('Chest1')).toBe(true);

    const keyIndex = encoded.mapping.idToIndex.get('Key1')!;
    const swordIndex = encoded.mapping.idToIndex.get('Sword1')!;

    expect(keyIndex).toBeGreaterThanOrEqual(SLM_TOKENS.DYNAMIC_ENTITY_BASE);
    expect(encoded.mapping.indexToId.get(keyIndex)).toBe('Key1');

    // Verify target objective flag is generated for Key1 (since objective says "take the Key")
    const tokensArray = Array.from(encoded.tokens);
    const objFlagIndex = tokensArray.indexOf(SLM_TOKENS.FLAG_TARGET_OBJECTIVE);
    expect(objFlagIndex).toBeGreaterThan(-1);
    expect(tokensArray[objFlagIndex + 1]).toBe(keyIndex);

    // Verify inventory held flag for Sword1
    const heldFlagIndex = tokensArray.indexOf(SLM_TOKENS.FLAG_HELD);
    expect(heldFlagIndex).toBeGreaterThan(-1);
    expect(tokensArray[heldFlagIndex + 1]).toBe(swordIndex);
  });

  it('decodes action token sequence back into NpcPlan DSL using dynamic mapping', () => {
    const encoded = SlmInputAdapter.encode(mockContext);
    const keyIndex = encoded.mapping.idToIndex.get('Key1')!;
    const chestIndex = encoded.mapping.idToIndex.get('Chest1')!;

    const mockOutputTokens = [
      SLM_TOKENS.MOVE_TO,
      keyIndex,
      SLM_TOKENS.TAKE,
      keyIndex,
      SLM_TOKENS.MOVE_TO,
      chestIndex,
      SLM_TOKENS.OPEN,
      chestIndex,
    ];

    const result = SlmOutputAdapter.decode(mockOutputTokens, encoded.mapping, 'npc_1');
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      const plan = result.plans[0];
      expect(plan.npcId).toBe('npc_1');
      expect(plan.steps).toEqual([
        { type: 'MOVE_TO', targetId: 'Key1' },
        { type: 'TAKE', targetId: 'Key1' },
        { type: 'MOVE_TO', targetId: 'Chest1' },
        { type: 'OPEN', targetId: 'Chest1' },
      ]);
    }
  });

  it('escalates cleanly when output contains ESCALATE token', () => {
    const encoded = SlmInputAdapter.encode(mockContext);
    const mockOutputTokens = [SLM_TOKENS.ESCALATE];

    const result = SlmOutputAdapter.decode(mockOutputTokens, encoded.mapping, 'npc_1');
    expect(result.kind).toBe('escalate');
    if (result.kind === 'escalate') {
      expect(result.reason).toContain('requested escalation');
    }
  });

  it('escalates cleanly when action syntax is malformed or target missing', () => {
    const encoded = SlmInputAdapter.encode(mockContext);
    // TAKE without a target ID following it
    const mockOutputTokens = [SLM_TOKENS.TAKE];

    const result = SlmOutputAdapter.decode(mockOutputTokens, encoded.mapping, 'npc_1');
    expect(result.kind).toBe('escalate');
    if (result.kind === 'escalate') {
      expect(result.reason).toContain('missing valid targetId');
    }
  });

  it('SlmInferenceEngine returns escalation gracefully when ONNX model is missing/unloaded', async () => {
    const result = await SlmInferenceEngine.infer(mockContext);
    expect(result.kind).toBe('escalate');
    if (result.kind === 'escalate') {
      expect(result.reason).toBeDefined();
    }
  });
});
