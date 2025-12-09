import { Actor } from './Actor';
import { Animator } from '../core/Animator';

export class Player extends Actor {
    constructor(x: number, y: number) {
        super(x, y, 10, 25, 'Player'); // Player size
        this.color = '#00ffff'; // Cyan
        this.speed = 0.1; // Pixels per ms

        // Ensure Animator exists (created by Actor)
        if (!this.animator) this.animator = new Animator(this);

        // We assume assets are served from root (e.g. public/assets)
        this.setSprite('assets/hero.png');

        // --- MANUAL ADJUSTMENT ---
        const W = 176;    // Frame Width
        const H = 192;    // Frame Height
        const offX = 0;   // Horizontal Offset (shift right)
        const offY = 20;   // Vertical Offset (shift down, e.g. to skip text)
        // -------------------------

        // Define Animations matching Actor convention: {STATE}_{DIRECTION}
        // States: IDLE, WALK
        // Directions: UP, DOWN, LEFT, RIGHT

        // Row 1: Down
        const walkDown = [
            { x: offX, y: offY, w: W, h: H },
            { x: offX + W, y: offY, w: W, h: H },
            { x: offX + W * 2, y: offY, w: W, h: H },
            { x: offX + W * 3, y: offY, w: W, h: H }
        ];
        this.animator.addAnimation('WALK_DOWN', walkDown);
        this.animator.addAnimation('IDLE_DOWN', [{ x: offX, y: offY, w: W, h: H }]);

        // Row 2: Up
        const walkUp = [
            { x: offX, y: offY + H, w: W, h: H },
            { x: offX + W, y: offY + H, w: W, h: H },
            { x: offX + W * 2, y: offY + H, w: W, h: H },
            { x: offX + W * 3, y: offY + H, w: W, h: H }
        ];
        this.animator.addAnimation('WALK_UP', walkUp);
        this.animator.addAnimation('IDLE_UP', [{ x: offX, y: offY + H, w: W, h: H }]);

        // Row 3: Right
        const walkRight = [
            { x: offX, y: offY + H * 2, w: W, h: H },
            { x: offX + W, y: offY + H * 2, w: W, h: H },
            { x: offX + W * 2, y: offY + H * 2, w: W, h: H },
            { x: offX + W * 3, y: offY + H * 2, w: W, h: H }
        ];
        this.animator.addAnimation('WALK_RIGHT', walkRight);
        this.animator.addAnimation('IDLE_RIGHT', [{ x: offX, y: offY + H * 2, w: W, h: H }]);

        // Left reuse Right (handled by Actor flipX logic) but we strictly need register nothing for logic to fallback? 
        // Actor logic tries LEFT first? No, Actor logic: "if direction left... try RIGHT and flip"
        // So we don't strictly need WALK_LEFT.

        // Default
        this.animator.play('IDLE_DOWN');

        // Set display size (scale down)
        this.baseWidth = 30;
        this.baseHeight = 50;
        this.width = 30;
        this.height = 50;
    }

    toJSON() {
        const data = super.toJSON();
        data.type = 'Player';
        return data;
    }
}
