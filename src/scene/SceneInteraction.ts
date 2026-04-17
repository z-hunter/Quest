import type { Scene } from './Scene';
import { SceneObject } from '../entities/SceneObject';
import { Triggerbox } from '../entities/Triggerbox';
import { ComponentSystem } from '../systems/ComponentSystem';
import { GAME_DESIGN_HEIGHT, GAME_DESIGN_WIDTH } from '../core/Resolution';
import { getSceneTextLayerAccessState } from './SceneTextLayer';

export type HoverCursor = 'eye' | 'hand' | 'back';

function getScreenSize(scene: Scene): { width: number; height: number } {
  const canvas = scene.game?.canvas;
  return {
    width: canvas?.width || GAME_DESIGN_WIDTH,
    height: canvas?.height || GAME_DESIGN_HEIGHT,
  };
}

function toWorld(scene: Scene, x: number, y: number): { x: number; y: number } {
  const { width: screenW, height: screenH } = getScreenSize(scene);
  const halfW = screenW / 2;
  const halfH = screenH / 2;
  return {
    x: (x - halfW) / scene.camera.zoom + scene.camera.x,
    y: (y - halfH) / scene.camera.zoom + scene.camera.y,
  };
}

function toWorldForParallax(
  scene: Scene,
  x: number,
  y: number,
  parallax: number = 1.0
): { x: number; y: number } {
  const { width: screenW, height: screenH } = getScreenSize(scene);
  const halfW = screenW / 2;
  const halfH = screenH / 2;
  return {
    x: (x - halfW) / scene.camera.zoom + scene.camera.x * parallax,
    y: (y - halfH) / scene.camera.zoom + scene.camera.y * parallax,
  };
}

function findVisibleHitObject(scene: Scene, screenX: number, screenY: number): SceneObject | null {
  return findTopHitInCandidates(scene, getSortedClickableCandidates(scene), screenX, screenY);
}

function isHitAtScreenPoint(
  scene: Scene,
  obj: SceneObject,
  screenX: number,
  screenY: number
): boolean {
  const { width: screenW, height: screenH } = getScreenSize(scene);
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
    x:
      (screenX - halfW) / zoom +
      camX * ((obj as any).parallax !== undefined ? (obj as any).parallax : 1.0),
    y:
      (screenY - halfH) / zoom +
      camY * ((obj as any).parallax !== undefined ? (obj as any).parallax : 1.0),
  };
  return obj.hitTest(worldPos.x, worldPos.y);
}

function containsScreenPoint(
  scene: Scene,
  obj: SceneObject,
  screenX: number,
  screenY: number
): boolean {
  const { width: screenW, height: screenH } = getScreenSize(scene);
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
    return obj.containsPoint(worldX, worldY);
  }

  const worldPos = {
    x:
      (screenX - halfW) / zoom +
      camX * ((obj as any).parallax !== undefined ? (obj as any).parallax : 1.0),
    y:
      (screenY - halfH) / zoom +
      camY * ((obj as any).parallax !== undefined ? (obj as any).parallax : 1.0),
  };
  return obj.containsPoint(worldPos.x, worldPos.y);
}

function getClickableTypePriority(obj: SceneObject): number {
  if (obj.type === 'Walkbox') return 30;
  if (obj.type === 'Triggerbox') return 10;
  return 0;
}

function sortClickableCandidates(candidates: SceneObject[]): SceneObject[] {
  const sorted = [...candidates];
  sorted.sort((a, b) => {
    const layerA = a.layer || 0;
    const layerB = b.layer || 0;
    if (layerA !== layerB) return layerB - layerA;

    const typePriorityA = getClickableTypePriority(a);
    const typePriorityB = getClickableTypePriority(b);
    if (typePriorityA !== typePriorityB) return typePriorityA - typePriorityB;

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
    ...scene.entities.filter((e) => !e.disabled && e.visible && !(e as any).isPlayer),
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

function isContainedInCandidates(
  scene: Scene,
  candidates: SceneObject[],
  screenX: number,
  screenY: number
): boolean {
  for (const candidate of sortClickableCandidates(candidates)) {
    if (containsScreenPoint(scene, candidate, screenX, screenY)) {
      return true;
    }
  }
  return false;
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

function canActivateOnClick(obj: SceneObject): boolean {
  if (obj instanceof Triggerbox && obj.script) return true;
  if (obj.interactions && Object.keys(obj.interactions).length > 0) return true;
  if (!obj.components || obj.components.length === 0) return false;

  return obj.components.some((component: any) =>
    ['Subtrigger', 'Subscene', 'Switch'].includes(component?.type)
  );
}

function hasClickOutput(scene: Scene, obj: SceneObject): boolean {
  const titleOwner = resolveSubtriggerTarget(scene, obj);
  const accessState = getSceneTextLayerAccessState(scene, scene.game, titleOwner);
  if (accessState.hiddenReason === 'examinable') {
    return false;
  }
  const seeMessage = scene.game.getSeeMessage(titleOwner);
  if (seeMessage) return true;

  const title = scene.game.textAssets.getResolvedObjectField(titleOwner, 'title');
  return !!(title && title.trim());
}

function revealLookableByClick(scene: Scene, obj: SceneObject): void {
  const titleOwner = resolveSubtriggerTarget(scene, obj);
  const accessState = getSceneTextLayerAccessState(scene, scene.game, titleOwner);
  if (accessState.hiddenReason === 'lookable') {
    scene.revealHiddenEntity(titleOwner);
  }
}

function shouldSuppressTitleByHiddenState(scene: Scene, obj: SceneObject): boolean {
  const titleOwner = resolveSubtriggerTarget(scene, obj);
  const accessState = getSceneTextLayerAccessState(scene, scene.game, titleOwner);
  return accessState.hiddenReason === 'examinable';
}

function movePlayerToClick(scene: Scene, x: number, y: number): void {
  if (!scene.player) return;

  const visualTarget = toWorld(scene, x, y);
  if (typeof (scene.player as any).moveToVisual === 'function') {
    (scene.player as any).moveToVisual(visualTarget.x, visualTarget.y);
  } else if (typeof scene.player.walkTo === 'function') {
    const playerParallax = scene.player.parallax !== undefined ? scene.player.parallax : 1.0;
    const playerTarget = toWorldForParallax(scene, x, y, playerParallax);
    scene.player.walkTo(playerTarget.x, playerTarget.y);
  } else if (typeof scene.player.moveTo === 'function') {
    const playerParallax = scene.player.parallax !== undefined ? scene.player.parallax : 1.0;
    const playerTarget = toWorldForParallax(scene, x, y, playerParallax);
    scene.player.moveTo(playerTarget.x, playerTarget.y);
  }
}

function hasMeaningfulClickResult(scene: Scene, obj: SceneObject): boolean {
  return hasClickOutput(scene, obj) || canActivateOnClick(obj);
}

function getHoverCursorForObject(scene: Scene, obj: SceneObject): HoverCursor | null {
  if (obj.components) {
    const sub = obj.components.find((c) => c.type === 'Subscene') as any;
    if (sub) {
      const currentSubsceneId = (obj.name || sub.targetGroupId || '').trim();
      if (scene.activeSubscene && currentSubsceneId && currentSubsceneId === scene.activeSubscene) {
        return null;
      }
      return 'eye';
    }

    const hasHandTriggerComponent = obj.components.some((c) =>
      ['Subtrigger', 'Switch'].includes(c?.type)
    );
    if (hasHandTriggerComponent) {
      return 'hand';
    }
  }

  const isScriptTrigger = obj instanceof Triggerbox && obj.script && obj.script.length > 0;
  const hasInteractions = !!(obj.interactions && Object.keys(obj.interactions).length > 0);
  if (isScriptTrigger || hasInteractions) {
    return 'hand';
  }

  return null;
}

function findTopLayerHitCandidatesAtScreenPoint(
  scene: Scene,
  candidates: SceneObject[],
  screenX: number,
  screenY: number
): SceneObject[] {
  const hits: SceneObject[] = [];
  let topLayer: number | null = null;

  for (const candidate of sortClickableCandidates(candidates)) {
    if (!isHitAtScreenPoint(scene, candidate, screenX, screenY)) continue;
    const candidateLayer = candidate.layer || 0;
    if (topLayer === null) {
      topLayer = candidateLayer;
    }
    if (candidateLayer !== topLayer) break;
    hits.push(candidate);
  }

  return hits;
}

function findBestMeaningfulHit(
  scene: Scene,
  candidates: SceneObject[],
  screenX: number,
  screenY: number
): SceneObject | null {
  const topLayerHits = findTopLayerHitCandidatesAtScreenPoint(scene, candidates, screenX, screenY);
  for (const candidate of topLayerHits) {
    if (hasMeaningfulClickResult(scene, candidate)) {
      return candidate;
    }
  }
  return null;
}

export function getHoverCursorAtScreenPoint(
  scene: Scene,
  screenX: number,
  screenY: number
): HoverCursor | null {
  if (scene.activeSubscene) {
    const subsceneCandidates = Array.from(scene.subsceneEntities).filter(
      (obj) => !obj.disabled && obj.visible
    );
    const topLayerHits = findTopLayerHitCandidatesAtScreenPoint(
      scene,
      subsceneCandidates,
      screenX,
      screenY
    );
    for (const obj of topLayerHits) {
      const hoverCursor = getHoverCursorForObject(scene, obj);
      if (hoverCursor) {
        return hoverCursor;
      }
    }
    return isContainedInCandidates(scene, subsceneCandidates, screenX, screenY) ? null : 'back';
  }

  const topLayerHits = findTopLayerHitCandidatesAtScreenPoint(
    scene,
    getSortedClickableCandidates(scene),
    screenX,
    screenY
  );
  for (const obj of topLayerHits) {
    const hoverCursor = getHoverCursorForObject(scene, obj);
    if (hoverCursor) {
      return hoverCursor;
    }
  }
  return null;
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
  if (scene.activeSubscene) {
    const subsceneCandidates = Array.from(scene.subsceneEntities).filter(
      (obj) => !obj.disabled && obj.visible
    );
    const subsceneHitCandidates = findTopLayerHitCandidatesAtScreenPoint(
      scene,
      subsceneCandidates,
      x,
      y
    );
    const subsceneHitRaw =
      subsceneHitCandidates.find((obj) => hasMeaningfulClickResult(scene, obj)) || null;

    if (subsceneHitRaw) {
      const subsceneHit = resolveSubtriggerTarget(scene, subsceneHitRaw);
      if (subsceneHit.type === 'Walkbox') {
        movePlayerToClick(scene, x, y);
        return;
      }
      revealLookableByClick(scene, subsceneHit);
      const seeMessage = scene.game.getSeeMessage(subsceneHit);
      const title = shouldSuppressTitleByHiddenState(scene, subsceneHit)
        ? null
        : scene.game.textAssets.getResolvedObjectField(subsceneHit, 'title');
      if (seeMessage) {
        scene.game.log(seeMessage);
      } else if (title && title.trim()) {
        scene.game.log(scene.game.text('engine.click_you_see', { title }));
      }
      activateSceneObject(scene, subsceneHit);
      return;
    }

    if (
      subsceneHitCandidates.length > 0 ||
      isContainedInCandidates(scene, subsceneCandidates, x, y)
    ) {
      return;
    }

    scene.activeSubscene = null;
    return;
  }

  const rawHitObj = findBestMeaningfulHit(scene, getSortedClickableCandidates(scene), x, y);

  if (rawHitObj) {
    const hitObj = resolveSubtriggerTarget(scene, rawHitObj);
    if (hitObj.type === 'Walkbox') {
      movePlayerToClick(scene, x, y);
      return;
    }
    revealLookableByClick(scene, hitObj);
    const seeMessage = scene.game.getSeeMessage(hitObj);
    const title = shouldSuppressTitleByHiddenState(scene, hitObj)
      ? null
      : scene.game.textAssets.getResolvedObjectField(hitObj, 'title');
    const activated = activateSceneObject(scene, hitObj);

    if (seeMessage) {
      scene.game.log(seeMessage);
      return;
    }

    if (title) {
      scene.game.log(scene.game.text('engine.click_you_see', { title }));
      return;
    }

    if (activated) {
      return;
    }
  }

  const rawVisibleHitObj = findVisibleHitObject(scene, x, y);
  if (rawVisibleHitObj) {
    const visibleHitObj = resolveSubtriggerTarget(scene, rawVisibleHitObj);
    revealLookableByClick(scene, visibleHitObj);
    const seeMessage = scene.game.getSeeMessage(visibleHitObj);
    const title = shouldSuppressTitleByHiddenState(scene, visibleHitObj)
      ? null
      : scene.game.textAssets.getResolvedObjectField(visibleHitObj, 'title');
    if (seeMessage) {
      scene.game.log(seeMessage);
      return;
    }
    if (title && title.trim()) {
      scene.game.log(scene.game.text('engine.click_you_see', { title }));
      return;
    }
  }

  if (scene.player) {
    movePlayerToClick(scene, x, y);
  }
}
