export type SceneLogEntryKind = 'speech' | 'action';

export interface SceneLogEntry {
  id: string;
  kind: SceneLogEntryKind;
  timestamp: number;
  actorId: string;
  displayName: string;
  text: string;
  knownByNpcIds: string[];
  payload?: Record<string, unknown>;
}

export interface SceneLogData {
  entries?: SceneLogEntry[];
  lastPmProcessedAt?: number;
  lastPmProcessedAtByNpc?: Record<string, number>;
}

export const SCENE_LOG_RETENTION_MS = 10 * 60 * 1000;

function normalizeTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKnownNpcIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export class SceneLog {
  entries: SceneLogEntry[] = [];
  lastPmProcessedAt = 0;
  lastPmProcessedAtByNpc: Record<string, number> = {};
  retentionMs = SCENE_LOG_RETENTION_MS;

  appendSpeech(args: {
    actorId: string;
    displayName: string;
    text: string;
    knownByNpcIds?: string[];
    timestamp?: number;
  }): SceneLogEntry | null {
    return this.append({
      kind: 'speech',
      actorId: args.actorId,
      displayName: args.displayName,
      text: args.text,
      knownByNpcIds: args.knownByNpcIds || [],
      timestamp: args.timestamp,
    });
  }

  appendAction(args: {
    actorId: string;
    displayName: string;
    text: string;
    knownByNpcIds?: string[];
    timestamp?: number;
    payload?: Record<string, unknown>;
  }): SceneLogEntry | null {
    return this.append({
      kind: 'action',
      actorId: args.actorId,
      displayName: args.displayName,
      text: args.text,
      knownByNpcIds: args.knownByNpcIds || [],
      timestamp: args.timestamp,
      payload: args.payload,
    });
  }

  getUnreadEntries(npcId?: string | null): SceneLogEntry[] {
    const normalizedNpcId = String(npcId || '').trim();
    const cursor = normalizedNpcId
      ? (this.lastPmProcessedAtByNpc[normalizedNpcId] ?? this.lastPmProcessedAt)
      : this.lastPmProcessedAt;
    return this.entries.filter(
      (entry) =>
        entry.timestamp > cursor &&
        (normalizedNpcId
          ? entry.knownByNpcIds.includes(normalizedNpcId)
          : entry.knownByNpcIds.length > 0)
    );
  }

  markProcessed(timestamp?: number, npcId?: string | null): void {
    const normalizedNpcId = String(npcId || '').trim();
    const currentCursor = normalizedNpcId
      ? (this.lastPmProcessedAtByNpc[normalizedNpcId] ?? this.lastPmProcessedAt)
      : this.lastPmProcessedAt;
    const newestEntryTime = this.entries.reduce(
      (latest, entry) =>
        !normalizedNpcId || entry.knownByNpcIds.includes(normalizedNpcId)
          ? Math.max(latest, entry.timestamp)
          : latest,
      currentCursor
    );
    const processedAt = normalizeTimestamp(timestamp, newestEntryTime);
    if (normalizedNpcId) {
      this.lastPmProcessedAtByNpc[normalizedNpcId] = processedAt;
      return;
    }
    this.lastPmProcessedAt = processedAt;
  }

  prune(now: number = Date.now()): void {
    const cutoff = now - this.retentionMs;
    this.entries = this.entries.filter((entry) => entry.timestamp >= cutoff);
  }

  toJSON(): SceneLogData {
    return {
      entries: this.entries.map((entry) => ({ ...entry, knownByNpcIds: [...entry.knownByNpcIds] })),
      lastPmProcessedAt: this.lastPmProcessedAt,
      lastPmProcessedAtByNpc: { ...this.lastPmProcessedAtByNpc },
    };
  }

  load(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const record = data as SceneLogData;
    const now = Date.now();
    this.lastPmProcessedAt = normalizeTimestamp(record.lastPmProcessedAt, 0);
    this.lastPmProcessedAtByNpc =
      record.lastPmProcessedAtByNpc &&
      typeof record.lastPmProcessedAtByNpc === 'object' &&
      !Array.isArray(record.lastPmProcessedAtByNpc)
        ? Object.fromEntries(
            Object.entries(record.lastPmProcessedAtByNpc)
              .map(([npcId, value]) => [npcId.trim(), normalizeTimestamp(value, 0)] as const)
              .filter(([npcId]) => !!npcId)
          )
        : {};
    this.entries = Array.isArray(record.entries)
      ? record.entries
          .map((entry, index) => this.normalizeEntry(entry, now + index))
          .filter((entry): entry is SceneLogEntry => !!entry)
      : [];
  }

  private append(args: {
    kind: SceneLogEntryKind;
    actorId: string;
    displayName: string;
    text: string;
    knownByNpcIds: string[];
    timestamp?: number;
    payload?: Record<string, unknown>;
  }): SceneLogEntry | null {
    const text = normalizeText(args.text);
    const actorId = normalizeText(args.actorId);
    if (!text || !actorId) return null;

    const requestedTimestamp = normalizeTimestamp(args.timestamp, Date.now());
    const previousTimestamp = this.entries.at(-1)?.timestamp ?? 0;
    const timestamp =
      typeof args.timestamp === 'number'
        ? requestedTimestamp
        : Math.max(requestedTimestamp, previousTimestamp + 1);
    const entry: SceneLogEntry = {
      id: `${timestamp}-${this.entries.length + 1}`,
      kind: args.kind,
      timestamp,
      actorId,
      displayName: normalizeText(args.displayName) || actorId,
      text,
      knownByNpcIds: normalizeKnownNpcIds(args.knownByNpcIds),
      ...(args.payload ? { payload: { ...args.payload } } : {}),
    };

    this.entries.push(entry);
    this.prune(timestamp);
    return entry;
  }

  private normalizeEntry(value: unknown, fallbackTimestamp: number): SceneLogEntry | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Partial<SceneLogEntry>;
    const kind = record.kind === 'action' ? 'action' : record.kind === 'speech' ? 'speech' : null;
    const actorId = normalizeText(record.actorId);
    const text = normalizeText(record.text);
    if (!kind || !actorId || !text) return null;
    const timestamp = normalizeTimestamp(record.timestamp, fallbackTimestamp);
    return {
      id: normalizeText(record.id) || `${timestamp}-${actorId}`,
      kind,
      timestamp,
      actorId,
      displayName: normalizeText(record.displayName) || actorId,
      text,
      knownByNpcIds: normalizeKnownNpcIds(record.knownByNpcIds),
      ...(record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
        ? { payload: { ...record.payload } }
        : {}),
    };
  }
}
