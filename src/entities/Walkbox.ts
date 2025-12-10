import { SceneObject } from './SceneObject';

export class Walkbox extends SceneObject {
    poly: { x: number, y: number }[];

    constructor(poly: { x: number, y: number }[], name: string = 'Walkbox') {
        super(name, 'Walkbox');
        this.poly = poly;
    }

    toJSON(): any {
        return {
            ...super.toJSON(),
            poly: this.poly
        };
    }
}
