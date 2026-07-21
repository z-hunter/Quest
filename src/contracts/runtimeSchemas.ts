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
  if (value.folders !== undefined && !Array.isArray(value.folders)) {
    issues.push({ path: '$.folders', message: 'must be an array' });
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
  if (Array.isArray(value.folders))
    value.folders.forEach((folder, index) => {
      if (!isRecord(folder))
        issues.push({ path: `$.folders[${index}]`, message: 'must be an object' });
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
  'giveTarget',
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
  if (!isRecord(value)) {
    issues.push({ path, message: 'must be an object' });
  } else if (!isString(value.type) || !PARSER_ACTION_TYPES.has(value.type)) {
    issues.push({ path: `${path}.type`, message: 'is not a supported parser action' });
  } else {
    const isStringOrNull = (val: unknown): val is string | null =>
      typeof val === 'string' || val === null;
    const type = value.type;
    if (type === 'lookTarget') {
      if (!isString(value.target))
        issues.push({ path: `${path}.target`, message: 'must be a string' });
    }
    if (type === 'lookRelationTarget' || type === 'examineRelationTarget') {
      if (!isString(value.relation))
        issues.push({ path: `${path}.relation`, message: 'must be a string' });
      if (!isStringOrNull(value.anchor))
        issues.push({ path: `${path}.anchor`, message: 'must be a string or null' });
    }
    if (type === 'examineTarget') {
      if (!isStringOrNull(value.target))
        issues.push({ path: `${path}.target`, message: 'must be a string or null' });
    }
    if (type === 'takeTarget') {
      if (!isStringOrNull(value.target))
        issues.push({ path: `${path}.target`, message: 'must be a string or null' });
      if (value.anchor !== undefined && !isStringOrNull(value.anchor))
        issues.push({ path: `${path}.anchor`, message: 'must be a string or null' });
      if (value.relation !== undefined && !isStringOrNull(value.relation))
        issues.push({ path: `${path}.relation`, message: 'must be a string or null' });
    }
    if (type === 'giveTarget') {
      if (!isStringOrNull(value.item))
        issues.push({ path: `${path}.item`, message: 'must be a string or null' });
      if (!isStringOrNull(value.target))
        issues.push({ path: `${path}.target`, message: 'must be a string or null' });
    }
    if (type === 'parserFailure') {
      if (!isString(value.code)) issues.push({ path: `${path}.code`, message: 'must be a string' });
      if (!isString(value.message))
        issues.push({ path: `${path}.message`, message: 'must be a string' });
    }
    if (type === 'putTarget') {
      if (!isStringOrNull(value.item))
        issues.push({ path: `${path}.item`, message: 'must be a string or null' });
      if (!isStringOrNull(value.target))
        issues.push({ path: `${path}.target`, message: 'must be a string or null' });
      if (value.relation !== undefined && !isStringOrNull(value.relation))
        issues.push({ path: `${path}.relation`, message: 'must be a string or null' });
    }
    if (type === 'llmClarification') {
      if (!isString(value.question))
        issues.push({ path: `${path}.question`, message: 'must be a string' });
      if (!Array.isArray(value.pendingActions)) {
        issues.push({ path: `${path}.pendingActions`, message: 'must be an array' });
      } else {
        value.pendingActions.forEach((act, idx) => {
          try {
            assertParserToolAction(act, `${path}.pendingActions[${idx}]`);
          } catch (e) {
            if (e instanceof ContractValidationError) issues.push(...e.issues);
          }
        });
      }
    }
    if (type === 'openTarget' || type === 'closeTarget' || type === 'goToTarget') {
      if (!isStringOrNull(value.target))
        issues.push({ path: `${path}.target`, message: 'must be a string or null' });
    }
    if (type === 'quitCurrentView') {
      if (value.target !== undefined && !isStringOrNull(value.target))
        issues.push({ path: `${path}.target`, message: 'must be a string or null' });
    }
    if (type === 'setSceneParserNote') {
      if (!isString(value.note)) issues.push({ path: `${path}.note`, message: 'must be a string' });
    }
    if (type === 'setEntityParserNote') {
      if (!isString(value.entityId))
        issues.push({ path: `${path}.entityId`, message: 'must be a string' });
      if (!isString(value.note)) issues.push({ path: `${path}.note`, message: 'must be a string' });
    }
    if (type === 'resolveArgumentEntity') {
      if (!isString(value.commandId))
        issues.push({ path: `${path}.commandId`, message: 'must be a string' });
      if (!isString(value.arg)) issues.push({ path: `${path}.arg`, message: 'must be a string' });
      if (!isStringOrNull(value.query))
        issues.push({ path: `${path}.query`, message: 'must be a string or null' });
      if (!Array.isArray(value.scopes) || !value.scopes.every(isString))
        issues.push({ path: `${path}.scopes`, message: 'must be an array of strings' });
      if (!isString(value.saveAs))
        issues.push({ path: `${path}.saveAs`, message: 'must be a string' });
    }
    if (type === 'ensureHeldEntity' || type === 'removeInventoryEntity') {
      if (!isString(value.ref)) issues.push({ path: `${path}.ref`, message: 'must be a string' });
    }
    if (type === 'goToSceneById') {
      if (!isString(value.sceneId))
        issues.push({ path: `${path}.sceneId`, message: 'must be a string' });
    }
    if (type === 'actorUseOn') {
      if (!isString(value.itemRef))
        issues.push({ path: `${path}.itemRef`, message: 'must be a string' });
      if (!isString(value.targetRef))
        issues.push({ path: `${path}.targetRef`, message: 'must be a string' });
    }
    if (type === 'runCustomCommand') {
      if (!isString(value.commandId))
        issues.push({ path: `${path}.commandId`, message: 'must be a string' });
    }
    if (type === 'requireEntityAvailable') {
      if (!isString(value.entityId))
        issues.push({ path: `${path}.entityId`, message: 'must be a string' });
      if (!Array.isArray(value.scopes) || !value.scopes.every(isString))
        issues.push({ path: `${path}.scopes`, message: 'must be an array of strings' });
    }
    if (type === 'requireAnyEntityAvailable') {
      if (!Array.isArray(value.options)) {
        issues.push({ path: `${path}.options`, message: 'must be an array' });
      } else {
        value.options.forEach((opt, idx) => {
          if (!isRecord(opt)) {
            issues.push({ path: `${path}.options[${idx}]`, message: 'must be an object' });
          } else {
            if (!isString(opt.entityId))
              issues.push({
                path: `${path}.options[${idx}].entityId`,
                message: 'must be a string',
              });
            if (!Array.isArray(opt.scopes) || !opt.scopes.every(isString))
              issues.push({
                path: `${path}.options[${idx}].scopes`,
                message: 'must be an array of strings',
              });
          }
        });
      }
    }
    if (type === 'setEntityState') {
      if (!isString(value.entityId))
        issues.push({ path: `${path}.entityId`, message: 'must be a string' });
      if (!isString(value.stateId))
        issues.push({ path: `${path}.stateId`, message: 'must be a string' });
      if (
        typeof value.value !== 'string' &&
        typeof value.value !== 'boolean' &&
        !finite(value.value)
      ) {
        issues.push({
          path: `${path}.value`,
          message: 'must be string, boolean, or finite number',
        });
      }
    }
    if (type === 'setGroupDisabled') {
      if (!isString(value.groupId))
        issues.push({ path: `${path}.groupId`, message: 'must be a string' });
      if (typeof value.disabled !== 'boolean')
        issues.push({ path: `${path}.disabled`, message: 'must be a boolean' });
    }
    if (type === 'runScript' || type === 'stopScript') {
      if (!isString(value.scriptId))
        issues.push({ path: `${path}.scriptId`, message: 'must be a string' });
    }
  }
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
  'GIVE',
  'PUT',
  'COMMAND',
  'WAIT',
  'THINK_STRATEGY',
  'MEMORY_ADD',
  'MEMORY_REMOVE',
  'OBJECTIVE_ADD',
  'OBJECTIVE_UPDATE',
  'OBJECTIVE_REMOVE',
  'OBJECTIVE_MARK_COMPLETED',
  'MEMORY_SET',
  'OBJECTIVES_SET',
]);

function isNpcObjectiveDraft(value: unknown): boolean {
  if (!isRecord(value) || !isString(value.text) || !value.text.trim()) return false;
  return (
    value.subtasks === undefined ||
    (Array.isArray(value.subtasks) && value.subtasks.every(isNpcObjectiveDraft))
  );
}

function isNpcObjectiveCompletionEvidence(value: unknown): boolean {
  if (!isRecord(value) || !isString(value.actionType)) return false;
  if (
    !['TAKE', 'GIVE', 'PUT', 'COMMAND', 'OPEN', 'CLOSE', 'LOOK', 'EXAMINE'].includes(
      value.actionType
    )
  ) {
    return false;
  }
  return ['code', 'targetId', 'itemId', 'commandId'].every(
    (key) => value[key] === undefined || isString(value[key])
  );
}

export function assertNpcPlanStep(value: unknown, path = '$'): asserts value is NpcPlanStep {
  const issues: ContractIssue[] = [];
  if (!isRecord(value) || !isString(value.type) || !NPC_STEP_TYPES.has(value.type)) {
    issues.push({ path: `${path}.type`, message: 'is not a supported NPC DSL step' });
  } else {
    if (value.type === 'WAIT' && (!finite(value.ms) || value.ms < 0))
      issues.push({ path: `${path}.ms`, message: 'must be a non-negative finite number' });
    if (value.type === 'SAY' && !isString(value.text))
      issues.push({ path: `${path}.text`, message: 'must be a string' });
    if (value.type === 'MOVE_TO') {
      if (value.x !== undefined && !finite(value.x))
        issues.push({ path: `${path}.x`, message: 'must be a finite number' });
      if (value.y !== undefined && !finite(value.y))
        issues.push({ path: `${path}.y`, message: 'must be a finite number' });
      if (value.targetId !== undefined && !isString(value.targetId))
        issues.push({ path: `${path}.targetId`, message: 'must be a string' });
      if (value.targetId === undefined && (value.x === undefined || value.y === undefined)) {
        issues.push({
          path,
          message: 'MOVE_TO step must specify targetId destination or x and y coordinates',
        });
      }
    }
    if (value.type === 'TRAVERSE_EXIT') {
      if (!isString(value.targetId))
        issues.push({ path: `${path}.targetId`, message: 'must be a string' });
    }
    if (value.type === 'LOOK' || value.type === 'EXAMINE') {
      if (!isString(value.targetId))
        issues.push({ path: `${path}.targetId`, message: 'must be a string' });
      if (value.relation !== undefined && value.relation !== null && !isString(value.relation)) {
        issues.push({ path: `${path}.relation`, message: 'must be a string or null' });
      }
    }
    if (value.type === 'OPEN' || value.type === 'CLOSE' || value.type === 'TAKE') {
      if (!isString(value.targetId))
        issues.push({ path: `${path}.targetId`, message: 'must be a string' });
    }
    if (value.type === 'GIVE') {
      if (!isString(value.itemId))
        issues.push({ path: `${path}.itemId`, message: 'must be a string' });
      if (!isString(value.targetId))
        issues.push({ path: `${path}.targetId`, message: 'must be a string' });
    }
    if (value.type === 'PUT') {
      if (!isString(value.itemId))
        issues.push({ path: `${path}.itemId`, message: 'must be a string' });
      if (value.targetId !== undefined && value.targetId !== null && !isString(value.targetId)) {
        issues.push({ path: `${path}.targetId`, message: 'must be a string or null' });
      }
      if (value.relation !== undefined && value.relation !== null && !isString(value.relation)) {
        issues.push({ path: `${path}.relation`, message: 'must be a string or null' });
      }
    }
    if (value.type === 'COMMAND') {
      if (!isString(value.commandId))
        issues.push({ path: `${path}.commandId`, message: 'must be a string' });
      if (value.arguments !== undefined && value.arguments !== null && !isRecord(value.arguments)) {
        issues.push({ path: `${path}.arguments`, message: 'must be an object or null' });
      }
    }
    if (value.type === 'THINK_STRATEGY') {
      if (value.reason !== undefined && !isString(value.reason)) {
        issues.push({ path: `${path}.reason`, message: 'must be a string' });
      }
    }
    if (
      value.type === 'MEMORY_ADD' ||
      value.type === 'MEMORY_REMOVE' ||
      value.type === 'MEMORY_SET'
    ) {
      if (!isString(value.memory))
        issues.push({ path: `${path}.memory`, message: 'must be a string' });
    }
    if (value.type === 'OBJECTIVE_ADD') {
      if (value.parentId !== undefined && value.parentId !== null && !isString(value.parentId)) {
        issues.push({ path: `${path}.parentId`, message: 'must be a string or null' });
      }
      if (!isNpcObjectiveDraft(value.objective)) {
        issues.push({
          path: `${path}.objective`,
          message: 'must be an objective { text, subtasks } tree',
        });
      }
    }
    if (value.type === 'OBJECTIVE_UPDATE') {
      if (!isString(value.objectiveId))
        issues.push({ path: `${path}.objectiveId`, message: 'must be a string' });
      if (!isString(value.text)) issues.push({ path: `${path}.text`, message: 'must be a string' });
    }
    if (
      (value.type === 'OBJECTIVE_REMOVE' || value.type === 'OBJECTIVE_MARK_COMPLETED') &&
      !isString(value.objectiveId)
    ) {
      issues.push({ path: `${path}.objectiveId`, message: 'must be a string' });
    }
    if (
      value.type === 'OBJECTIVE_MARK_COMPLETED' &&
      value.evidence !== undefined &&
      !isNpcObjectiveCompletionEvidence(value.evidence)
    ) {
      issues.push({ path: `${path}.evidence`, message: 'must identify a supported action result' });
    }
    if (value.type === 'OBJECTIVES_SET') {
      if (!Array.isArray(value.objectives) || !value.objectives.every(isString)) {
        issues.push({ path: `${path}.objectives`, message: 'must be an array of strings' });
      }
    }
  }
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
  if (
    value.memory !== undefined &&
    !isString(value.memory) &&
    !(Array.isArray(value.memory) && value.memory.every(isString))
  ) {
    issues.push({ path: '$.memory', message: 'must be a string or string array' });
  }
  if (
    value.objectives !== undefined &&
    !isString(value.objectives) &&
    !(
      Array.isArray(value.objectives) &&
      value.objectives.every((item) => isString(item) || isNpcObjectiveDraft(item))
    )
  ) {
    issues.push({
      path: '$.objectives',
      message: 'must be a string, string array, or objective tree',
    });
  }
  assertIssues<Record<string, unknown>>(source, value, issues);
}
