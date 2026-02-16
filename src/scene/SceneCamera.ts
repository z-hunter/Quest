import type { Scene } from './Scene';

export interface CameraCenteringState {
    isCenteringX: boolean;
    isCenteringY: boolean;
}

export function updateSceneCamera(scene: Scene, deltaTime: number, state: CameraCenteringState): CameraCenteringState {
    if (!scene.player || !scene.autoCenter) return state;

    const pHeight = scene.player.height || 0;
    const playerCenterX = scene.player.x;
    const playerCenterY = scene.player.y - pHeight / 2;

    let targetX = scene.camera.x;
    let targetY = scene.camera.y;

    const dx = playerCenterX - scene.camera.x;
    const dy = playerCenterY - scene.camera.y;

    let isCenteringX = state.isCenteringX;
    let isCenteringY = state.isCenteringY;

    if (Math.abs(dx) > scene.camDeadzoneX) isCenteringX = true;
    if (isCenteringX) {
        targetX = playerCenterX;
        if (Math.abs(dx) < 2) isCenteringX = false;
    }

    if (Math.abs(dy) > scene.camDeadzoneY) isCenteringY = true;
    if (isCenteringY) {
        targetY = playerCenterY;
        if (Math.abs(dy) < 2) isCenteringY = false;
    }

    if (scene.camMinX !== undefined) targetX = Math.max(scene.camMinX, targetX);
    if (scene.camMaxX !== undefined) targetX = Math.min(scene.camMaxX, targetX);
    if (scene.camMinY !== undefined) targetY = Math.max(scene.camMinY, targetY);
    if (scene.camMaxY !== undefined) targetY = Math.min(scene.camMaxY, targetY);

    const dt = deltaTime / 1000;
    const speed = scene.cameraSpeed || 5.0;

    if (Math.abs(targetX - scene.camera.x) < 0.5) scene.camera.x = targetX;
    else scene.camera.x += (targetX - scene.camera.x) * speed * dt;

    if (Math.abs(targetY - scene.camera.y) < 0.5) scene.camera.y = targetY;
    else scene.camera.y += (targetY - scene.camera.y) * speed * dt;

    return { isCenteringX, isCenteringY };
}
