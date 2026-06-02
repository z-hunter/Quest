import type { Scene } from '../scene/Scene';
import type { SceneObject } from '../entities/SceneObject';
import type { ParserLexiconAsset, ParserTrainingAsset } from '../mechanics/parserLanguage';
import type { ParserCommandSpec } from '../mechanics/parserTypes';
import {
  deleteProjectFile,
  ensureProjectFile,
  openProjectFile,
  saveProjectFile,
} from '../platform/fileApi';

export type TextAssetStructuredValue =
  | string
  | number
  | boolean
  | null
  | TextAssetStructuredValue[]
  | { [key: string]: TextAssetStructuredValue };

type TextAssetValue =
  | string
  | string[]
  | TextAssetStructuredValue[]
  | Record<string, TextAssetStructuredValue>;
type TextAssetData = Record<string, TextAssetValue>;
type TextAssetTextValue = string | string[];
export type SceneTextAssetData = TextAssetData & {
  title?: TextAssetTextValue;
  description?: TextAssetTextValue;
  lore?: TextAssetTextValue;
};
export type ObjectTextAssetData = TextAssetData & {
  title?: TextAssetTextValue;
  description?: TextAssetTextValue;
  details?: TextAssetTextValue;
  lore?: TextAssetTextValue;
  objectives?: TextAssetStructuredValue[];
  takeFailure?: TextAssetTextValue;
  synonyms?: string[];
  semanticTags?: string[];
  relationFacts?: TextAssetStructuredValue[];
};

const DEFAULT_SERVICE_ASSETS: Record<string, TextAssetData> = {
  parser: {
    look_default_scene: 'You are in {scene}.',
    look_scene_contents: 'Here is {items}.',
    look_default_object: 'You see nothing special about the {target}.',
    look_not_found: "You don't see any {target} here.",
    look_which_one: 'Which one do you mean: {options}?',
    examine_prompt: 'Examine what?',
    examine_which_one: 'Which one do you want to examine: {options}?',
    look_relation_prompt: 'Look where?',
    examine_relation_prompt: 'Examine what area?',
    relation_empty: 'You see nothing {relation} the {target}.',
    relation_contents: '{Relation} the {target} you see: {items}.',
    relation_discovered_contents: '{Relation} the {target} you discover: {items}.',
    relation_location: 'It is {relation} the {target}.',
    relation_not_supported: "You can't determine what is {relation} the {target} from here.",
    take_prompt: 'Take what?',
    take_which_one: 'Which item do you mean: {options}?',
    take_pickup_success: 'You picked up the {item}.',
    take_pickup_success_from: 'You picked up the {item} from the {source}.',
    take_already_held: 'You are already carrying the {item}.',
    take_cannot: 'You cannot take that.',
    put_prompt: 'Put what?',
    put_which_item: 'Which item do you want to put down: {options}?',
    put_which_target: 'Where exactly do you want to put it: {options}?',
    put_item_not_held: "You aren't carrying the {item}.",
    put_target_not_found: "You don't see anywhere suitable near {target}.",
    put_no_place: "You can't put that there.",
    put_target_full_in: 'There is no more room in the {target}.',
    put_target_full_on: 'There is no more room on the {target}.',
    put_target_no_fit_in: 'The {item} does not fit in the {target}.',
    put_target_no_fit_on: 'The {item} does not fit on the {target}.',
    put_success_surface: 'You put the {item} on the {target}.',
    put_success_inventory: 'You put the {item} into the {target}.',
    put_success_under: 'You put the {item} under the {target}.',
    put_success_behind: 'You put the {item} behind the {target}.',
    drop_success: 'You drop the {item}.',
    open_prompt: 'Open what?',
    open_which_one: 'Which thing do you want to open: {options}?',
    open_success: 'You open the {target}.',
    open_already: 'The {target} is already open.',
    close_prompt: 'Close what?',
    close_which_one: 'Which thing do you want to close: {options}?',
    close_success: 'You close the {target}.',
    close_already: 'The {target} is already closed.',
    inventory_missing: 'You have nowhere to carry anything.',
    inventory_empty: 'You are not carrying anything.',
    inventory_items: 'You are carrying: {items}',
    go_to_prompt: 'Where do you want to go?',
    go_to_which_one: 'Where exactly do you want to go: {options}?',
    go_to_not_found: "You can't get to {target} from here.",
    go_to_success: 'You go to {target}.',
    use_prompt: 'Use what?',
    use_format_prompt: 'Use what on what? (Format: USE ITEM ON TARGET)',
    use_missing_item: "You don't have the {item}.",
    use_no_effect_pair: 'Using the {item} on the {target} does nothing.',
    use_no_effect_single: 'You try to use the {target}, but nothing happens.',
    clarification_cancel_replies: ['none', 'cancel'],
    clarification_cancelled: 'Command cancelled.',
    command_no_effect: "That doesn't work.",
    parse_unknown: "I don't understand.",
  },
  engine: {
    floor_label: 'floor',
    click_you_see: 'You see {title}',
    too_far_generic: 'You are too far away.',
    too_far_from_entity: 'You are too far away from the {target}.',
    cant_reach_generic: "You can't reach it.",
    blocked_inside_closed: "You can't reach that while it is inside something closed.",
    closed_container: 'The {target} is closed.',
    locked_needs: 'Locked. Needs {item}',
    locked_generic: 'Locked.',
  },
  scripts: {
    pillar_key_inserted: 'You insert the key into a hidden slot in the pillar.',
    pillar_compartment_opened: 'Click! A secret compartment opens!',
    pillar_open_description: 'The pillar is open, revealing a secret compartment.',
    test_audio_playing: 'Playing test sound...',
  },
};

const DEFAULT_PARSER_LEXICON: ParserLexiconAsset = {
  stage1Aliases: {
    look: ['look'],
    examine: ['examine', 'inspect', 'check'],
    take: ['take', 'get', 'pickup', 'pick up'],
    put: ['put', 'drop', 'place', 'throw', 'toss', 'discard'],
    open: ['open'],
    close: ['close', 'shut'],
    quit: ['quit', 'exit'],
    goTo: ['go', 'walk', 'move'],
    showInventory: ['inventory', 'inv'],
  },
  normalizationPrefixes: {
    look: ['look at', 'look', 'tell me about', 'what is that', 'what is', 'describe'],
    examine: [
      'take a closer look at',
      'look closely at',
      'examine at',
      'examine',
      'inspect at',
      'inspect',
      'check at',
      'check',
    ],
    take: ['pick up', 'take', 'get', 'grab'],
    put: [
      'put down',
      'throw away',
      'toss away',
      'put',
      'drop',
      'place',
      'throw',
      'toss',
      'discard',
    ],
    open: ['open'],
    close: ['close', 'shut'],
    quit: ['quit', 'exit'],
    goTo: [
      'go over to',
      'walk over to',
      'move over to',
      'go to',
      'walk to',
      'move to',
      'go',
      'walk',
      'move',
      'head to',
      'travel to',
      'head',
      'travel',
    ],
    showInventory: [],
  },
  politePrefixes: [
    'please',
    'could you',
    'can you',
    'would you',
    'i want to',
    'i would like to',
    "i'd like to",
  ],
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
  look: [
    'look',
    'look chair',
    'look logo',
    'look lamp',
    'look key',
    'look door',
    'look at the lamp',
    'look at the chair',
    'look at the logo',
    'tell me about the door',
    'what is that lamp',
    'what is the chair',
    'what is the logo',
    'describe the office door',
    'look over the note',
  ],
  examine: [
    'examine',
    'examine chair',
    'examine logo',
    'inspect chair',
    'inspect the logo',
    'check the card',
    'check chair',
    'inspect the note',
    'examine the lamp',
    'inspect the desk',
    'check the key',
    'look closely at the logo',
    'take a closer look at the chair',
  ],
  take: [
    'take',
    'take key',
    'take card',
    'take note',
    'get key',
    'pickup key',
    'pick up key',
    'take the key',
    'pick up the key',
    'grab the card',
    'take the id card',
    'pick up linda card',
    'grab the note',
    'i want to take the key',
    'please pick up the card',
  ],
  put: [
    'put key',
    'drop key',
    'put key on table',
    'drop the tape on desk',
    'put cassette into recorder',
    'place note under table',
  ],
  open: [
    'open',
    'open drawer',
    'open desk drawer',
    'open cabinet',
    'open the drawer',
    'open the compartment',
  ],
  close: [
    'close',
    'close drawer',
    'close desk drawer',
    'shut drawer',
    'close the drawer',
    'shut the compartment',
  ],
  quit: ['quit', 'exit'],
  goTo: [
    'go',
    'go office',
    'go logo',
    'walk office',
    'walk logo',
    'move office',
    'move logo',
    'go to the office',
    'go to office',
    'walk to the office',
    'walk to the logo',
    'move to the lamp',
    'move to logo',
    'head to the door',
    'go over to the desk',
    'go over to the office',
    'go over to the logo',
    'travel to the office',
    'walk over to the card reader',
    'move over to the console',
  ],
  showInventory: [
    'inventory',
    'inv',
    'items',
    'my items',
    'show inventory',
    'what do i have',
    'what am i carrying',
    'check my inventory',
    'show me my inventory',
    'list my items',
    'what items do i have',
    'open inventory',
  ],
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
          allowedEntityIds: ['miles_id'],
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
        type: 'actorUseOn',
        itemRef: 'use_item',
        targetRef: 'use_target',
        noEffectMessageId: 'no_effect_pair',
      },
    ],
    messages: {
      no_effect_pair: 'Using the {item} on the {target} does nothing.',
    },
  },
  {
    id: 'turn_tv_on',
    phrases: ['turn on tv', 'turn tv on'],
    arguments: [],
    plan: [
      {
        type: 'requireEntityAvailable',
        entityId: 'tv',
        scopes: ['visible'],
        missingMessageId: 'missing_tv',
      },
      {
        type: 'requireEntityAvailable',
        entityId: 'tv_rc',
        scopes: ['held', 'reachable'],
        missingMessageId: 'missing_remote',
      },
      {
        type: 'setEntityState',
        entityId: 'tv',
        stateId: 'power',
        value: 'on',
        missingMessageId: 'missing_power_state',
      },
      { type: 'showText', messageId: 'success' },
    ],
    messages: {
      missing_tv: "You don't see the TV here.",
      missing_remote: 'Эти современные телевизоры без пульта даже непонятно как включить.',
      missing_power_state: 'The TV refuses to respond.',
      success: 'The TV clicks on.',
    },
  },
  {
    id: 'turn_tv_off',
    phrases: ['turn off tv', 'turn tv off'],
    arguments: [],
    plan: [
      {
        type: 'requireEntityAvailable',
        entityId: 'tv',
        scopes: ['visible'],
        missingMessageId: 'missing_tv',
      },
      {
        type: 'requireAnyEntityAvailable',
        saveAs: 'turn_off_method',
        options: [
          { entityId: 'tv_rc', scopes: ['held', 'reachable'], saveAsValue: 'remote' },
          { entityId: 'tv', scopes: ['reachable'], saveAsValue: 'manual' },
        ],
        missingMessageId: 'missing_remote',
      },
      {
        type: 'setEntityState',
        entityId: 'tv',
        stateId: 'power',
        value: 'off',
        missingMessageId: 'missing_power_state',
      },
      {
        type: 'showText',
        messageId: 'success',
        messageIdByRef: {
          ref: 'turn_off_method',
          values: {
            manual: 'success_manual',
            remote: 'success',
          },
          fallbackMessageId: 'success',
        },
      },
    ],
    messages: {
      missing_tv: "You don't see the TV here.",
      missing_remote: 'Эти современные телевизоры без пульта даже непонятно как включить.',
      missing_power_state: 'The TV refuses to respond.',
      success: 'The TV clicks off.',
      success_manual: 'Fortunately, this thing can be turned off without the remote.',
    },
  },
];

export class TextAssetManager {
  private sceneCache = new Map<string, SceneTextAssetData | null>();
  private objectCache = new Map<string, ObjectTextAssetData | null>();
  private serviceCache = new Map<string, TextAssetData>();
  private parserLexiconCache: ParserLexiconAsset = structuredClone(DEFAULT_PARSER_LEXICON);
  private parserTrainingCache: ParserTrainingAsset = structuredClone(DEFAULT_PARSER_TRAINING);
  private parserCommandsCache: ParserCommandSpec[] = structuredClone(DEFAULT_PARSER_COMMANDS);
  private parserLexiconLoaded = false;
  private parserTrainingLoaded = false;
  private parserCommandsLoaded = false;

  private normalizeId(id: string): string {
    return String(id || '')
      .replace(/\//g, '\\')
      .trim();
  }

  private idToRelativePath(id: string): string {
    return this.normalizeId(id).replace(/\\/g, '/');
  }

  getSceneAssetProjectPath(sceneId: string): string {
    return `public/text/scenes/${this.idToRelativePath(sceneId)}.json`;
  }

  getObjectAssetProjectPath(objectId: string): string {
    return `public/text/objects/${this.idToRelativePath(objectId)}.json`;
  }

  private getSceneAssetUrl(sceneId: string): string {
    return `/text/scenes/${this.idToRelativePath(sceneId)}.json`;
  }

  private getObjectAssetUrl(objectId: string): string {
    return `/text/objects/${this.idToRelativePath(objectId)}.json`;
  }

  private getServiceAssetUrl(domain: string): string {
    return `/text/system/${domain}.json`;
  }

  private getDefaultServiceDomain(domain: string): TextAssetData {
    return { ...(DEFAULT_SERVICE_ASSETS[domain] || {}) };
  }

  getParserLexicon(): ParserLexiconAsset {
    return this.parserLexiconCache;
  }

  getParserTraining(): ParserTrainingAsset {
    return this.parserTrainingCache;
  }

  getParserCommands(): ParserCommandSpec[] {
    return this.parserCommandsCache;
  }

  buildDefaultSceneAsset(scene: Scene): SceneTextAssetData {
    return {
      title: scene.name || scene.id || 'Untitled Scene',
      description:
        scene.description || `You are in ${scene.name || scene.id || 'an unnamed scene'}.`,
      lore: '',
    };
  }

  buildDefaultObjectAsset(obj: SceneObject): ObjectTextAssetData {
    const subsceneComponent = Array.isArray((obj as any).components)
      ? (obj as any).components.find((component: any) => component?.type === 'Subscene')
      : null;
    const fallbackTitle =
      (obj as any).customName ||
      (typeof subsceneComponent?.title === 'string' && subsceneComponent.title.trim()
        ? subsceneComponent.title.trim()
        : '') ||
      obj.name ||
      obj.type ||
      'Object';
    const fallbackDescription =
      (typeof subsceneComponent?.description === 'string' && subsceneComponent.description.trim()
        ? subsceneComponent.description
        : '') ||
      (obj as any).description ||
      'You see nothing special.';
    return {
      title: fallbackTitle,
      description: fallbackDescription,
      details: '',
      lore: '',
      objectives: [],
      takeFailure: '',
      synonyms: [],
    };
  }

  async ensureSceneAssetFile(scene: Scene): Promise<void> {
    if (!scene?.id) return;
    const assetPath = this.getSceneAssetProjectPath(scene.id);
    const content = JSON.stringify(this.buildDefaultSceneAsset(scene), null, 2);
    await this.ensureFile(assetPath, content);
  }

  async ensureObjectAssetFile(obj: SceneObject): Promise<void> {
    if (!obj?.name || obj.type === 'Walkbox') return;
    const assetPath = this.getObjectAssetProjectPath(obj.name);
    const content = JSON.stringify(this.buildDefaultObjectAsset(obj), null, 2);
    await this.ensureFile(assetPath, content);
  }

  async openSceneAsset(scene: Scene): Promise<void> {
    const assetPath = this.getSceneAssetProjectPath(scene.id);
    const content = JSON.stringify(this.buildDefaultSceneAsset(scene), null, 2);
    await this.openFile(assetPath, content);
  }

  async openObjectAsset(obj: SceneObject): Promise<void> {
    if (!obj?.name || obj.type === 'Walkbox') return;
    const assetPath = this.getObjectAssetProjectPath(obj.name);
    const content = JSON.stringify(this.buildDefaultObjectAsset(obj), null, 2);
    await this.openFile(assetPath, content);
  }

  async deleteSceneAsset(scene: Scene): Promise<void> {
    await this.deleteFile(this.getSceneAssetProjectPath(scene.id));
    this.sceneCache.delete(this.normalizeId(scene.id));
  }

  async deleteObjectAsset(obj: SceneObject): Promise<void> {
    if (!obj?.name || obj.type === 'Walkbox') return;
    await this.deleteFile(this.getObjectAssetProjectPath(obj.name));
    this.objectCache.delete(this.normalizeId(obj.name));
  }

  async readSceneAsset(
    scene: Scene,
    forceReload: boolean = false
  ): Promise<SceneTextAssetData | null> {
    const sceneId = this.normalizeId(scene?.id || '');
    if (!sceneId) return null;
    if (!forceReload && this.sceneCache.has(sceneId)) {
      return this.sceneCache.get(sceneId) || null;
    }
    const data = this.normalizeSceneAssetData(await this.fetchJson(this.getSceneAssetUrl(sceneId)));
    this.sceneCache.set(sceneId, data);
    return data;
  }

  async readObjectAsset(
    obj: SceneObject,
    forceReload: boolean = false
  ): Promise<ObjectTextAssetData | null> {
    if (!obj?.name || obj.type === 'Walkbox') return null;
    const objectId = this.normalizeId(obj?.name || '');
    if (!objectId) return null;
    if (!forceReload && this.objectCache.has(objectId)) {
      return this.objectCache.get(objectId) || null;
    }
    const data = this.normalizeObjectAssetData(
      await this.fetchJson(this.getObjectAssetUrl(objectId))
    );
    this.objectCache.set(objectId, data);
    return data;
  }

  async preloadScene(scene: Scene): Promise<void> {
    await this.readSceneAsset(scene, true);
    await Promise.all(
      [...(scene.entities || []), ...(scene.triggerboxes || [])].map((object: SceneObject) =>
        this.readObjectAsset(object, true)
      )
    );
  }

  async preloadServiceAssets(domains?: string[]): Promise<void> {
    const targetDomains = domains?.length ? domains : Object.keys(DEFAULT_SERVICE_ASSETS);
    await Promise.all(targetDomains.map((domain) => this.readServiceAsset(domain, true)));
  }

  async preloadParserLanguageAssets(): Promise<void> {
    await Promise.all([
      this.readParserLexiconAsset(true),
      this.readParserTrainingAsset(true),
      this.readParserCommandAssets(true),
    ]);
  }

  clearCaches(): void {
    this.sceneCache.clear();
    this.objectCache.clear();
    this.serviceCache.clear();
    this.parserLexiconCache = structuredClone(DEFAULT_PARSER_LEXICON);
    this.parserTrainingCache = structuredClone(DEFAULT_PARSER_TRAINING);
    this.parserCommandsCache = structuredClone(DEFAULT_PARSER_COMMANDS);
    this.parserLexiconLoaded = false;
    this.parserTrainingLoaded = false;
    this.parserCommandsLoaded = false;
  }

  async readParserLexiconAsset(forceReload: boolean = false): Promise<ParserLexiconAsset> {
    if (!forceReload && this.parserLexiconLoaded) {
      return this.parserLexiconCache;
    }

    const loaded = (await this.fetchUnknownJson(
      '/text/system/parser-lexicon.json'
    )) as Partial<ParserLexiconAsset> | null;
    this.parserLexiconCache = {
      ...structuredClone(DEFAULT_PARSER_LEXICON),
      ...(loaded || {}),
      stage1Aliases: {
        ...DEFAULT_PARSER_LEXICON.stage1Aliases,
        ...(loaded?.stage1Aliases || {}),
      },
      normalizationPrefixes: {
        ...DEFAULT_PARSER_LEXICON.normalizationPrefixes,
        ...(loaded?.normalizationPrefixes || {}),
      },
      relationMarkers: {
        ...DEFAULT_PARSER_LEXICON.relationMarkers,
        ...(loaded?.relationMarkers || {}),
      },
    };
    this.parserLexiconLoaded = true;
    return this.parserLexiconCache;
  }

  async readParserTrainingAsset(forceReload: boolean = false): Promise<ParserTrainingAsset> {
    if (!forceReload && this.parserTrainingLoaded) {
      return this.parserTrainingCache;
    }

    const loaded = (await this.fetchUnknownJson(
      '/text/system/parser-training.json'
    )) as Partial<ParserTrainingAsset> | null;
    this.parserTrainingCache = {
      ...structuredClone(DEFAULT_PARSER_TRAINING),
      ...(loaded || {}),
    };
    this.parserTrainingLoaded = true;
    return this.parserTrainingCache;
  }

  async readParserCommandAssets(forceReload: boolean = false): Promise<ParserCommandSpec[]> {
    if (!forceReload && this.parserCommandsLoaded) {
      return this.parserCommandsCache;
    }

    const index = (await this.fetchUnknownJson('/text/system/commands/index.json')) as {
      commands?: string[];
    } | null;
    const ids = Array.isArray(index?.commands) ? index.commands.filter(Boolean) : [];

    if (!ids.length) {
      this.parserCommandsCache = structuredClone(DEFAULT_PARSER_COMMANDS);
      this.parserCommandsLoaded = true;
      return this.parserCommandsCache;
    }

    const loaded = await Promise.all(
      ids.map(async (id) => {
        const asset = (await this.fetchUnknownJson(
          `/text/system/commands/${id}.json`
        )) as ParserCommandSpec | null;
        return this.normalizeParserCommandSpec(asset);
      })
    );

    const commands = loaded.filter((command): command is ParserCommandSpec => !!command);
    this.parserCommandsCache = commands.length
      ? commands
      : structuredClone(DEFAULT_PARSER_COMMANDS);
    this.parserCommandsLoaded = true;
    return this.parserCommandsCache;
  }

  async readServiceAsset(domain: string, forceReload: boolean = false): Promise<TextAssetData> {
    const normalizedDomain = String(domain || '')
      .trim()
      .toLowerCase();
    if (!normalizedDomain) return {};
    if (!forceReload && this.serviceCache.has(normalizedDomain)) {
      return this.serviceCache.get(normalizedDomain) || {};
    }

    const defaults = this.getDefaultServiceDomain(normalizedDomain);
    const loaded = await this.fetchJson(this.getServiceAssetUrl(normalizedDomain));
    const merged = { ...defaults, ...(loaded || {}) };
    this.serviceCache.set(normalizedDomain, merged);
    return merged;
  }

  getResolvedSceneField(scene: Scene, field: string): string | null {
    const sceneId = this.normalizeId(scene?.id || '');
    const asset = sceneId ? this.sceneCache.get(sceneId) : null;
    const fallback = field === 'description' ? scene?.description || null : null;
    return this.resolveField(asset, scene?.textRedirects || null, field, fallback);
  }

  getResolvedObjectField(obj: SceneObject, field: string): string | null {
    if (obj?.type === 'Walkbox' && field === 'title') {
      return this.getServiceText('engine.floor_label');
    }
    const objectId = this.normalizeId(obj?.name || '');
    const asset = objectId ? this.objectCache.get(objectId) : null;
    const fallback = field === 'description' ? (obj as any).description || null : null;
    return this.resolveField(asset, obj?.textRedirects || null, field, fallback);
  }

  hasAuthoredObjectTitle(obj: SceneObject): boolean {
    const objectId = this.normalizeId(obj?.name || '');
    const asset = objectId ? this.objectCache.get(objectId) : null;
    const title = this.resolveField(asset, obj?.textRedirects || null, 'title', null);
    return !!title?.trim();
  }

  getResolvedObjectListField(obj: SceneObject, field: string): string[] {
    const objectId = this.normalizeId(obj?.name || '');
    const asset = objectId ? this.objectCache.get(objectId) : null;
    return this.resolveListField(asset, field);
  }

  getResolvedObjectStructuredListField<T>(
    obj: SceneObject,
    field: string,
    normalize: (value: unknown) => T | null
  ): T[] {
    const objectId = this.normalizeId(obj?.name || '');
    const asset = objectId ? this.objectCache.get(objectId) : null;
    const raw = asset?.[field];
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => normalize(item)).filter((item): item is T => item !== null);
  }

  getServiceText(key: string, params?: Record<string, string | number>, fallback?: string): string {
    const rawKey = String(key || '').trim();
    if (!rawKey) return fallback || '';

    const dotIndex = rawKey.indexOf('.');
    if (dotIndex === -1) {
      console.warn(`[TextAssetManager] Invalid service text key '${rawKey}'.`);
      return fallback || rawKey;
    }

    const domain = rawKey.slice(0, dotIndex).toLowerCase();
    const entryKey = rawKey.slice(dotIndex + 1);
    if (!entryKey) {
      console.warn(`[TextAssetManager] Invalid service text key '${rawKey}'.`);
      return fallback || rawKey;
    }

    if (!this.serviceCache.has(domain)) {
      this.serviceCache.set(domain, this.getDefaultServiceDomain(domain));
      void this.readServiceAsset(domain, true);
    }

    const domainAsset = this.serviceCache.get(domain) || {};
    const template = domainAsset[entryKey];
    const text = this.resolveTextValue(template);
    if (text === null) {
      console.warn(`[TextAssetManager] Missing service text '${rawKey}'.`);
      return fallback || rawKey;
    }

    return this.interpolate(text, params);
  }

  getServiceList(key: string): string[] {
    const rawKey = String(key || '').trim();
    if (!rawKey) return [];

    const dotIndex = rawKey.indexOf('.');
    if (dotIndex === -1) {
      console.warn(`[TextAssetManager] Invalid service list key '${rawKey}'.`);
      return [];
    }

    const domain = rawKey.slice(0, dotIndex).toLowerCase();
    const entryKey = rawKey.slice(dotIndex + 1);
    if (!entryKey) {
      console.warn(`[TextAssetManager] Invalid service list key '${rawKey}'.`);
      return [];
    }

    if (!this.serviceCache.has(domain)) {
      this.serviceCache.set(domain, this.getDefaultServiceDomain(domain));
      void this.readServiceAsset(domain, true);
    }

    return this.resolveListField(this.serviceCache.get(domain) || {}, entryKey);
  }

  private resolveField(
    asset: TextAssetData | null | undefined,
    redirects: Record<string, string> | null | undefined,
    field: string,
    fallback: string | null
  ): string | null {
    if (!asset) return fallback;
    const redirectTarget = redirects && redirects[field];
    if (redirectTarget) {
      const redirected = asset[redirectTarget];
      const redirectedText = this.resolveTextValue(redirected);
      if (redirectedText !== null) return redirectedText;
      console.warn(
        `[TextAssetManager] Missing redirected field '${redirectTarget}' for '${field}'.`
      );
    }
    const direct = asset[field];
    const directText = this.resolveTextValue(direct);
    if (directText !== null) return directText;
    return fallback;
  }

  private resolveTextValue(value: TextAssetValue | undefined): string | null {
    if (typeof value === 'string') return value;
    if (!Array.isArray(value)) return null;
    if (!value.every((item) => typeof item === 'string')) return null;
    return value.join('\n');
  }

  private resolveListField(asset: TextAssetData | null | undefined, field: string): string[] {
    const raw = asset?.[field];
    if (!Array.isArray(raw)) return [];
    const values: string[] = [];
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      const trimmed = item.trim();
      if (trimmed) values.push(trimmed);
    }
    return values;
  }

  private async fetchJson(url: string): Promise<TextAssetData | null> {
    return (await this.fetchUnknownJson(url)) as TextAssetData | null;
  }

  private normalizeParserCommandSpec(spec: ParserCommandSpec | null): ParserCommandSpec | null {
    if (
      !spec?.id ||
      !Array.isArray(spec.phrases) ||
      !Array.isArray(spec.arguments) ||
      !Array.isArray(spec.plan)
    ) {
      return null;
    }

    return {
      id: String(spec.id),
      phrases: spec.phrases.map((item) => String(item).trim()).filter(Boolean),
      arguments: spec.arguments.map((arg) => ({
        name: String(arg.name),
        kind: arg.kind === 'entity' ? 'entity' : 'entity',
        required: arg.required !== false,
        scopes: Array.isArray(arg.scopes) ? arg.scopes.filter(Boolean) : [],
        separatorsBefore: Array.isArray(arg.separatorsBefore)
          ? arg.separatorsBefore.map((item) => String(item).trim()).filter(Boolean)
          : undefined,
        messages: arg.messages || undefined,
        validation: arg.validation
          ? {
              allowedEntityIds: Array.isArray(arg.validation.allowedEntityIds)
                ? arg.validation.allowedEntityIds.map((item) => String(item).trim()).filter(Boolean)
                : undefined,
              allowedTitles: Array.isArray(arg.validation.allowedTitles)
                ? arg.validation.allowedTitles.map((item) => String(item).trim()).filter(Boolean)
                : undefined,
              allowedSynonyms: Array.isArray(arg.validation.allowedSynonyms)
                ? arg.validation.allowedSynonyms.map((item) => String(item).trim()).filter(Boolean)
                : undefined,
            }
          : undefined,
      })),
      plan: spec.plan,
      messages: spec.messages || undefined,
    };
  }

  private normalizeSceneAssetData(asset: TextAssetData | null): SceneTextAssetData | null {
    if (!asset) return null;
    const normalized: SceneTextAssetData = { ...asset };
    if (this.resolveTextValue(asset.title) !== null) {
      normalized.title = asset.title as TextAssetTextValue;
    }
    if (this.resolveTextValue(asset.description) !== null)
      normalized.description = asset.description as TextAssetTextValue;
    if (this.resolveTextValue(asset.lore) !== null)
      normalized.lore = asset.lore as TextAssetTextValue;
    return normalized;
  }

  private normalizeObjectAssetData(asset: TextAssetData | null): ObjectTextAssetData | null {
    if (!asset) return null;
    const normalized: ObjectTextAssetData = { ...asset };
    if (this.resolveTextValue(asset.title) !== null) {
      normalized.title = asset.title as TextAssetTextValue;
    }
    if (this.resolveTextValue(asset.description) !== null)
      normalized.description = asset.description as TextAssetTextValue;
    if (this.resolveTextValue(asset.details) !== null)
      normalized.details = asset.details as TextAssetTextValue;
    if (this.resolveTextValue(asset.lore) !== null)
      normalized.lore = asset.lore as TextAssetTextValue;
    if (Array.isArray(asset.objectives))
      normalized.objectives = asset.objectives.filter((item) => typeof item === 'string');
    if (this.resolveTextValue(asset.takeFailure) !== null)
      normalized.takeFailure = asset.takeFailure as TextAssetTextValue;
    normalized.synonyms = this.resolveListField(asset, 'synonyms');
    return normalized;
  }

  private async fetchUnknownJson(url: string): Promise<unknown | null> {
    try {
      // In Tauri distributions, read from local filesystem instead of bundled assets
      const { isTauriRuntime, readProjectFileExisting } = await import('../platform/fileApi');
      if (isTauriRuntime()) {
        const path = `public${url.split('?')[0]}`;
        try {
          const content = await readProjectFileExisting(path);
          return JSON.parse(content);
        } catch {
          return null;
        }
      }

      const response = await fetch(`${url}?t=${Date.now()}`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(await response.text());
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return null;
      }
      return await response.json();
    } catch (error) {
      console.error(`[TextAssetManager] error reading ${url}:`, error);
      return null;
    }
  }

  private interpolate(
    template: string,
    params?: Record<string, string | number> | null | undefined
  ): string {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_match, token: string) => {
      const value = params[token];
      return value === undefined || value === null ? `{${token}}` : String(value);
    });
  }

  private async ensureFile(filePath: string, content: string): Promise<void> {
    await ensureProjectFile(filePath, content);
  }

  private async saveFile(filePath: string, content: string): Promise<void> {
    await saveProjectFile(filePath, content);
  }

  private async openFile(filePath: string, content: string): Promise<void> {
    await openProjectFile(filePath, content);
  }

  async duplicateObjectAssetIfExists(
    sourceObjectId: string,
    targetObjectId: string
  ): Promise<void> {
    const sourceUrl = this.getObjectAssetUrl(sourceObjectId);
    const sourceData = this.normalizeObjectAssetData(await this.fetchJson(sourceUrl));
    if (!sourceData) return;

    const targetPath = this.getObjectAssetProjectPath(targetObjectId);
    await saveProjectFile(targetPath, JSON.stringify(sourceData, null, 2));
    this.objectCache.set(this.normalizeId(targetObjectId), sourceData);
  }

  async carrySceneAssetIfNeeded(
    previousSceneId: string | null | undefined,
    scene: Scene
  ): Promise<void> {
    const targetSceneId = this.normalizeId(scene?.id || '');
    const sourceSceneId = this.normalizeId(previousSceneId || '');

    if (!targetSceneId) return;

    if (sourceSceneId && sourceSceneId !== targetSceneId) {
      const targetData = this.normalizeSceneAssetData(
        await this.fetchJson(this.getSceneAssetUrl(targetSceneId))
      );
      if (!targetData) {
        const sourceData = this.normalizeSceneAssetData(
          await this.fetchJson(this.getSceneAssetUrl(sourceSceneId))
        );
        if (sourceData) {
          await this.saveFile(
            this.getSceneAssetProjectPath(targetSceneId),
            JSON.stringify(sourceData, null, 2)
          );
          this.sceneCache.set(targetSceneId, sourceData);
          return;
        }
      }
    }

    await this.ensureSceneAssetFile(scene);
  }

  private async deleteFile(filePath: string): Promise<void> {
    await deleteProjectFile(filePath);
  }
}
