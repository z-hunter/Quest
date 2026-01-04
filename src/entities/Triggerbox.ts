import { PolygonObject } from './PolygonObject';
import type { AnyTriggerComponent } from './TriggerComponents';

export class Triggerbox extends PolygonObject {
    script: string;
    components: AnyTriggerComponent[];

    constructor(poly: { x: number, y: number }[], name: string = 'Triggerbox', script: string = '') {
        super(poly, name, 'Triggerbox');
        this.script = script;
        this.components = [];
    }

    toJSON(): any {
        return {
            ...super.toJSON(),
            script: this.script,
            components: this.components
        };
    }
}
