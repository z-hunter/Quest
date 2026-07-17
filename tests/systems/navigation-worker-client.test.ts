import { describe, expect, it } from 'vitest';
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

  terminate(): void {}

  reply(data: any): void {
    this.onmessage?.({ data } as MessageEvent<any>);
  }
}

describe('ActorNavigationService worker client', () => {
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
});
