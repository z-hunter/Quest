export interface TriggerComponent {
    type: string;
}

export interface SubsceneTrigger extends TriggerComponent {
    type: 'Subscene';
    targetGroupId: string;
    name?: string;
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

export type AnyTriggerComponent = SubsceneTrigger | SwitchTrigger;
