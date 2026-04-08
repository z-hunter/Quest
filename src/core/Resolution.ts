export const GAME_DESIGN_WIDTH = 420;
export const GAME_DESIGN_HEIGHT = 300;

export type GameDesignResolution = {
  width: number;
  height: number;
};

export function getGameDesignResolution(): GameDesignResolution {
  return { width: GAME_DESIGN_WIDTH, height: GAME_DESIGN_HEIGHT };
}
