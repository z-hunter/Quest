import { Entity } from '../entities/Entity';

export interface AnimationFrame {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface AnimationDef {
    frames: AnimationFrame[];
    loop: boolean;
}

export class Animator {
    entity: Entity;
    animations: Record<string, AnimationDef>;
    currentAnimation: string | null;
    currentFrame: number;
    frameTimer: number;
    frameDuration: number;
    isPlaying: boolean;

    constructor(entity: Entity) {
        this.entity = entity;
        this.animations = {};
        this.currentAnimation = null;
        this.currentFrame = 0;
        this.frameTimer = 0;
        this.frameDuration = 150; // ms per frame
        this.isPlaying = false;
    }

    addAnimation(name: string, frames: AnimationFrame[], loop: boolean = true): void {
        this.animations[name] = {
            frames: frames,
            loop: loop
        };
    }

    play(name: string): void {
        if (this.currentAnimation === name && this.isPlaying) return;

        if (this.animations[name]) {
            this.currentAnimation = name;
            this.currentFrame = 0;
            this.frameTimer = 0;
            this.isPlaying = true;
        }
    }

    stop(): void {
        this.isPlaying = false;
        this.currentFrame = 0;
    }

    update(deltaTime: number): void {
        if (!this.isPlaying || !this.currentAnimation) return;

        this.frameTimer += deltaTime;
        if (this.frameTimer >= this.frameDuration) {
            this.frameTimer -= this.frameDuration;
            const anim = this.animations[this.currentAnimation];

            this.currentFrame++;
            if (this.currentFrame >= anim.frames.length) {
                if (anim.loop) {
                    this.currentFrame = 0;
                } else {
                    this.currentFrame = anim.frames.length - 1;
                    this.isPlaying = false;
                }
            }
        }
    }

    getCurrentFrame(): AnimationFrame | null {
        if (!this.currentAnimation) return null;
        return this.animations[this.currentAnimation].frames[this.currentFrame];
    }
}
