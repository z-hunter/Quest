class Entity {
    constructor(x, y, width, height, name) {
        this.x = x;
        this.y = y;
        this.width = width || 30;
        this.height = height || 30;
        this.name = name || 'Entity';
        this.description = "You see nothing special.";
        this.interactions = {}; // e.g., { 'TAKE': () => ... }
        this.isTakeable = false;

        this.color = '#ff0000'; // Debug color
        this.visible = true;
        this.spriteName = null;
        this.image = null;
        this.scale = 1.0;
        this.layer = 0; // Manual sorting offset
    }

    setSprite(filename) {
        this.spriteName = filename;
        this.image = new Image();
        this.image.src = filename;
        console.log(`[Entity] Loading sprite: ${filename}`);

        this.image.onload = () => {
            console.log(`[Entity] Loaded sprite: ${filename} (${this.image.naturalWidth}x${this.image.naturalHeight})`);
            // Auto-set size if not manually set? 
            // For now, let's update width/height based on scale
            // Only if NOT using animator (animator sets its own size)
            if (!this.animator) {
                this.width = this.image.naturalWidth * this.scale;
                this.height = this.image.naturalHeight * this.scale;
            }
        };

        this.image.onerror = (e) => {
            console.error(`[Entity] Failed to load sprite: ${filename}`, e);
        };
    }

    update(deltaTime, isWalkable) {
        if (this.animator) {
            this.animator.update(deltaTime);
        }
    }

    render(ctx) {
        if (!this.visible) return;

        if (this.animator && this.animator.getCurrentFrame()) {
            // Render using Animator
            const frame = this.animator.getCurrentFrame();
            if (this.image && this.image.complete) {
                // Flip horizontally if needed (for Left/Right reuse)
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
                // Image not loaded yet? Fallback to rect
                ctx.fillStyle = this.color;
                ctx.fillRect(this.x - this.width / 2, this.y - this.height, this.width, this.height);
            }
        } else if (this.image && this.image.complete && this.image.naturalWidth !== 0) {
            // Render static sprite
            ctx.drawImage(this.image, this.x - this.width / 2, this.y - this.height, this.width, this.height);
        } else {
            // Render debug rect
            ctx.fillStyle = this.color;
            ctx.fillRect(this.x - this.width / 2, this.y - this.height, this.width, this.height);

            ctx.fillStyle = '#00ff00';
            ctx.fillRect(this.x - 2, this.y - 2, 4, 4);
        }
    }

    toJSON() {
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

    static fromJSON(data) {
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
