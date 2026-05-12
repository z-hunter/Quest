import { ScriptRegistry } from '../../core/ScriptRegistry';

ScriptRegistry.register('test_3d_sound', async ({ game, api }) => {
  api.log('Starting 3D Sound Test...');

  const scene = game.sceneManager?.currentScene;
  if (!scene) {
    api.log('Error: No active scene.');
    return;
  }

  const entityId = 'sound_test';
  const soundId = 'acquarium_in_deep_space.mp3';

  // 1. Ensure test entity exists
  let entity = scene.findEntity(entityId);
  if (!entity) {
    api.log(`Creating test entity: ${entityId}`);
    const { Entity } = await import('../../entities/Entity');
    entity = new Entity(game, 400, 300, 64, 64, entityId);
    scene.addEntity(entity);
  }

  // 3. Load Main Sound
  api.log('Loading sound...');
  await api.loadSound(entityId, `/sounds/${soundId}`);

  // 4. Play and Attach (should automatically use scene reverb)
  api.log('Starting playback (reverb inherited from scene)...');
  const handle = api.playSoundAttached(entityId, entityId, {
    loop: true,
    volume: 0.8,
    useProximityEQ: true,
  });

  game.showMessage(
    `Started 3D Sound Test! Handle: ${handle}. Move around the '${entityId}' object.`
  );
});
