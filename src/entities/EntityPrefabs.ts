import type { ActorData } from './Actor';
import type { EntityData } from './Entity';

export const DefaultEntityData: EntityData = {
    type: 'Static',
    name: 'New Entity',
    x: 100,
    y: 100,
    width: 30,
    height: 30,
    color: '#00ff00',
    scale: 1.0,
    modelScale: 1.0,
    layer: 0,
    spriteName: null,
    animationSpeed: 150
};

export const DefaultActorData: ActorData = {
    ...DefaultEntityData,
    type: 'Actor',
    name: 'New Actor',
    direction: 'down',
    speed: 0.1,
    animSets: {},
    isPlayer: false
};
