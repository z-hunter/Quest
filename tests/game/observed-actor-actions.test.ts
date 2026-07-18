import { describe, expect, it, vi } from 'vitest';
import { Game } from '../../src/core/Game';
import { Actor } from '../../src/entities/Actor';
import { NpcWorldModelBuilder } from '../../src/mechanics/NpcWorldModelBuilder';
import { createGameSemanticFixture } from '../fixtures/gameSemanticFactory';

function addActor(
  fixture: ReturnType<typeof createGameSemanticFixture>,
  name: string,
  x: number,
  npc = false
): Actor {
  const actor = new Actor(fixture.game, x, 0, 10, 10, name);
  actor.components = npc ? [{ type: 'NPC', enabled: true }] : [{ type: 'Actor' }];
  fixture.scene.addEntity(actor);
  fixture.textAssets.setObject(name, { title: name, description: `${name} actor` });
  return actor;
}

describe('observed Actor actions', () => {
  it('records an action for every nearby Actor without waking Puppet Master', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const npc = addActor(fixture, 'Linda', 40, true);
    const ambientActor = addActor(fixture, 'Kermit', 50);
    const farActor = addActor(fixture, 'Miles', 500);
    npc.perceptionRadius = 100;
    ambientActor.perceptionRadius = 100;
    farActor.perceptionRadius = 100;
    const boombox = fixture.addEntity('boombox', { title: 'Boombox' });
    const scheduleNpc = vi.fn();
    (fixture.game as any).npcPuppetMaster = { scheduleNpc };
    (fixture.game as any).console = { log: vi.fn() };

    Game.prototype.emitActorAction.call(fixture.game, player, 'examine', boombox, {
      targetId: boombox.name,
    });

    expect(fixture.scene.sceneLog.entries).toHaveLength(1);
    expect(fixture.scene.sceneLog.entries[0].knownByActorIds).toEqual(['Linda', 'Kermit']);
    expect(scheduleNpc).not.toHaveBeenCalled();
  });

  it('shows a nearby foreign action to the player but never echoes the player own action', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const npc = addActor(fixture, 'Linda', 30, true);
    player.perceptionRadius = 100;
    npc.perceptionRadius = 100;
    const sofa = fixture.addEntity('sofa', { title: 'Sofa' });
    const log = vi.fn();
    (fixture.game as any).console = { log };

    Game.prototype.emitActorAction.call(fixture.game, npc, 'look', sofa, {
      targetId: sofa.name,
      relation: 'under',
    });
    expect(log).toHaveBeenCalledWith('[ Linda is looking under Sofa ]', 'info', {
      showInClosed: true,
    });

    log.mockClear();
    Game.prototype.emitActorAction.call(fixture.game, player, 'look', sofa, {
      targetId: sofa.name,
    });
    expect(log).not.toHaveBeenCalled();

    npc.x = 500;
    sofa.x = 500;
    log.mockClear();
    Game.prototype.emitActorAction.call(fixture.game, npc, 'look', sofa, {
      targetId: sofa.name,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it('formats item, relation, use and Exit observations from structured payloads', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const npc = addActor(fixture, 'Linda', 20, true);
    player.perceptionRadius = 100;
    const cassette = fixture.addEntity('cassette', { title: 'Cassette' });
    const recorder = fixture.addEntity('recorder', { title: 'Recorder' });
    const door = fixture.addEntity('door', { title: 'Door' });
    const log = vi.fn();
    (fixture.game as any).console = { log };

    Game.prototype.emitActorAction.call(fixture.game, npc, 'take', null, {
      itemId: cassette.name,
    });
    Game.prototype.emitActorAction.call(fixture.game, npc, 'put', null, {
      itemId: cassette.name,
      targetId: null,
      relation: 'on',
    });
    Game.prototype.emitActorAction.call(fixture.game, npc, 'put', recorder, {
      itemId: cassette.name,
      targetId: recorder.name,
      relation: 'in',
    });
    Game.prototype.emitActorAction.call(fixture.game, npc, 'use', recorder, {
      itemId: cassette.name,
      targetId: recorder.name,
    });
    Game.prototype.emitActorAction.call(fixture.game, npc, 'traverse_exit', door, {
      targetId: door.name,
    });
    Game.prototype.emitActorAction.call(fixture.game, npc, 'left_immediate_area');

    expect(log.mock.calls.map(([text]) => text)).toEqual([
      '[ Linda takes Cassette ]',
      '[ Linda puts down Cassette ]',
      '[ Linda puts Cassette in Recorder ]',
      '[ Linda uses Cassette on Recorder ]',
      '[ Linda goes through Door ]',
      '[ Linda left the immediate area ]',
    ]);
    expect(fixture.scene.sceneLog.entries.at(-1)?.payload).toEqual({
      action: 'left_immediate_area',
    });
  });

  it('keeps an observed action unread until the NPC next processes its scene log', () => {
    const fixture = createGameSemanticFixture();
    const player = fixture.addPlayer('Hero', 0, 0);
    const npc = addActor(fixture, 'Linda', 30, true);
    npc.perceptionRadius = 100;
    const boombox = fixture.addEntity('boombox', { title: 'Boombox' });
    (fixture.game as any).console = { log: vi.fn() };

    Game.prototype.emitActorAction.call(fixture.game, player, 'examine', boombox, {
      targetId: boombox.name,
    });
    const firstContext = new NpcWorldModelBuilder(fixture.game).build(fixture.scene).npcs[0];
    expect(firstContext.newEvents.map((entry) => entry.text)).toEqual([
      '[ Hero is examining Boombox ]',
    ]);

    fixture.scene.sceneLog.markProcessed(undefined, npc.name);
    const nextContext = new NpcWorldModelBuilder(fixture.game).build(fixture.scene).npcs[0];
    expect(nextContext.newEvents || []).toEqual([]);
    expect(nextContext.recentEvents.map((entry) => entry.text)).toContain(
      '[ Hero is examining Boombox ]'
    );
  });

  it('migrates the legacy NPC perception radius into the Actor property', () => {
    const fixture = createGameSemanticFixture();
    const source = addActor(fixture, 'Legacy', 0, true);
    const data = source.toJSON() as any;
    delete data.perceptionRadius;
    data.components = [{ type: 'NPC', enabled: true, perceptionRadius: 175 }];

    const loaded = Actor.fromJSON(fixture.game, data);

    expect(loaded.perceptionRadius).toBe(175);
    expect((loaded.toJSON() as any).perceptionRadius).toBe(175);
  });
});
