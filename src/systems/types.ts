import type { Scene } from '../scene/Scene';
import type { SceneObject } from '../entities/SceneObject';
import type { Entity } from '../entities/Entity';

export type SceneSystemContext = Scene;

export interface ActivationSceneContext {
  game: {
    inventory: Array<{ name?: string; id?: string }>;
    playSound(name: string): void;
    showMessage(text: string): void;
  };
  player: { x: number; y: number; width?: number } | null;
  activeSubscene: string | null;
  subsceneEntities: Set<SceneObject>;
  resolveTarget(target: string): SceneObject[];
  getSpatialDescendantObjects?(nodeId: string): SceneObject[];
  activateObject(obj: SceneObject, depth?: number): void;
  findEntity(name: string): Entity | undefined;
  entities: Entity[];
  triggerboxes: SceneObject[];
  walkbox?: SceneObject[];
}
