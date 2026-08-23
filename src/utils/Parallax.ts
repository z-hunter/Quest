import { getGameDesignResolution } from '../core/Resolution';

export interface Camera2D {
  x: number;
  y: number;
}

export interface Point2D {
  x: number;
  y: number;
}

const PARALLAX_DEPTH_EPSILON = 0.000001;

export interface Parallax3DPoint {
  x: number;
  y: number;
  z: number;
}

export function getParallaxFocalLength(): number {
  return getGameDesignResolution().width / 2;
}

/** Reconstructs a virtual-camera point from authored coordinates and effective P. */
export function unprojectParallaxPoint(point: {
  x: number;
  y: number;
  p: number;
}): Parallax3DPoint | null {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(point.p) ||
    point.p <= PARALLAX_DEPTH_EPSILON
  ) {
    return null;
  }
  const focalLength = getParallaxFocalLength();
  return { x: point.x / point.p, y: point.y / point.p, z: focalLength / point.p };
}

/** Projects a virtual-camera point back into authored coordinates and effective P. */
export function projectParallaxPoint(
  point: Parallax3DPoint
): { x: number; y: number; p: number } | null {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(point.z) ||
    point.z <= PARALLAX_DEPTH_EPSILON
  ) {
    return null;
  }
  const p = getParallaxFocalLength() / point.z;
  const x = point.x * p;
  const y = point.y * p;
  return Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(p) &&
    p > PARALLAX_DEPTH_EPSILON
    ? { x, y, p }
    : null;
}

/**
 * Rotates an authored Quad point around a vertical virtual axis. `p` is the
 * effective (local × Quad) parallax, reconstructed as inverse camera depth.
 */
export function rotateParallaxPointY(
  point: { x: number; y: number; p: number },
  axis: { x: number; p: number },
  angleDegrees: number
): { x: number; y: number; p: number } | null {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(point.p) ||
    point.p <= PARALLAX_DEPTH_EPSILON ||
    !Number.isFinite(axis.x) ||
    !Number.isFinite(axis.p) ||
    axis.p <= PARALLAX_DEPTH_EPSILON ||
    !Number.isFinite(angleDegrees)
  ) {
    return null;
  }

  const point3d = unprojectParallaxPoint(point);
  const axis3d = unprojectParallaxPoint({ x: axis.x, y: 0, p: axis.p });
  if (!point3d || !axis3d) return null;
  const radians = (angleDegrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return projectParallaxPoint({
    x: axis3d.x + (point3d.x - axis3d.x) * cosine + (point3d.z - axis3d.z) * sine,
    y: point3d.y,
    z: axis3d.z - (point3d.x - axis3d.x) * sine + (point3d.z - axis3d.z) * cosine,
  });
}

/** Returns the authored Y positions where a vertical 3D axis pierces a Quad. */
export function getParallaxAxisIntersections(
  vertices: Array<{ x: number; y: number; p: number }>,
  axis: { x: number; p: number }
): number[] {
  if (
    vertices.length < 3 ||
    !Number.isFinite(axis.x) ||
    !Number.isFinite(axis.p) ||
    axis.p <= PARALLAX_DEPTH_EPSILON
  ) {
    return [];
  }

  const focalLength = getParallaxFocalLength();
  const axisX = axis.x / axis.p;
  const axisZ = focalLength / axis.p;
  const points = vertices.map((vertex) => {
    if (
      !Number.isFinite(vertex.x) ||
      !Number.isFinite(vertex.y) ||
      !Number.isFinite(vertex.p) ||
      vertex.p <= PARALLAX_DEPTH_EPSILON
    )
      return null;
    return { x: vertex.x / vertex.p, y: vertex.y / vertex.p, z: focalLength / vertex.p };
  });
  if (points.some((point) => !point)) return [];

  const intersections: number[] = [];
  for (let index = 1; index < points.length - 1; index++) {
    const [a, b, c] = [points[0]!, points[index]!, points[index + 1]!];
    const determinant = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
    if (Math.abs(determinant) <= PARALLAX_DEPTH_EPSILON) continue;
    const u = ((axisX - a.x) * (c.z - a.z) - (axisZ - a.z) * (c.x - a.x)) / determinant;
    const v = ((b.x - a.x) * (axisZ - a.z) - (b.z - a.z) * (axisX - a.x)) / determinant;
    const w = 1 - u - v;
    if (u < -PARALLAX_DEPTH_EPSILON || v < -PARALLAX_DEPTH_EPSILON || w < -PARALLAX_DEPTH_EPSILON)
      continue;
    const y = (a.y * w + b.y * u + c.y * v) * axis.p;
    if (
      Number.isFinite(y) &&
      !intersections.some((candidate) => Math.abs(candidate - y) <= PARALLAX_DEPTH_EPSILON)
    ) {
      intersections.push(y);
    }
  }
  return intersections;
}

export function normalizeParallax(p?: number): number {
  return p ?? 1.0;
}

export function toVisualPosition(
  world: Point2D,
  camera: Camera2D,
  parallax?: number,
  offset: Point2D = { x: 0, y: 0 }
): Point2D {
  const p = normalizeParallax(parallax);
  return {
    x: world.x - camera.x * (p - 1.0) + offset.x,
    y: world.y - camera.y * (p - 1.0) + offset.y,
  };
}

export function toWorldPosition(
  visual: Point2D,
  camera: Camera2D,
  parallax?: number,
  offset: Point2D = { x: 0, y: 0 }
): Point2D {
  const p = normalizeParallax(parallax);
  return {
    x: visual.x + camera.x * (p - 1.0) - offset.x,
    y: visual.y + camera.y * (p - 1.0) - offset.y,
  };
}

export function toVisualScalar(worldValue: number, cameraValue: number, parallax?: number): number {
  const p = normalizeParallax(parallax);
  return worldValue - cameraValue * (p - 1.0);
}
