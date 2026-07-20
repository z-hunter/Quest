import { afterEach, describe, expect, it, vi } from 'vitest';
import { Actor } from '../../src/entities/Actor';
import { ActorPlanExecutor } from '../../src/mechanics/ActorPlanExecutor';
import { NpcWorldModelBuilder } from '../../src/mechanics/NpcWorldModelBuilder';
import { NpcPuppetMaster } from '../../src/mechanics/NpcPuppetMaster';
import { SceneManager } from '../../src/scene/SceneManager';
import { ComponentSystem } from '../../src/systems/ComponentSystem';
import type {
  ILlmProvider,
  LlmProviderContent,
  LlmProviderMessage,
  LlmProviderResponse,
  LlmStreamDeltaCallback,
} from '../../src/mechanics/llm/ILlmProvider';
import { createSceneFixture } from '../fixtures/sceneFactory';
import { createGameSemanticFixture } from '../fixtures/gameSemanticFactory';

class MockProvider implements ILlmProvider {
  lastSystem: LlmProviderContent | null = null;
  lastMessages: LlmProviderMessage[] = [];
  calls: Array<{ system: LlmProviderContent; messages: LlmProviderMessage[] }> = [];
  private responses: string[];
  private usage?: Partial<
    Pick<
      LlmProviderResponse,
      | 'durationMs'
      | 'inputTokens'
      | 'tokensGenerated'
      | 'cacheCreationInputTokens'
      | 'cacheReadInputTokens'
    >
  >;

  constructor(
    responseText: string | string[],
    usage?: Partial<
      Pick<
        LlmProviderResponse,
        | 'durationMs'
        | 'inputTokens'
        | 'tokensGenerated'
        | 'cacheCreationInputTokens'
        | 'cacheReadInputTokens'
      >
    >
  ) {
    this.responses = Array.isArray(responseText) ? [...responseText] : [responseText];
    this.usage = usage;
  }

  async sendMessage(
    system: LlmProviderContent,
    messages: LlmProviderMessage[]
  ): Promise<LlmProviderResponse> {
    this.lastSystem = system;
    const formattedMessages = messages.map((msg) => {
      if (typeof msg.content === 'string') {
        const lines = msg.content.split('\n');
        if (
          lines[0] === 'Per-call dynamic NPC context:' ||
          lines[0] === 'Strategy-only NPC context:'
        ) {
          try {
            const json = JSON.parse(lines[1]);
            lines[1] = JSON.stringify(json, null, 2);
            return { ...msg, content: lines.join('\n') };
          } catch (e) {
            // ignore JSON parse errors
          }
        }
      }
      return msg;
    });
    this.lastMessages = formattedMessages;
    this.calls.push({ system, messages: formattedMessages });
    return {
      ok: true,
      text: this.responses.shift() || '{"kind":"pm_response","plans":[]}',
      durationMs: this.usage?.durationMs ?? 0,
      inputTokens: this.usage?.inputTokens,
      tokensGenerated: this.usage?.tokensGenerated,
      cacheCreationInputTokens: this.usage?.cacheCreationInputTokens,
      cacheReadInputTokens: this.usage?.cacheReadInputTokens,
    };
  }

  async sendMessageStream(
    system: LlmProviderContent,
    messages: LlmProviderMessage[],
    _onDelta: LlmStreamDeltaCallback
  ): Promise<LlmProviderResponse> {
    return this.sendMessage(system, messages);
  }

  isAvailable(): boolean {
    return true;
  }

  getProviderName(): string {
    return 'mock';
  }

  getModelName(): string {
    return 'mock-npc';
  }
}

function addNpc(fixture: ReturnType<typeof createSceneFixture>, id: string): Actor {
  const npc = new Actor(fixture.game, 20, 20, 10, 10, id);
  npc.components = [{ type: 'Actor' }, { type: 'NPC', memory: 'Old note.' }];
  fixture.scene.addEntity(npc);
  fixture.textAssets.setObject(id, {
    title: 'Security Guard',
    description: 'A watchful guard.',
    lore: 'Guard the door.',
    objectives: ['Check IDs'],
  });
  return npc;
}

function getStaticPmText(call: MockProvider['calls'][number]): string {
  expect(Array.isArray(call.system)).toBe(true);
  const blocks = call.system as Exclude<LlmProviderContent, string>;
  return blocks.map((block) => block.text).join('');
}

function getDynamicPmText(call: MockProvider['calls'][number]): string {
  return String(call.messages[0]?.content || '');
}

describe('NpcPuppetMaster', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the deterministic static prefix stable across runtime state changes', async () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero');
    addNpc(fixture, 'guard');
    const terminal = fixture.addEntity('terminal', {
      title: 'Terminal',
      description: 'An authored control terminal.',
      components: [
        { type: 'State', id: 'power', valueType: 'string', initialValue: 'off', value: 'off' },
      ],
    });
    const provider = new MockProvider([
      '{"kind":"pm_response","plans":[]}',
      '{"kind":"pm_response","plans":[]}',
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processNpc(fixture.scene, 'guard');
    (terminal.components.find((component: any) => component.type === 'State') as any).value = 'on';
    await pm.processNpc(fixture.scene, 'guard');

    expect(getStaticPmText(provider.calls[1])).toBe(getStaticPmText(provider.calls[0]));
    expect(getDynamicPmText(provider.calls[0])).toContain('"value": "off"');
    expect(getDynamicPmText(provider.calls[1])).toContain('"value": "on"');
  });

  it('does not expose or accept a generic USE step for Puppet Master', async () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    fixture.addEntity('remote', { title: 'Remote', components: [{ type: 'Item' }] });
    fixture.addEntity('tv', { title: 'TV' });
    const provider = new MockProvider(
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: npc.name, steps: [{ type: 'USE', itemId: 'remote', targetId: 'tv' }] }],
      })
    );
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processNpc(fixture.scene, npc.name);
    const system = getStaticPmText(provider.calls[0]);

    expect(plans).toEqual([]);
    expect(system).not.toContain('{ "type": "USE"');
    expect(system).toContain('never invent a generic use action');
  });

  it('changes the static prefix when authored scene structure changes', async () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero');
    addNpc(fixture, 'guard');
    fixture.addEntity('terminal', { title: 'Terminal', description: 'Original authored text.' });
    const provider = new MockProvider([
      '{"kind":"pm_response","plans":[]}',
      '{"kind":"pm_response","plans":[]}',
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processNpc(fixture.scene, 'guard');
    fixture.textAssets.setObject('terminal', {
      title: 'Terminal',
      description: 'Changed authored text.',
      lore: 'New authored lore.',
    });
    await pm.processNpc(fixture.scene, 'guard');

    expect(getStaticPmText(provider.calls[1])).not.toBe(getStaticPmText(provider.calls[0]));
    expect(getStaticPmText(provider.calls[1])).toContain('Changed authored text.');
    expect(getStaticPmText(provider.calls[1])).toContain('New authored lore.');
  });

  it('keeps runtime fields dynamic and sends cache_control on the authored prefix', async () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero');
    addNpc(fixture, 'guard');
    fixture.addEntity('cabinet', {
      title: 'Cabinet',
      description: 'A steel cabinet.',
      lore: 'Installed before the war.',
      components: [{ type: 'Switch', state: 1, blockedRelation: 'in' }],
    });
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processNpc(fixture.scene, 'guard');

    const blocks = provider.calls[0].system as Exclude<LlmProviderContent, string>;
    const staticText = getStaticPmText(provider.calls[0]);
    const dynamicText = getDynamicPmText(provider.calls[0]);
    expect(blocks.at(-1)?.cacheControl).toEqual({ type: 'ephemeral', ttl: '5m' });
    expect(staticText).toContain('A steel cabinet.');
    expect(staticText).toContain('Installed before the war.');
    expect(staticText).not.toContain('"inspection"');
    expect(staticText).not.toContain('"visibility"');
    expect(staticText).not.toContain('"interaction"');
    expect(staticText).not.toContain('"approach"');
    expect(staticText).not.toContain('"lastSeenSceneId"');
    expect(staticText).not.toContain('"state": "closed"');
    expect(dynamicText).not.toContain('"interaction":"reachable"');
    expect(dynamicText).toContain('"state": "closed"');
    expect(dynamicText).not.toContain('A steel cabinet.');
    expect(dynamicText).not.toContain('Installed before the war.');
    expect(dynamicText).not.toContain('"inspection"');
    expect(dynamicText).toMatch(new RegExp(`"scene":\\s*\\{\\s*"id":\\s*"${fixture.scene.id}"`));
    expect(dynamicText).not.toContain('"description": "You are in Test Scene."');
    expect(dynamicText).not.toContain('"lore":');
  });

  it('states that the static entity catalog does not prove current physical presence', async () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processNpc(fixture.scene, npc.name);

    const system = JSON.stringify(provider.calls[0].system);
    const message = String(provider.calls[0].messages[0].content);
    expect(system).toContain('catalog membership never proves');
    expect(system).toContain('plan_rejected_missing_items');
    expect(message).toContain('Static catalog membership is not current presence');
  });

  it('instructs visible NPC listeners to answer direct player speech or explain silence', async () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processNpc(fixture.scene, npc.name);

    const system = JSON.stringify(provider.calls[0].system);
    expect(system).toContain('direct player speech received by a visible listening NPC');
    expect(system).toContain(
      'Never say in reasoning that the NPC should answer and then return no plan.'
    );
    expect(system).toContain('Omit it for a plan consisting solely of SAY or one obvious MOVE_TO');
  });

  it('executes valid SAY plans and stores NPC memory', async () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    const dialogue: string[] = [];
    (fixture.game as any).console = {
      log(text: string, type?: string) {
        dialogue.push(`${type || 'output'}:${text}`);
      },
    };
    (fixture.game as any).sayAsActor = (actor: Actor, text: string) => {
      const displayName = fixture.textAssets.getResolvedObjectField(actor, 'title') || actor.name;
      dialogue.push(`dialogue:${displayName}: ${text}`);
      fixture.scene.sceneLog.appendSpeech({
        actorId: actor.name,
        displayName,
        text,
        knownByNpcIds: [],
        timestamp: 1200,
      });
    };
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Hello.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const provider = new MockProvider(
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: 'guard',
            steps: [{ type: 'SAY', text: 'Let me see your ID.' }],
            memory: 'Miles greeted the guard.',
          },
        ],
      })
    );
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processScene(fixture.scene);

    expect(plans).toHaveLength(1);
    expect(dialogue).toContain('dialogue:Security Guard: Let me see your ID.');
    expect(
      (npc.components.find((component: any) => component.type === 'NPC') as any).memory
    ).toEqual(['Miles greeted the guard.']);
    expect(fixture.scene.sceneLog.getUnreadEntries()).toHaveLength(0);
    expect(JSON.stringify(provider.lastSystem)).not.toContain('Check IDs');
    expect(JSON.stringify(provider.lastMessages)).toContain('Check IDs');
    expect(JSON.stringify(provider.lastMessages)).toContain('Old note.');
  });

  it('prints PM prompt and response debug when #PEEKPM is enabled', async () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    fixture.addEntity('visible_key', {
      title: 'Visible key',
      components: [{ type: 'Item' }],
    });
    const debugLogs: string[] = [];
    (fixture.game as any).console = {
      parserPeekPmEnabled: true,
      log(text: string) {
        debugLogs.push(text);
      },
    };
    (fixture.game as any).sayAsActor = () => {};
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Hello.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    fixture.scene.sceneLog.appendAction({
      actorId: player.name,
      displayName: 'Miles',
      text: '[ Miles is examining Boombox ]',
      knownByActorIds: [npc.name],
      timestamp: 1001,
      payload: { action: 'examine', targetId: 'boombox' },
    });
    const pm = new NpcPuppetMaster(
      fixture.game,
      new MockProvider(
        JSON.stringify({
          kind: 'pm_response',
          plans: [{ npcId: 'guard', steps: [{ type: 'SAY', text: 'Hello, Miles.' }] }],
        }),
        {
          durationMs: 123,
          inputTokens: 456,
          tokensGenerated: 32,
          cacheCreationInputTokens: 111,
          cacheReadInputTokens: 222,
        }
      )
    );

    await pm.processScene(fixture.scene);

    const output = debugLogs.join('\n');
    expect(output).toContain('--- PM PROMPT ---');
    expect(output).toContain('--- PM RESPONSE ---');
    expect(output).toContain('Action: [ Miles is examining Boombox ]');
    expect(output).toContain('Hello, Miles.');
    expect(output).toContain('Plan for guard:');
    expect(output).toContain('mock-npc (mock)');
    expect(output).toContain('0.12s');
    expect(output).toContain('Tokens: 456 in, 32 out');
    expect(output).toContain('Cache: 222 read, 111 created');
    expect(output).toContain('Dynamic prompt:');
    expect(output).toContain('knownEntities:');
    expect(output).not.toContain('"lastSeenSceneId"');
  });

  it('shows optional model reasoning only in Puppet Master diagnostics', async () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero');
    addNpc(fixture, 'guard');
    const debugLogs: string[] = [];
    (fixture.game as any).console = {
      parserPeekPmEnabled: true,
      logDebug(text: string) {
        debugLogs.push(text);
      },
    };
    const pm = new NpcPuppetMaster(
      fixture.game,
      new MockProvider(
        JSON.stringify({
          kind: 'pm_response',
          reasoning: 'The guard has no new event requiring action.',
          plans: [],
        })
      )
    );

    await pm.processNpc(fixture.scene, 'guard');

    expect(pm.getLastDebugInfo()?.reasoning).toBe('The guard has no new event requiring action.');
    expect(debugLogs.join('\n')).toContain(
      'Reasoning: The guard has no new event requiring action.'
    );
  });

  it('deduplicates current actors and items from the dynamic knowledge index', async () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero');
    addNpc(fixture, 'guard');
    fixture.addEntity('visible_key', {
      title: 'Visible key',
      components: [{ type: 'Item' }],
    });
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processNpc(fixture.scene, 'guard');

    const prompt = getDynamicPmText(provider.calls[0]);
    expect(prompt).not.toContain('"actors"');
    expect(prompt).not.toContain('"visibleItemIds"');
    expect(prompt).not.toContain('"knownEntities"');
    expect(prompt).toContain('visible_key');
  });

  it('prints PM prompt and response debug when the general #PEEKLLM mode is enabled', async () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    const debugLogs: string[] = [];
    (fixture.game as any).console = {
      parserPeekLlmEnabled: true,
      parserPeekPmEnabled: false,
      isOpen: true,
      logDebug(text: string) {
        debugLogs.push(text);
      },
    };
    (fixture.game as any).sayAsActor = () => {};
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Hello.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const pm = new NpcPuppetMaster(
      fixture.game,
      new MockProvider(
        JSON.stringify({
          kind: 'pm_response',
          plans: [{ npcId: 'guard', steps: [{ type: 'SAY', text: 'Hello, Miles.' }] }],
        })
      )
    );

    await pm.processScene(fixture.scene);

    expect(debugLogs.join('\n')).toContain('--- PM LLM PROMPT ---');
    expect(debugLogs.join('\n')).toContain('--- PM LLM RESPONSE ---');
  });

  it('initializes runtime NPC objectives from object text assets', () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const component = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    delete component.objectives;

    const world = new NpcWorldModelBuilder(fixture.game).build(fixture.scene);

    expect(world.npcs?.[0]?.objectives).toEqual([
      expect.objectContaining({ text: 'Check IDs', subtasks: [] }),
    ]);
    expect(component.objectives).toEqual([
      expect.objectContaining({ text: 'Check IDs', subtasks: [] }),
    ]);
    expect(component.objectivesInitializedFromTA).toBe(true);
    expect(component.objectivesTARevision).toBe(JSON.stringify(['Check IDs']));
  });

  it('keeps changed runtime NPC objectives instead of re-reading text asset defaults', () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const component = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    component.objectives = ['Keep Miles away from the server room'];

    const world = new NpcWorldModelBuilder(fixture.game).build(fixture.scene);

    expect(world.npcs?.[0]?.objectives).toEqual([
      expect.objectContaining({ text: 'Keep Miles away from the server room', subtasks: [] }),
    ]);
    expect(component.objectives).toEqual([
      expect.objectContaining({ text: 'Keep Miles away from the server room', subtasks: [] }),
    ]);
  });

  it('executes structured memory and objective operations', async () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    (fixture.game as any).sayAsActor = () => {};
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Can you watch the hallway?',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const pm = new NpcPuppetMaster(
      fixture.game,
      new MockProvider(
        JSON.stringify({
          kind: 'pm_response',
          plans: [
            {
              npcId: 'guard',
              steps: [
                {
                  type: 'MEMORY_ADD',
                  memory: 'Miles asked the guard to watch the hallway.',
                },
                {
                  type: 'OBJECTIVE_ADD',
                  parentId: null,
                  objective: {
                    text: 'Watch the hallway',
                    subtasks: [{ text: 'Report suspicious visitors', subtasks: [] }],
                  },
                },
              ],
            },
          ],
        })
      )
    );

    await pm.processScene(fixture.scene);

    const component = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    expect(component.memory).toEqual(['Old note.', 'Miles asked the guard to watch the hallway.']);
    expect(component.objectives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'Watch the hallway',
          subtasks: [expect.objectContaining({ text: 'Report suspicious visitors' })],
        }),
      ])
    );
    expect(component.objectivesInitializedFromTA).toBe(true);

    const addedObjective = component.objectives.find(
      (objective: any) => objective.text === 'Watch the hallway'
    );
    const childId = addedObjective.subtasks[0].id;
    const executor = new ActorPlanExecutor(fixture.game);
    expect(
      executor.executePlan({
        npcId: npc.name,
        steps: [
          { type: 'MEMORY_REMOVE', memory: 'Old note.' },
          { type: 'OBJECTIVE_UPDATE', objectiveId: childId, text: 'Ask visitors to report in' },
          { type: 'OBJECTIVE_MARK_COMPLETED', objectiveId: childId },
        ],
      })
    ).toEqual([
      expect.objectContaining({ code: 'npc_memory_removed' }),
      expect.objectContaining({ code: 'npc_objective_updated' }),
      expect.objectContaining({ code: 'npc_objective_marked_completed' }),
    ]);
    expect(component.memory).toEqual(['Miles asked the guard to watch the hallway.']);
    expect(
      component.objectives.find((objective: any) => objective.text === 'Watch the hallway').subtasks
    ).toEqual([expect.objectContaining({ text: 'Ask visitors to report in', completed: true })]);
    expect(
      executor.executePlan({
        npcId: npc.name,
        steps: [{ type: 'OBJECTIVE_UPDATE', objectiveId: 'missing', text: 'Never happens' }],
      })
    ).toEqual([expect.objectContaining({ status: 'failed', code: 'objective_not_found' })]);
    expect(
      executor.executePlan({
        npcId: npc.name,
        steps: [
          {
            type: 'OBJECTIVE_ADD',
            parentId: 'missing',
            objective: { text: 'Never happens', subtasks: [] },
          },
        ],
      })
    ).toEqual([expect.objectContaining({ status: 'failed', code: 'objective_parent_not_found' })]);
  });

  it('shows marked objectives once to PM and then automatically removes them', async () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    const component = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    component.objectives = [
      { id: 'done', text: 'Find the batteries', subtasks: [], completed: true },
      { id: 'next', text: 'Install the batteries', subtasks: [] },
    ];
    component.objectivesInitializedFromTA = true;
    component.objectivesTARevision = fixture.textAssets.getResolvedObjectListRevision(
      npc,
      'objectives'
    );
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processNpc(fixture.scene, npc.name);

    expect(getDynamicPmText(provider.calls[0])).toContain('Find the batteries [JUST COMPLETED]');
    expect(component.objectives).toEqual([
      expect.objectContaining({ id: 'next', text: 'Install the batteries' }),
    ]);
    expect(getStaticPmText(provider.calls[0])).toContain('OBJECTIVE_MARK_COMPLETED');
    expect(getStaticPmText(provider.calls[0])).toContain('does not perform the task');
  });

  it('instructs PM to audit all durable memory and objectives on every call', async () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    const pm = new NpcPuppetMaster(
      fixture.game,
      new MockProvider('{"kind":"pm_response","plans":[]}')
    );

    await pm.processNpc(fixture.scene, npc.name);

    const system = getStaticPmText((pm as any).provider.calls[0]);
    expect(system).toContain('On EVERY call');
    expect(system).toContain('every objective (including every subtask)');
    expect(system).toContain('every memory note');
    expect(system).toContain('primarily for your own benefit');
    expect(system).toContain('do not emit no-op cognition steps');
    expect(system).toContain('retain the parent goal');
    expect(system).toContain('immediate concrete subgoal');
    expect(system).toContain('before dependent physical steps');
  });

  it('filters malformed objective operation steps', async () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Hello.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const pm = new NpcPuppetMaster(
      fixture.game,
      new MockProvider(
        JSON.stringify({
          kind: 'pm_response',
          plans: [{ npcId: 'guard', steps: [{ type: 'OBJECTIVE_ADD', objective: 'oops' }] }],
        })
      )
    );

    const plans = await pm.processScene(fixture.scene);

    expect(plans).toEqual([]);
    expect(pm.getLastDebugInfo()?.filteredPlans).toHaveLength(1);
  });

  it('backfills legacy empty runtime NPC objectives from text assets once', () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const component = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    component.objectives = [];
    delete component.objectivesInitializedFromTA;

    const world = new NpcWorldModelBuilder(fixture.game).build(fixture.scene);

    expect(world.npcs?.[0]?.objectives).toEqual([
      expect.objectContaining({ text: 'Check IDs', subtasks: [] }),
    ]);
    expect(component.objectives).toEqual([
      expect.objectContaining({ text: 'Check IDs', subtasks: [] }),
    ]);
    expect(component.objectivesInitializedFromTA).toBe(true);
  });

  it('preserves deliberately cleared runtime NPC objectives', () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const component = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    component.objectives = [];
    component.objectivesInitializedFromTA = true;
    component.objectivesTARevision = fixture.textAssets.getResolvedObjectListRevision(
      npc,
      'objectives'
    );

    const world = new NpcWorldModelBuilder(fixture.game).build(fixture.scene);

    expect(world.npcs?.[0]?.objectives).toBeUndefined();
    expect(component.objectives).toEqual([]);
    expect(component.objectivesInitializedFromTA).toBe(true);
  });

  it('reinitializes empty runtime objectives when TA objectives change', () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const component = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    component.objectives = [];
    component.objectivesInitializedFromTA = true;
    component.objectivesTARevision = fixture.textAssets.getResolvedObjectListRevision(
      npc,
      'objectives'
    );
    fixture.textAssets.setObject('guard', {
      title: 'Security Guard',
      objectives: ['Inspect the new delivery'],
    });

    const world = new NpcWorldModelBuilder(fixture.game).build(fixture.scene);

    expect(world.npcs?.[0]?.objectives).toEqual([
      expect.objectContaining({ text: 'Inspect the new delivery', subtasks: [] }),
    ]);
    expect(component.objectives).toEqual([
      expect.objectContaining({ text: 'Inspect the new delivery', subtasks: [] }),
    ]);
    expect(component.objectivesTARevision).toBe(JSON.stringify(['Inspect the new delivery']));
  });

  it('keeps semantically titled objects and fallback floor surfaces in NPC visible entity context', () => {
    const fixture = createSceneFixture();
    const floor = fixture.addWalkbox('Walk_main');
    floor.components = [{ type: 'Surface', relation: 'on', capacity: 4, groups: [], items: [] }];
    const emptyWalkbox = fixture.addWalkbox('Walk_empty');
    const remote = fixture.addEntity('tv_rc', { title: 'TV remote' });
    remote.spatial = { parentNodeId: floor.name, relation: 'on' };
    const noTitle = fixture.addEntity('decor_noise', { title: null });
    const authoredFloor = fixture.addEntity('floor-parallax', { title: 'Floor' });
    addNpc(fixture, 'guard');

    const world = new NpcWorldModelBuilder(fixture.game).build(fixture.scene);

    const visible = world.npcs?.[0]?.entities || [];
    const ids = visible.map((entity) => entity.id);
    expect(ids).toContain(remote.name);
    expect(ids).toContain(authoredFloor.name);
    expect(ids).toContain(floor.name);
    expect(ids).not.toContain(emptyWalkbox.name);
    expect(ids).not.toContain(noTitle.name);
    expect(visible.find((entity) => entity.id === remote.name)?.location).toEqual({
      relation: 'on',
      targetId: floor.name,
      targetTitle: 'floor',
    });
  });

  it('records scene-aware NPC knowledge and lists immediately visible items', () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const remote = fixture.addEntity('tv_rc', {
      title: 'TV remote',
      components: [{ type: 'Item' }],
    });
    const disabledDecoration = fixture.addEntity('disabled_prop', {
      title: 'Disabled prop',
      disabled: true,
    });
    const visibleObject = fixture.addEntity('ordinary_object', { title: 'Ordinary object' });
    const invisibleItem = fixture.addEntity('inventory_ghost', {
      title: 'Inventory ghost',
      components: [{ type: 'Item' }],
    });
    invisibleItem.visible = false;
    const rawComponent = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    rawComponent.knownEntities = {
      stale_object: {
        id: 'stale_object',
        title: 'Stale object',
        kind: 'object',
        lastSeenSceneId: fixture.scene.id,
        lastSeenAt: 1,
      },
    };

    const world = new NpcWorldModelBuilder(fixture.game).build(fixture.scene);
    const context = world.npcs[0];
    const component = ComponentSystem.getNpcComponent(npc)!;

    expect(context.visibleItemIds).toContain(remote.name);
    expect(
      context.entities.find((entry) => entry.id === remote.name)?.lastSeenSceneId
    ).toBeUndefined();
    expect(context.knownEntities).toContainEqual(
      expect.objectContaining({
        id: remote.name,
        kind: 'item',
        lastSeenSceneId: undefined,
      })
    );
    expect(component.knownEntities?.[remote.name]?.lastSeenSceneId).toBe(fixture.scene.id);
    expect(context.entities.some((entry) => entry.id === disabledDecoration.name)).toBe(false);
    expect(component.knownEntities?.[disabledDecoration.name]).toBeUndefined();
    expect(context.entities.some((entry) => entry.id === visibleObject.name)).toBe(true);
    expect(context.visibleItemIds).not.toContain(invisibleItem.name);
    expect(context.entities.some((entry) => entry.id === invisibleItem.name)).toBe(false);
    expect(component.knownEntities?.[invisibleItem.name]).toBeUndefined();
    expect(component.knownEntities?.[visibleObject.name]).toBeUndefined();
    expect(component.knownEntities?.stale_object).toBeUndefined();
  });

  it('updates remembered item location when an observed actor takes it', () => {
    const fixture = createSceneFixture();
    const observer = addNpc(fixture, 'guard');
    const taker = addNpc(fixture, 'linda');
    const cassette = fixture.addEntity('cassette', {
      title: 'Compact cassette',
      components: [{ type: 'Item' }],
    });
    new NpcWorldModelBuilder(fixture.game).build(fixture.scene, { npcIds: [observer.name] });

    fixture.scene.sceneLog.appendAction({
      actorId: taker.name,
      displayName: 'Linda',
      text: '[ Linda takes Compact cassette ]',
      knownByActorIds: [observer.name],
      timestamp: 2000,
      payload: { action: 'take', itemId: cassette.name },
    });
    const context = new NpcWorldModelBuilder(fixture.game).build(fixture.scene, {
      npcIds: [observer.name],
    }).npcs[0];
    const remembered = context.knownEntities.find((entry) => entry.id === cassette.name);

    expect(remembered?.lastSeenLocation).toEqual({
      sceneId: fixture.scene.id,
      relation: 'in',
      targetId: taker.name,
      targetTitle: 'Security Guard',
    });
  });

  it('updates remembered item location when an observed actor puts it into another inventory', () => {
    const fixture = createSceneFixture();
    const observer = addNpc(fixture, 'guard');
    const giver = addNpc(fixture, 'linda');
    const receiver = addNpc(fixture, 'rick');
    fixture.game.inventoryManager.ensureInventoryComponent(receiver, 'in');
    const cassette = fixture.addEntity('cassette', {
      title: 'Compact cassette',
      components: [{ type: 'Item' }],
    });
    new NpcWorldModelBuilder(fixture.game).build(fixture.scene, { npcIds: [observer.name] });

    fixture.scene.sceneLog.appendAction({
      actorId: giver.name,
      displayName: 'Linda',
      text: '[ Linda puts Compact cassette on Rick ]',
      knownByActorIds: [observer.name],
      timestamp: 2000,
      payload: { action: 'put', itemId: cassette.name, targetId: receiver.name },
    });
    const context = new NpcWorldModelBuilder(fixture.game).build(fixture.scene, {
      npcIds: [observer.name],
    }).npcs[0];
    const remembered = context.knownEntities.find((entry) => entry.id === cassette.name);

    expect(remembered?.lastSeenLocation).toEqual({
      sceneId: fixture.scene.id,
      relation: 'in',
      targetId: receiver.name,
      targetTitle: 'Security Guard',
    });
  });

  it('projects Exit affordances and lets a reachable NPC traverse the Exit', () => {
    const fixture = createGameSemanticFixture('start');
    fixture.addPlayer('Hero', 0, 0);
    const npc = new Actor(fixture.game as any, 20, 20);
    npc.name = 'guard';
    npc.components = [{ type: 'Actor' }, { type: 'NPC', enabled: true }];
    fixture.scene.addEntity(npc);
    npc.x = 20;
    npc.y = 20;
    const targetScene = fixture.addScene('corridor', 'Corridor', 'A corridor.');
    const entry = fixture.addTriggerbox('EntryA', {
      scene: targetScene,
      components: [{ type: 'Entry', direction: 'right' }],
    });
    entry.poly = [
      { x: 90, y: 90 },
      { x: 110, y: 90 },
      { x: 110, y: 110 },
      { x: 90, y: 110 },
    ];
    const door = fixture.addEntity('door', {
      title: 'Door',
      components: [
        {
          type: 'Exit',
          targetSceneId: targetScene.id,
          targetEntryId: entry.name,
          portal: true,
          collider: false,
        },
      ],
    });
    door.x = 30;
    door.y = 20;

    const context = new NpcWorldModelBuilder(fixture.game).build(fixture.scene).npcs[0];
    expect(context.entities.find((entity) => entity.id === door.name)?.exit).toEqual({
      targetSceneId: targetScene.id,
      targetEntryId: entry.name,
      targetSceneTitle: 'Corridor',
      portal: true,
      collider: false,
    });

    const outcomes = new ActorPlanExecutor(fixture.game).executePlan({
      npcId: npc.name,
      steps: [{ type: 'TRAVERSE_EXIT', targetId: door.name }],
    });

    expect(outcomes[0]).toEqual(expect.objectContaining({ status: 'ok', code: 'exit_traversed' }));
    expect(targetScene.entities).toContain(npc);
    expect(fixture.game.sceneManager.currentScene).toBe(fixture.scene);

    const completion = new ActorPlanExecutor(fixture.game).executePlan({
      npcId: npc.name,
      steps: [],
      memory: 'Reached the corridor.',
    });
    expect(completion).toEqual([
      expect.objectContaining({ status: 'ok', code: 'npc_memory_updated' }),
    ]);
    expect(ComponentSystem.getNpcComponent(npc)?.memory).toEqual(['Reached the corridor.']);
  });

  it('omits a navigation-only Exit from PM context and NPC known-entity memory', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    const serviceLink = fixture.addTriggerbox('service_link', {
      title: 'Maintenance passage',
      components: [
        {
          type: 'Exit',
          targetSceneId: '',
          targetEntryId: 'service_entry',
          navigationOnly: true,
        },
      ],
    });

    const builder = new NpcWorldModelBuilder(fixture.game);
    const world = builder.build(fixture.scene);
    const context = world.npcs.find((entry) => entry.id === npc.name);
    const component = ComponentSystem.getNpcComponent(npc);

    expect(builder.buildStaticEntityProjection(fixture.scene)).not.toContainEqual(
      expect.objectContaining({ id: serviceLink.name })
    );
    expect(context?.entities.some((entity) => entity.id === serviceLink.name)).toBe(false);
    expect(context?.knownEntities.some((entity) => entity.id === serviceLink.name)).toBe(false);
    expect(component?.knownEntities?.[serviceLink.name]).toBeUndefined();
  });

  it('inserts MOVE_TO before route-available TRAVERSE_EXIT plans', async () => {
    const fixture = createGameSemanticFixture('start');
    fixture.addPlayer('Hero', 0, 0);
    const floor = fixture.addWalkbox('Floor');
    floor.poly = [
      { x: -20, y: -20 },
      { x: 120, y: -20 },
      { x: 120, y: 80 },
      { x: -20, y: 80 },
    ];
    const npc = new Actor(fixture.game as any, 0, 20);
    npc.name = 'guard';
    npc.components = [{ type: 'Actor' }, { type: 'NPC', enabled: true }];
    fixture.scene.addEntity(npc);
    const targetScene = fixture.addScene('corridor', 'Corridor', 'A corridor.');
    const door = fixture.addEntity('door', {
      title: 'Door',
      components: [{ type: 'Exit', targetSceneId: targetScene.id, portal: true }],
    });
    door.x = 90;
    door.y = 20;
    const provider = new MockProvider(
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: npc.name, steps: [{ type: 'TRAVERSE_EXIT', targetId: door.name }] }],
      })
    );
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processNpc(fixture.scene, npc.name);

    expect(plans[0].steps).toEqual([
      { type: 'MOVE_TO', targetId: door.name },
      { type: 'TRAVERSE_EXIT', targetId: door.name },
    ]);
    expect(npc.getMoveResult().status).toBe('started');
    expect(fixture.game.sceneManager.currentScene).toBe(fixture.scene);
  });

  it('lets an NPC inspect the current scene as a read-only LOOK anchor', () => {
    const fixture = createGameSemanticFixture('corridor');
    const npc = new Actor(fixture.game as any, 20, 20);
    npc.name = 'guard';
    npc.components = [{ type: 'Actor' }, { type: 'NPC', enabled: true }];
    fixture.scene.addEntity(npc);

    const outcome = new ActorPlanExecutor(fixture.game).executePlan({
      npcId: npc.name,
      steps: [{ type: 'LOOK', targetId: fixture.scene.id, relation: 'in' }],
    })[0];

    expect(outcome).toEqual(
      expect.objectContaining({
        status: 'ok',
        code: 'scene_looked',
        targetId: fixture.scene.id,
        worldChanged: false,
        discoveredEntityIds: [],
      })
    );
  });

  it('treats TRAVERSE_EXIT as the terminal step of a normalized PM plan', () => {
    const fixture = createSceneFixture();
    addNpc(fixture, 'guard');
    const pm = new NpcPuppetMaster(fixture.game, new MockProvider(''));

    const plan = (pm as any).normalizePlan(
      {
        npcId: 'guard',
        steps: [
          { type: 'MOVE_TO', targetId: 'door' },
          { type: 'TRAVERSE_EXIT', targetId: 'door' },
          { type: 'LOOK', targetId: 'old_scene' },
        ],
        memory: 'Crossing the door.',
      },
      new Set(['guard'])
    );

    expect(plan.steps).toEqual([
      { type: 'MOVE_TO', targetId: 'door' },
      { type: 'TRAVERSE_EXIT', targetId: 'door' },
    ]);
  });

  it('processes a destination batch while that scene is not current', async () => {
    vi.useFakeTimers();
    const fixture = createGameSemanticFixture('start');
    const destination = fixture.addScene('corridor', 'Corridor', 'A corridor.');
    const npc = new Actor(fixture.game as any, 20, 20);
    npc.name = 'guard';
    npc.components = [{ type: 'Actor' }, { type: 'NPC', enabled: true }];
    destination.addEntity(npc);
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);
    const staticProjection = vi.spyOn((pm as any).worldModelBuilder, 'buildStaticEntityProjection');

    void (pm as any).enqueueNpc(destination, 'guard', { type: 'manual' });
    expect((pm as any).pendingBatches.has(destination.id)).toBe(true);
    await vi.advanceTimersByTimeAsync(500);

    expect((pm as any).pendingBatches.has(destination.id)).toBe(false);
    expect(provider.calls).toHaveLength(1);
    expect(String(provider.calls[0].messages[0].content)).toContain('"id": "corridor"');
    expect(staticProjection).toHaveBeenCalledWith(destination);
    vi.useRealTimers();
  });

  it('resolves an NPC wait continuation after the player leaves the NPC scene', async () => {
    vi.useFakeTimers();
    const fixture = createGameSemanticFixture('start');
    const corridor = fixture.addScene('corridor', 'Corridor', 'A corridor.');
    const npc = new Actor(fixture.game as any, 20, 20);
    npc.name = 'guard';
    npc.components = [{ type: 'Actor' }, { type: 'NPC', enabled: true }];
    corridor.addEntity(npc);
    fixture.game.sceneManager.currentScene = corridor;
    const pm = new NpcPuppetMaster(fixture.game, new MockProvider(''));
    const stateKey = `${corridor.id}:${npc.name}`;
    (pm as any).pendingPlanContinuations.set(stateKey, {
      state: 'awaiting_barrier',
      npcId: npc.name,
      barrierStep: { type: 'WAIT', ms: 100 },
      steps: [],
      interruptOn: [],
      completedSteps: [],
      trackCompletion: true,
    });
    (pm as any).continuationStates.set(stateKey, {
      state: 'awaiting_barrier',
      changedAt: Date.now(),
    });

    (pm as any).scheduleNpcWait(npc.name, 100);
    fixture.game.sceneManager.currentScene = fixture.scene;
    await vi.advanceTimersByTimeAsync(600);

    expect((pm as any).pendingPlanContinuations.has(stateKey)).toBe(false);
    vi.useRealTimers();
  });

  it('builds PM batch context only for selected NPCs', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const guard = addNpc(fixture, 'guard');
    addNpc(fixture, 'bystander');
    const getKnownObjects = vi.spyOn(fixture.game.actorWorld, 'getKnownObjects');
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);

    void (pm as any).enqueueNpc(fixture.scene, guard.name, { type: 'manual' });
    await vi.runAllTimersAsync();

    expect(provider.calls).toHaveLength(1);
    expect(getKnownObjects.mock.calls.map(([actor]) => actor.name)).toEqual([guard.name]);
  });

  it('defers same-scene batch requeues while a provider call is still running', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const guard = addNpc(fixture, 'guard');
    const bystander = addNpc(fixture, 'bystander');
    let resolveFirst: (() => void) | null = null;
    class SlowProvider extends MockProvider {
      async sendMessage(
        system: LlmProviderContent,
        messages: LlmProviderMessage[]
      ): Promise<LlmProviderResponse> {
        this.lastSystem = system;
        this.lastMessages = messages;
        this.calls.push({ system, messages });
        if (this.calls.length === 1) {
          await new Promise<void>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return {
          ok: true,
          text: '{"kind":"pm_response","plans":[]}',
          durationMs: 0,
        };
      }
    }
    const provider = new SlowProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);

    void (pm as any).enqueueNpc(fixture.scene, guard.name, { type: 'manual' });
    await vi.advanceTimersByTimeAsync(200);
    expect(provider.calls).toHaveLength(1);

    void (pm as any).enqueueNpc(fixture.scene, bystander.name, { type: 'manual' });
    await vi.advanceTimersByTimeAsync(900);
    expect(provider.calls).toHaveLength(1);

    resolveFirst?.();
    await vi.advanceTimersByTimeAsync(200);
    expect(provider.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(provider.calls).toHaveLength(2);
    expect(JSON.stringify(provider.calls[1].messages)).toContain(bystander.name);
  });

  it('includes authoritative current scene for each active NPC in dynamic prompt', async () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    const component = ComponentSystem.getNpcComponent(npc);
    if (component) component.memory = 'I just went to the corridor.';
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processNpc(fixture.scene, npc.name);

    const content = String(provider.calls[0].messages[0].content);
    const jsonStart = content.indexOf('{');
    let jsonEnd = -1;
    let depth = 0;
    for (let index = jsonStart; index < content.length; index++) {
      if (content[index] === '{') depth++;
      if (content[index] === '}' && --depth === 0) {
        jsonEnd = index;
        break;
      }
    }
    const dynamic = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
    expect(dynamic.scene.id).toBe(fixture.scene.id);
    expect(dynamic.npcs[0].currentSceneId).toBe(fixture.scene.id);
  });

  it('executes a source-scene Exit continuation after the active scene has changed', async () => {
    vi.useFakeTimers();
    const fixture = createGameSemanticFixture('start');
    const destination = fixture.addScene('corridor', 'Corridor', 'A corridor.');
    const npc = new Actor(fixture.game as any, 20, 20);
    npc.name = 'guard';
    npc.components = [{ type: 'Actor' }, { type: 'NPC', enabled: true }];
    destination.addEntity(npc);
    fixture.game.sceneManager.currentScene = destination;
    const pm = new NpcPuppetMaster(fixture.game, new MockProvider(''));
    (pm as any).pendingPlanContinuations.set('start:guard', {
      npcId: 'guard',
      barrierStep: { type: 'TRAVERSE_EXIT', targetId: 'door' },
      steps: [],
      memory: 'Reached the corridor.',
      interruptOn: [],
      completedSteps: [],
      trackCompletion: true,
    });

    void (pm as any).enqueueNpc(fixture.scene, 'guard', {
      type: 'action_completed',
      result: {
        status: 'ok',
        code: 'exit_traversed',
        npcId: 'guard',
        targetId: 'door',
        actionType: 'TRAVERSE_EXIT',
        worldChanged: true,
      },
    });
    await vi.advanceTimersByTimeAsync(500);

    expect(ComponentSystem.getNpcComponent(npc)?.memory).toEqual(['Reached the corridor.']);
    expect(ComponentSystem.getNpcComponent(npc)?.transientMemory).toEqual([]);
    expect((pm as any).pendingPlanContinuations.has('start:guard')).toBe(false);
    vi.useRealTimers();
  });

  it('matches a source-scene Exit continuation when its completion arrives in the destination', async () => {
    vi.useFakeTimers();
    const fixture = createGameSemanticFixture('start');
    const destination = fixture.addScene('corridor', 'Corridor', 'A corridor.');
    const npc = new Actor(fixture.game as any, 20, 20);
    npc.name = 'guard';
    npc.components = [{ type: 'Actor' }, { type: 'NPC', enabled: true }];
    destination.addEntity(npc);
    const provider = new MockProvider(
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: 'guard', steps: [{ type: 'SAY', text: 'I made it to the corridor.' }] }],
      })
    );
    const pm = new NpcPuppetMaster(fixture.game, provider);
    (fixture.game as any).sayAsActor = () => {};
    (pm as any).pendingPlanContinuations.set('start:guard', {
      state: 'awaiting_barrier',
      npcId: 'guard',
      barrierStep: { type: 'TRAVERSE_EXIT', targetId: 'door' },
      steps: [],
      memory: 'Need to find Rick for batteries.',
      interruptOn: [],
      completedSteps: [],
      trackCompletion: true,
    });

    void (pm as any).enqueueNpc(destination, 'guard', {
      type: 'action_completed',
      result: {
        status: 'ok',
        code: 'exit_traversed',
        npcId: 'guard',
        targetId: 'door',
        actionType: 'TRAVERSE_EXIT',
        worldChanged: true,
      },
    });
    await vi.advanceTimersByTimeAsync(500);

    expect(fixture.game.sceneManager.currentScene).toBe(fixture.scene);
    expect(ComponentSystem.getNpcComponent(npc)?.memory).toEqual([
      'Need to find Rick for batteries.',
    ]);
    expect(ComponentSystem.getNpcComponent(npc)?.transientMemory).toEqual([]);
    expect((pm as any).pendingPlanContinuations.has('start:guard')).toBe(false);
    expect(provider.calls).toHaveLength(1);
    expect(JSON.stringify(provider.calls[0].messages)).toContain('plan_completed');
    vi.useRealTimers();
  });

  it('treats a successful Exit traversal as completion before WORLD_CHANGED interrupts', async () => {
    vi.useFakeTimers();
    const fixture = createGameSemanticFixture('start');
    const destination = fixture.addScene('corridor', 'Corridor', 'A corridor.');
    const npc = new Actor(fixture.game as any, 20, 20);
    npc.name = 'guard';
    npc.components = [{ type: 'Actor' }, { type: 'NPC', enabled: true }];
    destination.addEntity(npc);
    fixture.game.sceneManager.currentScene = destination;
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);
    (pm as any).pendingPlanContinuations.set('start:guard', {
      npcId: 'guard',
      barrierStep: { type: 'TRAVERSE_EXIT', targetId: 'door' },
      steps: [],
      memory: 'Reached the corridor.',
      interruptOn: [{ type: 'WORLD_CHANGED' }],
      completedSteps: [],
      trackCompletion: true,
    });

    void (pm as any).enqueueNpc(fixture.scene, 'guard', {
      type: 'action_completed',
      result: {
        status: 'ok',
        code: 'exit_traversed',
        npcId: 'guard',
        targetId: 'door',
        actionType: 'TRAVERSE_EXIT',
        worldChanged: true,
      },
    });
    await vi.advanceTimersByTimeAsync(500);

    expect(ComponentSystem.getNpcComponent(npc)?.memory).toEqual(['Reached the corridor.']);
    expect(ComponentSystem.getNpcComponent(npc)?.transientMemory).toEqual([]);
    expect(JSON.stringify(provider.calls.map((call) => call.messages))).toContain('plan_completed');
    expect(JSON.stringify(provider.calls.map((call) => call.messages))).not.toContain(
      'plan_interrupted'
    );
  });

  it('records destination arrival memory after Exit traversal without plan memory', async () => {
    vi.useFakeTimers();
    const fixture = createGameSemanticFixture('start');
    const destination = fixture.addScene('corridor', 'Corridor', 'A corridor.');
    const npc = new Actor(fixture.game as any, 20, 20);
    npc.name = 'guard';
    npc.components = [{ type: 'Actor' }, { type: 'NPC', enabled: true }];
    destination.addEntity(npc);
    fixture.game.sceneManager.currentScene = destination;
    const pm = new NpcPuppetMaster(fixture.game, new MockProvider(''));
    (pm as any).pendingPlanContinuations.set('start:guard', {
      npcId: 'guard',
      barrierStep: { type: 'TRAVERSE_EXIT', targetId: 'door' },
      steps: [],
      interruptOn: [],
      completedSteps: [],
      trackCompletion: true,
    });

    void (pm as any).enqueueNpc(fixture.scene, 'guard', {
      type: 'action_completed',
      result: {
        status: 'ok',
        code: 'exit_traversed',
        npcId: 'guard',
        targetId: 'door',
        actionType: 'TRAVERSE_EXIT',
        worldChanged: true,
      },
    });
    await vi.advanceTimersByTimeAsync(500);

    expect(ComponentSystem.getNpcComponent(npc)?.memory).toEqual([]);
    expect(ComponentSystem.getNpcComponent(npc)?.transientMemory).toEqual([]);
  });

  it('preserves durable memory and exposes arrival memory only for the next PM turn', async () => {
    vi.useFakeTimers();
    const fixture = createGameSemanticFixture('start');
    const destination = fixture.addScene('corridor', 'Corridor', 'A corridor.');
    const npc = new Actor(fixture.game as any, 20, 20);
    npc.name = 'guard';
    npc.components = [
      { type: 'Actor' },
      { type: 'NPC', enabled: true, memory: ['Rick repairs electronics.'] },
    ];
    destination.addEntity(npc);
    fixture.game.sceneManager.currentScene = destination;
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);
    (pm as any).pendingPlanContinuations.set('start:guard', {
      npcId: 'guard',
      barrierStep: { type: 'TRAVERSE_EXIT', targetId: 'door' },
      steps: [],
      interruptOn: [],
      completedSteps: [],
      trackCompletion: true,
    });

    void (pm as any).enqueueNpc(fixture.scene, 'guard', {
      type: 'action_completed',
      result: {
        status: 'ok',
        code: 'exit_traversed',
        npcId: 'guard',
        targetId: 'door',
        actionType: 'TRAVERSE_EXIT',
        worldChanged: true,
      },
    });
    await vi.advanceTimersByTimeAsync(500);

    expect(getDynamicPmText(provider.calls[0])).toContain('Rick repairs electronics.');
    expect(getDynamicPmText(provider.calls[0])).toContain('Arrived in Corridor. [JUST ARRIVED]');
    expect(ComponentSystem.getNpcComponent(npc)?.memory).toEqual(['Rick repairs electronics.']);
    expect(ComponentSystem.getNpcComponent(npc)?.transientMemory).toEqual([]);
  });

  it('returns visible open-container contents in an NPC EXAMINE outcome', async () => {
    vi.useFakeTimers();
    const fixture = createGameSemanticFixture();
    const npc = addNpc(fixture, 'guard');
    const drawer = fixture.addEntity('Drawer1', {
      title: 'Drawer 1',
      description: 'An open desk drawer.',
      components: [{ type: 'Switch', state: 2, blockedRelation: 'in' }],
    });
    const idCard = fixture.addEntity('miles_id', {
      title: "Miles' ID",
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: drawer.name, relation: 'in' },
    });
    let completed: any = null;
    const executor = new ActorPlanExecutor(fixture.game, undefined, undefined, (_npcId, result) => {
      completed = result;
    });

    executor.executePlan({
      npcId: npc.name,
      steps: [{ type: 'EXAMINE', targetId: drawer.name, relation: 'in' }],
    });
    await vi.runAllTimersAsync();

    expect(completed.status).toBe('ok');
    expect(completed.message).toContain("Miles' ID");
    expect(completed.discoveredEntityIds).toContain(idCard.name);

    const expectedEmpty = fixture.game.describeSpatialRelation(drawer.name, 'under').message;
    executor.executePlan({
      npcId: npc.name,
      steps: [{ type: 'LOOK', targetId: drawer.name, relation: 'under' }],
    });
    await vi.runAllTimersAsync();
    expect(completed.message).toContain(expectedEmpty);
  });

  it('filters malformed responses without advancing the scene log cursor', async () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Hello.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const pm = new NpcPuppetMaster(fixture.game, new MockProvider('{"kind":"nope"}'));

    const plans = await pm.processScene(fixture.scene);

    expect(plans).toEqual([]);
    expect(fixture.scene.sceneLog.getUnreadEntries()).toHaveLength(1);
    expect(pm.getLastDebugInfo()?.error).toBe('invalid_response');
  });

  it('schedules WAIT and wakes the same NPC with an individual PM trigger', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    (fixture.game as any).sayAsActor = () => {};
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Hello.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: 'guard',
            steps: [{ type: 'WAIT', ms: 500 }],
            memory: 'Waiting after confirming the previous result.',
          },
        ],
      }),
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: 'guard',
            steps: [{ type: 'OBJECTIVES_SET', objectives: ['Resume guard duty'] }],
          },
        ],
      }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processScene(fixture.scene);

    expect(plans[0].steps).toEqual([{ type: 'WAIT', ms: 500 }]);
    expect(pm.getLastDebugInfo()?.acceptedPlans).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(700);

    const component = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    expect(provider.calls).toHaveLength(2);
    expect(JSON.stringify(provider.calls[1].messages)).toContain('wait_elapsed');
    expect(component.objectives).toEqual(['Resume guard duty']);
    expect(component.memory).toEqual(['Waiting after confirming the previous result.']);
  });

  it('executes MOVE_TO and wakes the same NPC with a move_completed trigger', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const floor = fixture.addWalkbox('Floor');
    floor.poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const player = fixture.addPlayer('Hero', 5, 5);
    const npc = addNpc(fixture, 'guard');
    npc.x = 20;
    npc.y = 20;
    npc.speed = 1;
    npc.colliderWidth = 4;
    npc.colliderHeight = 4;
    (fixture.game as any).sayAsActor = () => {};
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Step over there.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: 'guard', steps: [{ type: 'MOVE_TO', x: 60, y: 20 }] }],
      }),
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: 'guard',
            steps: [{ type: 'OBJECTIVES_SET', objectives: ['Reached the marked spot'] }],
          },
        ],
      }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processScene(fixture.scene);

    expect(plans[0].steps).toEqual([{ type: 'MOVE_TO', x: 60, y: 20 }]);
    expect(npc.state).toBe('walk');

    fixture.scene.update(100);
    expect(npc.getMoveResult().status).toBe('arrived');
    await vi.advanceTimersByTimeAsync(250);

    const component = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    expect(provider.calls).toHaveLength(2);
    expect(JSON.stringify(provider.calls[1].messages)).toContain('move_completed');
    expect(String(provider.calls[1].messages[0].content)).toContain('"status": "arrived"');
    expect(component.objectives).toEqual(['Reached the marked spot']);
  });

  it('replans a target MOVE_TO once after an internal teleport before completing it', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const leftFloor = fixture.addWalkbox('LeftFloor');
    leftFloor.poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const rightFloor = fixture.addWalkbox('RightFloor');
    rightFloor.poly = [
      { x: 200, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 100 },
      { x: 200, y: 100 },
    ];
    const npc = addNpc(fixture, 'guard');
    npc.x = 10;
    npc.y = 50;
    npc.speed = 1;
    npc.colliderWidth = 4;
    npc.colliderHeight = 4;
    const entry = fixture.addTriggerbox('RightEntry', { components: [{ type: 'Entry' }] });
    entry.poly = [
      { x: 205, y: 45 },
      { x: 215, y: 45 },
      { x: 215, y: 55 },
      { x: 205, y: 55 },
    ];
    const exit = fixture.addTriggerbox('LeftExit', {
      components: [
        {
          type: 'Exit',
          targetSceneId: '',
          targetEntryId: 'RightEntry',
          collider: false,
          portal: true,
          navigationOnly: true,
        },
      ],
    });
    exit.poly = [
      { x: 80, y: 45 },
      { x: 90, y: 45 },
      { x: 90, y: 55 },
      { x: 80, y: 55 },
    ];
    const door = fixture.addTriggerbox('Door');
    door.poly = [
      { x: 285, y: 45 },
      { x: 295, y: 45 },
      { x: 295, y: 55 },
      { x: 285, y: 55 },
    ];
    const requestApproach = vi.spyOn(fixture.game.actorNavigation, 'requestNpcApproach');
    const completions: Array<{ npcId: string; result: any }> = [];
    const executor = new ActorPlanExecutor(fixture.game, undefined, (npcId, result) => {
      completions.push({ npcId, result });
    });

    executor.executePlan({ npcId: npc.name, steps: [{ type: 'MOVE_TO', targetId: door.name }] });

    for (let tick = 0; tick < 12 && completions.length === 0; tick += 1) {
      fixture.scene.update(100);
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(requestApproach).toHaveBeenCalledTimes(2);
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({
      npcId: npc.name,
      result: { status: 'arrived', code: 'arrived' },
    });
    expect(fixture.game.actorNavigation.isReachable(npc, door)).toBe(true);
  });

  it('defers an ordinary batch while a continuation awaits its barrier, then consumes it once', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);
    (pm as any).pendingPlanContinuations.set(`${fixture.scene.id}:${npc.name}`, {
      state: 'awaiting_barrier',
      npcId: npc.name,
      barrierStep: { type: 'MOVE_TO', targetId: 'desk' },
      steps: [{ type: 'MEMORY_SET', memory: 'Reached the desk.' }],
      interruptOn: [],
      completedSteps: [],
      trackCompletion: false,
    });
    (pm as any).continuationStates.set(`${fixture.scene.id}:${npc.name}`, {
      state: 'awaiting_barrier',
      changedAt: Date.now(),
    });

    pm.scheduleNpc(fixture.scene, npc.name, { type: 'manual', reason: 'other_npc_say' });
    await vi.advanceTimersByTimeAsync(200);

    expect(provider.calls).toHaveLength(0);
    expect((pm as any).pendingPlanContinuations.has(`${fixture.scene.id}:${npc.name}`)).toBe(true);

    pm.scheduleNpc(fixture.scene, npc.name, {
      type: 'move_completed',
      result: {
        status: 'arrived',
        code: 'arrived',
        target: { x: 20, y: 20 },
        route: [{ x: 20, y: 20 }],
      },
    });
    await vi.advanceTimersByTimeAsync(200);

    expect(ComponentSystem.getNpcComponent(npc)?.memory).toEqual(['Reached the desk.']);
    expect((pm as any).pendingPlanContinuations.has(`${fixture.scene.id}:${npc.name}`)).toBe(false);
    expect(provider.calls).toHaveLength(1);
    vi.useRealTimers();
  });

  it('does not let a same-response recipient plan or transfer claim outrun GIVE confirmation', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero');
    const rick = addNpc(fixture, 'Rick');
    const linda = addNpc(fixture, 'Linda');
    const pm = new NpcPuppetMaster(fixture.game, new MockProvider(''));

    const plans = (pm as any).deferPlansDependingOnUnconfirmedGive(
      (pm as any).removePrematureGiveClaims([
        {
          npcId: rick.name,
          steps: [
            { type: 'SAY', text: 'Linda received the battery.' },
            { type: 'GIVE', itemId: 'battery_aaa', targetId: linda.name },
          ],
          memory: 'I gave the battery to Linda.',
        },
        {
          npcId: linda.name,
          steps: [{ type: 'TRAVERSE_EXIT', targetId: 'corridor_exit' }],
          memory: 'I received the battery.',
        },
      ])
    );

    expect(plans).toEqual([
      expect.objectContaining({
        npcId: rick.name,
        steps: [{ type: 'GIVE', itemId: 'battery_aaa', targetId: linda.name }],
      }),
    ]);
    expect(plans[0].memory).toBeUndefined();
  });

  it('keeps one deterministic giver to start a same-response reciprocal GIVE cycle', () => {
    const fixture = createSceneFixture();
    const rick = addNpc(fixture, 'Rick');
    const linda = addNpc(fixture, 'Linda');
    const pm = new NpcPuppetMaster(fixture.game, new MockProvider(''));

    const plans = (pm as any).deferPlansDependingOnUnconfirmedGive([
      {
        npcId: rick.name,
        steps: [{ type: 'GIVE', itemId: 'battery_aaa', targetId: linda.name }],
      },
      {
        npcId: linda.name,
        steps: [{ type: 'GIVE', itemId: 'cassette', targetId: rick.name }],
      },
    ]);

    expect(plans).toEqual([
      {
        npcId: rick.name,
        steps: [{ type: 'GIVE', itemId: 'battery_aaa', targetId: linda.name }],
      },
    ]);
  });

  it('continues once after move completion when PM updates objectives without scheduling action', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const floor = fixture.addWalkbox('Floor');
    floor.poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const player = fixture.addPlayer('Hero', 5, 5);
    const npc = addNpc(fixture, 'guard');
    const tv = fixture.addEntity('tv', { title: 'TV' });
    tv.x = 80;
    tv.y = 20;
    npc.x = 20;
    npc.y = 20;
    npc.speed = 1;
    npc.colliderWidth = 4;
    npc.colliderHeight = 4;
    (fixture.game as any).sayAsActor = () => {};
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Get the remote, then turn on the TV.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: 'guard', steps: [{ type: 'MOVE_TO', x: 60, y: 20 }] }],
      }),
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: 'guard',
            steps: [
              { type: 'SAY', text: 'I have the remote. I need to turn on the TV next.' },
              { type: 'OBJECTIVES_SET', objectives: ['Turn on the TV'] },
            ],
            memory: 'I reached the remote and need to continue to the TV.',
          },
        ],
      }),
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: 'guard', steps: [{ type: 'MOVE_TO', targetId: 'tv' }] }],
      }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processScene(fixture.scene);

    fixture.scene.update(100);
    await vi.advanceTimersByTimeAsync(250);
    expect(provider.calls).toHaveLength(2);
    expect(JSON.stringify(provider.calls[1].messages)).toContain('move_completed');

    await vi.advanceTimersByTimeAsync(200);

    expect(provider.calls).toHaveLength(3);
    expect(JSON.stringify(provider.calls[2].messages)).toContain('plan_continued');
    expect(npc.getMoveResult().status).toBe('started');
    expect(npc.getMoveResult().target).toEqual({ x: tv.x, y: tv.y });
  });

  it('continues after plan completion when an objective-only plan has no scheduling action', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 5, 5);
    const npc = addNpc(fixture, 'guard');
    (fixture.game as any).sayAsActor = () => {};
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: 'guard',
            steps: [
              {
                type: 'OBJECTIVE_ADD',
                objective: { text: 'Find charged batteries', subtasks: [] },
              },
              { type: 'SAY', text: 'I need to look for batteries.' },
            ],
          },
        ],
      }),
      JSON.stringify({ kind: 'pm_response', plans: [{ npcId: 'guard', steps: [] }] }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processNpc(fixture.scene, npc.name, { type: 'plan_completed', results: [] });
    expect(provider.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(200);

    expect(provider.calls).toHaveLength(2);
    expect(JSON.stringify(provider.calls[1].messages)).toContain('plan_continued');
    expect(ComponentSystem.getNpcComponent(npc)?.objectives).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'Find charged batteries' })])
    );
    vi.useRealTimers();
  });

  it('resumes an active objective after a SAY-only plan, with a short conversational delay', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 5, 5);
    const npc = addNpc(fixture, 'guard');
    const npcComponent = npc.components.find((component: any) => component.type === 'NPC') as any;
    npcComponent.objectives = [{ id: 'turn-tv-on', text: 'Turn on the TV', subtasks: [] }];
    (fixture.game as any).sayAsActor = () => {};
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: 'guard', steps: [{ type: 'SAY', text: 'Hi, Miles.' }] }],
      }),
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: 'guard', steps: [{ type: 'MOVE_TO', x: 60, y: 20 }] }],
      }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processNpc(fixture.scene, npc.name, { type: 'manual' });
    expect(provider.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2_149);
    expect(provider.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(provider.calls).toHaveLength(2);
    expect(JSON.stringify(provider.calls[1].messages)).toContain('plan_continued');
    vi.useRealTimers();
  });

  it('continues a state-only plan while its NPC is in an offscreen scene', async () => {
    vi.useFakeTimers();
    const fixture = createGameSemanticFixture('start');
    const destination = fixture.addScene('corridor', 'Corridor', 'A corridor.');
    const npc = new Actor(fixture.game as any, 20, 20);
    npc.name = 'linda';
    npc.components = [{ type: 'Actor' }, { type: 'NPC', enabled: true }];
    destination.addEntity(npc);
    (fixture.game as any).sayAsActor = () => {};
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: 'linda',
            steps: [
              { type: 'OBJECTIVE_ADD', objective: { text: 'Inspect the corridor', subtasks: [] } },
              { type: 'SAY', text: 'I should inspect this corridor.' },
            ],
          },
        ],
      }),
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: 'linda', steps: [{ type: 'MOVE_TO', x: 60, y: 20 }] }],
      }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processNpc(destination, npc.name, { type: 'plan_completed', results: [] });
    await vi.advanceTimersByTimeAsync(200);

    expect(fixture.game.sceneManager.currentScene).toBe(fixture.scene);
    expect(provider.calls).toHaveLength(2);
    expect(JSON.stringify(provider.calls[1].messages)).toContain('plan_continued');
    (fixture.game.sceneManager as any).update = SceneManager.prototype.update;
    (fixture.game.sceneManager as any).refreshCurrentSceneGraphWeight = () => {};
    fixture.game.sceneManager.update(1_000);
    expect(npc.getMoveResult().status).toBe('arrived');
    expect(npc.x).toBe(60);
    expect(npc.y).toBe(20);
    vi.useRealTimers();
  });

  it('limits state-only continuations after plan completion', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 5, 5);
    const npc = addNpc(fixture, 'guard');
    (fixture.game as any).sayAsActor = () => {};
    const provider = new MockProvider([
      ...Array.from({ length: 6 }, (_, index) =>
        JSON.stringify({
          kind: 'pm_response',
          plans: [
            {
              npcId: 'guard',
              steps: [{ type: 'SAY', text: `Perfect, I can relax now ${index}.` }],
              memory: 'Objective complete. I am relaxing now.',
            },
          ],
        })
      ),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    for (let attempt = 0; attempt < 4; attempt++) {
      await pm.processNpc(fixture.scene, npc.name, {
        type: 'plan_completed',
        results: [],
      });
    }

    expect((pm as any).stateOnlyContinuationCounts.get(`${fixture.scene.id}:${npc.name}`)).toBe(3);
  });

  it('resets the state-only continuation limit when a physical action is scheduled', () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const pm = new NpcPuppetMaster(fixture.game, new MockProvider(''));
    const stateKey = `${fixture.scene.id}:${npc.name}`;
    (pm as any).stateOnlyContinuationCounts.set(stateKey, 3);

    (pm as any).executePlanAndTrackContinuation({
      npcId: npc.name,
      steps: [{ type: 'WAIT', ms: 1000 }],
    });

    expect((pm as any).stateOnlyContinuationCounts.has(stateKey)).toBe(false);
    vi.useRealTimers();
  });

  it('executes TAKE into the NPC inventory and wakes with an action_completed trigger', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const floor = fixture.addWalkbox('Floor');
    floor.poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const player = fixture.addPlayer('Hero', 5, 5);
    const npc = addNpc(fixture, 'guard');
    const remote = fixture.addEntity('tv_rc', {
      title: 'TV remote',
      components: [{ type: 'Item' }],
    });
    remote.x = 22;
    remote.y = 20;
    npc.x = 20;
    npc.y = 20;
    npc.colliderWidth = 4;
    npc.colliderHeight = 4;
    fixture.game.inventoryManager.ensureInventoryComponent(npc, 'in');
    (fixture.game as any).sayAsActor = () => {};
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Take the remote.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: 'guard', steps: [{ type: 'TAKE', targetId: 'tv_rc' }] }],
      }),
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          { npcId: 'guard', steps: [{ type: 'OBJECTIVES_SET', objectives: ['Hold remote'] }] },
        ],
      }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processScene(fixture.scene);

    expect(plans[0].steps).toEqual([{ type: 'TAKE', targetId: 'tv_rc' }]);
    expect(fixture.game.inventoryManager.hasInventoryEntity(npc, remote, 'in')).toBe(true);
    expect(remote.visible).toBe(false);
    expect(provider.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(200);

    expect(provider.calls).toHaveLength(2);
    expect(JSON.stringify(provider.calls[1].messages)).toContain('action_completed');
    expect(String(provider.calls[1].messages[0].content)).toContain('"code": "item_taken"');
  });

  it('hides protected foreign inventory contents from NPC context and rejects TAKE', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 5, 5);
    const playerInventory = fixture.game.inventoryManager.ensureInventoryComponent(player, 'in');
    playerInventory.protected = true;
    const npc = addNpc(fixture, 'guard');
    fixture.game.inventoryManager.ensureInventoryComponent(npc, 'in');
    npc.x = 5;
    npc.y = 5;
    const remote = fixture.addEntity('tv_rc', {
      title: 'TV remote',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    fixture.game.inventoryManager.addInventoryEntity(player, remote, 'in');
    (fixture.game as any).sayAsActor = () => {};

    const world = new NpcWorldModelBuilder(fixture.game).build(fixture.scene);
    expect(world.npcs[0]?.entities.some((entity) => entity.id === remote.name)).toBe(false);

    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Take my remote.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: npc.name, steps: [{ type: 'TAKE', targetId: remote.name }] }],
      }),
      JSON.stringify({ kind: 'pm_response', plans: [] }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processScene(fixture.scene);
    await vi.advanceTimersByTimeAsync(200);

    expect(fixture.game.inventoryManager.hasInventoryEntity(player, remote, 'in')).toBe(true);
    expect(fixture.game.inventoryManager.hasInventoryEntity(npc, remote, 'in')).toBe(false);
    expect(String(provider.calls[1].messages[0].content)).toContain('plan_rejected_missing_items');
  });

  it('preserves a safe SAY prefix when rejecting a missing-item physical tail', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    fixture.game.inventoryManager.ensureInventoryComponent(npc, 'in');
    const tv = fixture.addEntity('tv', { title: 'TV' });
    const dialogue: string[] = [];
    (fixture.game as any).sayAsActor = (_actor: Actor, text: string) => dialogue.push(text);
    fixture.scene.sceneLog.appendSpeech({
      actorId: 'Hero',
      displayName: 'Miles',
      text: 'I can trade you the remote.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const rejectedPlan = JSON.stringify({
      kind: 'pm_response',
      plans: [
        {
          npcId: npc.name,
          steps: [
            { type: 'SAY', text: 'I will use the remote now.' },
            { type: 'MEMORY_SET', memory: 'Hero offered a remote, but I do not hold it.' },
            { type: 'PUT', itemId: 'tv_rc', targetId: tv.name, relation: 'on' },
          ],
          memory: 'I used the remote to operate the TV.',
        },
      ],
    });
    const provider = new MockProvider([rejectedPlan, rejectedPlan]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processNpc(fixture.scene, npc.name);
    expect(plans).toEqual([
      {
        npcId: npc.name,
        steps: [
          { type: 'SAY', text: 'I will use the remote now.' },
          { type: 'MEMORY_SET', memory: 'Hero offered a remote, but I do not hold it.' },
        ],
      },
    ]);
    expect(dialogue).toEqual(['I will use the remote now.']);
    expect((npc.components.find((candidate: any) => candidate.type === 'NPC') as any).memory).toBe(
      'Hero offered a remote, but I do not hold it.'
    );

    await vi.advanceTimersByTimeAsync(250);

    expect(provider.calls).toHaveLength(2);
    const retryPrompt = String(provider.calls[1].messages[0].content);
    expect(retryPrompt).toContain('plan_rejected_missing_items');
    expect(retryPrompt).toContain('"stepType": "PUT"');
    expect(retryPrompt).toContain('"itemId": "tv_rc"');
    expect(retryPrompt).toContain('I can trade you the remote.');
    await vi.advanceTimersByTimeAsync(1000);
    expect(provider.calls).toHaveLength(2);
    expect(dialogue).toEqual(['I will use the remote now.']);
    expect(
      (npc.components.find((candidate: any) => candidate.type === 'NPC') as any).memory
    ).toEqual(['Hero offered a remote, but I do not hold it.']);
  });

  it('automatically inserts MOVE_TO before TAKE for a visible route-available item', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 5, 5);
    const floor = fixture.addWalkbox('Floor');
    floor.poly = [
      { x: 0, y: 0 },
      { x: 140, y: 0 },
      { x: 140, y: 100 },
      { x: 0, y: 100 },
    ];
    const npc = addNpc(fixture, 'guard');
    npc.x = 20;
    npc.y = 20;
    npc.colliderWidth = 4;
    npc.colliderHeight = 4;
    fixture.game.inventoryManager.ensureInventoryComponent(npc, 'in');
    const item = fixture.addEntity('test_1', {
      title: 'Valuable item',
      components: [{ type: 'Item' }],
    });
    item.x = 100;
    item.y = 20;
    const provider = new MockProvider(
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: npc.name,
            steps: [{ type: 'TAKE', targetId: item.name }],
            interruptOn: [{ type: 'ACTION_FAILED' }],
          },
        ],
      })
    );
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processNpc(fixture.scene, npc.name);

    expect(plans).toHaveLength(1);
    expect(plans[0].steps).toEqual([
      { type: 'MOVE_TO', targetId: item.name },
      { type: 'TAKE', targetId: item.name },
    ]);
    expect(pm.getLastDebugInfo()?.rejectedPlans).toEqual([]);
  });

  it('executes PUT from NPC inventory onto a target surface and wakes with action_completed', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const floor = fixture.addWalkbox('Floor');
    floor.poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const player = fixture.addPlayer('Hero', 5, 5);
    const npc = addNpc(fixture, 'guard');
    npc.x = 20;
    npc.y = 20;
    const desk = fixture.addEntity('Desk', {
      title: 'Desk',
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    desk.x = 22;
    desk.y = 20;
    const remote = fixture.addEntity('tv_rc', {
      title: 'TV remote',
      components: [{ type: 'Item' }],
    });
    fixture.game.inventoryManager.ensureInventoryComponent(npc, 'in');
    fixture.game.inventoryManager.addInventoryEntity(npc, remote, 'in');
    (fixture.game as any).sayAsActor = () => {};
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Put the remote on the desk.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: 'guard',
            steps: [{ type: 'PUT', itemId: 'tv_rc', targetId: 'Desk', relation: 'on' }],
          },
        ],
      }),
      JSON.stringify({ kind: 'pm_response', plans: [] }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processScene(fixture.scene);

    expect(plans[0].steps).toEqual([
      { type: 'PUT', itemId: 'tv_rc', targetId: 'Desk', relation: 'on' },
    ]);
    expect(fixture.game.inventoryManager.hasInventoryEntity(npc, remote, 'in')).toBe(false);
    expect((desk.components?.[0] as { items: Array<{ id: string }> }).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'tv_rc' })])
    );

    await vi.advanceTimersByTimeAsync(200);

    expect(provider.calls).toHaveLength(2);
    expect(String(provider.calls[1].messages[0].content)).toContain(
      '"code": "item_put_on_surface"'
    );
  });

  it('continues a planned MOVE_TO tail and executes PUT without asking the LLM again', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const floor = fixture.addWalkbox('Floor');
    floor.poly = [
      { x: 0, y: 0 },
      { x: 140, y: 0 },
      { x: 140, y: 120 },
      { x: 0, y: 120 },
    ];
    const player = fixture.addPlayer('Hero', 5, 5);
    const npc = addNpc(fixture, 'guard');
    npc.x = 20;
    npc.y = 20;
    npc.speed = 1;
    npc.colliderWidth = 4;
    npc.colliderHeight = 4;
    const desk = fixture.addEntity('Desk', {
      title: 'Desk',
      components: [{ type: 'Surface', capacity: 2, groups: [], items: [] }],
    });
    desk.x = 90;
    desk.y = 20;
    const idCard = fixture.addEntity('miles_id', {
      title: 'ID card',
      components: [{ type: 'Item' }],
    });
    fixture.game.inventoryManager.ensureInventoryComponent(npc, 'in');
    fixture.game.inventoryManager.addInventoryEntity(npc, idCard, 'in');
    (fixture.game as any).sayAsActor = () => {};
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Put the ID card on the desk.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: 'guard',
            steps: [
              { type: 'MEMORY_SET', memory: 'Hero asked me to put the ID card on the desk.' },
              { type: 'MOVE_TO', targetId: 'Desk' },
              { type: 'PUT', itemId: 'miles_id', targetId: 'Desk', relation: 'on' },
            ],
            interruptOn: [{ type: 'ACTION_FAILED' }],
            memory: 'I put the ID card on the desk.',
          },
        ],
      }),
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: 'guard',
            steps: [
              {
                type: 'MEMORY_SET',
                memory: 'I put the ID card on the desk as Hero requested.',
              },
            ],
          },
        ],
      }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processScene(fixture.scene);
    expect(plans[0].interruptOn).toEqual([{ type: 'ACTION_FAILED' }]);
    expect(plans[0].memory).toBe('I put the ID card on the desk.');
    expect(
      (npc.components.find((candidate: any) => candidate.type === 'NPC') as any).memory
    ).toEqual(['Hero asked me to put the ID card on the desk.']);
    expect(provider.calls).toHaveLength(1);

    fixture.scene.update(1000);
    await vi.advanceTimersByTimeAsync(200);

    expect(provider.calls).toHaveLength(1);
    expect(fixture.game.inventoryManager.hasInventoryEntity(npc, idCard, 'in')).toBe(false);
    expect((desk.components?.[0] as { items: Array<{ id: string }> }).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'miles_id' })])
    );

    await vi.advanceTimersByTimeAsync(400);

    expect(provider.calls).toHaveLength(2);
    expect(String(provider.calls[1].messages[0].content)).toContain('plan_completed');
    expect(String(provider.calls[1].messages[0].content)).toContain(
      '"code": "item_put_on_surface"'
    );
    const component = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    expect(component.memory).toBe('I put the ID card on the desk as Hero requested.');
  });

  it('continues an accepted runtime plan even when PM call budgets are exhausted', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 5, 5);
    const floor = fixture.addWalkbox('Floor');
    floor.poly = [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 100 },
      { x: 0, y: 100 },
    ];
    const npc = addNpc(fixture, 'guard');
    npc.x = 20;
    npc.y = 20;
    npc.speed = 1;
    npc.colliderWidth = 4;
    npc.colliderHeight = 4;
    const desk = fixture.addEntity('Desk', { title: 'Desk' });
    desk.x = 80;
    desk.y = 20;
    const examine = vi.spyOn(fixture.game, 'examineEntityForActor');
    const provider = new MockProvider(
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: npc.name,
            steps: [
              { type: 'MOVE_TO', targetId: desk.name },
              { type: 'EXAMINE', targetId: desk.name, relation: 'on' },
            ],
            interruptOn: [{ type: 'ACTION_FAILED' }],
          },
        ],
      })
    );
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processNpc(fixture.scene, npc.name);
    const saturated = Array.from({ length: 100 }, () => Date.now());
    (pm as any).npcCallTimes.set(`${fixture.scene.id}:${npc.name}`, saturated);
    (pm as any).sceneCallTimes.set(fixture.scene.id, saturated);

    fixture.scene.update(1000);
    await vi.advanceTimersByTimeAsync(300);

    expect(examine).toHaveBeenCalledWith(npc, desk, { relation: 'on' });
    expect(provider.calls).toHaveLength(1);
  });

  it('completes a synchronous search after inspecting its planned anchors', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 5, 5);
    const npc = addNpc(fixture, 'guard');
    npc.x = 20;
    npc.y = 20;
    const sofa = fixture.addEntity('Sofa', { title: 'Sofa' });
    sofa.x = 22;
    sofa.y = 20;
    fixture.addEntity('Desk', { title: 'Desk' });
    fixture.addEntity('tv_rc', {
      title: 'TV remote',
      hidden: 'examinable',
      spatial: { parentNodeId: sofa.name, relation: 'under' },
      components: [{ type: 'Item' }],
    });
    (fixture.game as any).sayAsActor = () => {};
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Find the remote.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: npc.name,
            steps: [
              { type: 'EXAMINE', targetId: sofa.name, relation: 'under' },
              { type: 'EXAMINE', targetId: 'Desk', relation: 'on' },
            ],
            interruptOn: [{ type: 'ITEM_FOUND', itemId: 'tv_rc' }, { type: 'ACTION_FAILED' }],
            memory: 'I searched the sofa and desk.',
          },
        ],
      }),
      JSON.stringify({ kind: 'pm_response', plans: [] }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processScene(fixture.scene);
    await vi.advanceTimersByTimeAsync(400);

    expect(provider.calls).toHaveLength(1);
    const component = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    expect(component.memory).toBe('I searched the sofa and desk.');
  });

  it('does not treat an item already held before a barrier as newly found', () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const heldItem = fixture.addEntity('already_held', {
      title: 'Already held item',
      components: [{ type: 'Item' }],
    });
    fixture.game.inventoryManager.ensureInventoryComponent(npc, 'in');
    expect(fixture.game.inventoryManager.addInventoryEntity(npc, heldItem, 'in').status).toBe('ok');
    const pm = new NpcPuppetMaster(fixture.game, new MockProvider(''));
    const pending = {
      state: 'awaiting_barrier' as const,
      npcId: npc.name,
      barrierStep: { type: 'MOVE_TO' as const, targetId: 'Desk' },
      steps: [{ type: 'EXAMINE' as const, targetId: 'Desk' }],
      interruptOn: [{ type: 'ITEM_FOUND' as const, itemId: heldItem.name }],
      completedSteps: [],
      trackCompletion: true,
      inventoryItemIds: [heldItem.name],
      observableItemIds: [heldItem.name],
    };

    expect(
      (pm as any).getPlanInterrupt(
        fixture.scene,
        pending,
        { type: 'move_completed' },
        {
          status: 'arrived',
          code: 'arrived',
          target: { x: 0, y: 0 },
          route: [],
        }
      )
    ).toBeNull();

    const newItem = fixture.addEntity('newly_acquired', {
      title: 'Newly acquired item',
      components: [{ type: 'Item' }],
    });
    expect(fixture.game.inventoryManager.addInventoryEntity(npc, newItem, 'in').status).toBe('ok');
    pending.interruptOn = [{ type: 'ITEM_FOUND', itemId: newItem.name }];

    expect(
      (pm as any).getPlanInterrupt(
        fixture.scene,
        pending,
        { type: 'move_completed' },
        {
          status: 'arrived',
          code: 'arrived',
          target: { x: 0, y: 0 },
          route: [],
        }
      )
    ).toEqual({ type: 'ITEM_FOUND', itemId: newItem.name });

    pending.interruptOn = [{ type: 'ITEM_FOUND', itemId: 'discovered_item' }];
    expect(
      (pm as any).getPlanInterrupt(
        fixture.scene,
        pending,
        { type: 'action_completed' },
        {
          status: 'ok',
          code: 'entity_details',
          npcId: npc.name,
          targetId: 'Desk',
          actionType: 'EXAMINE',
          worldChanged: true,
          discoveredEntityIds: ['discovered_item'],
        }
      )
    ).toEqual({ type: 'ITEM_FOUND', itemId: 'discovered_item' });
  });

  it('interrupts a multi-step plan when WORLD_CHANGED is requested', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 5, 5);
    const npc = addNpc(fixture, 'guard');
    npc.x = 20;
    npc.y = 20;
    const drawer = fixture.addEntity('Drawer1', {
      title: 'Drawer',
      components: [{ type: 'Switch', state: 1 }],
    });
    drawer.x = 22;
    drawer.y = 20;
    (fixture.game as any).sayAsActor = () => {};
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Check the drawer.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: npc.name,
            steps: [
              { type: 'OPEN', targetId: drawer.name },
              { type: 'EXAMINE', targetId: drawer.name, relation: 'in' },
            ],
            interruptOn: [{ type: 'WORLD_CHANGED' }, { type: 'ACTION_FAILED' }],
            memory: 'I opened and searched the drawer.',
          },
        ],
      }),
      JSON.stringify({ kind: 'pm_response', plans: [] }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processScene(fixture.scene);
    await vi.advanceTimersByTimeAsync(400);

    expect(provider.calls).toHaveLength(2);
    const prompt = String(provider.calls[1].messages[0].content);
    expect(prompt).toContain('plan_interrupted');
    expect(prompt).toContain('"reason": "WORLD_CHANGED"');
    expect(prompt).toContain('"code": "switch_opened"');
    const component = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    expect(component.memory).toEqual(['Old note.']);
  });

  it('drops a held NPC item onto the floor near that NPC, not near the player', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const floor = fixture.addWalkbox('Floor');
    floor.poly = [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 120 },
      { x: 0, y: 120 },
    ];
    floor.components = [{ type: 'Surface', capacity: 4, groups: [], items: [] }];
    const player = fixture.addPlayer('Hero', 5, 5);
    const npc = addNpc(fixture, 'guard');
    npc.x = 80;
    npc.y = 80;
    const remote = fixture.addEntity('tv_rc', {
      title: 'TV remote',
      components: [{ type: 'Item' }],
    });
    fixture.game.inventoryManager.ensureInventoryComponent(npc, 'in');
    fixture.game.inventoryManager.addInventoryEntity(npc, remote, 'in');
    (fixture.game as any).sayAsActor = () => {};
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Drop the remote.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: 'guard', steps: [{ type: 'PUT', itemId: 'tv_rc', targetId: null }] }],
      }),
      JSON.stringify({ kind: 'pm_response', plans: [] }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processScene(fixture.scene);

    expect(fixture.game.inventoryManager.hasInventoryEntity(npc, remote, 'in')).toBe(false);
    const distanceToNpc = Math.hypot(remote.x - npc.x, remote.y - npc.y);
    const distanceToPlayer = Math.hypot(remote.x - player.x, remote.y - player.y);
    expect(distanceToNpc).toBeLessThan(distanceToPlayer);
    expect((floor.components?.[0] as { items: Array<{ id: string }> }).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'tv_rc' })])
    );

    await vi.advanceTimersByTimeAsync(200);

    expect(String(provider.calls[1].messages[0].content)).toContain(
      '"code": "item_put_on_surface"'
    );
  });

  it('reports PUT target failures as controlled action_completed results', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 5, 5);
    const npc = addNpc(fixture, 'guard');
    const remote = fixture.addEntity('tv_rc', {
      title: 'TV remote',
      components: [{ type: 'Item' }],
    });
    fixture.game.inventoryManager.ensureInventoryComponent(npc, 'in');
    fixture.game.inventoryManager.addInventoryEntity(npc, remote, 'in');
    (fixture.game as any).sayAsActor = () => {};
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Put the remote on the desk.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: 'guard',
            steps: [{ type: 'PUT', itemId: 'tv_rc', targetId: 'missing_desk', relation: 'on' }],
          },
        ],
      }),
      JSON.stringify({ kind: 'pm_response', plans: [] }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processScene(fixture.scene);
    await vi.advanceTimersByTimeAsync(200);

    expect(fixture.game.inventoryManager.hasInventoryEntity(npc, remote, 'in')).toBe(true);
    expect(String(provider.calls[1].messages[0].content)).toContain(
      '"code": "put_target_not_found"'
    );
  });

  it('adds authored command affordances to matching visible entities only', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 5, 5);
    addNpc(fixture, 'guard');
    const tv = fixture.addEntity('tv', {
      title: 'TV',
      components: [
        { type: 'State', id: 'power', valueType: 'string', initialValue: 'off', value: 'off' },
      ],
    });
    tv.x = 20;
    tv.y = 20;
    const remote = fixture.addEntity('tv_rc', {
      title: 'TV remote',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    remote.x = 22;
    remote.y = 20;
    const sofa = fixture.addEntity('sofa', { title: 'Sofa' });
    sofa.x = 40;
    sofa.y = 20;

    const builder = new NpcWorldModelBuilder(fixture.game);
    const model = builder.build(fixture.scene);
    const npcContext = model.npcs.find((npc) => npc.id === 'guard');
    const tvContext = npcContext?.entities.find((entity) => entity.id === 'tv');
    const sofaContext = npcContext?.entities.find((entity) => entity.id === 'sofa');
    const remoteContext = npcContext?.entities.find((entity) => entity.id === 'tv_rc');

    expect(tvContext?.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'turn_tv_on',
          label: 'turn on tv',
          requires: expect.arrayContaining([
            expect.objectContaining({ entityId: 'tv_rc', scope: 'held_or_reachable' }),
          ]),
          effects: expect.arrayContaining([
            expect.objectContaining({ type: 'setEntityState', stateId: 'power', value: 'on' }),
          ]),
        }),
      ])
    );
    expect(tvContext?.commands?.some((command) => command.id === 'use_on')).toBe(false);
    expect(remoteContext?.commands?.some((command) => command.id === 'turn_tv_on') || false).toBe(
      false
    );
    expect(sofaContext?.commands || []).toHaveLength(0);
    expect(tvContext?.commands?.find((command) => command.id === 'turn_tv_on')).toEqual(
      expect.objectContaining({ available: true })
    );

    const staticTv = builder
      .buildStaticEntityProjection(fixture.scene)
      .find((entity) => entity.id === 'tv');
    const staticCommand = staticTv?.commands?.find((command) => command.id === 'turn_tv_on');
    const dynamicTv = (new NpcPuppetMaster(fixture.game, new MockProvider('')) as any)
      .buildDynamicEntities(npcContext?.entities)
      .find((entity: any) => entity.id === 'tv');
    const dynamicRemote = (new NpcPuppetMaster(fixture.game, new MockProvider('')) as any)
      .buildDynamicEntities(npcContext?.entities)
      .find((entity: any) => entity.id === 'tv_rc');
    const dynamicCommand = dynamicTv?.commands?.find((command: any) => command.id === 'turn_tv_on');
    expect(staticCommand).toEqual(
      expect.objectContaining({
        label: 'turn on tv',
        requires: [expect.objectContaining({ entityId: 'tv_rc', scope: 'held_or_reachable' })],
      })
    );
    expect(JSON.stringify(staticCommand)).not.toContain('available');
    expect(JSON.stringify(staticCommand)).not.toContain('satisfied');
    expect(JSON.stringify(staticCommand)).not.toContain('via');
    expect(dynamicCommand).toEqual(
      expect.objectContaining({
        available: true,
        requires: [
          expect.objectContaining({ entityId: 'tv_rc', satisfied: true, via: 'reachable' }),
        ],
      })
    );
    expect(dynamicCommand).not.toHaveProperty('label');
    expect(dynamicCommand.requires[0]).not.toHaveProperty('scope');
    expect(dynamicRemote).toEqual(expect.objectContaining({ id: 'tv_rc', title: 'TV remote' }));
    const defaultDynamicEntity = (new NpcPuppetMaster(fixture.game, new MockProvider('')) as any)
      .buildDynamicEntities([
        {
          id: 'default_entity',
          title: 'Default entity',
          visibility: 'visible',
          interaction: 'reachable',
          approach: 'already_reachable',
        },
      ])
      .at(0);
    expect(defaultDynamicEntity).not.toHaveProperty('visibility');
    expect(defaultDynamicEntity).not.toHaveProperty('interaction');
    expect(defaultDynamicEntity).not.toHaveProperty('approach');
    expect(builder.buildStaticEntityProjection(fixture.scene)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'tv_rc' })])
    );
  });

  it('projects nested inventory identity and evaluated command preconditions', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 5, 5);
    const npc = addNpc(fixture, 'guard');
    const tv = fixture.addEntity('tv', {
      title: 'TV',
      components: [
        { type: 'State', id: 'power', valueType: 'string', initialValue: 'off', value: 'off' },
      ],
    });
    tv.x = 20;
    tv.y = 20;
    const container = fixture.addEntity('tv_rc', {
      title: 'Device container',
      components: [{ type: 'Item' }],
    });
    fixture.game.inventoryManager.ensureInventoryComponent(container, 'in');
    const depleted = fixture.addEntity('installed_cell', {
      title: 'Power cell',
      components: [
        { type: 'Item' },
        { type: 'State', id: 'charge_percent', valueType: 'number', initialValue: 0, value: 0 },
      ],
    });
    depleted.groupID = '#aaa';
    const replacement = fixture.addEntity('replacement_cell', {
      title: 'Power cell',
      components: [
        { type: 'Item' },
        { type: 'State', id: 'charge_percent', valueType: 'number', initialValue: 100, value: 100 },
      ],
    });
    replacement.groupID = '#aaa';
    fixture.game.inventoryManager.ensureInventoryComponent(npc, 'in');
    expect(fixture.game.inventoryManager.addInventoryEntity(container, depleted, 'in').status).toBe(
      'ok'
    );
    expect(fixture.game.inventoryManager.addInventoryEntity(npc, container, 'in').status).toBe(
      'ok'
    );
    expect(fixture.game.inventoryManager.addInventoryEntity(npc, replacement, 'in').status).toBe(
      'ok'
    );

    const context = new NpcWorldModelBuilder(fixture.game)
      .build(fixture.scene)
      .npcs.find((candidate) => candidate.id === npc.name);
    const command = context?.entities
      .find((entity) => entity.id === tv.name)
      ?.commands?.find((candidate) => candidate.id === 'turn_tv_on');

    expect(context?.inventory?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: container.name, containerId: npc.name, relation: 'in' }),
        expect.objectContaining({
          id: depleted.name,
          containerId: container.name,
          relation: 'in',
          groupIds: ['#aaa'],
          states: [{ id: 'charge_percent', value: 0 }],
        }),
        expect.objectContaining({
          id: replacement.name,
          containerId: npc.name,
          relation: 'in',
          groupIds: ['#aaa'],
          states: [{ id: 'charge_percent', value: 100 }],
        }),
      ])
    );
    expect(command).toEqual(expect.objectContaining({ available: true, executable: false }));
    expect(command?.preconditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'contained_group_entity',
          containerId: container.name,
          itemId: depleted.name,
          satisfied: true,
        }),
        expect.objectContaining({
          type: 'numeric_state',
          entityId: depleted.name,
          stateId: 'charge_percent',
          actualValue: 0,
          expectedValue: 0,
          operator: 'gt',
          satisfied: false,
        }),
      ])
    );
  });

  it('accepts and executes TAKE from a held nested inventory before PUT replacement', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 5, 5);
    const npc = addNpc(fixture, 'guard');
    const remote = fixture.addEntity('tv_rc', {
      title: 'Device container',
      components: [{ type: 'Item' }],
    });
    fixture.game.inventoryManager.ensureInventoryComponent(remote, 'in');
    const depleted = fixture.addEntity('installed_cell', {
      title: 'Installed power cell',
      components: [
        { type: 'Item' },
        { type: 'State', id: 'charge_percent', valueType: 'number', initialValue: 0, value: 0 },
      ],
    });
    depleted.groupID = '#aaa';
    const replacement = fixture.addEntity('replacement_cell', {
      title: 'Replacement power cell',
      components: [
        { type: 'Item' },
        {
          type: 'State',
          id: 'charge_percent',
          valueType: 'number',
          initialValue: 100,
          value: 100,
        },
      ],
    });
    replacement.groupID = '#aaa';
    fixture.game.inventoryManager.ensureInventoryComponent(npc, 'in');
    expect(fixture.game.inventoryManager.addInventoryEntity(remote, depleted, 'in').status).toBe(
      'ok'
    );
    expect(fixture.game.inventoryManager.addInventoryEntity(npc, remote, 'in').status).toBe('ok');
    expect(fixture.game.inventoryManager.addInventoryEntity(npc, replacement, 'in').status).toBe(
      'ok'
    );

    const provider = new MockProvider(
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: npc.name,
            steps: [
              { type: 'TAKE', targetId: depleted.name },
              { type: 'PUT', itemId: replacement.name, targetId: remote.name, relation: 'in' },
            ],
            interruptOn: [{ type: 'ACTION_FAILED' }],
          },
        ],
      })
    );
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processNpc(fixture.scene, npc.name);
    const prompt = String(provider.calls[0]?.messages[0]?.content || '');

    expect(plans).toEqual([
      expect.objectContaining({
        npcId: npc.name,
        steps: [
          { type: 'TAKE', targetId: depleted.name },
          { type: 'PUT', itemId: replacement.name, targetId: remote.name, relation: 'in' },
        ],
      }),
    ]);
    expect(prompt).toContain(`"containerId": "${remote.name}"`);
    expect(prompt).toContain(`"id": "${depleted.name}"`);
    expect(prompt).toContain('"charge_percent",\n              "value": 0');
    expect(pm.getLastDebugInfo()?.rejectedPlans).toEqual([]);
    expect(fixture.game.inventoryManager.hasInventoryEntity(npc, depleted, 'in')).toBe(true);
    expect(fixture.game.inventoryManager.hasInventoryEntity(remote, depleted, 'in')).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);

    expect(fixture.game.inventoryManager.hasInventoryEntity(npc, replacement, 'in')).toBe(false);
    expect(fixture.game.inventoryManager.hasInventoryEntity(remote, replacement, 'in')).toBe(true);
    vi.useRealTimers();
  });

  it('does not expose item presence in the PM static catalog', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 5, 5);
    const playerInventory = ComponentSystem.getInventoryComponent(player, 'in');
    if (playerInventory) playerInventory.protected = true;
    addNpc(fixture, 'guard');
    const cassette = fixture.addEntity('cassette', {
      title: 'Compact cassette',
      components: [{ type: 'Item' }],
    });
    expect(fixture.game.addInventoryEntity(player, cassette, 'in').status).toBe('ok');

    const builder = new NpcWorldModelBuilder(fixture.game);
    const hiddenStaticIds = builder
      .buildStaticEntityProjection(fixture.scene)
      .map((entity) => entity.id);
    const hiddenWorld = builder.build(fixture.scene);
    const guardContext = hiddenWorld.npcs.find((npc) => npc.id === 'guard');

    expect(hiddenStaticIds).not.toContain('cassette');
    expect(guardContext?.entities.some((entity) => entity.id === 'cassette')).toBe(false);

    expect(fixture.game.removeEntityFromInventory(player, cassette, 'in').status).toBe('ok');
    cassette.visible = true;
    cassette.spatial = {};
    const droppedStaticIds = builder
      .buildStaticEntityProjection(fixture.scene)
      .map((entity) => entity.id);
    const droppedWorld = builder.build(fixture.scene);
    const droppedGuardContext = droppedWorld.npcs.find((npc) => npc.id === 'guard');

    expect(droppedStaticIds).not.toContain('cassette');
    expect(droppedGuardContext?.entities.some((entity) => entity.id === 'cassette')).toBe(true);
  });

  it('does not run route planning while summarizing command affordances', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 5, 5);
    addNpc(fixture, 'guard');
    const tv = fixture.addEntity('tv', {
      title: 'TV',
      components: [
        { type: 'State', id: 'power', valueType: 'string', initialValue: 'off', value: 'off' },
      ],
    });
    tv.x = 20;
    tv.y = 20;
    const remote = fixture.addEntity('tv_rc', {
      title: 'TV remote',
      components: [{ type: 'Item' }],
    });
    remote.x = 2000;
    remote.y = 2000;
    const planApproach = vi.spyOn(fixture.game.actorWorld.navigation, 'planApproach');

    const model = new NpcWorldModelBuilder(fixture.game).build(fixture.scene);
    const npcContext = model.npcs.find((npc) => npc.id === 'guard');
    const tvContext = npcContext?.entities.find((entity) => entity.id === 'tv');

    expect(tvContext?.commands?.find((command) => command.id === 'turn_tv_on')).toEqual(
      expect.objectContaining({ available: false })
    );
    expect(planApproach).not.toHaveBeenCalled();
  });

  it('does not run route planning while building PM context for an inactive Subscene', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    const guard = addNpc(fixture, 'guard');
    guard.x = 0;
    guard.y = 0;
    const drawer = fixture.addTriggerbox('DrawerZone', {
      title: 'Drawer front',
      components: [{ type: 'Subscene', targetGroupId: '' }],
    });
    drawer.poly = [
      { x: 2000, y: 2000 },
      { x: 2010, y: 2000 },
      { x: 2010, y: 2010 },
      { x: 2000, y: 2010 },
    ];
    const remote = fixture.addEntity('remote', {
      title: 'Remote control',
      disabled: true,
      spatial: { parentNodeId: drawer.name, relation: 'in' },
    });
    remote.x = 2000;
    remote.y = 2000;
    const previewRoute = vi.spyOn(guard, 'previewWalkingRouteTo');
    const planApproach = vi.spyOn(fixture.game.actorWorld.navigation, 'planApproach');

    const context = new NpcWorldModelBuilder(fixture.game)
      .build(fixture.scene)
      .npcs.find((npc) => npc.id === guard.name);

    expect(context?.entities.find((entity) => entity.id === remote.name)).toEqual(
      expect.objectContaining({ approach: 'route_available', interaction: 'blocked' })
    );
    expect(previewRoute).not.toHaveBeenCalled();
    expect(planApproach).not.toHaveBeenCalled();
  });

  it('removes unsupported found-item claims after empty inspection results', async () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    const npc = addNpc(fixture, 'guard');
    const dialogue: string[] = [];
    (fixture.game as any).sayAsActor = (_actor: Actor, text: string) => {
      dialogue.push(text);
    };
    const pillow = fixture.addEntity('pillow', { title: 'Pillow' });
    pillow.x = 20;
    pillow.y = 20;
    const otherPillow = fixture.addEntity('other_pillow', { title: 'Other pillow' });
    otherPillow.x = 24;
    otherPillow.y = 20;
    const provider = new MockProvider(
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: npc.name,
            steps: [
              { type: 'SAY', text: 'Ah, here it is! Let me turn on the TV.' },
              { type: 'EXAMINE', targetId: otherPillow.name },
            ],
            memory: 'Linda examined the pillow and found it.',
          },
        ],
      })
    );
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processNpc(fixture.scene, npc.name, {
      type: 'action_completed',
      result: {
        status: 'ok',
        code: 'entity_details',
        npcId: npc.name,
        targetId: pillow.name,
        actionType: 'EXAMINE',
        worldChanged: false,
        discoveredEntityIds: [],
        repeatKey: `EXAMINE:${pillow.name}`,
        repeatCount: 1,
      },
    });

    expect(dialogue).toEqual([]);
    expect(plans[0].steps).toEqual([{ type: 'EXAMINE', targetId: otherPillow.name }]);
    expect(plans[0].memory).toBeUndefined();
    expect(pm.getLastDebugInfo()?.acceptedPlans?.[0]).toEqual(plans[0]);
  });

  it('removes unsupported found-item claims after move completion without discovery', async () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    const npc = addNpc(fixture, 'guard');
    const dialogue: string[] = [];
    (fixture.game as any).sayAsActor = (_actor: Actor, text: string) => {
      dialogue.push(text);
    };
    const tv = fixture.addEntity('tv', { title: 'TV' });
    tv.x = 50;
    tv.y = 20;
    const provider = new MockProvider(
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: npc.name,
            steps: [
              { type: 'SAY', text: 'Found it! Let me turn on the TV...' },
              { type: 'MOVE_TO', targetId: tv.name },
            ],
            memory: 'Linda arrived at the sofa and found the remote.',
          },
        ],
      })
    );
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processNpc(fixture.scene, npc.name, {
      type: 'move_completed',
      result: {
        status: 'arrived',
        code: 'arrived',
        message: 'Arrived.',
        target: { x: 20, y: 20 },
        route: [],
      },
    });

    expect(dialogue).toEqual([]);
    expect(plans[0].steps).toEqual([{ type: 'MOVE_TO', targetId: tv.name }]);
    expect(plans[0].memory).toBeUndefined();
  });

  it('uses shared perception for opaque and transparent closed container contents', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    const npc = addNpc(fixture, 'guard');
    npc.x = 0;
    npc.y = 0;
    const opaque = fixture.addEntity('opaque_box', {
      title: 'Opaque box',
      components: [{ type: 'Switch', state: 1, blockedRelation: 'in', transparent: false }],
    });
    const hiddenItem = fixture.addEntity('hidden_item', {
      title: 'Hidden item',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: opaque.name, relation: 'in' },
    });
    const glass = fixture.addEntity('glass_box', {
      title: 'Glass box',
      components: [{ type: 'Switch', state: 1, blockedRelation: 'in', transparent: true }],
    });
    const visibleItem = fixture.addEntity('visible_item', {
      title: 'Visible item',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: glass.name, relation: 'in' },
    });

    const world = new NpcWorldModelBuilder(fixture.game).build(fixture.scene);
    const entities = world.npcs[0].entities;

    expect(entities.some((entity) => entity.id === hiddenItem.name)).toBe(false);
    expect(entities.find((entity) => entity.id === visibleItem.name)).toEqual(
      expect.objectContaining({ interaction: 'blocked', approach: 'unreachable' })
    );
  });

  it('selects action observers with each Actor perception radius', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const nearNpc = addNpc(fixture, 'near_guard');
    nearNpc.x = 100;
    const farNpc = addNpc(fixture, 'far_guard');
    farNpc.x = 700;
    nearNpc.perceptionRadius = 200;
    farNpc.perceptionRadius = 200;

    expect(fixture.game.actorWorld.getActionObservers(player).map((actor) => actor.name)).toEqual([
      nearNpc.name,
    ]);
  });

  it('keeps player speech listeners independent from action observation radius', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const npc = addNpc(fixture, 'guard');
    npc.x = 700;
    npc.perceptionRadius = 200;

    expect(fixture.game.actorWorld.getActionObservers(player).map((actor) => actor.name)).toEqual(
      []
    );
    expect(
      new NpcWorldModelBuilder(fixture.game).getNpcListenerIds(fixture.scene, player.name)
    ).toEqual([npc.name]);
  });

  it('executes actor-aware OPEN for a locked Switch using the NPC inventory key', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const npc = addNpc(fixture, 'guard');
    npc.x = 0;
    npc.y = 0;
    fixture.game.inventoryManager.ensureInventoryComponent(npc, 'in');
    const key = fixture.addEntity('drawer_key', {
      title: 'Drawer key',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    fixture.game.inventoryManager.addInventoryEntity(npc, key, 'in');
    const drawer = fixture.addEntity('drawer', {
      title: 'Drawer',
      components: [{ type: 'Switch', state: 1, idKey: key.name }],
    });
    (fixture.game as any).sayAsActor = () => {};
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Open the drawer.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: npc.name, steps: [{ type: 'OPEN', targetId: drawer.name }] }],
      }),
      JSON.stringify({ kind: 'pm_response', plans: [] }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processScene(fixture.scene);
    expect(plans[0].steps).toEqual([{ type: 'OPEN', targetId: drawer.name }]);
    expect((drawer.components[0] as { state: number }).state).toBe(2);

    await vi.advanceTimersByTimeAsync(200);
    expect(String(provider.calls[1].messages[0].content)).toContain('"code": "switch_opened"');
  });

  it('uses PM OPEN on an accessible non-switch container to report its contents', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 0, 0);
    const npc = addNpc(fixture, 'guard');
    npc.x = 0;
    npc.y = 0;
    const remote = fixture.addEntity('remote', {
      title: 'TV remote',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    const batterySlot = fixture.addEntity('remote_battery_slot', {
      title: null,
      spatial: { parentNodeId: remote.name, relation: 'in' },
      components: [{ type: 'Inventory', relation: 'in', capacity: 2, groups: [], items: [] }],
    });
    const batteries = fixture.addEntity('aaa_batteries', {
      title: 'AAA batteries',
      components: [{ type: 'Item' }],
    });
    fixture.game.inventoryManager.addInventoryEntity(batterySlot, batteries, 'in');
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: npc.name, steps: [{ type: 'OPEN', targetId: remote.name }] }],
      }),
      JSON.stringify({ kind: 'pm_response', plans: [] }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processNpc(fixture.scene, npc.name);

    expect(plans[0].steps).toEqual([{ type: 'OPEN', targetId: remote.name }]);
    await vi.advanceTimersByTimeAsync(200);
    const continuation = String(provider.calls[1].messages[0].content);
    expect(continuation).toContain('"code": "relation_contents"');
    expect(continuation).toContain('AAA batteries');
  });

  it('executes authored COMMAND steps for NPCs and wakes with an action_completed trigger', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const floor = fixture.addWalkbox('Floor');
    floor.poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const player = fixture.addPlayer('Hero', 5, 5);
    const npc = addNpc(fixture, 'guard');
    npc.x = 20;
    npc.y = 20;
    const tv = fixture.addEntity('tv', {
      title: 'TV',
      components: [
        { type: 'State', id: 'power', valueType: 'string', initialValue: 'off', value: 'off' },
      ],
    });
    tv.x = 22;
    tv.y = 20;
    const remote = fixture.addEntity('tv_rc', {
      title: 'TV remote',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    const battery = fixture.addEntity('batteryAAA', {
      title: 'AAA batteries',
      components: [
        { type: 'Item' },
        { type: 'State', id: 'charge_percent', valueType: 'number', initialValue: 100, value: 100 },
      ],
    });
    battery.groupID = '#aaa';
    fixture.game.inventoryManager.ensureInventoryComponent(remote, 'in');
    fixture.game.inventoryManager.addInventoryEntity(remote, battery, 'in');
    fixture.game.inventoryManager.ensureInventoryComponent(npc, 'in');
    fixture.game.inventoryManager.addInventoryEntity(npc, remote, 'in');
    (fixture.game as any).sayAsActor = () => {};
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Turn on the TV.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: 'guard',
            steps: [{ type: 'COMMAND', commandId: 'turn_tv_on' }],
            memory: 'The remote requirement is not blocking the command execution.',
          },
        ],
      }),
      JSON.stringify({ kind: 'pm_response', plans: [] }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processScene(fixture.scene);

    expect(plans[0].steps).toEqual([{ type: 'COMMAND', commandId: 'turn_tv_on' }]);
    expect(ComponentSystem.getStateValue(tv, 'power')).toBe('on');
    expect(provider.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(200);

    expect(provider.calls).toHaveLength(2);
    expect(JSON.stringify(provider.calls[1].messages)).toContain('action_completed');
    expect(String(provider.calls[1].messages[0].content)).toContain(
      '"code": "actor_command_executed"'
    );
  });

  it('does not commit plan memory after an asynchronous COMMAND failure', async () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const npcComponent = npc.components.find((component: any) => component.type === 'NPC') as any;
    npcComponent.memory = 'The TV is still off.';
    (fixture.game as any).sayAsActor = vi.fn();
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);

    (pm as any).storePendingContinuationAfterScheduledOutcome(
      fixture.scene,
      {
        npcId: npc.name,
        steps: [
          { type: 'COMMAND', commandId: 'turn_tv_on' },
          { type: 'SAY', text: 'The TV is on.' },
        ],
        memory: 'I successfully turned on the TV.',
      },
      [
        {
          status: 'scheduled',
          code: 'actor_command_scheduled',
          npcId: npc.name,
          actionType: 'COMMAND',
          commandId: 'turn_tv_on',
        },
      ]
    );
    (pm as any).tryExecutePendingContinuation(fixture.scene, npc.name, [
      {
        type: 'action_completed',
        result: {
          status: 'failed',
          code: 'custom_command_numeric_state_requirement_failed',
          npcId: npc.name,
          actionType: 'COMMAND',
          commandId: 'turn_tv_on',
          worldChanged: false,
        },
      },
    ]);

    expect(npcComponent.memory).toEqual(['The TV is still off.']);
  });

  it('rejects unavailable COMMAND item requirements and retries with details', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 5, 5);
    const npc = addNpc(fixture, 'guard');
    const tv = fixture.addEntity('tv', {
      title: 'TV',
      components: [
        { type: 'State', id: 'power', valueType: 'string', initialValue: 'off', value: 'off' },
      ],
    });
    tv.x = 20;
    tv.y = 20;
    const remote = fixture.addEntity('tv_rc', {
      title: 'TV remote',
      components: [{ type: 'Item' }],
    });
    remote.x = 500;
    remote.y = 500;
    (fixture.game as any).sayAsActor = () => {};
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Turn on the TV.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: 'guard', steps: [{ type: 'COMMAND', commandId: 'turn_tv_on' }] }],
      }),
      JSON.stringify({ kind: 'pm_response', plans: [] }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processScene(fixture.scene);
    await vi.advanceTimersByTimeAsync(200);

    expect(plans).toEqual([]);
    expect(
      (npc.components.find((component: any) => component.type === 'NPC') as any).memory
    ).toEqual(['Old note.']);
    expect(ComponentSystem.getStateValue(tv, 'power')).toBe('off');
    expect(provider.calls).toHaveLength(2);
    expect(String(provider.calls[1].messages[0].content)).toContain('plan_rejected_missing_items');
    expect(String(provider.calls[1].messages[0].content)).toContain('"itemId": "tv_rc"');
    expect(pm.getLastDebugInfo()?.acceptedPlans).toEqual([]);
  });

  it('uses a reachable item inside an inactive Subscene without requiring NPC inventory', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const npc = addNpc(fixture, 'guard');
    npc.x = 0;
    npc.y = 0;
    const drawerZone = fixture.addTriggerbox('DrawerZone', {
      title: 'Desk close-up',
      components: [{ type: 'Subscene', targetGroupId: '#drawer_zone' }],
    });
    const drawer = fixture.addTriggerbox('Drawer', {
      title: 'Upper drawer',
      disabled: true,
      groupID: '#drawer_zone',
      components: [{ type: 'Switch', state: 2, groupId1: 'nil', groupId2: '#drawer_open' }],
      spatial: { parentNodeId: drawerZone.name, relation: 'in' },
    });
    const remote = fixture.addEntity('tv_rc', {
      title: 'TV remote',
      disabled: true,
      groupID: '#drawer_open',
      components: [{ type: 'Item' }],
      spatial: { parentNodeId: drawer.name, relation: 'in' },
    });
    const battery = fixture.addEntity('batteryAAA', {
      title: 'AAA batteries',
      groupID: '#aaa',
      components: [
        { type: 'Item' },
        { type: 'State', id: 'charge_percent', valueType: 'number', initialValue: 100, value: 100 },
      ],
      spatial: { parentNodeId: remote.name, relation: 'in' },
    });
    fixture.game.inventoryManager.ensureInventoryComponent(remote, 'in');
    fixture.game.inventoryManager.addInventoryEntity(remote, battery, 'in');
    const tv = fixture.addEntity('tv', {
      title: 'TV',
      components: [
        { type: 'State', id: 'power', valueType: 'string', initialValue: 'off', value: 'off' },
      ],
    });
    tv.x = 5;
    tv.y = 5;
    (fixture.game as any).sayAsActor = () => {};
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Turn on the TV.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: npc.name, steps: [{ type: 'COMMAND', commandId: 'turn_tv_on' }] }],
      }),
      JSON.stringify({ kind: 'pm_response', plans: [] }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const world = new NpcWorldModelBuilder(fixture.game).build(fixture.scene);
    const npcContext = world.npcs.find((candidate) => candidate.id === npc.name);
    const remoteContext = npcContext?.entities.find((entity) => entity.id === remote.name);
    const tvCommand = npcContext?.entities
      .find((entity) => entity.id === tv.name)
      ?.commands?.find((command) => command.id === 'turn_tv_on');

    expect(npcContext?.inventory).toEqual({ available: false });
    expect(remoteContext).toEqual(expect.objectContaining({ interaction: 'reachable' }));
    expect(remoteContext?.approach).toBeUndefined();
    expect(tvCommand).toEqual(expect.objectContaining({ available: true }));
    expect(tvCommand?.requires).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityId: remote.name, satisfied: true, via: 'reachable' }),
      ])
    );

    await pm.processScene(fixture.scene);
    expect(ComponentSystem.getStateValue(tv, 'power')).toBe('on');
  });

  it('stops a plan after a failed action and does not commit speculative memory', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const npc = addNpc(fixture, 'guard');
    const npcComponent = npc.components.find((component: any) => component.type === 'NPC') as any;
    npcComponent.memory = 'The remote is in the drawer.';
    npcComponent.objectives = ['Turn on the TV'];
    const remote = fixture.addEntity('tv_rc', {
      title: 'TV remote',
      components: [{ type: 'Item', ignoreDistance: true }],
    });
    const tv = fixture.addEntity('tv', {
      title: 'TV',
      components: [
        { type: 'State', id: 'power', valueType: 'string', initialValue: 'off', value: 'off' },
      ],
    });
    (fixture.game as any).sayAsActor = vi.fn();
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Turn on the TV.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: npc.name,
            steps: [
              { type: 'TAKE', targetId: remote.name },
              { type: 'COMMAND', commandId: 'turn_tv_on' },
              { type: 'SAY', text: 'The TV is on.' },
              { type: 'OBJECTIVES_SET', objectives: ['Watch television'] },
            ],
            memory: 'I took the remote and turned on the TV.',
          },
        ],
      }),
      JSON.stringify({ kind: 'pm_response', plans: [] }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processScene(fixture.scene);

    expect(ComponentSystem.getStateValue(tv, 'power')).toBe('off');
    expect(npcComponent.memory).toEqual(['The remote is in the drawer.']);
    expect(npcComponent.objectives).toEqual([
      expect.objectContaining({ text: 'Turn on the TV', subtasks: [] }),
    ]);
    expect((fixture.game as any).sayAsActor).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);
    expect(provider.calls).toHaveLength(2);
    expect(String(provider.calls[1].messages[0].content)).toContain('plan_interrupted');
    expect(String(provider.calls[1].messages[0].content)).toContain('"code": "inventory_missing"');
  });

  it('moves NPCs to visible target ids', async () => {
    const fixture = createSceneFixture();
    const floor = fixture.addWalkbox('Floor');
    floor.poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const player = fixture.addPlayer('Hero', 5, 5);
    const npc = addNpc(fixture, 'guard');
    const marker = fixture.addEntity('marker', { title: 'Marker' });
    marker.x = 70;
    marker.y = 30;
    npc.x = 20;
    npc.y = 30;
    npc.speed = 1;
    npc.colliderWidth = 4;
    npc.colliderHeight = 4;
    (fixture.game as any).sayAsActor = () => {};
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Go to the marker.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const pm = new NpcPuppetMaster(
      fixture.game,
      new MockProvider(
        JSON.stringify({
          kind: 'pm_response',
          plans: [{ npcId: 'guard', steps: [{ type: 'MOVE_TO', targetId: 'marker' }] }],
        })
      )
    );

    await pm.processScene(fixture.scene);

    expect(npc.getMoveResult().status).toBe('started');
    expect(npc.getMoveResult().target).toEqual({ x: 70, y: 30 });
  });

  it('moves physical NPCs to the nearest walkable point around an off-walkbox target id', async () => {
    const fixture = createSceneFixture();
    const floor = fixture.addWalkbox('Floor');
    floor.poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ];
    const player = fixture.addPlayer('Hero', 5, 5);
    const npc = addNpc(fixture, 'guard');
    const tv = fixture.addEntity('tv', { title: 'TV' });
    tv.x = 50;
    tv.y = 55;
    npc.x = 20;
    npc.y = 30;
    npc.colliderWidth = 4;
    npc.colliderHeight = 4;
    (fixture.game as any).sayAsActor = () => {};
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Go to the TV.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const pm = new NpcPuppetMaster(
      fixture.game,
      new MockProvider(
        JSON.stringify({
          kind: 'pm_response',
          plans: [{ npcId: 'guard', steps: [{ type: 'MOVE_TO', targetId: 'tv' }] }],
        })
      )
    );

    await pm.processScene(fixture.scene);

    const target = npc.getMoveResult().target;
    expect(npc.getMoveResult().status).toBe('started');
    expect(target).not.toEqual({ x: 50, y: 55 });
    expect(target).not.toBeNull();
    expect(fixture.scene.isWalkable(target!.x, target!.y, npc)).toBe(true);
  });

  it('filters MOVE_TO steps with incomplete coordinate pairs', async () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Move.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const pm = new NpcPuppetMaster(
      fixture.game,
      new MockProvider(
        JSON.stringify({
          kind: 'pm_response',
          plans: [{ npcId: 'guard', steps: [{ type: 'MOVE_TO', x: 10 }] }],
        })
      )
    );

    const plans = await pm.processScene(fixture.scene);

    expect(plans).toEqual([]);
    expect(pm.getLastDebugInfo()?.filteredPlans).toHaveLength(1);
  });

  it('halts NPCs, cancels timeouts, and invalidates in-flight requests when haltAllNpcs is called', async () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const player = fixture.addPlayer('Hero');

    // Setup puppet master
    const responseText = JSON.stringify({
      kind: 'pm_response',
      plans: [{ npcId: 'guard', steps: [{ type: 'SAY', text: 'Halt!' }] }],
    });
    const provider = new MockProvider(responseText);
    const pm = new NpcPuppetMaster(fixture.game, provider);
    fixture.game.npcPuppetMaster = pm;

    // Simulate wait timeout scheduling
    let _waitFired = false;
    pm['waitTimeouts'].set(
      'guard',
      globalThis.setTimeout(() => {
        _waitFired = true;
      }, 10000)
    );

    // Simulate active movement
    npc.moveTo(100, 200);
    expect(npc.state).toBe('walk');

    // Perform halt
    pm.haltAllNpcs();

    // Verify npc is stopped
    expect(npc.state).toBe('idle');
    expect(npc.target).toBeNull();

    // Verify timeout was cancelled
    expect(pm['waitTimeouts'].has('guard')).toBe(false);

    // Verify in-flight requests are ignored
    let sendMessageStreamCalled = false;
    const slowProvider: ILlmProvider = {
      isAvailable: () => true,
      getProviderName: () => 'slow',
      getModelName: () => 'slow-model',
      sendMessage: async () => ({ ok: true, text: '{}', durationMs: 0 }),
      sendMessageStream: async () => {
        sendMessageStreamCalled = true;
        // halt while the call is "in-flight"
        pm.haltAllNpcs();
        return {
          ok: true,
          text: JSON.stringify({
            kind: 'pm_response',
            plans: [{ npcId: 'guard', steps: [{ type: 'SAY', text: 'Delayed reply' }] }],
          }),
          durationMs: 10,
        };
      },
    };
    pm.setProvider(slowProvider);

    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Miles',
      text: 'Talk to me.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });

    const plans = await pm.processScene(fixture.scene);
    expect(sendMessageStreamCalled).toBe(true);
    // Since pm.haltAllNpcs was called while sendMessageStream was running,
    // the returned plan should be discarded and processScene should return empty plans array.
    expect(plans).toEqual([]);
  });

  it('batches nearby NPC wake-ups into one PM request', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    addNpc(fixture, 'guard');
    addNpc(fixture, 'clerk');
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);

    pm.scheduleNpc(fixture.scene, 'guard', { type: 'manual', reason: 'first_event' });
    pm.scheduleNpc(fixture.scene, 'clerk', { type: 'manual', reason: 'second_event' });

    await vi.advanceTimersByTimeAsync(200);

    expect(provider.calls).toHaveLength(1);
    const prompt = String(provider.calls[0].messages[0].content);
    expect(prompt).toContain('"guard"');
    expect(prompt).toContain('"clerk"');
    expect(prompt).toContain('"type": "batch"');
  });

  it('flushes player speech through the dispatcher before scheduleScene resolves', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Hero',
      text: 'Hello.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const completion = pm.scheduleScene(fixture.scene);
    expect(provider.calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(200);
    await completion;

    expect(provider.calls).toHaveLength(1);
    expect(String(provider.calls[0].messages[0].content)).toContain('"text": "Hello."');
  });

  it('keeps player speech unread for a batch corrective item retry', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    fixture.game.inventoryManager.ensureInventoryComponent(npc, 'in');
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Hero',
      text: 'Bring me something valuable.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: npc.name, steps: [{ type: 'TAKE', targetId: 'missing_item' }] }],
      }),
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: npc.name, steps: [{ type: 'SAY', text: 'I will look around.' }] }],
      }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);
    (fixture.game as any).sayAsActor = vi.fn();

    const completion = pm.scheduleScene(fixture.scene);
    await vi.advanceTimersByTimeAsync(400);
    await completion;

    expect(provider.calls).toHaveLength(2);
    const retryPrompt = String(provider.calls[1].messages[0].content);
    expect(retryPrompt).toContain('plan_rejected_missing_items');
    expect(retryPrompt).toContain('Bring me something valuable.');
    expect((fixture.game as any).sayAsActor).toHaveBeenCalledWith(npc, 'I will look around.', {
      triggerPuppetMaster: true,
    });
  });

  it('prints PM wake stages before the provider prompt when peek mode is enabled', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    const debugLines: string[] = [];
    (fixture.game as any).console = {
      parserPeekPmEnabled: true,
      parserPeekLlmEnabled: false,
      logDebug: (message: string) => debugLines.push(message),
    };
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Hero',
      text: 'Hello.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });

    const completion = pm.scheduleScene(fixture.scene);
    await vi.advanceTimersByTimeAsync(200);
    await completion;

    expect(debugLines.join('\n')).toContain('schedule_scene_scan');
    expect(debugLines.join('\n')).toContain('batch_enqueued');
    expect(debugLines.join('\n')).toContain('--- PM CONTEXT TRACE ---');
    expect(debugLines.join('\n')).toContain('pm_context_entity_summary');
    expect(debugLines.join('\n')).toContain('provider_request_start');
  });

  it('lets player speech bypass exhausted autonomous PM rate budgets', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);
    const now = Date.now();
    (pm as any).sceneCallTimes.set(
      fixture.scene.id,
      Array.from({ length: 12 }, () => now)
    );
    (pm as any).npcCallTimes.set(
      `${fixture.scene.id}:${npc.name}`,
      Array.from({ length: 6 }, () => now)
    );
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Hero',
      text: 'Hello after all that searching.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });

    const completion = pm.scheduleScene(fixture.scene);
    await vi.advanceTimersByTimeAsync(200);
    await completion;

    expect(provider.calls).toHaveLength(1);
    expect(String(provider.calls[0].messages[0].content)).toContain(
      'Hello after all that searching.'
    );
  });

  it('stops repeating a successful action that produces no world progress', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    fixture.addEntity('desk', {
      title: 'Desk',
      description: 'A desk with misleading prose.',
    });
    fixture.scene.sceneLog.appendSpeech({
      actorId: player.name,
      displayName: 'Hero',
      text: 'Search the desk.',
      knownByNpcIds: [npc.name],
      timestamp: 1000,
    });
    const repeatedPlan = JSON.stringify({
      kind: 'pm_response',
      plans: [{ npcId: npc.name, steps: [{ type: 'EXAMINE', targetId: 'desk' }] }],
    });
    const provider = new MockProvider([repeatedPlan, repeatedPlan, repeatedPlan, repeatedPlan]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processScene(fixture.scene);
    await vi.advanceTimersByTimeAsync(1000);

    expect(provider.calls).toHaveLength(5);
    expect(String(provider.calls[2].messages[0].content)).toContain('"repeatCount": 2');
    expect(String(provider.calls[3].messages[0].content)).toContain(
      '"code": "repeated_without_progress"'
    );
    expect(String(provider.calls[4].messages[0].content)).toContain('Strategy-only NPC context');
  });

  it('stops a repeated MOVE_TO when both arrivals have empty routes', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);
    const firstPlan = {
      npcId: npc.name,
      steps: [{ type: 'MOVE_TO' as const, targetId: 'sofa' }],
    };
    const repeatedPlan = {
      ...firstPlan,
      memory: 'This memory must not be committed by the repeated unfinished move.',
    };
    const scheduledOutcome = {
      status: 'scheduled' as const,
      code: 'move_scheduled',
      npcId: npc.name,
      actionType: 'MOVE_TO' as const,
      targetId: 'sofa',
    };
    const emptyArrival = {
      type: 'move_completed' as const,
      result: {
        status: 'arrived' as const,
        code: 'arrived',
        message: 'Already close enough to interact.',
        target: { x: 20, y: 20 },
        route: [],
      },
    };

    (pm as any).storePendingContinuationAfterScheduledOutcome(fixture.scene, firstPlan, [
      scheduledOutcome,
    ]);
    expect((pm as any).tryExecutePendingContinuation(fixture.scene, npc.name, [emptyArrival])).toBe(
      false
    );

    (pm as any).storePendingContinuationAfterScheduledOutcome(fixture.scene, repeatedPlan, [
      scheduledOutcome,
    ]);
    expect((pm as any).tryExecutePendingContinuation(fixture.scene, npc.name, [emptyArrival])).toBe(
      true
    );
    await vi.advanceTimersByTimeAsync(200);

    expect(provider.calls).toHaveLength(1);
    const correctivePrompt = String(provider.calls[0].messages[0].content);
    expect(correctivePrompt).toContain('"code": "repeated_without_progress"');
    expect(correctivePrompt).toContain('"repeatKey": "MOVE_TO:sofa"');
    const component = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    expect(component.memory || '').not.toContain('must not be committed');
  });

  it('stops repeated route_unreachable MOVE_TO failures for the same target', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);
    const plan = {
      npcId: npc.name,
      steps: [
        { type: 'MOVE_TO' as const, targetId: 'door' },
        { type: 'TRAVERSE_EXIT' as const, targetId: 'door' },
      ],
      interruptOn: [{ type: 'ACTION_FAILED' as const }],
    };
    const scheduledOutcome = {
      status: 'scheduled' as const,
      code: 'move_scheduled',
      npcId: npc.name,
      actionType: 'MOVE_TO' as const,
      targetId: 'door',
    };
    const unreachable = {
      type: 'move_completed' as const,
      result: {
        status: 'unreachable' as const,
        code: 'route_unreachable',
        message: 'Destination is unreachable.',
        target: null,
        route: [],
      },
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      (pm as any).storePendingContinuationAfterScheduledOutcome(fixture.scene, plan, [
        scheduledOutcome,
      ]);
      expect(
        (pm as any).tryExecutePendingContinuation(fixture.scene, npc.name, [unreachable])
      ).toBe(true);
      await vi.advanceTimersByTimeAsync(200);
    }

    expect(provider.calls).toHaveLength(3);
    expect(String(provider.calls[0].messages[0].content)).toContain('"moveAttemptsRemaining": 2');
    expect(String(provider.calls[0].messages[0].content)).toContain(
      '2 attempt(s) remain before this loop is stopped'
    );
    expect(String(provider.calls[1].messages[0].content)).toContain('"moveAttemptsRemaining": 1');
    expect(String(provider.calls[1].messages[0].content)).toContain(
      '1 attempt(s) remain before this loop is stopped'
    );
    const terminalPrompt = String(provider.calls[2].messages[0].content);
    expect(terminalPrompt).toContain('"code": "repeated_without_progress"');
    expect(terminalPrompt).toContain('"repeatKey": "MOVE_TO:door"');
    expect(terminalPrompt).toContain('"repeatCount": 3');
    expect(terminalPrompt).toContain('"moveAttemptsRemaining": 0');
    expect(terminalPrompt).toContain('retry limit reached');
  });

  it('delivers the terminal repeated_without_progress outcome before suppressing further repeats', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);
    const baseResult = {
      status: 'ok' as const,
      code: 'entity_details',
      npcId: npc.name,
      targetId: 'sofa',
      actionType: 'EXAMINE' as const,
      worldChanged: false,
      repeatKey: 'EXAMINE:sofa',
    };

    for (let index = 0; index < 3; index += 1) {
      const result = (pm as any).recordActionProgress(fixture.scene, npc.name, baseResult);
      pm.scheduleNpc(fixture.scene, npc.name, { type: 'action_completed', result });
      await vi.advanceTimersByTimeAsync(200);
    }

    expect(provider.calls).toHaveLength(3);
    const terminalPrompt = String(provider.calls[2].messages[0].content);
    expect(terminalPrompt).toContain('"code": "repeated_without_progress"');
    expect(terminalPrompt).toContain('"repeatCount": 3');

    const fourth = (pm as any).recordActionProgress(fixture.scene, npc.name, baseResult);
    pm.scheduleNpc(fixture.scene, npc.name, { type: 'action_completed', result: fourth });
    await vi.advanceTimersByTimeAsync(200);
    expect(provider.calls).toHaveLength(3);
  });

  it('executes THINK_STRATEGY as a silent strategy pass that updates memory and objectives', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const dialogue: string[] = [];
    (fixture.game as any).sayAsActor = (_actor: Actor, text: string) => {
      dialogue.push(text);
    };
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: npc.name,
            steps: [{ type: 'THINK_STRATEGY', reason: 'objective appears blocked' }],
          },
        ],
      }),
      JSON.stringify({
        kind: 'npc_strategy_response',
        npcId: npc.name,
        memory: 'The current objective is blocked until Hero provides the remote.',
        objectives: ['Ask Hero for the remote later'],
        waitMs: 5000,
      }),
      JSON.stringify({ kind: 'pm_response', plans: [] }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processNpc(fixture.scene, npc.name, {
      type: 'action_completed',
      result: {
        status: 'failed',
        code: 'repeated_without_progress',
        npcId: npc.name,
        targetId: 'desk',
        actionType: 'EXAMINE',
        worldChanged: false,
        repeatKey: 'EXAMINE:desk',
        repeatCount: 3,
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    const component = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    expect(plans[0].steps).toEqual([
      { type: 'THINK_STRATEGY', reason: 'objective appears blocked' },
    ]);
    expect(dialogue).toEqual([]);
    expect(component.memory).toEqual([
      'The current objective is blocked until Hero provides the remote.',
    ]);
    expect(component.objectives).toEqual([
      expect.objectContaining({ text: 'Ask Hero for the remote later', subtasks: [] }),
    ]);
    expect(provider.calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(5200);
    expect(provider.calls).toHaveLength(3);
  });

  it('falls back to WAIT when the strategy response is invalid', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: npc.name, steps: [{ type: 'THINK_STRATEGY' }] }],
      }),
      '{"kind":"wrong"}',
      JSON.stringify({ kind: 'pm_response', plans: [] }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processNpc(fixture.scene, npc.name, {
      type: 'action_completed',
      result: {
        status: 'failed',
        code: 'repeated_without_progress',
        npcId: npc.name,
        targetId: 'desk',
        actionType: 'EXAMINE',
        worldChanged: false,
        repeatKey: 'EXAMINE:desk',
        repeatCount: 3,
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    const component = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    expect(component.memory).toEqual(['Old note.']);
    expect(component.objectives).toEqual([
      expect.objectContaining({ text: 'Check IDs', subtasks: [] }),
    ]);
    expect(pm.getLastDebugInfo()?.strategy).toEqual(
      expect.objectContaining({
        error: 'invalid_response',
        fallback: true,
        waitMs: 30000,
      })
    );
    expect(provider.calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(30200);
    expect(provider.calls).toHaveLength(3);
  });

  it('filters premature THINK_STRATEGY after ordinary move completion', async () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    const provider = new MockProvider(
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: npc.name,
            steps: [
              { type: 'SAY', text: 'Let me think about this.' },
              { type: 'THINK_STRATEGY', reason: 'remote is not reachable yet' },
            ],
            memory: 'I should think because the remote is not reachable.',
          },
        ],
      })
    );
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processNpc(fixture.scene, npc.name, {
      type: 'move_completed',
      result: {
        status: 'arrived',
        code: 'arrived',
        message: 'Arrived.',
        target: { x: 20, y: 20 },
        route: [],
      },
    });

    expect(plans).toEqual([]);
    expect(pm.getLastDebugInfo()?.acceptedPlans).toEqual([]);
  });

  it('allows THINK_STRATEGY after repeatCount warning level', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: npc.name,
            steps: [
              {
                type: 'THINK_STRATEGY',
                reason: 'repeatCount is 2 but another supported action remains',
              },
            ],
          },
        ],
      }),
      JSON.stringify({
        kind: 'npc_strategy_response',
        npcId: npc.name,
        memory: 'Desk repeat reached warning level; choose another target.',
        objectives: ['Search a different location'],
        waitMs: 1000,
      }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processNpc(fixture.scene, npc.name, {
      type: 'action_completed',
      result: {
        status: 'ok',
        code: 'entity_details',
        npcId: npc.name,
        targetId: 'sofa_pillow2',
        actionType: 'EXAMINE',
        worldChanged: false,
        discoveredEntityIds: [],
        repeatKey: 'EXAMINE:sofa_pillow2',
        repeatCount: 2,
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(plans).toEqual([
      {
        npcId: npc.name,
        steps: [
          {
            type: 'THINK_STRATEGY',
            reason: 'repeatCount is 2 but another supported action remains',
          },
        ],
      },
    ]);
    expect(pm.getLastDebugInfo()?.strategy).toEqual(
      expect.objectContaining({
        memoryUpdated: true,
        objectivesUpdated: [expect.objectContaining({ text: 'Search a different location' })],
      })
    );
  });

  it('rejects a plan that repeats the terminal no-progress action', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    const sofa = fixture.addEntity('Sofa', { title: 'Sofa' });
    sofa.x = 20;
    sofa.y = 20;
    const dialogue: string[] = [];
    (fixture.game as any).sayAsActor = (_actor: Actor, text: string) => {
      dialogue.push(text);
    };
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: npc.name,
            steps: [
              { type: 'SAY', text: 'Let me check behind the sofa...' },
              { type: 'EXAMINE', targetId: sofa.name },
            ],
            memory: 'Trying a different spatial relation behind the sofa.',
          },
        ],
      }),
      JSON.stringify({
        kind: 'npc_strategy_response',
        npcId: npc.name,
        memory: 'Repeated sofa checks did not help. Wait for new information.',
        objectives: ['Wait for new information about the remote'],
        waitMs: 1000,
      }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processNpc(fixture.scene, npc.name, {
      type: 'action_completed',
      result: {
        status: 'failed',
        code: 'repeated_without_progress',
        npcId: npc.name,
        targetId: sofa.name,
        actionType: 'EXAMINE',
        worldChanged: false,
        discoveredEntityIds: [],
        repeatKey: `EXAMINE:${sofa.name}`,
        repeatCount: 3,
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(plans).toEqual([
      {
        npcId: npc.name,
        steps: [{ type: 'THINK_STRATEGY', reason: 'terminal no-progress loop' }],
      },
    ]);
    expect(dialogue).toEqual([]);
    expect(pm.getLastDebugInfo()?.acceptedPlans).toEqual(plans);
    expect(pm.getLastDebugInfo()?.strategy).toEqual(
      expect.objectContaining({
        memoryUpdated: true,
        objectivesUpdated: [
          expect.objectContaining({ text: 'Wait for new information about the remote' }),
        ],
      })
    );
  });

  it('prints compact strategy flow debug when #PEEKPM is enabled', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    const sofa = fixture.addEntity('Sofa', { title: 'Sofa' });
    const debugLogs: string[] = [];
    (fixture.game as any).console = {
      parserPeekPmEnabled: true,
      logDebug(text: string) {
        debugLogs.push(text);
      },
    };
    (fixture.game as any).sayAsActor = () => {};
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: npc.name,
            steps: [
              { type: 'SAY', text: 'Let me check behind the sofa...' },
              { type: 'EXAMINE', targetId: sofa.name },
            ],
          },
        ],
      }),
      JSON.stringify({
        kind: 'npc_strategy_response',
        npcId: npc.name,
        memory: 'Sofa repeats are not useful.',
        objectives: ['Wait for new information'],
        waitMs: 1000,
      }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processNpc(fixture.scene, npc.name, {
      type: 'action_completed',
      result: {
        status: 'failed',
        code: 'repeated_without_progress',
        npcId: npc.name,
        targetId: sofa.name,
        actionType: 'EXAMINE',
        worldChanged: false,
        repeatKey: `EXAMINE:${sofa.name}`,
        repeatCount: 3,
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    const output = debugLogs.join('\n');
    expect(output).toContain('strategy_auto_triggered');
    expect(output).toContain('strategy_request_start');
    expect(output).toContain('--- PM STRATEGY RESPONSE ---');
    expect(output).toContain('memory updated: true');
    expect(output).toContain('objectives updated: [{"id":');
    expect(output).toContain('"text":"Wait for new information"');
    expect(output).toContain('waitMs: 1000');
  });

  it('prints raw strategy prompt and response when #PEEKLLM is enabled', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const debugLogs: string[] = [];
    (fixture.game as any).console = {
      parserPeekLlmEnabled: true,
      logDebug(text: string) {
        debugLogs.push(text);
      },
    };
    const provider = new MockProvider([
      JSON.stringify({
        kind: 'pm_response',
        plans: [{ npcId: npc.name, steps: [{ type: 'THINK_STRATEGY' }] }],
      }),
      JSON.stringify({
        kind: 'npc_strategy_response',
        npcId: npc.name,
        memory: 'Compact strategy note.',
        waitMs: 1000,
      }),
    ]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    await pm.processNpc(fixture.scene, npc.name, {
      type: 'action_completed',
      result: {
        status: 'failed',
        code: 'repeated_without_progress',
        npcId: npc.name,
        targetId: 'desk',
        actionType: 'EXAMINE',
        worldChanged: false,
        repeatKey: 'EXAMINE:desk',
        repeatCount: 3,
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    const output = debugLogs.join('\n');
    expect(output).toContain('--- PM STRATEGY LLM PROMPT ---');
    expect(output).toContain('Strategy-only NPC context');
    expect(output).toContain('--- PM STRATEGY LLM RESPONSE ---');
    expect(output).toContain('Compact strategy note.');
  });

  it('includes compact PM action history after an empty inspection', async () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);

    (pm as any).recordActionProgress(fixture.scene, npc.name, {
      status: 'ok',
      code: 'entity_details',
      npcId: npc.name,
      targetId: 'Sofa',
      actionType: 'EXAMINE',
      worldChanged: false,
      discoveredEntityIds: [],
      repeatKey: 'EXAMINE:Sofa',
    });

    await pm.processNpc(fixture.scene, npc.name);

    const prompt = String(provider.calls[0].messages[0].content);
    expect(prompt).toContain('"currentTimestamp"');
    expect(prompt).toContain('"actionHistory"');
    expect(prompt).toContain('EXAMINE Sofa: inspected, nothing new found');
    expect(prompt).toContain(`"sceneId": "${fixture.scene.id}"`);
    expect(prompt).toContain('"ageMs"');
  });

  it('keeps the last 20 action outcomes globally per NPC across scenes', () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const pm = new NpcPuppetMaster(fixture.game, new MockProvider(''));

    for (let index = 0; index < 21; index++) {
      (pm as any).recordActionProgress(
        { id: index % 2 === 0 ? 'test_room' : 'corridor' },
        npc.name,
        {
          status: 'ok',
          code: 'entity_details',
          npcId: npc.name,
          targetId: `target_${index}`,
          actionType: 'EXAMINE',
          worldChanged: false,
          discoveredEntityIds: [],
          repeatKey: `EXAMINE:target_${index}`,
        }
      );
    }

    const history = (pm as any).getNpcActionHistory(npc.name);
    expect(history).toHaveLength(20);
    expect(history[0]).toMatchObject({ sceneId: 'corridor', targetId: 'target_1' });
    expect(history.at(-1)).toMatchObject({ sceneId: 'test_room', targetId: 'target_20' });
    expect(
      history.every((entry: any) => typeof entry.ageMs === 'number' && !('timestamp' in entry))
    ).toBe(true);
  });

  it('accepts spatial relation on LOOK and EXAMINE plan steps', async () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
    const sofa = fixture.addEntity('Sofa', { title: 'Sofa' });
    (fixture.game as any).sayAsActor = () => {};
    const provider = new MockProvider(
      JSON.stringify({
        kind: 'pm_response',
        plans: [
          {
            npcId: npc.name,
            steps: [{ type: 'EXAMINE', targetId: sofa.name, relation: 'under' }],
          },
        ],
      })
    );
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processNpc(fixture.scene, npc.name);

    expect(plans[0].steps).toEqual([{ type: 'EXAMINE', targetId: sofa.name, relation: 'under' }]);
  });

  it('tracks different spatial inspection relations as different repeat signatures', () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const under = (pm as any).recordActionProgress(fixture.scene, npc.name, {
      status: 'ok',
      code: 'entity_details',
      npcId: npc.name,
      targetId: 'Sofa',
      relation: 'under',
      actionType: 'EXAMINE',
      worldChanged: false,
      discoveredEntityIds: [],
      repeatKey: 'EXAMINE:Sofa:under',
    });
    const behind = (pm as any).recordActionProgress(fixture.scene, npc.name, {
      status: 'ok',
      code: 'entity_details',
      npcId: npc.name,
      targetId: 'Sofa',
      relation: 'behind',
      actionType: 'EXAMINE',
      worldChanged: false,
      discoveredEntityIds: [],
      repeatKey: 'EXAMINE:Sofa:behind',
    });

    expect(under.repeatCount).toBe(1);
    expect(behind.repeatCount).toBe(1);
    expect((pm as any).getPatternSignature(behind)).toBe('EXAMINE:Sofa:behind');
  });

  it('records unreachable inspection attempts as failures, not completed searches', async () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);

    (pm as any).recordActionProgress(fixture.scene, npc.name, {
      status: 'failed',
      code: 'too_far_to_examine',
      npcId: npc.name,
      targetId: 'Sofa',
      actionType: 'EXAMINE',
      worldChanged: false,
      repeatKey: 'EXAMINE:Sofa',
    });

    await pm.processNpc(fixture.scene, npc.name);

    const prompt = String(provider.calls[0].messages[0].content);
    expect(prompt).toContain('"actionHistory"');
    expect(prompt).not.toContain('inspected, nothing new found');
    expect(prompt).toContain('EXAMINE Sofa: failed (too_far_to_examine)');
  });

  it('warns when mixed no-progress action signatures form a loop', () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);
    const actions = [
      ['EXAMINE', 'Drawer1'],
      ['OPEN', 'Drawer1'],
      ['LOOK', 'Drawer1'],
      ['EXAMINE', 'Drawer1'],
      ['OPEN', 'Drawer1'],
      ['LOOK', 'Drawer1'],
    ] as const;

    const results = actions.map(([actionType, targetId]) =>
      (pm as any).recordActionProgress(fixture.scene, npc.name, {
        status: 'ok',
        code: 'no_progress',
        npcId: npc.name,
        targetId,
        actionType,
        worldChanged: false,
        repeatKey: `${actionType}:${targetId}`,
      })
    );

    expect(results.at(-1)).toEqual(
      expect.objectContaining({
        status: 'failed',
        code: 'pattern_without_progress',
      })
    );
    expect(results.at(-1)?.message).toContain('Cyclic no-progress behavior detected');
    expect(results.at(-1)?.message).toContain('revise the relevant objective branch');
  });

  it('puts an NPC to sleep briefly when a mixed no-progress loop continues after warning', () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);
    const actions = [
      ['EXAMINE', 'Drawer2'],
      ['OPEN', 'Drawer2'],
      ['LOOK', 'Drawer2'],
      ['EXAMINE', 'Drawer2'],
      ['OPEN', 'Drawer2'],
      ['LOOK', 'Drawer2'],
      ['EXAMINE', 'Drawer2'],
    ] as const;

    let result: any;
    for (const [actionType, targetId] of actions) {
      result = (pm as any).recordActionProgress(fixture.scene, npc.name, {
        status: 'ok',
        code: 'no_progress',
        npcId: npc.name,
        targetId,
        actionType,
        worldChanged: false,
        repeatKey: `${actionType}:${targetId}`,
      });
    }

    expect(result).toEqual(
      expect.objectContaining({
        status: 'failed',
        code: 'pattern_loop_sleep',
      })
    );
    expect(result.message).toContain('WAIT/rest');
    expect(
      (pm as any).patternLoopStates.get(`${fixture.scene.id}:${npc.name}`).cooldownUntil
    ).toBeGreaterThan(Date.now());
  });

  it('delivers a terminal loop result so an awaiting continuation cannot strand', () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);
    const enqueue = vi.spyOn(pm as any, 'enqueueNpc').mockResolvedValue(undefined);
    const stateKey = `${fixture.scene.id}:${npc.name}`;
    (pm as any).patternLoopStates.set(stateKey, {
      signatures: ['OPEN:Drawer1'],
      warned: true,
      cooldownUntil: Date.now() + 10_000,
    });

    (pm as any).scheduleNpc(
      fixture.scene,
      npc.name,
      {
        type: 'action_completed',
        result: {
          status: 'failed',
          code: 'pattern_loop_sleep',
          npcId: npc.name,
          targetId: 'Drawer1',
          actionType: 'OPEN',
          worldChanged: false,
        },
      },
      true
    );

    expect(enqueue).toHaveBeenCalledWith(
      fixture.scene,
      npc.name,
      expect.objectContaining({ type: 'action_completed' })
    );
  });

  it('recovers a pending continuation when its runtime completion is lost', async () => {
    vi.useFakeTimers();
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);
    const plan = {
      npcId: npc.name,
      steps: [{ type: 'OPEN' as const, targetId: 'Drawer1' }],
      interruptOn: [{ type: 'ACTION_FAILED' as const }],
    };

    (pm as any).storePendingContinuationAfterScheduledOutcome(
      fixture.scene,
      plan,
      [
        {
          status: 'scheduled',
          code: 'npc_action_scheduled',
          npcId: npc.name,
          targetId: 'Drawer1',
          actionType: 'OPEN',
        },
      ],
      [],
      []
    );
    await vi.advanceTimersByTimeAsync(15_500);

    expect(provider.calls).toHaveLength(1);
    expect(JSON.stringify(provider.calls[0].messages)).toContain('continuation_timeout');
    expect((pm as any).pendingPlanContinuations.has(`${fixture.scene.id}:${npc.name}`)).toBe(false);
    vi.useRealTimers();
  });

  it('resets the pattern warning when the NPC tries a different target', () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const provider = new MockProvider('{"kind":"pm_response","plans":[]}');
    const pm = new NpcPuppetMaster(fixture.game, provider);
    const loopActions = [
      ['EXAMINE', 'Drawer2'],
      ['OPEN', 'Drawer2'],
      ['LOOK', 'Drawer2'],
      ['EXAMINE', 'Drawer2'],
      ['OPEN', 'Drawer2'],
      ['LOOK', 'Drawer2'],
    ] as const;

    for (const [actionType, targetId] of loopActions) {
      (pm as any).recordActionProgress(fixture.scene, npc.name, {
        status: 'ok',
        code: 'no_progress',
        npcId: npc.name,
        targetId,
        actionType,
        worldChanged: false,
        repeatKey: `${actionType}:${targetId}`,
      });
    }

    const result = (pm as any).recordActionProgress(fixture.scene, npc.name, {
      status: 'ok',
      code: 'no_progress',
      npcId: npc.name,
      targetId: 'Sofa',
      actionType: 'EXAMINE',
      worldChanged: false,
      repeatKey: 'EXAMINE:Sofa',
    });

    expect(result).toEqual(expect.objectContaining({ code: 'no_progress' }));
    expect(result.code).not.toBe('pattern_loop_sleep');
    expect((pm as any).patternLoopStates.get(`${fixture.scene.id}:${npc.name}`)).toEqual(
      expect.objectContaining({
        signatures: ['EXAMINE:Sofa'],
        warned: false,
        cooldownUntil: 0,
      })
    );
  });

  it('round-trips durable action history and safe continuation state for SaveState', () => {
    const fixture = createSceneFixture();
    const pm = new NpcPuppetMaster(fixture.game, new MockProvider(''));
    pm.importSaveState({
      actionHistories: {
        [`${fixture.scene.id}:guard`]: [
          { signature: 'LOOK:desk', summary: 'Inspected desk', count: 1, updatedAt: 123 },
        ],
      },
      continuations: [
        {
          stateKey: `${fixture.scene.id}:guard`,
          state: 'needs_replan',
          reason: 'save_restore',
        },
      ],
    });

    expect(pm.exportSaveState()).toEqual({
      actionHistories: {
        guard: [
          {
            sceneId: fixture.scene.id,
            timestamp: 123,
            status: 'ok',
            worldChanged: false,
            summary: 'Inspected desk',
          },
        ],
      },
      continuations: [
        {
          stateKey: `${fixture.scene.id}:guard`,
          state: 'needs_replan',
          reason: 'save_restore',
        },
      ],
    });
  });
});
