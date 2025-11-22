class Player extends Entity {
    constructor(x, y) {
        super(x, y, 10, 25, 'Player'); // Player size
        this.color = '#00ffff'; // Cyan
        this.speed = 0.1; // Pixels per ms
        this.target = null;

        // Setup Animation
        this.animator = new Animator(this);
        this.setSprite('assets/hero.png');

        // Assuming 32x48 frames (adjust based on actual image)
        const W = 32;
        const H = 48;

        // Row 1: Down
        this.animator.addAnimation('WALK_DOWN', [
            { x: 0, y: 0, w: W, h: H }, { x: W, y: 0, w: W, h: H }, { x: W * 2, y: 0, w: W, h: H }, { x: W * 3, y: 0, w: W, h: H }
        ]);
        // Row 2: Up
        this.animator.addAnimation('WALK_UP', [
            { x: 0, y: H, w: W, h: H }, { x: W, y: H, w: W, h: H }, { x: W * 2, y: H, w: W, h: H }, { x: W * 3, y: H, w: W, h: H }
        ]);
        // Row 3: Right
        this.animator.addAnimation('WALK_RIGHT', [
            { x: 0, y: H * 2, w: W, h: H }, { x: W, y: H * 2, w: W, h: H }, { x: W * 2, y: H * 2, w: W, h: H }, { x: W * 3, y: H * 2, w: W, h: H }
        ]);
        // Row 4: Idle
        this.animator.addAnimation('IDLE', [
            { x: 0, y: H * 3, w: W, h: H }, { x: W, y: H * 3, w: W, h: H }, { x: W * 2, y: H * 3, w: W, h: H }, { x: W * 3, y: H * 3, w: W, h: H }
        ]);

        this.animator.play('IDLE');

        // Adjust size to match sprite
        this.width = W;
        this.height = H;
    }

    moveTo(x, y) {
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

    render(ctx) {
        // Draw player body
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x - this.width / 2, this.y - this.height, this.width, this.height);

        // Draw baseline/feet
        ctx.fillStyle = '#ff00ff';
        ctx.fillRect(this.x - 2, this.y - 2, 4, 4);
    }
}
