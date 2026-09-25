export const GAME_DESIGN_WIDTH = 420;
export const GAME_DESIGN_HEIGHT = 300;

let activeResolution = { width: GAME_DESIGN_WIDTH, height: GAME_DESIGN_HEIGHT };

export type GameDesignResolution = {
  width: number;
  height: number;
};

export function getGameDesignResolution(): GameDesignResolution {
  return { ...activeResolution };
}

export function getGameDesignWidth(): number {
  return activeResolution.width;
}

export function getGameDesignHeight(): number {
  return activeResolution.height;
}

export function setGameDesignResolution(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
  activeResolution = { width: Math.round(width), height: Math.round(height) };
}
