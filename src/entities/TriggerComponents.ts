export interface TriggerComponent {
  type: string;
}

export interface SubsceneTrigger extends TriggerComponent {
  type: 'Subscene';
  targetGroupId: string;
  itemScale?: number;
  title?: string;
  description?: string | null;
}

export interface Subtrigger extends TriggerComponent {
  type: 'Subtrigger';
  target: string; // ID or Name of the target Triggerbox logic to activate
}

export interface ExitTrigger extends TriggerComponent {
  type: 'Exit';
  targetSceneId: string;
  targetEntryId: string; // ID of the Entry Triggerbox in the target scene
}

export interface EntryTrigger extends TriggerComponent {
  type: 'Entry';
  direction?: 'up' | 'down' | 'left' | 'right';
}

export interface SwitchTrigger extends TriggerComponent {
  type: 'Switch';
  groupId1: string;
  groupId2: string;
  state: 1 | 2;
  name?: string;
  keyId?: string; // Optional Inventory Check
  sound1?: string; // Sound when switching TO state 1? Or from? GDD says "sound names for opening/closing".
  sound2?: string;
  locked?: boolean;
  lockMessage?: string;
  transparent?: boolean;
  clearlyOpenable?: boolean;
  blockedRelation?: 'in' | 'on' | 'under' | 'behind' | 'none';
}

export interface BlockerTrigger extends TriggerComponent {
  type: 'Blocker';
  transparent?: boolean;
  blockedRelation?: 'in' | 'on' | 'under' | 'behind' | 'none';
}

export type AnyTriggerComponent =
  | SubsceneTrigger
  | SwitchTrigger
  | BlockerTrigger
  | Subtrigger
  | ExitTrigger
  | EntryTrigger;

export function normalizeTriggerComponent(component: any): AnyTriggerComponent | null {
  if (!component || typeof component !== 'object' || typeof component.type !== 'string') {
    return null;
  }

  if (component.type === 'Exit') {
    return {
      type: 'Exit',
      targetSceneId: typeof component.targetSceneId === 'string' ? component.targetSceneId : '',
      targetEntryId: typeof component.targetEntryId === 'string' ? component.targetEntryId : '',
    };
  }

  if (component.type === 'Entry') {
    return {
      type: 'Entry',
      direction:
        component.direction === 'up' ||
        component.direction === 'down' ||
        component.direction === 'left' ||
        component.direction === 'right'
          ? component.direction
          : undefined,
    };
  }

  if (component.type === 'Subscene') {
    const title =
      typeof component.title === 'string' && component.title.trim()
        ? component.title.trim()
        : typeof component.name === 'string' && component.name.trim()
          ? component.name.trim()
          : undefined;
    const description =
      typeof component.description === 'string' && component.description.trim()
        ? component.description
        : undefined;

    return {
      type: 'Subscene',
      targetGroupId: typeof component.targetGroupId === 'string' ? component.targetGroupId : '',
      ...(typeof component.itemScale === 'number' && Number.isFinite(component.itemScale)
        ? { itemScale: component.itemScale }
        : {}),
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
    };
  }

  if (component.type === 'Subtrigger') {
    return {
      type: 'Subtrigger',
      target: typeof component.target === 'string' ? component.target : '',
    };
  }

  if (component.type === 'Switch') {
    return {
      type: 'Switch',
      groupId1: typeof component.groupId1 === 'string' ? component.groupId1 : '',
      groupId2: typeof component.groupId2 === 'string' ? component.groupId2 : '',
      state: component.state === 2 ? 2 : 1,
      ...(typeof component.keyId === 'string' ? { keyId: component.keyId } : {}),
      ...(typeof component.idKey === 'string' ? { keyId: component.idKey } : {}),
      ...(typeof component.sound1 === 'string' ? { sound1: component.sound1 } : {}),
      ...(typeof component.sound2 === 'string' ? { sound2: component.sound2 } : {}),
      ...(component.locked === true ? { locked: true } : {}),
      ...(typeof component.lockMessage === 'string' ? { lockMessage: component.lockMessage } : {}),
      ...(component.transparent === true ? { transparent: true } : {}),
      ...(component.clearlyOpenable === true ? { clearlyOpenable: true } : {}),
      ...(component.blockedRelation === 'on' ||
      component.blockedRelation === 'under' ||
      component.blockedRelation === 'behind' ||
      component.blockedRelation === 'none' ||
      component.blockedRelation === 'in'
        ? { blockedRelation: component.blockedRelation }
        : {}),
      ...(typeof component.name === 'string' ? { name: component.name } : {}),
    };
  }

  if (component.type === 'Blocker') {
    return {
      type: 'Blocker',
      ...(component.transparent === true ? { transparent: true } : {}),
      ...(component.blockedRelation === 'on' ||
      component.blockedRelation === 'under' ||
      component.blockedRelation === 'behind' ||
      component.blockedRelation === 'none' ||
      component.blockedRelation === 'in'
        ? { blockedRelation: component.blockedRelation }
        : {}),
    };
  }

  return component as AnyTriggerComponent;
}

export function normalizeTriggerComponents(
  components: any[] | null | undefined
): AnyTriggerComponent[] {
  if (!Array.isArray(components) || components.length === 0) return [];
  return components
    .map((component) => normalizeTriggerComponent(component))
    .filter((component): component is AnyTriggerComponent => !!component);
}
