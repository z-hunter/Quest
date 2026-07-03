import { SceneObject } from './SceneObject';
import { Geometry } from '../utils/Geometry';

export class PolygonObject extends SceneObject {
  poly: { x: number; y: number }[];

  /**
   * List of properties to be serialized to/from JSON.
   */
  static override SERIALIZABLE_PROPS: string[] = [...SceneObject.SERIALIZABLE_PROPS, 'poly'];

  constructor(poly: { x: number; y: number }[], name: string, type: string) {
    super(name, type);
    this.poly = poly;
  }

  toJSON(): any {
    return super.toJSON();
  }

  hitTest(x: number, y: number): boolean {
    const scene = this.scene;
    if (!scene || !this.poly || this.poly.length < 3) {
      return Geometry.isPointInPolygon({ x, y }, this.poly);
    }

    const camX = scene.camera.x;
    const camY = scene.camera.y;
    const p = this.parallax !== undefined ? this.parallax : 1.0;

    // Project polygon to visual space at P=1.0 equivalent
    const projectedPoly = this.poly.map((v) => ({
      x: v.x - camX * (p - 1.0),
      y: v.y - camY * (p - 1.0),
    }));

    return Geometry.isPointInPolygon({ x, y }, projectedPoly);
  }
}
