import { Animator } from '../core/Animator';
import type { IGame } from '../core/IGame';
import { SceneObject } from './SceneObject';
import { Theme } from '../utils/Theme';
import type { SpatialPlacement } from '../scene/spatialTypes';

export interface EntityData {
  type: string;
  name: string;
  groupID?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  baseWidth?: number; // Added
  baseHeight?: number; // Added
  colliderWidth?: number; // Added: Collision Box Width
  colliderHeight?: number; // Added: Collision Box Height
  spriteName: string | null;
  color: string;
  scale: number;
  modelScale?: number; // User defined scale
  layer: number;
  parallax?: number;
  ignoreScaling?: boolean;
  isPlayer?: boolean;
  speed?: number;
  direction?: string;
  state?: string;
  animationSpeed?: number;
  locked?: boolean;
  disabled?: boolean;
  customName?: string; // Display Name for Parser/UI
  components?: any[];
  interactions?: Record<string, string>;
  visible?: boolean;
  opacity?: number; // Added
  blendMode?: string; // Added
  blur?: number; // Added
  spatial?: SpatialPlacement;
}

export class Entity extends SceneObject {
  private _x: number = 0;
  get x(): number {
    return this._x;
  }
  set x(val: number) {
    if (this._x === val) return;
    this._x = val;
    if (this.game.editor && this.game.editor.enabled) {
      this.game.editor.selectionManager.notifyObjectChanged(this);
    }
  }

  private _y: number = 0;
  get y(): number {
    return this._y;
  }
  set y(val: number) {
    if (this._y === val) return;
    this._y = val;
    if (this.game.editor && this.game.editor.enabled) {
      this.game.editor.selectionManager.notifyObjectChanged(this);
    }
  }

  // Smart Properties: Width/Height are derived from Base * Scale
  get width(): number {
    return this.baseWidth * this.scale;
  }
  set width(value: number) {
    const s = this.scale !== 0 ? this.scale : 1;
    this.baseWidth = value / s;
  }

  get height(): number {
    return this.baseHeight * this.scale;
  }
  set height(value: number) {
    const s = this.scale !== 0 ? this.scale : 1;
    this.baseHeight = value / s;
  }

  // name: string; // Inherited from SceneObject
  description: string;
  interactions: Record<string, string>; // Maps VERB -> ScriptID
  isTakeable: boolean;
  color: string;
  visible: boolean;
  spriteName: string | null;
  image: HTMLImageElement | null;
  scale: number;
  modelScale: number;
  // layer: number; // Inherited
  baseWidth: number;
  baseHeight: number;
  colliderWidth: number;
  colliderHeight: number;
  animator: Animator | null;
  flipX: boolean;
  scene: any; // Reference to the scene this entity belongs to

  private _parallax: number = 1.0;
  get parallax(): number {
    return this._parallax;
  }
  set parallax(val: number) {
    if (this._parallax === val) return;
    this._parallax = val;
    if (this.game.editor && this.game.editor.enabled) {
      this.game.editor.selectionManager.notifyObjectChanged(this);
    }
  }
  ignoreScaling: boolean;
  // locked: boolean; // Inherited from SceneObject
  // readonly type: string = 'Static'; // Inherited

  private loadingRefCount: number = 0;

  get isLoading(): boolean {
    return this.loadingRefCount > 0;
  }

  startLoading() {
    this.loadingRefCount++;
  }

  // Visual Properties
  opacity: number = 1.0;
  blendMode: GlobalCompositeOperation = 'source-over';
  blur: number = 0;

  endLoading() {
    if (this.loadingRefCount > 0) this.loadingRefCount--;
  }

  // Layer needs accessors too since it's common
  // Note: Layer is on SceneObject base, but usually safe to override or we should update SceneObject?
  // SceneObject defines: layer: number;
  // To override as accessor, we need to change SceneObject OR just use defineProperty in constructor?
  // Actually typescript allows override if compatible.
  // But to keep it simple, let's start with x, y, parallax.
  // If we need layer reactive, we should move it to SceneObject accessor or override here.
  // Let's stick to x,y,parallax,width,height for now.

  animationSpeed: number; // Added
  game: IGame;

  /**
   * List of properties to be serialized to/from JSON.
   * Extends SceneObject.SERIALIZABLE_PROPS.
   */
  static override SERIALIZABLE_PROPS: string[] = [
    ...SceneObject.SERIALIZABLE_PROPS,
    'x',
    'y',
    'width',
    'height',
    'baseWidth',
    'baseHeight',
    'colliderWidth',
    'colliderHeight',
    'spriteName',
    'color',
    'scale',
    'modelScale',
    'parallax',
    'ignoreScaling',
    'animationSpeed',
    'opacity',
    'blendMode',
    'blur',
  ];

  constructor(
    game: IGame,
    x: number,
    y: number,
    width: number = 30,
    height: number = 30,
    name: string = 'Entity'
  ) {
    super(name, 'Static');
    this.game = game;
    this.x = x;
    this.y = y;

    // Initialize defaults BEFORE setting width/height (which now rely on scale)
    this.scale = 1.0;
    this.baseWidth = width;
    this.baseHeight = height;

    // this.width = width; // No longer needed directly if base set above, but setter works too
    // this.name = name; // Super handles it

    this.description = 'You see nothing special.';
    this.interactions = {};
    this.isTakeable = false;

    this.color = '#AAAAAA'; // Default Neutral Gray
    this.visible = true;
    this.spriteName = null;
    this.image = null;
    this.modelScale = 1.0;
    this.opacity = 1.0;
    // this.layer = 0; // Inherited
    this._parallax = 1.0; // 1.0 = normal move, 0.5 = half speed (far), 0.0 = fixed
    this.ignoreScaling = false;
    this.animationSpeed = 150; // Default 150ms
    // this.locked = false; // Inherited

    // this.baseWidth = this.width; // Handled above
    // this.baseHeight = this.height; // Handled above
    this.colliderWidth = 0;
    this.colliderHeight = 0;
    this.animator = null;
    this.flipX = false;
    this.scene = null;
    this.loadingRefCount = 0;
  }

  setSprite(filename: string, keepSize: boolean = false): void {
    // Auto-detect loading state if not explicitly set
    if (this.isLoading) keepSize = true;

    // Delegate to AssetLoader
    // Note: AssetLoader handles extension and path resolution

    // Update spriteName immediately so other systems (SceneManager) know what we are loading
    this.spriteName = filename;

    // Capture current dimensions target if we need to preserve them

    // Capture current dimensions target if we need to preserve them

    this.game.assets
      .loadSprite(filename)
      .then((data) => {
        const { json, image } = data;

        // Check if the request is still valid (Basic race check - though AssetLoader handles some concurrency,
        // we still need to check if *this* entity changed its mind)
        // However, since we don't store "pendingSpriteName", we assume latest is winner?
        // Or we should update spriteName immediately?
        // The original code set this.spriteName = filename at start.
        this.spriteName = filename; // Ensure consistency

        // 1. Dimensions
        const newBaseWidth = json.width;
        const newBaseHeight = json.height;

        // 2. Animator
        const newAnimator = new Animator(this);
        newAnimator.frameDuration = this.animationSpeed;

        const frames = [];
        for (let i = 0; i < (json.frames || 1); i++) {
          frames.push({
            x: json.x,
            y: json.y + i * json.height,
            w: json.width,
            h: json.height,
          });
        }
        newAnimator.addAnimation('default', frames, true);
        newAnimator.play('default');

        // 3. Apply
        // console.log(`[Entity] Applying sprite: ${filename} | keepSize: ${keepSize}`);

        if (keepSize) {
          // Preserve existing visual dimensions
        } else {
          this.baseWidth = newBaseWidth;
          this.baseHeight = newBaseHeight;
          // Force immediate update - No longer needed, getters handle it
          // this.width = this.baseWidth * this.scale;
          // this.height = this.baseHeight * this.scale;
        }

        this.image = image;
        this.animator = newAnimator;
      })
      .catch((err) => {
        console.error(`[Entity] Sprite load error for ${filename}:`, err);
      });
  }

  update(deltaTime: number): void {
    // Dynamic Depth Scaling
    let depthFactor = 1.0;

    if (!this.ignoreScaling) {
      // Resolve scene
      const scene =
        this.scene ||
        (this.game && this.game.sceneManager ? this.game.sceneManager.currentScene : null);

      if (scene && scene.scaling && scene.scaling.enabled) {
        // Use Visual Y for scaling to prevent flickering when 3d-parallax adjusts World Y
        // Visual Y is the apparent position on screen (relative to camera center/origin logic, but scaling uses World Y relative to Horizon)
        // Actually, 'getScaling(y)' expects a Y value that corresponds to "Distance from camera/screen plane" in a pseudo-3D way.
        // In this engine, Y is "Distance into the scene" (higher Y is closer to front).
        // When Parallax moves the object, its World Y changes to keep it visually stable.
        // If we use World Y, the scale changes because the object "physically" moves.
        // If we use Visual Y (where it looks to be), we are checking "where corresponds this visual row in the depth map?".

        let checkY = this.y;
        if (scene.camera && this.parallax !== 1.0) {
          checkY = this.y - scene.camera.y * (this.parallax - 1.0);
        }

        depthFactor = scene.getScaling(checkY);
      }
    }

    // Final Scale = User Model Scale * Depth Factor
    this.scale = this.modelScale * depthFactor;

    if (this.animator) {
      this.animator.update(deltaTime);
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.visible) return;

    // Save Context State
    ctx.save();

    // Apply Visual Properties
    if (this.opacity < 1.0) ctx.globalAlpha = this.opacity;
    if (this.blendMode !== 'source-over') ctx.globalCompositeOperation = this.blendMode;
    if (this.blur > 0) ctx.filter = `blur(${this.blur}px)`;

    // Viewport Culling
    if (this.scene && this.scene.camera && ctx.canvas) {
      const cam = this.scene.camera;
      const zoom = cam.zoom;
      // Parallax P
      const p = this.parallax !== undefined ? this.parallax : 1.0;

      // Viewport in World Space for this Parallax Layer
      // Center is (CamX * P, CamY * P)
      // Dimensions are Canvas / Zoom
      const vHW = ctx.canvas.width / 2 / zoom;
      const vHH = ctx.canvas.height / 2 / zoom;

      const cX = cam.x * p;
      const cY = cam.y * p;

      const vL = cX - vHW;
      const vR = cX + vHW;
      const vT = cY - vHH;
      const vB = cY + vHH;

      // Entity Bounds
      // Drawn at x - w/2, y - h
      const halfW = this.width / 2;
      const eL = this.x - halfW;
      const eR = this.x + halfW;
      const eT = this.y - this.height;
      const eB = this.y;

      // Safety Padding (Shadows, Particles, etc)
      const pad = 100;

      // Check Disjoint
      if (eR + pad < vL || eL - pad > vR || eB + pad < vT || eT - pad > vB) {
        ctx.restore();
        return;
      }
    }

    if (this.animator && this.animator.getCurrentFrame()) {
      const frame = this.animator.getCurrentFrame();
      if (frame && this.image && this.image.complete) {
        if (this.flipX) {
          ctx.save();
          ctx.scale(-1, 1);
          ctx.drawImage(
            this.image,
            frame.x,
            frame.y,
            frame.w,
            frame.h,
            -(this.x + this.width / 2),
            this.y - this.height,
            this.width,
            this.height
          );
          ctx.restore();
        } else {
          ctx.drawImage(
            this.image,
            frame.x,
            frame.y,
            frame.w,
            frame.h,
            this.x - this.width / 2,
            this.y - this.height,
            this.width,
            this.height
          );
        }
      } else {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x - this.width / 2, this.y - this.height, this.width, this.height);
      }
    } else if (this.image && this.image.complete && this.image.naturalWidth !== 0) {
      ctx.drawImage(
        this.image,
        this.x - this.width / 2,
        this.y - this.height,
        this.width,
        this.height
      );
    } else {
      ctx.fillStyle = this.color;
      ctx.fillRect(this.x - this.width / 2, this.y - this.height, this.width, this.height);

      if (this.game.editor && this.game.editor.enabled) {
        ctx.fillStyle = Theme.mainColor;
        ctx.fillRect(this.x - 2, this.y - 2, 4, 4);
      }
    }

    // Restore Context State (resets alpha, blend, filter)
    ctx.restore();

    // Draw Collider if active AND Editor is enabled
    if (
      this.game.editor &&
      this.game.editor.enabled &&
      this.colliderWidth > 0 &&
      this.colliderHeight > 0
    ) {
      ctx.strokeStyle = Theme.mainColor;
      ctx.lineWidth = 2; // Make it visible
      ctx.strokeRect(
        this.x - this.colliderWidth / 2,
        this.y - this.colliderHeight,
        this.colliderWidth,
        this.colliderHeight
      );
    }
  }

  toJSON(): any {
    const data = super.toJSON();
    data.type = 'Entity'; // SceneManager expects 'Entity' or 'Actor' etc.
    return data;
  }

  load(data: any): void {
    this.startLoading();
    try {
      // Special handling for missing baseWidth/baseHeight in old JSONs
      if (data.baseWidth === undefined && data.width !== undefined) {
        const scale = data.scale || 1.0;
        this.baseWidth = scale > 0 ? data.width / scale : data.width;
      }
      if (data.baseHeight === undefined && data.height !== undefined) {
        const scale = data.scale || 1.0;
        this.baseHeight = scale > 0 ? data.height / scale : data.height;
      }

      super.load(data);

      if (data.spriteName) {
        this.setSprite(data.spriteName, true);
      }
    } finally {
      this.endLoading();
    }
  }

  static fromJSON(game: IGame, data: EntityData): Entity {
    // Factory pattern should be used here or by caller, but for backward compatibility:
    // Use the instance load method.
    const entity = new Entity(game, data.x, data.y, data.width, data.height, data.name);
    entity.load(data);
    return entity;
  }

  // Shared Canvas for Hit Testing (Lazy Initialized)
  private static _hitTestCanvas: HTMLCanvasElement | null = null;
  private static _hitTestCtx: CanvasRenderingContext2D | null = null;

  hitTest(x: number, y: number): boolean {
    return this.hitTestInternal(x, y, false);
  }

  override containsPoint(x: number, y: number): boolean {
    return this.hitTestInternal(x, y, true);
  }

  private hitTestInternal(x: number, y: number, ignoreLocked: boolean): boolean {
    if (this.disabled || !this.visible || (!ignoreLocked && this.locked)) return false;

    // 1. Initial AABB Check (World Space)
    // Entity Pivot is Bottom-Center
    const left = this.x - this.width / 2;
    const right = this.x + this.width / 2;
    const top = this.y - this.height;
    const bottom = this.y;

    // Fast Fail
    if (x < left || x > right || y < top || y > bottom) return false;

    // 2. Pixel Perfect Check (if Image available)
    if (this.image && this.image.complete && this.image.naturalWidth > 0) {
      // Lazy Init Shared Canvas
      if (!Entity._hitTestCanvas) {
        Entity._hitTestCanvas = document.createElement('canvas');
        Entity._hitTestCanvas.width = 1;
        Entity._hitTestCanvas.height = 1;
        Entity._hitTestCtx = Entity._hitTestCanvas.getContext('2d', { willReadFrequently: true });
      }
      const ctx = Entity._hitTestCtx;
      if (!ctx) return true; // Fallback to AABB if no context

      // Calculate Local Coordinates (0,0 to Width,Height)
      // World X -> Local X
      // Local X = (WorldX - Left) / Scale
      // But we need to map to Image Coordinates (Source Sprite)

      // Determine Source Rect (Sprite Frame)
      let srcX = 0,
        srcY = 0,
        srcW = this.image.naturalWidth,
        srcH = this.image.naturalHeight;

      if (this.animator) {
        const frame = this.animator.getCurrentFrame();
        if (frame) {
          srcX = frame.x;
          srcY = frame.y;
          srcW = frame.w;
          srcH = frame.h;
        }
      }

      // Map World Point to Normalized Local (0..1)
      // Do NOT use this.scale here directly, use this.width/height which includes scale
      // normalizedX = (x - left) / this.width
      const normX = (x - left) / this.width;
      const normY = (y - top) / this.height; // Top is y - height, Bottom is y. So (y - (this.y - h)) / h

      // Flip X Support
      const finalNormX = this.flipX ? 1 - normX : normX;

      // Map to Source Image Pixels
      const pixelX = Math.floor(srcX + finalNormX * srcW);
      const pixelY = Math.floor(srcY + normY * srcH);

      // Bounds Safety Check (in case of rounding errors)
      if (pixelX < srcX || pixelX >= srcX + srcW || pixelY < srcY || pixelY >= srcY + srcH)
        return false;

      // Read Alpha
      // We clear and draw only the 1x1 pixel we need?
      // No, drawImage can draw a 1x1 slice of source to 1x1 dest.
      ctx.clearRect(0, 0, 1, 1);
      ctx.drawImage(this.image, pixelX, pixelY, 1, 1, 0, 0, 1, 1);

      const pixelData = ctx.getImageData(0, 0, 1, 1).data;
      const alpha = pixelData[3];

      // Threshold: 10/255 (approx 4%) - allow very faint shadows to be "empty"
      return alpha > 10;
    }

    // If no image, AABB is the hit
    return true;
  }
}
