import { describe, expect, it, vi } from 'vitest';
import { SceneLog } from '../../src/scene/SceneLog';
import { SceneManager } from '../../src/scene/SceneManager';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('SceneLog', () => {
  it('assigns monotonically increasing timestamps to same-tick runtime events', () => {
    const log = new SceneLog();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);

    try {
      const first = log.appendSpeech({
        actorId: 'Hero',
        displayName: 'Hero',
        text: 'First',
        knownByNpcIds: ['NPC'],
      });
      log.markProcessed(undefined, 'NPC');
      const second = log.appendSpeech({
        actorId: 'Hero',
        displayName: 'Hero',
        text: 'Second',
        knownByNpcIds: ['NPC'],
      });

      expect(first?.timestamp).toBe(1000);
      expect(second?.timestamp).toBe(1001);
      expect(log.getUnreadEntries('NPC').map((entry) => entry.text)).toEqual(['Second']);
    } finally {
      now.mockRestore();
    }
  });

  it('does not advance an NPC cursor over events unknown to that NPC', () => {
    const log = new SceneLog();
    log.appendSpeech({
      actorId: 'Hero',
      displayName: 'Hero',
      text: 'For Linda',
      knownByNpcIds: ['Linda'],
      timestamp: 1000,
    });
    log.appendSpeech({
      actorId: 'Hero',
      displayName: 'Hero',
      text: 'For Bob',
      knownByNpcIds: ['Bob'],
      timestamp: 2000,
    });

    log.markProcessed(undefined, 'Linda');

    expect(log.lastPmProcessedAtByNpc.Linda).toBe(1000);
  });

  it('stores speech entries with listener knowledge and unread cursor filtering', () => {
    const log = new SceneLog();
    const first = log.appendSpeech({
      actorId: 'Hero',
      displayName: 'Miles',
      text: 'Hello there',
      knownByNpcIds: ['guard'],
      timestamp: 1000,
    });
    log.appendSpeech({
      actorId: 'guard',
      displayName: 'Guard',
      text: 'Move along',
      knownByNpcIds: [],
      timestamp: 1100,
    });

    expect(first?.kind).toBe('speech');
    expect(log.getUnreadEntries()).toHaveLength(1);
    expect(log.getUnreadEntries()[0].text).toBe('Hello there');

    log.markProcessed();
    expect(log.lastPmProcessedAt).toBe(1100);
    expect(log.getUnreadEntries()).toHaveLength(0);
  });

  it('prunes old entries and round-trips persisted data', () => {
    const log = new SceneLog();
    log.appendAction({
      actorId: 'Hero',
      displayName: 'Miles',
      text: '[Miles opens the locker]',
      knownByActorIds: ['guard'],
      timestamp: 1,
    });
    log.appendSpeech({
      actorId: 'Hero',
      displayName: 'Miles',
      text: 'Still here',
      knownByNpcIds: ['guard'],
      timestamp: 10 * 60 * 1000 + 1,
    });
    log.prune(10 * 60 * 1000 + 2);

    expect(log.entries.map((entry) => entry.text)).toEqual(['Still here']);

    const loaded = new SceneLog();
    loaded.load(log.toJSON());
    expect(loaded.entries).toEqual(log.entries);
  });

  it('keeps runtime entries out of authored Scene JSON and ignores legacy asset logs', () => {
    const fixture = createSceneFixture();
    fixture.scene.sceneLog.appendSpeech({
      actorId: 'Hero',
      displayName: 'Miles',
      text: 'Anyone here?',
      knownByNpcIds: ['guard'],
      timestamp: 1000,
    });

    const authored = fixture.scene.toJSON() as any;
    expect(authored.sceneLog).toBeUndefined();

    const legacy = {
      ...authored,
      id: 'legacy',
      name: 'Legacy',
      sceneLog: fixture.scene.sceneLog.toJSON(),
    };
    const loaded = (SceneManager.prototype as any).instantiateScene.call(
      fixture.game.sceneManager,
      'legacy',
      legacy
    );
    expect(loaded.sceneLog.entries).toEqual([]);
  });

  it('clears live entries when restoring a legacy runtime snapshot without a log', () => {
    const fixture = createSceneFixture();
    const manager = Object.create(SceneManager.prototype) as SceneManager;
    Object.assign(manager as any, {
      scenes: new Map([[fixture.scene.id, fixture.scene]]),
      sceneRuntimeSnapshots: new Map(),
    });
    fixture.scene.sceneLog.appendSpeech({
      actorId: 'Hero',
      displayName: 'Miles',
      text: 'Transient runtime event',
      knownByNpcIds: ['guard'],
      timestamp: 1000,
    });
    const snapshot = (manager as any).captureSceneRuntimeSnapshot(fixture.scene);
    delete snapshot.sceneLog;

    manager.restoreSceneRuntimeSnapshot(fixture.scene.id, snapshot);

    expect(fixture.scene.sceneLog.entries).toEqual([]);
  });

  it('loads legacy knownByNpcIds as actor-aware recipients', () => {
    const log = new SceneLog();
    log.load({
      entries: [
        {
          id: 'legacy-action',
          kind: 'action',
          timestamp: 1000,
          actorId: 'Hero',
          displayName: 'Hero',
          text: '[ Hero opens Locker ]',
          knownByNpcIds: ['guard'],
        },
      ],
    });

    expect(log.entries[0].knownByActorIds).toEqual(['guard']);
    expect(log.getUnreadEntries('guard')).toHaveLength(1);
    expect((log.toJSON().entries?.[0] as any).knownByNpcIds).toBeUndefined();
  });
});
