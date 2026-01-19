import { Entity, type EntityData } from './Entity';
import { QuadObject } from './QuadObject';
import { Animator } from '../core/Animator';
import { useEditorStore } from '../store/editorStore';
// import { Game } from '../core/Game';

export type ActorState = 'idle' | 'walk' | 'talk' | 'interact' | string;
export type ActorDirection = 'up' | 'down' | 'left' | 'right';

export interface AnimationSet {
    id: string; // e.g. 'idle', 'walk'
    up: string | null;   // Sprite Name
    down: string | null;
    left: string | null;
    right: string | null;
}

export interface ShadowComponent {
    type: 'Shadow';
    id: string; // Component ID
    shadowQuadId: string;
    offsetX: number;
    offsetY: number;
    triggerId: string;
}

export interface ActorData extends EntityData {
    direction: ActorDirection;
    animSets: Record<string, AnimationSet>;
}

export class Actor extends Entity {
    direction: ActorDirection;
    state: ActorState;

    // Animation Sets
    animSets: Record<string, AnimationSet>;
    overrideAnimSet: string | null;

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

        this.animSets = {};
        this.overrideAnimSet = null;

        // Actors usually have animators
        this.animator = new Animator(this);
    }

    notifyEditor() {
        // If this object is currently selected in the editor, notify the UI to refresh
        const game = (window as any).game;
        if (game && game.editor && game.editor.selectedObject === this) {
            useEditorStore.getState().incrementObjectVersion();
        }
    }

    setDirection(dir: ActorDirection) {
        if (this.direction === dir) return;
        this.direction = dir;
        this.updateSpriteForState();
        this.notifyEditor();
    }

    playAnimSet(setName: string) {
        if (this.animSets[setName]) {
            this.overrideAnimSet = setName;
            this.updateSpriteForState();
            this.notifyEditor();
        } else {
            console.warn(`[Actor] Animation Set '${setName}' not found on actor '${this.name}'`);
        }
    }

    resetAnimSet() {
        this.overrideAnimSet = null;
        this.updateSpriteForState();
        this.notifyEditor();
    }

    addAnimSet(id: string) {
        if (this.animSets[id]) return;
        this.animSets[id] = { id, up: null, down: null, left: null, right: null };
        this.notifyEditor();
    }

    removeAnimSet(id: string) {
        delete this.animSets[id];
        this.notifyEditor();
    }

    getAnimSet(id: string): AnimationSet | undefined {
        return this.animSets[id];
    }

    walkTo(x: number, y: number): void {
        // Validation: Check if destination is walkable using the Scene's logic
        if (this.scene && typeof this.scene.isWalkable === 'function') {
            if (!this.scene.isWalkable(x, y, this)) {
                console.warn(`[Actor] walkTo destination ${x},${y} is not walkable.`);
                return;
            }
        }
        this.moveTo(x, y);
    }

    moveTo(x: number, y: number): void {
        this.target = { x, y };
        this.setState('walk');
        this.overrideAnimSet = null;
    }

    stop(): void {
        this.target = null;
        this.setState('idle');
    }

    setState(state: ActorState) {
        if (this.state === state) return;
        this.state = state;
        this.updateSpriteForState();
        this.notifyEditor();
    }

    update(deltaTime: number, isWalkable?: (x: number, y: number) => boolean): void {
        // Call Entity update (handles scaling etc)
        super.update(deltaTime);

        // Shadow Component Logic
        if (this.components && this.scene) {
            for (const comp of this.components) {
                if (comp.type === 'Shadow') {
                    const shadow = comp as ShadowComponent;
                    if (!shadow.shadowQuadId || !shadow.triggerId) continue;

                    // 1. Resolve Targets (Triggers)
                    // @ts-ignore
                    const targets = this.scene.resolveTarget ? this.scene.resolveTarget(shadow.triggerId) : [];

                    // console.log(`[Shadow] TriggerID: '${shadow.triggerId}'. Targets: ${targets.length}`);

                    // 2. Check if Actor Center is inside any target (Visual/Parallax Corrected)
                    // We need to compare "Visual Position" because hitTest() of QuadObject (Target)
                    // checks against its own Parallax-Shifted vertices.

                    // @ts-ignore
                    const camX = this.scene.camera ? this.scene.camera.x : 0;
                    // @ts-ignore
                    const camY = this.scene.camera ? this.scene.camera.y : 0;

                    // Actor Base World Pos
                    const ax = this.x;
                    const ay = this.y; // Feet

                    // Actor Visual Pos (Shifted by its Parallax)
                    // Shift = -Cam * (P - 1)
                    // Visual = Base + Shift
                    const pFactor = this.parallax !== undefined ? this.parallax : 1.0;
                    const shiftX = -camX * (pFactor - 1.0);
                    const shiftY = -camY * (pFactor - 1.0);

                    const checkX = ax + shiftX;
                    const checkY = ay + shiftY;

                    let inside = false;
                    for (const t of targets) {
                        // Ensure t has hitTest
                        if (typeof t.hitTest === 'function') {
                            // hitTest expectation:
                            // QuadObject.hitTest(x,y) checks if (x,y) is in ProjectedPoly.
                            // ProjectedPoly is in "Shifted World Space".
                            // So we pass our CheckX/Y (Shifted World Pos).
                            const hit = t.hitTest(checkX, checkY);

                            // console.log(`[Shadow] Checking '${t.name}': inside=${hit}`);

                            if (hit) {
                                inside = true;
                                break;
                            }
                        }
                    }

                    // 3. Find Shadow Quad
                    let qObj: QuadObject | undefined;

                    // Use Scene's findEntity (search by Name) because UI "ID" binds to Name.
                    // @ts-ignore
                    if (this.scene.findEntity) {
                        // @ts-ignore
                        qObj = this.scene.findEntity(shadow.shadowQuadId) as QuadObject;
                    }

                    if (!qObj) {
                        // Fallback: Case-insensitive search manually if findEntity strict failed, 
                        // or if findEntity is missing (unlikely, but safe)
                        // @ts-ignore
                        if (this.scene.entities) {
                            // @ts-ignore
                            qObj = this.scene.entities.find(e => e.name.toLowerCase() === shadow.shadowQuadId.toLowerCase());
                        }
                    }

                    // console.log(`[Shadow] Found ShadowQuad: ${qObj ? qObj.name : 'NULL'}. Inside Trigger: ${inside}`);

                    if (qObj && qObj.type === 'Quad') {
                        if (inside) {
                            if (!qObj.visible || qObj.disabled) {
                                qObj.visible = true;
                                qObj.disabled = false;
                                // console.log(`[Shadow] ENABLED shadow for ${this.name}`);
                            }

                            // 4. Parallax Sync
                            // Ensure Shadow Vertices match Actor Parallax
                            if (qObj.vertices) {
                                qObj.vertices.forEach(v => {
                                    v.p = pFactor;
                                });
                            }

                            // 5. Move Shadow
                            // Target V0 position (Base World Space)
                            const targetX = this.x + (shadow.offsetX || 0);
                            const targetY = this.y + (shadow.offsetY || 0);

                            // Delta
                            const v0 = qObj.vertices[0];
                            const dx = targetX - v0.x;
                            const dy = targetY - v0.y;

                            if (dx !== 0 || dy !== 0) {
                                qObj.vertices.forEach(v => {
                                    v.x += dx;
                                    v.y += dy;
                                });
                                // Also update main X/Y for sorting/logic? 
                                // QuadObject logic usually relies on vertices, but Entity.x/y might be used for sorting fallback.
                                // Let's update them too to keep bounding box consistent approx?
                                qObj.x += dx;
                                qObj.y += dy;
                            }

                        } else {
                            if (qObj.visible) {
                                qObj.visible = false;
                                qObj.disabled = true; // Or just visible? GDD says "tjen budet disabled"
                            }
                        }
                    }
                }
            }
        }


        console.log(`[Actor] update state=${this.state} target=${this.target ? 'YES' : 'NO'} isWalkable=${!!isWalkable}`);

        if (this.isPlayer) {
            this.handlePlayerInput(deltaTime, isWalkable);
        }

        if (this.state === 'walk' && this.target) {
            const dx = this.target.x - this.x;
            const dy = this.target.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            const step = this.speed * deltaTime;

            if (dist <= step) {
                this.x = this.target.x;
                this.y = this.target.y;
                this.stop();
            } else {
                const moveX = (dx / dist) * step;
                const moveY = (dy / dist) * step;
                const nextX = this.x + moveX;
                const nextY = this.y + moveY;

                // Determine Direction
                if (Math.abs(dx) > Math.abs(dy)) {
                    this.setDirection(dx > 0 ? 'right' : 'left');
                } else {
                    this.setDirection(dy > 0 ? 'down' : 'up');
                }

                if (!isWalkable || isWalkable(nextX, nextY)) {
                    this.x = nextX;
                    this.y = nextY;
                    if (this.overrideAnimSet) this.overrideAnimSet = null;
                } else {
                    this.stop();
                }
            }
        }

        // Ensure sprite is correct every frame (e.g. if direction changed)
        this.updateSpriteForState();
    }

    handlePlayerInput(deltaTime: number, isWalkable?: (x: number, y: number) => boolean) {
        // @ts-ignore
        const game = window.game;
        const input = game?.input;

        // Block input if mouse is over UI
        if (game?.isMouseOverUI) return;

        // Block input if Subscene is active
        if (this.scene && this.scene.activeSubscene) return;

        if (input) {
            let dx = 0;
            let dy = 0;

            if (input.isDown('ArrowUp')) dy -= 1;
            if (input.isDown('ArrowDown')) dy += 1;
            if (input.isDown('ArrowLeft')) dx -= 1;
            if (input.isDown('ArrowRight')) dx += 1;

            if (dx !== 0 || dy !== 0) {
                this.target = null;
                this.setState('walk');
                if (this.overrideAnimSet) this.overrideAnimSet = null;

                const length = Math.sqrt(dx * dx + dy * dy);
                if (length > 0) {
                    dx /= length;
                    dy /= length;
                }

                const moveX = dx * this.speed * deltaTime;
                const moveY = dy * this.speed * deltaTime;

                const nextX = this.x + moveX;
                const nextY = this.y + moveY;

                // Update Direction
                if (Math.abs(dx) > Math.abs(dy)) {
                    this.setDirection(dx > 0 ? 'right' : 'left');
                } else {
                    this.setDirection(dy > 0 ? 'down' : 'up');
                }

                if (!isWalkable || isWalkable(nextX, nextY)) {
                    this.x = nextX;
                    this.y = nextY;
                } else {
                    if (isWalkable && isWalkable(nextX, this.y)) {
                        this.x = nextX;
                    } else if (isWalkable && isWalkable(this.x, nextY)) {
                        this.y = nextY;
                    }
                }
            } else if (!this.target) {
                this.setState('idle');
            }
        }
    }

    updateSpriteForState() {
        let setId = this.state;
        if (this.overrideAnimSet) {
            setId = this.overrideAnimSet;
        }

        const animSet = this.animSets[setId];

        if (!animSet) {
            // Fallback to idle if not idle
            if (setId !== 'idle' && this.animSets['idle']) {
                this.applySpriteFromSet(this.animSets['idle']);
            }
            return;
        }

        this.applySpriteFromSet(animSet);
    }

    applySpriteFromSet(set: AnimationSet) {
        if (!set) return;

        let spriteName = set[this.direction];

        // Fallback: Use idle's direction sprite?
        if (!spriteName && set.id !== 'idle' && this.animSets['idle']) {
            spriteName = this.animSets['idle'][this.direction];
        }

        // Implicit Flip: If Left missing, use Right + Flip
        if (!spriteName && this.direction === 'left' && set['right']) {
            spriteName = set['right'];
            this.flipX = true;
        } else if (!spriteName && this.direction === 'left' && this.animSets['idle'] && this.animSets['idle']['right']) {
            // Fallback to idle right flipped
            spriteName = this.animSets['idle']['right'];
            this.flipX = true;
        } else if (this.direction === 'left' && spriteName) {
            // Have explicit left, don't flip
            this.flipX = false;
        } else {
            this.flipX = false;
        }

        // If still nothing, we might be empty (invisible or red box)

        if (spriteName) {
            let normalized = spriteName;
            if (!normalized.toLowerCase().endsWith('.json')) normalized += '.json';

            if (this.spriteName && (this.spriteName === normalized || this.spriteName.endsWith('/' + normalized) || normalized.endsWith('/' + this.spriteName))) {
                // Match found (loose), skip
            } else if (normalized !== this.spriteName) {
                this.setSprite(spriteName);
            }
        }
    }

    stopAnimation() {
        this.resetAnimSet();
    }

    toJSON() {
        const data = super.toJSON() as ActorData;
        data.type = 'Actor';
        if (this.isPlayer) data.isPlayer = true;
        data.speed = this.speed;
        data.direction = this.direction;
        data.animSets = this.animSets;
        return data;
    }

    override load(data: ActorData): void {
        this.startLoading();
        try {
            super.load(data);
            if (data.direction) this.direction = data.direction;
            if (data.speed !== undefined) this.speed = data.speed;
            if (data.isPlayer !== undefined) this.isPlayer = data.isPlayer;

            // Restore AnimSets
            if (data.animSets) {
                this.animSets = JSON.parse(JSON.stringify(data.animSets)); // Deep copy to prevent ref issues
            } else {
                this.animSets = {};
            }

            // Initial sprite update
            this.updateSpriteForState();
        } finally {
            this.endLoading();
        }
    }

    static override fromJSON(data: ActorData): Actor {
        const actor = new Actor(data.x, data.y, data.width, data.height, data.name);
        actor.load(data);
        return actor;
    }
}
