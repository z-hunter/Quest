
import { Scene } from '../scene/Scene';
import { Entity } from '../entities/Entity';
import type { IGame } from '../core/IGame';

export class SceneRenderer {
    private blurCanvas: HTMLCanvasElement | null = null;
    game: IGame | null = null;

    constructor(game: IGame) {
        this.game = game;
    }

    render(ctx: CanvasRenderingContext2D, scene: Scene): void {
        const { camera, entities, activeSubscene, subsceneEntities } = scene;

        // Sorting Logic moved from Scene.render
        // Sort by Y (Depth) and Parallax
        const sortedEntities = [...entities].sort((a, b) => {
            if (a.layer !== b.layer) {
                return a.layer - b.layer;
            }

            // Custom "Ignore Sorting" Logic via Quad properties or similar
            // We replicate the logic from Scene.ts
            let yA = a.y;
            let yB = b.y;
            let ignoreA = false;
            let ignoreB = false;

            // Accessing Internal Quad Props (unsafe cast but needed for logic preservation)
            if (a.type === 'Quad') {
                const qA = a as any;
                if (qA.sortMode === 'ignore') {
                    ignoreA = true;
                } else {
                    yA = qA.y;
                    let sortP = qA.parallax || 1.0;
                    if (qA.sortMode === 'v0' && qA.vertices[0]) { yA = qA.vertices[0].y; sortP = qA.vertices[0].p; }
                    else if (qA.sortMode === 'v1' && qA.vertices[1]) { yA = qA.vertices[1].y; sortP = qA.vertices[1].p; }
                    else if (qA.sortMode === 'v2' && qA.vertices[2]) { yA = qA.vertices[2].y; sortP = qA.vertices[2].p; }
                    else if (qA.sortMode === 'v3' && qA.vertices[3]) { yA = qA.vertices[3].y; sortP = qA.vertices[3].p; }

                    // Visual Offset Correction for Sorting
                    // yA = BaseY - CamY * (P - 1) ... wait, we don't have CamY here easily without scene ref
                    // In Scene.ts it used 'scene.camera.y'

                    const camY = camera.y;
                    yA = yA - camY * (sortP - 1.0);
                }
            }

            if (b.type === 'Quad') {
                const qB = b as any;
                if (qB.sortMode === 'ignore') {
                    ignoreB = true;
                } else {
                    yB = qB.y;
                    let sortP = qB.parallax || 1.0;
                    if (qB.sortMode === 'v0' && qB.vertices[0]) { yB = qB.vertices[0].y; sortP = qB.vertices[0].p; }
                    else if (qB.sortMode === 'v1' && qB.vertices[1]) { yB = qB.vertices[1].y; sortP = qB.vertices[1].p; }
                    else if (qB.sortMode === 'v2' && qB.vertices[2]) { yB = qB.vertices[2].y; sortP = qB.vertices[2].p; }
                    else if (qB.sortMode === 'v3' && qB.vertices[3]) { yB = qB.vertices[3].y; sortP = qB.vertices[3].p; }

                    const camY = camera.y;
                    yB = yB - camY * (sortP - 1.0);
                }
            }

            if (ignoreA && ignoreB) return 0;
            if (ignoreA) return -1;
            if (ignoreB) return 1;

            return yA - yB;
        });

        const halfW = ctx.canvas.width / 2;
        const halfH = ctx.canvas.height / 2;

        // SPLIT RENDER: Background/Normal vs Subscene
        const subsceneLayer: Entity[] = [];
        const normalLayer: Entity[] = [];

        sortedEntities.forEach(entity => {
            const gID = entity.groupID ? entity.groupID.trim() : null;
            const target = activeSubscene ? activeSubscene.trim() : null;

            if (target && (gID === target || subsceneEntities.has(entity))) {
                subsceneLayer.push(entity);
            } else {
                normalLayer.push(entity);
            }
        });

        // 1. Render Normal Layer
        this.renderLayer(ctx, normalLayer, scene, halfW, halfH);

        // 2. Dimmer / Blur (if active)
        if (activeSubscene) {
            this.renderBlurEffect(ctx);

            // Optional Dimmer Overlay
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.restore();
        }

        // 3. Render Subscene Layer
        this.renderLayer(ctx, subsceneLayer, scene, halfW, halfH);

        // 4. Debug Rendering (Walkboxes/Triggers)
        if (this.game && this.game.editor && this.game.editor.enabled) {
            const selected = this.game.editor.selectedObject;

            // Walkboxes - Render Full Complex Logic
            if (activeSubscene || (selected && selected.type === 'Walkbox')) {
                // We show all walkboxes if a walkbox is selected, OR if we want to debug the scene?
                // Original logic was "Show if Walkbox selected". But filtering was "activeBoxes".
                // Let's stick to showing if a Walkbox is selected to avoid clutter.
                if (selected && selected.type === 'Walkbox') {
                    this.renderWalkboxes(ctx, scene);
                }
            }

            // Triggerboxes - Show only if a Triggerbox is selected
            if (selected && selected.type === 'Triggerbox' && scene.triggerboxes) {
                scene.triggerboxes.forEach(tb => {
                    this.renderDebugPolygon(ctx, tb, scene, 'rgba(255, 0, 0, 0.3)', 'rgba(255, 0, 0, 0.8)');
                });
            }
        }
    }

    private walkboxCanvas: HTMLCanvasElement | null = null;

    private renderWalkboxes(ctx: CanvasRenderingContext2D, scene: Scene): void {
        if (!scene.walkbox) return;
        const activeBoxes = scene.walkbox.filter(wb => !wb.disabled);
        if (activeBoxes.length === 0) return;

        if (!this.walkboxCanvas) {
            this.walkboxCanvas = document.createElement('canvas');
        }
        if (this.walkboxCanvas.width !== ctx.canvas.width || this.walkboxCanvas.height !== ctx.canvas.height) {
            this.walkboxCanvas.width = ctx.canvas.width;
            this.walkboxCanvas.height = ctx.canvas.height;
        }

        const wbCtx = this.walkboxCanvas.getContext('2d');
        if (!wbCtx) return;

        wbCtx.clearRect(0, 0, this.walkboxCanvas.width, this.walkboxCanvas.height);

        const halfW = ctx.canvas.width / 2;
        const halfH = ctx.canvas.height / 2;

        wbCtx.save();
        wbCtx.translate(halfW, halfH);
        wbCtx.scale(scene.camera.zoom, scene.camera.zoom);
        wbCtx.translate(-scene.camera.x, -scene.camera.y);

        const inverts = activeBoxes.filter(wb => !wb.mode || wb.mode === 'Invert');
        const adds = activeBoxes.filter(wb => wb.mode === 'Add');
        const subtracts = activeBoxes.filter(wb => wb.mode === 'Subtract');

        // 1. Inverts (Green, Even-Odd)
        wbCtx.fillStyle = '#00FF00';
        if (inverts.length > 0) {
            wbCtx.beginPath();
            inverts.forEach(wb => {
                if (wb.poly.length > 0) {
                    wbCtx.moveTo(wb.poly[0].x, wb.poly[0].y);
                    for (let i = 1; i < wb.poly.length; i++) wbCtx.lineTo(wb.poly[i].x, wb.poly[i].y);
                    wbCtx.closePath();
                }
            });
            wbCtx.fill('evenodd');
        }

        // 2. Adds
        if (adds.length > 0) {
            wbCtx.beginPath();
            adds.forEach(wb => {
                if (wb.poly.length > 0) {
                    wbCtx.moveTo(wb.poly[0].x, wb.poly[0].y);
                    for (let i = 1; i < wb.poly.length; i++) wbCtx.lineTo(wb.poly[i].x, wb.poly[i].y);
                    wbCtx.closePath();
                }
            });
            wbCtx.fill();
        }

        // 3. Subtracts
        if (subtracts.length > 0) {
            wbCtx.globalCompositeOperation = 'destination-out';
            wbCtx.beginPath();
            subtracts.forEach(wb => {
                if (wb.poly.length > 0) {
                    wbCtx.moveTo(wb.poly[0].x, wb.poly[0].y);
                    for (let i = 1; i < wb.poly.length; i++) wbCtx.lineTo(wb.poly[i].x, wb.poly[i].y);
                    wbCtx.closePath();
                }
            });
            wbCtx.fill();
            wbCtx.globalCompositeOperation = 'source-over';
        }

        wbCtx.restore();

        // 4. Draw to Main Screen
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0); // Identity to match offscreen 1:1
        ctx.globalAlpha = 0.2;
        ctx.drawImage(this.walkboxCanvas, 0, 0);
        ctx.globalAlpha = 1.0;

        // 5. Outlines
        ctx.translate(halfW, halfH);
        ctx.scale(scene.camera.zoom, scene.camera.zoom);
        ctx.translate(-scene.camera.x, -scene.camera.y);
        ctx.lineWidth = 2; // / scene.camera.zoom;

        // Helper for outlines
        const drawOutline = (boxes: any[], color: string) => {
            ctx.strokeStyle = color;
            ctx.beginPath();
            boxes.forEach(wb => {
                if (wb.poly.length > 0) {
                    ctx.moveTo(wb.poly[0].x, wb.poly[0].y);
                    for (let i = 1; i < wb.poly.length; i++) ctx.lineTo(wb.poly[i].x, wb.poly[i].y);
                    ctx.closePath();
                }
            });
            ctx.stroke();
        };

        drawOutline(inverts, '#00FF00');
        drawOutline(adds, '#00FF00'); // Blue? No, standard is Green for walkboxes in this engine usually.
        drawOutline(subtracts, '#FF0000'); // Red for subtract logic? 

        ctx.restore();

    }

    private renderLayer(ctx: CanvasRenderingContext2D, entities: Entity[], scene: Scene, halfW: number, halfH: number) {
        entities.forEach(entity => {
            if (entity.disabled) return;
            if (entity.visible === false) return;

            const p = entity.parallax !== undefined ? entity.parallax : 1.0;
            ctx.save();

            // Center Pivot Transform
            ctx.translate(halfW, halfH);
            ctx.scale(scene.camera.zoom, scene.camera.zoom);
            ctx.translate(-scene.camera.x * p, -scene.camera.y * p);

            // DEBUG TRACE (Optional, simplified)
            // if (Math.random() < 0.005 && entity.name.includes('Quad')) console.log(`Draw ${entity.name}`);

            entity.render(ctx);
            ctx.restore();
        });
    }

    private renderBlurEffect(ctx: CanvasRenderingContext2D) {
        if (!this.blurCanvas) {
            this.blurCanvas = document.createElement('canvas');
        }

        const downsample = 0.1;
        const targetW = Math.floor(ctx.canvas.width * downsample);
        const targetH = Math.floor(ctx.canvas.height * downsample);

        if (this.blurCanvas.width !== targetW || this.blurCanvas.height !== targetH) {
            this.blurCanvas.width = targetW;
            this.blurCanvas.height = targetH;
        }

        const bCtx = this.blurCanvas.getContext('2d');
        if (bCtx) {
            bCtx.imageSmoothingEnabled = true;
            bCtx.drawImage(ctx.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height, 0, 0, targetW, targetH);

            ctx.save();
            ctx.globalAlpha = 1.0;
            ctx.imageSmoothingEnabled = true;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(this.blurCanvas, 0, 0, targetW, targetH, 0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.restore();
        }
    }

    private renderDebugPolygon(ctx: CanvasRenderingContext2D, obj: any, scene: Scene, fill: string, stroke: string) {
        if (!obj.poly || obj.poly.length < 3) return;

        const halfW = ctx.canvas.width / 2;
        const halfH = ctx.canvas.height / 2;
        const p = 1.0; // Debug shapes usually 1.0 parallax? Walkboxes are on floor, maybe 1.0.

        ctx.save();
        ctx.translate(halfW, halfH);
        ctx.scale(scene.camera.zoom, scene.camera.zoom);
        ctx.translate(-scene.camera.x * p, -scene.camera.y * p);

        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;

        ctx.beginPath();
        obj.poly.forEach((pt: any, i: number) => {
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();
    }
}
