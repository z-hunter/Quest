export const SLM_TOKENS = {
  PAD: 0,
  START: 1,
  END: 2,
  ESCALATE: 3,

  // Actions
  MOVE_TO: 10,
  TAKE: 11,
  OPEN: 12,
  CLOSE: 13,
  PUT: 14,
  COMMAND: 15,
  TRAVERSE_EXIT: 16,
  LOOK: 17,
  EXAMINE: 18,
  USE: 19,
  WAIT: 20,
  SAY: 21,
  THINK_STRATEGY: 22,

  // Relations
  REL_IN: 30,
  REL_ON: 31,
  REL_UNDER: 32,
  REL_BEHIND: 33,

  // Feature flags for encoding state
  FLAG_REACHABLE: 40,
  FLAG_HELD: 41,
  FLAG_ROUTE_AVAILABLE: 42,
  FLAG_UNREACHABLE: 43,
  FLAG_CAN_OPEN: 44,
  FLAG_CAN_CLOSE: 45,
  FLAG_LOCKED: 46,
  FLAG_KEY_HELD: 47,
  FLAG_TARGET_OBJECTIVE: 48,
  FLAG_ACTOR: 49,

  // Dynamic entity base index
  DYNAMIC_ENTITY_BASE: 100,
} as const;

export const SLM_VOCABULARY_VERSION = 'slm-v1';
export const SLM_VOCABULARY_SHA256 =
  '932e0c7ad289a3f258e78f1cf0ef3b192615224733e4a14f8e3893b87246ceeb';

export type SlmTokenName = keyof typeof SLM_TOKENS;
export type SlmTokenValue = (typeof SLM_TOKENS)[SlmTokenName] | number;

export interface DynamicEntityMapping {
  indexToId: Map<number, string>;
  idToIndex: Map<string, number>;
}
