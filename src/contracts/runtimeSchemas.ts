import type { SceneData } from '../scene/Scene';
import type { NpcPlan, NpcPlanStep, NpcPuppetMasterResponse } from '../mechanics/npcTypes';
import type { ParserCascadeEnvelope, ParserToolAction } from '../mechanics/parserTypes';

export type ContractIssue = { path: string; message: string };

export class ContractValidationError extends Error {
  readonly contract: string;
  readonly issues: ContractIssue[];

  constructor(contract: string, issues: ContractIssue[]) {
    super(
      `${contract} validation failed: ${issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`
    );
    this.name = 'ContractValidationError';
    this.contract = contract;
    this.issues = issues;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function assertIssues<T>(
  contract: string,
  value: unknown,
  issues: ContractIssue[]
): asserts value is T {
  void value;
  if (issues.length) throw new ContractValidationError(contract, issues);
}

export function assertSceneData(value: unknown): asserts value is SceneData {
  const issues: ContractIssue[] = [];
  if (!isRecord(value))
    throw new ContractValidationError('SceneData', [{ path: '$', message: 'must be an object' }]);
  if (!isString(value.id) || !value.id.trim())
    issues.push({ path: '$.id', message: 'must be a non-empty string' });
  if (!isString(value.name) || !value.name.trim())
    issues.push({ path: '$.name', message: 'must be a non-empty string' });
  for (const key of ['walkbox', 'triggerboxes', 'entities'] as const) {
    if (!Array.isArray(value[key])) issues.push({ path: `$.${key}`, message: 'must be an array' });
  }
  if (!isRecord(value.scaling)) {
    issues.push({ path: '$.scaling', message: 'must be an object' });
  } else {
    if (typeof value.scaling.enabled !== 'boolean')
      issues.push({ path: '$.scaling.enabled', message: 'must be boolean' });
    for (const key of ['min', 'max', 'horizon', 'front']) {
      if (!finite(value.scaling[key]))
        issues.push({ path: `$.scaling.${key}`, message: 'must be a finite number' });
    }
  }
  for (const [collection, requireScript] of [
    ['walkbox', false],
    ['triggerboxes', true],
  ] as const) {
    if (!Array.isArray(value[collection])) continue;
    value[collection].forEach((item, index) => {
      if (!isRecord(item))
        return issues.push({ path: `$.${collection}[${index}]`, message: 'must be an object' });
      if (!isString(item.name))
        issues.push({ path: `$.${collection}[${index}].name`, message: 'must be a string' });
      if (requireScript && !isString(item.script))
        issues.push({ path: `$.${collection}[${index}].script`, message: 'must be a string' });
      if (!Array.isArray(item.poly)) {
        issues.push({
          path: `$.${collection}[${index}].poly`,
          message: 'must be an array of points',
        });
      } else
        item.poly.forEach((point, pointIndex) => {
          if (!isRecord(point) || !finite(point.x) || !finite(point.y))
            issues.push({
              path: `$.${collection}[${index}].poly[${pointIndex}]`,
              message: 'must contain finite x/y',
            });
        });
    });
  }
  if (Array.isArray(value.entities))
    value.entities.forEach((entity, index) => {
      if (!isRecord(entity))
        issues.push({ path: `$.entities[${index}]`, message: 'must be an object' });
      else if (
        (!isString(entity.id) || !entity.id.trim()) &&
        (!isString(entity.name) || !entity.name.trim())
      )
        issues.push({ path: `$.entities[${index}]`, message: 'must have a non-empty id or name' });
    });
  assertIssues<SceneData>('SceneData', value, issues);
}

const PARSER_ACTION_TYPES = new Set([
  'lookScene',
  'lookTarget',
  'lookRelationTarget',
  'examineTarget',
  'examineRelationTarget',
  'takeTarget',
  'parserFailure',
  'putTarget',
  'llmClarification',
  'openTarget',
  'closeTarget',
  'quitCurrentView',
  'showInventory',
  'setSceneParserNote',
  'setEntityParserNote',
  'goToTarget',
  'resolveArgumentEntity',
  'ensureHeldEntity',
  'goToSceneById',
  'removeInventoryEntity',
  'actorUseOn',
  'showText',
  'runCustomCommand',
  'requireEntityAvailable',
  'requireAnyEntityAvailable',
  'setEntityState',
  'setGroupDisabled',
  'runScript',
  'stopScript',
]);

export function assertParserToolAction(
  value: unknown,
  path = '$'
): asserts value is ParserToolAction {
  const issues: ContractIssue[] = [];
  if (!isRecord(value)) issues.push({ path, message: 'must be an object' });
  else if (!isString(value.type) || !PARSER_ACTION_TYPES.has(value.type))
    issues.push({ path: `${path}.type`, message: 'is not a supported parser action' });
  assertIssues<ParserToolAction>('ParserToolAction', value, issues);
}

export function assertParserCascadeEnvelope(
  value: unknown
): asserts value is ParserCascadeEnvelope {
  const issues: ContractIssue[] = [];
  const stages = new Set(['regex-v1', 'pending-resolution', 'nlp-v2', 'llm-v3']);
  if (!isRecord(value))
    throw new ContractValidationError('ParserCascadeEnvelope', [
      { path: '$', message: 'must be an object' },
    ]);
  if (!isString(value.stage) || !stages.has(value.stage))
    issues.push({ path: '$.stage', message: 'is unsupported' });
  if (
    !isRecord(value.debug) ||
    !isString(value.debug.rawInput) ||
    !isString(value.debug.normalizedInput)
  )
    issues.push({ path: '$.debug', message: 'must include rawInput and normalizedInput strings' });
  if (
    !isRecord(value.output) ||
    (value.output.kind !== 'plan' && value.output.kind !== 'handoff_up')
  ) {
    issues.push({ path: '$.output.kind', message: 'must be plan or handoff_up' });
  } else if (value.output.kind === 'plan') {
    if (!Array.isArray(value.output.actions))
      issues.push({ path: '$.output.actions', message: 'must be an array' });
    else
      value.output.actions.forEach((action, index) => {
        try {
          assertParserToolAction(action, `$.output.actions[${index}]`);
        } catch (error) {
          if (error instanceof ContractValidationError) issues.push(...error.issues);
        }
      });
  } else {
    for (const key of ['reason', 'rawInput', 'verb', 'noun'])
      if (!isString(value.output[key]))
        issues.push({ path: `$.output.${key}`, message: 'must be a string' });
  }
  assertIssues<ParserCascadeEnvelope>('ParserCascadeEnvelope', value, issues);
}

const NPC_STEP_TYPES = new Set([
  'SAY',
  'MOVE_TO',
  'TRAVERSE_EXIT',
  'LOOK',
  'EXAMINE',
  'OPEN',
  'CLOSE',
  'TAKE',
  'PUT',
  'COMMAND',
  'USE',
  'WAIT',
  'THINK_STRATEGY',
  'MEMORY_SET',
  'OBJECTIVES_SET',
]);

export function assertNpcPlanStep(value: unknown, path = '$'): asserts value is NpcPlanStep {
  const issues: ContractIssue[] = [];
  if (!isRecord(value) || !isString(value.type) || !NPC_STEP_TYPES.has(value.type))
    issues.push({ path: `${path}.type`, message: 'is not a supported NPC DSL step' });
  if (isRecord(value) && value.type === 'WAIT' && (!finite(value.ms) || value.ms < 0))
    issues.push({ path: `${path}.ms`, message: 'must be a non-negative finite number' });
  if (isRecord(value) && value.type === 'SAY' && !isString(value.text))
    issues.push({ path: `${path}.text`, message: 'must be a string' });
  assertIssues<NpcPlanStep>('NpcPlanStep', value, issues);
}

export function assertNpcPlan(value: unknown, path = '$'): asserts value is NpcPlan {
  const issues: ContractIssue[] = [];
  if (!isRecord(value)) issues.push({ path, message: 'must be an object' });
  else {
    if (!isString(value.npcId) || !value.npcId.trim())
      issues.push({ path: `${path}.npcId`, message: 'must be a non-empty string' });
    if (!Array.isArray(value.steps))
      issues.push({ path: `${path}.steps`, message: 'must be an array' });
    else
      value.steps.forEach((step, index) => {
        try {
          assertNpcPlanStep(step, `${path}.steps[${index}]`);
        } catch (error) {
          if (error instanceof ContractValidationError) issues.push(...error.issues);
        }
      });
  }
  assertIssues<NpcPlan>('NpcPlan', value, issues);
}

export function assertNpcPuppetMasterResponse(
  value: unknown
): asserts value is NpcPuppetMasterResponse {
  const issues: ContractIssue[] = [];
  if (!isRecord(value) || value.kind !== 'pm_response')
    issues.push({ path: '$.kind', message: 'must equal pm_response' });
  if (!isRecord(value) || !Array.isArray(value.plans))
    issues.push({ path: '$.plans', message: 'must be an array' });
  else
    value.plans.forEach((plan, index) => {
      try {
        assertNpcPlan(plan, `$.plans[${index}]`);
      } catch (error) {
        if (error instanceof ContractValidationError) issues.push(...error.issues);
      }
    });
  assertIssues<NpcPuppetMasterResponse>('NpcPuppetMasterResponse', value, issues);
}

export function assertTextAssetData(
  value: unknown,
  source = 'TextAsset'
): asserts value is Record<string, unknown> {
  const issues: ContractIssue[] = [];
  if (!isRecord(value))
    throw new ContractValidationError(source, [{ path: '$', message: 'must be a JSON object' }]);
  const visit = (item: unknown, path: string): void => {
    if (item === null || isString(item) || typeof item === 'boolean' || finite(item)) return;
    if (Array.isArray(item))
      return item.forEach((child, index) => visit(child, `${path}[${index}]`));
    if (isRecord(item))
      return Object.entries(item).forEach(([key, child]) => visit(child, `${path}.${key}`));
    issues.push({ path, message: 'must be JSON-compatible' });
  };
  visit(value, '$');
  for (const field of ['title', 'description', 'details', 'lore', 'takeFailure']) {
    const item = value[field];
    if (item !== undefined && !isString(item) && !(Array.isArray(item) && item.every(isString)))
      issues.push({ path: `$.${field}`, message: 'must be a string or string array' });
  }
  assertIssues<Record<string, unknown>>(source, value, issues);
}
