import { PolygonObject } from './PolygonObject';

export class Triggerbox extends PolygonObject {
    script: string;

    constructor(poly: { x: number, y: number }[], name: string = 'Triggerbox', script: string = '') {
        super(poly, name, 'Triggerbox');
        this.script = script;
    }

    toJSON(): any {
        return {
            ...super.toJSON(),
            script: this.script
        };
    }
}
