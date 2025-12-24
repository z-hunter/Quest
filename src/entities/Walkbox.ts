import { SceneObject } from './SceneObject';

export class Walkbox extends SceneObject {
    poly: { x: number, y: number }[];
    mode: 'Invert' | 'Add' | 'Subtract';

    constructor(poly: { x: number, y: number }[], name: string = 'Walkbox') {
        super(name, 'Walkbox');
        this.poly = poly;
        this.mode = 'Invert';
    }

    toJSON(): any {
        return {
            ...super.toJSON(),
            poly: this.poly,
            mode: this.mode
        };
    }
}
