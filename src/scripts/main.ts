import { loadAllScripts } from './loader';

/**
 * This is the main entry point for User Scripts.
 * It automatically loads all scripts in subdirectories via Vite's import.meta.glob.
 */
export function registerUserScripts() {
  loadAllScripts();
}
