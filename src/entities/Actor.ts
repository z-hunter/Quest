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

    constructor(x: number, y: number, width: number = 30, height: number = 30, name: string = 'Actor') {
        super(x, y, width, height, name);
        this.direction = 'down';
        this.state = 'idle';
        this.speed = 0.1;
        this.target = null;

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
        return data;
    }
}
