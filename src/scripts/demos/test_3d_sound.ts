import { ScriptRegistry } from '../../core/ScriptRegistry';

ScriptRegistry.register('test_3d_sound', async (context) => {
  const api = context.api;

  // The name of the sound to load
  const soundId = 'acquarium_in_deep_space.mp3';

  // Attempt to load the sound and the Reverb IR from the public/sounds/ directory
  await api.loadSound(soundId, `/sounds/${soundId}`);
  await api.loadReverbIR('/sounds/conv-room_drum.wav');

  // Play the sound attached to "sound_test", looping indefinitely, with Proximity EQ and Reverb
  const handle = api.playSoundAttached(soundId, 'sound_test', {
    loop: true,
    useProximityEQ: true,
    reverbAmount: 0.5,
  });

  context.game.showMessage(
    `Started 3D Sound Test! Handle: ${handle}. Move around the 'sound_test' object.`
  );
});
