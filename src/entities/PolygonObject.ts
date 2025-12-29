import { SceneObject } from './SceneObject';

export class PolygonObject extends SceneObject {
    poly: { x: number, y: number }[];

    constructor(poly: { x: number, y: number }[], name: string, type: string) {
        super(name, type);
        this.poly = poly;
    }

    toJSON(): any {
        return {
            ...super.toJSON(),
            poly: this.poly
        };
    }
}
