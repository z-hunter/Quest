import { QuadObject } from '../entities/QuadObject';

export interface BackfaceComponent {
    type: 'Backface';
    vertexA?: number;
    vertexB?: number;
    axis?: 'x' | 'y';
    op?: '>' | '<';
    targetId?: string;
    cullingType?: 'layer' | 'render';
}

export class BackfaceSystem {

    static update(quad: QuadObject, bf: BackfaceComponent) {
        // @ts-ignore
        const scene = quad.scene;
        if (!scene) return;

        // Props: vertexA (0-3), vertexB (0-3), axis ('x'|'y'), op ('>'|'<'), targetId (opt)
        const idxA = bf.vertexA || 0;
        const idxB = bf.vertexB || 1;
        const axis = bf.axis || 'x'; // 'x' or 'y'
        const op = bf.op || '>'; // '>' or '<'

        const vA = quad.vertices[idxA];
        const vB = quad.vertices[idxB];

        if (!vA || !vB) return;

        const pA = vA.p !== undefined ? vA.p : 1.0;
        const pB = vB.p !== undefined ? vB.p : 1.0;

        // @ts-ignore
        const camX = scene.camera.x;
        // @ts-ignore
        const camY = scene.camera.y;

        // Calculate Visual Coordinate
        const valA = (axis === 'x' ? vA.x : vA.y) - (axis === 'x' ? camX : camY) * pA;
        const valB = (axis === 'x' ? vB.x : vB.y) - (axis === 'x' ? camX : camY) * pB;

        let match = false;
        if (op === '>') match = valA > valB;
        else if (op === '<') match = valA < valB;

        // Resolve Targets (Unified)
        let targets: any[] = [];
        if (!bf.targetId) {
            targets.push(quad);
        } else {
            // @ts-ignore
            if (scene.resolveTarget) {
                // @ts-ignore
                targets = scene.resolveTarget(bf.targetId);
            } else {
                // @ts-ignore
                const found = scene.entities.find((e: any) => e.name === bf.targetId.trim());
                if (found) targets.push(found);
            }
        }

        if (targets.length > 0) {
            const cullingType = bf.cullingType || 'layer';

            targets.forEach(target => {
                if (match) {
                    if (cullingType === 'render') {
                        target.visible = false;
                        // @ts-ignore
                        target.renderLayer = undefined;
                    } else {
                        // Layer Mode
                        // @ts-ignore
                        target.renderLayer = target.layer - 1;
                        target.visible = true;
                    }
                } else {
                    target.visible = true;
                    // @ts-ignore
                    target.renderLayer = undefined;
                }
            });
        }
    }
}
