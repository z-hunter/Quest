import { ScriptRegistry } from '../core/ScriptRegistry';

// We can improve types later to avoid 'any'
export function registerDemoScripts() {
  ScriptRegistry.register('interaction.pillar.key', ({ game, entity }) => {
    game.showMessage('You insert the key into a hidden slot in the pillar.');
    game.showMessage('Click! A secret compartment opens!');

    // Update entity state
    entity.description = 'The pillar is open, revealing a secret compartment.';

    // Example of a permanent state change (we'll adding a real state system later)
    // game.state.set('pillar_opened', true);
  });

  ScriptRegistry.register('interaction.pillar.look', ({ game, entity }) => {
    game.showMessage(entity.description);
  });

  ScriptRegistry.register('test.audio', ({ game }) => {
    game.showMessage('Playing test sound...');
    game.playSound('drawer_open.wav'); // Ensure it exists in public/sounds
  });
}
