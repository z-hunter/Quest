/// <reference lib="webworker" />
import {
  planSnapshotApproach,
  type NavigationPlanRequest,
  type NavigationSnapshot,
} from './navigationPlanner';

type WorkerMessage =
  | { type: 'snapshot'; snapshot: NavigationSnapshot }
  | { type: 'plan'; request: NavigationPlanRequest };

const snapshots = new Map<number, NavigationSnapshot>();

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  if (event.data.type === 'snapshot') {
    snapshots.set(event.data.snapshot.revision, event.data.snapshot);
    return;
  }
  const snapshot = snapshots.get(event.data.request.revision);
  if (!snapshot) {
    self.postMessage({
      ...event.data.request,
      point: null,
      route: [],
      durationMs: 0,
      missingSnapshot: true,
    });
    return;
  }
  self.postMessage(planSnapshotApproach(snapshot, event.data.request));
};
