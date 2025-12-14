import { Entity } from './Entity';
import { Animator } from '../core/Animator';

export type ActorState = 'idle' | 'walk' | 'talk' | 'interact';
export type ActorDirection = 'up' | 'down' | 'left' | 'right';

export class Actor extends Entity {
    direction: ActorDirection;
    state: ActorState;
    speed: number;
    target: { x: number, y: number } | null;
    readonly type: string = 'Actor';

    isPlayer: boolean = false;

    constructor(x: number, y: number, width: number = 30, height: number = 30, name: string = 'Actor') {
        super(x, y, width, height, name);
        this.direction = 'down';
        this.state = 'idle';
        this.speed = 0.1;
        this.target = null;
        this.isPlayer = false;

        // Actors usually have animators
        this.animator = new Animator(this);
    }

    setDirection(dir: ActorDirection) {
        this.direction = dir;
        this.updateAnimationState();
    }

    setState(state: ActorState) {
        this.state = state;
        this.updateAnimationState();
    }

    moveTo(x: number, y: number): void {
        this.target = { x, y };
        this.setState('walk');
    }

    stop(): void {
        this.target = null;
        this.setState('idle');
    }

    update(deltaTime: number, isWalkable?: (x: number, y: number) => boolean): void {
        super.update(deltaTime);

        if (this.isPlayer) {
            this.handlePlayerInput(deltaTime, isWalkable);
        }

        if (this.state === 'walk' && this.target) {
            const dx = this.target.x - this.x;
            const dy = this.target.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 2) {
                this.x = this.target.x;
                this.y = this.target.y;
                this.stop();
            } else {
                const moveX = (dx / dist) * this.speed * deltaTime;
                const moveY = (dy / dist) * this.speed * deltaTime;
                const nextX = this.x + moveX;
                const nextY = this.y + moveY;

                // Determine Direction
                if (Math.abs(dx) > Math.abs(dy)) {
                    this.direction = dx > 0 ? 'right' : 'left';
                } else {
                    this.direction = dy > 0 ? 'down' : 'up';
                }

                if (!isWalkable || isWalkable(nextX, nextY)) {
                    this.x = nextX;
                    this.y = nextY;
                } else {
                    this.stop();
                }
            }
        }

        this.updateAnimationState();
    }

    handlePlayerInput(deltaTime: number, isWalkable?: (x: number, y: number) => boolean) {
        // Keyboard Movement Logic
        // @ts-ignore
        const input = window.game?.input;
        if (input) {
            let dx = 0;
            let dy = 0;

            if (input.isDown('ArrowUp')) dy -= 1;
            if (input.isDown('ArrowDown')) dy += 1;
            if (input.isDown('ArrowLeft')) dx -= 1;
            if (input.isDown('ArrowRight')) dx += 1;

            if (dx !== 0 || dy !== 0) {
                // Keys pressed: Override any mouse target
                this.target = null;
                this.setState('walk');

                // Normalize vector
                const length = Math.sqrt(dx * dx + dy * dy);
                if (length > 0) {
                    dx /= length;
                    dy /= length;
                }

                // Apply Speed
                const moveX = dx * this.speed * deltaTime;
                const moveY = dy * this.speed * deltaTime;

                const nextX = this.x + moveX;
                const nextY = this.y + moveY;

                // Update Direction
                if (Math.abs(dx) > Math.abs(dy)) {
                    this.direction = dx > 0 ? 'right' : 'left';
                } else {
                    this.direction = dy > 0 ? 'down' : 'up';
                }

                // Collision Check
                if (!isWalkable || isWalkable(nextX, nextY)) {
                    this.x = nextX;
                    this.y = nextY;
                } else {
                    // Slide along walls? For now just stop if blocked directly.
                    // Simple slide: try moving just X then just Y
                    if (isWalkable && isWalkable(nextX, this.y)) {
                        this.x = nextX;
                    } else if (isWalkable && isWalkable(this.x, nextY)) {
                        this.y = nextY;
                    }
                }
            } else if (!this.target) {
                // If no keys and no target, stop
                this.setState('idle');
            }
        }
    }

    updateAnimationState() {
        if (!this.animator) return;

        // Convention: STATE_DIRECTION e.g. WALK_DOWN, IDLE_RIGHT
        const safeState = this.state.toUpperCase();
        const safeDir = this.direction.toUpperCase();
        const animName = `${safeState}_${safeDir}`;

        // Fallback logic
        // If specific anim doesn't exist, try just component parts or default? 
        // For now, assume strict naming or existing fallback in Animator (which just doesn't play if missing)

        // Special handling for Left/Right mirroring if needed
        if (this.direction === 'left') {
            // If we rely on flipX for left/right
            this.flipX = true;
            // Try playing RIGHT animation if LEFT doesn't exist?
            // Checking if animation exists is hard without reaching into Animator internals
            // For now assume we play 'WALK_RIGHT' and flip
            if (this.animator.animations[`${safeState}_RIGHT`]) {
                this.animator.play(`${safeState}_RIGHT`);
                return;
            }
        } else {
            this.flipX = false;
        }

        this.animator.play(animName);
    }

    toJSON() {
        const data = super.toJSON();
        data.type = 'Actor';
        if (this.isPlayer) data.isPlayer = true;
        return data;
    }
}
