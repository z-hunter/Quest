import { Entity, type EntityData } from './Entity';
import { Animator } from '../core/Animator';
import { useEditorStore } from '../store/editorStore';
import type { IGame } from '../core/IGame';
import { toWorldPosition } from '../utils/Parallax';

export type ActorState = 'idle' | 'walk' | 'talk' | 'interact' | string;
export type ActorDirection = 'up' | 'down' | 'left' | 'right';

export interface AnimationSet {
  id: string; // e.g. 'idle', 'walk'
  up: string | null; // Sprite Name
  down: string | null;
  left: string | null;
  right: string | null;
}

import { ComponentSystem } from '../systems/ComponentSystem';

// Interfaces for State/Anim are kept here or moved if generic.
// ShadowComponent interface moved to ComponentSystem.

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
  target: { x: number; y: number } | null;
  visualTarget: { x: number; y: number } | null;
  readonly type: string = 'Actor';

  isPlayer: boolean = false;

  /**
   * List of properties to be serialized to/from JSON.
   * Extends Entity.SERIALIZABLE_PROPS.
   */
  static override SERIALIZABLE_PROPS: string[] = [
    ...Entity.SERIALIZABLE_PROPS,
    'isPlayer',
    'speed',
    'direction',
    'animSets',
  ];

  constructor(
    game: IGame,
    x: number,
    y: number,
    width: number = 30,
    height: number = 30,
    name: string = 'Actor'
  ) {
    super(game, x, y, width, height, name);
    this.direction = 'down';
    this.state = 'idle';
    this.speed = 0.1;
    this.target = null;
    this.visualTarget = null;
    this.isPlayer = false;

    this.animSets = {};
    this.overrideAnimSet = null;

    // Actors usually have animators
    this.animator = new Animator(this);
  }

  notifyEditor() {
    // If this object is currently selected in the editor, notify the UI to refresh
    if (this.game && this.game.editor && this.game.editor.selectedObject === this) {
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
    this.visualTarget = null;
    this.setState('walk');
    this.overrideAnimSet = null;
  }

  moveToVisual(x: number, y: number): void {
    this.visualTarget = { x, y };
    this.target = null;
    this.setState('walk');
    this.overrideAnimSet = null;
  }

  stop(): void {
    this.target = null;
    this.visualTarget = null;
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

    // Update Components
    ComponentSystem.update(this, deltaTime);

    // console.log(`[Actor] update state=${this.state} target=${this.target ? 'YES' : 'NO'} isWalkable=${!!isWalkable}`);

    if (this.isPlayer) {
      this.handlePlayerInput(deltaTime, isWalkable);
    }

    if (this.state === 'walk' && (this.target || this.visualTarget)) {
      const currentTarget = this.visualTarget
        ? toWorldPosition(
            this.visualTarget,
            this.scene?.camera || { x: 0, y: 0 },
            this.parallax !== undefined ? this.parallax : 1.0
          )
        : this.target;

      if (!currentTarget) {
        this.stop();
        return;
      }

      const dx = currentTarget.x - this.x;
      const dy = currentTarget.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const p = this.parallax !== undefined ? this.parallax : 1.0;
      // Scale speed by parallax (dampened: 0.5 input -> 0.6 output)
      const speedScale = 0.2 + 0.8 * p;
      const step = this.speed * speedScale * deltaTime;

      if (dist <= step) {
        this.x = currentTarget.x;
        this.y = currentTarget.y;
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
    const game = this.game;
    const input = game?.input;

    // Block input if mouse is over UI
    if (game?.isMouseOverUI) return;

    // Block input if Subscene is active
    if (this.scene && this.scene.activeSubscene) return;

    if (input) {
      // Prevent movement if Control is held (e.g. for Console History)
      if (input.isDown('Control')) return;

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

        const p = this.parallax !== undefined ? this.parallax : 1.0;
        const speedScale = 0.2 + 0.8 * p;
        const moveX = dx * this.speed * speedScale * deltaTime;
        const moveY = dy * this.speed * speedScale * deltaTime;

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
      } else if (!this.target && !this.visualTarget) {
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
    } else if (
      !spriteName &&
      this.direction === 'left' &&
      this.animSets['idle'] &&
      this.animSets['idle']['right']
    ) {
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

      if (
        this.spriteName &&
        (this.spriteName === normalized ||
          this.spriteName.endsWith('/' + normalized) ||
          normalized.endsWith('/' + this.spriteName))
      ) {
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
    const data = super.toJSON();
    data.type = 'Actor';
    return data;
  }

  override load(data: any): void {
    this.startLoading();
    try {
      super.load(data);
      // Initial sprite update based on loaded state/direction
      this.updateSpriteForState();
    } finally {
      this.endLoading();
    }
  }

  static override fromJSON(game: IGame, data: ActorData): Actor {
    const actor = new Actor(game, data.x, data.y, data.width, data.height, data.name);
    actor.load(data);
    return actor;
  }
}
