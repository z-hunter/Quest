import { ScriptRegistry } from '../../core/ScriptRegistry';

let lastIntervalId: any = null;

ScriptRegistry.register('test_3d_sound2', async ({ game, api }) => {
  api.log('Starting 3D Sound Test 2...');

  // Stop previous iteration if still running
  if (lastIntervalId) {
    api.clearInterval(lastIntervalId);
    lastIntervalId = null;
  }

  const scene = game.sceneManager?.currentScene;
  if (!scene) {
    api.log('Error: No active scene.');
    return;
  }

  const entityId = 'sound_test2';
  const soundUrl =
    'sounds/music/455516__ispeakwaves__the-plan-upbeat-loop-no-voice-edit-mono-track.ogg';

  // 1. Setup Entity
  let entity = scene.findEntity(entityId);

  if (!entity) {
    api.log(`Creating test entity: ${entityId}`);
    // Using simple approach since we are inside engine context
    const { Entity } = await import('../../entities/Entity');
    entity = new Entity(game, 0, 0, 32, 32, entityId);
    entity.parallax = 0.8;
    scene.addEntity(entity);
  } else {
    api.log(`Using existing entity: ${entityId}`);
    entity.parallax = 0.8;
  }

  // 3. Load Main Sound
  api.log('Loading main sound...');
  await api.loadSound(entityId, soundUrl);

  // 4. Play and Attach (should automatically use scene reverb)
  api.log('Starting playback (reverb should be inherited from scene)...');
  api.playSoundAttached(entityId, entityId, {
    loop: true,
    volume: 0.8,
    useProximityEQ: true,
  });

  // 4. Animation Loop
  const radiusX = 500;
  const radiusP = 0.6; // Parallax swing (e.g. 1.1 +/- 0.6)
  let angle = 0;

  api.log('Orbiting entity around listener (X + Parallax)...');

  lastIntervalId = api.setInterval(() => {
    angle += 0.02;

    // Always orbit around CURRENT camera position
    // Use optional chaining and nullish coalescing for maximum safety
    const cam = game.sceneManager?.currentScene?.camera;
    if (!cam) return;

    const centerX = cam.x;
    const centerY = cam.y;

    // X moves Left/Right
    entity.x = centerX + Math.sin(angle) * radiusX;

    // Parallax moves In Front / Behind (pseudo-Z)
    // 1.1 is the "ear level" where Z=0 in SoundManager
    entity.parallax = 1.1 + Math.cos(angle) * radiusP;

    // Visual Depth Simulation:
    // 1. Layering
    entity.layer = entity.parallax > 1.1 ? 1 : 0;

    // 2. Scaling (simulate proximity)
    // As requested: the larger the parallax, the closer it is.
    // High parallax = Foreground = Large Scale.
    // Parallax range is 0.5 to 1.7 (1.1 +/- 0.6)
    // We'll map this to scale ~0.6 to 1.8
    entity.modelScale = 0.6 + (entity.parallax - 0.5) * 1.0;

    // 3. Blur (Atmospheric Depth)
    // Reach Blur=1 at parallax 0.5, fade to 0 by parallax 1.2
    if (entity.parallax < 1.2) {
      // Map [0.5, 1.2] to [1.0, 0.0]
      const blurFactor = (1.2 - entity.parallax) / (1.2 - 0.5);
      entity.blur = Math.max(0, Math.min(1, blurFactor));
    } else {
      entity.blur = 0;
    }

    // Y stays at camera level
    entity.y = centerY;

    // Notify editor if open
    if (game.editor?.enabled) {
      game.editor.selectionManager.notifyObjectChanged(entity);
    }
  }, 16);

  // Register cleanup
  // ScriptAPI.dispose() will clear intervals when #HALT or script stop is called
  api.log('Script active. Use #HALT to stop.');
});
