import { Game } from '../core/Game';

/**
 * Hook to access the Game instance.
 * Currently a direct wrapper around the singleton, acting as a facade.
 * In the future, this can be upgraded to use Context or a State Manager (Zustand/Jotai)
 * to provide reactivity without changing the consuming components.
 */
export const useGame = (): Game => {
  if (!Game.instance) {
    throw new Error('Game instance not initialized!');
  }
  return Game.instance;
};

/**
 * Helper hook to access the Editor module specifically.
 */
export const useEditor = () => {
  const game = useGame();
  return game.editor;
};
