import { Scene } from '../scene/Scene';
import { Entity } from '../entities/Entity';
import type { IGame } from '../core/IGame';
import { toVisualScalar } from '../utils/Parallax';
import {
  Box3DObject,
  buildBox3DRenderFragments,
  getBox3DAttachedEntityFaces,
  getVisibleBox3DFaces,
  type Box3DFragment,
} from '../entities/Box3DObject';
import { expandPolygonForCoverage, QuadObject } from '../entities/QuadObject';

export interface Box3DLayerDiagnostics {
  layer: number;
  cached: boolean;
  fallbackReason: string | null;
  visibleFacesCount: number;
  bspFragmentsCount: number;
  staticBitmapCommandsCount: number;
  surfaceEntityCommandsCount: number;
  commandSequence: string[];
  commandSequenceSummary: string;
}

export interface Box3DRenderDiagnostics {
  bitmapCacheHits: number;
  bitmapCacheMisses: number;
  totalVisibleFaces: number;
  totalBspFragments: number;
  totalStaticBitmapCommands: number;
  totalSurfaceEntityCommands: number;
  layers: Box3DLayerDiagnostics[];
}

export class SceneRenderer {
  private blurCanvas: HTMLCanvasElement | null = null;
  private quadBlurCanvas: HTMLCanvasElement | null = null;
  private box3dBitmapCache = new Map<
    number,
    { key: string; commands: Array<{ canvas?: HTMLCanvasElement; fragment?: Box3DFragment }> }
  >();
  private box3dHits = 0;
  private box3dMisses = 0;
  private box3dLayerDiagnostics = new Map<number, Box3DLayerDiagnostics>();
  game: IGame | null = null;

  constructor(game: IGame) {
    this.game = game;
  }

  getBox3DDiagnostics(): Box3DRenderDiagnostics {
    const layers = Array.from(this.box3dLayerDiagnostics.values()).sort(
      (a, b) => a.layer - b.layer
    );
    let totalVisibleFaces = 0;
    let totalBspFragments = 0;
    let totalStaticBitmapCommands = 0;
    let totalSurfaceEntityCommands = 0;

    for (const l of layers) {
      totalVisibleFaces += l.visibleFacesCount;
      totalBspFragments += l.bspFragmentsCount;
      totalStaticBitmapCommands += l.staticBitmapCommandsCount;
      totalSurfaceEntityCommands += l.surfaceEntityCommandsCount;
    }

    return {
      bitmapCacheHits: this.box3dHits,
      bitmapCacheMisses: this.box3dMisses,
      totalVisibleFaces,
      totalBspFragments,
      totalStaticBitmapCommands,
      totalSurfaceEntityCommands,
      layers,
    };
  }

  render(ctx: CanvasRenderingContext2D, scene: Scene): void {
    this.box3dLayerDiagnostics.clear();
    (scene.entities as any[])
      .filter((entity) => entity instanceof Box3DObject)
      .forEach((box: Box3DObject) => box.syncFaces(scene));
    const { camera, entities, activeSubscene, subsceneEntities, pickupAnimations } = scene;
    const inventoryPreviewActive = !!this.game?.getInventoryPreviewEntity();
    const focusOverlayActive = !!activeSubscene || inventoryPreviewActive;

    // Sorting Logic moved from Scene.render
    // Sort by Y (Depth) and Parallax
    // Sorting Logic moved from Scene.render
    // Sort by Y (Depth) and Parallax
    // FIX: Sort by VISUAL Y (Screen Space Y) to ensure consistent depth regardless of Parallax
    const sortedEntities = [...entities]
      .filter((entity: any) => !entity.box3dHidden)
      .sort((a, b) => compareEntitiesForRender(a, b, camera));

    const halfW = ctx.canvas.width / 2;
    const halfH = ctx.canvas.height / 2;

    // SPLIT RENDER: Background/Normal vs Subscene
    const subsceneLayer: Entity[] = [];
    const normalLayer: Entity[] = [];

    sortedEntities.forEach((entity) => {
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
    if (focusOverlayActive) {
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

    // 3.5. Render transient pickup effects above scene objects.
    if (pickupAnimations.length > 0) {
      this.renderLayer(
        ctx,
        pickupAnimations.map((anim) => anim.entity),
        scene,
        halfW,
        halfH
      );
    }

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
        scene.triggerboxes.forEach((tb) => {
          const fill = tb.disabled ? 'transparent' : 'rgba(255, 0, 0, 0.3)';
          const stroke = tb.disabled ? 'rgba(255, 0, 0, 0.4)' : 'rgba(255, 0, 0, 0.8)';
          this.renderDebugPolygon(ctx, tb, scene, fill, stroke);
        });
      }
    }
  }

  private walkboxCanvas: HTMLCanvasElement | null = null;

  private renderWalkboxes(ctx: CanvasRenderingContext2D, scene: Scene): void {
    if (!scene.walkbox) return;
    const activeBoxes = scene.walkbox.filter((wb) => !wb.disabled);
    if (activeBoxes.length === 0) return;

    if (!this.walkboxCanvas) {
      this.walkboxCanvas = document.createElement('canvas');
    }
    if (
      this.walkboxCanvas.width !== ctx.canvas.width ||
      this.walkboxCanvas.height !== ctx.canvas.height
    ) {
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

    const inverts = activeBoxes.filter((wb) => !wb.mode || wb.mode === 'Invert');
    const adds = activeBoxes.filter((wb) => wb.mode === 'Add');
    const subtracts = activeBoxes.filter((wb) => wb.mode === 'Subtract');

    // 1. Inverts (Green, Even-Odd)
    wbCtx.fillStyle = '#00FF00';
    if (inverts.length > 0) {
      wbCtx.beginPath();
      inverts.forEach((wb) => {
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
      adds.forEach((wb) => {
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
      subtracts.forEach((wb) => {
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
      boxes.forEach((wb) => {
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

  private renderLayer(
    ctx: CanvasRenderingContext2D,
    entities: Entity[],
    scene: Scene,
    halfW: number,
    halfH: number
  ) {
    const getLayer = (entity: any) => entity.__box3dSurfaceAnchor?.quad.layer ?? entity.layer ?? 0;
    const layers = [...new Set(entities.map(getLayer))].sort((a, b) => a - b);
    for (const layer of layers) {
      const layerEntities = entities.filter((entity) => getLayer(entity) === layer);
      const flatEntities = layerEntities.filter(
        (entity: any) => !entity.box3dWorldVertices && !entity.__box3dSurfaceAnchor
      );
      for (let index = 0; index < flatEntities.length; ) {
        const entity = flatEntities[index];
        const batchKey = this.getQuadBlurBatchKey(entity);
        if (!batchKey) {
          this.renderEntity(ctx, entity, scene, halfW, halfH);
          index++;
          continue;
        }

        const batch = [entity as QuadObject];
        index++;
        while (
          index < flatEntities.length &&
          this.getQuadBlurBatchKey(flatEntities[index]) === batchKey
        ) {
          batch.push(flatEntities[index] as QuadObject);
          index++;
        }
        this.renderQuadBlurBatch(ctx, batch, scene, halfW, halfH);
      }

      const faces = [...getVisibleBox3DFaces(scene, layerEntities)];
      const attachedFaces = getBox3DAttachedEntityFaces(scene, layerEntities);
      if (this.renderCachedBox3DLayer(ctx, scene, layer, faces, attachedFaces, halfW, halfH)) {
        continue;
      }
      for (const fragment of buildBox3DRenderFragments(scene, [...faces, ...attachedFaces]))
        this.renderBox3DFragment(ctx, fragment, scene, halfW, halfH);
    }
  }

  private renderCachedBox3DLayer(
    ctx: CanvasRenderingContext2D,
    scene: Scene,
    layer: number,
    staticFaces: any[],
    attachedFaces: any[],
    halfW: number,
    halfH: number
  ): boolean {
    const fragments = buildBox3DRenderFragments(scene, [...staticFaces, ...attachedFaces]);
    const bspFragmentsCount = fragments.length;
    const visibleFacesCount = staticFaces.length + attachedFaces.length;

    let fallbackReason: string | null = null;
    if (!staticFaces.length) {
      fallbackReason = 'no static faces';
    } else if (typeof document === 'undefined') {
      fallbackReason = 'unavailable canvas';
    } else if (staticFaces.some((face) => face.quad.blendMode !== 'source-over')) {
      fallbackReason = 'unsupported blend mode';
    }

    if (fallbackReason !== null) {
      const commandSequence = fragments.map((f) => f.entity?.name || f.quad?.name || 'fragment');
      this.box3dLayerDiagnostics.set(layer, {
        layer,
        cached: false,
        fallbackReason,
        visibleFacesCount,
        bspFragmentsCount,
        staticBitmapCommandsCount: 0,
        surfaceEntityCommandsCount: fragments.filter((f) => f.entity).length,
        commandSequence,
        commandSequenceSummary: commandSequence.join(' → '),
      });
      return false;
    }

    const key = this.getBox3DBitmapCacheKey(scene, fragments);
    let cached = this.box3dBitmapCache.get(layer);
    const isHit =
      cached &&
      cached.key === key &&
      !cached.commands.some(
        (command) =>
          command.canvas &&
          (command.canvas.width !== ctx.canvas.width || command.canvas.height !== ctx.canvas.height)
      );

    if (isHit) {
      this.box3dHits++;
    } else {
      this.box3dMisses++;
      const commands: Array<{ canvas?: HTMLCanvasElement; fragment?: Box3DFragment }> = [];
      let staticFragments: Box3DFragment[] = [];
      const flushStaticFragments = () => {
        if (!staticFragments.length) return true;
        const canvas = document.createElement('canvas');
        canvas.width = ctx.canvas.width;
        canvas.height = ctx.canvas.height;
        const staticCtx = canvas.getContext('2d');
        if (!staticCtx) return false;
        for (const fragment of staticFragments)
          this.renderBox3DFragment(staticCtx, fragment, scene, halfW, halfH);
        commands.push({ canvas });
        staticFragments = [];
        return true;
      };
      for (const fragment of fragments) {
        if (!fragment.entity) {
          staticFragments.push(fragment);
          continue;
        }
        if (!flushStaticFragments()) {
          this.box3dLayerDiagnostics.set(layer, {
            layer,
            cached: false,
            fallbackReason: 'unavailable canvas',
            visibleFacesCount,
            bspFragmentsCount,
            staticBitmapCommandsCount: 0,
            surfaceEntityCommandsCount: fragments.filter((f) => f.entity).length,
            commandSequence: fragments.map((f) => f.entity?.name || f.quad?.name || 'fragment'),
            commandSequenceSummary: fragments
              .map((f) => f.entity?.name || f.quad?.name || 'fragment')
              .join(' → '),
          });
          return false;
        }
        commands.push({ fragment });
      }
      if (!flushStaticFragments()) {
        this.box3dLayerDiagnostics.set(layer, {
          layer,
          cached: false,
          fallbackReason: 'unavailable canvas',
          visibleFacesCount,
          bspFragmentsCount,
          staticBitmapCommandsCount: 0,
          surfaceEntityCommandsCount: fragments.filter((f) => f.entity).length,
          commandSequence: fragments.map((f) => f.entity?.name || f.quad?.name || 'fragment'),
          commandSequenceSummary: fragments
            .map((f) => f.entity?.name || f.quad?.name || 'fragment')
            .join(' → '),
        });
        return false;
      }
      cached = { key, commands };
      this.box3dBitmapCache.set(layer, cached);
    }

    const commandSequence = cached!.commands.map((c) =>
      c.canvas ? 'bitmap' : c.fragment?.entity?.name || 'entity'
    );

    this.box3dLayerDiagnostics.set(layer, {
      layer,
      cached: true,
      fallbackReason: null,
      visibleFacesCount,
      bspFragmentsCount,
      staticBitmapCommandsCount: cached!.commands.filter((c) => c.canvas).length,
      surfaceEntityCommandsCount: cached!.commands.filter((c) => c.fragment?.entity).length,
      commandSequence,
      commandSequenceSummary: commandSequence.join(' → '),
    });

    for (const command of cached!.commands) {
      if (command.canvas) ctx.drawImage(command.canvas, 0, 0);
      else if (command.fragment)
        this.renderBox3DFragment(ctx, command.fragment, scene, halfW, halfH);
    }
    return true;
  }

  private getBox3DBitmapCacheKey(scene: Scene, fragments: Box3DFragment[]): string {
    const camera = scene.camera;
    return [
      camera.x,
      camera.y,
      camera.zoom,
      scene.box3dPerspective,
      scene.box3dOcclusionMode,
      ...fragments.map((fragment) => {
        const quad = fragment.quad;
        return [
          fragment.entity?.name || '',
          quad.name,
          quad.spriteName,
          quad.image?.complete,
          quad.image?.naturalWidth,
          quad.color,
          quad.opacity,
          quad.blur,
          quad.brightness,
          quad.saturation,
          quad.contrast,
          quad.hueShift,
          quad.filled,
          quad.isGrid,
          quad.gridLinesX,
          quad.gridLinesY,
          quad.lineWidth,
          quad.gridColor,
          quad.checkerboard,
          quad.secondColor,
          quad.textureMode,
          quad.tileScaleX,
          quad.tileScaleY,
          ...fragment.vertices.flatMap((vertex) => [vertex.x, vertex.y, vertex.z]),
        ].join(',');
      }),
    ].join('|');
  }

  private renderBox3DFragment(
    ctx: CanvasRenderingContext2D,
    fragment: Box3DFragment,
    scene: Scene,
    halfW: number,
    halfH: number
  ): void {
    const entity = fragment.entity || fragment.quad;
    ctx.save();
    ctx.translate(halfW, halfH);
    ctx.scale(scene.camera.zoom, scene.camera.zoom);
    ctx.translate(-scene.camera.x, -scene.camera.y);
    if (fragment.fragmented || fragment.entity) {
      const clipPoints =
        !fragment.entity &&
        entity.opacity >= 1 &&
        entity.blur <= 0 &&
        entity.blendMode === 'source-over'
          ? expandPolygonForCoverage(fragment.projected, 1.25 / scene.camera.zoom)
          : fragment.projected;
      ctx.beginPath();
      clipPoints.forEach((point, index) =>
        index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)
      );
      ctx.closePath();
      ctx.clip();
    }
    if (fragment.entity) {
      const p = fragment.entity.parallax !== undefined ? fragment.entity.parallax : 1;
      ctx.translate(scene.camera.x * (1 - p), scene.camera.y * (1 - p));
    }
    entity.render(ctx);
    ctx.restore();
  }

  private getQuadBlurBatchKey(entity: Entity): string | null {
    if (
      !(entity instanceof QuadObject) ||
      entity.disabled ||
      entity.visible === false ||
      entity.blur <= 0 ||
      entity.blendMode !== 'screen' ||
      entity.brightness !== 1 ||
      entity.saturation !== 1 ||
      entity.contrast !== 1 ||
      entity.hueShift !== 0
    ) {
      return null;
    }
    return `${entity.blur}:${entity.opacity}`;
  }

  private renderEntity(
    ctx: CanvasRenderingContext2D,
    entity: Entity,
    scene: Scene,
    halfW: number,
    halfH: number,
    quadOptions?: { skipFilters: boolean; opacity: number; blendMode: GlobalCompositeOperation }
  ): void {
    if (entity.disabled || (entity as any).box3dHidden || entity.visible === false) return;
    const p = entity.parallax !== undefined ? entity.parallax : 1;
    ctx.save();
    ctx.translate(halfW, halfH);
    ctx.scale(scene.camera.zoom, scene.camera.zoom);
    ctx.translate(-scene.camera.x * p, -scene.camera.y * p);
    if (entity instanceof QuadObject && quadOptions) entity.render(ctx, quadOptions);
    else entity.render(ctx);
    ctx.restore();
  }

  private renderQuadBlurBatch(
    ctx: CanvasRenderingContext2D,
    quads: QuadObject[],
    scene: Scene,
    halfW: number,
    halfH: number
  ): void {
    if (!this.quadBlurCanvas) this.quadBlurCanvas = document.createElement('canvas');
    if (
      this.quadBlurCanvas.width !== ctx.canvas.width ||
      this.quadBlurCanvas.height !== ctx.canvas.height
    ) {
      this.quadBlurCanvas.width = ctx.canvas.width;
      this.quadBlurCanvas.height = ctx.canvas.height;
    }
    const batchCtx = this.quadBlurCanvas.getContext('2d');
    if (!batchCtx) {
      for (const quad of quads) this.renderEntity(ctx, quad, scene, halfW, halfH);
      return;
    }

    batchCtx.setTransform(1, 0, 0, 1, 0, 0);
    batchCtx.clearRect(0, 0, this.quadBlurCanvas.width, this.quadBlurCanvas.height);
    for (const quad of quads) {
      this.renderEntity(batchCtx, quad, scene, halfW, halfH, {
        skipFilters: true,
        opacity: 1,
        blendMode: 'source-over',
      });
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = quads[0].opacity;
    ctx.globalCompositeOperation = 'screen';
    ctx.filter = `blur(${quads[0].blur * scene.camera.zoom}px)`;
    ctx.drawImage(this.quadBlurCanvas, 0, 0);
    ctx.restore();
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
      ctx.drawImage(
        this.blurCanvas,
        0,
        0,
        targetW,
        targetH,
        0,
        0,
        ctx.canvas.width,
        ctx.canvas.height
      );
      ctx.restore();
    }
  }

  private renderDebugPolygon(
    ctx: CanvasRenderingContext2D,
    obj: any,
    scene: Scene,
    fill: string,
    stroke: string
  ) {
    if (!obj.poly || obj.poly.length < 3) return;

    const halfW = ctx.canvas.width / 2;
    const halfH = ctx.canvas.height / 2;
    const p = (obj as any).parallax !== undefined ? (obj as any).parallax : 1.0;

    ctx.save();
    ctx.translate(halfW, halfH);
    ctx.scale(scene.camera.zoom, scene.camera.zoom);
    ctx.translate(-scene.camera.x * p, -scene.camera.y * p);

    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = obj?.disabled ? 1 : 2;

    ctx.beginPath();
    obj.poly.forEach((pt: any, i: number) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.closePath();
    if (fill !== 'transparent') {
      ctx.fill();
    }
    ctx.stroke();

    ctx.restore();
  }
}

/**
 * Returns an entity's Y-ordering anchor in the visual P=1 coordinate space.
 * `null` means a Quad explicitly opted out of depth sorting.
 */
export function getEntityRenderSortY(entity: Entity, camera: { y: number }): number | null {
  let y = entity.y;
  let parallax = entity.parallax !== undefined ? entity.parallax : 1.0;

  if ((entity as any).type === 'Quad') {
    const quad = entity as any;
    if (quad.sortMode === 'ignore') return null;

    const vertexIndex =
      quad.sortMode === 'v0'
        ? 0
        : quad.sortMode === 'v1'
          ? 1
          : quad.sortMode === 'v2'
            ? 2
            : quad.sortMode === 'v3'
              ? 3
              : undefined;
    const vertex =
      vertexIndex !== undefined
        ? (quad.getEffectiveVertices?.() || quad.vertices)[vertexIndex]
        : null;
    if (vertex) {
      y = vertex.y;
      const quadParallax = quad.parallax !== undefined ? quad.parallax : 1.0;
      // Quad vertices render with their local P relative to the Quad's global
      // parallax layer, so depth sorting must use the same effective P.
      parallax = (vertex.p !== undefined ? vertex.p : 1.0) * quadParallax;
    }
  }

  return toVisualScalar(y, camera.y, parallax);
}

function usesManualDepthSort(entity: Entity): boolean {
  return (entity as any).type !== 'Quad' && (entity as any).depthSortMode === 'manual';
}

function usesParallaxDepthSort(entity: Entity): boolean {
  return (
    ((entity as any).type === 'Quad' && (entity as any).sortMode === 'parallax') ||
    ((entity as any).type !== 'Quad' && (entity as any).depthSortMode === 'parallax')
  );
}

function getEntityDepthParallax(entity: Entity): number {
  const parallax = entity.parallax !== undefined ? entity.parallax : 1;
  return Number.isFinite(parallax) ? parallax : 1;
}

export function compareEntitiesForRender(a: Entity, b: Entity, camera: { y: number }): number {
  if (a.layer !== b.layer) return a.layer - b.layer;

  // Box3D faces are a painter's algorithm subset: positive Z is farther, so
  // it must be painted first inside the authored Layer.
  const aBoxDepth = (a as any).box3dDepth;
  const bBoxDepth = (b as any).box3dDepth;
  if (
    Number.isFinite(aBoxDepth) &&
    Number.isFinite(bBoxDepth) &&
    Math.abs(aBoxDepth - bBoxDepth) > 0.000001
  ) {
    return bBoxDepth - aBoxDepth;
  }

  // Manual means Layer is the only authored ordering criterion. Returning zero
  // preserves scene order through the stable render sort.
  if (usesManualDepthSort(a) || usesManualDepthSort(b)) return 0;

  // A parallax-sorted object defines depth independently of screen Y. Lower P
  // is farther away and renders first; higher P is closer and renders over it.
  if (usesParallaxDepthSort(a) || usesParallaxDepthSort(b)) {
    const parallaxDelta = getEntityDepthParallax(a) - getEntityDepthParallax(b);
    if (Math.abs(parallaxDelta) > 0.000001) return parallaxDelta;
  }

  const aSortY = getEntityRenderSortY(a, camera);
  const bSortY = getEntityRenderSortY(b, camera);
  if (aSortY === null && bSortY === null) return 0;
  if (aSortY === null) return -1;
  if (bSortY === null) return 1;
  return aSortY - bSortY;
}
