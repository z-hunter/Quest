import type { ConsoleState } from '../core/Console';
import type { NpcPuppetMasterSaveState } from '../mechanics/NpcPuppetMaster';
import type { ParserPendingState, ParserSceneTurnContext } from '../mechanics/parserTypes';
import type { SceneLogData } from '../scene/SceneLog';

export const SAVE_STATE_VERSION = 1 as const;
export const SAVE_STATE_ENGINE = 'scanline' as const;

export type JsonDelta =
  | { kind: 'replace'; value: unknown }
  | { kind: 'object'; fields: Record<string, JsonDelta>; removed: string[] };

export type SceneRuntimeSaveState = {
  revealedHiddenEntities: string[];
  parserNote: string;
  parserNoteNeedsCheck: boolean;
  entityParserNotes: Record<string, string>;
  entityParserNoteNeedsCheck: Record<string, boolean>;
  parserRecentTurns: ParserSceneTurnContext[];
  activeSubscene: string | null;
  camera: { x: number; y: number; zoom: number };
  sceneLog?: SceneLogData;
};

export type SavedSceneDelta = {
  id: string;
  path: string;
  delta?: JsonDelta;
  runtime?: SceneRuntimeSaveState;
};

export type SaveStateV1 = {
  format: typeof SAVE_STATE_ENGINE;
  version: typeof SAVE_STATE_VERSION;
  metadata: { name: string; createdAt: string; currentSceneId: string };
  compatibility: { minimumVersion: 1; authoredSceneHashes: Record<string, string> };
  game: { score: number };
  scenes: SavedSceneDelta[];
  parser: { pendingState: ParserPendingState | null };
  npcPuppetMaster: NpcPuppetMasterSaveState;
  console: ConsoleState;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function createJsonDelta(base: unknown, current: unknown): JsonDelta | undefined {
  if (JSON.stringify(base) === JSON.stringify(current)) return undefined;
  if (!isObject(base) || !isObject(current)) return { kind: 'replace', value: current };
  const fields: Record<string, JsonDelta> = {};
  const removed = Object.keys(base).filter((key) => !(key in current));
  for (const [key, value] of Object.entries(current)) {
    const child = createJsonDelta(base[key], value);
    if (child) fields[key] = child;
  }
  return { kind: 'object', fields, removed };
}

export function applyJsonDelta(base: unknown, delta: JsonDelta | undefined): unknown {
  if (!delta) return structuredClone(base);
  if (delta.kind === 'replace') return structuredClone(delta.value);
  const result: Record<string, unknown> = isObject(base) ? structuredClone(base) : {};
  for (const key of delta.removed) delete result[key];
  for (const [key, child] of Object.entries(delta.fields)) {
    result[key] = applyJsonDelta(result[key], child);
  }
  return result;
}

export function fingerprintJson(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid SaveState: ${message}`);
}

function validateDelta(delta: unknown, path: string): asserts delta is JsonDelta {
  assert(isObject(delta), `${path} must be an object`);
  assert(delta.kind === 'replace' || delta.kind === 'object', `${path}.kind is invalid`);
  if (delta.kind === 'object') {
    assert(isObject(delta.fields), `${path}.fields must be an object`);
    assert(Array.isArray(delta.removed), `${path}.removed must be an array`);
    for (const [key, child] of Object.entries(delta.fields)) validateDelta(child, `${path}.${key}`);
  } else {
    assert('value' in delta, `${path}.value is required`);
  }
}

function validateStringArray(value: unknown, path: string): asserts value is string[] {
  assert(Array.isArray(value), `${path} must be an array`);
  assert(
    value.every((item) => typeof item === 'string'),
    `${path} must contain strings`
  );
}

function validateConsoleSettings(value: unknown): void {
  assert(isObject(value), 'console.settings is required');
  for (const key of [
    'parserPeekEnabled',
    'parserPeekLlmEnabled',
    'parserPeekPnEnabled',
    'parserPeekPmEnabled',
    'parserStage1Enabled',
    'parserStage2Enabled',
    'parserLlmEnabled',
    'parserCascade1ForceLlm',
    'slmLoggingEnabled',
  ]) {
    assert(typeof value[key] === 'boolean', `console.settings.${key} must be boolean`);
  }
  if ('parserPeekNavEnabled' in value) {
    assert(
      typeof value.parserPeekNavEnabled === 'boolean',
      'console.settings.parserPeekNavEnabled must be boolean'
    );
  }
}

export function parseSaveState(input: unknown): SaveStateV1 {
  assert(isObject(input), 'root must be an object');
  assert(input.format === SAVE_STATE_ENGINE, `format must be '${SAVE_STATE_ENGINE}'`);
  assert(input.version === SAVE_STATE_VERSION, `unsupported version '${String(input.version)}'`);
  assert(isObject(input.metadata), 'metadata is required');
  assert(typeof input.metadata.name === 'string', 'metadata.name must be a string');
  assert(typeof input.metadata.createdAt === 'string', 'metadata.createdAt must be a string');
  assert(typeof input.metadata.currentSceneId === 'string', 'currentSceneId must be a string');
  assert(isObject(input.compatibility), 'compatibility is required');
  assert(input.compatibility.minimumVersion === 1, 'minimumVersion must be 1');
  assert(
    isObject(input.compatibility.authoredSceneHashes),
    'compatibility.authoredSceneHashes is required'
  );
  assert(isObject(input.game), 'game is required');
  assert(Number.isFinite(input.game.score), 'game.score must be a finite number');
  assert(Array.isArray(input.scenes), 'scenes must be an array');
  const sceneIds = new Set<string>();
  for (const [index, scene] of input.scenes.entries()) {
    assert(isObject(scene), `scenes[${index}] must be an object`);
    assert(typeof scene.id === 'string' && !!scene.id, `scenes[${index}].id is required`);
    assert(typeof scene.path === 'string', `scenes[${index}].path must be a string`);
    assert(!sceneIds.has(scene.id), `duplicate scene id '${scene.id}'`);
    sceneIds.add(scene.id);
    assert(
      !scene.path.includes('..') && !scene.path.includes('\0'),
      `scenes[${index}].path is unsafe`
    );
    if (scene.delta !== undefined) validateDelta(scene.delta, `scenes[${index}].delta`);
    if (scene.runtime !== undefined) {
      assert(isObject(scene.runtime), `scenes[${index}].runtime must be an object`);
      validateStringArray(
        scene.runtime.revealedHiddenEntities,
        `scenes[${index}].runtime.revealedHiddenEntities`
      );
      assert(typeof scene.runtime.parserNote === 'string', `scenes[${index}].runtime.parserNote`);
      assert(
        typeof scene.runtime.parserNoteNeedsCheck === 'boolean',
        `scenes[${index}].runtime.parserNoteNeedsCheck`
      );
      assert(
        isObject(scene.runtime.entityParserNotes),
        `scenes[${index}].runtime.entityParserNotes`
      );
      assert(
        isObject(scene.runtime.entityParserNoteNeedsCheck),
        `scenes[${index}].runtime.entityParserNoteNeedsCheck`
      );
      assert(
        Array.isArray(scene.runtime.parserRecentTurns),
        `scenes[${index}].runtime.parserRecentTurns`
      );
      assert(isObject(scene.runtime.camera), `scenes[${index}].runtime.camera`);
      assert(Number.isFinite(scene.runtime.camera.x), `scenes[${index}].runtime.camera.x`);
      assert(Number.isFinite(scene.runtime.camera.y), `scenes[${index}].runtime.camera.y`);
      assert(Number.isFinite(scene.runtime.camera.zoom), `scenes[${index}].runtime.camera.zoom`);
      if (scene.runtime.sceneLog !== undefined) {
        assert(isObject(scene.runtime.sceneLog), `scenes[${index}].runtime.sceneLog`);
      }
    }
  }
  assert(isObject(input.console), 'console is required');
  assert(Array.isArray(input.console.buffer), 'console.buffer must be an array');
  assert(Array.isArray(input.console.history), 'console.history must be an array');
  assert(
    input.console.history.every((item) => typeof item === 'string'),
    'console.history must contain strings'
  );
  assert(typeof input.console.isOpen === 'boolean', 'console.isOpen must be boolean');
  for (const [index, line] of input.console.buffer.entries()) {
    assert(isObject(line), `console.buffer[${index}] must be an object`);
    assert(typeof line.text === 'string', `console.buffer[${index}].text must be a string`);
    assert(
      ['output', 'command', 'error', 'info', 'dialogue'].includes(String(line.type)),
      `console.buffer[${index}].type is invalid`
    );
    assert(Number.isFinite(line.timestamp), `console.buffer[${index}].timestamp must be finite`);
  }
  validateConsoleSettings(input.console.settings);
  assert(isObject(input.parser), 'parser is required');
  if (input.parser.pendingState !== null) {
    assert(isObject(input.parser.pendingState), 'parser.pendingState must be an object or null');
    assert(
      typeof input.parser.pendingState.intent === 'string',
      'parser.pendingState.intent is required'
    );
    assert(
      typeof input.parser.pendingState.question === 'string',
      'parser.pendingState.question is required'
    );
    assert(
      typeof input.parser.pendingState.originalInput === 'string',
      'parser.pendingState.originalInput is required'
    );
    if (input.parser.pendingState.pendingEnvelopeJson !== undefined) {
      assert(
        typeof input.parser.pendingState.pendingEnvelopeJson === 'string',
        'parser.pendingState.pendingEnvelopeJson must be a string'
      );
      try {
        JSON.parse(input.parser.pendingState.pendingEnvelopeJson);
      } catch {
        throw new Error(
          'Invalid SaveState: parser.pendingState.pendingEnvelopeJson is invalid JSON'
        );
      }
    }
  }
  assert(isObject(input.npcPuppetMaster), 'npcPuppetMaster is required');
  assert(
    isObject(input.npcPuppetMaster.actionHistories),
    'npcPuppetMaster.actionHistories is required'
  );
  assert(
    Array.isArray(input.npcPuppetMaster.continuations),
    'npcPuppetMaster.continuations is required'
  );
  return input as unknown as SaveStateV1;
}

export function migrateSaveState(input: unknown): SaveStateV1 {
  assert(isObject(input), 'root must be an object');
  assert(Number.isInteger(input.version), 'version must be an integer');
  if ((input.version as number) > SAVE_STATE_VERSION) {
    throw new Error(`Invalid SaveState: unsupported future version '${String(input.version)}'`);
  }

  let migrated: unknown = structuredClone(input);
  while (isObject(migrated) && (migrated.version as number) < SAVE_STATE_VERSION) {
    const migration = SAVE_STATE_MIGRATIONS[migrated.version as number];
    if (!migration) {
      throw new Error(`Invalid SaveState: no migration from version '${String(migrated.version)}'`);
    }
    migrated = migration(migrated);
  }
  return parseSaveState(migrated);
}

type SaveStateMigration = (input: Record<string, unknown>) => unknown;

// Add a deterministic N -> N+1 transform here whenever SAVE_STATE_VERSION is increased.
const SAVE_STATE_MIGRATIONS: Readonly<Record<number, SaveStateMigration>> = Object.freeze({});
