import { afterEach, describe, expect, it, vi } from 'vitest';
import { Actor } from '../../src/entities/Actor';
import { NpcWorldModelBuilder } from '../../src/mechanics/NpcWorldModelBuilder';
import { NpcPuppetMaster } from '../../src/mechanics/NpcPuppetMaster';
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
    expect(JSON.stringify(provider.lastSystem)).toContain('Check IDs');
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
    expect(output).toContain('acceptedPlans');
    expect(output).toContain('"durationMs": 123');
    expect(output).toContain('"inputTokens": 456');
    expect(output).toContain('"tokensGenerated": 32');
    expect(output).toContain('"cacheCreationInputTokens": 111');
    expect(output).toContain('"cacheReadInputTokens": 222');
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

    const visible = world.npcs?.[0]?.visibleEntities || [];
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

    await vi.advanceTimersByTimeAsync(500);

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
    await vi.advanceTimersByTimeAsync(50);

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
    await vi.advanceTimersByTimeAsync(50);
    expect(provider.calls).toHaveLength(2);
    expect(JSON.stringify(provider.calls[1].messages)).toContain('move_completed');

    await vi.advanceTimersByTimeAsync(1);

    expect(provider.calls).toHaveLength(3);
    expect(JSON.stringify(provider.calls[2].messages)).toContain('plan_continued');
    expect(npc.getMoveResult().status).toBe('started');
    expect(npc.getMoveResult().target).toEqual({ x: tv.x, y: tv.y });
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
});
