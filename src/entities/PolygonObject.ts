import { SceneObject } from './SceneObject';
import { Geometry } from '../utils/Geometry';

export class PolygonObject extends SceneObject {
    poly: { x: number, y: number }[];

    /**
     * List of properties to be serialized to/from JSON.
     */
    static override SERIALIZABLE_PROPS: string[] = [
        ...SceneObject.SERIALIZABLE_PROPS,
        'poly'
    ];

    constructor(poly: { x: number, y: number }[], name: string, type: string) {
        super(name, type);
        this.poly = poly;
    }

    toJSON(): any {
        return super.toJSON();
    }

    hitTest(x: number, y: number): boolean {
        // Import Geometry if not already available? It is not imported in this file.
        // Needs import { Geometry } from '../utils/Geometry';
        // But we can't easily add import with replace_file_content if top of file not shown.
        // Wait, I should check imports first.
        return Geometry.isPointInPolygon({ x, y }, this.poly);
    }
}
