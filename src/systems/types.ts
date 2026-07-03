import type { Scene } from '../scene/Scene';
import type { SceneObject } from '../entities/SceneObject';
import type { Entity } from '../entities/Entity';
import type { IGame } from '../core/IGame';
import type { Actor } from '../entities/Actor';

import type { Camera2D } from '../utils/Parallax';

export type SceneSystemContext = Scene;

export interface ActivationSceneContext {
  id: string;
  game: IGame;
  camera: Camera2D;
  player: Actor | null;
  activeSubscene: string | null;
  subsceneEntities: Set<SceneObject>;
  resolveTarget(target: string): SceneObject[];
  getSpatialDescendantObjects?(nodeId: string): SceneObject[];
  getAllSceneObjects(): SceneObject[];
  activateObject(obj: SceneObject, depth?: number, activator?: Actor): void;
  findEntity(name: string): Entity | undefined;
  entities: Entity[];
  triggerboxes: SceneObject[];
  walkbox?: SceneObject[];
}
