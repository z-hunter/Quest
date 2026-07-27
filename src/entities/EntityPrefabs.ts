import type { ActorData } from './Actor';
import type { EntityData } from './Entity';

export const DefaultEntityData: EntityData = {
  type: 'Static',
  name: 'Static',
  x: 100,
  y: 100,
  width: 30,
  height: 30,
  color: '#AAAAAA',
  scale: 1.0,
  modelScale: 1.0,
  layer: 0,
  spriteName: null,
  animationSpeed: 150,
};

export const DefaultActorData: ActorData = {
  ...DefaultEntityData,
  type: 'Actor',
  name: 'Actor',
  width: 25,
  height: 40,
  color: '#36d87fff',
  direction: 'down',
  speed: 0.1,
  animSets: {},
  isPlayer: false,
  components: [{ type: 'Actor' }],
};

export const DefaultQuadData: any = {
  ...DefaultEntityData,
  type: 'Quad',
  name: 'New Quad',
  width: 100,
  height: 100,
  color: '#52779aff',
  vertices: [
    { x: 0, y: 0, p: 1.0 },
    { x: 100, y: 0, p: 1.0 },
    { x: 100, y: 100, p: 1.0 },
    { x: 0, y: 100, p: 1.0 },
  ],
  sortMode: 'ignore',
  isGrid: false,
  gridLines: 5,
  lineWidth: 1.0,
  gridColor: '#ffffff',
  gridPerspective: true,
  gridPerspectiveAmount: 1.0,
  textureMode: 'stretch',
  tileScaleX: 1.0,
  tileScaleY: 1.0,
  texturePerspective: true,
  filled: true,
  checkerboard: false,
  secondColor: '#000000',
  blur: 0,
  opacity: 1.0,
  blendMode: 'source-over',
};
