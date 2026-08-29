import { describe, expect, it } from 'vitest';
import {
  Box3DObject,
  buildBox3DRenderFragments,
  createBox3DSurfaceAnchor,
  getBox3DAttachedEntityFaces,
  getBox3DFrontAxisSegment,
  getVisibleBox3DFaces,
  intersectBox3DFaceAtScreen,
  projectBox3DPoint,
  raycastBox3DFace,
  rotateAroundAxis,
} from '../../src/entities/Box3DObject';
import { expandPolygonForCoverage, QuadObject } from '../../src/entities/QuadObject';
import { Scene } from '../../src/scene/Scene';

describe('Box3DObject', () => {
  it('treats zero-width frustum faces as triangles and drops the zero-area top', () => {
    const game: any = { editor: null, canvas: { width: 640, height: 360 } };
    const box = new Box3DObject(game, 'prism');
    box.rotationX = 0;
    box.rotationY = 0;
    box.rotationZ = 0;
    box.topWidth = 0;
    const faces = Array.from({ length: 6 }, (_, index) => {
      const face = new QuadObject(game, `prism_face_${index}`);
      face.box3dFaceIndex = index;
      face.spatial = { parentNodeId: box.name, relation: 'in' };
      return face;
    });
    const scene: any = {
      game,
      entities: [box, ...faces],
      camera: { x: 0, y: 0, zoom: 1 },
      box3dPerspective: 1,
    };
    box.syncFaces(scene);

    const visible = getVisibleBox3DFaces(scene);

    expect(visible.map((face) => face.faceIndex)).not.toContain(0);
    expect(visible.find((face) => face.faceIndex === 2)?.vertices).toHaveLength(3);
    expect(visible.find((face) => face.faceIndex === 4)?.vertices).toHaveLength(3);
    expect(raycastBox3DFace(scene, 320, 180)?.box3dFaceIndex).toBe(2);
  });

  it('shows the camera-side part of an axis up to the physical shell', () => {
    const box = new Box3DObject({} as any, 'box');
    box.rotationX = 0;
    box.rotationY = 0;
    box.rotationZ = 0;

    const segment = getBox3DFrontAxisSegment(box.getWorldAxisSegments().z, box.getWorldVertices());

    expect(segment?.[0].z).toBe(-100);
    expect(segment?.[1].z).toBe(-50);
  });

  it('draws each rotation axis in the coordinate space of its transform stage', () => {
    const box = new Box3DObject({} as any, 'box');
    box.x = 100;
    box.y = 200;
    box.z = 300;
    box.rotationZ = 90;
    box.rotationY = 30;
    box.rotationX = 0;
    box.pivotY = { x: 10, y: 20, z: 30 };
    box.pivotX = { x: 40, y: 50, z: 60 };

    const midpoint = ([a, b]: [
      { x: number; y: number; z: number },
      { x: number; y: number; z: number },
    ]) => ({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      z: (a.z + b.z) / 2,
    });
    const axes = box.getWorldAxisSegments();

    expect(midpoint(axes.y)).toEqual({ x: 110, y: 220, z: 330 });
    expect(midpoint(axes.x)).toEqual({ x: 140, y: 250, z: 360 });
  });

  it('tilts object axes without changing the Box3D transform', () => {
    const box = new Box3DObject({} as any, 'box');
    box.rotationX = 0;
    box.rotationY = 0;
    box.rotationZ = 0;
    box.axisRotationZ = 90;

    const [start, end] = box.getWorldAxisSegments().x;

    expect(end.x - start.x).toBeCloseTo(0, 6);
    expect(Math.abs(end.y - start.y)).toBeGreaterThan(100);
    expect(box.getWorldVertices()[0]).toEqual({ x: -50, y: -50, z: -50 });
  });

  it('bakes an exact rigid rotation around an arbitrary world axis', () => {
    const box = new Box3DObject({} as any, 'box');
    Object.assign(box, { x: 30, y: -20, z: 40, rotationX: 17, rotationY: -28, rotationZ: 9 });
    box.pivotX = { x: 3, y: 4, z: 5 };
    box.pivotY = { x: -2, y: 7, z: 1 };
    box.pivotZ = { x: 6, y: -3, z: 2 };
    const before = box.getWorldVertices();
    const pivot = { x: 10, y: 20, z: -15 };
    const direction = { x: 1, y: 2, z: 3 };

    box.rotateAroundWorldAxis(pivot, direction, 37);

    const expected = before.map((point) => rotateAroundAxis(point, pivot, direction, 37));
    box.getWorldVertices().forEach((point, index) => {
      expect(point.x).toBeCloseTo(expected[index].x, 6);
      expect(point.y).toBeCloseTo(expected[index].y, 6);
      expect(point.z).toBeCloseTo(expected[index].z, 6);
    });
  });

  it('keeps all six shell faces available behind openings', () => {
    const game: any = { editor: null };
    const box = new Box3DObject(game, 'box');
    const entities: any[] = [box];
    for (let index = 0; index < 6; index++) {
      const face = new QuadObject(game, `box_face_${index}`);
      face.box3dFaceIndex = index;
      face.spatial = { parentNodeId: 'box', relation: 'in' };
      entities.push(face);
    }
    box.syncFaces({ entities, camera: { x: 0, y: 0 }, box3dPerspective: 1 });
    const faces = entities.slice(1) as QuadObject[];
    expect(faces.every((face) => face.vertices.length === 4 && face.parallax === 1)).toBe(true);
    expect(faces.filter((face) => !face.box3dHidden)).toHaveLength(6);
    faces[1].disabled = true;
    box.syncFaces({ entities, camera: { x: 0, y: 0 }, box3dPerspective: 1 });
    expect(getVisibleBox3DFaces({ entities })).toHaveLength(5);
  });

  it('clips individual faces at the near plane instead of hiding the whole Box', () => {
    const game: any = { editor: null, canvas: { width: 640, height: 360 } };
    const box = new Box3DObject(game, 'inside');
    box.rotationX = 0;
    box.rotationY = 0;
    box.rotationZ = 0;
    box.z = -420;
    const faces = Array.from({ length: 6 }, (_, index) => {
      const face = new QuadObject(game, `inside_face_${index}`);
      face.box3dFaceIndex = index;
      face.spatial = { parentNodeId: box.name, relation: 'in' };
      return face;
    });
    const scene: any = {
      game,
      entities: [box, ...faces],
      camera: { x: 0, y: 0, zoom: 1 },
      box3dPerspective: 1,
    };

    box.syncFaces(scene);
    const visible = getVisibleBox3DFaces(scene);
    const fragments = buildBox3DRenderFragments(scene, visible);

    expect(faces.filter((face) => !face.box3dHidden)).toHaveLength(5);
    expect(visible).toHaveLength(5);
    expect(visible.filter((face) => face.fragmented)).toHaveLength(4);
    expect(
      fragments.every((fragment) =>
        fragment.projected.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      )
    ).toBe(true);
    expect(raycastBox3DFace(scene, 320, 180)?.box3dFaceIndex).toBe(4);
  });

  it('keeps outward winding separate from upright Quad texture corners', () => {
    const game: any = { editor: null };
    const box = new Box3DObject(game, 'box');
    box.rotationX = 0;
    box.rotationY = 0;
    const faces = Array.from({ length: 6 }, (_, index) => {
      const face = new QuadObject(game, `box_face_${index}`);
      face.box3dFaceIndex = index;
      face.spatial = { parentNodeId: 'box', relation: 'in' };
      return face;
    });
    box.syncFaces({
      entities: [box, ...faces],
      camera: { x: 0, y: 0, zoom: 1 },
      box3dPerspective: 0,
    });
    const world = box.getWorldVertices();
    const uvIndices = [
      [3, 2, 1, 0],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ];
    faces.forEach((face, index) =>
      expect(face.vertices.map(({ x, y }) => ({ x, y }))).toEqual(
        uvIndices[index].map((vertex) => ({ x: world[vertex].x, y: world[vertex].y }))
      )
    );
  });

  it('uses orthographic P=1 when perspective is zero', () => {
    const game: any = { editor: null };
    const box = new Box3DObject(game, 'box');
    const face = new QuadObject(game, 'box_face_0');
    face.box3dFaceIndex = 0;
    face.spatial = { parentNodeId: 'box', relation: 'in' };
    box.syncFaces({ entities: [box, face], camera: { x: 0, y: 0 }, box3dPerspective: 0 });
    expect(face.vertices.every((vertex) => vertex.p === 1)).toBe(true);
  });

  it('raycasts orthographic faces below the former fixed origin boundary', () => {
    const game: any = { editor: null, canvas: { width: 640, height: 360 } };
    const box = new Box3DObject(game, 'deep');
    box.rotationX = 0;
    box.rotationY = 0;
    box.z = -2_000_000_000;
    const face = new QuadObject(game, 'deep_face_2');
    face.box3dFaceIndex = 2;
    face.spatial = { parentNodeId: box.name, relation: 'in' };
    const scene: any = {
      game,
      entities: [box, face],
      camera: { x: 0, y: 0, zoom: 1 },
      box3dPerspective: 0,
    };
    box.syncFaces(scene);

    expect(raycastBox3DFace(scene, 320, 180)).toBe(face);
    expect(intersectBox3DFaceAtScreen(scene, face.box3dWorldVertices!, 320, 180)?.z).toBeCloseTo(
      -2_000_000_050
    );
  });

  it('moves the projected Box when Move Z changes', () => {
    const game: any = { editor: null };
    const box = new Box3DObject(game, 'box');
    const face = new QuadObject(game, 'box_face_0');
    face.box3dFaceIndex = 0;
    face.spatial = { parentNodeId: 'box', relation: 'in' };
    box.syncFaces({ entities: [box, face], camera: { x: 0, y: 0 }, box3dPerspective: 1 });
    const before = face.vertices.map((vertex) => vertex.p);
    box.z = 80;
    box.syncFaces({ entities: [box, face], camera: { x: 0, y: 0 }, box3dPerspective: 1 });
    expect(face.vertices.map((vertex) => vertex.p)).not.toEqual(before);
  });

  it('intersects a screen drag with the physical managed-face plane', () => {
    const game: any = { editor: null, canvas: { width: 640, height: 360 } };
    const box = new Box3DObject(game, 'box');
    box.rotationX = 0;
    box.rotationY = 0;
    const face = new QuadObject(game, 'box_face_2');
    face.box3dFaceIndex = 2;
    face.spatial = { parentNodeId: box.name, relation: 'in' };
    const scene: any = {
      game,
      entities: [box, face],
      camera: { x: 0, y: 0, zoom: 1 },
      box3dPerspective: 1,
    };
    box.syncFaces(scene);

    const hit = intersectBox3DFaceAtScreen(scene, face.box3dWorldVertices!, 320, 180);

    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(0);
    expect(hit!.y).toBeCloseTo(0);
    expect(hit!.z).toBeCloseTo(-50);
  });

  it('continues a face drag across its physical plane after the cursor leaves the face', () => {
    const game: any = { editor: null, canvas: { width: 640, height: 360 } };
    const scene: any = { game, camera: { x: 0, y: 0, zoom: 1 }, box3dPerspective: 1 };
    const vertices = [
      { x: -10, y: -10, z: 0 },
      { x: 10, y: -10, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: -10, y: 10, z: 0 },
    ];
    expect(intersectBox3DFaceAtScreen(scene, vertices, 500, 180)).toBeNull();
    expect(intersectBox3DFaceAtScreen(scene, vertices, 500, 180, false)).not.toBeNull();
  });

  it('projects touching vertices from separate Boxes to the same point', () => {
    const game: any = { editor: null };
    const lower = new Box3DObject(game, 'lower');
    lower.rotationX = 0;
    lower.rotationY = 0;
    const upper = new Box3DObject(game, 'upper');
    upper.rotationX = 0;
    upper.rotationY = 0;
    upper.y = -100;
    const lowerFace = new QuadObject(game, 'lower_face_2');
    lowerFace.box3dFaceIndex = 2;
    lowerFace.spatial = { parentNodeId: 'lower', relation: 'in' };
    const upperFace = new QuadObject(game, 'upper_face_2');
    upperFace.box3dFaceIndex = 2;
    upperFace.spatial = { parentNodeId: 'upper', relation: 'in' };
    const scene: any = {
      entities: [lower, upper, lowerFace, upperFace],
      camera: { x: 80, y: 40 },
      box3dPerspective: 1,
    };
    lower.syncFaces(scene);
    upper.syncFaces(scene);
    expect(upperFace.vertices[3]).toEqual(lowerFace.vertices[0]);
    expect(upperFace.vertices[2]).toEqual(lowerFace.vertices[1]);
  });

  it('makes rear vertices follow camera movement more slowly', () => {
    const cameraBefore = { x: 0, y: 0 },
      cameraAfter = { x: 120, y: 0 };
    const front = { x: 20, y: 0, z: -50 },
      rear = { x: 20, y: 0, z: 50 };
    const screenX = (point: typeof front, camera: typeof cameraBefore) =>
      projectBox3DPoint(point, camera, 1, 320).x - camera.x;
    const frontMove = screenX(front, cameraAfter) - screenX(front, cameraBefore);
    const rearMove = screenX(rear, cameraAfter) - screenX(rear, cameraBefore);
    expect(Math.abs(rearMove)).toBeLessThan(Math.abs(frontMove));
  });

  it('keeps a normal camera FOV when zooming out', () => {
    const screenShape = (zoom: number) => {
      const center = 250 / zoom;
      const focal = 640 / zoom;
      const project = (x: number, z: number) =>
        zoom * projectBox3DPoint({ x, y: 0, z }, { x: 0, y: 0 }, 1, focal).x;
      return {
        width: project(center + 50, -50) - project(center - 50, -50),
        depthTurn: project(center, -50) - project(center, 50),
      };
    };
    const normal = screenShape(1);
    const zoomedOut = screenShape(0.5);
    expect(normal.depthTurn / normal.width).toBeCloseTo(zoomedOut.depthTurn / zoomedOut.width, 1);
    expect(Math.abs(zoomedOut.depthTurn)).toBeLessThan(zoomedOut.width);
  });

  it('renders object motion and opposite camera motion identically', () => {
    const zoom = 0.5;
    const focal = 640 / zoom;
    const canvasX = (x: number, z: number, cameraX: number) =>
      zoom * (projectBox3DPoint({ x, y: 0, z }, { x: cameraX, y: 0 }, 1, focal).x - cameraX);
    expect(canvasX(-420, -50, 0)).toBeCloseTo(canvasX(0, -50, 420));
    expect(canvasX(-420, 50, 0)).toBeCloseTo(canvasX(0, 50, 420));
  });

  it('expands opaque fragment coverage without moving its center', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const expanded = expandPolygonForCoverage(points, 1);
    expect(expanded[0].x).toBeLessThan(0);
    expect(expanded[0].y).toBeLessThan(0);
    expect(expanded.reduce((sum, point) => sum + point.x, 0) / 4).toBeCloseTo(5);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(expanded).toEqual([
      { x: -1, y: -1 },
      { x: 11, y: -1 },
      { x: 11, y: 11 },
      { x: -1, y: 11 },
    ]);
  });

  it('preserves coverage on a skewed BSP edge away from a beveled corner', () => {
    const expanded = expandPolygonForCoverage(
      [
        { x: 0, y: 0 },
        { x: 100, y: 1 },
        { x: 1, y: 2 },
      ],
      1
    );
    expect(expanded[0].y).toBeLessThan(-0.9);
    expect(Math.hypot(expanded[2].x - 1, expanded[2].y - 2)).toBeLessThanOrEqual(4);
  });

  it('never turns a nearly flat projected face into an unbounded miter', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0.00001 },
      { x: 0, y: 1 },
    ];
    const expanded = expandPolygonForCoverage(points, 1);
    expect(
      expanded.every(
        (point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y) <= 4
      )
    ).toBe(true);
  });

  it('serializes perspective on Scene only and does not reapply Quad camera parallax', () => {
    const game: any = { editor: null };
    const scene = new Scene(game, 'test', 'Test');
    scene.box3dPerspective = 1.5;
    scene.box3dOcclusionMode = 'fast';
    scene.camera = { x: 80, y: 40, zoom: 1 };
    const box = new Box3DObject(game, 'box');
    box.occlusionMode = 'fast';
    const face = new QuadObject(game, 'box_face_0');
    face.box3dFaceIndex = 0;
    face.spatial = { parentNodeId: 'box', relation: 'in' };
    scene.entities.push(box as any, face);
    box.syncFaces(scene);
    expect(scene.toJSON().box3dPerspective).toBe(1.5);
    expect(scene.toJSON().box3dOcclusionMode).toBe('fast');
    expect(box.toJSON().occlusionMode).toBe('fast');
    expect(box.toJSON()).not.toHaveProperty('perspectiveAmount');
    expect(face.getVisualVertices()).toEqual(face.vertices.map(({ x, y }) => ({ x, y })));
  });

  it('splits intersecting visible faces and raycasts the nearest surface', () => {
    const game: any = { editor: null, canvas: { width: 640, height: 360 } };
    const entities: any[] = [];
    for (const [name, x, z, rotationY] of [
      ['a', -25, 0, 25],
      ['b', 25, 0, -25],
    ] as const) {
      const box = new Box3DObject(game, name);
      box.x = x;
      box.z = z;
      box.rotationY = rotationY;
      entities.push(box);
      for (let index = 0; index < 6; index++) {
        const face = new QuadObject(game, `${name}_face_${index}`);
        face.box3dFaceIndex = index;
        face.spatial = { parentNodeId: name, relation: 'in' };
        entities.push(face);
      }
    }
    const scene: any = { game, entities, camera: { x: 0, y: 0, zoom: 1 }, box3dPerspective: 1 };
    entities.filter((value) => value instanceof Box3DObject).forEach((box) => box.syncFaces(scene));
    const faces = getVisibleBox3DFaces(scene);
    const fragments = buildBox3DRenderFragments(scene, faces);
    expect(fragments.length).toBeGreaterThan(faces.length);
    expect(fragments.some((fragment) => fragment.fragmented)).toBe(true);
    expect(raycastBox3DFace(scene, 320, 180)).toBeInstanceOf(QuadObject);
  });

  it('uses whole-face depth sorting in fast occlusion mode', () => {
    const game: any = { editor: null, canvas: { width: 640, height: 360 } };
    const entities: any[] = [];
    for (const [name, x, rotationY] of [
      ['a', -25, 25],
      ['b', 25, -25],
    ] as const) {
      const box = new Box3DObject(game, name);
      box.x = x;
      box.rotationY = rotationY;
      entities.push(box);
      for (let index = 0; index < 6; index++) {
        const face = new QuadObject(game, `${name}_face_${index}`);
        face.box3dFaceIndex = index;
        face.spatial = { parentNodeId: name, relation: 'in' };
        entities.push(face);
      }
    }
    const scene: any = {
      game,
      entities,
      camera: { x: 0, y: 0, zoom: 1 },
      box3dPerspective: 1,
      box3dOcclusionMode: 'exact',
    };
    (entities.find((entity) => entity.name === 'b') as Box3DObject).occlusionMode = 'fast';
    entities.filter((value) => value instanceof Box3DObject).forEach((box) => box.syncFaces(scene));
    const faces = getVisibleBox3DFaces(scene);
    const fragments = buildBox3DRenderFragments(scene, faces);
    expect(fragments).toHaveLength(faces.length);
    expect(fragments.every((fragment) => !fragment.fragmented)).toBe(true);
    expect(buildBox3DRenderFragments(scene, faces)).toBe(fragments);
    const boxB = entities.find((entity) => entity.name === 'b') as Box3DObject;
    boxB.x += 10;
    boxB.syncFaces(scene);
    expect(buildBox3DRenderFragments(scene, getVisibleBox3DFaces(scene))).not.toBe(fragments);
  });

  it('retains separate fragment caches for static and surface-bound face sets', () => {
    const game: any = { editor: null, canvas: { width: 640, height: 360 } };
    const box = new Box3DObject(game, 'box');
    const faces = Array.from({ length: 6 }, (_, index) => {
      const face = new QuadObject(game, `box_face_${index}`);
      face.box3dFaceIndex = index;
      face.spatial = { parentNodeId: box.name, relation: 'in' };
      return face;
    });
    const scene: any = {
      game,
      entities: [box, ...faces],
      camera: { x: 0, y: 0, zoom: 1 },
      box3dPerspective: 1,
      box3dOcclusionMode: 'exact',
    };
    box.syncFaces(scene);
    const staticFaces = getVisibleBox3DFaces(scene);
    const surfaceFaces = [staticFaces[0]];
    const staticFragments = buildBox3DRenderFragments(scene, staticFaces);
    buildBox3DRenderFragments(scene, surfaceFaces);

    expect(buildBox3DRenderFragments(scene, staticFaces)).toBe(staticFragments);
  });

  it('uses an editable Cutter Box to open and restore a live hole', () => {
    const game: any = { editor: null, canvas: { width: 640, height: 360 } };
    const target = new Box3DObject(game, 'wall');
    target.rotationX = target.rotationY = target.rotationZ = 0;
    const cutter = new Box3DObject(game, 'window');
    cutter.rotationX = cutter.rotationY = cutter.rotationZ = 0;
    cutter.cutter = true;
    cutter.bottomWidth = cutter.topWidth = 40;
    cutter.height = 40;
    cutter.bottomDepth = cutter.topDepth = 200;
    const boxes = [target, cutter];
    const faces = boxes.flatMap((box) =>
      Array.from({ length: 6 }, (_, index) => {
        const face = new QuadObject(game, `${box.name}_face_${index}`);
        face.box3dFaceIndex = index;
        face.spatial = { parentNodeId: box.name, relation: 'in' };
        return face;
      })
    );
    const scene: any = {
      game,
      entities: [...boxes, ...faces],
      camera: { x: 0, y: 0, zoom: 1 },
      box3dPerspective: 1,
    };
    boxes.forEach((box) => box.syncFaces(scene));

    const cutFaces = getVisibleBox3DFaces(scene);
    expect(cutter.toJSON()).toHaveProperty('cutter', true);
    expect(cutFaces.filter((face) => face.quad.name === 'wall_face_2')).toHaveLength(4);
    expect(cutFaces.some((face) => face.boxId === cutter.name)).toBe(true);
    expect(raycastBox3DFace(scene, 320, 180)).toBeNull();

    cutter.x = 200;
    cutter.syncFaces(scene);
    expect(raycastBox3DFace(scene, 320, 180)?.name).toBe('wall_face_2');
  });

  it('uses the rendered fallback order for hit testing after the BSP fragment limit', () => {
    const game: any = { editor: null, canvas: { width: 640, height: 360 } };
    const box = new Box3DObject(game, 'crowded');
    box.rotationX = 0;
    box.rotationY = 0;
    const faces = Array.from({ length: 1201 }, (_, index) => {
      const face = new QuadObject(game, `crowded_face_${index}`);
      face.box3dFaceIndex = 2;
      face.spatial = { parentNodeId: box.name, relation: 'in' };
      return face;
    });
    const scene: any = {
      game,
      entities: [box, ...faces],
      camera: { x: 0, y: 0, zoom: 1 },
      box3dPerspective: 1,
    };
    box.syncFaces(scene);

    const fragments = buildBox3DRenderFragments(scene, getVisibleBox3DFaces(scene));

    expect(fragments.every((fragment) => fragment.depthFallback)).toBe(true);
    expect(fragments.at(-1)?.quad).toBe(faces.at(-1));
    expect(raycastBox3DFace(scene, 320, 180)).toBe(faces.at(-1));
  });

  it('keeps an unsplit face on the direct Quad render path', () => {
    const game: any = { editor: null };
    const box = new Box3DObject(game, 'box');
    const face = new QuadObject(game, 'box_face_0');
    face.box3dFaceIndex = 0;
    face.spatial = { parentNodeId: box.name, relation: 'in' };
    const scene: any = {
      entities: [box, face],
      camera: { x: 0, y: 0, zoom: 1 },
      box3dPerspective: 1,
    };
    box.syncFaces(scene);

    const fragments = buildBox3DRenderFragments(scene, getVisibleBox3DFaces(scene));

    expect(fragments).toHaveLength(1);
    expect(fragments[0].fragmented).toBe(false);
  });

  it('orders an attached Entity on the stored side of its face', () => {
    const game: any = { editor: null };
    const box = new Box3DObject(game, 'box');
    box.rotationX = 0;
    box.rotationY = 0;
    const face = new QuadObject(game, 'box_face_2');
    face.box3dFaceIndex = 2;
    face.spatial = { parentNodeId: 'box', relation: 'in' };
    const entity: any = { width: 20, height: 20, layer: 0, visible: true, disabled: false };
    const scene: any = {
      entities: [box, face, entity],
      camera: { x: 0, y: 0, zoom: 1 },
      box3dPerspective: 1,
    };
    box.syncFaces(scene);

    entity.__box3dSurfaceAnchor = createBox3DSurfaceAnchor(scene, face, entity, 0.5, 0.5, 'front');
    let fragments = buildBox3DRenderFragments(scene, [
      ...getVisibleBox3DFaces(scene, [face]),
      ...getBox3DAttachedEntityFaces(scene, [entity]),
    ]);
    expect(fragments.findIndex((fragment) => fragment.entity === entity)).toBeGreaterThan(
      fragments.findIndex((fragment) => fragment.quad === face && !fragment.entity)
    );

    entity.__box3dSurfaceAnchor = createBox3DSurfaceAnchor(scene, face, entity, 0.5, 0.5, 'back');
    fragments = buildBox3DRenderFragments(scene, [
      ...getVisibleBox3DFaces(scene, [face]),
      ...getBox3DAttachedEntityFaces(scene, [entity]),
    ]);
    expect(fragments.findIndex((fragment) => fragment.entity === entity)).toBeLessThan(
      fragments.findIndex((fragment) => fragment.quad === face && !fragment.entity)
    );
  });
});
