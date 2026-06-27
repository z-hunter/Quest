import { afterEach, describe, expect, it, vi } from 'vitest';
import { Actor } from '../../src/entities/Actor';
import { ActorPlanExecutor } from '../../src/mechanics/ActorPlanExecutor';
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
    expect(output).toContain('visibleItemIds: ["visible_key"]');
    expect(output).toContain('knownEntities:');
    expect(output).toContain(`"lastSeenSceneId":"${fixture.scene.id}"`);
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
    expect(context.entities.find((entry) => entry.id === remote.name)?.lastSeenSceneId).toBe(
      fixture.scene.id
    );
    expect(context.knownEntities).toContainEqual(
      expect.objectContaining({
        id: remote.name,
        kind: 'item',
        lastSeenSceneId: fixture.scene.id,
      })
    );
    expect(component.knownEntities?.[remote.name]?.lastSeenSceneId).toBe(fixture.scene.id);
    expect(context.entities.some((entry) => entry.id === disabledDecoration.name)).toBe(false);
    expect(component.knownEntities?.[disabledDecoration.name]).toBeUndefined();
    expect(context.entities.some((entry) => entry.id === visibleObject.name)).toBe(true);
    expect(component.knownEntities?.[visibleObject.name]).toBeUndefined();
    expect(component.knownEntities?.stale_object).toBeUndefined();
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
    expect(component.memory).toBe('Waiting after confirming the previous result.');
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

  it('limits move-completion continuations for plan-level memory alone', async () => {
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
        type: 'move_completed',
        result: {
          status: 'arrived',
          code: 'arrived',
          message: 'Arrived.',
          target: { x: 60, y: 20 },
          route: [],
        },
      });
    }

    expect((pm as any).memoryContinuationCounts.get(`${fixture.scene.id}:${npc.name}`)).toBe(3);
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

  it('rejects missing item references before execution and retries PM once with details', async () => {
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
            { type: 'USE', itemId: 'tv_rc', targetId: tv.name },
          ],
        },
      ],
    });
    const provider = new MockProvider([rejectedPlan, rejectedPlan]);
    const pm = new NpcPuppetMaster(fixture.game, provider);

    const plans = await pm.processNpc(fixture.scene, npc.name);
    expect(plans).toEqual([]);
    expect(dialogue).toEqual([]);

    await vi.advanceTimersByTimeAsync(250);

    expect(provider.calls).toHaveLength(2);
    const retryPrompt = String(provider.calls[1].messages[0].content);
    expect(retryPrompt).toContain('plan_rejected_missing_items');
    expect(retryPrompt).toContain('"stepType": "USE"');
    expect(retryPrompt).toContain('"itemId": "tv_rc"');
    expect(retryPrompt).toContain('I can trade you the remote.');
    await vi.advanceTimersByTimeAsync(1000);
    expect(provider.calls).toHaveLength(2);
    expect(dialogue).toEqual([]);
  });

  it('accepts MOVE_TO then TAKE for a visible route-available item', async () => {
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
            steps: [
              { type: 'MOVE_TO', targetId: item.name },
              { type: 'TAKE', targetId: item.name },
            ],
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
    expect((npc.components.find((candidate: any) => candidate.type === 'NPC') as any).memory).toBe(
      'Hero asked me to put the ID card on the desk.'
    );
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

    expect(examine).toHaveBeenCalledWith(npc, desk);
    expect(provider.calls).toHaveLength(1);
  });

  it('interrupts a multi-step search when the requested item is found', async () => {
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

    expect(provider.calls).toHaveLength(2);
    const prompt = String(provider.calls[1].messages[0].content);
    expect(prompt).toContain('plan_interrupted');
    expect(prompt).toContain('"reason": "ITEM_FOUND"');
    expect(prompt).toContain('"itemId": "tv_rc"');
    const component = npc.components.find((candidate: any) => candidate.type === 'NPC') as any;
    expect(component.memory).toBe('Old note.');
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
    expect(component.memory).toBe('Old note.');
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

  it('keeps player speech listeners independent from action observation radius', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const npc = addNpc(fixture, 'guard');
    npc.x = 700;
    const npcComponent = npc.components.find((component: any) => component.type === 'NPC') as any;
    npcComponent.perceptionRadius = 200;

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
    expect((npc.components.find((component: any) => component.type === 'NPC') as any).memory).toBe(
      'Old note.'
    );
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
      triggerPuppetMaster: false,
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
    expect(component.memory).toBe(
      'The current objective is blocked until Hero provides the remote.'
    );
    expect(component.objectives).toEqual(['Ask Hero for the remote later']);
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
    expect(component.memory).toBe('Old note.');
    expect(component.objectives).toEqual(['Check IDs']);
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
        objectivesUpdated: ['Search a different location'],
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
        objectivesUpdated: ['Wait for new information about the remote'],
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
    expect(output).toContain('objectives updated: ["Wait for new information"]');
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
    expect(prompt).toContain('"actionHistory"');
    expect(prompt).toContain('EXAMINE Sofa: inspected, nothing new found');
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

  it('does not record unreachable inspection attempts as completed searches', async () => {
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
    expect(prompt).not.toContain('"actionHistory"');
    expect(prompt).not.toContain('inspected, nothing new found');
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
    expect(results.at(-1)?.message).toContain('OBJECTIVES_SET');
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
});
