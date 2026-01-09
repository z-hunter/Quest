import { Animator } from '../core/Animator';
import { Game } from '../core/Game';
import { SceneObject } from './SceneObject';

export interface EntityData {
    type: string;
    name: string;
    groupID?: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    baseWidth?: number;  // Added
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
}

export class Entity extends SceneObject {
    x: number;
    y: number;

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
    layer: number;
    baseWidth: number;
    baseHeight: number;
    colliderWidth: number;
    colliderHeight: number;
    animator: Animator | null;
    flipX: boolean;
    scene: any; // Reference to the scene this entity belongs to
    parallax: number;
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

    endLoading() {
        if (this.loadingRefCount > 0) this.loadingRefCount--;
    }

    animationSpeed: number; // Added

    constructor(x: number, y: number, width: number = 30, height: number = 30, name: string = 'Entity') {
        super(name, 'Static');
        this.x = x;
        this.y = y;

        // Initialize defaults BEFORE setting width/height (which now rely on scale)
        this.scale = 1.0;
        this.baseWidth = width;
        this.baseHeight = height;

        // this.width = width; // No longer needed directly if base set above, but setter works too
        // this.name = name; // Super handles it

        this.description = "You see nothing special.";
        this.interactions = {};
        this.isTakeable = false;

        this.color = '#AAAAAA'; // Default Neutral Gray
        this.visible = true;
        this.spriteName = null;
        this.image = null;
        this.modelScale = 1.0;
        this.layer = 0;
        this.parallax = 1.0; // 1.0 = normal move, 0.5 = half speed (far), 0.0 = fixed
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
        const requestName = filename;
        console.log(`[Entity] Requesting sprite: ${requestName}`);

        // Capture current dimensions target if we need to preserve them

        Game.instance.assets.loadSprite(filename)
            .then(data => {
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
                        y: json.y + (i * json.height),
                        w: json.width,
                        h: json.height
                    });
                }
                newAnimator.addAnimation('default', frames, true);
                newAnimator.play('default');

                // 3. Apply
                console.log(`[Entity] Applying sprite: ${filename} | keepSize: ${keepSize}`);

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
            .catch(err => {
                console.error(`[Entity] Sprite load error for ${filename}:`, err);
            });
    }

    update(deltaTime: number): void {
        // Dynamic Depth Scaling
        let depthFactor = 1.0;

        if (!this.ignoreScaling) {
            if (this.scene && this.scene.scaling && this.scene.scaling.enabled) {
                depthFactor = this.scene.getScaling(this.y);
            } else if (Game.instance && Game.instance.sceneManager && Game.instance.sceneManager.currentScene) {
                const scene = Game.instance.sceneManager.currentScene;
                if (scene.scaling && scene.scaling.enabled) {
                    depthFactor = scene.getScaling(this.y);
                }
            }
        }

        // Final Scale = User Model Scale * Depth Factor
        this.scale = this.modelScale * depthFactor;

        // Update Hitbox Dims - REMOVED (Handled by Getter)
        // this.width = this.baseWidth * this.scale;
        // this.height = this.baseHeight * this.scale;

        if (this.animator) {
            this.animator.update(deltaTime);
        }
    }

    render(ctx: CanvasRenderingContext2D): void {
        if (!this.visible) return;

        if (this.animator && this.animator.getCurrentFrame()) {
            const frame = this.animator.getCurrentFrame();
            if (frame && this.image && this.image.complete) {
                if (this.flipX) {
                    ctx.save();
                    ctx.scale(-1, 1);
                    ctx.drawImage(
                        this.image,
                        frame.x, frame.y, frame.w, frame.h,
                        -(this.x + this.width / 2), this.y - this.height,
                        this.width, this.height
                    );
                    ctx.restore();
                } else {
                    ctx.drawImage(
                        this.image,
                        frame.x, frame.y, frame.w, frame.h,
                        this.x - this.width / 2, this.y - this.height,
                        this.width, this.height
                    );
                }
            } else {
                ctx.fillStyle = this.color;
                ctx.fillRect(this.x - this.width / 2, this.y - this.height, this.width, this.height);
            }
        } else if (this.image && this.image.complete && this.image.naturalWidth !== 0) {
            ctx.drawImage(this.image, this.x - this.width / 2, this.y - this.height, this.width, this.height);
        } else {
            ctx.fillStyle = this.color;
            ctx.fillRect(this.x - this.width / 2, this.y - this.height, this.width, this.height);

            ctx.fillStyle = '#00ff00';
            ctx.fillRect(this.x - 2, this.y - 2, 4, 4);
        }

        // Draw Collider if active AND Editor is enabled
        if (Game.instance?.editor?.enabled && this.colliderWidth > 0 && this.colliderHeight > 0) {
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 2; // Make it visible
            ctx.strokeRect(
                this.x - this.colliderWidth / 2,
                this.y - this.colliderHeight,
                this.colliderWidth,
                this.colliderHeight
            );
        }
    }

    toJSON(): EntityData {
        return {
            type: 'Entity', // Subclasses should override this or we can use constructor.name if safe
            name: this.name,
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height,
            baseWidth: this.baseWidth,
            baseHeight: this.baseHeight,
            colliderWidth: this.colliderWidth,
            colliderHeight: this.colliderHeight,
            spriteName: this.spriteName,
            color: this.color,
            scale: this.scale,
            modelScale: this.modelScale, // Added persistence
            layer: this.layer,
            parallax: this.parallax,
            ignoreScaling: this.ignoreScaling,
            animationSpeed: this.animationSpeed,
            locked: this.locked, // Added Locked Property
            disabled: this.disabled,
            customName: this.customName,
            groupID: this.groupID,
            components: this.components,
            interactions: this.interactions
        };
    }

    load(data: EntityData): void {
        this.startLoading();
        try {
            this.x = data.x;
            this.y = data.y;
            this.width = data.width;
            this.height = data.height;
            this.name = data.name; // SceneObject property
            this.groupID = data.groupID || null; // SceneObject property

            this.color = data.color || '#ff0000';
            this.scale = data.scale || 1.0;
            if (data.modelScale !== undefined) this.modelScale = data.modelScale;

            console.log(`[Entity.load] '${data.name}' - Init W:${data.width} H:${data.height} Scale:${data.scale} ModelScale:${data.modelScale} Sprite:${data.spriteName}`);

            if (data.baseWidth !== undefined) {
                this.baseWidth = data.baseWidth;
            } else {
                this.baseWidth = this.scale > 0 ? data.width / this.scale : data.width;
            }

            if (data.baseHeight !== undefined) this.baseHeight = data.baseHeight;
            else this.baseHeight = this.scale > 0 ? data.height / this.scale : data.height;

            if (data.colliderWidth !== undefined) this.colliderWidth = data.colliderWidth;
            if (data.colliderHeight !== undefined) this.colliderHeight = data.colliderHeight;

            this.layer = data.layer || 0;
            this.parallax = data.parallax !== undefined ? data.parallax : 1.0;
            this.ignoreScaling = !!data.ignoreScaling;

            // Restore animationSpeed
            if (data.animationSpeed !== undefined) {
                this.animationSpeed = data.animationSpeed;
            }

            if (data.locked !== undefined) {
                this.locked = data.locked;
            }

            if (data.disabled !== undefined) {
                this.disabled = data.disabled;
            }

            if (data.customName !== undefined) {
                this.customName = data.customName;
            }

            if (data.components) {
                this.components = JSON.parse(JSON.stringify(data.components));
            }

            if (data.interactions) {
                this.interactions = JSON.parse(JSON.stringify(data.interactions));
            }

            if (data.spriteName) {
                // Pass isLoading (true) explicitly, or rely on internal flag
                this.setSprite(data.spriteName, true);
            }
        } finally {
            this.endLoading();
        }
    }

    static fromJSON(data: EntityData): Entity {
        // Factory pattern should be used here or by caller, but for backward compatibility:
        // Use the instance load method.
        const entity = new Entity(data.x, data.y, data.width, data.height, data.name);
        entity.load(data);
        return entity;
    }

    // Shared Canvas for Hit Testing (Lazy Initialized)
    private static _hitTestCanvas: HTMLCanvasElement | null = null;
    private static _hitTestCtx: CanvasRenderingContext2D | null = null;

    hitTest(x: number, y: number): boolean {
        if (this.disabled || !this.visible) return false;

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
            let srcX = 0, srcY = 0, srcW = this.image.naturalWidth, srcH = this.image.naturalHeight;

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
            const finalNormX = this.flipX ? (1 - normX) : normX;

            // Map to Source Image Pixels
            const pixelX = Math.floor(srcX + finalNormX * srcW);
            const pixelY = Math.floor(srcY + normY * srcH);

            // Bounds Safety Check (in case of rounding errors)
            if (pixelX < srcX || pixelX >= srcX + srcW || pixelY < srcY || pixelY >= srcY + srcH) return false;

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
