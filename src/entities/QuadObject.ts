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

export type QuadSortMode = 'ignore' | 'parallax' | 'v0' | 'v1' | 'v2' | 'v3';

export interface QuadPoint {
  x: number;
  y: number;
}

export interface QuadSurfaceMetrics {
  inside: boolean;
  u: number;
  v: number;
  parallax: number;
  axisU: QuadPoint;
  axisV: QuadPoint;
  /** Tangents of the same surface with Perspective correction disabled. */
  referenceAxisU: QuadPoint;
  referenceAxisV: QuadPoint;
}

function flipTexturePoint(point: QuadPoint, flipX: boolean, flipY: boolean): QuadPoint {
  return {
    x: flipX ? 1 - point.x : point.x,
    y: flipY ? 1 - point.y : point.y,
  };
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
const MIN_PROJECTIVE_COMPACTNESS = 0.01;
const FULL_PROJECTIVE_COMPACTNESS = 0.04;

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

/** Maps a screen-space point back into the unit square of a Quad homography. */
export function unprojectQuadPoint(transform: QuadHomography, point: QuadPoint): QuadPoint | null {
  const { a, b, c, d, e, f, g, h } = transform;
  const denominator = (d * h - e * g) * point.x + (b * g - a * h) * point.y + a * e - b * d;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < HOMOGRAPHY_EPSILON) return null;
  return {
    x: ((e - f * h) * point.x + (c * h - b) * point.y + b * f - c * e) / denominator,
    y: ((f * g - d) * point.x + (a - c * g) * point.y + c * d - a * f) / denominator,
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
 * A projective transform becomes numerically explosive as a Quad turns into
 * a screen-space sliver. Fade it to the existing bilinear mapping before the
 * visual surface collapses, so grids, textures and surface tracking stay put.
 */
function getQuadCompactness(p0: QuadPoint, p1: QuadPoint, p2: QuadPoint, p3: QuadPoint): number {
  const points = [p0, p1, p2, p3];
  const area =
    Math.abs(
      points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length];
        return sum + point.x * next.y - point.y * next.x;
      }, 0)
    ) / 2;
  const longestEdgeSquared = points.reduce((longest, point, index) => {
    const next = points[(index + 1) % points.length];
    return Math.max(longest, (next.x - point.x) ** 2 + (next.y - point.y) ** 2);
  }, 0);
  return longestEdgeSquared > HOMOGRAPHY_EPSILON ? area / longestEdgeSquared : 0;
}

/**
 * Fade perspective relative to the authored surface as camera parallax
 * compresses it. This keeps the existing lateral-shift correction active
 * throughout compression, while preserving full perspective at the authored
 * shape (including an intentionally thin Quad).
 */
function getProjectiveStability(
  p0: QuadPoint,
  p1: QuadPoint,
  p2: QuadPoint,
  p3: QuadPoint,
  authoredCompactness?: number
): number {
  const compactness = getQuadCompactness(p0, p1, p2, p3);
  const useRelativeThresholds =
    Number.isFinite(authoredCompactness) && authoredCompactness! > HOMOGRAPHY_EPSILON;
  const t = useRelativeThresholds
    ? Math.max(0, Math.min(1, compactness / authoredCompactness!))
    : Math.max(
        0,
        Math.min(
          1,
          (compactness - MIN_PROJECTIVE_COMPACTNESS) /
            (FULL_PROJECTIVE_COMPACTNESS - MIN_PROJECTIVE_COMPACTNESS)
        )
      );
  return t * t * (3 - 2 * t);
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
  perspectiveY: boolean = true,
  authoredCompactness?: number
): QuadPoint {
  if (!transform) return interpolateQuadPoint(p0, p1, p2, p3, u, v);
  const stability = getProjectiveStability(p0, p1, p2, p3, authoredCompactness);
  const alphaX = perspectiveX ? amount * stability : 0;
  const alphaY = perspectiveY ? amount * stability : 0;
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

function getQuadSurfaceCoordinates(
  p0: QuadPoint,
  p1: QuadPoint,
  p2: QuadPoint,
  p3: QuadPoint,
  point: QuadPoint,
  amount: number,
  usePerspective: boolean,
  authoredCompactness?: number
): { u: number; v: number } | null {
  const transform = createQuadHomography(p0, p1, p2, p3);
  const map = (u: number, v: number) =>
    projectQuadGridPoint(
      p0,
      p1,
      p2,
      p3,
      transform,
      u,
      v,
      amount,
      usePerspective,
      usePerspective,
      authoredCompactness
    );

  let best = { u: 0.5, v: 0.5, distance: Number.POSITIVE_INFINITY };
  for (let row = 0; row <= 8; row++) {
    for (let column = 0; column <= 8; column++) {
      const u = column / 8;
      const v = row / 8;
      const mapped = map(u, v);
      const distance = (mapped.x - point.x) ** 2 + (mapped.y - point.y) ** 2;
      if (distance < best.distance) best = { u, v, distance };
    }
  }

  let { u, v } = best;
  const epsilon = 0.0001;
  for (let iteration = 0; iteration < 24; iteration++) {
    const mapped = map(u, v);
    const errorX = point.x - mapped.x;
    const errorY = point.y - mapped.y;
    if (Math.hypot(errorX, errorY) < 0.0001) break;

    // Use central differences at the boundaries as well. The old forward
    // derivative became zero at u/v=1, so Newton could clamp a point onto the
    // lower edge and report P=1 even while the point was still inside the Quad.
    const u0 = Math.max(0, u - epsilon);
    const u1 = Math.min(1, u + epsilon);
    const v0 = Math.max(0, v - epsilon);
    const v1 = Math.min(1, v + epsilon);
    const prevU = map(u0, v);
    const nextU = map(u1, v);
    const prevV = map(u, v0);
    const nextV = map(u, v1);
    const du = Math.max(epsilon, u1 - u0);
    const dv = Math.max(epsilon, v1 - v0);
    const j00 = (nextU.x - prevU.x) / du;
    const j10 = (nextU.y - prevU.y) / du;
    const j01 = (nextV.x - prevV.x) / dv;
    const j11 = (nextV.y - prevV.y) / dv;
    const determinant = j00 * j11 - j01 * j10;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < HOMOGRAPHY_EPSILON) break;

    const deltaU = (errorX * j11 - errorY * j01) / determinant;
    const deltaV = (j00 * errorY - j10 * errorX) / determinant;
    let accepted = false;
    for (let damping = 1; damping >= 1 / 64; damping /= 2) {
      const candidateU = Math.max(0, Math.min(1, u + deltaU * damping));
      const candidateV = Math.max(0, Math.min(1, v + deltaV * damping));
      const candidate = map(candidateU, candidateV);
      const candidateDistance = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2;
      if (candidateDistance < best.distance) {
        u = candidateU;
        v = candidateV;
        best = { u, v, distance: candidateDistance };
        accepted = true;
        break;
      }
    }
    if (!accepted) break;
  }

  const resolved = map(best.u, best.v);
  return Number.isFinite(resolved.x) && Number.isFinite(resolved.y)
    ? { u: best.u, v: best.v }
    : null;
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
const MAX_STRONG_PERSPECTIVE_TEXTURE_TRIANGLES = 64;
const DEFAULT_TEXTURE_MESH_ERROR = 0.75;
let textureLayerCanvas: HTMLCanvasElement | null = null;

function getTextureLayerContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  if (!textureLayerCanvas) textureLayerCanvas = document.createElement('canvas');
  if (textureLayerCanvas.width !== canvas.width) textureLayerCanvas.width = canvas.width;
  if (textureLayerCanvas.height !== canvas.height) textureLayerCanvas.height = canvas.height;
  return textureLayerCanvas.getContext('2d');
}

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
  let triangleLimit = MAX_TEXTURE_TRIANGLES;

  while (error > maxError) {
    const candidates = [
      { x: subdivisionsX + 1, y: subdivisionsY },
      { x: subdivisionsX, y: subdivisionsY + 1 },
    ].filter((candidate) => triangleCount(candidate.x, candidate.y) <= triangleLimit);
    if (candidates.length === 0) {
      if (triangleLimit === MAX_TEXTURE_TRIANGLES) {
        triangleLimit = MAX_STRONG_PERSPECTIVE_TEXTURE_TRIANGLES;
        continue;
      }
      break;
    }

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
  perspectiveAmount: number = 1,
  maxError: number = DEFAULT_TEXTURE_MESH_ERROR,
  authoredCompactness?: number
): QuadTextureMeshCell[] {
  const repeatsX = mode === 'tile' ? 1 / clampTextureTileScale(tileScaleX) : 1;
  const repeatsY = mode === 'tile' ? 1 / clampTextureTileScale(tileScaleY) : 1;
  const homography = perspectiveAmount !== 0 ? createQuadHomography(p0, p1, p2, p3) : null;
  const mapPoint: QuadTexturePointMapper = (u: number, v: number) =>
    projectQuadGridPoint(
      p0,
      p1,
      p2,
      p3,
      homography,
      u,
      v,
      perspectiveAmount,
      perspectiveAmount !== 0,
      perspectiveAmount !== 0,
      authoredCompactness
    );
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
  p2: QuadPoint,
  p3: QuadPoint,
  flipX = false,
  flipY = false
): void {
  const origin = flipX ? (flipY ? p2 : p1) : flipY ? p3 : p0;
  const xTarget = flipY ? (flipX ? p3 : p2) : flipX ? p0 : p1;
  const yTarget = flipY ? (flipX ? p1 : p0) : flipX ? p2 : p3;
  ctx.save();
  ctx.transform(
    (xTarget.x - origin.x) / frame.w,
    (xTarget.y - origin.y) / frame.w,
    (yTarget.x - origin.x) / frame.h,
    (yTarget.y - origin.y) / frame.h,
    origin.x,
    origin.y
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
  // `ignoreScaling` existed on inherited Entity data before Quads could be
  // depth-scaled.  Keep an explicit format marker so legacy `false` values do
  // not suddenly opt old scenes into runtime geometry scaling.
  depthScalingVersion: number = 1;

  constructor(game: IGame, name: string) {
    super(game, 0, 0, 100, 100, name);
    this.type = 'Quad';
    this.color = '#888888'; // Default Gray
    this.ignoreScaling = true;

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

  // Surface perspective. It parameterizes the whole Quad consistently: grid,
  // checkerboard, texture, and one-time snapping coordinates.
  perspective: boolean = true;
  perspectiveAmount: number = 1.0;

  // Retro Grid Props
  isGrid: boolean = false;
  gridLinesX: number = 5;
  gridLinesY: number = 5;
  lineWidth: number = 1.0;
  gridColor: string = '#ffffff';

  // Texture Props
  textureMode: QuadTextureMode = 'stretch';
  tileScaleX: number = 1.0;
  tileScaleY: number = 1.0;

  // Fill Props
  filled: boolean = true;
  checkerboard: boolean = false;
  secondColor: string = '#000000';

  // Effects
  blur: number = 0;
  receive3DParallax: boolean = false;

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
    'depthScalingVersion',
    'vertices',
    'spriteName',
    'flipX',
    'flipY',
    'textureMode',
    'tileScaleX',
    'tileScaleY',
    'perspective',
    'perspectiveAmount',
    'color',
    'sortMode',
    'opacity',
    'blendMode',
    'isGrid',
    'gridLinesX',
    'gridLinesY',
    'lineWidth',
    'gridColor',
    'filled',
    'checkerboard',
    'secondColor',
    'blur',
    'brightness',
    'saturation',
    'contrast',
    'hueShift',
    'receive3DParallax',
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
    const needsTextureLayer = this.opacity < 1 || this.blur > 0;
    const textureCtx = needsTextureLayer ? getTextureLayerContext(ctx.canvas) : ctx;
    if (!textureCtx) return false;

    if (needsTextureLayer) {
      const { a, b, c, d, e, f } = matrix || ctx.getTransform();
      textureCtx.setTransform(1, 0, 0, 1, 0, 0);
      textureCtx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      textureCtx.setTransform(a, b, c, d, e ?? 0, f ?? 0);
      textureCtx.globalAlpha = 1;
      textureCtx.globalCompositeOperation = 'source-over';
      textureCtx.filter = 'none';
    } else {
      textureCtx.globalCompositeOperation = this.blendMode;
    }
    textureCtx.save();
    clipToQuad(textureCtx, screenVerts);
    if (flatTexture) {
      drawAffineTexture(textureCtx, this.image, frame, v0, v1, v2, v3, this.flipX, this.flipY);
      textureCtx.restore();
      if (needsTextureLayer) this.drawTextureLayer(ctx, screenVerts);
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
      this.perspective === false ? 0 : this.perspectiveAmount,
      0.75 / screenScale,
      this.getAuthoredProjectiveCompactness()
    );
    for (const cell of mesh) {
      const [p00, p10, p11, p01] = cell.points;
      const uv00 = flipTexturePoint({ x: cell.u0, y: cell.v0 }, this.flipX, this.flipY);
      const uv10 = flipTexturePoint({ x: cell.u1, y: cell.v0 }, this.flipX, this.flipY);
      const uv11 = flipTexturePoint({ x: cell.u1, y: cell.v1 }, this.flipX, this.flipY);
      const uv01 = flipTexturePoint({ x: cell.u0, y: cell.v1 }, this.flipX, this.flipY);
      if (cell.diagonal === 'forward') {
        drawTexturedTriangle(
          textureCtx,
          this.image,
          frame,
          p00,
          p10,
          p11,
          uv00,
          uv10,
          uv11,
          pixelOverlap
        );
        drawTexturedTriangle(
          textureCtx,
          this.image,
          frame,
          p00,
          p11,
          p01,
          uv00,
          uv11,
          uv01,
          pixelOverlap
        );
      } else {
        drawTexturedTriangle(
          textureCtx,
          this.image,
          frame,
          p00,
          p10,
          p01,
          uv00,
          uv10,
          uv01,
          pixelOverlap
        );
        drawTexturedTriangle(
          textureCtx,
          this.image,
          frame,
          p10,
          p11,
          p01,
          uv10,
          uv11,
          uv01,
          pixelOverlap
        );
      }
    }
    textureCtx.restore();
    if (needsTextureLayer) this.drawTextureLayer(ctx, screenVerts);
    return mesh.length > 0;
  }

  private drawTextureLayer(ctx: CanvasRenderingContext2D, screenVerts: QuadPoint[]): void {
    if (!textureLayerCanvas) return;
    ctx.save();
    ctx.globalCompositeOperation = this.blendMode;
    clipToQuad(ctx, screenVerts);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(textureLayerCanvas, 0, 0);
    ctx.restore();
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

    const screenVerts = this.getVisualVertices();
    screenVerts.forEach(({ x: vx, y: vy }) => {
      if (vx < minX) minX = vx;
      if (vx > maxX) maxX = vx;
      if (vy < minY) minY = vy;
      if (vy > maxY) maxY = vy;
    });

    // VIEWPORT CULLING
    // Visual World Space Viewport Calculation
    // Context is transformed such that (CamX, CamY) is at Center
    // Viewport is [CamX - HW, CamX + HW]
    if (ctx.canvas) {
      const zoom = scene.camera.zoom;
      const vHW = ctx.canvas.width / 2 / zoom;
      const vHH = ctx.canvas.height / 2 / zoom;

      // `screenVerts` are in Quad.render's inner coordinate space. The
      // common SceneRenderer transform subsequently translates that space by
      // `-camera * globalP`, so its visible viewport is centered on
      // `camera * globalP` rather than the raw camera position. Comparing
      // against raw camera coordinates incorrectly culls every Quad whose
      // global P differs from 1 as it moves away from screen centre.
      const globalP = this.parallax !== undefined ? this.parallax : 1;
      const viewL = camX * globalP - vHW;
      const viewR = camX * globalP + vHW;
      const viewT = camY * globalP - vHH;
      const viewB = camY * globalP + vHH;

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

        const basePerspective = this.perspective !== false;
        const amount = this.perspectiveAmount ?? 1.0;
        const usePerspective = basePerspective;
        const authoredCompactness = this.getAuthoredProjectiveCompactness();
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
            usePerspective,
            authoredCompactness
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

      const basePerspective = this.perspective !== false;
      const amount = this.perspectiveAmount ?? 1.0;
      const usePerspective = basePerspective;
      const authoredCompactness = this.getAuthoredProjectiveCompactness();
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
          usePerspective,
          authoredCompactness
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

    return Geometry.isPointInPolygon({ x, y }, this.getVisualVertices());
  }

  /**
   * Resolves a Retro Grid node in the same coordinate space used by rendering.
   * When `isVisual` is true, per-vertex parallax is applied before the grid's
   * optional projective correction.
   */
  getGridPointAt(
    u: number,
    v: number,
    isVisual: boolean = false,
    useEffectiveVertices: boolean = true
  ): QuadPoint {
    // @ts-ignore
    const scene = this.scene;
    const globalP = this.parallax !== undefined ? this.parallax : 1.0;
    const camX = scene?.camera.x ?? 0;
    const camY = scene?.camera.y ?? 0;
    const vertices = useEffectiveVertices ? this.getEffectiveVertices() : this.vertices;
    const points = vertices.map((vertex) => {
      if (!isVisual) return { x: vertex.x, y: vertex.y };
      const effP = (vertex.p !== undefined ? vertex.p : 1.0) * globalP;
      return {
        x: vertex.x - camX * (effP - globalP),
        y: vertex.y - camY * (effP - globalP),
      };
    });

    const [p0, p1, p2, p3] = points;
    const perspective = this.perspective !== false;
    return projectQuadGridPoint(
      p0,
      p1,
      p2,
      p3,
      createQuadHomography(p0, p1, p2, p3),
      u,
      v,
      this.perspectiveAmount ?? 1,
      perspective,
      perspective,
      this.getAuthoredProjectiveCompactness(useEffectiveVertices)
    );
  }

  /**
   * Get the interpolated Parallax (P) value at a specific point (x,y).
   * @param x Point X
   * @param y Point Y
   * @param isVisual If true, treats (x,y) as visual coordinates and projects Quad vertices to visual space before interpolation.
   */
  getParallaxAt(
    x: number,
    y: number,
    isVisual: boolean = false,
    useEffectiveVertices: boolean = true
  ): number {
    const metrics = this.getSurfaceMetricsAt(x, y, isVisual, useEffectiveVertices);
    if (metrics) return metrics.parallax;

    const globalP = this.parallax !== undefined ? this.parallax : 1.0;
    let sumP = 0;
    this.vertices.forEach((v) => {
      const effP = (v.p !== undefined ? v.p : 1.0) * globalP;
      sumP += effP;
    });
    return sumP / this.vertices.length;
  }

  /**
   * Resolves a known Retro Grid coordinate without projecting it to a point
   * and then trying to invert that point. Grid bindings already carry the
   * exact `(u, v)`, including edge nodes where floating-point containment can
   * be ambiguous after camera projection.
   */
  getParallaxAtGrid(u: number, v: number, useEffectiveVertices: boolean = true): number {
    const vertices = useEffectiveVertices ? this.getEffectiveVertices() : this.vertices;
    if (vertices.length < 4) return this.parallax !== undefined ? this.parallax : 1.0;

    const safeU = Number.isFinite(u) ? Math.max(0, Math.min(1, u)) : 0;
    const safeV = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
    const globalP = this.parallax !== undefined ? this.parallax : 1.0;
    const p0 = (vertices[0].p ?? 1) * globalP;
    const p1 = (vertices[1].p ?? 1) * globalP;
    const p2 = (vertices[2].p ?? 1) * globalP;
    const p3 = (vertices[3].p ?? 1) * globalP;
    return (
      (1 - safeU) * (1 - safeV) * p0 +
      safeU * (1 - safeV) * p1 +
      safeU * safeV * p2 +
      (1 - safeU) * safeV * p3
    );
  }

  // Serialization
  toJSON(): any {
    const data = super.toJSON();
    data.type = 'Quad';
    return data;
  }

  override load(data: any): void {
    // Before unified surface depth, Quads ignored Entity.ignoreScaling
    // entirely.  Old saved scenes commonly contain `ignoreScaling: false`,
    // which therefore was not an author opt-in.  Preserve their rendered
    // geometry; newly saved Quads include the marker and may opt in normally.
    if (data.depthScalingVersion !== 1) {
      data.ignoreScaling = true;
      data.depthScalingVersion = 1;
    }

    // Backwards compatibility for ignoreYSorting
    if (data.sortMode === undefined && data.ignoreYSorting !== undefined) {
      data.sortMode = data.ignoreYSorting ? 'ignore' : 'v3';
    }

    // Migrate old gridLines
    if (data.gridLines !== undefined) {
      if (data.gridLinesX === undefined) data.gridLinesX = data.gridLines;
      if (data.gridLinesY === undefined) data.gridLinesY = data.gridLines;
    }

    // The former Retro Grid and texture switches described two render paths
    // independently. A Quad now owns one surface projection. Prefer the
    // explicit grid setting when migrating because it also governed snapping
    // and bound vertices; texturePerspective is the fallback for textured
    // legacy data that did not configure a grid.
    if (data.perspective === undefined) {
      data.perspective = data.gridPerspective ?? data.texturePerspective ?? true;
    }
    if (data.perspectiveAmount === undefined) {
      data.perspectiveAmount = data.gridPerspectiveAmount ?? 1;
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

  getEffectiveVertices(): QuadVertex[] {
    const baseScale = (this.modelScale || 1) * (this.subsceneItemScale || 1);
    const depthScale = baseScale !== 0 ? this.scale / baseScale : 1;
    if (!Number.isFinite(depthScale) || Math.abs(depthScale - 1) < 0.000001) {
      return this.vertices.map((vertex) => ({ ...vertex }));
    }

    const centroid = this.vertices.reduce(
      (sum, vertex) => ({ x: sum.x + vertex.x, y: sum.y + vertex.y }),
      { x: 0, y: 0 }
    );
    centroid.x /= this.vertices.length;
    centroid.y /= this.vertices.length;
    return this.vertices.map((vertex) => ({
      ...vertex,
      x: centroid.x + (vertex.x - centroid.x) * depthScale,
      y: centroid.y + (vertex.y - centroid.y) * depthScale,
    }));
  }

  private getAuthoredProjectiveCompactness(useEffectiveVertices: boolean = true): number {
    const vertices = useEffectiveVertices ? this.getEffectiveVertices() : this.vertices;
    if (vertices.length < 4) return 0;
    return getQuadCompactness(vertices[0], vertices[1], vertices[2], vertices[3]);
  }

  /**
   * Changes global P while preserving every rendered vertex at the current
   * camera position.  Quad rendering first offsets each local vertex and is
   * then wrapped in the renderer's global-P camera transform.  Together those
   * two transforms produce `vertex - camera * (localP * globalP)`, so the
   * authored vertex must be compensated by the full local P (not localP - 1).
   */
  setParallaxPreservingVisualPosition(nextParallax: number): void {
    if (!Number.isFinite(nextParallax)) return;
    const previousParallax = this.parallax !== undefined ? this.parallax : 1;
    if (Math.abs(nextParallax - previousParallax) < 0.000001) return;

    const camera = this.scene?.camera;
    if (camera) {
      const parallaxDelta = nextParallax - previousParallax;
      this.vertices = this.vertices.map((vertex) => {
        const localParallax = vertex.p !== undefined ? vertex.p : 1;
        return {
          ...vertex,
          x: vertex.x + camera.x * parallaxDelta * localParallax,
          y: vertex.y + camera.y * parallaxDelta * localParallax,
        };
      });
    }

    this.parallax = nextParallax;
  }

  getVisualVertices(useEffectiveVertices: boolean = true): QuadPoint[] {
    // @ts-ignore
    const scene = this.scene;
    const camX = scene?.camera.x ?? 0;
    const camY = scene?.camera.y ?? 0;
    const globalP = this.parallax !== undefined ? this.parallax : 1.0;
    const vertices = useEffectiveVertices ? this.getEffectiveVertices() : this.vertices;
    return vertices.map((vertex) => {
      const effectiveP = (vertex.p !== undefined ? vertex.p : 1.0) * globalP;
      return {
        x: vertex.x - camX * (effectiveP - globalP),
        y: vertex.y - camY * (effectiveP - globalP),
      };
    });
  }

  isVisualSurfaceUnstable(useEffectiveVertices: boolean = true): boolean {
    const points = this.getVisualVertices(useEffectiveVertices);
    return (
      points.length < 4 ||
      getProjectiveStability(
        points[0],
        points[1],
        points[2],
        points[3],
        this.getAuthoredProjectiveCompactness(useEffectiveVertices)
      ) <= HOMOGRAPHY_EPSILON
    );
  }

  getSurfaceMetricsAt(
    x: number,
    y: number,
    isVisual: boolean = false,
    useEffectiveVertices: boolean = true
  ): QuadSurfaceMetrics | null {
    const points = isVisual
      ? this.getVisualVertices(useEffectiveVertices)
      : (useEffectiveVertices ? this.getEffectiveVertices() : this.vertices).map((vertex) => ({
          x: vertex.x,
          y: vertex.y,
        }));
    if (points.length < 4 || !Geometry.isPointInPolygon({ x, y }, points)) return null;

    const [p0, p1, p2, p3] = points;
    const usePerspective = this.perspective !== false;
    const amount = this.perspectiveAmount ?? 1;
    const authoredCompactness = this.getAuthoredProjectiveCompactness(useEffectiveVertices);
    const coordinates = getQuadSurfaceCoordinates(
      p0,
      p1,
      p2,
      p3,
      { x, y },
      amount,
      usePerspective,
      authoredCompactness
    );
    if (!coordinates) return null;

    const { u, v } = coordinates;
    const vertices = useEffectiveVertices ? this.getEffectiveVertices() : this.vertices;
    const globalP = this.parallax !== undefined ? this.parallax : 1.0;
    const p0Value = (vertices[0].p ?? 1) * globalP;
    const p1Value = (vertices[1].p ?? 1) * globalP;
    const p2Value = (vertices[2].p ?? 1) * globalP;
    const p3Value = (vertices[3].p ?? 1) * globalP;
    const parallax =
      (1 - u) * (1 - v) * p0Value + u * (1 - v) * p1Value + u * v * p2Value + (1 - u) * v * p3Value;

    const map = (sampleU: number, sampleV: number) =>
      projectQuadGridPoint(
        p0,
        p1,
        p2,
        p3,
        createQuadHomography(p0, p1, p2, p3),
        sampleU,
        sampleV,
        amount,
        usePerspective,
        usePerspective,
        authoredCompactness
      );
    const step = 0.0001;
    const uStep = u <= 1 - step ? step : -step;
    const vStep = v <= 1 - step ? step : -step;
    const uPoint = map(u + uStep, v);
    const vPoint = map(u, v + vStep);
    const axisU = { x: (uPoint.x - x) / uStep, y: (uPoint.y - y) / uStep };
    const axisV = { x: (vPoint.x - x) / vStep, y: (vPoint.y - y) / vStep };

    // Use the uncorrected bilinear surface as the authored-distance metric.
    // The corrected derivatives describe how that distance is displayed, but
    // must not be used to normalize the step or the perspective effect would
    // cancel out and movement would remain screen-pixel based.
    const referenceAxisU = {
      x: (1 - v) * (p1.x - p0.x) + v * (p2.x - p3.x),
      y: (1 - v) * (p1.y - p0.y) + v * (p2.y - p3.y),
    };
    const referenceAxisV = {
      x: (1 - u) * (p3.x - p0.x) + u * (p2.x - p1.x),
      y: (1 - u) * (p3.y - p0.y) + u * (p2.y - p1.y),
    };

    return { inside: true, u, v, parallax, axisU, axisV, referenceAxisU, referenceAxisV };
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
              const targetGlobalP = q.parallax !== undefined ? q.parallax : 1;
              const sourceGlobalP = this.parallax !== undefined ? this.parallax : 1;
              const effectiveP = (tv.p !== undefined ? tv.p : 1) * targetGlobalP;
              const sourceLocalP = sourceGlobalP !== 0 ? effectiveP / sourceGlobalP : effectiveP;
              // The shared renderer applies the target Quad's global P after
              // `getVisualVertices()`.  A direct binding therefore needs the
              // same authored point as its target; changing only its local P
              // is sufficient to make their final on-screen positions match.
              const nx = tv.x;
              const ny = tv.y;
              if (
                Math.abs(v.x - nx) > 0.01 ||
                Math.abs(v.y - ny) > 0.01 ||
                Math.abs(v.p - sourceLocalP) > 0.001
              ) {
                v.x = nx;
                v.y = ny;
                v.p = sourceLocalP;
                hasChanges = true;
              }
            }
          } else if (binding.type === 'grid') {
            const u = binding.gridU || 0;
            const v_param = binding.gridV || 0;
            const sourceGlobalP = this.parallax !== undefined ? this.parallax : 1.0;
            const targetGlobalP = q.parallax !== undefined ? q.parallax : 1.0;
            const camX = scene.camera.x;
            const camY = scene.camera.y;

            // Bind to the node that is actually rendered. Projecting the raw
            // vertices here makes the vertex jump on the first update because
            // Retro Grid applies perspective after per-vertex parallax.
            const visualPoint = q.getGridPointAt(u, v_param, true, false);
            // The binding stores the exact grid coordinates. Resolve P from
            // those coordinates directly; inverting a camera-projected edge
            // point can classify it just outside the Quad and fall back to an
            // unrelated corner average, changing the source vertex on every
            // camera move.
            const effectiveP = q.getParallaxAtGrid(u, v_param, false);
            const np = sourceGlobalP !== 0 ? effectiveP / sourceGlobalP : effectiveP;

            // `visualPoint` is before the target's outer global-P transform.
            // Convert it to an authored source point so the final renderer
            // transform yields the very same on-screen coordinate.
            const nx = visualPoint.x + camX * (effectiveP - targetGlobalP);
            const ny = visualPoint.y + camY * (effectiveP - targetGlobalP);

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
            // Grid snapping is a one-time placement, not a live constraint.
            // Materialize legacy grid bindings once, then let the vertex move
            // independently from the target Quad.
            delete v.binding;
            hasChanges = true;
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
   * @param preserveVisualPosition Keep the rendered point fixed when P changes
   */
  public setVertex(
    index: number,
    x?: number,
    y?: number,
    p?: number,
    preserveVisualPosition: boolean = false
  ): boolean {
    const v = this.vertices[index];
    if (!v) {
      console.warn(`[QuadObject] Vertex ${index} not found on '${this.name}'.`);
      return false;
    }

    if (x !== undefined && !Number.isFinite(x)) return false;
    if (y !== undefined && !Number.isFinite(y)) return false;
    if (p !== undefined && !Number.isFinite(p)) return false;

    // A binding is resolved from its target on every update. Edit the whole
    // connected group so the target is changed too; otherwise the next update
    // would immediately overwrite an edited bound vertex.
    // @ts-ignore
    const scene = this.scene;
    const group = scene
      ? QuadObject.getConnectedVertices(scene, this, index)
      : [{ quad: this, index, v }];
    const dx = x !== undefined ? x - v.x : 0;
    const dy = y !== undefined ? y - v.y : 0;
    const requestedEffectiveP = p !== undefined ? p * (this.parallax ?? 1) : undefined;
    const camera = scene?.camera;
    let changed = false;

    group.forEach((ref) => {
      const refGlobalP = ref.quad.parallax ?? 1;
      const previousP = ref.v.p ?? 1;
      const previousEffectiveP = previousP * refGlobalP;

      if (dx !== 0) {
        ref.v.x += dx;
        changed = true;
      }
      if (dy !== 0) {
        ref.v.y += dy;
        changed = true;
      }
      if (requestedEffectiveP !== undefined) {
        const nextP = refGlobalP !== 0 ? requestedEffectiveP / refGlobalP : requestedEffectiveP;
        const parallaxDelta = requestedEffectiveP - previousEffectiveP;
        if (Math.abs(nextP - previousP) > 0.000001) {
          if (camera && preserveVisualPosition) {
            ref.v.x += camera.x * parallaxDelta;
            ref.v.y += camera.y * parallaxDelta;
          }
          ref.v.p = nextP;
          changed = true;
        }
      }
    });

    if (!changed) return true;
    group.forEach((ref) => {
      ref.quad.notifyChange();
    });
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
