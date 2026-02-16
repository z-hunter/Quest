export interface Camera2D {
    x: number;
    y: number;
}

export interface Point2D {
    x: number;
    y: number;
}

export function normalizeParallax(p?: number): number {
    return p ?? 1.0;
}

export function toVisualPosition(
    world: Point2D,
    camera: Camera2D,
    parallax?: number,
    offset: Point2D = { x: 0, y: 0 }
): Point2D {
    const p = normalizeParallax(parallax);
    return {
        x: world.x - camera.x * (p - 1.0) + offset.x,
        y: world.y - camera.y * (p - 1.0) + offset.y
    };
}

export function toWorldPosition(
    visual: Point2D,
    camera: Camera2D,
    parallax?: number,
    offset: Point2D = { x: 0, y: 0 }
): Point2D {
    const p = normalizeParallax(parallax);
    return {
        x: visual.x + camera.x * (p - 1.0) - offset.x,
        y: visual.y + camera.y * (p - 1.0) - offset.y
    };
}

export function toVisualScalar(worldValue: number, cameraValue: number, parallax?: number): number {
    const p = normalizeParallax(parallax);
    return worldValue - cameraValue * (p - 1.0);
}
