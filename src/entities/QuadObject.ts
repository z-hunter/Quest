import { Entity } from './Entity';
import { SceneObject } from './SceneObject';
import type { IGame } from '../core/IGame';
import { ComponentSystem } from '../systems/ComponentSystem';
import { Geometry } from '../utils/Geometry';

export interface QuadVertexBinding {
  targetName: string;
  type: 'vertex' | 'grid';
  index?: number; // 0-3 for vertex
  gridU?: number; // 0-1 for grid
  gridV?: number; // 0-1 for grid
}

export interface QuadVertex {
  x: number;
  y: number;
  p: number; // Parallax Factor (1.0 = standard, <1 = far, >1 = near)
  binding?: QuadVertexBinding;
}

export type QuadSortMode = 'ignore' | 'v0' | 'v1' | 'v2' | 'v3';

export interface QuadPoint {
  x: number;
  y: number;
}

/** Maps the unit square (u, v) to a Quad's screen-space vertices. */
export interface QuadHomography {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g: number;
  h: number;
}

const HOMOGRAPHY_EPSILON = 1e-9;

function crossProduct(origin: QuadPoint, first: QuadPoint, second: QuadPoint): number {
  return (
    (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x)
  );
}

/**
 * A projective mapping of a unit square is only well-behaved when its target
 * stays a strictly convex, non-degenerate Quad. Concave and crossed Quads are
 * still renderable through bilinear interpolation, but their homography has a
 * projective horizon inside the unit square.
 */
function isStrictlyConvexQuad(p0: QuadPoint, p1: QuadPoint, p2: QuadPoint, p3: QuadPoint): boolean {
  const points = [p0, p1, p2, p3];
  let winding = 0;
  for (let index = 0; index < points.length; index++) {
    const cross = crossProduct(
      points[index],
      points[(index + 1) % points.length],
      points[(index + 2) % points.length]
    );
    if (!Number.isFinite(cross) || Math.abs(cross) < HOMOGRAPHY_EPSILON) return false;
    const direction = Math.sign(cross);
    if (winding !== 0 && direction !== winding) return false;
    winding = direction;
  }
  return true;
}

/**
 * Builds a projective transform from (0,0)-(1,1) to a convex Quad.
 *
 * The four corners uniquely determine a homography, so its projective terms
 * must not be scaled: doing so would detach the grid from one corner.
 */
export function createQuadHomography(
  p0: QuadPoint,
  p1: QuadPoint,
  p2: QuadPoint,
  p3: QuadPoint
): QuadHomography | null {
  if (!isStrictlyConvexQuad(p0, p1, p2, p3)) return null;

  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;

  let g = 0;
  let h = 0;
  if (Math.abs(dx3) > HOMOGRAPHY_EPSILON || Math.abs(dy3) > HOMOGRAPHY_EPSILON) {
    const denominator = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(denominator) < HOMOGRAPHY_EPSILON) return null;

    g = (dx3 * dy2 - dx2 * dy3) / denominator;
    h = (dx1 * dy3 - dx3 * dy1) / denominator;
  }

  const transform = {
    a: p1.x - p0.x + g * p1.x,
    b: p3.x - p0.x + h * p3.x,
    c: p0.x,
    d: p1.y - p0.y + g * p1.y,
    e: p3.y - p0.y + h * p3.y,
    f: p0.y,
    g,
    h,
  };

  // `w` is linear over the unit square. Since w(0, 0) is one, all four
  // corners must stay positive; otherwise the projective horizon crosses the
  // Quad even when it does not land exactly on a corner.
  if (
    [0, 1].some((u) =>
      [0, 1].some((v) => {
        const w = g * u + h * v + 1;
        return !Number.isFinite(w) || w < HOMOGRAPHY_EPSILON;
      })
    )
  ) {
    return null;
  }

  return transform;
}

export function projectQuadPoint(
  transform: QuadHomography,
  u: number,
  v: number
): QuadPoint | null {
  const w = transform.g * u + transform.h * v + 1;
  if (Math.abs(w) < HOMOGRAPHY_EPSILON) return null;
  return {
    x: (transform.a * u + transform.b * v + transform.c) / w,
    y: (transform.d * u + transform.e * v + transform.f) / w,
  };
}

/** Affine fallback used only for malformed/degenerate Quads. */
export function interpolateQuadPoint(
  p0: QuadPoint,
  p1: QuadPoint,
  p2: QuadPoint,
  p3: QuadPoint,
  u: number,
  v: number
): QuadPoint {
  return {
    x: (1 - u) * (1 - v) * p0.x + u * (1 - v) * p1.x + (1 - u) * v * p3.x + u * v * p2.x,
    y: (1 - u) * (1 - v) * p0.y + u * (1 - v) * p1.y + (1 - u) * v * p3.y + u * v * p2.y,
  };
}

function intersectQuadLines(
  a0: QuadPoint,
  a1: QuadPoint,
  b0: QuadPoint,
  b1: QuadPoint
): QuadPoint | null {
  const ax = a1.x - a0.x;
  const ay = a1.y - a0.y;
  const bx = b1.x - b0.x;
  const by = b1.y - b0.y;
  const denominator = ax * by - ay * bx;
  if (Math.abs(denominator) < HOMOGRAPHY_EPSILON) return null;
  const t = ((b0.x - a0.x) * by - (b0.y - a0.y) * bx) / denominator;
  return { x: a0.x + t * ax, y: a0.y + t * ay };
}

function blendQuadPoints(flat: QuadPoint, projected: QuadPoint, amount: number): QuadPoint {
  return {
    x: flat.x + (projected.x - flat.x) * amount,
    y: flat.y + (projected.y - flat.y) * amount,
  };
}

/**
 * Produces a Retro Grid node. Perspective intensity is applied on the four
 * boundary edges, then the two resulting grid lines are intersected. This
 * keeps every grid line straight, every cell connected, and all four Quad
 * corners fixed for all intensity values.
 */
export function projectQuadGridPoint(
  p0: QuadPoint,
  p1: QuadPoint,
  p2: QuadPoint,
  p3: QuadPoint,
  transform: QuadHomography | null,
  u: number,
  v: number,
  amount: number = 1,
  perspectiveX: boolean = true,
  perspectiveY: boolean = true
): QuadPoint {
  if (!transform) return interpolateQuadPoint(p0, p1, p2, p3, u, v);
  const alphaX = perspectiveX ? amount : 0;
  const alphaY = perspectiveY ? amount : 0;
  if (alphaX === 0 && alphaY === 0) return interpolateQuadPoint(p0, p1, p2, p3, u, v);

  const projectedTop = projectQuadPoint(transform, u, 0);
  const projectedBottom = projectQuadPoint(transform, u, 1);
  const projectedLeft = projectQuadPoint(transform, 0, v);
  const projectedRight = projectQuadPoint(transform, 1, v);
  if (!projectedTop || !projectedBottom || !projectedLeft || !projectedRight) {
    return interpolateQuadPoint(p0, p1, p2, p3, u, v);
  }

  const top = blendQuadPoints(interpolateQuadPoint(p0, p1, p2, p3, u, 0), projectedTop, alphaX);
  const bottom = blendQuadPoints(
    interpolateQuadPoint(p0, p1, p2, p3, u, 1),
    projectedBottom,
    alphaX
  );
  const left = blendQuadPoints(interpolateQuadPoint(p0, p1, p2, p3, 0, v), projectedLeft, alphaY);
  const right = blendQuadPoints(interpolateQuadPoint(p0, p1, p2, p3, 1, v), projectedRight, alphaY);
  const intersection = intersectQuadLines(top, bottom, left, right);
  return intersection && Number.isFinite(intersection.x) && Number.isFinite(intersection.y)
    ? intersection
    : interpolateQuadPoint(p0, p1, p2, p3, u, v);
}

export type QuadTextureMode = 'stretch' | 'tile';

export interface QuadTextureMeshCell {
  points: [QuadPoint, QuadPoint, QuadPoint, QuadPoint];
  center: QuadPoint;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  diagonal: 'forward' | 'backward';
}

const MAX_TEXTURE_REPEATS = 32;
const MAX_TEXTURE_TRIANGLES = 32;
const DEFAULT_TEXTURE_MESH_ERROR = 0.75;

function clampTextureTileScale(scale: number): number {
  return Math.max(1 / MAX_TEXTURE_REPEATS, Math.min(10, Number.isFinite(scale) ? scale : 1));
}

function buildTextureAxisBreaks(repeats: number, subdivisions: number): number[] {
  const values = new Set<number>([0, 1]);
  for (let i = 1; i < subdivisions; i++) values.add(i / subdivisions);
  for (let i = 1; i < Math.ceil(repeats); i++) values.add(i / repeats);
  return [...values].sort((a, b) => a - b);
}

export function isQuadNearlyAffine(
  p0: QuadPoint,
  p1: QuadPoint,
  p2: QuadPoint,
  p3: QuadPoint,
  maxCornerError: number
): boolean {
  const affineP2 = {
    x: p1.x + p3.x - p0.x,
    y: p1.y + p3.y - p0.y,
  };
  return Math.hypot(p2.x - affineP2.x, p2.y - affineP2.y) <= maxCornerError;
}

type QuadTexturePointMapper = (u: number, v: number) => QuadPoint;

function triangleApproximationError(
  mapPoint: QuadTexturePointMapper,
  uv0: QuadPoint,
  uv1: QuadPoint,
  uv2: QuadPoint
): number {
  const p0 = mapPoint(uv0.x, uv0.y);
  const p1 = mapPoint(uv1.x, uv1.y);
  const p2 = mapPoint(uv2.x, uv2.y);
  let maxError = 0;
  const samples: Array<[number, number, number]> = [
    [0.5, 0.5, 0],
    [0.5, 0, 0.5],
    [0, 0.5, 0.5],
    [1 / 3, 1 / 3, 1 / 3],
  ];

  for (const [w0, w1, w2] of samples) {
    const u = uv0.x * w0 + uv1.x * w1 + uv2.x * w2;
    const v = uv0.y * w0 + uv1.y * w1 + uv2.y * w2;
    const projected = mapPoint(u, v);
    const affine = {
      x: p0.x * w0 + p1.x * w1 + p2.x * w2,
      y: p0.y * w0 + p1.y * w1 + p2.y * w2,
    };
    maxError = Math.max(maxError, Math.hypot(projected.x - affine.x, projected.y - affine.y));
  }

  return maxError;
}

function getCellApproximationError(
  mapPoint: QuadTexturePointMapper,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  diagonal: 'forward' | 'backward'
): number {
  const uv00 = { x: u0, y: v0 };
  const uv10 = { x: u1, y: v0 };
  const uv11 = { x: u1, y: v1 };
  const uv01 = { x: u0, y: v1 };
  return diagonal === 'forward'
    ? Math.max(
        triangleApproximationError(mapPoint, uv00, uv10, uv11),
        triangleApproximationError(mapPoint, uv00, uv11, uv01)
      )
    : Math.max(
        triangleApproximationError(mapPoint, uv00, uv10, uv01),
        triangleApproximationError(mapPoint, uv10, uv11, uv01)
      );
}

function getMeshApproximationError(
  mapPoint: QuadTexturePointMapper,
  uBreaks: number[],
  vBreaks: number[]
): number {
  let maxError = 0;
  for (let y = 0; y < vBreaks.length - 1; y++) {
    for (let x = 0; x < uBreaks.length - 1; x++) {
      const forward = getCellApproximationError(
        mapPoint,
        uBreaks[x],
        uBreaks[x + 1],
        vBreaks[y],
        vBreaks[y + 1],
        'forward'
      );
      const backward = getCellApproximationError(
        mapPoint,
        uBreaks[x],
        uBreaks[x + 1],
        vBreaks[y],
        vBreaks[y + 1],
        'backward'
      );
      maxError = Math.max(maxError, Math.min(forward, backward));
    }
  }
  return maxError;
}

function chooseTextureMeshSubdivisions(
  mapPoint: QuadTexturePointMapper,
  repeatsX: number,
  repeatsY: number,
  maxError: number
): { x: number; y: number } {
  let subdivisionsX = 1;
  let subdivisionsY = 1;
  const getBreaks = (x: number, y: number) => ({
    u: buildTextureAxisBreaks(repeatsX, x),
    v: buildTextureAxisBreaks(repeatsY, y),
  });
  const triangleCount = (x: number, y: number) => {
    const breaks = getBreaks(x, y);
    return (breaks.u.length - 1) * (breaks.v.length - 1) * 2;
  };
  const breaks = getBreaks(subdivisionsX, subdivisionsY);
  let error = getMeshApproximationError(mapPoint, breaks.u, breaks.v);

  while (error > maxError) {
    const candidates = [
      { x: subdivisionsX + 1, y: subdivisionsY },
      { x: subdivisionsX, y: subdivisionsY + 1 },
    ].filter((candidate) => triangleCount(candidate.x, candidate.y) <= MAX_TEXTURE_TRIANGLES);
    if (candidates.length === 0) break;

    const best = candidates
      .map((candidate) => {
        const candidateBreaks = getBreaks(candidate.x, candidate.y);
        return {
          ...candidate,
          error: getMeshApproximationError(mapPoint, candidateBreaks.u, candidateBreaks.v),
        };
      })
      .sort((a, b) => a.error - b.error)[0];
    if (best.error >= error - HOMOGRAPHY_EPSILON) break;

    subdivisionsX = best.x;
    subdivisionsY = best.y;
    error = best.error;
  }

  return { x: subdivisionsX, y: subdivisionsY };
}

/**
 * Builds a texture mesh whose tile seams are explicit cell boundaries. Each
 * cell can therefore be mapped by Canvas2D as two ordinary affine triangles.
 */
export function buildQuadTextureMesh(
  p0: QuadPoint,
  p1: QuadPoint,
  p2: QuadPoint,
  p3: QuadPoint,
  mode: QuadTextureMode,
  tileScaleX: number,
  tileScaleY: number,
  perspective: boolean,
  maxError: number = DEFAULT_TEXTURE_MESH_ERROR
): QuadTextureMeshCell[] {
  const repeatsX = mode === 'tile' ? 1 / clampTextureTileScale(tileScaleX) : 1;
  const repeatsY = mode === 'tile' ? 1 / clampTextureTileScale(tileScaleY) : 1;
  const homography = perspective ? createQuadHomography(p0, p1, p2, p3) : null;
  const mapPoint: QuadTexturePointMapper = (u: number, v: number) =>
    (homography && projectQuadPoint(homography, u, v)) ||
    interpolateQuadPoint(p0, p1, p2, p3, u, v);
  const subdivisions = chooseTextureMeshSubdivisions(mapPoint, repeatsX, repeatsY, maxError);
  const uBreaks = buildTextureAxisBreaks(repeatsX, subdivisions.x);
  const vBreaks = buildTextureAxisBreaks(repeatsY, subdivisions.y);
  const cells: QuadTextureMeshCell[] = [];

  for (let y = 0; y < vBreaks.length - 1; y++) {
    for (let x = 0; x < uBreaks.length - 1; x++) {
      const rawU0 = uBreaks[x];
      const rawU1 = uBreaks[x + 1];
      const rawV0 = vBreaks[y];
      const rawV1 = vBreaks[y + 1];
      const textureU0 = rawU0 * repeatsX;
      const textureV0 = rawV0 * repeatsY;
      const forwardError = getCellApproximationError(
        mapPoint,
        rawU0,
        rawU1,
        rawV0,
        rawV1,
        'forward'
      );
      const backwardError = getCellApproximationError(
        mapPoint,
        rawU0,
        rawU1,
        rawV0,
        rawV1,
        'backward'
      );
      cells.push({
        points: [
          mapPoint(rawU0, rawV0),
          mapPoint(rawU1, rawV0),
          mapPoint(rawU1, rawV1),
          mapPoint(rawU0, rawV1),
        ],
        center: mapPoint((rawU0 + rawU1) / 2, (rawV0 + rawV1) / 2),
        u0: textureU0 - Math.floor(textureU0),
        u1: rawU1 * repeatsX - Math.floor(textureU0),
        v0: textureV0 - Math.floor(textureV0),
        v1: rawV1 * repeatsY - Math.floor(textureV0),
        diagonal: forwardError <= backwardError ? 'forward' : 'backward',
      });
    }
  }
  return cells;
}

function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  frame: { x: number; y: number; w: number; h: number },
  p0: QuadPoint,
  p1: QuadPoint,
  p2: QuadPoint,
  uv0: QuadPoint,
  uv1: QuadPoint,
  uv2: QuadPoint,
  pixelOverlap: number
): void {
  const minimumEdge = Math.min(
    Math.hypot(p1.x - p0.x, p1.y - p0.y),
    Math.hypot(p2.x - p1.x, p2.y - p1.y),
    Math.hypot(p0.x - p2.x, p0.y - p2.y)
  );
  const overlap = Math.min(pixelOverlap, minimumEdge * 0.08);
  const centroid = {
    x: (p0.x + p1.x + p2.x) / 3,
    y: (p0.y + p1.y + p2.y) / 3,
  };
  const expand = (point: QuadPoint): QuadPoint => {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    const length = Math.hypot(dx, dy);
    return length > HOMOGRAPHY_EPSILON
      ? { x: point.x + (dx / length) * overlap, y: point.y + (dy / length) * overlap }
      : point;
  };
  const q0 = expand(p0);
  const q1 = expand(p1);
  const q2 = expand(p2);
  const sx0 = uv0.x * frame.w;
  const sy0 = uv0.y * frame.h;
  const sx1 = uv1.x * frame.w;
  const sy1 = uv1.y * frame.h;
  const sx2 = uv2.x * frame.w;
  const sy2 = uv2.y * frame.h;
  const determinant = (sx1 - sx0) * (sy2 - sy0) - (sx2 - sx0) * (sy1 - sy0);
  if (Math.abs(determinant) < HOMOGRAPHY_EPSILON) return;

  // The overlap is a coverage-only fix for Canvas2D's antialiased clips. The
  // UV transform must stay anchored to the original vertices: rebuilding it
  // from q0/q1/q2 makes every neighboring triangle sample a different image.
  const a = ((p1.x - p0.x) * (sy2 - sy0) - (p2.x - p0.x) * (sy1 - sy0)) / determinant;
  const b = ((p1.y - p0.y) * (sy2 - sy0) - (p2.y - p0.y) * (sy1 - sy0)) / determinant;
  const c = ((sx1 - sx0) * (p2.x - p0.x) - (sx2 - sx0) * (p1.x - p0.x)) / determinant;
  const d = ((sx1 - sx0) * (p2.y - p0.y) - (sx2 - sx0) * (p1.y - p0.y)) / determinant;
  const e = p0.x - a * sx0 - c * sy0;
  const f = p0.y - b * sx0 - d * sy0;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(q0.x, q0.y);
  ctx.lineTo(q1.x, q1.y);
  ctx.lineTo(q2.x, q2.y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
  ctx.restore();
}

function drawAffineTexture(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  frame: { x: number; y: number; w: number; h: number },
  p0: QuadPoint,
  p1: QuadPoint,
  p3: QuadPoint
): void {
  ctx.save();
  ctx.transform(
    (p1.x - p0.x) / frame.w,
    (p1.y - p0.y) / frame.w,
    (p3.x - p0.x) / frame.h,
    (p3.y - p0.y) / frame.h,
    p0.x,
    p0.y
  );
  ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
  ctx.restore();
}

/** Keeps auxiliary Quad rendering contained even while a vertex is dragged through another edge. */
function clipToQuad(ctx: CanvasRenderingContext2D, vertices: QuadPoint[]): void {
  ctx.beginPath();
  vertices.forEach((vertex, index) => {
    if (index === 0) ctx.moveTo(vertex.x, vertex.y);
    else ctx.lineTo(vertex.x, vertex.y);
  });
  ctx.closePath();
  ctx.clip();
}

export class QuadObject extends Entity {
  vertices: QuadVertex[];
  color: string;

  constructor(game: IGame, name: string) {
    super(game, 0, 0, 100, 100, name);
    this.type = 'Quad';
    this.color = '#888888'; // Default Gray

    // Default 100x100 Square
    this.vertices = [
      { x: 0, y: 0, p: 1.0 },
      { x: 100, y: 0, p: 1.0 },
      { x: 100, y: 100, p: 1.0 },
      { x: 0, y: 100, p: 1.0 },
    ];
    this.sortMode = 'ignore';
  }

  sortMode: QuadSortMode = 'ignore';
  opacity: number = 1.0;
  blendMode: GlobalCompositeOperation = 'source-over';

  // Retro Grid Props
  isGrid: boolean = false;
  gridLinesX: number = 5;
  gridLinesY: number = 5;
  lineWidth: number = 1.0;
  gridColor: string = '#ffffff';
  gridPerspective: boolean = true;
  gridPerspectiveAmount: number = 1.0;

  // Texture Props
  textureMode: QuadTextureMode = 'stretch';
  tileScaleX: number = 1.0;
  tileScaleY: number = 1.0;
  texturePerspective: boolean = true;

  // Fill Props
  filled: boolean = true;
  checkerboard: boolean = false;
  secondColor: string = '#000000';

  // Effects
  blur: number = 0;

  /**
   * List of properties to be serialized to/from JSON.
   * Note: We don't extend Entity.SERIALIZABLE_PROPS because Quad uses vertices instead of width/height.
   */
  static override SERIALIZABLE_PROPS: string[] = [
    ...SceneObject.SERIALIZABLE_PROPS,
    'x',
    'y',
    'parallax',
    'ignoreScaling',
    'vertices',
    'spriteName',
    'textureMode',
    'tileScaleX',
    'tileScaleY',
    'texturePerspective',
    'color',
    'sortMode',
    'opacity',
    'blendMode',
    'isGrid',
    'gridLinesX',
    'gridLinesY',
    'lineWidth',
    'gridColor',
    'gridPerspective',
    'gridPerspectiveAmount',
    'filled',
    'checkerboard',
    'secondColor',
    'blur',
    'brightness',
    'saturation',
    'contrast',
    'hueShift',
  ];

  override setSprite(filename: string, keepSize: boolean = true): void {
    if (!filename?.trim()) {
      this.spriteName = null;
      this.image = null;
      this.animator = null;
      return;
    }
    super.setSprite(filename, keepSize);
  }

  private renderTexture(ctx: CanvasRenderingContext2D, screenVerts: QuadPoint[]): boolean {
    const frame = this.animator?.getCurrentFrame();
    if (
      !this.spriteName ||
      !this.image ||
      this.image.complete === false ||
      !frame ||
      frame.w <= 0 ||
      frame.h <= 0
    ) {
      return false;
    }

    const [v0, v1, v2, v3] = screenVerts;
    const matrix = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
    const screenScale = matrix
      ? Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d), HOMOGRAPHY_EPSILON)
      : 1;
    const isStretch = this.textureMode !== 'tile';
    const flatTexture = isStretch && isQuadNearlyAffine(v0, v1, v2, v3, 0.75 / screenScale);
    const pixelOverlap = 1.25 / screenScale;
    ctx.globalCompositeOperation = this.blendMode;
    ctx.save();
    clipToQuad(ctx, screenVerts);
    if (flatTexture) {
      drawAffineTexture(ctx, this.image, frame, v0, v1, v3);
      ctx.restore();
      return true;
    }

    const mesh = buildQuadTextureMesh(
      v0,
      v1,
      v2,
      v3,
      this.textureMode === 'tile' ? 'tile' : 'stretch',
      this.tileScaleX,
      this.tileScaleY,
      this.texturePerspective !== false,
      0.75 / screenScale
    );
    for (const cell of mesh) {
      const [p00, p10, p11, p01] = cell.points;
      if (cell.diagonal === 'forward') {
        drawTexturedTriangle(
          ctx,
          this.image,
          frame,
          p00,
          p10,
          p11,
          { x: cell.u0, y: cell.v0 },
          { x: cell.u1, y: cell.v0 },
          { x: cell.u1, y: cell.v1 },
          pixelOverlap
        );
        drawTexturedTriangle(
          ctx,
          this.image,
          frame,
          p00,
          p11,
          p01,
          { x: cell.u0, y: cell.v0 },
          { x: cell.u1, y: cell.v1 },
          { x: cell.u0, y: cell.v1 },
          pixelOverlap
        );
      } else {
        drawTexturedTriangle(
          ctx,
          this.image,
          frame,
          p00,
          p10,
          p01,
          { x: cell.u0, y: cell.v0 },
          { x: cell.u1, y: cell.v0 },
          { x: cell.u0, y: cell.v1 },
          pixelOverlap
        );
        drawTexturedTriangle(
          ctx,
          this.image,
          frame,
          p10,
          p11,
          p01,
          { x: cell.u1, y: cell.v0 },
          { x: cell.u1, y: cell.v1 },
          { x: cell.u0, y: cell.v1 },
          pixelOverlap
        );
      }
    }
    ctx.restore();
    return mesh.length > 0;
  }

  // Override render to handle per-vertex parallax
  render(ctx: CanvasRenderingContext2D): void {
    // Need access to Camera Position
    // @ts-ignore
    const scene = this.scene;
    if (!scene) return;

    const camX = scene.camera.x;
    const camY = scene.camera.y;

    ctx.save();
    ctx.globalAlpha = this.opacity;

    let filterStr = '';
    if (this.blur > 0) filterStr += `blur(${this.blur}px) `;
    if (this.brightness !== 1.0) filterStr += `brightness(${this.brightness}) `;
    if (this.saturation !== 1.0) filterStr += `saturate(${this.saturation}) `;
    if (this.contrast !== 1.0) filterStr += `contrast(${this.contrast}) `;
    if (this.hueShift !== 0) filterStr += `hue-rotate(${this.hueShift}deg) `;
    if (filterStr) ctx.filter = filterStr.trim();

    // Calculate Screen Positions of Vertices
    // Apply parallax offset relative to P=1.0 base
    // Offset = -Cam * (effP - 1.0)
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    const globalP = this.parallax !== undefined ? this.parallax : 1.0;
    const screenVerts = this.vertices.map((v) => {
      const effP = (v.p !== undefined ? v.p : 1.0) * globalP;
      const offX = -camX * (effP - globalP);
      const offY = -camY * (effP - globalP);
      const vx = v.x + offX;
      const vy = v.y + offY;

      if (vx < minX) minX = vx;
      if (vx > maxX) maxX = vx;
      if (vy < minY) minY = vy;
      if (vy > maxY) maxY = vy;

      return { x: vx, y: vy };
    });

    // VIEWPORT CULLING
    // Visual World Space Viewport Calculation
    // Context is transformed such that (CamX, CamY) is at Center
    // Viewport is [CamX - HW, CamX + HW]
    if (ctx.canvas) {
      const zoom = scene.camera.zoom;
      const vHW = ctx.canvas.width / 2 / zoom;
      const vHH = ctx.canvas.height / 2 / zoom;

      const viewL = camX - vHW;
      const viewR = camX + vHW;
      const viewT = camY - vHH;
      const viewB = camY + vHH;

      // Padding for Line Width and Blur
      const pad = (this.lineWidth || 1) + (this.blur || 0) * 3;

      if (maxX + pad < viewL || minX - pad > viewR || maxY + pad < viewT || minY - pad > viewB) {
        ctx.restore();
        return; // Culled
      }
    }

    // 1. Draw Texture or Fill (Solid / Checkerboard Mode)
    const textured = this.renderTexture(ctx, screenVerts);
    if (this.filled && !textured) {
      ctx.globalCompositeOperation = this.blendMode;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      screenVerts.forEach((v, i) => {
        if (i === 0) ctx.moveTo(v.x, v.y);
        else ctx.lineTo(v.x, v.y);
      });
      ctx.closePath();
      ctx.fill();

      // Checkerboard mode is an option of Retro Grid (requires isGrid and checkerboard to be active)
      if (this.isGrid && this.checkerboard) {
        const v0 = screenVerts[0]; // TL
        const v1 = screenVerts[1]; // TR
        const v2 = screenVerts[2]; // BR
        const v3 = screenVerts[3]; // BL

        const basePerspective = this.gridPerspective ?? true;
        const amount = this.gridPerspectiveAmount ?? 1.0;
        const usePerspective = basePerspective;
        const gridTransform = createQuadHomography(v0, v1, v2, v3);
        const gridPoint = (u: number, v: number) =>
          projectQuadGridPoint(
            v0,
            v1,
            v2,
            v3,
            gridTransform,
            u,
            v,
            amount,
            usePerspective,
            usePerspective
          );

        const cols = (this.gridLinesX ?? 5) + 1;
        const rows = (this.gridLinesY ?? 5) + 1;

        ctx.fillStyle = this.secondColor || '#000000';
        ctx.save();
        clipToQuad(ctx, screenVerts);

        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            if ((col + row) % 2 === 1) {
              const rawU0 = col / cols;
              const rawU1 = (col + 1) / cols;
              const rawV0 = row / rows;
              const rawV1 = (row + 1) / rows;

              const p00 = gridPoint(rawU0, rawV0);
              const p10 = gridPoint(rawU1, rawV0);
              const p11 = gridPoint(rawU1, rawV1);
              const p01 = gridPoint(rawU0, rawV1);

              ctx.beginPath();
              ctx.moveTo(p00.x, p00.y);
              ctx.lineTo(p10.x, p10.y);
              ctx.lineTo(p11.x, p11.y);
              ctx.lineTo(p01.x, p01.y);
              ctx.closePath();
              ctx.fill();
            }
          }
        }
        ctx.restore();
      }
    }

    // 2. Draw Grid (Overlay)
    if (this.isGrid) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = this.gridColor;
      ctx.lineWidth = this.lineWidth;

      // Draw Outline
      ctx.beginPath();
      screenVerts.forEach((v, i) => {
        if (i === 0) ctx.moveTo(v.x, v.y);
        else ctx.lineTo(v.x, v.y);
      });
      ctx.closePath();
      ctx.stroke();

      // The projective fallback is deliberately clipped by the actual Quad
      // boundary. This is also the containment strategy used by textured
      // Quads, and guarantees malformed editor geometry cannot emit rays.
      ctx.save();
      clipToQuad(ctx, screenVerts);

      // Draw Internal Lines
      const v0 = screenVerts[0]; // TL
      const v1 = screenVerts[1]; // TR
      const v2 = screenVerts[2]; // BR
      const v3 = screenVerts[3]; // BL

      const basePerspective = this.gridPerspective ?? true;
      const amount = this.gridPerspectiveAmount ?? 1.0;
      const usePerspective = basePerspective;
      const gridTransform = createQuadHomography(v0, v1, v2, v3);
      const gridPoint = (u: number, v: number) =>
        projectQuadGridPoint(
          v0,
          v1,
          v2,
          v3,
          gridTransform,
          u,
          v,
          amount,
          usePerspective,
          usePerspective
        );

      ctx.beginPath();

      // Horizontal Cuts (Down the shape using Y count)
      for (let i = 1; i <= this.gridLinesY; i++) {
        const rawT = i / (this.gridLinesY + 1);
        const left = gridPoint(0, rawT);
        const right = gridPoint(1, rawT);
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
      }

      // Vertical Cuts (Across the shape using X count)
      for (let i = 1; i <= this.gridLinesX; i++) {
        const rawT = i / (this.gridLinesX + 1);
        const top = gridPoint(rawT, 0);
        const bottom = gridPoint(rawT, 1);
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(bottom.x, bottom.y);
      }

      ctx.stroke();
      ctx.restore();
    }

    ctx.restore(); // Restore context state

    // Draw Collider if active AND Editor is enabled
    // @ts-ignore
    if (this.game && this.game.editor && this.game.editor.enabled && this.selected) {
      // Selection outline? Handled by Editor usually?
      // Editor draws handles. We don't need to draw extra stuff here.
    }
  }

  hitTest(x: number, y: number): boolean {
    // @ts-ignore
    const scene = this.scene;
    if (!scene) return false;

    const camX = scene.camera.x;
    const camY = scene.camera.y;

    const globalP = this.parallax !== undefined ? this.parallax : 1.0;
    const projectedPoly = this.vertices.map((v) => {
      const effP = (v.p !== undefined ? v.p : 1.0) * globalP;
      return {
        x: v.x - camX * (effP - globalP),
        y: v.y - camY * (effP - globalP),
      };
    });

    return Geometry.isPointInPolygon({ x, y }, projectedPoly);
  }

  /**
   * Get the interpolated Parallax (P) value at a specific point (x,y).
   * @param x Point X
   * @param y Point Y
   * @param isVisual If true, treats (x,y) as visual coordinates and projects Quad vertices to visual space before interpolation.
   */
  getParallaxAt(x: number, y: number, isVisual: boolean = false): number {
    // @ts-ignore
    const scene = this.scene;
    if (!scene || this.vertices.length < 3) return 1.0;

    const camX = scene.camera.x;
    const camY = scene.camera.y;
    const globalP = this.parallax !== undefined ? this.parallax : 1.0;

    // Helper to prepare vertex
    const prep = (v: QuadVertex) => {
      const effP = (v.p !== undefined ? v.p : 1.0) * globalP;
      if (!isVisual) return { x: v.x, y: v.y, p: effP };
      // Project to Visual
      return {
        x: v.x - camX * (effP - globalP),
        y: v.y - camY * (effP - globalP),
        p: effP,
      };
    };

    const v0 = prep(this.vertices[0]); // TL
    const v1 = prep(this.vertices[1]); // TR
    const v2 = prep(this.vertices[2]); // BR
    const v3 = prep(this.vertices[3]); // BL (if exists)

    // Helper: Barycentric weights for Triangle (a, b, c) vs Point p
    const barycentric = (a: any, b: any, c: any, px: number, py: number) => {
      const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
      const subW1 = (b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y);
      const subW2 = (c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y);

      const w1 = subW1 / det;
      const w2 = subW2 / det;
      const w3 = 1 - w1 - w2;
      return { w1, w2, w3 };
    };

    // Check Triangle 1: 0-1-3 (TL-TR-BL)
    if (v3) {
      const { w1, w2, w3 } = barycentric(v0, v1, v3, x, y);
      if (w1 >= 0 && w2 >= 0 && w3 >= 0) {
        return v0.p * w1 + v1.p * w2 + v3.p * w3;
      }
    }

    // Check Triangle 2: 1-2-3 (TR-BR-BL)
    if (v3) {
      const { w1, w2, w3 } = barycentric(v1, v2, v3, x, y);
      if (w1 >= 0 && w2 >= 0 && w3 >= 0) {
        return v1.p * w1 + v2.p * w2 + v3.p * w3;
      }
    } else {
      // Just one triangle 0-1-2?
      const { w1, w2, w3 } = barycentric(v0, v1, v2, x, y);
      if (w1 >= 0 && w2 >= 0 && w3 >= 0) {
        return v0.p * w1 + v1.p * w2 + v2.p * w3;
      }
    }

    // Fallback: If outside, return simple average or closest edge?
    let sumP = 0;
    this.vertices.forEach((v) => {
      const effP = (v.p !== undefined ? v.p : 1.0) * globalP;
      sumP += effP;
    });
    return sumP / this.vertices.length;
  }

  // Serialization
  toJSON(): any {
    const data = super.toJSON();
    data.type = 'Quad';
    return data;
  }

  override load(data: any): void {
    // Backwards compatibility for ignoreYSorting
    if (data.sortMode === undefined && data.ignoreYSorting !== undefined) {
      data.sortMode = data.ignoreYSorting ? 'ignore' : 'v3';
    }

    // Migrate old gridLines
    if (data.gridLines !== undefined) {
      if (data.gridLinesX === undefined) data.gridLinesX = data.gridLines;
      if (data.gridLinesY === undefined) data.gridLinesY = data.gridLines;
    }

    super.load(data);
  }

  static fromJSON(game: IGame, data: any): QuadObject {
    const obj = new QuadObject(game, data.name);
    obj.load(data);
    return obj;
  }

  update(dt: number): void {
    super.update(dt);

    // Resolve Bindings
    // Only if Editor is actively moving things?
    // Or always? Always ensures game logic works if moving platforms exist.
    this.resolveBindings();

    if (!this.components) return;

    // Update Components (via System)
    ComponentSystem.update(this, dt);
  }

  private resolveBindings() {
    // @ts-ignore
    const scene = this.scene;
    if (!scene) return;

    let hasChanges = false;

    this.vertices.forEach((v) => {
      const binding = v.binding;
      if (binding) {
        // Find Target
        // @ts-ignore
        const target = scene.findEntity
          ? scene.findEntity(binding.targetName)
          : scene.entities.find((e: any) => e.name === binding.targetName);
        if (target && target.type === 'Quad') {
          const q = target as QuadObject;
          if (binding.type === 'vertex') {
            const idx = binding.index || 0;
            if (q.vertices[idx]) {
              const tv = q.vertices[idx];
              if (v.x !== tv.x || v.y !== tv.y || v.p !== tv.p) {
                v.x = tv.x;
                v.y = tv.y;
                v.p = tv.p;
                hasChanges = true;
              }
            }
          } else if (binding.type === 'grid') {
            const u = binding.gridU || 0;
            const v_param = binding.gridV || 0;

            const tv0 = q.vertices[0];
            const tv1 = q.vertices[1];
            const tv2 = q.vertices[2];
            const tv3 = q.vertices[3];

            const basePerspective = q.gridPerspective ?? true;
            const transform = createQuadHomography(tv0, tv1, tv2, tv3);
            const point = projectQuadGridPoint(
              tv0,
              tv1,
              tv2,
              tv3,
              transform,
              u,
              v_param,
              q.gridPerspectiveAmount ?? 1,
              basePerspective,
              basePerspective
            );
            const nx = point.x;
            const ny = point.y;

            // Parallax Interpolation
            const np =
              (1 - u) * (1 - v_param) * tv0.p +
              u * (1 - v_param) * tv1.p +
              (1 - u) * v_param * tv3.p +
              u * v_param * tv2.p;

            if (
              Math.abs(v.x - nx) > 0.01 ||
              Math.abs(v.y - ny) > 0.01 ||
              Math.abs(v.p - np) > 0.001
            ) {
              v.x = nx;
              v.y = ny;
              v.p = np;
              hasChanges = true;
            }
          }
        }
      }
    });

    // Trigger Editor Refresh if in Editor and values changed
    if (hasChanges) {
      this.notifyChange();
    }
  }

  /**
   * Updates a specific vertex of the Quad.
   * @param index Vertex index (0-3)
   * @param x New X position (optional)
   * @param y New Y position (optional)
   * @param p New Parallax factor (optional)
   */
  public setVertex(index: number, x?: number, y?: number, p?: number): boolean {
    const v = this.vertices[index];
    if (!v) {
      console.warn(`[QuadObject] Vertex ${index} not found on '${this.name}'.`);
      return false;
    }

    // If Vertex is Bound, propagate changes to the entire group
    if (v.binding) {
      // Calculate delta
      const dx = x !== undefined ? x - v.x : 0;
      const dy = y !== undefined ? y - v.y : 0;
      const dp = p !== undefined ? p - v.p : 0;

      // @ts-ignore
      const scene = this.scene;
      if (scene) {
        const group = QuadObject.getConnectedVertices(scene, this, index);

        let anyChanged = false;
        group.forEach((ref) => {
          if (dx !== 0) {
            ref.v.x += dx;
            anyChanged = true;
          }
          if (dy !== 0) {
            ref.v.y += dy;
            anyChanged = true;
          }
          if (dp !== 0) {
            // Parallax logic: Adjust pos to avoid jump?
            // If script is setting P, it likely wants to change P.
            // Auto-correcting Pos might be unexpected for a raw setter.
            // But for consistency with UI, maybe?
            // "setVertex" implies setting raw values.
            // Let's just set P for now.
            ref.v.p += dp;
            anyChanged = true;
          }
        });

        if (anyChanged) {
          this.notifyChange();
          // Also notify others? They will update on their own draw/update cycle or via editor?
          // getConnectedVertices returns Refs. We modified them in place.
          // If they are on other objects, those objects might need notification if in Editor.
          if (group.length > 1) {
            // @ts-ignore
            if (this.game.editor && this.game.editor.enabled) {
              // Force refresh of scene or selection?
              // Individual object notification is hard here without iterating.
              group.forEach((g) => {
                if (g.quad !== this) {
                  // @ts-ignore
                  this.game.editor.selectionManager.notifyObjectChanged(g.quad);
                }
              });
            }
          }
        }
        return true;
      }
    }

    let changed = false;
    if (x !== undefined && v.x !== x) {
      v.x = x;
      changed = true;
    }
    if (y !== undefined && v.y !== y) {
      v.y = y;
      changed = true;
    }
    if (p !== undefined && v.p !== p) {
      v.p = p;
      changed = true;
    }

    if (changed) {
      this.notifyChange();
    }

    return true;
  }

  private notifyChange() {
    // @ts-ignore
    if (this.game.editor && this.game.editor.enabled) {
      // @ts-ignore
      this.game.editor.selectionManager.notifyObjectChanged(this);
    }
  }

  /**
   * Finds all vertices connected to a specific vertex via bindings (Mutual/Graph Traversal).
   * Used for moving groups of bound vertices together.
   */
  static getConnectedVertices(
    scene: any,
    startQuad: QuadObject,
    startIndex: number
  ): { quad: QuadObject; index: number; v: QuadVertex }[] {
    const group: { quad: QuadObject; index: number; v: QuadVertex }[] = [];
    const visited = new Set<string>();
    const queue: { quad: QuadObject; index: number; v: QuadVertex }[] = [];

    if (!startQuad || !startQuad.vertices[startIndex]) return [];

    const startRef = { quad: startQuad, index: startIndex, v: startQuad.vertices[startIndex] };
    queue.push(startRef);
    visited.add(`${startRef.quad.name}_${startRef.index}`);
    group.push(startRef);

    while (queue.length > 0) {
      const current = queue.shift()!;

      // 1. Check OUTGOING binding (Who I am bound to)
      if (current.v.binding && current.v.binding.type === 'vertex') {
        const targetName = current.v.binding.targetName;
        const targetIdx = current.v.binding.index || 0;

        if (!visited.has(`${targetName}_${targetIdx}`)) {
          const tEnt = scene.entities.find((e: any) => e.name === targetName);
          if (tEnt && (tEnt as any).type === 'Quad') {
            const tQuad = tEnt as QuadObject;
            if (tQuad.vertices[targetIdx]) {
              const nextRef = { quad: tQuad, index: targetIdx, v: tQuad.vertices[targetIdx] };
              visited.add(`${targetName}_${targetIdx}`);
              group.push(nextRef);
              queue.push(nextRef);
            }
          }
        }
      }

      // 2. Check INCOMING bindings (Who is bound to me)
      scene.entities.forEach((e: any) => {
        if ((e as any).type === 'Quad') {
          const q = e as QuadObject;
          q.vertices.forEach((qv, qIdx) => {
            if (qv.binding && qv.binding.type === 'vertex') {
              if (
                qv.binding.targetName === current.quad.name &&
                qv.binding.index === current.index
              ) {
                if (!visited.has(`${q.name}_${qIdx}`)) {
                  const nextRef = { quad: q, index: qIdx, v: qv };
                  visited.add(`${q.name}_${qIdx}`);
                  group.push(nextRef);
                  queue.push(nextRef);
                }
              }
            }
          });
        }
      });
    }

    return group;
  }
}
