import { Animator } from '../core/Animator';
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
    // readonly type: string = 'Static'; // Inherited

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

        this.baseWidth = this.width;
        this.baseHeight = this.height;
        this.animator = null;
        this.flipX = false;
        this.scene = null;
    }

    setSprite(filename: string): void {
        // Strict JSON support as requested
        if (!filename.toLowerCase().endsWith('.json')) {
            filename += '.json';
        }

        this.spriteName = filename;
        console.log(`[Entity] Loading sprite config: ${filename}`);

        // Construct path for fetch.
        // If filename starts with 'public/', we need to strip it for the browser fetch check?
        // Usually filenames stored are relative or just names.
        // FileBrowser generally returns just the filename if flattened, or relative path.
        // Let's assume input might be "public/sprites/foo.json" or just "foo.json"

        // However, fetch needs a valid URL path.
        // In this project, 'public' is root.

        let fetchPath = filename;
        if (fetchPath.startsWith('public/')) {
            fetchPath = '/' + fetchPath.substring(7);
        } else if (!fetchPath.startsWith('/')) {
            // If just filename, assume /sprites/ ? Or try to respect path provided?
            // PropertiesPanel sends whatever FileBrowser returns.
            // If PropertiesPanel was set to 'public/sprites', it typically returns just the file name in the callback 
            // IF the file browser implementation does that.
            // Let's look at `PropertiesPanel` again... `handleChange('spriteName', f)`
            // If FileBrowser returns 'foo.json', we might need to prepend path.
            // But let's handle the full path case first.

            // Safest bet: If it doesn't look like a path, assume /sprites/
            fetchPath = '/sprites/' + filename;
        }

        fetch(fetchPath)
            .then(res => {
                if (!res.ok) throw new Error(`Failed to load sprite json: ${res.statusText}`);
                return res.json();
            })
            .then(data => {
                // Parse Sprite Data
                // Expected format: { imageFile: string, x, y, width, height, frames, ... }

                // 1. Setup Dimensions (Frame Size)
                this.baseWidth = data.width;
                this.baseHeight = data.height;
                // Update current dimensions based on scale
                this.width = this.baseWidth * this.scale;
                this.height = this.baseHeight * this.scale;

                // 2. Load Image
                let imagePath = data.imageFile;
                // Handle relative paths in JSON
                if (imagePath.startsWith('public/')) {
                    imagePath = '/' + imagePath.substring(7);
                } else if (!imagePath.startsWith('/') && !imagePath.startsWith('http')) {
                    imagePath = '/assets/' + imagePath; // Assumption: images are in assets
                }

                this.image = new Image();
                this.image.src = imagePath;
                this.image.onload = () => {
                    console.log(`[Entity] Loaded sprite image: ${imagePath}`);
                };
                this.image.onerror = (e) => console.error(`[Entity] Failed to load sprite image: ${imagePath}`, e);

                // 3. Setup Animator
                if (!this.animator) {
                    this.animator = new Animator(this);
                }

                const frames = [];
                for (let i = 0; i < (data.frames || 1); i++) {
                    frames.push({
                        x: data.x,
                        y: data.y + (i * data.height), // Vertical strip assumption from SpriteEditor
                        w: data.width,
                        h: data.height
                    });
                }

                this.animator.addAnimation('default', frames, true);
                this.animator.play('default');

            })
            .catch(err => {
                console.error(`[Entity] Sprite load error:`, err);
                // Fallback? User asked to remove legacy support, so maybe just log.
            });
    }

    update(deltaTime: number): void {
        // Dynamic Depth Scaling
        let depthFactor = 1.0;

        if (!this.ignoreScaling) {
            if (this.scene && this.scene.scaling && this.scene.scaling.enabled) {
                depthFactor = this.scene.getScaling(this.y);
            } else if ((window as any).game && (window as any).game.sceneManager && (window as any).game.sceneManager.currentScene) {
                const scene = (window as any).game.sceneManager.currentScene;
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
            layer: this.layer,
            parallax: this.parallax,
            ignoreScaling: this.ignoreScaling
        };
    }

    static fromJSON(data: EntityData): Entity {
        // Note: subclasses like Actor should handle their own instantiation if using this directly,
        // or the caller should instantiate the right class and then populate.
        // This default implementation creates a base Entity.
        const entity = new Entity(data.x, data.y, data.width, data.height, data.name);
        entity.color = data.color || '#ff0000';
        entity.scale = data.scale || 1.0;

        // Restore base dimensions if present, otherwise calculate/fallback
        console.log(`[Entity.fromJSON] '${data.name}' - Init W:${data.width} H:${data.height} Scale:${data.scale}`);
        if (data.baseWidth !== undefined) {
            entity.baseWidth = data.baseWidth;
            console.log(`[Entity.fromJSON] Restored baseWidth: ${entity.baseWidth}`);
        } else {
            entity.baseWidth = entity.scale > 0 ? data.width / entity.scale : data.width;
            console.log(`[Entity.fromJSON] Calculated baseWidth: ${entity.baseWidth}`);
        }

        if (data.baseHeight !== undefined) entity.baseHeight = data.baseHeight;
        else entity.baseHeight = entity.scale > 0 ? data.height / entity.scale : data.height;

        entity.layer = data.layer || 0;
        entity.parallax = data.parallax !== undefined ? data.parallax : 1.0;
        entity.ignoreScaling = !!data.ignoreScaling;

        if (data.spriteName) {
            entity.setSprite(data.spriteName);
        }
        return entity;
    }
}
