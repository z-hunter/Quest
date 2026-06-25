import { describe, expect, it, vi } from 'vitest';
import { SceneLog } from '../../src/scene/SceneLog';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('SceneLog', () => {
  it('assigns monotonically increasing timestamps to same-tick runtime events', () => {
    const log = new SceneLog();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);

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
    now.mockRestore();
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
      knownByNpcIds: ['guard'],
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

  it('persists through Scene JSON', () => {
    const fixture = createSceneFixture();
    fixture.scene.sceneLog.appendSpeech({
      actorId: 'Hero',
      displayName: 'Miles',
      text: 'Anyone here?',
      knownByNpcIds: ['guard'],
      timestamp: 1000,
    });

    expect(fixture.scene.toJSON().sceneLog?.entries?.[0].text).toBe('Anyone here?');
  });
});
