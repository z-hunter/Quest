import type { Scene } from './Scene';

export interface CameraCenteringState {
  centeringDirX: number;
  centeringDirY: number;
}

const playerCameraOffsets = new WeakMap<object, number>();

export function getPlayerCameraOffsetY(player: {
  baseHeight?: number;
  modelScale?: number;
}): number {
  const cached = playerCameraOffsets.get(player);
  if (cached !== undefined) return cached;

  const baseHeight = Number.isFinite(player.baseHeight) ? player.baseHeight! : 0;
  const modelScale = Number.isFinite(player.modelScale) ? player.modelScale! : 1;
  const offset = (baseHeight * modelScale) / 2;
  playerCameraOffsets.set(player, offset);
  return offset;
}

export function updateSceneCamera(
  scene: Scene,
  deltaTime: number,
  state: CameraCenteringState
): CameraCenteringState {
  if (!scene.player || !scene.autoCenter) {
    scene.collisionCamera = { x: scene.camera.x, y: scene.camera.y };
    return state;
  }

  const isEditorOpen = Boolean(scene.game?.editor?.enabled);
  if (isEditorOpen && scene.editorCameraSuspended) {
    if (scene.editorCameraAnchorPlayerPos) {
      const pDx = scene.player.x - scene.editorCameraAnchorPlayerPos.x;
      const pDy = scene.player.y - scene.editorCameraAnchorPlayerPos.y;
      if (Math.hypot(pDx, pDy) > 0.5) {
        scene.resumeEditorCameraFollow();
      } else {
        scene.collisionCamera = { x: scene.camera.x, y: scene.camera.y };
        return state;
      }
    } else {
      scene.editorCameraAnchorPlayerPos = { x: scene.player.x, y: scene.player.y };
      scene.collisionCamera = { x: scene.camera.x, y: scene.camera.y };
      return state;
    }
  } else if (!isEditorOpen && scene.editorCameraSuspended) {
    scene.resumeEditorCameraFollow();
  }

  const playerParallax =
    typeof scene.player.parallax === 'number' && Math.abs(scene.player.parallax) > 0.000001
      ? scene.player.parallax
      : 1;
  const playerCenterX = scene.player.x;
  const playerCenterY = scene.player.y - getPlayerCameraOffsetY(scene.player);

  let targetX = scene.camera.x;
  let targetY = scene.camera.y;

  // Camera deadzones are screen-space distances. A Player on a 3d-parallax
  // surface is rendered at `world - camera * P`, so comparing raw world
  // coordinates causes a camera/Parallax feedback loop as P changes.
  const dx = playerCenterX - scene.camera.x * playerParallax;
  const dy = playerCenterY - scene.camera.y * playerParallax;

  let dirX = state.centeringDirX;
  let dirY = state.centeringDirY;

  if (Math.abs(dx) > scene.camDeadzoneX) {
    dirX = Math.sign(dx);
  }

  if (dirX !== 0) {
    targetX = (playerCenterX + dirX * scene.camDeadzoneX) / playerParallax;
    if (Math.abs(targetX - scene.camera.x) < 2) {
      dirX = 0;
      scene.camera.x = targetX;
    }
  }

  if (Math.abs(dy) > scene.camDeadzoneY) {
    dirY = Math.sign(dy);
  }

  if (dirY !== 0) {
    targetY = (playerCenterY + dirY * scene.camDeadzoneY) / playerParallax;
    if (Math.abs(targetY - scene.camera.y) < 2) {
      dirY = 0;
      scene.camera.y = targetY;
    }
  }

  if (scene.camMinX !== undefined) targetX = Math.max(scene.camMinX, targetX);
  if (scene.camMaxX !== undefined) targetX = Math.min(scene.camMaxX, targetX);
  if (scene.camMinY !== undefined) targetY = Math.max(scene.camMinY, targetY);
  if (scene.camMaxY !== undefined) targetY = Math.min(scene.camMaxY, targetY);

  // Store the unsmoothed target camera position for deterministic collision checks
  scene.collisionCamera = { x: targetX, y: targetY };

  const dt = deltaTime / 1000;
  const speed = scene.cameraSpeed || 5.0;

  if (Math.abs(targetX - scene.camera.x) < 0.5) scene.camera.x = targetX;
  else scene.camera.x += (targetX - scene.camera.x) * speed * dt;

  if (Math.abs(targetY - scene.camera.y) < 0.5) scene.camera.y = targetY;
  else scene.camera.y += (targetY - scene.camera.y) * speed * dt;

  return { centeringDirX: dirX, centeringDirY: dirY };
}
