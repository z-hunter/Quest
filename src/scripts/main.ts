import { ScriptRegistry } from '../core/ScriptRegistry';

/**
 * This is the main entry point for User Scripts.
 * Add your scripts here or import them from other files and register them.
 * 
 * Usage:
 * ScriptRegistry.register('my.script.id', ({ game, entity, args }) => { ... });
 */
export function registerUserScripts() {
    console.log('[ScriptRegistry] Registering User Scripts...');

    // --- Example Script ---
    // ScriptRegistry.register('example.script', ({ game, entity }) => {
    //     game.showMessage("Hello from User Scripts!");
    // });

}
