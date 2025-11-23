class Player extends Entity {
    constructor(x, y) {
        super(x, y, 10, 25, 'Player'); // Player size
        this.color = '#00ffff'; // Cyan
        this.speed = 0.1; // Pixels per ms
        this.target = null;

        // Setup Animation
        this.animator = new Animator(this);
        this.setSprite('assets/hero.png');

        // --- MANUAL ADJUSTMENT ---
        const W = 176;    // Frame Width
        const H = 192;    // Frame Height
        const offX = 0;   // Horizontal Offset (shift right)
        const offY = 20;   // Vertical Offset (shift down, e.g. to skip text)
        // -------------------------

        // Row 1: Down
        this.animator.addAnimation('WALK_DOWN', [
            { x: offX, y: offY, w: W, h: H },
            { x: offX + W, y: offY, w: W, h: H },
            { x: offX + W * 2, y: offY, w: W, h: H },
            { x: offX + W * 3, y: offY, w: W, h: H }
        ]);
        // Row 2: Up
        this.animator.addAnimation('WALK_UP', [
            { x: offX, y: offY + H, w: W, h: H },
            { x: offX + W, y: offY + H, w: W, h: H },
            { x: offX + W * 2, y: offY + H, w: W, h: H },
            { x: offX + W * 3, y: offY + H, w: W, h: H }
        ]);
        // Row 3: Right
        this.animator.addAnimation('WALK_RIGHT', [
            { x: offX, y: offY + H * 2, w: W, h: H },
            { x: offX + W, y: offY + H * 2, w: W, h: H },
            { x: offX + W * 2, y: offY + H * 2, w: W, h: H },
            { x: offX + W * 3, y: offY + H * 2, w: W, h: H }
        ]);
        // Row 4: Idle - REPLACED with Row 1 (Down) Frame 0 for consistency
        this.animator.addAnimation('IDLE', [
            { x: offX, y: offY, w: W, h: H }
        ]);

        this.animator.play('IDLE');

        // Set display size (scale down)
        this.baseWidth = 30;
        this.baseHeight = 50;
        this.width = 30;
        this.height = 50;
    }

    moveTo(x, y) {
        console.log(`[Player] Moving to: ${x}, ${y}`);
        this.target = { x, y };
    }

    update(deltaTime, isWalkable) {
        super.update(deltaTime); // Update animator

        if (this.target) {
            const dx = this.target.x - this.x;
            const dy = this.target.y - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < 1) {
                this.x = this.target.x;
                this.y = this.target.y;
                this.target = null;
                this.animator.play('IDLE');
            } else {
                const moveX = (dx / distance) * this.speed * deltaTime;
                const moveY = (dy / distance) * this.speed * deltaTime;

                const nextX = this.x + moveX;
                const nextY = this.y + moveY;

                // Animation Logic
                if (Math.abs(dx) > Math.abs(dy)) {
                    // Horizontal
                    if (dx > 0) {
                        this.animator.play('WALK_RIGHT');
                        this.flipX = false;
                    } else {
                        this.animator.play('WALK_RIGHT'); // Reuse Right for Left
                        this.flipX = true;
                    }
                } else {
                    // Vertical
                    if (dy > 0) {
                        this.animator.play('WALK_DOWN');
                    } else {
                        this.animator.play('WALK_UP');
                    }
                }

                // Check if next position is walkable
                if (!isWalkable || isWalkable(nextX, nextY)) {
                    this.x = nextX;
                    this.y = nextY;
                } else {
                    // Hit an obstacle
                    console.log("Hit wall/hole!");
                    this.target = null; // Stop moving
                    this.animator.play('IDLE');
                }
            }
        }
    }
}
