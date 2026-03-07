import type { Scene } from './Scene';
import { SceneObject } from '../entities/SceneObject';

export function resolveSceneTargets(scene: Scene, targetStr: string): SceneObject[] {
  if (!targetStr) return [];

  const targets = new Set<SceneObject>();
  const tokens = targetStr
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  tokens.forEach((token) => {
    if (token.startsWith('#')) {
      scene.entities.forEach((e) => {
        if (!e.groupID) return;
        const groups = e.groupID.split(',').map((g) => g.trim());
        if (groups.includes(token)) targets.add(e);
      });

      scene.triggerboxes.forEach((t) => {
        if (!t.groupID) return;
        const groups = t.groupID.split(',').map((g) => g.trim());
        if (groups.includes(token)) targets.add(t);
      });
      return;
    }

    const obj = scene.findEntity(token);
    if (obj) targets.add(obj);

    const tb = scene.triggerboxes.find((t) => t.name === token);
    if (tb) targets.add(tb);
  });

  return Array.from(targets);
}

export function cleanupClosingSubscene(scene: Scene, closingId: string): void {
  const closingTargets = resolveSceneTargets(scene, closingId);

  closingTargets.forEach((obj) => {
    if (!obj.components) return;
    for (const comp of obj.components) {
      if (comp.type !== 'Switch') continue;
      const sw = comp as { state?: number; sound1?: string };
      if (sw.state !== 2) continue;

      sw.state = 1;
      if (sw.sound1) {
        scene.game.playSound(sw.sound1);
      }
    }
  });

  scene.subsceneEntities.forEach((e) => {
    e.disabled = true;
  });
  scene.subsceneEntities.clear();
}
