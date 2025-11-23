import { Animator } from '../core/Animator';

export interface EntityData {
    type: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    spriteName: string | null;
    color: string;
    scale: number;
    layer: number;
}

export class Entity {
    x: number;
    y: number;
    width: number;
    height: number;
    name: string;
    description: string;
    interactions: Record<string, () => void>;
    isTakeable: boolean;
    color: string;
    visible: boolean;
    spriteName: string | null;
    image: HTMLImageElement | null;
    scale: number;
    layer: number;
    baseWidth: number;
    baseHeight: number;
    animator: Animator | null;
    flipX: boolean;

    constructor(x: number, y: number, width: number = 30, height: number = 30, name: string = 'Entity') {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.name = name;
        this.description = "You see nothing special.";
        this.interactions = {};
        this.isTakeable = false;

        this.color = '#ff0000'; // Debug color
        this.visible = true;
        this.spriteName = null;
        this.image = null;
        this.scale = 1.0;
        this.layer = 0;

        this.baseWidth = this.width;
        this.baseHeight = this.height;
        this.animator = null;
        this.flipX = false;
    }

    setSprite(filename: string): void {
        this.spriteName = filename;
        this.image = new Image();
        this.image.src = filename; // Vite might need import, but for now keeping as string path
        console.log(`[Entity] Loading sprite: ${filename}`);

        this.image.onload = () => {
            if (this.image) {
                console.log(`[Entity] Loaded sprite: ${filename} (${this.image.naturalWidth}x${this.image.naturalHeight})`);
                if (!this.animator) {
                    this.baseWidth = this.image.naturalWidth;
                    this.baseHeight = this.image.naturalHeight;
                    this.width = this.baseWidth * this.scale;
                    this.height = this.baseHeight * this.scale;
                }
            }
        };

        this.image.onerror = (e) => {
            console.error(`[Entity] Failed to load sprite: ${filename}`, e);
        };
    }

    update(deltaTime: number): void {
        // Dynamic Depth Scaling
        // Accessing global game for now as per original architecture
        // @ts-ignore
        if (window.game && window.game.sceneManager && window.game.sceneManager.currentScene) {
            // @ts-ignore
            const scene = window.game.sceneManager.currentScene;
            const depthScale = scene.getScaling(this.y);

            this.scale = depthScale;
            this.width = this.baseWidth * this.scale;
            this.height = this.baseHeight * this.scale;
        }

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
            type: 'Entity',
            name: this.name,
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height,
            spriteName: this.spriteName,
            color: this.color,
            scale: this.scale,
            layer: this.layer
        };
    }

    static fromJSON(data: EntityData): Entity {
        const entity = new Entity(data.x, data.y, data.width, data.height, data.name);
        entity.color = data.color || '#ff0000';
        entity.scale = data.scale || 1.0;
        entity.layer = data.layer || 0;
        if (data.spriteName) {
            entity.setSprite(data.spriteName);
        }
        return entity;
    }
}
