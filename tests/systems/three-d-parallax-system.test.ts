import { describe, expect, it } from 'vitest';
import { QuadObject } from '../../src/entities/QuadObject';
import { ThreeDParallaxSystem } from '../../src/systems/ThreeDParallaxSystem';
import { toVisualPosition } from '../../src/utils/Parallax';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('ThreeDParallaxSystem', () => {
  it('applies surface parallax to Static objects without moving their visual position', () => {
    const fixture = createSceneFixture();
    fixture.scene.camera.x = 20;
    fixture.scene.camera.y = 40;

    const floor = new QuadObject(fixture.game, 'floor');
    floor.vertices = [
      { x: 0, y: 0, p: 0.5 },
      { x: 100, y: 0, p: 0.5 },
      { x: 100, y: 100, p: 1 },
      { x: 0, y: 100, p: 1 },
    ];
    fixture.scene.addEntity(floor);

    const prop = fixture.addEntity('prop');
    // Loaded legacy scenes deserialize Static objects with type `Entity`.
    prop.type = 'Entity';
    prop.x = 50;
    prop.y = 60;
    const initialVisual = toVisualPosition(
      { x: prop.x, y: prop.y },
      fixture.scene.camera,
      prop.parallax
    );

    ThreeDParallaxSystem.update(floor, { type: '3d-parallax' });

    expect(prop.parallax).toBeCloseTo(0.75, 6);
    expect(toVisualPosition({ x: prop.x, y: prop.y }, fixture.scene.camera, prop.parallax)).toEqual(
      initialVisual
    );
  });

  it('follows the same perspective-corrected grid point after camera movement', () => {
    const fixture = createSceneFixture();
    const floor = new QuadObject(fixture.game, 'perspective-floor');
    floor.vertices = [
      { x: 40, y: 0, p: 0.5 },
      { x: 60, y: 0, p: 0.5 },
      { x: 100, y: 100, p: 1 },
      { x: 0, y: 100, p: 1 },
    ];
    floor.perspective = true;
    floor.perspectiveAmount = 1;
    fixture.scene.addEntity(floor);

    const prop = fixture.addEntity('prop');
    const u = 0.35;
    const v = 0.45;
    const initialPoint = floor.getGridPointAt(u, v, true);
    prop.x = initialPoint.x;
    prop.y = initialPoint.y;
    ThreeDParallaxSystem.update(floor, { type: '3d-parallax' });

    fixture.scene.camera.x = 80;
    fixture.scene.camera.y = 30;
    ThreeDParallaxSystem.update(floor, { type: '3d-parallax' });

    const expected = floor.getGridPointAt(u, v, true);
    const visual = toVisualPosition({ x: prop.x, y: prop.y }, fixture.scene.camera, prop.parallax);
    expect(visual.x).toBeCloseTo(expected.x, 5);
    expect(visual.y).toBeCloseTo(expected.y, 5);
  });

  it('keeps an Actor route target visually fixed when surface P changes', () => {
    const fixture = createSceneFixture();
    fixture.scene.camera.y = 40;
    const floor = new QuadObject(fixture.game, 'floor');
    floor.vertices = [
      { x: 0, y: 0, p: 0.5 },
      { x: 100, y: 0, p: 0.5 },
      { x: 100, y: 100, p: 1 },
      { x: 0, y: 100, p: 1 },
    ];
    fixture.scene.addEntity(floor);
    const actor = fixture.addPlayer('Hero', 50, 60);
    actor.target = { x: 80, y: 80 };
    actor.route = [{ x: 80, y: 80 }];
    const oldTargetVisual = toVisualPosition(actor.target, fixture.scene.camera, actor.parallax);

    ThreeDParallaxSystem.update(floor, { type: '3d-parallax' });

    expect(actor.parallax).toBeCloseTo(0.75, 5);
    expect(actor.target!.x).toBe(80);
    expect(actor.target!.y).toBe(70);
    expect(toVisualPosition(actor.target!, fixture.scene.camera, actor.parallax)).toEqual(
      oldTargetVisual
    );
    expect(toVisualPosition(actor.route[0], fixture.scene.camera, actor.parallax)).toEqual(
      oldTargetVisual
    );
  });

  it('does not resolve an interior lower-edge point as the P=1 boundary', () => {
    const fixture = createSceneFixture();
    fixture.scene.camera.y = 100;
    const floor = new QuadObject(fixture.game, 'floor');
    floor.vertices = [
      { x: 42, y: 5, p: 0.5 },
      { x: 62, y: 6, p: 0.5 },
      { x: 82, y: 112.5, p: 1 },
      { x: -20, y: 113, p: 1 },
    ];
    floor.perspective = true;
    floor.perspectiveAmount = 1;
    fixture.scene.addEntity(floor);
    const actor = fixture.addPlayer('Hero', 40, 95);
    actor.speed = 1;
    for (let i = 0; i < 7; i++) {
      actor.y += 1;
      ThreeDParallaxSystem.update(floor, { type: '3d-parallax' });
    }

    const visual = toVisualPosition(
      { x: actor.x, y: actor.y },
      fixture.scene.camera,
      actor.parallax
    );
    expect(visual.y).toBeCloseTo(102, 3);
    expect(actor.parallax).toBeGreaterThan(0.97);
    expect(actor.parallax).toBeLessThan(0.99);
  });

  it('keeps an existing surface binding through a visual Quad inversion', () => {
    const fixture = createSceneFixture();
    const floor = new QuadObject(fixture.game, 'collapsed-floor');
    floor.vertices = [
      { x: 42.983, y: 3.99, p: 0.5 },
      { x: 63.983, y: 3.99, p: 0.5 },
      { x: 81.936, y: 112.546, p: 1 },
      { x: -20, y: 113, p: 1 },
    ];
    floor.components = [{ type: '3d-parallax' }];
    fixture.scene.addEntity(floor);

    const prop = fixture.addEntity('prop');
    const u = 0.5;
    const v = 0.3;
    const start = floor.getGridPointAt(u, v, true);
    prop.x = start.x;
    prop.y = start.y;
    ThreeDParallaxSystem.update(floor, { type: '3d-parallax' });

    // The Quad is a sliver here. Its inverse maps this very grid point to a
    // different (u,v), so the existing binding must take precedence.
    fixture.scene.camera.y = 218;
    ThreeDParallaxSystem.update(floor, { type: '3d-parallax' });

    const binding = (prop as any).__surfaceParallaxBinding;
    expect(binding.quadName).toBe(floor.name);
    expect(binding.u).toBeCloseTo(u, 6);
    expect(binding.v).toBeCloseTo(v, 6);
    expect(prop.parallax).toBeCloseTo(floor.getParallaxAtGrid(u, v), 6);
  });

  it('does not assign an unbound object to a surface solely because the camera crosses it', () => {
    const fixture = createSceneFixture();
    const floor = new QuadObject(fixture.game, 'floor');
    floor.vertices = [
      { x: -40, y: 0, p: 0.6 },
      { x: 75, y: 0, p: 0.6 },
      { x: 143, y: 74, p: 1 },
      { x: -110, y: 74, p: 1 },
    ];
    fixture.scene.addEntity(floor);

    const prop = fixture.addEntity('wall');
    prop.x = 19;
    prop.y = -1; // Deliberately just outside the authored surface.
    prop.parallax = 0.6;
    ThreeDParallaxSystem.update(floor, { type: '3d-parallax' });

    fixture.scene.camera.y = 190; // Visual top/bottom edges have crossed.
    ThreeDParallaxSystem.update(floor, { type: '3d-parallax' });

    expect((prop as any).__surfaceParallaxBinding).toBeUndefined();
    expect(prop.parallax).toBe(0.6);
    expect(prop.y).toBe(-1);

    prop.y = -0.5; // Explicit world movement may acquire the surface.
    ThreeDParallaxSystem.update(floor, { type: '3d-parallax' });
    expect((prop as any).__surfaceParallaxBinding).toMatchObject({ quadName: floor.name });
  });

  it('preserves initial binding for authored targets when a lower overlapping Quad updates before the top Quad', () => {
    const fixture = createSceneFixture();
    fixture.scene.camera.x = 0;
    fixture.scene.camera.y = 0;

    const lowerFloor = new QuadObject(fixture.game, 'lower-floor');
    lowerFloor.vertices = [
      { x: 0, y: 0, p: 0.5 },
      { x: 100, y: 0, p: 0.5 },
      { x: 100, y: 100, p: 1 },
      { x: 0, y: 100, p: 1 },
    ];
    lowerFloor.components = [{ type: '3d-parallax' }];
    fixture.scene.addEntity(lowerFloor);

    const topFloor = new QuadObject(fixture.game, 'top-floor');
    topFloor.vertices = [
      { x: 0, y: 0, p: 0.8 },
      { x: 100, y: 0, p: 0.8 },
      { x: 100, y: 100, p: 1.2 },
      { x: 0, y: 100, p: 1.2 },
    ];
    topFloor.components = [{ type: '3d-parallax' }];
    fixture.scene.addEntity(topFloor);

    const prop = fixture.addEntity('prop');
    prop.type = 'Static';
    prop.x = 50;
    prop.y = 50;

    // Lower quad updates first in entity order
    ThreeDParallaxSystem.update(lowerFloor, { type: '3d-parallax' });
    expect((prop as any).__surfaceParallaxBinding).toBeUndefined();

    // Top quad updates second
    ThreeDParallaxSystem.update(topFloor, { type: '3d-parallax' });

    const binding = (prop as any).__surfaceParallaxBinding;
    expect(binding).toBeDefined();
    expect(binding.quadName).toBe('top-floor');
    expect(prop.parallax).toBeCloseTo(topFloor.getParallaxAt(50, 50, true), 6);
    expect((prop as any).__surfaceParallaxObservation).toEqual({
      worldX: prop.x,
      worldY: prop.y,
    });
  });

  it('applies parent 3d-parallax to opted-in child Quad vertices and tracks camera motion', () => {
    const fixture = createSceneFixture();
    fixture.scene.camera.x = 20;
    fixture.scene.camera.y = 40;

    const parent = new QuadObject(fixture.game, 'parent-floor');
    parent.vertices = [
      { x: 0, y: 0, p: 0.5 },
      { x: 100, y: 0, p: 0.5 },
      { x: 100, y: 100, p: 1 },
      { x: 0, y: 100, p: 1 },
    ];
    parent.components = [{ type: '3d-parallax' }];
    fixture.scene.addEntity(parent);

    const child = new QuadObject(fixture.game, 'child-quad');
    child.receive3DParallax = true;
    child.spatial = { parentNodeId: parent.name, relation: 'in' };
    child.vertices = [
      { x: 25, y: 25, p: 1 },
      { x: 75, y: 25, p: 1 },
      { x: 75, y: 75, p: 1 },
      { x: 25, y: 75, p: 1 },
    ];
    fixture.scene.addEntity(child);

    const initialVisual = child.vertices.map((vertex) =>
      toVisualPosition(
        { x: vertex.x, y: vertex.y },
        fixture.scene.camera,
        (vertex.p ?? 1) * (child.parallax ?? 1)
      )
    );

    ThreeDParallaxSystem.update(parent, { type: '3d-parallax' });

    const bindings = (child as any).__surfaceParallaxVertexBindings;
    expect(Object.keys(bindings)).toHaveLength(4);
    expect(child.vertices[0].p).toBeCloseTo(parent.getParallaxAt(25, 25, true), 5);
    child.vertices.forEach((vertex, index) => {
      expect(
        toVisualPosition(
          { x: vertex.x, y: vertex.y },
          fixture.scene.camera,
          (vertex.p ?? 1) * (child.parallax ?? 1)
        )
      ).toEqual({
        x: expect.closeTo(initialVisual[index].x),
        y: expect.closeTo(initialVisual[index].y),
      });
    });

    const stableVertices = child.vertices.map((vertex) => ({ ...vertex }));
    const stableBindings = JSON.parse(JSON.stringify(bindings));
    for (let frame = 0; frame < 10; frame++) {
      ThreeDParallaxSystem.update(parent, { type: '3d-parallax' });
    }
    expect(child.vertices).toEqual(stableVertices);
    expect(bindings).toEqual(stableBindings);

    fixture.scene.camera.x = 90;
    fixture.scene.camera.y = 70;
    ThreeDParallaxSystem.update(parent, { type: '3d-parallax' });

    child.vertices.forEach((vertex, index) => {
      const binding = bindings[index];
      const surfacePoint = parent.getGridPointAt(binding.u, binding.v, true);
      const visualPoint = toVisualPosition(
        { x: vertex.x, y: vertex.y },
        fixture.scene.camera,
        (vertex.p ?? 1) * (child.parallax ?? 1)
      );
      expect(visualPoint.x).toBeCloseTo(surfacePoint.x, 5);
      expect(visualPoint.y).toBeCloseTo(surfacePoint.y, 5);
    });
  });

  it('does not apply parent 3d-parallax to a child Quad without opt-in', () => {
    const fixture = createSceneFixture();
    const parent = new QuadObject(fixture.game, 'parent-floor');
    parent.vertices = [
      { x: 0, y: 0, p: 0.5 },
      { x: 100, y: 0, p: 0.5 },
      { x: 100, y: 100, p: 1 },
      { x: 0, y: 100, p: 1 },
    ];
    parent.components = [{ type: '3d-parallax' }];
    fixture.scene.addEntity(parent);

    const child = new QuadObject(fixture.game, 'child-quad');
    child.spatial = { parentNodeId: parent.name, relation: 'in' };
    child.vertices[0] = { x: 25, y: 25, p: 1 };
    fixture.scene.addEntity(child);

    ThreeDParallaxSystem.update(parent, { type: '3d-parallax' });

    expect(child.vertices[0].p).toBe(1);
    expect((child as any).__surfaceParallaxVertexBindings).toBeUndefined();
  });
});
