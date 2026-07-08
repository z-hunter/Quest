export interface LayoutBox {
  id: string;
  colIndex: number;
  w: number;
  h: number;
}

export interface SpritesheetLayout {
  colX: Record<string, number>;
  totalWidth: number;
  totalHeight: number;
}

export function calculateSpritesheetLayout(
  boxes: LayoutBox[],
  frameCount: number
): SpritesheetLayout {
  // Copy and sort by column index
  const sorted = [...boxes].sort((a, b) => a.colIndex - b.colIndex);

  const colX: Record<string, number> = {};
  let currentX = 0;
  sorted.forEach((b) => {
    colX[b.id] = currentX;
    currentX += b.w;
  });

  const totalWidth = currentX;
  const totalHeight = sorted.length > 0 ? Math.max(...sorted.map((b) => frameCount * b.h)) : 0;

  return {
    colX,
    totalWidth,
    totalHeight,
  };
}
