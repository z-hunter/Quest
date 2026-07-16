import { describe, expect, it } from 'vitest';
import {
  applyJsonDelta,
  createJsonDelta,
  parseSaveState,
  migrateSaveState,
  SAVE_STATE_ENGINE,
  SAVE_STATE_VERSION,
} from '../../src/systems/saveState';

describe('SaveState schema and delta', () => {
  it('round-trips nested object changes, removed fields, and changed entity arrays', () => {
    const base = {
      name: 'Room',
      camera: { x: 0, y: 0, zoom: 1, legacy: true },
      entities: [{ name: 'npc', x: 10, components: [] }],
      authoredText: 'Not duplicated when unchanged',
    };
    const current = {
      name: 'Room',
      camera: { x: 4, y: 0, zoom: 1 },
      entities: [{ name: 'npc', x: 25, components: [{ type: 'NPC', memory: 'Met player' }] }],
      authoredText: 'Not duplicated when unchanged',
    };

    const delta = createJsonDelta(base, current);

    expect(applyJsonDelta(base, delta)).toEqual(current);
    expect(JSON.stringify(delta)).not.toContain('Not duplicated when unchanged');
  });

  it('rejects unsupported or structurally invalid save files', () => {
    expect(() => parseSaveState({ format: SAVE_STATE_ENGINE, version: 99 })).toThrow(
      'unsupported version'
    );
    expect(() =>
      parseSaveState({
        format: SAVE_STATE_ENGINE,
        version: SAVE_STATE_VERSION,
        metadata: { name: 'slot', createdAt: '', currentSceneId: 'room' },
        compatibility: { minimumVersion: 1, authoredSceneHashes: {} },
        game: { score: 0 },
        scenes: [{ id: 'room', path: 'room.json', delta: { kind: 'bad' } }],
        parser: { pendingState: null },
        npcPuppetMaster: { actionHistories: {}, continuations: [] },
        console: { buffer: [], history: [], settings: {} },
      })
    ).toThrow('kind is invalid');
    expect(() => migrateSaveState({ format: SAVE_STATE_ENGINE, version: 0 })).toThrow(
      "no migration from version '0'"
    );
  });
});
