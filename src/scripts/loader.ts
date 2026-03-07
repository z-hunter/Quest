/**
 * Auto-loads all scripts in the current directory and subdirectories.
 * Uses Vite's import.meta.glob feature.
 */
export function loadAllScripts() {
  // Import all .ts files in subdirectories, eagerly (included in bundle)
  const modules = import.meta.glob('./**/*.ts', { eager: true });

  for (const path in modules) {
    // Skip this loader file and main.ts if they are in the glob result (they shouldn't be if in subdirs, but safety first)
    if (path.includes('loader.ts') || path.includes('main.ts')) continue;

    // Auto-register if the module exports an 'id' and a default function
    // OR if it calls ScriptRegistry.register itself (controlled by the script).

    // If the script purely relies on side-effects (calling register itself), simply importing it is enough.
    // We log it for debugging.
  }
}

// Hot Module Replacement
if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    // In a real HMR scenario, we might need to clear old scripts or re-run registration.
    // Since our ScriptRegistry.register warns on overwrite but allows it,
    // essentially re-importing updated modules will update the registry.
    // However, `import.meta.glob` with `{ eager: true }` usually invalidates the parent module (this file)
    // when a child changes, triggering this accept block.
    if (newModule && newModule.loadAllScripts) {
      newModule.loadAllScripts();
    }
  });
}
