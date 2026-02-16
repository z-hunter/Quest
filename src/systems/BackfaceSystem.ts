import { QuadObject } from '../entities/QuadObject';
import { toVisualScalar } from '../utils/Parallax';
import type { SceneSystemContext } from './types';

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
        const scene = quad.scene as SceneSystemContext | null;
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

        const camX = scene.camera.x;
        const camY = scene.camera.y;

        // Calculate Visual Coordinate
        const valA = axis === 'x' ? toVisualScalar(vA.x, camX, pA) : toVisualScalar(vA.y, camY, pA);
        const valB = axis === 'x' ? toVisualScalar(vB.x, camX, pB) : toVisualScalar(vB.y, camY, pB);

        let match = false;
        if (op === '>') match = valA > valB;
        else if (op === '<') match = valA < valB;

        // Resolve Targets (Unified)
        let targets: Array<QuadObject | { visible?: boolean; layer?: number; renderLayer?: number }> = [];
        if (!bf.targetId) {
            targets.push(quad);
        } else {
            targets = scene.resolveTarget(bf.targetId) as Array<QuadObject | { visible?: boolean; layer?: number; renderLayer?: number }>;
        }

        if (targets.length > 0) {
            const cullingType = bf.cullingType || 'layer';

            targets.forEach(target => {
                if (match) {
                    if (cullingType === 'render') {
                        target.visible = false;
                        (target as any).renderLayer = undefined;
                    } else {
                        // Layer Mode
                        (target as any).renderLayer = (target.layer || 0) - 1;
                        target.visible = true;
                    }
                } else {
                    target.visible = true;
                    (target as any).renderLayer = undefined;
                }
            });
        }
    }
}
