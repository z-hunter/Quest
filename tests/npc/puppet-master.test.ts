import { afterEach, describe, expect, it, vi } from 'vitest';
import { Actor } from '../../src/entities/Actor';
import { NpcWorldModelBuilder } from '../../src/mechanics/NpcWorldModelBuilder';
import { NpcPuppetMaster } from '../../src/mechanics/NpcPuppetMaster';
import { ComponentSystem } from '../../src/systems/ComponentSystem';
import type {
  ILlmProvider,
  LlmProviderContent,
  LlmProviderMessage,
  LlmProviderResponse,
  LlmStreamDeltaCallback,
} from '../../src/mechanics/llm/ILlmProvider';
import { createSceneFixture } from '../fixtures/sceneFactory';

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
    this.lastMessages = messages;
    this.calls.push({ system, messages });
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

describe('NpcPuppetMaster', () => {
  afterEach(() => {
    vi.useRealTimers();
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
    expect((npc.components.find((component: any) => component.type === 'NPC') as any).memory).toBe(
      'Miles greeted the guard.'
    );
    expect(fixture.scene.sceneLog.getUnreadEntries()).toHaveLength(0);
    expect(JSON.stringify(provider.lastSystem)).not.toContain('Check IDs');
    expect(JSON.stringify(provider.lastMessages)).toContain('Check IDs');
    expect(JSON.stringify(provider.lastMessages)).toContain('Old note.');
  });

  it('prints PM prompt and response debug when #PEEKPM is enabled', async () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero');
    const npc = addNpc(fixture, 'guard');
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
    expect(output).toContain('Hello, Miles.');
    expect(output).toContain('Plan for guard:');
    expect(output).toContain('mock-npc (mock)');
    expect(output).toContain('0.12s');
    expect(output).toContain('Tokens: 456 in, 32 out');
    expect(output).toContain('Cache: 222 read, 111 created');
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

    expect(world.npcs?.[0]?.objectives).toEqual(['Check IDs']);
    expect(component.objectives).toEqual(['Check IDs']);
    expect(component.objectivesInitializedFromTA).toBe(true);
  });

  it('keeps changed runtime NPC objectives instead of re-reading text asset defaults', () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const component = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    component.objectives = ['Keep Miles away from the server room'];

    const world = new NpcWorldModelBuilder(fixture.game).build(fixture.scene);

    expect(world.npcs?.[0]?.objectives).toEqual(['Keep Miles away from the server room']);
    expect(component.objectives).toEqual(['Keep Miles away from the server room']);
  });

  it('executes OBJECTIVES_SET as current runtime NPC objectives', async () => {
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
                  type: 'OBJECTIVES_SET',
                  objectives: ['Watch the hallway', 'Report suspicious visitors'],
                },
              ],
            },
          ],
        })
      )
    );

    await pm.processScene(fixture.scene);

    const component = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    expect(component.objectives).toEqual(['Watch the hallway', 'Report suspicious visitors']);
    expect(component.objectivesInitializedFromTA).toBe(true);
  });

  it('filters malformed OBJECTIVES_SET steps', async () => {
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
          plans: [{ npcId: 'guard', steps: [{ type: 'OBJECTIVES_SET', objectives: 'oops' }] }],
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

    expect(world.npcs?.[0]?.objectives).toEqual(['Check IDs']);
    expect(component.objectives).toEqual(['Check IDs']);
    expect(component.objectivesInitializedFromTA).toBe(true);
  });

  it('preserves deliberately cleared runtime NPC objectives', () => {
    const fixture = createSceneFixture();
    const npc = addNpc(fixture, 'guard');
    const component = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    component.objectives = [];
    component.objectivesInitializedFromTA = true;

    const world = new NpcWorldModelBuilder(fixture.game).build(fixture.scene);

    expect(world.npcs?.[0]?.objectives).toBeUndefined();
    expect(component.objectives).toEqual([]);
    expect(component.objectivesInitializedFromTA).toBe(true);
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
        plans: [{ npcId: 'guard', steps: [{ type: 'WAIT', ms: 500 }] }],
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
    expect(String(provider.calls[1].messages[0].content)).toContain(
      '"code": "inventory_not_accessible"'
    );
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

    const model = new NpcWorldModelBuilder(fixture.game).build(fixture.scene);
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

  it('selects action observers with the authored NPC perception radius', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const nearNpc = addNpc(fixture, 'near_guard');
    nearNpc.x = 100;
    const farNpc = addNpc(fixture, 'far_guard');
    farNpc.x = 700;
    const nearComponent = nearNpc.components.find(
      (component: any) => component.type === 'NPC'
    ) as any;
    const farComponent = farNpc.components.find(
      (component: any) => component.type === 'NPC'
    ) as any;
    nearComponent.perceptionRadius = 200;
    farComponent.perceptionRadius = 200;

    expect(fixture.game.actorWorld.getActionObservers(player).map((actor) => actor.name)).toEqual([
      nearNpc.name,
    ]);
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
        plans: [{ npcId: 'guard', steps: [{ type: 'COMMAND', commandId: 'turn_tv_on' }] }],
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

  it('reports COMMAND prerequisite failures relative to the NPC actor', async () => {
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

    await pm.processScene(fixture.scene);
    await vi.advanceTimersByTimeAsync(200);

    expect(ComponentSystem.getStateValue(tv, 'power')).toBe('off');
    expect(provider.calls).toHaveLength(2);
    expect(String(provider.calls[1].messages[0].content)).toContain(
      '"code": "custom_command_required_entity_missing"'
    );
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
    expect(remoteContext).toEqual(
      expect.objectContaining({ interaction: 'reachable', approach: 'already_reachable' })
    );
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
    expect(npcComponent.memory).toBe('The remote is in the drawer.');
    expect(npcComponent.objectives).toEqual(['Turn on the TV']);
    expect((fixture.game as any).sayAsActor).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    expect(provider.calls).toHaveLength(2);
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
    tv.y = 80;
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
    expect(target).not.toEqual({ x: 50, y: 80 });
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

    expect(provider.calls).toHaveLength(4);
    expect(String(provider.calls[2].messages[0].content)).toContain('"repeatCount": 2');
    expect(String(provider.calls[3].messages[0].content)).toContain(
      '"code": "repeated_without_progress"'
    );
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
});
