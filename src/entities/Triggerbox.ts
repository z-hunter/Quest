import { SceneObject } from './SceneObject';

export class Triggerbox extends SceneObject {
    poly: { x: number, y: number }[];
    script: string;

    constructor(poly: { x: number, y: number }[], name: string = 'Triggerbox', script: string = '') {
        super(name, 'Triggerbox');
        this.poly = poly;
        this.script = script;
    }

    toJSON(): any {
        return {
            ...super.toJSON(),
            poly: this.poly,
            script: this.script
        };
    }
}
