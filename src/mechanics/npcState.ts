/** Durable NPC cognition state shared by components, Text Assets, PM and editor UI. */
export type NpcObjective = {
  id: string;
  text: string;
  subtasks: NpcObjective[];
  /** Shown to PM once as JUST COMPLETED, then pruned after that PM turn. */
  completed?: boolean;
  /** Model claimed completion, but the claim still needs confirmation on the next PM turn. */
  pendingConfirmation?: boolean;
};

export type NpcObjectiveDraft = {
  text: string;
  subtasks: NpcObjectiveDraft[];
};

let objectiveSequence = 0;

export function createNpcObjectiveId(): string {
  objectiveSequence += 1;
  return `npc-objective-${Date.now().toString(36)}-${objectiveSequence.toString(36)}`;
}

export function normalizeNpcMemory(value: unknown): string[] {
  if (typeof value === 'string') {
    const memory = value.trim();
    return memory ? [memory] : [];
  }
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
}

export function normalizeNpcObjectiveDraft(value: unknown): NpcObjectiveDraft | null {
  if (typeof value === 'string') {
    const text = value.trim();
    return text ? { text, subtasks: [] } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const text = typeof record.text === 'string' ? record.text.trim() : '';
  if (!text) return null;
  const subtasks = Array.isArray(record.subtasks)
    ? record.subtasks
        .map((child) => normalizeNpcObjectiveDraft(child))
        .filter((child): child is NpcObjectiveDraft => child !== null)
    : [];
  return { text, subtasks };
}

export function normalizeNpcObjectiveDrafts(value: unknown): NpcObjectiveDraft[] {
  const source = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  return source
    .map((item) => normalizeNpcObjectiveDraft(item))
    .filter((item): item is NpcObjectiveDraft => item !== null);
}

export function materializeNpcObjectives(
  drafts: NpcObjectiveDraft[],
  makeId: () => string = createNpcObjectiveId
): NpcObjective[] {
  return drafts.map((draft) => ({
    id: makeId(),
    text: draft.text,
    subtasks: materializeNpcObjectives(draft.subtasks, makeId),
  }));
}

export function normalizeNpcObjectives(value: unknown): NpcObjective[] {
  const normalize = (item: unknown): NpcObjective | null => {
    if (typeof item === 'string') {
      const text = item.trim();
      return text ? { id: createNpcObjectiveId(), text, subtasks: [] } : null;
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    if (!text) return null;
    const id =
      typeof record.id === 'string' && record.id.trim() ? record.id.trim() : createNpcObjectiveId();
    const subtasks = Array.isArray(record.subtasks)
      ? record.subtasks.map(normalize).filter((child): child is NpcObjective => child !== null)
      : [];
    return {
      id,
      text,
      subtasks,
      ...(record.completed === true ? { completed: true } : {}),
      ...(record.pendingConfirmation === true ? { pendingConfirmation: true } : {}),
    };
  };
  if (!Array.isArray(value)) return [];
  return value.map(normalize).filter((item): item is NpcObjective => item !== null);
}

export function findNpcObjective(objectives: NpcObjective[], id: string): NpcObjective | null {
  for (const objective of objectives) {
    if (objective.id === id) return objective;
    const nested = findNpcObjective(objective.subtasks, id);
    if (nested) return nested;
  }
  return null;
}

export function removeNpcObjective(objectives: NpcObjective[], id: string): boolean {
  const index = objectives.findIndex((objective) => objective.id === id);
  if (index >= 0) {
    objectives.splice(index, 1);
    return true;
  }
  return objectives.some((objective) => removeNpcObjective(objective.subtasks, id));
}

export function formatNpcObjectivesForEditor(objectives: NpcObjective[], depth = 0): string {
  return objectives
    .flatMap((objective) => [
      `${'  '.repeat(depth)}${objective.text}`,
      formatNpcObjectivesForEditor(objective.subtasks, depth + 1),
    ])
    .filter(Boolean)
    .join('\n');
}

export function parseNpcObjectivesFromEditor(
  text: string
): { objectives: NpcObjectiveDraft[] } | { error: string } {
  const roots: NpcObjectiveDraft[] = [];
  const stack: NpcObjectiveDraft[] = [];
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    if (!rawLine.trim()) continue;
    if (/\t/.test(rawLine))
      return { error: `Line ${index + 1}: use two spaces per level, not tabs.` };
    const match = rawLine.match(/^( *)(.*)$/);
    const spaces = match?.[1].length || 0;
    const value = match?.[2].trim() || '';
    if (!value) continue;
    if (spaces % 2 !== 0)
      return { error: `Line ${index + 1}: indentation must use pairs of spaces.` };
    const depth = spaces / 2;
    if (depth > stack.length)
      return { error: `Line ${index + 1}: indentation may increase by only one level.` };
    const objective: NpcObjectiveDraft = { text: value, subtasks: [] };
    if (depth === 0) roots.push(objective);
    else stack[depth - 1].subtasks.push(objective);
    stack.length = depth;
    stack[depth] = objective;
  }
  return { objectives: roots };
}
