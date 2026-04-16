import type { Scene } from '../../src/scene/Scene';
import type { SceneObject } from '../../src/entities/SceneObject';
import type { ObjectTextAssetData, SceneTextAssetData } from '../../src/core/TextAssetManager';
import type { ParserLexiconAsset, ParserTrainingAsset } from '../../src/mechanics/parserLanguage';
import type { ParserCommandSpec } from '../../src/mechanics/parserTypes';

type TextAssetLike = {
  getResolvedObjectField(obj: SceneObject, field: string): string | null;
  getResolvedObjectListField(obj: SceneObject, field: string): string[];
  getResolvedSceneField(scene: Scene, field: string): string | null;
  getServiceText(key: string, params?: Record<string, string | number>): string;
  getParserLexicon(): ParserLexiconAsset;
  getParserTraining(): ParserTrainingAsset;
  getParserCommands(): ParserCommandSpec[];
  readParserTrainingAsset(): Promise<ParserTrainingAsset>;
};

export type TestTextAssets = TextAssetLike & {
  setObject(id: string, data: ObjectTextAssetData): void;
  setScene(id: string, data: SceneTextAssetData): void;
  setParserCommands(commands: ParserCommandSpec[]): void;
};

const DEFAULT_SERVICE_TEXT: Record<string, string> = {
  'engine.click_you_see': 'You see {title}',
  'engine.too_far_generic': 'You are too far away.',
  'engine.too_far_from_entity': 'You are too far away from the {target}.',
  'engine.cant_reach_generic': "You can't reach it.",
  'engine.blocked_inside_closed': "You can't reach that while it is inside something closed.",
  'engine.closed_container': 'The {target} is closed.',
  'engine.locked_needs': 'Locked. Needs {item}',
  'engine.locked_generic': 'Locked.',
  'parser.look_default_scene': 'You are in {scene}.',
  'parser.look_default_object': 'You see nothing special about the {target}.',
  'parser.look_not_found': "You don't see any {target} here.",
  'parser.look_which_one': 'Which one do you mean: {options}?',
  'parser.examine_prompt': 'Examine what?',
  'parser.examine_which_one': 'Which one do you want to examine: {options}?',
  'parser.take_prompt': 'Take what?',
  'parser.take_which_one': 'Which item do you mean: {options}?',
  'parser.take_which_target': 'Which container do you mean: {options}?',
  'parser.take_target_not_found': "You don't see any suitable container near {target}.",
  'parser.take_pickup_success': 'You picked up the {item}.',
  'parser.take_already_held': 'You are already carrying the {item}.',
  'parser.take_cannot': 'You cannot take that.',
  'parser.put_prompt': 'Put what?',
  'parser.put_which_item': 'Which item do you want to put down: {options}?',
  'parser.put_which_target': 'Where exactly do you want to put it: {options}?',
  'parser.put_item_not_held': "You aren't carrying the {item}.",
  'parser.put_target_not_found': "You don't see anywhere suitable near {target}.",
  'parser.put_no_place': "You can't put that there.",
  'parser.put_target_full_in': 'There is no more room in the {target}.',
  'parser.put_target_full_on': 'There is no more room on the {target}.',
  'parser.put_target_no_fit_in': 'The {item} does not fit in the {target}.',
  'parser.put_target_no_fit_on': 'The {item} does not fit on the {target}.',
  'parser.put_success_surface': 'You put the {item} on the {target}.',
  'parser.put_success_inventory': 'You put the {item} into the {target}.',
  'parser.open_prompt': 'Open what?',
  'parser.open_which_one': 'Which thing do you want to open: {options}?',
  'parser.open_success': 'You open the {target}.',
  'parser.open_already': 'The {target} is already open.',
  'parser.close_prompt': 'Close what?',
  'parser.close_which_one': 'Which thing do you want to close: {options}?',
  'parser.close_success': 'You close the {target}.',
  'parser.close_already': 'The {target} is already closed.',
  'parser.inventory_missing': 'You have nowhere to carry anything.',
  'parser.inventory_empty': 'You are not carrying anything.',
  'parser.inventory_items': 'You are carrying: {items}',
  'parser.go_to_prompt': 'Where do you want to go?',
  'parser.go_to_which_one': 'Where exactly do you want to go: {options}?',
  'parser.go_to_not_found': "You can't get to {target} from here.",
  'parser.go_to_success': 'You go to {target}.',
  'parser.command_no_effect': "That doesn't work.",
  'parser.parse_unknown': "I don't understand.",
  'parser.relation_empty': 'You see nothing {relation} the {target}.',
  'parser.relation_contents': '{Relation} the {target} you see: {items}.',
};

const DEFAULT_PARSER_LEXICON: ParserLexiconAsset = {
  stage1Aliases: {
    look: ['look'],
    examine: ['examine', 'inspect', 'check', 'x'],
    take: ['take', 'get', 'pickup', 'pick up'],
    put: ['put', 'drop', 'place'],
    open: ['open'],
    close: ['close', 'shut'],
    quit: ['quit', 'exit'],
    goTo: ['go', 'walk', 'move'],
    showInventory: ['inventory', 'inv'],
  },
  normalizationPrefixes: {
    look: ['look at', 'look', 'tell me about', 'what is that', 'what is', 'describe'],
    examine: ['look closely at', 'take a closer look at', 'examine', 'inspect', 'check'],
    take: ['pick up', 'take', 'get', 'grab'],
    put: ['put down', 'put', 'drop', 'place'],
    open: ['open'],
    close: ['close', 'shut'],
    quit: ['quit', 'exit'],
    goTo: ['go to', 'walk to', 'move to', 'go', 'walk', 'move'],
    showInventory: [],
  },
  politePrefixes: ['please', 'i want to', "i'd like to", 'i would like to'],
  articles: ['the', 'a', 'an', 'my'],
  lookSceneWords: ['around', 'here', 'scene'],
  relationMarkers: {
    on: ['on'],
    under: ['under', 'beneath'],
    in: ['in', 'inside', 'into'],
    behind: ['behind'],
    near: ['near', 'next to', 'by'],
  },
};

const DEFAULT_PARSER_TRAINING: ParserTrainingAsset = {
  look: ['look chair', 'look at the chair', 'describe the chair'],
  examine: ['examine chair', 'inspect the chair', 'check the card'],
  take: ['take key', 'pick up key', 'take key from drawer'],
  put: ['put key', 'drop key', 'put key on desk', 'put cassette into recorder'],
  open: ['open drawer', 'open cabinet'],
  close: ['close drawer', 'shut cabinet'],
  quit: ['quit', 'exit'],
  goTo: ['go to office', 'walk office'],
  showInventory: ['inventory', 'show inventory', 'what do i have'],
};

const DEFAULT_PARSER_COMMANDS: ParserCommandSpec[] = [
  {
    id: 'teleport_with',
    phrases: ['teleport with', 'teleport'],
    arguments: [
      {
        name: 'item',
        kind: 'entity',
        required: true,
        scopes: ['held', 'takable'],
        messages: {
          missing: 'Teleport with what?',
          ambiguous: 'Which item do you want to teleport with: {options}?',
          notFound: "You don't have anything like that.",
          noEffect: "That doesn't work.",
        },
        validation: {
          allowedTitles: ['your ID card'],
        },
      },
    ],
    plan: [
      { type: 'resolveArgumentEntity', arg: 'item', saveAs: 'teleport_item' },
      { type: 'ensureHeldEntity', ref: 'teleport_item', noEffectMessageId: 'no_effect' },
      { type: 'goToSceneById', sceneId: 'test1' },
      { type: 'removeInventoryEntity', ref: 'teleport_item' },
      { type: 'showText', messageId: 'success' },
    ],
    messages: {
      success: 'You vanish in a flash and arrive somewhere else.',
    },
  },
  {
    id: 'use_on',
    phrases: ['use'],
    arguments: [
      {
        name: 'item',
        kind: 'entity',
        required: true,
        scopes: ['held', 'reachable'],
        messages: {
          missing: 'Use what on what?',
          ambiguous: 'Which item do you mean: {options}?',
          notFound: "You don't see anything like that here.",
          noEffect: "That doesn't work.",
        },
      },
      {
        name: 'target',
        kind: 'entity',
        required: true,
        scopes: ['held', 'reachable'],
        separatorsBefore: ['on', 'with'],
        messages: {
          missing: 'Use it on what?',
          ambiguous: 'Which target do you mean: {options}?',
          notFound: "You don't see anything like that here.",
          noEffect: "That doesn't work.",
        },
      },
    ],
    plan: [
      { type: 'resolveArgumentEntity', arg: 'item', saveAs: 'use_item' },
      { type: 'resolveArgumentEntity', arg: 'target', saveAs: 'use_target' },
      {
        type: 'showText',
        messageId: 'no_effect_pair',
        paramsFromRefs: {
          item: 'use_item',
          target: 'use_target',
        },
      },
    ],
    messages: {
      no_effect_pair: 'Using the {item} on the {target} does nothing.',
    },
  },
];

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, token: string) => {
    const value = params[token];
    return value === undefined || value === null ? `{${token}}` : String(value);
  });
}

export function createTestTextAssets(): TestTextAssets {
  const objectAssets = new Map<string, ObjectTextAssetData>();
  const sceneAssets = new Map<string, SceneTextAssetData>();
  let parserCommands = structuredClone(DEFAULT_PARSER_COMMANDS);

  return {
    setObject(id, data) {
      objectAssets.set(String(id), data);
    },
    setScene(id, data) {
      sceneAssets.set(String(id), data);
    },
    getResolvedObjectField(obj, field) {
      const asset = objectAssets.get(obj.name);
      const value = asset?.[field];
      if (typeof value === 'string') return value;
      if (
        field === 'description' &&
        typeof (obj as { description?: unknown }).description === 'string'
      ) {
        return (obj as { description?: string }).description || null;
      }
      return null;
    },
    getResolvedObjectListField(obj, field) {
      const asset = objectAssets.get(obj.name);
      const value = asset?.[field];
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
    },
    getResolvedSceneField(scene, field) {
      const asset = sceneAssets.get(scene.id);
      const value = asset?.[field];
      if (typeof value === 'string') return value;
      if (field === 'description' && typeof scene.description === 'string')
        return scene.description || null;
      return null;
    },
    getParserLexicon() {
      return structuredClone(DEFAULT_PARSER_LEXICON);
    },
    getParserTraining() {
      return structuredClone(DEFAULT_PARSER_TRAINING);
    },
    getParserCommands() {
      return structuredClone(parserCommands);
    },
    async readParserTrainingAsset() {
      return structuredClone(DEFAULT_PARSER_TRAINING);
    },
    setParserCommands(commands) {
      parserCommands = structuredClone(commands);
    },
    getServiceText(key, params) {
      return interpolate(DEFAULT_SERVICE_TEXT[key] || key, params);
    },
  };
}
