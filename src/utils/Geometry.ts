export class Geometry {
    static isPointInPolygon(point: { x: number, y: number }, polygon: { x: number, y: number }[]): boolean {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;

            const intersect = ((yi > point.y) !== (yj > point.y))
                && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    static rectIntersectsRect(r1: { x: number, y: number, w: number, h: number }, r2: { x: number, y: number, w: number, h: number }): boolean {
        return r1.x < r2.x + r2.w &&
            r1.x + r1.w > r2.x &&
            r1.y < r2.y + r2.h &&
            r1.y + r1.h > r2.y;
    }

    /**
     * Checks if a Rect intersects a Polygon (Used for 'Subtract' holes - any overlap is bad)
     * Overlap occurs if:
     * 1. Any point of Rect is inside Polygon
     * 2. Any point of Polygon is inside Rect
     * 3. Any edge of Rect intersects any edge of Polygon
     */
    static rectIntersectsPolygon(rect: { x: number, y: number, w: number, h: number }, poly: { x: number, y: number }[]): boolean {
        // 1. Check if any rect corner is inside polygon
        const corners = [
            { x: rect.x, y: rect.y },
            { x: rect.x + rect.w, y: rect.y },
            { x: rect.x + rect.w, y: rect.y + rect.h },
            { x: rect.x, y: rect.y + rect.h }
        ];

        for (const p of corners) {
            if (Geometry.isPointInPolygon(p, poly)) return true;
        }

        // 2. Check if any polygon point is inside rect
        for (const p of poly) {
            if (p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h) return true;
        }

        // 3. Edge intersection (Line Segment Intersection)
        // Simplified: If we passed 1 & 2, basic cases are covered. 
        // Complex case: A thin polygon creating a cross shape through a rect without points inside?
        // Yes, need edge checks for full robustness.

        for (let i = 0; i < 4; i++) {
            const p1 = corners[i];
            const p2 = corners[(i + 1) % 4];

            for (let j = 0; j < poly.length; j++) {
                const p3 = poly[j];
                const p4 = poly[(j + 1) % poly.length];

                if (Geometry.lineIntersectsLine(p1, p2, p3, p4)) return true;
            }
        }

        return false;
    }

    /**
     * Checks if a Rect is FULLY INSIDE a Polygon (Used for 'Invert' - must stay within bounds)
     */
    static rectInsidePolygon(rect: { x: number, y: number, w: number, h: number }, poly: { x: number, y: number }[]): boolean {
        const corners = [
            { x: rect.x, y: rect.y },
            { x: rect.x + rect.w, y: rect.y },
            { x: rect.x + rect.w, y: rect.y + rect.h },
            { x: rect.x, y: rect.y + rect.h }
        ];

        // All corners must be inside
        for (const p of corners) {
            if (!Geometry.isPointInPolygon(p, poly)) return false;
        }
        return true;
    }

    static lineIntersectsLine(p1: { x: number, y: number }, p2: { x: number, y: number }, p3: { x: number, y: number }, p4: { x: number, y: number }): boolean {
        const det = (p2.x - p1.x) * (p4.y - p3.y) - (p4.x - p3.x) * (p2.y - p1.y);
        if (det === 0) {
            return false;
        } else {
            const lambda = ((p4.y - p3.y) * (p4.x - p1.x) + (p3.x - p4.x) * (p4.y - p1.y)) / det;
            const gamma = ((p1.y - p2.y) * (p4.x - p1.x) + (p2.x - p1.x) * (p4.y - p1.y)) / det;
            return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);
        }
    }
}
