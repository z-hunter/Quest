import type { IGame } from '../core/IGame';
import { GAME_DESIGN_WIDTH } from '../core/Resolution';
import type { Entity } from './Entity';
import { QuadObject, type QuadVertex } from './QuadObject';
import { SceneObject } from './SceneObject';
import { Geometry } from '../utils/Geometry';

export type Box3DPoint = { x: number; y: number; z: number };
export type Box3DAxisMode = 'object' | 'camera';
export type Box3DOcclusionOverride = 'inherit' | 'fast';
export type Box3DFace = {
  quad: QuadObject;
  vertices: Box3DPoint[];
  sceneOrder: number;
  boxId: string;
  faceIndex: number;
  entity?: Entity;
  fragmented?: boolean;
};
export type Box3DFragment = Box3DFace & {
  projected: { x: number; y: number }[];
  fragmented: boolean;
  depthFallback?: boolean;
};
export type Box3DSurfaceSide = 'front' | 'back';
export type Box3DSurfaceAnchor = {
  quad: QuadObject;
  boxId: string;
  faceIndex: number;
  point: Box3DPoint;
  projected: QuadVertex;
  parallax: number;
  vertices: Box3DPoint[];
  side: Box3DSurfaceSide;
};

export const BOX3D_FACE_VERTICES = [
  [0, 1, 2, 3],
  [4, 7, 6, 5],
  [0, 4, 5, 1],
  [1, 5, 6, 2],
  [2, 6, 7, 3],
  [3, 7, 4, 0],
] as const;

const BOX3D_FACE_UV_VERTICES = [
  [3, 2, 1, 0],
  [4, 5, 6, 7],
  [0, 1, 5, 4],
  [1, 2, 6, 5],
  [2, 3, 7, 6],
  [3, 0, 4, 7],
] as const;

const EPSILON = 0.00001;
const NEAR_PLANE_RATIO = 0.01;
const SURFACE_OFFSET = 0.01;
const INHERITED_DISABLED = '__box3dInheritedDisabled';
// ponytail: CPU BSP is capped for editor-sized scenes; move this batch to a GPU depth buffer if dense 3D scenes become a real requirement.
const MAX_BSP_FRAGMENTS = 1200;
const MAX_RENDER_FRAGMENT_CACHE_ENTRIES = 4;
let warnedAboutFragmentLimit = false;
const renderFragmentCache = new WeakMap<object, Map<string, Box3DFragment[]>>();

/** A transform-only frustum. Its six real Quad children carry all surface behaviour. */
export class Box3DObject extends SceneObject {
  cutter = false;
  x = 0;
  y = 0;
  z = 0;
  rotationX = 20;
  rotationY = 30;
  rotationZ = 0;
  pivotX: Box3DPoint = { x: 0, y: 0, z: 0 };
  pivotY: Box3DPoint = { x: 0, y: 0, z: 0 };
  pivotZ: Box3DPoint = { x: 0, y: 0, z: 0 };
  axisMode: Box3DAxisMode = 'object';
  axisRotationX = 0;
  axisRotationY = 0;
  axisRotationZ = 0;
  occlusionMode: Box3DOcclusionOverride = 'inherit';
  uniformScale = 1;
  scaleX = 1;
  scaleY = 1;
  scaleZ = 1;
  bottomWidth = 100;
  bottomDepth = 100;
  topWidth = 100;
  topDepth = 100;
  height = 100;
  topOffsetX = 0;
  topOffsetZ = 0;

  static override SERIALIZABLE_PROPS = [
    ...SceneObject.SERIALIZABLE_PROPS,
    'cutter',
    'x',
    'y',
    'z',
    'rotationX',
    'rotationY',
    'rotationZ',
    'pivotX',
    'pivotY',
    'pivotZ',
    'axisMode',
    'axisRotationX',
    'axisRotationY',
    'axisRotationZ',
    'occlusionMode',
    'uniformScale',
    'scaleX',
    'scaleY',
    'scaleZ',
    'bottomWidth',
    'bottomDepth',
    'topWidth',
    'topDepth',
    'height',
    'topOffsetX',
    'topOffsetZ',
  ];

  constructor(game: IGame, name = 'Box3D') {
    super(name, 'Box3D');
    this.game = game;
  }
  game: IGame;
  render(_ctx: CanvasRenderingContext2D): void {}
  update(_deltaTime: number): void {}
  static fromJSON(game: IGame, data: any): Box3DObject {
    const box = new Box3DObject(game, data.name);
    box.load(data);
    return box;
  }

  syncFaces(scene: any): void {
    const vertices = this.getWorldVertices();
    const perspective =
      Number.isFinite(scene.box3dPerspective) && scene.box3dPerspective >= 0
        ? scene.box3dPerspective
        : 1;
    const camera = scene.camera || { x: 0, y: 0 };
    const focal = getBox3DProjectionFocal(camera);
    for (const quad of scene.entities.filter(
      (o: any) =>
        o instanceof QuadObject &&
        o.spatial?.parentNodeId === this.name &&
        Number.isInteger(o.box3dFaceIndex)
    ) as QuadObject[]) {
      const indices = BOX3D_FACE_VERTICES[quad.box3dFaceIndex!];
      const uvIndices = BOX3D_FACE_UV_VERTICES[quad.box3dFaceIndex!];
      if (!indices || !uvIndices) continue;
      const physical = indices.map((i) => vertices[i]);
      const clipped = clipBox3DPolygonToNearPlane(physical, perspective, focal);
      quad.box3dWorldVertices = physical;
      quad.box3dCameraProjected = true;
      // Keep the full shell in the depth batch: opaque front faces hide the
      // rear ones, while openings and texture alpha reveal their back sides.
      quad.box3dHidden = !clipped || this.disabled || !this.visible || quad.disabled;
      quad.parallax = 1;
      quad.perspective = true;
      quad.perspectiveAmount = 1;
      quad.layer = this.layer;
      syncFaceChildrenDisabled(scene, quad, this.disabled || quad.disabled);
      if (!clipped) continue;
      const points = uvIndices.map((i) =>
        projectBox3DPoint(
          clampBox3DPointToNearPlane(vertices[i], perspective, focal),
          camera,
          perspective,
          focal
        )
      );
      quad.vertices = points as QuadVertex[];
      quad.x = points.reduce((n, v) => n + v.x, 0) / points.length;
      quad.y = points.reduce((n, v) => n + v.y, 0) / points.length;
      quad.box3dDepth = physical.reduce((n, v) => n + v.z, 0) / physical.length;
    }
  }

  getWorldVertices(): Box3DPoint[] {
    const s = this.uniformScale;
    const bottomY = this.height / 2,
      topY = -this.height / 2;
    return [
      { x: -this.topWidth / 2 + this.topOffsetX, y: topY, z: -this.topDepth / 2 + this.topOffsetZ },
      { x: this.topWidth / 2 + this.topOffsetX, y: topY, z: -this.topDepth / 2 + this.topOffsetZ },
      { x: this.topWidth / 2 + this.topOffsetX, y: topY, z: this.topDepth / 2 + this.topOffsetZ },
      { x: -this.topWidth / 2 + this.topOffsetX, y: topY, z: this.topDepth / 2 + this.topOffsetZ },
      { x: -this.bottomWidth / 2, y: bottomY, z: -this.bottomDepth / 2 },
      { x: this.bottomWidth / 2, y: bottomY, z: -this.bottomDepth / 2 },
      { x: this.bottomWidth / 2, y: bottomY, z: this.bottomDepth / 2 },
      { x: -this.bottomWidth / 2, y: bottomY, z: this.bottomDepth / 2 },
    ].map((v) => {
      return this.toWorld({
        x: v.x * s * this.scaleX,
        y: v.y * s * this.scaleY,
        z: v.z * s * this.scaleZ,
      });
    });
  }

  getWorldAxisSegments(): Record<'x' | 'y' | 'z', [Box3DPoint, Box3DPoint]> {
    const length =
      Math.max(this.bottomWidth, this.bottomDepth, this.topWidth, this.topDepth, this.height) *
      this.uniformScale;
    const segment = (
      axis: 'x' | 'y' | 'z',
      pivot: Box3DPoint,
      rotationIndex: number
    ): [Box3DPoint, Box3DPoint] => {
      const start = { ...pivot, [axis]: pivot[axis] - length };
      const end = { ...pivot, [axis]: pivot[axis] + length };
      return [this.toWorld(start, rotationIndex), this.toWorld(end, rotationIndex)];
    };
    const axes = {
      x: segment('x', this.pivotX, 2),
      y: segment('y', this.pivotY, 1),
      z: segment('z', this.pivotZ, 0),
    };
    const directions = orientBox3DAxisDirections(
      {
        x: vectorBetween(axes.x[0], axes.x[1]),
        y: vectorBetween(axes.y[0], axes.y[1]),
        z: vectorBetween(axes.z[0], axes.z[1]),
      },
      { x: this.axisRotationX, y: this.axisRotationY, z: this.axisRotationZ }
    );
    return {
      x: segmentAround(midpoint(axes.x), directions.x),
      y: segmentAround(midpoint(axes.y), directions.y),
      z: segmentAround(midpoint(axes.z), directions.z),
    };
  }

  getWorldAxisPivots(): Record<'x' | 'y' | 'z', Box3DPoint> {
    return {
      x: this.toWorld(this.pivotX, 2),
      y: this.toWorld(this.pivotY, 1),
      z: this.toWorld(this.pivotZ, 0),
    };
  }

  /** Bake an exact rigid world-space rotation back into the existing Z/Y/X transform. */
  rotateAroundWorldAxis(pivot: Box3DPoint, direction: Box3DPoint, degrees: number): void {
    if (!Number.isFinite(degrees) || Math.abs(degrees) <= EPSILON) return;
    const axisRotation = axisAngleMatrix(direction, degrees);
    if (!axisRotation) return;

    const localOrigin = this.transform({ x: 0, y: 0, z: 0 });
    const currentRotation: Matrix3 = (
      [
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 },
      ] as Box3DPoint[]
    ).map((basis) => {
      const transformed = this.transform(basis);
      return {
        x: transformed.x - localOrigin.x,
        y: transformed.y - localOrigin.y,
        z: transformed.z - localOrigin.z,
      };
    }) as Matrix3;
    const worldOrigin = {
      x: this.x + localOrigin.x,
      y: this.y + localOrigin.y,
      z: this.z + localOrigin.z,
    };
    const targetOrigin = rotateAroundAxis(worldOrigin, pivot, direction, degrees);
    const [rotationX, rotationY, rotationZ] = decomposeZYX(
      multiplyMatrix(axisRotation, columnsToRows(currentRotation))
    );
    this.rotationX = rotationX;
    this.rotationY = rotationY;
    this.rotationZ = rotationZ;

    const nextLocalOrigin = this.transform({ x: 0, y: 0, z: 0 });
    this.x = targetOrigin.x - nextLocalOrigin.x;
    this.y = targetOrigin.y - nextLocalOrigin.y;
    this.z = targetOrigin.z - nextLocalOrigin.z;
  }

  private toWorld(v: Box3DPoint, rotationIndex = 0): Box3DPoint {
    const transformed = this.transform(v, rotationIndex);
    return { x: this.x + transformed.x, y: this.y + transformed.y, z: this.z + transformed.z };
  }

  private transform(v: Box3DPoint, rotationIndex = 0): Box3DPoint {
    let result = v;
    const rotations = [
      ['z', this.rotationZ, this.pivotZ],
      ['y', this.rotationY, this.pivotY],
      ['x', this.rotationX, this.pivotX],
    ] as const;
    for (let index = rotationIndex; index < rotations.length; index++) {
      const [axis, angle, pivot] = rotations[index];
      result = rotate(result, pivot, axis, angle);
    }
    return result;
  }
}

export function sampleBox3DFaceAtGrid(
  scene: any,
  quad: QuadObject,
  u: number,
  v: number,
  side: Box3DSurfaceSide = 'front'
): Omit<Box3DSurfaceAnchor, 'quad' | 'boxId' | 'faceIndex' | 'vertices'> | null {
  const vertices = quad.box3dWorldVertices;
  if (!vertices?.length) return null;
  const camera = scene.camera || { x: 0, y: 0 };
  const perspective =
    Number.isFinite(scene.box3dPerspective) && scene.box3dPerspective >= 0
      ? scene.box3dPerspective
      : 1;
  const focal = getBox3DProjectionFocal(camera);
  const projected = quad.getGridPointAt(u, v, true);
  const origin =
    perspective === 0
      ? orthographicRayOrigin(projected.x, projected.y, vertices)
      : cameraPoint(camera, perspective, focal);
  const direction =
    perspective === 0
      ? { x: 0, y: 0, z: 1 }
      : { x: projected.x - camera.x, y: projected.y - camera.y, z: focal / perspective };
  const plane = planeFrom(vertices);
  const denominator = dot(plane.normal, direction);
  if (Math.abs(denominator) < EPSILON) return null;
  const distance = -(dot(plane.normal, origin) + plane.d) / denominator;
  if (!Number.isFinite(distance) || distance < 0) return null;
  const sign = side === 'back' ? -1 : 1;
  const point = {
    x: origin.x + direction.x * distance + plane.normal.x * SURFACE_OFFSET * sign,
    y: origin.y + direction.y * distance + plane.normal.y * SURFACE_OFFSET * sign,
    z: origin.z + direction.z * distance + plane.normal.z * SURFACE_OFFSET * sign,
  };
  const offsetProjected = projectBox3DPoint(point, camera, perspective, focal);
  return { point, projected: offsetProjected, parallax: offsetProjected.p, side };
}

export function createBox3DSurfaceAnchor(
  scene: any,
  quad: QuadObject,
  entity: Entity,
  u: number,
  v: number,
  side: Box3DSurfaceSide = 'front'
): Box3DSurfaceAnchor | null {
  const sample = sampleBox3DFaceAtGrid(scene, quad, u, v, side);
  const boxId = quad.spatial?.parentNodeId;
  if (!sample || !boxId || !Number.isInteger(quad.box3dFaceIndex)) return null;
  const camera = scene.camera || { x: 0, y: 0 };
  const p = sample.parallax;
  const corners = [
    { x: sample.projected.x - entity.width / 2, y: sample.projected.y },
    { x: sample.projected.x - entity.width / 2, y: sample.projected.y - entity.height },
    { x: sample.projected.x + entity.width / 2, y: sample.projected.y - entity.height },
    { x: sample.projected.x + entity.width / 2, y: sample.projected.y },
  ];
  const vertices = corners.map((corner) => ({
    x: camera.x + (corner.x - camera.x) / p,
    y: camera.y + (corner.y - camera.y) / p,
    z: sample.point.z,
  }));
  return {
    quad,
    boxId,
    faceIndex: quad.box3dFaceIndex!,
    point: sample.point,
    projected: sample.projected,
    parallax: sample.parallax,
    vertices,
    side,
  };
}

export function getBox3DAttachedEntityFaces(scene: any, candidates?: any[]): Box3DFace[] {
  const source = candidates || scene.entities || [];
  return source.flatMap((value: any) => {
    const anchor = value.__box3dSurfaceAnchor as Box3DSurfaceAnchor | undefined;
    if (!anchor || value.disabled || value.visible === false) return [];
    const box = getBox3DById(scene, anchor.boxId);
    if (!box) return [];
    const activeCutters = getActiveBox3DCutters(scene, box.layer);
    if (box.cutter) {
      if (
        !(scene.entities || []).some(
          (candidate: any) =>
            candidate instanceof Box3DObject &&
            !candidate.cutter &&
            candidate.layer === box.layer &&
            !candidate.disabled &&
            candidate.visible !== false &&
            isPointInsideBox3D(anchor.point, candidate)
        )
      )
        return [];
    } else if (activeCutters.some((cutter) => isPointInsideBox3D(anchor.point, cutter))) {
      return [];
    }
    return [
      {
        quad: anchor.quad,
        entity: value as Entity,
        vertices: anchor.vertices,
        sceneOrder: scene.entities.indexOf(value),
        boxId: anchor.boxId,
        faceIndex: anchor.faceIndex,
      },
    ];
  });
}

/** True when a static face lies between the camera and a surface-bound Entity. */
export function isBox3DFaceInFrontOfPoint(scene: any, face: Box3DFace, point: Box3DPoint): boolean {
  const camera = scene.camera || { x: 0, y: 0 };
  const perspective =
    Number.isFinite(scene.box3dPerspective) && scene.box3dPerspective >= 0
      ? scene.box3dPerspective
      : 1;
  const focal = getBox3DProjectionFocal(camera);
  const viewpoint =
    perspective === 0
      ? orthographicRayOrigin(camera.x, camera.y, face.vertices)
      : cameraPoint(camera, perspective, focal);
  const plane = planeFrom(face.vertices);
  const cameraSide = signedDistance(plane, viewpoint);
  const pointSide = signedDistance(plane, point);
  return (
    Math.abs(cameraSide) > EPSILON && Math.abs(pointSide) > EPSILON && cameraSide * pointSide < 0
  );
}

export function isSpatialDescendantOf(scene: any, value: any, ancestorName: string): boolean {
  const visited = new Set<string>();
  let parentName = value?.spatial?.parentNodeId;
  while (parentName && !visited.has(parentName)) {
    if (parentName === ancestorName) return true;
    visited.add(parentName);
    parentName = scene.getObjectByName?.(parentName)?.spatial?.parentNodeId;
  }
  return false;
}

function syncFaceChildrenDisabled(scene: any, quad: QuadObject, inheritedDisabled: boolean): void {
  for (const child of scene.entities || []) {
    const marker = (child as any)[INHERITED_DISABLED] as
      | { quadName: string; authoredDisabled: boolean }
      | undefined;
    const belongs = isSpatialDescendantOf(scene, child, quad.name);
    if (inheritedDisabled && belongs) {
      if (marker?.quadName !== quad.name) {
        (child as any)[INHERITED_DISABLED] = {
          quadName: quad.name,
          authoredDisabled: marker?.authoredDisabled ?? !!child.disabled,
        };
      }
      child.disabled = true;
    } else if (marker?.quadName === quad.name) {
      child.disabled = marker.authoredDisabled;
      delete (child as any)[INHERITED_DISABLED];
    }
  }
}

function getNearPlaneDenominator(focal: number): number {
  return Math.max(focal * NEAR_PLANE_RATIO, EPSILON);
}

function isBox3DPointPastNearPlane(point: Box3DPoint, perspective: number, focal: number): boolean {
  return perspective === 0 || focal + perspective * point.z >= getNearPlaneDenominator(focal);
}

function clampBox3DPointToNearPlane(
  point: Box3DPoint,
  perspective: number,
  focal: number
): Box3DPoint {
  if (isBox3DPointPastNearPlane(point, perspective, focal)) return point;
  return { ...point, z: (getNearPlaneDenominator(focal) - focal) / perspective };
}

function clipBox3DPolygonToNearPlane(
  vertices: Box3DPoint[],
  perspective: number,
  focal: number
): Box3DPoint[] | null {
  if (perspective === 0) return vertices;
  const near = getNearPlaneDenominator(focal);
  const clipped: Box3DPoint[] = [];
  for (let index = 0; index < vertices.length; index++) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    const currentDistance = focal + perspective * current.z - near;
    const nextDistance = focal + perspective * next.z - near;
    const currentInside = currentDistance >= 0;
    const nextInside = nextDistance >= 0;
    if (currentInside) clipped.push(current);
    if (currentInside !== nextInside) {
      const t = currentDistance / (currentDistance - nextDistance);
      clipped.push({
        x: current.x + (next.x - current.x) * t,
        y: current.y + (next.y - current.y) * t,
        z: current.z + (next.z - current.z) * t,
      });
    }
  }
  return normalizeFaceVertices(clipped);
}

export function projectBox3DPoint(
  v: Box3DPoint,
  camera: { x: number; y: number },
  perspective: number,
  focal = GAME_DESIGN_WIDTH
): QuadVertex {
  const p = perspective === 0 ? 1 : focal / (focal + perspective * v.z);
  return {
    x: camera.x + (v.x - camera.x) * p,
    y: camera.y + (v.y - camera.y) * p,
    p,
  };
}

export function getBox3DFrontAxisSegment(
  segment: [Box3DPoint, Box3DPoint],
  boxVertices: Box3DPoint[]
): [Box3DPoint, Box3DPoint] | null {
  const [start, end] = segment;
  if (Math.abs(start.z - end.z) < EPSILON) return null;
  const direction = subtract(end, start);
  const intersections = BOX3D_FACE_VERTICES.map((indices) =>
    intersectFace(
      start,
      direction,
      indices.map((index) => boxVertices[index])
    )
  )
    .filter((t): t is number => t !== null && t <= 1 + EPSILON)
    .sort((a, b) => a - b);
  if (intersections.length < 2) return null;
  const nearIsStart = start.z < end.z;
  const t = nearIsStart ? intersections[0] : intersections[intersections.length - 1];
  const surface = {
    x: start.x + direction.x * t,
    y: start.y + direction.y * t,
    z: start.z + direction.z * t,
  };
  return nearIsStart ? [start, surface] : [end, surface];
}

export function getVisibleBox3DFaces(scene: any, candidates?: any[]): Box3DFace[] {
  const source = candidates || scene.entities || [];
  const camera = scene.camera || { x: 0, y: 0 };
  const perspective =
    Number.isFinite(scene.box3dPerspective) && scene.box3dPerspective >= 0
      ? scene.box3dPerspective
      : 1;
  const focal = getBox3DProjectionFocal(camera);
  const faces = source.flatMap((value: any) => {
    if (
      !(value instanceof QuadObject) ||
      value.box3dHidden ||
      value.disabled ||
      value.visible === false ||
      !value.box3dWorldVertices?.length
    )
      return [];
    const faceIndex = value.box3dFaceIndex;
    if (!Number.isInteger(faceIndex)) return [];
    const boxId = value.spatial?.parentNodeId;
    const box = scene.entities.find(
      (item: any) => item instanceof Box3DObject && item.name === boxId
    );
    if (!box || box.disabled || box.visible === false) return [];
    const vertices = normalizeFaceVertices(value.box3dWorldVertices);
    if (!vertices) return [];
    const clipped = clipBox3DPolygonToNearPlane(vertices, perspective, focal);
    if (!clipped) return [];
    return [
      {
        quad: value,
        vertices: clipped,
        sceneOrder: scene.entities.indexOf(value),
        boxId,
        faceIndex,
        fragmented: vertices.some(
          (vertex) => !isBox3DPointPastNearPlane(vertex, perspective, focal)
        ),
      },
    ];
  });
  return applyBox3DCutters(scene, faces);
}

function applyBox3DCutters(scene: any, faces: Box3DFace[]): Box3DFace[] {
  const boxes = new Map<string, Box3DObject>();
  for (const value of scene.entities || [])
    if (value instanceof Box3DObject) boxes.set(value.name, value);
  const cutters = [...boxes.values()].filter(
    (box) => box.cutter && !box.disabled && box.visible !== false
  );
  if (!cutters.length) return faces;

  const facesByBox = new Map<string, Box3DFace[]>();
  for (const face of faces) {
    const group = facesByBox.get(face.boxId) || [];
    group.push(face);
    facesByBox.set(face.boxId, group);
  }

  const result: Box3DFace[] = [];
  for (const [boxId, targetFaces] of facesByBox) {
    const target = boxes.get(boxId);
    if (!target || target.cutter) continue;
    const targetPlanes = getBox3DPlanes(target);
    const layerCutters = cutters.filter((cutter) => cutter.layer === target.layer);
    let remaining = targetFaces;
    for (const cutter of layerCutters) {
      const cutterPlanes = getBox3DPlanes(cutter);
      remaining = remaining.flatMap((face) => subtractConvexVolumeFromFace(face, cutterPlanes));
      for (const cutterFace of facesByBox.get(cutter.name) || []) {
        const cavity = clipFaceToConvexVolume(cutterFace, targetPlanes);
        if (cavity)
          result.push({ ...cavity, vertices: cavity.vertices.slice().reverse(), fragmented: true });
      }
    }
    result.push(...remaining);
  }
  return result;
}

function getBox3DById(scene: any, id: string): Box3DObject | undefined {
  return (scene.entities || []).find(
    (value: any) => value instanceof Box3DObject && value.name === id
  );
}

function getActiveBox3DCutters(scene: any, layer: number): Box3DObject[] {
  return (scene.entities || []).filter(
    (value: any) =>
      value instanceof Box3DObject &&
      value.cutter &&
      value.layer === layer &&
      !value.disabled &&
      value.visible !== false
  );
}

function getBox3DPlanes(box: Box3DObject): Plane[] {
  const vertices = box.getWorldVertices();
  return BOX3D_FACE_VERTICES.map((indices) => planeFrom(indices.map((index) => vertices[index])));
}

function isPointInsideBox3D(point: Box3DPoint, box: Box3DObject): boolean {
  return getBox3DPlanes(box).every((plane) => signedDistance(plane, point) <= EPSILON);
}

function subtractConvexVolumeFromFace(face: Box3DFace, planes: Plane[]): Box3DFace[] {
  let inside = [face];
  const outside: Box3DFace[] = [];
  for (const plane of planes) {
    const next: Box3DFace[] = [];
    for (const part of inside) {
      const split = splitFace(part, plane);
      outside.push(...split.front);
      next.push(...split.back, ...split.coplanar);
    }
    inside = next;
    if (!inside.length) break;
  }
  return outside;
}

function clipFaceToConvexVolume(face: Box3DFace, planes: Plane[]): Box3DFace | null {
  let clipped = face;
  for (const plane of planes) {
    const split = splitFace(clipped, plane);
    const next = split.back[0] || split.coplanar[0];
    if (!next) return null;
    clipped = next;
  }
  return clipped;
}

export function buildBox3DRenderFragments(scene: any, faces: Box3DFace[]): Box3DFragment[] {
  const camera = scene.camera || { x: 0, y: 0 };
  const perspective =
    Number.isFinite(scene.box3dPerspective) && scene.box3dPerspective >= 0
      ? scene.box3dPerspective
      : 1;
  const focal = getBox3DProjectionFocal(camera);
  faces = faces.flatMap((face) => {
    const vertices = normalizeFaceVertices(face.vertices);
    if (!vertices) return [];
    const clipped = clipBox3DPolygonToNearPlane(vertices, perspective, focal);
    return clipped
      ? [
          {
            ...face,
            vertices: clipped,
            fragmented:
              !!face.fragmented ||
              vertices.some((vertex) => !isBox3DPointPastNearPlane(vertex, perspective, focal)),
          },
        ]
      : [];
  });
  if (!faces.length) return [];
  const cacheKey = getRenderFragmentCacheKey(scene, faces, camera, perspective, focal);
  const sceneCache = renderFragmentCache.get(scene);
  const cached = sceneCache?.get(cacheKey);
  if (cached) return cached;
  const cache = (fragments: Box3DFragment[]) => {
    const entries = sceneCache || new Map<string, Box3DFragment[]>();
    entries.set(cacheKey, fragments);
    if (entries.size > MAX_RENDER_FRAGMENT_CACHE_ENTRIES)
      entries.delete(entries.keys().next().value!);
    renderFragmentCache.set(scene, entries);
    return fragments;
  };
  let count = faces.length;
  const ordered: Box3DFace[] = [];
  for (const group of partitionScreenOverlaps(faces, camera, perspective, focal)) {
    if (usesFastBox3DOcclusion(scene, group)) {
      ordered.push(...sortBox3DFacesByDepth(group));
      continue;
    }
    const root: BspNode = {
      plane: planeFrom(group[0].vertices),
      coplanar: [group[0]],
      front: null,
      back: null,
    };
    for (let i = 1; i < group.length; i++)
      insertBsp(root, group[i], () => ++count <= MAX_BSP_FRAGMENTS);
    const viewpoint =
      perspective === 0
        ? orthographicRayOrigin(
            camera.x,
            camera.y,
            group.flatMap((face) => face.vertices)
          )
        : cameraPoint(camera, perspective, focal);
    traverseBsp(root, viewpoint, ordered);
  }
  if (count > MAX_BSP_FRAGMENTS) {
    if (!warnedAboutFragmentLimit) {
      warnedAboutFragmentLimit = true;
      console.warn(
        `Box3D BSP fragment limit (${MAX_BSP_FRAGMENTS}) exceeded; using stable face-depth sorting.`
      );
    }
    return cache(
      cullFullyOccludedBox3DFragments(
        orderWalkboxSurfaceEntities(sortBox3DFacesByDepth(faces)).map((face) => ({
          ...face,
          projected: projectFace(face, camera, perspective, focal),
          fragmented: false,
          depthFallback: true,
        }))
      )
    );
  }
  return cache(
    cullFullyOccludedBox3DFragments(
      orderWalkboxSurfaceEntities(ordered).map((face) => ({
        ...face,
        projected: projectFace(face, camera, perspective, focal),
        fragmented: !!face.fragmented,
      }))
    )
  );
}

/** Removes fragments fully hidden by one nearer guaranteed-opaque static face. */
export function cullFullyOccludedBox3DFragments(fragments: Box3DFragment[]): Box3DFragment[] {
  return fragments.filter(
    (fragment, index) =>
      !fragments
        .slice(index + 1)
        .some(
          (occluder) =>
            isGuaranteedOpaqueBox3DFace(occluder) && isProjectedFaceInside(fragment, occluder)
        )
  );
}

function isGuaranteedOpaqueBox3DFace(fragment: Box3DFragment): boolean {
  const quad = fragment.quad;
  return (
    !fragment.entity &&
    quad.filled &&
    !quad.spriteName &&
    quad.opacity >= 1 &&
    quad.blur <= 0 &&
    quad.blendMode === 'source-over'
  );
}

function isProjectedFaceInside(fragment: Box3DFragment, occluder: Box3DFragment): boolean {
  const epsilon = 0.001;
  const bounds = (points: { x: number; y: number }[]) => ({
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  });
  const source = bounds(fragment.projected);
  const target = bounds(occluder.projected);
  if (
    source.minX < target.minX - epsilon ||
    source.maxX > target.maxX + epsilon ||
    source.minY < target.minY - epsilon ||
    source.maxY > target.maxY + epsilon
  )
    return false;
  return fragment.projected.every((point) =>
    Geometry.isPointInPolygonWithEpsilon(point, occluder.projected, epsilon)
  );
}

function getRenderFragmentCacheKey(
  scene: any,
  faces: Box3DFace[],
  camera: { x: number; y: number; zoom?: number },
  perspective: number,
  focal: number
): string {
  return [
    camera.x,
    camera.y,
    camera.zoom,
    perspective,
    focal,
    scene.box3dOcclusionMode || 'exact',
    ...faces.map((face) =>
      [
        face.quad.name,
        face.entity?.name || '',
        getBox3DById(scene, face.boxId)?.occlusionMode || 'inherit',
        face.fragmented ? 1 : 0,
        ...face.vertices.flatMap((vertex) => [vertex.x, vertex.y, vertex.z]),
      ].join(',')
    ),
  ].join('|');
}

function usesFastBox3DOcclusion(scene: any, faces: Box3DFace[]): boolean {
  return (
    scene.box3dOcclusionMode === 'fast' ||
    faces.some((face) => getBox3DById(scene, face.boxId)?.occlusionMode === 'fast')
  );
}

function sortBox3DFacesByDepth(faces: Box3DFace[]): Box3DFace[] {
  return faces
    .slice()
    .sort((a, b) => averageZ(b.vertices) - averageZ(a.vertices) || compareFaceKey(a, b));
}

function projectFace(
  face: Box3DFace,
  camera: { x: number; y: number },
  perspective: number,
  focal: number
): QuadVertex[] {
  return face.vertices.map((vertex) => projectBox3DPoint(vertex, camera, perspective, focal));
}

function partitionScreenOverlaps(
  faces: Box3DFace[],
  camera: { x: number; y: number },
  perspective: number,
  focal: number
): Box3DFace[][] {
  const bounds = faces.map((face) => {
    const points = projectFace(face, camera, perspective, focal);
    return {
      minX: Math.min(...points.map((p) => p.x)),
      maxX: Math.max(...points.map((p) => p.x)),
      minY: Math.min(...points.map((p) => p.y)),
      maxY: Math.max(...points.map((p) => p.y)),
    };
  });
  const remaining = new Set(faces.map((_, index) => index));
  const groups: Box3DFace[][] = [];
  while (remaining.size) {
    const queue = [remaining.values().next().value as number],
      group: Box3DFace[] = [];
    remaining.delete(queue[0]);
    while (queue.length) {
      const index = queue.pop()!;
      group.push(faces[index]);
      for (const candidate of [...remaining]) {
        const a = bounds[index],
          b = bounds[candidate];
        if (
          a.maxX < b.minX - EPSILON ||
          b.maxX < a.minX - EPSILON ||
          a.maxY < b.minY - EPSILON ||
          b.maxY < a.minY - EPSILON
        )
          continue;
        remaining.delete(candidate);
        queue.push(candidate);
      }
    }
    groups.push(group);
  }
  return groups;
}

export function raycastBox3DFace(
  scene: any,
  screenX: number,
  screenY: number,
  candidates?: any[]
): QuadObject | null {
  const canvas = scene.game?.canvas;
  const halfW = (canvas?.width || 640) / 2,
    halfH = (canvas?.height || 360) / 2;
  const projectedX = (screenX - halfW) / scene.camera.zoom + scene.camera.x;
  const projectedY = (screenY - halfH) / scene.camera.zoom + scene.camera.y;
  const perspective =
    Number.isFinite(scene.box3dPerspective) && scene.box3dPerspective >= 0
      ? scene.box3dPerspective
      : 1;
  const focal = getBox3DProjectionFocal(scene.camera);
  const layers = new Map<number, Box3DFace[]>();
  for (const face of getVisibleBox3DFaces(scene, candidates)) {
    const layer = face.quad.layer || 0;
    const values = layers.get(layer) || [];
    values.push(face);
    layers.set(layer, values);
  }
  for (const layer of [...layers.keys()].sort((a, b) => b - a)) {
    const layerFaces = layers.get(layer)!;
    const fragments = buildBox3DRenderFragments(scene, layerFaces);
    if (fragments.some((fragment) => fragment.depthFallback)) {
      for (let index = fragments.length - 1; index >= 0; index--) {
        const fragment = fragments[index];
        if (containsProjectedPoint({ x: projectedX, y: projectedY }, fragment.projected))
          return fragment.quad;
      }
      continue;
    }
    const origin =
      perspective === 0
        ? orthographicRayOrigin(
            projectedX,
            projectedY,
            layerFaces.flatMap((face) => face.vertices)
          )
        : { x: scene.camera.x, y: scene.camera.y, z: -focal / perspective };
    const direction =
      perspective === 0
        ? { x: 0, y: 0, z: 1 }
        : {
            x: projectedX - scene.camera.x,
            y: projectedY - scene.camera.y,
            z: focal / perspective,
          };
    let nearest: { face: Box3DFace; distance: number } | null = null;
    for (const face of layerFaces) {
      const distance = intersectFace(origin, direction, face.vertices);
      if (distance !== null && (!nearest || distance < nearest.distance))
        nearest = { face, distance };
    }
    if (nearest) return nearest.face.quad;
  }
  return null;
}

export function intersectBox3DFaceAtScreen(
  scene: any,
  vertices: Box3DPoint[],
  screenX: number,
  screenY: number,
  requireInside = true
): Box3DPoint | null {
  const canvas = scene.game?.canvas;
  const halfW = (canvas?.width || 640) / 2,
    halfH = (canvas?.height || 360) / 2;
  const projectedX = (screenX - halfW) / scene.camera.zoom + scene.camera.x;
  const projectedY = (screenY - halfH) / scene.camera.zoom + scene.camera.y;
  const perspective =
    Number.isFinite(scene.box3dPerspective) && scene.box3dPerspective >= 0
      ? scene.box3dPerspective
      : 1;
  const focal = getBox3DProjectionFocal(scene.camera);
  const origin =
    perspective === 0
      ? orthographicRayOrigin(projectedX, projectedY, vertices)
      : { x: scene.camera.x, y: scene.camera.y, z: -focal / perspective };
  const direction =
    perspective === 0
      ? { x: 0, y: 0, z: 1 }
      : { x: projectedX - scene.camera.x, y: projectedY - scene.camera.y, z: focal / perspective };
  const distance = intersectFace(origin, direction, vertices, requireInside);
  return distance === null
    ? null
    : {
        x: origin.x + direction.x * distance,
        y: origin.y + direction.y * distance,
        z: origin.z + direction.z * distance,
      };
}

type Plane = { normal: Box3DPoint; d: number };
type BspNode = { plane: Plane; coplanar: Box3DFace[]; front: BspNode | null; back: BspNode | null };

function insertBsp(node: BspNode, face: Box3DFace, allowFragment: () => boolean): void {
  const split = splitFace(face, node.plane);
  node.coplanar.push(...split.coplanar);
  for (const [side, parts] of [
    ['front', split.front],
    ['back', split.back],
  ] as const) {
    for (const part of parts) {
      if (part !== face && !allowFragment()) return;
      if (!node[side])
        node[side] = { plane: planeFrom(part.vertices), coplanar: [part], front: null, back: null };
      else insertBsp(node[side]!, part, allowFragment);
    }
  }
}

function splitFace(
  face: Box3DFace,
  plane: Plane
): { front: Box3DFace[]; back: Box3DFace[]; coplanar: Box3DFace[] } {
  const distances = face.vertices.map((v) => signedDistance(plane, v));
  const hasFront = distances.some((d) => d > EPSILON),
    hasBack = distances.some((d) => d < -EPSILON);
  if (!hasFront && !hasBack) return { front: [], back: [], coplanar: [face] };
  if (!hasBack) return { front: [face], back: [], coplanar: [] };
  if (!hasFront) return { front: [], back: [face], coplanar: [] };
  const front: Box3DPoint[] = [],
    back: Box3DPoint[] = [];
  for (let i = 0; i < face.vertices.length; i++) {
    const current = face.vertices[i],
      next = face.vertices[(i + 1) % face.vertices.length];
    const dc = distances[i],
      dn = distances[(i + 1) % face.vertices.length];
    if (dc >= -EPSILON) front.push(current);
    if (dc <= EPSILON) back.push(current);
    if ((dc > EPSILON && dn < -EPSILON) || (dc < -EPSILON && dn > EPSILON)) {
      const t = dc / (dc - dn);
      const point = {
        x: current.x + (next.x - current.x) * t,
        y: current.y + (next.y - current.y) * t,
        z: current.z + (next.z - current.z) * t,
      };
      front.push(point);
      back.push(point);
    }
  }
  return {
    front: front.length >= 3 ? [{ ...face, vertices: front, fragmented: true }] : [],
    back: back.length >= 3 ? [{ ...face, vertices: back, fragmented: true }] : [],
    coplanar: [],
  };
}

function traverseBsp(node: BspNode | null, camera: Box3DPoint, output: Box3DFace[]): void {
  if (!node) return;
  const cameraInFront = signedDistance(node.plane, camera) >= 0;
  traverseBsp(cameraInFront ? node.back : node.front, camera, output);
  output.push(...node.coplanar.sort(compareFaceKey));
  traverseBsp(cameraInFront ? node.front : node.back, camera, output);
}

function planeFrom(vertices: Box3DPoint[]): Plane {
  const a = vertices[0],
    b = vertices[1],
    c = vertices[2];
  const normal = cross(subtract(b, a), subtract(c, a));
  const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
  normal.x /= length;
  normal.y /= length;
  normal.z /= length;
  return { normal, d: -dot(normal, a) };
}
function normalizeFaceVertices(vertices: Box3DPoint[]): Box3DPoint[] | null {
  const result = vertices.filter((vertex, index) => {
    const previous = vertices[(index + vertices.length - 1) % vertices.length];
    return (
      Math.hypot(vertex.x - previous.x, vertex.y - previous.y, vertex.z - previous.z) > EPSILON
    );
  });
  if (result.length < 3) return null;
  const origin = result[0];
  const areaNormal = result.slice(1, -1).reduce(
    (sum, vertex, index) => {
      const normal = cross(subtract(vertex, origin), subtract(result[index + 2], origin));
      return { x: sum.x + normal.x, y: sum.y + normal.y, z: sum.z + normal.z };
    },
    { x: 0, y: 0, z: 0 }
  );
  return Math.hypot(areaNormal.x, areaNormal.y, areaNormal.z) > EPSILON ? result : null;
}
function signedDistance(plane: Plane, point: Box3DPoint): number {
  return dot(plane.normal, point) + plane.d;
}
export function getBox3DProjectionFocal(camera: { zoom?: number }): number {
  return GAME_DESIGN_WIDTH / Math.max(Number(camera.zoom) || 1, EPSILON);
}
function cameraPoint(
  camera: { x: number; y: number },
  perspective: number,
  focal: number
): Box3DPoint {
  return { x: camera.x, y: camera.y, z: -focal / perspective };
}
function orthographicRayOrigin(x: number, y: number, vertices: Box3DPoint[]): Box3DPoint {
  const depths = vertices.map((vertex) => vertex.z).filter(Number.isFinite);
  const minZ = depths.length ? Math.min(...depths) : 0;
  const maxZ = depths.length ? Math.max(...depths) : minZ;
  return { x, y, z: minZ - Math.max(1, maxZ - minZ) };
}
function averageZ(vertices: Box3DPoint[]): number {
  return vertices.reduce((sum, v) => sum + v.z, 0) / vertices.length;
}
function compareFaceKey(a: Box3DFace, b: Box3DFace): number {
  return a.sceneOrder - b.sceneOrder || a.boxId.localeCompare(b.boxId) || a.faceIndex - b.faceIndex;
}

/** A WalkBox is a floor: its owning face must not clip an Actor standing on it. */
function orderWalkboxSurfaceEntities(faces: Box3DFace[]): Box3DFace[] {
  const ordered = [...faces];
  for (const entityFace of faces.filter((face) => face.entity)) {
    const owner = (entityFace.entity as any).__box3dSurfaceAnchor?.quad as QuadObject | undefined;
    if (!owner?.components?.some((component: any) => component?.type === 'WalkBox')) continue;
    const firstEntityIndex = ordered.findIndex((face) => face.entity === entityFace.entity);
    if (firstEntityIndex < 0) continue;
    const ownerAfterEntity = ordered.filter(
      (face, index) => index > firstEntityIndex && !face.entity && face.quad === owner
    );
    if (!ownerAfterEntity.length) continue;
    for (const face of ownerAfterEntity) ordered.splice(ordered.indexOf(face), 1);
    ordered.splice(firstEntityIndex, 0, ...ownerAfterEntity);
  }
  return ordered;
}
function subtract(a: Box3DPoint, b: Box3DPoint): Box3DPoint {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function cross(a: Box3DPoint, b: Box3DPoint): Box3DPoint {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function dot(a: Box3DPoint, b: Box3DPoint): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function intersectFace(
  origin: Box3DPoint,
  direction: Box3DPoint,
  vertices: Box3DPoint[],
  requireInside = true
): number | null {
  const plane = planeFrom(vertices);
  const denominator = dot(plane.normal, direction);
  if (Math.abs(denominator) < EPSILON) return null;
  const t = -(dot(plane.normal, origin) + plane.d) / denominator;
  if (t < 0) return null;
  const point = {
    x: origin.x + direction.x * t,
    y: origin.y + direction.y * t,
    z: origin.z + direction.z * t,
  };
  if (requireInside) {
    for (let i = 0; i < vertices.length; i++) {
      const edge = subtract(vertices[(i + 1) % vertices.length], vertices[i]);
      const relative = subtract(point, vertices[i]);
      if (dot(cross(edge, relative), plane.normal) < -EPSILON) return null;
    }
  }
  return t;
}

function containsProjectedPoint(
  point: { x: number; y: number },
  vertices: { x: number; y: number }[]
): boolean {
  let sign = 0;
  for (let index = 0; index < vertices.length; index++) {
    const a = vertices[index],
      b = vertices[(index + 1) % vertices.length];
    const crossZ = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (Math.abs(crossZ) <= EPSILON) continue;
    const edgeSign = Math.sign(crossZ);
    if (sign && edgeSign !== sign) return false;
    sign = edgeSign;
  }
  return true;
}

function rotate(v: Box3DPoint, p: Box3DPoint, axis: 'x' | 'y' | 'z', deg: number): Box3DPoint {
  const r = (deg * Math.PI) / 180,
    c = Math.cos(r),
    s = Math.sin(r),
    x = v.x - p.x,
    y = v.y - p.y,
    z = v.z - p.z;
  if (axis === 'x') return { x: x + p.x, y: y * c - z * s + p.y, z: y * s + z * c + p.z };
  if (axis === 'y') return { x: x * c + z * s + p.x, y: y + p.y, z: -x * s + z * c + p.z };
  return { x: x * c - y * s + p.x, y: x * s + y * c + p.y, z: z + p.z };
}

type Matrix3 = [Box3DPoint, Box3DPoint, Box3DPoint];

function columnsToRows(columns: Matrix3): Matrix3 {
  return [
    { x: columns[0].x, y: columns[1].x, z: columns[2].x },
    { x: columns[0].y, y: columns[1].y, z: columns[2].y },
    { x: columns[0].z, y: columns[1].z, z: columns[2].z },
  ];
}

function multiplyMatrix(a: Matrix3, b: Matrix3): Matrix3 {
  const column = (matrix: Matrix3, index: 0 | 1 | 2) => ({
    x: index === 0 ? matrix[0].x : index === 1 ? matrix[0].y : matrix[0].z,
    y: index === 0 ? matrix[1].x : index === 1 ? matrix[1].y : matrix[1].z,
    z: index === 0 ? matrix[2].x : index === 1 ? matrix[2].y : matrix[2].z,
  });
  const dot = (row: Box3DPoint, col: Box3DPoint) => row.x * col.x + row.y * col.y + row.z * col.z;
  const c0 = column(b, 0),
    c1 = column(b, 1),
    c2 = column(b, 2);
  return a.map((row) => ({ x: dot(row, c0), y: dot(row, c1), z: dot(row, c2) })) as Matrix3;
}

function axisAngleMatrix(direction: Box3DPoint, degrees: number): Matrix3 | null {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length <= EPSILON) return null;
  const x = direction.x / length,
    y = direction.y / length,
    z = direction.z / length;
  const radians = (degrees * Math.PI) / 180,
    c = Math.cos(radians),
    s = Math.sin(radians),
    t = 1 - c;
  return [
    { x: t * x * x + c, y: t * x * y - s * z, z: t * x * z + s * y },
    { x: t * x * y + s * z, y: t * y * y + c, z: t * y * z - s * x },
    { x: t * x * z - s * y, y: t * y * z + s * x, z: t * z * z + c },
  ];
}

function decomposeZYX(matrix: Matrix3): [number, number, number] {
  const cy = Math.hypot(matrix[0].x, matrix[0].y);
  const y = Math.atan2(matrix[0].z, cy);
  const x =
    cy > EPSILON
      ? Math.atan2(-matrix[1].z, matrix[2].z)
      : Math.atan2(Math.sign(matrix[0].z || 1) * matrix[1].x, matrix[1].y);
  const z = cy > EPSILON ? Math.atan2(-matrix[0].y, matrix[0].x) : 0;
  const toDegrees = (value: number) => (value * 180) / Math.PI;
  return [toDegrees(x), toDegrees(y), toDegrees(z)];
}

export function rotateAroundAxis(
  point: Box3DPoint,
  pivot: Box3DPoint,
  direction: Box3DPoint,
  degrees: number
): Box3DPoint {
  const matrix = axisAngleMatrix(direction, degrees);
  if (!matrix) return { ...point };
  const value = { x: point.x - pivot.x, y: point.y - pivot.y, z: point.z - pivot.z };
  return {
    x: pivot.x + matrix[0].x * value.x + matrix[0].y * value.y + matrix[0].z * value.z,
    y: pivot.y + matrix[1].x * value.x + matrix[1].y * value.y + matrix[1].z * value.z,
    z: pivot.z + matrix[2].x * value.x + matrix[2].y * value.y + matrix[2].z * value.z,
  };
}

export function orientBox3DAxisDirections<T extends Record<'x' | 'y' | 'z', Box3DPoint>>(
  directions: T,
  rotation: Box3DPoint
): T {
  const origin = { x: 0, y: 0, z: 0 };
  const result = { ...directions } as T;
  (['z', 'y', 'x'] as const).forEach((axis) => {
    const degrees = rotation[axis];
    if (!Number.isFinite(degrees) || degrees === 0) return;
    const direction = result[axis];
    (['x', 'y', 'z'] as const).forEach((key) => {
      result[key] = rotateAroundAxis(result[key], origin, direction, degrees);
    });
  });
  return result;
}

function vectorBetween(start: Box3DPoint, end: Box3DPoint): Box3DPoint {
  return { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
}

function midpoint([start, end]: [Box3DPoint, Box3DPoint]): Box3DPoint {
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, z: (start.z + end.z) / 2 };
}

function segmentAround(pivot: Box3DPoint, direction: Box3DPoint): [Box3DPoint, Box3DPoint] {
  return [
    { x: pivot.x - direction.x / 2, y: pivot.y - direction.y / 2, z: pivot.z - direction.z / 2 },
    { x: pivot.x + direction.x / 2, y: pivot.y + direction.y / 2, z: pivot.z + direction.z / 2 },
  ];
}
export function isManagedBox3DFace(value: any): boolean {
  return (
    value instanceof QuadObject &&
    Number.isInteger(value.box3dFaceIndex) &&
    !!value.spatial?.parentNodeId
  );
}
