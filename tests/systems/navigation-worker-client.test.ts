import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSceneFixture } from '../fixtures/sceneFactory';
import { ActorNavigationService } from '../../src/systems/ActorNavigationService';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<any>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly messages: any[] = [];

  constructor(_url: URL, _options: WorkerOptions) {
    FakeWorker.instances.push(this);
  }

  postMessage(message: any): void {
    this.messages.push(message);
  }

  terminated = false;

  terminate(): void {
    this.terminated = true;
  }

  reply(data: any): void {
    this.onmessage?.({ data } as MessageEvent<any>);
  }
}

describe('ActorNavigationService worker client', () => {
  afterEach(() => vi.useRealTimers());

  it('sends one cached snapshot and processes NPC requests FIFO', () => {
    FakeWorker.instances = [];
    const fixture = createSceneFixture();
    const floor = fixture.addWalkbox('Floor');
    floor.mode = 'Add';
    floor.poly = [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 100 },
      { x: 0, y: 100 },
    ];
    const actor = fixture.addPlayer('Hero', 10, 50);
    actor.colliderWidth = 4;
    actor.colliderHeight = 4;
    const target = fixture.addEntity('door');
    target.x = 90;
    target.y = 50;

    const navigation = new ActorNavigationService(
      fixture.game,
      () => new FakeWorker(null as unknown as URL, {} as WorkerOptions) as unknown as Worker
    );
    const received: string[] = [];
    navigation.requestNpcApproach(actor, target, (result) => received.push(result.source));
    navigation.requestNpcApproach(actor, target, (result) => received.push(result.source));

    const worker = FakeWorker.instances[0];
    expect(worker.messages.map((message) => message.type)).toEqual(['snapshot', 'plan']);
    expect(received).toEqual([]);
    const firstRequest = worker.messages[1].request;
    worker.reply({
      requestId: firstRequest.requestId,
      sceneId: firstRequest.sceneId,
      revision: firstRequest.revision,
      point: { x: 72, y: 50 },
      route: [{ x: 72, y: 50 }],
      durationMs: 1,
    });

    expect(received).toEqual(['worker']);
    expect(worker.messages.map((message) => message.type)).toEqual(['snapshot', 'plan', 'plan']);
    const diagnostics = navigation.getNavigationDiagnostics();
    expect(diagnostics).toMatchObject({ snapshotMisses: 1, queueDepth: 0, active: true });
    expect(diagnostics.snapshotHits).toBeGreaterThanOrEqual(1);
  });

  it('falls back and replaces a worker that does not answer in time', () => {
    vi.useFakeTimers();
    FakeWorker.instances = [];
    const fixture = createSceneFixture();
    const floor = fixture.addWalkbox('Floor');
    floor.mode = 'Add';
    floor.poly = [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 100 },
      { x: 0, y: 100 },
    ];
    const actor = fixture.addPlayer('Hero', 10, 50);
    actor.colliderWidth = 4;
    actor.colliderHeight = 4;
    const target = fixture.addEntity('door');
    target.x = 90;
    target.y = 50;
    const navigation = new ActorNavigationService(
      fixture.game,
      () => new FakeWorker(null as unknown as URL, {} as WorkerOptions) as unknown as Worker
    );
    const received: string[] = [];

    navigation.requestNpcApproach(actor, target, (result) => received.push(result.source));
    const stalledWorker = FakeWorker.instances[0];
    const request = stalledWorker.messages[1].request;
    vi.advanceTimersByTime(1_500);

    expect(received).toEqual(['fallback']);
    expect(stalledWorker.terminated).toBe(true);
    expect(navigation.getNavigationDiagnostics()).toMatchObject({
      active: false,
      workerTimeouts: 1,
      fallbacks: 1,
    });

    navigation.requestNpcApproach(actor, target, (result) => received.push(result.source));
    expect(FakeWorker.instances).toHaveLength(2);
    const replacementWorker = FakeWorker.instances[1];
    const replacementRequest = replacementWorker.messages[1].request;
    replacementWorker.reply({
      requestId: replacementRequest.requestId,
      sceneId: replacementRequest.sceneId,
      revision: replacementRequest.revision,
      point: { x: 72, y: 50 },
      route: [{ x: 72, y: 50 }],
      durationMs: 1,
    });
    expect(received).toEqual(['fallback', 'worker']);

    stalledWorker.reply({
      requestId: request.requestId,
      sceneId: request.sceneId,
      revision: request.revision,
      point: { x: 72, y: 50 },
      route: [{ x: 72, y: 50 }],
      durationMs: 1,
    });
    expect(received).toEqual(['fallback', 'worker']);
  });
});
