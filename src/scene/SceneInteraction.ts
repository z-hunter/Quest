import type { Scene } from './Scene';
import { SceneObject } from '../entities/SceneObject';
import { Triggerbox } from '../entities/Triggerbox';
import { ComponentSystem } from '../systems/ComponentSystem';

function toWorld(scene: Scene, x: number, y: number): { x: number; y: number } {
    const screenW = 420;
    const screenH = 300;
    const halfW = screenW / 2;
    const halfH = screenH / 2;
    return {
        x: (x - halfW) / scene.camera.zoom + scene.camera.x,
        y: (y - halfH) / scene.camera.zoom + scene.camera.y
    };
}

export function activateSceneObject(scene: Scene, obj: SceneObject, depth: number = 0): void {
    if (depth > 5) {
        console.warn('[Scene] Recursion limit reached.');
        return;
    }

    if (ComponentSystem.handleActivation(obj, scene, depth)) {
        return;
    }

    if (obj instanceof Triggerbox && obj.script) {
        // Intentionally silent: triggering handled by systems/scripts
    }
}

export function handleSceneClick(scene: Scene, x: number, y: number): void {
    const world = toWorld(scene, x, y);
    const hitObj = scene.getHitObject(world.x, world.y);

    if (hitObj) {
        const isWalkBox = hitObj.components && hitObj.components.some(c => c.type === 'WalkBox');
        const isMechanism = hitObj.components && hitObj.components.some(c => ['Switch', 'Subscene', 'Subtrigger'].includes(c.type));
        const hasScript = (hitObj instanceof Triggerbox) && (hitObj.script && hitObj.script.length > 0);

        if (!(isWalkBox && !isMechanism && !hasScript)) {
            activateSceneObject(scene, hitObj);
            return;
        }
    }

    if (scene.activeSubscene) {
        for (const obj of scene.subsceneEntities) {
            if (obj.hitTest(world.x, world.y)) {
                return;
            }
        }
        scene.activeSubscene = null;
        return;
    }

    if (scene.player) {
        if (typeof scene.player.walkTo === 'function') {
            scene.player.walkTo(world.x, world.y);
        } else if (typeof scene.player.moveTo === 'function') {
            scene.player.moveTo(world.x, world.y);
        }
    }
}
