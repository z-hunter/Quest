import { ScriptRegistry } from '../../core/ScriptRegistry';
import { QuadObject } from '../../entities/QuadObject';

const GROUP_TAG = '#tv_glow';
const MIN_TRANSPARENCY = 0.65;
const MAX_TRANSPARENCY = 0.8;
const TICK_MS = 16;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const hasGroupTag = (groupID: string | null | undefined, tag: string): boolean =>
  String(groupID || '')
    .split(',')
    .map((entry) => entry.trim())
    .includes(tag);

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * Flickers floor-glow quads tagged with #tv_glow as if lit by a working TV.
 *
 * The requested transparency range is 75-80%, where 100% means fully transparent.
 * QuadObject.opacity is canvas alpha instead, so the script writes alpha 0.25-0.20.
 *
 * Usage: #RUN tv_glow
 */
ScriptRegistry.register('tv_glow', ({ api, game }) => {
  const scene = game.sceneManager.currentScene;
  const sceneEntities: any[] = scene?.entities || [];
  const glowQuads: QuadObject[] = sceneEntities.filter(
    (entity: any): entity is QuadObject =>
      (entity instanceof QuadObject || entity?.type === 'Quad') &&
      hasGroupTag(entity.groupID, GROUP_TAG)
  );

  if (glowQuads.length === 0) {
    api.log(`tv_glow: no Quad objects tagged ${GROUP_TAG} in the current scene.`);
    return;
  }

  api.log(`tv_glow: animating ${glowQuads.length} Quad object(s).`);

  let currentTransparency = randomBetween(MIN_TRANSPARENCY, MAX_TRANSPARENCY);
  let startTransparency = currentTransparency;
  let targetTransparency = randomBetween(MIN_TRANSPARENCY, MAX_TRANSPARENCY);
  let elapsed = 0;
  let duration = randomBetween(90, 280);

  const chooseNextPulse = () => {
    startTransparency = currentTransparency;
    targetTransparency = randomBetween(MIN_TRANSPARENCY, MAX_TRANSPARENCY);
    duration = randomBetween(70, 340);
    elapsed = 0;
  };

  const applyGlow = () => {
    elapsed += TICK_MS;

    if (elapsed >= duration) {
      currentTransparency = targetTransparency;
      chooseNextPulse();
    }

    const t = clamp01(elapsed / duration);
    const eased = 0.5 - Math.cos(t * Math.PI) / 2;
    const microFlicker = randomBetween(-0.004, 0.004);
    currentTransparency = clamp01(
      startTransparency + (targetTransparency - startTransparency) * eased + microFlicker
    );

    const alpha = clamp01(1 - currentTransparency);
    glowQuads.forEach((quad) => {
      quad.opacity = alpha;
    });
  };

  applyGlow();
  api.setInterval(applyGlow, TICK_MS);
});
