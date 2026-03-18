export interface TriggerComponent {
  type: string;
}

export interface SubsceneTrigger extends TriggerComponent {
  type: 'Subscene';
  targetGroupId: string;
  name?: string;
  nodeId?: string;
  title?: string;
  description?: string | null;
  spatial?: { parentNodeId?: string | null; relation?: 'in' | 'on' | 'under' | 'behind' | null };
}

export interface Subtrigger extends TriggerComponent {
  type: 'Subtrigger';
  target: string; // ID or Name of the target Triggerbox logic to activate
}

// Future types can be added here like: | ExitTrigger | EntryTrigger;

export interface SwitchTrigger extends TriggerComponent {
  type: 'Switch';
  groupId1: string;
  groupId2: string;
  state: 1 | 2;
  name?: string;
  idKey?: string; // Optional Inventory Check
  sound1?: string; // Sound when switching TO state 1? Or from? GDD says "sound names for opening/closing".
  sound2?: string;
}

export type AnyTriggerComponent = SubsceneTrigger | SwitchTrigger | Subtrigger;
