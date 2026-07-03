export const STATE_CHANGED_ADD_VALUE = '__state_changed__';

export type ScriptEventAddOption = {
  value: string;
  label: string;
};

export type StateEventKeyInfo = {
  isState: boolean;
  stateId: string;
  value: string | null;
  isValueSpecific: boolean;
};

export const parseStateEventKey = (key: string): StateEventKeyInfo => {
  const normalized = String(key || '').trim();
  const match = normalized.match(/^state:([^=]+)(?:=(.*))?$/i);
  if (!match) {
    return { isState: false, stateId: '', value: null, isValueSpecific: false };
  }
  return {
    isState: true,
    stateId: match[1]?.trim() || '',
    value: match[2] ?? null,
    isValueSpecific: match[2] !== undefined,
  };
};

export const formatInteractionLabel = (key: string): string => {
  const stateEvent = parseStateEventKey(key);
  if (stateEvent.isState) {
    return stateEvent.isValueSpecific ? `STATE ${stateEvent.stateId}=${stateEvent.value}` : 'STATE';
  }
  const normalized = String(key || '').trim();
  return normalized.toUpperCase();
};

export const buildScriptEventAddOptions = (stateIds: string[]): ScriptEventAddOption[] => {
  const options: ScriptEventAddOption[] = [
    { value: 'look', label: 'Look' },
    { value: 'use', label: 'Use' },
    { value: 'talk', label: 'Talk' },
    { value: 'pickup', label: 'Pickup' },
  ];

  if (stateIds.length > 0) {
    options.push({ value: STATE_CHANGED_ADD_VALUE, label: 'State Changed' });
  }

  return options;
};

export const getInteractionKeyForAddValue = (value: string, stateIds: string[]): string | null => {
  if (value === STATE_CHANGED_ADD_VALUE) {
    const firstStateId = stateIds[0];
    return firstStateId ? `state:${firstStateId}` : null;
  }
  return value || null;
};

export const getStateEventSelectOptions = (
  stateIds: string[],
  currentStateId: string
): ScriptEventAddOption[] => {
  const options = stateIds.map((id) => ({ value: id, label: id }));
  if (currentStateId && !stateIds.includes(currentStateId)) {
    options.push({ value: currentStateId, label: currentStateId });
  }
  return options;
};

export const renameInteractionKey = (
  interactions: Record<string, string>,
  oldKey: string,
  newKey: string
): boolean => {
  if (!newKey || oldKey === newKey || interactions[newKey] !== undefined) return false;
  const scriptId = interactions[oldKey] || '';
  delete interactions[oldKey];
  interactions[newKey] = scriptId;
  return true;
};
