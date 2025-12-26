import { Animator } from '../core/Animator';
import { Game } from '../core/Game';
import { SceneObject } from './SceneObject';

export interface EntityData {
    type: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    baseWidth?: number;  // Added
    baseHeight?: number; // Added
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
}

export class Entity extends SceneObject {
    x: number;
    y: number;
    width: number;
    height: number;
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
        this.width = width;
        this.height = height;
        // this.name = name; // Super handles it

        this.description = "You see nothing special.";
        this.interactions = {};
        this.isTakeable = false;

        this.color = '#ff0000'; // Debug color
        this.visible = true;
        this.spriteName = null;
        this.image = null;
        this.scale = 1.0;
        this.modelScale = 1.0;
        this.layer = 0;
        this.parallax = 1.0; // 1.0 = normal move, 0.5 = half speed (far), 0.0 = fixed
        this.ignoreScaling = false;
        this.animationSpeed = 150; // Default 150ms
        // this.locked = false; // Inherited

        this.baseWidth = this.width;
        this.baseHeight = this.height;
        this.animator = null;
        this.flipX = false;
        this.scene = null;
        this.loadingRefCount = 0;
    }

    setSprite(filename: string, keepSize: boolean = false): void {
        // Auto-detect loading state if not explicitly set
        if (this.isLoading) keepSize = true;
        // Strict JSON support as requested
        if (!filename.toLowerCase().endsWith('.json')) {
            filename += '.json';
        }

        // Update the sprite name immediately so we know what is INTENDED.
        // This prevents repeated calls and ensures serialization is correct even while loading.
        this.spriteName = filename;
        console.log(`[Entity] Loading sprite config: ${filename}`);

        // Capture the requested filename to handle race conditions
        const requestName = filename;

        // Capture current dimensions target if we need to preserve them
        const targetWidth = this.width;

        let fetchPath = filename;
        if (fetchPath.startsWith('public/')) {
            fetchPath = '/' + fetchPath.substring(7);
        } else if (!fetchPath.startsWith('/')) {
            fetchPath = '/sprites/' + filename;
        }

        fetch(fetchPath)
            .then(res => {
                if (!res.ok) throw new Error(`Failed to load sprite json: ${res.statusText}`);
                return res.json();
            })
            .then(data => {
                // Check if the request is still valid before processing
                if (this.spriteName !== requestName) {
                    console.log(`[Entity] Ignoring stale sprite load: ${requestName} (Current: ${this.spriteName})`);
                    return;
                }

                // Prepare new state in local variables (ATOMIC PREPARATION)

                // 1. Dimensions
                const newBaseWidth = data.width;
                const newBaseHeight = data.height;

                // 2. Image
                let imagePath = data.imageFile;
                if (imagePath.startsWith('public/')) {
                    imagePath = '/' + imagePath.substring(7);
                } else if (!imagePath.startsWith('/') && !imagePath.startsWith('http')) {
                    imagePath = '/assets/' + imagePath;
                }

                const newImage = new Image();
                newImage.src = imagePath;

                // 3. Animator
                const newAnimator = new Animator(this);
                // Apply current animation speed
                newAnimator.frameDuration = this.animationSpeed;

                const frames = [];
                for (let i = 0; i < (data.frames || 1); i++) {
                    frames.push({
                        x: data.x,
                        y: data.y + (i * data.height),
                        w: data.width,
                        h: data.height
                    });
                }
                newAnimator.addAnimation('default', frames, true);
                newAnimator.play('default');

                // 4. Atomic Swap on Load
                newImage.onload = () => {
                    // Double check race condition inside onload
                    if (this.spriteName !== requestName) {
                        console.log(`[Entity] Ignoring stale sprite load (onload): ${requestName}`);
                        return;
                    }

                    console.log(`[Entity] Applying sprite: ${requestName} | keepSize: ${keepSize} | isLoading: ${this.isLoading} | targetW: ${targetWidth} | newBaseW: ${newImage.naturalWidth}`);

                    // Logic to preserve visual size if requested (e.g. during Load)
                    if (keepSize) {
                        // STRICT keepSize: Do NOT update baseWidth/baseHeight/modelScale.
                        // We trust that the existing dimensions (from Load or current state) are what the user wants.
                        // Changing them to match newImage.naturalWidth would enforce the new sprite's aspect ratio,
                        // destroying any non-uniform scaling (squashing/stretching) done by the user.
                        console.log(`[Entity] keepSize active. Preserving existing dimensions: W:${this.width} H:${this.height} BaseW:${this.baseWidth} BaseH:${this.baseHeight}`);
                    } else {
                        // Default behavior: conform to sprite size
                        this.baseWidth = newBaseWidth;
                        this.baseHeight = newBaseHeight;

                        // Force immediate update for visual snap
                        this.width = this.baseWidth * this.scale;
                        this.height = this.baseHeight * this.scale;
                    }

                    this.image = newImage;
                    this.animator = newAnimator;
                };

                newImage.onerror = (e) => {
                    console.error(`[Entity] Failed to load sprite image: ${imagePath}`, e);
                };
            })
            .catch(err => {
                console.error(`[Entity] Sprite load error:`, err);
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

        // Update Hitbox Dims
        this.width = this.baseWidth * this.scale;
        this.height = this.baseHeight * this.scale;

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
            spriteName: this.spriteName,
            color: this.color,
            scale: this.scale,
            modelScale: this.modelScale, // Added persistence
            layer: this.layer,
            parallax: this.parallax,
            ignoreScaling: this.ignoreScaling,
            animationSpeed: this.animationSpeed,
            locked: this.locked, // Added Locked Property
            disabled: this.disabled
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

            this.color = data.color || '#ff0000';
            this.scale = data.scale || 1.0;
            if (data.modelScale !== undefined) this.modelScale = data.modelScale;

            // Restore base dimensions
            console.log(`[Entity.load] '${data.name}' - Init W:${data.width} H:${data.height} Scale:${data.scale} ModelScale:${data.modelScale} Sprite:${data.spriteName}`);
            if (data.baseWidth !== undefined) {
                this.baseWidth = data.baseWidth;
            } else {
                this.baseWidth = this.scale > 0 ? data.width / this.scale : data.width;
            }

            if (data.baseHeight !== undefined) this.baseHeight = data.baseHeight;
            else this.baseHeight = this.scale > 0 ? data.height / this.scale : data.height;

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
}
