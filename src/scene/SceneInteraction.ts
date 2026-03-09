import type { Scene } from './Scene';
import { SceneObject } from '../entities/SceneObject';
import { Triggerbox } from '../entities/Triggerbox';
import { ComponentSystem } from '../systems/ComponentSystem';
import { Geometry } from '../utils/Geometry';

function toWorld(scene: Scene, x: number, y: number): { x: number; y: number } {
  const screenW = 420;
  const screenH = 300;
  const halfW = screenW / 2;
  const halfH = screenH / 2;
  return {
    x: (x - halfW) / scene.camera.zoom + scene.camera.x,
    y: (y - halfH) / scene.camera.zoom + scene.camera.y,
  };
}

function findVisibleHitObject(scene: Scene, screenX: number, screenY: number): SceneObject | null {
  const screenW = 420;
  const screenH = 300;
  const halfW = screenW / 2;
  const halfH = screenH / 2;
  const camX = scene.camera.x;
  const camY = scene.camera.y;
  const zoom = scene.camera.zoom;

  const entities = scene.entities || [];
  for (let i = entities.length - 1; i >= 0; i--) {
    const entity = entities[i];
    if (entity.disabled || !entity.visible) continue;

    const p = entity.parallax !== undefined ? entity.parallax : 1.0;
    const vOx = (entity as any).visualOffset ? (entity as any).visualOffset.x : 0;
    const vOy = (entity as any).visualOffset ? (entity as any).visualOffset.y : 0;
    const worldX = (screenX - halfW) / zoom + camX * p - vOx;
    const worldY = (screenY - halfH) / zoom + camY * p - vOy;

    if (entity.hitTest(worldX, worldY)) return entity;
  }

  const worldPos = {
    x: (screenX - halfW) / zoom + camX,
    y: (screenY - halfH) / zoom + camY,
  };

  if (scene.triggerboxes) {
    for (const tb of scene.triggerboxes) {
      if (tb.disabled || !tb.visible) continue;
      if (Geometry.isPointInPolygon(worldPos, tb.poly)) return tb;
    }
  }

  if (scene.walkbox) {
    for (const wb of scene.walkbox) {
      if (wb.disabled || !wb.visible) continue;
      if (Geometry.isPointInPolygon(worldPos, wb.poly)) return wb;
    }
  }

  return null;
}

function isHitAtScreenPoint(
  scene: Scene,
  obj: SceneObject,
  screenX: number,
  screenY: number
): boolean {
  const screenW = 420;
  const screenH = 300;
  const halfW = screenW / 2;
  const halfH = screenH / 2;
  const camX = scene.camera.x;
  const camY = scene.camera.y;
  const zoom = scene.camera.zoom;

  if ('x' in obj && 'y' in obj) {
    const entity = obj as any;
    const p = entity.parallax !== undefined ? entity.parallax : 1.0;
    const vOx = entity.visualOffset ? entity.visualOffset.x : 0;
    const vOy = entity.visualOffset ? entity.visualOffset.y : 0;
    const worldX = (screenX - halfW) / zoom + camX * p - vOx;
    const worldY = (screenY - halfH) / zoom + camY * p - vOy;
    return obj.hitTest(worldX, worldY);
  }

  const worldPos = {
    x: (screenX - halfW) / zoom + camX,
    y: (screenY - halfH) / zoom + camY,
  };
  return obj.hitTest(worldPos.x, worldPos.y);
}

function sortClickableCandidates(candidates: SceneObject[]): SceneObject[] {
  const sorted = [...candidates];
  sorted.sort((a, b) => {
    const layerA = a.layer || 0;
    const layerB = b.layer || 0;
    if (layerA !== layerB) return layerB - layerA;

    const hasXYA = 'x' in (a as any) && 'y' in (a as any);
    const hasXYB = 'x' in (b as any) && 'y' in (b as any);
    if (hasXYA && !hasXYB) return -1;
    if (!hasXYA && hasXYB) return 1;
    return 0;
  });

  return sorted;
}

function getSortedClickableCandidates(scene: Scene): SceneObject[] {
  return sortClickableCandidates([
    ...scene.entities.filter((e) => !e.disabled && e.visible),
    ...(scene.triggerboxes?.filter((t) => !t.disabled && t.visible) || []),
    ...(scene.walkbox?.filter((w) => !w.disabled && w.visible) || []),
  ]);
}

function findTopHitInCandidates(
  scene: Scene,
  candidates: SceneObject[],
  screenX: number,
  screenY: number
): SceneObject | null {
  for (const candidate of sortClickableCandidates(candidates)) {
    if (isHitAtScreenPoint(scene, candidate, screenX, screenY)) {
      return candidate;
    }
  }
  return null;
}

function findTopHitInWorldCandidates(
  candidates: SceneObject[],
  worldX: number,
  worldY: number
): SceneObject | null {
  for (const candidate of sortClickableCandidates(candidates)) {
    if (candidate.hitTest(worldX, worldY)) {
      return candidate;
    }
  }
  return null;
}

function findTopHitObject(scene: Scene, screenX: number, screenY: number): SceneObject | null {
  return findTopHitInCandidates(scene, getSortedClickableCandidates(scene), screenX, screenY);
}

function resolveSubtriggerTarget(scene: Scene, obj: SceneObject): SceneObject {
  const subtrigger = obj.components?.find((c: any) => c?.type === 'Subtrigger') as
    | { target?: string }
    | undefined;
  if (!subtrigger?.target) return obj;

  const target =
    scene.triggerboxes.find((t) => t.name === subtrigger.target) ||
    scene.entities.find((e) => e.name === subtrigger.target);
  return target || obj;
}

export function activateSceneObject(scene: Scene, obj: SceneObject, depth: number = 0): boolean {
  if (depth > 5) {
    console.warn('[Scene] Recursion limit reached.');
    return false;
  }

  if (ComponentSystem.handleActivation(obj, scene, depth)) {
    return true;
  }

  if (obj instanceof Triggerbox && obj.script) {
    // Intentionally silent: triggering handled by systems/scripts
    return true;
  }

  return false;
}

export function handleSceneClick(scene: Scene, x: number, y: number): void {
  const world = toWorld(scene, x, y);

  if (scene.activeSubscene) {
    const subsceneHit = findTopHitInWorldCandidates(
      Array.from(scene.subsceneEntities).filter((obj) => !obj.disabled && obj.visible),
      world.x,
      world.y
    );

    if (subsceneHit) {
      const titleOwner = resolveSubtriggerTarget(scene, subsceneHit);
      const title = scene.game.textAssets.getResolvedObjectField(titleOwner, 'title');
      if (title && title.trim()) {
        scene.game.log(scene.game.text('engine.click_you_see', { title }));
      }
      activateSceneObject(scene, subsceneHit);
      return;
    }

    scene.activeSubscene = null;
    return;
  }

  const hitObj = findTopHitObject(scene, x, y);

  if (hitObj) {
    const titleOwner = resolveSubtriggerTarget(scene, hitObj);
    const title = scene.game.textAssets.getResolvedObjectField(titleOwner, 'title');
    const activated = activateSceneObject(scene, hitObj);

    if (title) {
      scene.game.log(scene.game.text('engine.click_you_see', { title }));
      return;
    }

    if (activated) {
      return;
    }
  }

  const visibleHitObj = findTopHitObject(scene, x, y) || findVisibleHitObject(scene, x, y);
  if (visibleHitObj) {
    const titleOwner = resolveSubtriggerTarget(scene, visibleHitObj);
    const title = scene.game.textAssets.getResolvedObjectField(titleOwner, 'title');
    if (title && title.trim()) {
      scene.game.log(scene.game.text('engine.click_you_see', { title }));
      return;
    }
  }

  if (scene.player) {
    if (typeof scene.player.walkTo === 'function') {
      scene.player.walkTo(world.x, world.y);
    } else if (typeof scene.player.moveTo === 'function') {
      scene.player.moveTo(world.x, world.y);
    }
  }
}
