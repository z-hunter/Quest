import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LlmCascade } from '../../src/mechanics/LlmCascade';
import { AnthropicProvider } from '../../src/mechanics/llm/AnthropicProvider';
import type {
  ILlmProvider,
  LlmProviderContent,
  LlmProviderMessage,
  LlmProviderResponse,
  LlmStreamDeltaCallback,
} from '../../src/mechanics/llm/ILlmProvider';
import type { ParserContext } from '../../src/mechanics/parserTypes';

class MockProvider implements ILlmProvider {
  response: LlmProviderResponse = { ok: true, text: '', model: 'mock', durationMs: 10 };
  messages: LlmProviderMessage[] = [];
  system: LlmProviderContent = '';

  isAvailable() {
    return true;
  }
  getProviderName() {
    return 'Mock';
  }
  getModelName() {
    return 'mock-model';
  }

  async sendMessage(
    system: LlmProviderContent,
    messages: LlmProviderMessage[]
  ): Promise<LlmProviderResponse> {
    this.system = system;
    this.messages = messages;
    return this.response;
  }

  async sendMessageStream(
    system: LlmProviderContent,
    messages: LlmProviderMessage[],
    onDelta: LlmStreamDeltaCallback
  ): Promise<LlmProviderResponse> {
    this.system = system;
    this.messages = messages;
    if (this.response.ok && this.response.text) {
      onDelta(this.response.text, this.response.text);
    }
    return this.response;
  }
}

describe('LlmCascade', () => {
  let provider: MockProvider;
  let cascade: LlmCascade;
  const mockPromptAssets = {
    previous_attempt_label: 'Previous parser attempt:',
    forced_handoff_label: 'Lower cascade interpretation:',
    forced_handoff_instructions: [
      'Cascade 1 test mode asks you to handle this command yourself.',
      'Use the lower cascade interpretation as a hint for what the dry machine parser would do.',
      'If you can give a richer, more atmospheric, and still grounded response, prefer final_response or showText.',
      'If the lower cascade action is genuinely the best answer, you may return that action plan.',
      "If the player's intent is recognized but no faithful executable equivalent fits it, invent a short atmospheric and logical Game Master response instead of calling a merely adjacent or unrelated standard action.",
      'Available actions are Game Master affordances.',
      'For entity, source, target, container, relation, or authored command argument ambiguity, use structured clarification with pendingAction.',
      'If you cannot improve the lower cascade result safely, return fallback.',
    ],
    post_api_escalation_instructions: [
      'The previous parser/game attempt escalated instead of completing.',
      'Do not repeat the same failing action unless you intentionally corrected the target, relation, or intent.',
      'If the requested action is impossible in the current world, return final_response or a showText action with a short in-world reason.',
    ],
    post_api_not_found_instructions: [
      'The previous parser/game attempt reported that it could not see the target. This often means the lower cascade misread a verb, adjective, or phrase fragment as the noun.',
      'Do not repeat the same failing action unless you intentionally corrected the target, relation, or intent.',
    ],
    post_api_recovery_instructions: [
      'The previous parser/game attempt recognized a command but ended in a recoverable failed outcome.',
      'First decide whether the lower parser likely misunderstood the player intent, target, relation, or action.',
      'If the intent and target are correct but the game outcome says the action is impossible, do not override game state.',
      'If you cannot improve the previous attempt safely or interestingly, return fallback.',
    ],
    world_fact_instructions: [
      'World facts are authoritative, including semantic facts generated from Text Assets.',
      'context.scene.recentTurns contains the last player-facing command/response turns from this current scene visit only.',
      'Before saying that a required object is missing, not loaded, not inserted, not fueled, empty, or unavailable, check worldFacts and entity contents/location.',
      'If an item is in inventory, it is held by the player character and is not inside or connected to a scene object unless the context explicitly says so.',
    ],
    parser_note_instructions: [
      'Parser Notes are private runtime memory for the parser Game Master.',
      'Entity Parser Notes must describe only that entity.',
      'A Parser Note with parserNoteNeedsCheck: true may be stale because the object or scene changed after the note was written.',
      "When any Parser Note in context has parserNoteNeedsCheck: true, resolving that stale note is part of the current task even if the player's command does not mention that object.",
    ],
    response_reminder: 'Respond with a single JSON object. Do not add any text outside the JSON.',
  };
  const mockContext: ParserContext = {
    rawInput: '',
    normalizedInput: '',
    entities: [],
    spatialNodes: [],
    inventory: [],
  };

  beforeEach(() => {
    provider = new MockProvider();
    cascade = new LlmCascade(
      provider,
      () =>
        ({
          readServiceAsset: vi.fn().mockResolvedValue(mockPromptAssets),
        }) as any,
      () => undefined
    );
  });

  it('accepts a valid plan response', async () => {
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [{ type: 'lookTarget', target: 'Logo' }],
    });

    const result = await cascade.parse('look at logo', mockContext);

    expect(result).not.toBeNull();
    expect(result?.output.kind).toBe('plan');
    expect(result?.output.actions).toEqual([{ type: 'lookTarget', target: 'Logo' }]);

    const debug = cascade.getLastDebugInfo();
    expect(debug?.matched).toBe(true);
    expect(debug?.acceptedActions).toHaveLength(1);
  });

  it('accepts putTarget as a faithful executable equivalent for throwing a held item', async () => {
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [
        { type: 'putTarget', item: 'Orange paper', target: 'floor', relation: 'on' },
        { type: 'showText', message: 'You send the orange paper skidding across the floor.' },
      ],
    });

    const result = await cascade.parse('throw orange paper', mockContext);

    expect(result?.output.kind).toBe('plan');
    expect(result?.output.actions).toEqual([
      { type: 'putTarget', item: 'Orange paper', target: 'floor', relation: 'on' },
      { type: 'showText', message: 'You send the orange paper skidding across the floor.' },
    ]);
  });

  it('accepts putTarget as a faithful executable equivalent for loading media into a device', async () => {
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [
        { type: 'putTarget', item: 'Compact cassette', target: 'Boombox', relation: 'in' },
        { type: 'showText', message: 'You slide the cassette into the boombox.' },
      ],
    });

    const result = await cascade.parse('load cassette', mockContext);

    expect(result?.output.kind).toBe('plan');
    expect(result?.output.actions).toEqual([
      { type: 'putTarget', item: 'Compact cassette', target: 'Boombox', relation: 'in' },
      { type: 'showText', message: 'You slide the cassette into the boombox.' },
    ]);
  });

  it('exposes authored parser commands to the LLM and accepts runCustomCommand', async () => {
    cascade = new LlmCascade(
      provider,
      () =>
        ({
          readServiceAsset: vi.fn().mockResolvedValue(mockPromptAssets),
          getParserCommands: () => [
            {
              id: 'turn_tv_on',
              phrases: ['turn on tv', 'turn tv on'],
              arguments: [],
              plan: [],
            },
          ],
        }) as any,
      () => undefined
    );
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [{ type: 'runCustomCommand', commandId: 'turn_tv_on' }],
    });

    const result = await cascade.parse('tv on', mockContext);

    expect(result?.output.kind).toBe('plan');
    expect(result?.output.actions).toEqual([
      { type: 'runCustomCommand', commandId: 'turn_tv_on', arguments: {} },
    ]);
    expect(String(provider.messages[0]?.content)).toContain('Available authored parser commands');
    expect(String(provider.messages[0]?.content)).toContain('"commandId": "turn_tv_on"');
  });

  it('filters runCustomCommand for unknown authored command ids', async () => {
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [{ type: 'runCustomCommand', commandId: 'missing_command' }],
    });

    const result = await cascade.parse('do missing command', mockContext);

    expect(result).toBeNull();
    expect(cascade.getLastDebugInfo()?.filteredActions).toEqual([
      { type: 'runCustomCommand', commandId: 'missing_command' },
    ]);
  });

  it('accepts direct Game Master world actions from the LLM', async () => {
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [
        { type: 'requireEntityAvailable', entityId: 'tv', scopes: ['visible'] },
        { type: 'setEntityState', entityId: 'tv', stateId: 'power', value: 'on' },
        { type: 'setGroupDisabled', groupId: '#tv_glow', disabled: false },
        { type: 'runScript', scriptId: 'tv_glow', restart: true },
        { type: 'showText', message: 'The TV clicks on.' },
      ],
    });

    const result = await cascade.parse('tv on', mockContext);

    expect(result?.output.kind).toBe('plan');
    expect(result?.output.actions).toEqual([
      { type: 'requireEntityAvailable', entityId: 'tv', scopes: ['visible'] },
      { type: 'setEntityState', entityId: 'tv', stateId: 'power', value: 'on', source: 'llm' },
      { type: 'setGroupDisabled', groupId: '#tv_glow', disabled: false },
      { type: 'runScript', scriptId: 'tv_glow', restart: true },
      { type: 'showText', message: 'The TV clicks on.' },
    ]);
    expect(String(provider.messages[0]?.content)).toContain('Direct Game Master world actions');
  });

  it('accepts direct Game Master world actions with a fields wrapper for compatibility', async () => {
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [
        {
          type: 'setEntityState',
          fields: { entityId: 'tv', stateId: 'power', value: 'on' },
        },
        { type: 'showText', message: 'The TV clicks on.' },
      ],
    });

    const result = await cascade.parse('tv on', mockContext);

    expect(result?.output.kind).toBe('plan');
    expect(result?.output.actions).toEqual([
      { type: 'setEntityState', entityId: 'tv', stateId: 'power', value: 'on', source: 'llm' },
      { type: 'showText', message: 'The TV clicks on.' },
    ]);
  });

  it('filters malformed direct Game Master world actions', async () => {
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [{ type: 'setEntityState', entityId: 'tv', stateId: 'power', value: { bad: true } }],
    });

    const result = await cascade.parse('tv on', mockContext);

    expect(result).toBeNull();
    expect(cascade.getLastDebugInfo()?.filteredActions).toEqual([
      { type: 'setEntityState', entityId: 'tv', stateId: 'power', value: { bad: true } },
    ]);
  });

  it('does not keep showText when a paired direct world action fails validation', async () => {
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [
        { type: 'setEntityState', entityId: 'tv', stateId: 'power', value: { bad: true } },
        { type: 'showText', message: 'The TV clicks on.' },
      ],
    });

    const result = await cascade.parse('tv on', mockContext);

    expect(result).toBeNull();
    expect(cascade.getLastDebugInfo()?.acceptedActions).toEqual([]);
    expect(cascade.getLastDebugInfo()?.filteredActions).toEqual(
      expect.arrayContaining([
        { type: 'setEntityState', entityId: 'tv', stateId: 'power', value: { bad: true } },
        expect.objectContaining({ reason: 'direct_world_action_failed_validation_omits_showText' }),
      ])
    );
  });

  it('keeps prompt assets free of implementation-leaking unsupported-action phrases', () => {
    const systemPrompt = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm-system.md'),
      'utf8'
    );
    const promptAsset = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm.json'),
      'utf8'
    );
    const combined = `${systemPrompt}\n${promptAsset}`.toLowerCase();

    expect(combined).not.toContain('no listening action');
    expect(combined).not.toContain('no active');
    expect(combined).not.toContain('mechanic exists');
    expect(combined).not.toContain('treat as examine');
    expect(combined).not.toContain('available parser actions');
    expect(combined).not.toContain('unrelated engine action');
    expect(combined).not.toContain('available engine actions');
    expect(combined).toContain('never mention parser mechanics');
    expect(combined).toContain('text assets');
    expect(combined).toContain('descriptions');
    expect(combined).toContain('source material');
    expect(combined).toContain('the boombox currently produces only static when tuned to radio');
  });

  it('keeps prompt assets explicit that hidden entities are not player knowledge', () => {
    const systemPrompt = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm-system.md'),
      'utf8'
    );
    const promptAsset = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm.json'),
      'utf8'
    );
    const combined = `${systemPrompt}\n${promptAsset}`.toLowerCase();

    expect(combined).toContain('not the player character');
    expect(combined).toContain('private game master knowledge, not player-character knowledge');
    expect(combined).toContain('knownentities');
    expect(combined).toContain('generate indirect sensory evidence');
    expect(combined).toContain('observable effects, sensations, traces, or environmental changes');
    expect(combined).toContain('exact nature');
    expect(combined).toContain('if the player asks for an undiscovered hidden entity by name');
    expect(combined).toContain('current perception and character knowledge');
    expect(combined).toContain('without confirming that the hidden entity is present there');
    expect(combined).toContain('something small and metallic rattles inside a box');
  });

  it('frames the LLM as a creative Game Master before action mapping', () => {
    const systemPrompt = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm-system.md'),
      'utf8'
    );
    const promptAsset = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm.json'),
      'utf8'
    );
    const combined = `${systemPrompt}\n${promptAsset}`;

    expect(systemPrompt).toContain('You are a creative Game Master');
    expect(systemPrompt).toContain('use every safe opportunity to immerse the player');
    expect(systemPrompt).not.toContain('You are not just a command parser');
    expect(combined).toContain('faithful executable equivalent');
    expect(combined).toContain('Available actions are Game Master affordances');
    expect(combined).toContain(
      'every successful inventory, containment, device, state, group, script, or persistent world change'
    );
    expect(combined).toContain('Do not narrate a successful inventory');
    expect(combined).toContain('merely adjacent or unrelated standard action');
  });

  it('keeps prompt assets explicit that entity ambiguity must use parser clarification', () => {
    const systemPrompt = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm-system.md'),
      'utf8'
    );
    const promptAsset = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm.json'),
      'utf8'
    );
    const combined = `${systemPrompt}\n${promptAsset}`;

    expect(combined).toContain('structured `clarification` with `pendingAction`');
    expect(combined).toContain(
      'return the intended action plan with the ambiguous title or phrase'
    );
    expect(combined).toContain('standard numbered clarification');
    expect(combined).toContain('keep the original command pending');
    expect(combined).toContain(
      'Do not ask a free-form entity-choice question without pendingAction'
    );
    expect(combined).toContain("keep the ambiguous field as the player's ambiguous phrase");
    expect(combined).toContain('do not preselect one option');
  });

  it('keeps prompt assets explicit that Parser Notes are not temporary player state', () => {
    const systemPrompt = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm-system.md'),
      'utf8'
    );
    const promptAsset = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm.json'),
      'utf8'
    );
    const combined = `${systemPrompt}\n${promptAsset}`;

    expect(combined).toContain('Entity Parser Notes must describe only that entity');
    expect(combined).toContain('Scene Parser Notes must describe only the scene or area');
    expect(combined).toContain('Do not store temporary player character actions');
    expect(combined).toContain('Narrate those moments in `showText` or `final_response`');
    expect(combined).toContain(
      'Bad Parser Note: `The player character is currently sitting on the sofa.`'
    );
    expect(combined).toContain(
      'Good Parser Note: `The sofa cushion has a shallow, temporary crease from being sat on.`'
    );
  });

  it('keeps prompt assets explicit that persistent narrated changes require Parser Notes', () => {
    const systemPrompt = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm-system.md'),
      'utf8'
    );
    const promptAsset = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm.json'),
      'utf8'
    );
    const combined = `${systemPrompt}\n${promptAsset}`;

    expect(combined).toContain(
      'If your response invents or changes a persistent small in-world fact'
    );
    expect(combined).toContain('such as a radio being left on');
    expect(combined).toContain(
      'return a `plan` with `showText` plus the appropriate Parser Note action'
    );
    expect(combined).toContain('Do not return that kind of persistent change as `final_response`');
    expect(combined).toContain(
      'when no safe action fits and you are not creating or updating a persistent Parser Note'
    );
  });

  it('keeps prompt assets explicit that stale Parser Notes must be checked', () => {
    const systemPrompt = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm-system.md'),
      'utf8'
    );
    const promptAsset = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm.json'),
      'utf8'
    );
    const combined = `${systemPrompt}\n${promptAsset}`;

    expect(combined).toContain('parserNoteNeedsCheck: true');
    expect(combined).toContain('resolving that stale note is part of the current task');
    expect(combined).toContain('Before giving the player-facing answer');
    expect(combined).toContain('replace it with a corrected note');
    expect(combined).toContain('clear it with an empty Parser Note');
    expect(combined).toContain('Do not leave a checked false Parser Note unchanged');
    expect(combined).toContain('if a note says a cassette inside a device is playing');
  });

  it('keeps prompt assets explicit that spatial world model beats word matching', () => {
    const systemPrompt = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm-system.md'),
      'utf8'
    );
    const promptAsset = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm.json'),
      'utf8'
    );
    const combined = `${systemPrompt}\n${promptAsset}`.toLowerCase();

    expect(combined).toContain('the physical model of the current scene');
    expect(combined).toContain('logical association');
    expect(combined).toContain('matching nouns');
    expect(combined).toContain('if an item is in inventory');
    expect(combined).toContain('held by the player character');
    expect(combined).toContain('not inside or connected to a scene object unless');
    expect(combined).toContain('do not claim that a scene object uses an unrelated inventory item');
    expect(combined).toContain('do not let word matches override the world model');
  });

  it('biases unsupported-intent refusals toward protagonist judgment instead of prop obstacles', () => {
    const systemPrompt = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm-system.md'),
      'utf8'
    );
    const promptAsset = readFileSync(
      join(process.cwd(), 'public/text/system/parser-llm.json'),
      'utf8'
    );
    const combined = `${systemPrompt}\n${promptAsset}`.toLowerCase();

    expect(combined).toContain('unsupported player intent');
    expect(combined).toContain('protagonist');
    expect(combined).toContain('choosing not to do it');
    expect(combined).toContain('lack of desire');
    expect(combined).toContain('over inventing a physical obstacle');
    expect(combined).toContain('nail');
    expect(combined).toContain('bolted');
    expect(combined).toContain('unless the current world model supports that');
  });

  it('stores the full prompt and raw response in debug info', async () => {
    provider.response.text = JSON.stringify({
      kind: 'final_response',
      message: 'Full response text.',
    });

    await cascade.parse('speak to the terminal', mockContext);

    const debug = cascade.getLastDebugInfo();
    expect(JSON.stringify(debug?.prompt?.system)).toContain('Respond with exactly one JSON object');
    expect(debug?.prompt?.messages[0]?.role).toBe('user');
    expect(String(debug?.prompt?.messages[0]?.content)).toContain(
      'Player command: "speak to the terminal"'
    );
    expect(JSON.stringify(debug?.prompt?.system)).toContain('World facts are authoritative');
    expect(JSON.stringify(debug?.prompt?.system)).toContain(
      'If an item is in inventory, it is held by the player character'
    );
    expect(JSON.stringify(debug?.prompt?.system)).toContain(
      'Parser Notes are private runtime memory'
    );
    expect(String(debug?.prompt?.messages[0]?.content)).toContain(
      'Per-call dynamic game world context'
    );
    expect(debug?.prompt?.staticPrompt?.cacheEligibleEstimate).toBe(false);
    expect(debug?.prompt?.staticPrompt?.cacheIneligibleReason).toContain('below 4096 tokens');
    expect(debug?.rawResponse).toBe(provider.response.text);
  });

  it('splits static scene prompt into cacheable system blocks and dynamic user context', async () => {
    provider.response.text = JSON.stringify({
      kind: 'final_response',
      message: 'Split response.',
    });
    const context: ParserContext = {
      rawInput: 'listen radio',
      normalizedInput: 'LISTEN RADIO',
      scene: {
        id: 'test_room',
        title: 'Test Room',
        description: 'A humming room.',
        recentTurns: [{ command: 'look radio', response: 'The radio hisses.' }],
      },
      entities: [
        {
          id: 'boombox',
          title: 'Boombox',
          description: 'A radio and cassette recorder.',
          parserNote: 'Reception is static.',
          parserNoteNeedsCheck: true,
        },
      ],
      worldFacts: ['Boombox contains Compact cassette.'],
      spatialNodes: [],
      inventory: [],
    };

    await cascade.parse('listen radio', context);

    expect(Array.isArray(provider.system)).toBe(true);
    const systemBlocks = provider.system as Exclude<LlmProviderContent, string>;
    expect(systemBlocks.at(-1)?.cacheControl).toEqual({ type: 'ephemeral', ttl: '5m' });
    expect(systemBlocks.at(-1)?.text).toContain('Scene-Static Context');
    expect(systemBlocks.at(-1)?.text).toContain('A radio and cassette recorder.');
    expect(systemBlocks.at(-1)?.text).not.toContain('Reception is static.');

    const userMessage = String(provider.messages[0]?.content || '');
    expect(userMessage).toContain('Per-call dynamic game world context');
    expect(userMessage).toContain('The radio hisses.');
    expect(userMessage).toContain('Reception is static.');
    expect(userMessage).toContain('Boombox contains Compact cassette.');
  });

  it('adds spoiler protection for hidden known entities and scrubs raw hidden details', async () => {
    provider.response.text = JSON.stringify({
      kind: 'final_response',
      message: 'You do not see any cables.',
    });
    const context: ParserContext = {
      rawInput: 'look for audio cables',
      normalizedInput: 'LOOK FOR AUDIO CABLES',
      scene: {
        id: 'test_room',
        title: "Mile's Home",
        description: 'A room full of electronics.',
      },
      entities: [
        {
          id: 'boombox',
          title: 'Boombox',
          description: 'A radio and cassette recorder.',
        },
      ],
      knownEntities: [
        {
          id: 'audio_cables',
          title: 'audio cables',
          location: { relation: 'behind', parentId: 'boombox', parentTitle: 'Boombox' },
          contents: [{ relation: 'in', id: 'wire_core', title: 'wire core' }],
          visibility: 'hidden',
          accessibility: 'inaccessible',
          hiddenReason: 'examinable',
          synonyms: ['cables', 'wires'],
          semanticTags: ['cable'],
          description: 'Hidden behind the boombox.',
          details: 'Two standard tape recorder cables.',
          lore: 'Private cable lore.',
          interactions: ['state:plugged'],
          states: [{ id: 'found', type: 'boolean', value: false }],
        },
      ],
      worldFacts: [],
      spatialNodes: [],
      inventory: [],
    };

    await cascade.parse('look for audio cables', context);

    const systemBlocks = provider.system as Exclude<LlmProviderContent, string>;
    const staticSceneText = systemBlocks.at(-1)?.text || '';
    const staticContext = JSON.parse(staticSceneText.slice(staticSceneText.indexOf('{')));
    const staticHidden = staticContext.knownEntities[0];
    expect(staticHidden).toMatchObject({
      id: 'audio_cables',
      title: 'audio cables',
      visibility: 'hidden',
      hiddenReason: 'examinable',
      synonyms: ['cables', 'wires'],
      semanticTags: ['cable'],
      states: [{ id: 'found', type: 'boolean', value: false }],
    });
    expect(staticHidden).not.toHaveProperty('location');
    expect(staticHidden).not.toHaveProperty('contents');
    expect(staticHidden).not.toHaveProperty('description');
    expect(staticHidden).not.toHaveProperty('details');
    expect(staticHidden).not.toHaveProperty('lore');
    expect(staticHidden).not.toHaveProperty('interactions');

    const userMessage = String(provider.messages[0]?.content || '');
    const dynamicContextText = userMessage
      .split('Per-call dynamic game world context:\n')[1]
      .split('\n\nHidden Objects / Spoiler Protection:')[0];
    const dynamicContext = JSON.parse(dynamicContextText);
    const dynamicHidden = dynamicContext.knownEntities[0];
    expect(dynamicHidden).toEqual(staticHidden);
    expect(JSON.stringify(dynamicContext)).not.toContain('Hidden behind the boombox');
    expect(dynamicHidden).not.toHaveProperty('location');
    expect(dynamicHidden).not.toHaveProperty('contents');
    expect(dynamicHidden).not.toHaveProperty('description');
    expect(dynamicHidden).not.toHaveProperty('details');
    expect(dynamicHidden).not.toHaveProperty('lore');

    expect(userMessage).toContain('Hidden Objects / Spoiler Protection:');
    expect(userMessage).toContain('- audio_cables: "audio cables" (also: "cables", "wires")');
    expect(userMessage).toContain('This is an adventure game');
    expect(userMessage).toContain('spoil the game');
    expect(userMessage).toContain('blind guess');
    expect(userMessage).toContain('Indirect, non-spoiling hints are allowed');
    expect(userMessage).toContain(
      'audio equipment is a reasonable thing to inspect when looking for cables'
    );
    expect(userMessage).toContain(
      'Direct reveals are forbidden, such as saying that the cables are behind the boombox.'
    );
  });

  it('converts final_response to a showText action', async () => {
    provider.response.text = JSON.stringify({
      kind: 'final_response',
      message: 'This is a final message.',
    });

    const result = await cascade.parse('hello', mockContext);

    expect(result?.output.actions).toEqual([
      { type: 'showText', message: 'This is a final message.' },
    ]);
  });

  it('rejects free-form clarification so entity ambiguity uses parser pending flow', async () => {
    provider.response.text = JSON.stringify({
      kind: 'clarification',
      question: 'Which one do you mean?',
    });

    const result = await cascade.parse('take it', mockContext);

    expect(result).toBeNull();
    expect(cascade.getLastDebugInfo()?.matched).toBe(false);
    expect(cascade.getLastDebugInfo()?.reason).toBe('invalid_response');
    expect(cascade.getLastDebugInfo()?.filteredActions).toEqual([
      {
        reason: 'llm_clarification_must_use_parser_pending_flow',
        response: {
          kind: 'clarification',
          question: 'Which one do you mean?',
        },
      },
    ]);
  });

  it('uses structured clarification pendingAction for parser numbered clarification', async () => {
    provider.response.text = JSON.stringify({
      kind: 'clarification',
      question: 'Load which cassette?',
      pendingAction: {
        type: 'putTarget',
        item: 'cassette',
        target: 'Boombox',
        relation: 'in',
      },
    });

    const result = await cascade.parse('load cassette', mockContext);

    expect(result?.output.actions).toEqual([
      {
        type: 'llmClarification',
        question: 'Load which cassette?',
        pendingActions: [
          { type: 'putTarget', item: 'cassette', target: 'Boombox', relation: 'in' },
        ],
      },
    ]);
    expect(cascade.getLastDebugInfo()?.filteredActions).toEqual([
      {
        reason: 'llm_structured_clarification_uses_pending_action',
        response: {
          kind: 'clarification',
          question: 'Load which cassette?',
          pendingAction: {
            type: 'putTarget',
            item: 'cassette',
            target: 'Boombox',
            relation: 'in',
          },
        },
        normalizedAction: {
          type: 'putTarget',
          item: 'cassette',
          target: 'Boombox',
          relation: 'in',
        },
      },
    ]);
  });

  it('normalizes structured load clarification pendingAction back to the ambiguous source phrase', async () => {
    provider.response.text = JSON.stringify({
      kind: 'clarification',
      question: 'Load which cassette?',
      pendingAction: {
        type: 'putTarget',
        item: "Cassette 'Music'",
        target: 'Boombox',
        relation: 'in',
      },
    });

    const result = await cascade.parse('load cassette', mockContext);

    expect(result?.output.actions).toEqual([
      {
        type: 'llmClarification',
        question: 'Load which cassette?',
        pendingActions: [
          { type: 'putTarget', item: 'cassette', target: 'Boombox', relation: 'in' },
        ],
      },
    ]);
    expect(cascade.getLastDebugInfo()?.filteredActions).toEqual([
      {
        reason: 'llm_structured_clarification_uses_pending_action',
        response: {
          kind: 'clarification',
          question: 'Load which cassette?',
          pendingAction: {
            type: 'putTarget',
            item: "Cassette 'Music'",
            target: 'Boombox',
            relation: 'in',
          },
        },
        normalizedAction: {
          type: 'putTarget',
          item: 'cassette',
          target: 'Boombox',
          relation: 'in',
        },
      },
    ]);
  });

  it('accepts Parser Note actions in a plan response', async () => {
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [
        { type: 'setSceneParserNote', note: 'The room has a sour electrical smell.' },
        { type: 'setEntityParserNote', entityId: 'boombox', note: 'Radio reception is static.' },
        { type: 'showText', message: 'Only static answers.' },
      ],
    });

    const result = await cascade.parse('listen radio', mockContext);

    expect(result?.output.actions).toEqual([
      { type: 'setSceneParserNote', note: 'The room has a sour electrical smell.' },
      { type: 'setEntityParserNote', entityId: 'boombox', note: 'Radio reception is static.' },
      { type: 'showText', message: 'Only static answers.' },
    ]);
  });

  it('accepts fenced Parser Note plans from provider responses', async () => {
    provider.response.text = `\`\`\`json
{
  "kind": "plan",
  "actions": [
    {
      "type": "showText",
      "message": "You reach over and flip on the boombox. The dial catches a station mid-song."
    },
    {
      "type": "setEntityParserNote",
      "entityId": "boombox",
      "note": "Radio is currently on, tuned to a station playing 80s pop and new wave music."
    }
  ]
}
\`\`\``;

    const result = await cascade.parse('listen radio', mockContext);

    expect(result?.output.actions).toEqual([
      {
        type: 'showText',
        message: 'You reach over and flip on the boombox. The dial catches a station mid-song.',
      },
      {
        type: 'setEntityParserNote',
        entityId: 'boombox',
        note: 'Radio is currently on, tuned to a station playing 80s pop and new wave music.',
      },
    ]);
    expect(cascade.getLastDebugInfo()?.extractedJson).toContain('"kind": "plan"');
  });

  it('filters invalid Parser Note actions', async () => {
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [
        { type: 'setSceneParserNote', note: 42 },
        { type: 'setEntityParserNote', entityId: '', note: 'No target.' },
        { type: 'showText', message: 'Still narrates.' },
      ],
    });

    const result = await cascade.parse('listen radio', mockContext);

    expect(result?.output.actions).toEqual([{ type: 'showText', message: 'Still narrates.' }]);
    expect(cascade.getLastDebugInfo()?.filteredActions).toHaveLength(2);
  });

  it('rejects Parser Note plans that do not include player-facing showText', async () => {
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [
        {
          type: 'setEntityParserNote',
          entityId: 'boombox',
          note: 'Radio is now on and tuned to a grainy jazz station.',
        },
        { type: 'examineTarget', target: 'Boombox' },
      ],
    });

    const result = await cascade.parse('listen radio', mockContext);

    expect(result).toBeNull();
    expect(cascade.getLastDebugInfo()?.filteredActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'parser_note_plan_requires_showText',
        }),
      ])
    );
  });

  it('filters ordinary world actions from Parser Note plans that include showText', async () => {
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [
        {
          type: 'setEntityParserNote',
          entityId: 'boombox',
          note: 'Radio is now on and tuned to a grainy jazz station.',
        },
        { type: 'examineTarget', target: 'Boombox' },
        { type: 'showText', message: 'Static and thin jazz crawl out of the speaker.' },
      ],
    });

    const result = await cascade.parse('listen radio', mockContext);

    expect(result?.output.actions).toEqual([
      {
        type: 'setEntityParserNote',
        entityId: 'boombox',
        note: 'Radio is now on and tuned to a grainy jazz station.',
      },
      { type: 'showText', message: 'Static and thin jazz crawl out of the speaker.' },
    ]);
    expect(cascade.getLastDebugInfo()?.filteredActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'parser_note_plan_omits_world_actions',
        }),
      ])
    );
  });

  it('treats explicit fallback as no LLM envelope', async () => {
    provider.response.text = JSON.stringify({ kind: 'fallback' });

    const result = await cascade.parse('take book', mockContext);

    expect(result).toBeNull();
    const debug = cascade.getLastDebugInfo();
    expect(debug?.matched).toBe(false);
    expect(debug?.reason).toBe('fallback');
    expect(debug?.error).toBeUndefined();
    expect(debug?.filteredActions).toEqual([]);
  });

  it('returns null and populates debug reason invalid_response for invalid JSON', async () => {
    provider.response.text = 'Not a JSON';

    const result = await cascade.parse('invalid', mockContext);

    expect(result).toBeNull();
    const debug = cascade.getLastDebugInfo();
    expect(debug?.reason).toBe('invalid_response');
    expect(debug?.error).toContain('valid JSON');
  });

  it('returns null and populates debug reason invalid_response for invalid shape', async () => {
    provider.response.text = JSON.stringify({ kind: 'plan', actions: 'not-actions' });

    const result = await cascade.parse('invalid shape', mockContext);

    expect(result).toBeNull();
    const debug = cascade.getLastDebugInfo();
    expect(debug?.reason).toBe('invalid_response');
    expect(debug?.filteredActions).toHaveLength(1);
  });

  it('returns null and populates api_error debug for provider error', async () => {
    provider.response = {
      ok: false,
      text: '',
      model: 'mock',
      error: 'API failure',
      reason: 'api_error',
      durationMs: 100,
    };

    const result = await cascade.parse('error', mockContext);

    expect(result).toBeNull();
    const debug = cascade.getLastDebugInfo();
    expect(debug?.reason).toBe('api_error');
    expect(debug?.error).toBe('API failure');
  });

  it('returns null and populates timeout debug for provider timeout', async () => {
    provider.response = {
      ok: false,
      text: '',
      model: 'mock',
      error: 'Request timed out',
      reason: 'timeout',
      durationMs: 10000,
    };

    const result = await cascade.parse('timeout', mockContext);

    expect(result).toBeNull();
    const debug = cascade.getLastDebugInfo();
    expect(debug?.reason).toBe('timeout');
    expect(debug?.error).toBe('Request timed out');
  });

  it('filters unknown action types and shows remaining in debug', async () => {
    provider.response.text = JSON.stringify({
      kind: 'plan',
      actions: [
        { type: 'lookTarget', target: 'Logo' },
        { type: 'unknownAction', data: 'junk' },
      ],
    });

    const result = await cascade.parse('look logo', mockContext);

    expect(result?.output.actions).toHaveLength(1);
    expect(result?.output.actions[0].type).toBe('lookTarget');

    const debug = cascade.getLastDebugInfo();
    expect(debug?.acceptedActions).toHaveLength(1);
    expect(debug?.filteredActions).toHaveLength(1);
    expect((debug?.filteredActions?.[0] as any).type).toBe('unknownAction');
  });

  it('includes previous escalation details when retrying after a parser attempt', async () => {
    provider.response.text = JSON.stringify({
      kind: 'final_response',
      message: 'The window has retired from public service.',
    });

    await cascade.parse('open window', mockContext, undefined, {
      envelope: {
        stage: 'regex-v1',
        output: {
          kind: 'plan',
          actions: [{ type: 'openTarget', target: 'Window' }],
        },
        debug: {
          rawInput: 'open window',
          normalizedInput: 'OPEN WINDOW',
          verb: 'OPEN',
          noun: 'window',
        },
      },
      result: {
        type: 'outcomes',
        outcomes: [{ status: 'escalate', code: 'target_is_not_switch' }],
      },
    });

    const userMessage = String(provider.messages[0]?.content || '');
    const systemPrompt = JSON.stringify(provider.system);
    expect(userMessage).toContain('Previous parser attempt');
    expect(userMessage).toContain('target_is_not_switch');
    expect(systemPrompt).toContain('Do not repeat the same failing action');
  });

  it('includes lower cascade interpretation in forced C1 handoff mode', async () => {
    provider.response.text = JSON.stringify({
      kind: 'final_response',
      message: 'There is more than one way to look.',
    });

    await cascade.parse('look in window', mockContext, undefined, {
      kind: 'forced_cascade_handoff',
      envelope: {
        stage: 'regex-v1',
        output: {
          kind: 'plan',
          actions: [{ type: 'lookRelationTarget', relation: 'in', anchor: 'window' }],
        },
        debug: {
          rawInput: 'look in window',
          normalizedInput: 'LOOK IN WINDOW',
          verb: 'LOOK',
          noun: 'window',
        },
      },
      result: {
        type: 'forced_cascade_handoff',
        reason: 'c1_off',
      },
    });

    const userMessage = String(provider.messages[0]?.content || '');
    const systemPrompt = JSON.stringify(provider.system);
    expect(userMessage).toContain('Lower cascade interpretation');
    expect(userMessage).toContain('lookRelationTarget');
    expect(systemPrompt).toContain('Cascade 1 test mode asks you to handle this command yourself');
    expect(systemPrompt).toContain('richer, more atmospheric');
    expect(systemPrompt).toContain('you may return that action plan');
  });

  it('includes recovery instructions for recoverable failed parser attempts', async () => {
    provider.response.text = JSON.stringify({
      kind: 'fallback',
    });

    await cascade.parse('take book', mockContext, undefined, {
      kind: 'post_api_recovery',
      envelope: {
        stage: 'regex-v1',
        output: {
          kind: 'plan',
          actions: [{ type: 'takeTarget', target: 'Book' }],
        },
        debug: {
          rawInput: 'take book',
          normalizedInput: 'TAKE BOOK',
          verb: 'TAKE',
          noun: 'book',
        },
      },
      result: {
        type: 'outcomes',
        outcomes: [{ status: 'failed', code: 'cannot_take', message: 'You cannot take that.' }],
      },
    });

    const userMessage = String(provider.messages[0]?.content || '');
    const systemPrompt = JSON.stringify(provider.system);
    expect(userMessage).toContain('Previous parser attempt');
    expect(userMessage).toContain('cannot_take');
    expect(systemPrompt).toContain('recoverable failed outcome');
    expect(systemPrompt).toContain('return fallback');
  });
});

describe('AnthropicProvider', () => {
  it('parses SSE content_block_delta chunks', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const emit = (event: string, data: unknown) => {
            controller.enqueue(encoder.encode(`event: ${event}\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          };
          emit('message_start', {
            type: 'message_start',
            message: {
              usage: {
                input_tokens: 100,
                cache_creation_input_tokens: 80,
                cache_read_input_tokens: 20,
              },
            },
          });
          emit('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: '{"kind":' },
          });
          emit('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: ' "plan"}' },
          });
          emit('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 15 },
          });
          controller.close();
        },
      }),
    });

    const provider = new AnthropicProvider({ fetchImpl: mockFetch });
    const deltas: string[] = [];
    const response = await provider.sendMessageStream(
      'system',
      [{ role: 'user', content: 'hi' }],
      (d) => deltas.push(d)
    );

    expect(response.ok).toBe(true);
    expect(response.text).toBe('{"kind": "plan"}');
    expect(deltas).toEqual(['{"kind":', ' "plan"}']);
    expect(response.tokensGenerated).toBe(15);
    expect(response.inputTokens).toBe(100);
    expect(response.cacheCreationInputTokens).toBe(80);
    expect(response.cacheReadInputTokens).toBe(20);
  });

  it('sends cache_control on structured system blocks through the proxy payload', async () => {
    let parsedBody: any = null;
    const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
      parsedBody = JSON.parse(String(init?.body || '{}'));
      return {
        ok: true,
        body: new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(
              encoder.encode(
                `event: content_block_delta\ndata: ${JSON.stringify({
                  delta: { text: '{"kind":"fallback"}' },
                })}\n\n`
              )
            );
            controller.close();
          },
        }),
      };
    });

    const provider = new AnthropicProvider({ fetchImpl: mockFetch });
    await provider.sendMessageStream(
      [
        { type: 'text', text: 'static rules' },
        {
          type: 'text',
          text: 'static scene',
          cacheControl: { type: 'ephemeral', ttl: '5m' },
        },
      ],
      [{ role: 'user', content: 'dynamic turn' }],
      () => {}
    );

    expect(parsedBody.system).toEqual([
      { type: 'text', text: 'static rules' },
      {
        type: 'text',
        text: 'static scene',
        cache_control: { type: 'ephemeral', ttl: '5m' },
      },
    ]);
    expect(parsedBody.messages).toEqual([{ role: 'user', content: 'dynamic turn' }]);
  });
});
