class Animator {
    constructor(entity) {
        this.entity = entity;
        this.animations = {};
        this.currentAnimation = null;
        this.currentFrame = 0;
        this.frameTimer = 0;
        this.frameDuration = 150; // ms per frame
        this.isPlaying = false;
    }

    addAnimation(name, frames, loop = true) {
        this.animations[name] = {
            frames: frames, // Array of {x, y, w, h} or indices if using grid
            loop: loop
        };
    }

    play(name) {
        if (this.currentAnimation === name && this.isPlaying) return;

        if (this.animations[name]) {
            this.currentAnimation = name;
            this.currentFrame = 0;
            this.frameTimer = 0;
            this.isPlaying = true;
        }
    }

    stop() {
        this.isPlaying = false;
        this.currentFrame = 0;
    }

    update(deltaTime) {
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

    getCurrentFrame() {
        if (!this.currentAnimation) return null;
        return this.animations[this.currentAnimation].frames[this.currentFrame];
    }
}
