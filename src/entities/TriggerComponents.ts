export interface TriggerComponent {
    type: string;
}

export interface SubsceneTrigger extends TriggerComponent {
    type: 'Subscene';
    targetGroupId: string;
    name?: string;
}

export type AnyTriggerComponent = SubsceneTrigger;
// Future types can be added here like: | ExitTrigger | EntryTrigger;
