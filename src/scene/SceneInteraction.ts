import type { Scene } from './Scene';
import { SceneObject } from '../entities/SceneObject';
import { Triggerbox } from '../entities/Triggerbox';
import { Actor } from '../entities/Actor';
import { ComponentSystem } from '../systems/ComponentSystem';
import { GAME_DESIGN_HEIGHT, GAME_DESIGN_WIDTH } from '../core/Resolution';
import { getSceneTextLayerAccessState } from './SceneTextLayer';
import { isManagedBox3DFace, raycastBox3DFace } from '../entities/Box3DObject';

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
    const vOx = entity.visualOffset ? entity.visualOffset.x : 0;
    const vOy = entity.visualOffset ? entity.visualOffset.y : 0;
    const worldX = (screenX - halfW) / zoom + camX - vOx;
    const worldY = (screenY - halfH) / zoom + camY - vOy;
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
    const vOx = entity.visualOffset ? entity.visualOffset.x : 0;
    const vOy = entity.visualOffset ? entity.visualOffset.y : 0;
    const worldX = (screenX - halfW) / zoom + camX - vOx;
    const worldY = (screenY - halfH) / zoom + camY - vOy;
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

export function isWalkboxObject(obj: SceneObject | null | undefined): boolean {
  if (!obj) return false;
  if (obj.type === 'Walkbox') return true;
  if (obj.components && obj.components.length > 0) {
    return obj.components.some((c: any) => c && (c.type === 'WalkBox' || c.type === 'Walkbox'));
  }
  return false;
}

function getClickableTypePriority(obj: SceneObject): number {
  if (isWalkboxObject(obj)) return 30;
  if (obj.type === 'Triggerbox') return 10;
  return 0;
}

function getEffectiveLayer(obj: SceneObject): number {
  return (obj as any).__box3dSurfaceAnchor?.quad.layer ?? obj.layer ?? 0;
}

function sortClickableCandidates(candidates: SceneObject[]): SceneObject[] {
  const sorted = [...candidates];
  sorted.sort((a, b) => {
    const layerA = getEffectiveLayer(a);
    const layerB = getEffectiveLayer(b);
    if (layerA !== layerB) return layerB - layerA;

    const depthA = (a as any).box3dDepth;
    const depthB = (b as any).box3dDepth;
    if (Number.isFinite(depthA) && Number.isFinite(depthB) && Math.abs(depthA - depthB) > 0.000001)
      return depthA - depthB;

    const typePriorityA = getClickableTypePriority(a);
    const typePriorityB = getClickableTypePriority(b);
    if (typePriorityA !== typePriorityB) return typePriorityA - typePriorityB;

    const hasXYA = 'x' in (a as any) && 'y' in (a as any);
    const hasXYB = 'x' in (b as any) && 'y' in (b as any);
    if (hasXYA && !hasXYB) return -1;
    if (!hasXYA && hasXYB) return 1;
    if (isWalkboxObject(a) && !isWalkboxObject(b)) return 1;
    if (!isWalkboxObject(a) && isWalkboxObject(b)) return -1;
    return 0;
  });

  return sorted;
}

function getSortedClickableCandidates(scene: Scene): SceneObject[] {
  return sortClickableCandidates([
    ...scene.entities.filter(
      (e) => !e.disabled && e.visible && !(e as any).isPlayer && !(e as any).box3dHidden
    ),
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
  const boxHit = raycastBox3DFace(scene, screenX, screenY, candidates);
  for (const candidate of sortClickableCandidates(candidates)) {
    if (isManagedBox3DFace(candidate)) {
      if (candidate === boxHit) return candidate;
      continue;
    }
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
  if (isWalkboxObject(obj)) return false;
  if (obj instanceof Triggerbox && obj.script) return true;
  if (ComponentSystem.hasClickInteractionKeys(obj)) return true;
  if (!obj.components || obj.components.length === 0) return false;

  return obj.components.some(
    (component: any) =>
      ['Subtrigger', 'Subscene', 'Switch'].includes(component?.type) ||
      (component?.type === 'Exit' && component?.portal)
  );
}

function hasClickOutput(scene: Scene, obj: SceneObject): boolean {
  if (isWalkboxObject(obj)) {
    return false;
  }
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

function isTechnicalStorageSurface(scene: Scene, obj: SceneObject): boolean {
  const hasSurface = obj.components?.some((component: any) => component?.type === 'Surface');
  if (!hasSurface) return false;
  if (hasMeaningfulClickResult(scene, obj)) return false;

  const nonSurfaceComponents =
    obj.components?.filter((component: any) => component?.type !== 'Surface') || [];
  if (nonSurfaceComponents.length > 0) return false;

  return true;
}

function getSubsceneClickCandidates(scene: Scene): SceneObject[] {
  return Array.from(scene.subsceneEntities).filter(
    (obj) => !obj.disabled && obj.visible && !isTechnicalStorageSurface(scene, obj)
  );
}

function getHoverCursorForObject(scene: Scene, obj: SceneObject): HoverCursor | null {
  if (isWalkboxObject(obj)) {
    return null;
  }
  if (obj.components) {
    const sub = obj.components.find((c) => c.type === 'Subscene') as any;
    if (sub) {
      const currentSubsceneId = (obj.name || sub.targetGroupId || '').trim();
      if (scene.activeSubscene && currentSubsceneId && currentSubsceneId === scene.activeSubscene) {
        return null;
      }
      return 'eye';
    }

    const exitComp = obj.components.find((c) => c.type === 'Exit') as any;
    if (exitComp && exitComp.portal) {
      return 'back';
    }

    const hasHandTriggerComponent = obj.components.some((c) =>
      ['Subtrigger', 'Switch'].includes(c?.type)
    );
    if (hasHandTriggerComponent) {
      return 'hand';
    }
  }

  const isScriptTrigger = obj instanceof Triggerbox && obj.script && obj.script.length > 0;
  const hasInteractions = ComponentSystem.hasClickInteractionKeys(obj);
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
    const candidateLayer = getEffectiveLayer(candidate);
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
    const subsceneCandidates = getSubsceneClickCandidates(scene);
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

export function activateSceneObject(
  scene: Scene,
  obj: SceneObject,
  depth: number = 0,
  activator?: Actor
): boolean {
  if (depth > 5) {
    console.warn('[Scene] Recursion limit reached.');
    return false;
  }

  if (ComponentSystem.handleActivation(obj, scene, depth, activator)) {
    return true;
  }

  if (obj instanceof Triggerbox && obj.script) {
    // Intentionally silent: triggering handled by systems/scripts
    return true;
  }

  return false;
}

function activateOrApproachPlayer(scene: Scene, obj: SceneObject): boolean {
  const player = scene.player;
  const autoApproach = obj.components?.some(
    (component: any) =>
      component?.type === 'Subscene' || (component?.type === 'Exit' && component?.portal === true)
  );
  if (!player || !autoApproach) {
    return activateSceneObject(scene, obj, 0, player ?? undefined);
  }

  const approach = scene.game.actorNavigation.planApproach(player, obj);
  if (approach.status === 'already_reachable') {
    return activateSceneObject(scene, obj, 0, player);
  }
  if (!approach.point) {
    scene.game.showMessage(scene.game.text('engine.too_far_generic'));
    return true;
  }

  const result = player.moveTo(approach.point.x, approach.point.y);
  if (result.status !== 'started') {
    scene.game.showMessage(scene.game.text('engine.too_far_generic'));
    return true;
  }
  const poll = () => {
    const moveResult = player.getMoveResult();
    if (moveResult.status === 'started' && player.state === 'walk') {
      globalThis.setTimeout(poll, 50);
      return;
    }
    if (
      moveResult.status === 'arrived' &&
      scene.game.actorNavigation.isReachable(player, obj) &&
      scene.getObjectByName(obj.name) === obj
    ) {
      activateSceneObject(scene, obj, 0, player);
      return;
    }
    scene.game.showMessage(scene.game.text('engine.too_far_generic'));
  };
  globalThis.setTimeout(poll, 50);
  return true;
}

export function handleSceneClick(scene: Scene, x: number, y: number): void {
  if (scene.activeSubscene) {
    const subsceneCandidates = getSubsceneClickCandidates(scene);
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
      if (isWalkboxObject(subsceneHit)) {
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
      activateOrApproachPlayer(scene, subsceneHit);
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
    if (isWalkboxObject(hitObj)) {
      movePlayerToClick(scene, x, y);
      return;
    }
    revealLookableByClick(scene, hitObj);
    const seeMessage = scene.game.getSeeMessage(hitObj);
    const title = shouldSuppressTitleByHiddenState(scene, hitObj)
      ? null
      : scene.game.textAssets.getResolvedObjectField(hitObj, 'title');
    const activated = activateOrApproachPlayer(scene, hitObj);

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
    if (isWalkboxObject(visibleHitObj)) {
      movePlayerToClick(scene, x, y);
      return;
    }
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
