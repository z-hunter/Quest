import { ScriptRegistry } from '../core/ScriptRegistry';

// We can improve types later to avoid 'any'
export function registerDemoScripts() {
  ScriptRegistry.register('interaction.pillar.key', ({ game, entity }) => {
    game.showMessage(game.text('scripts.pillar_key_inserted'));
    game.showMessage(game.text('scripts.pillar_compartment_opened'));

    // Update entity state
    entity.description = game.text('scripts.pillar_open_description');

    // Example of a permanent state change (we'll adding a real state system later)
    // game.state.set('pillar_opened', true);
  });

  ScriptRegistry.register('interaction.pillar.look', ({ game, entity }) => {
    game.showMessage(entity.description);
  });

  ScriptRegistry.register('test.audio', ({ game }) => {
    game.showMessage(game.text('scripts.test_audio_playing'));
    game.playSound('drawer_open.wav'); // Ensure it exists in public/sounds
  });
}
