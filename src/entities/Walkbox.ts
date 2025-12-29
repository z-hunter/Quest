import { PolygonObject } from './PolygonObject';

export class Walkbox extends PolygonObject {
    mode: 'Invert' | 'Add' | 'Subtract';

    constructor(poly: { x: number, y: number }[], name: string = 'Walkbox') {
        super(poly, name, 'Walkbox');
        this.mode = 'Invert';
    }

    toJSON(): any {
        return {
            ...super.toJSON(),
            mode: this.mode
        };
    }
}
