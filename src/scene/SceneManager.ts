import { Scene } from './Scene';

export class SceneManager {
    game: any;
    currentScene: Scene | null;
    scenes: Map<string, Scene>;

    constructor(game: any) {
        this.game = game;
        this.currentScene = null;
        this.scenes = new Map();
    }

    addScene(scene: Scene): void {
        this.scenes.set(scene.id, scene);
    }

    switchTo(sceneId: string): void {
        if (this.scenes.has(sceneId)) {
            this.currentScene = this.scenes.get(sceneId) || null;
            if (this.currentScene) {
                console.log(`Switched to scene: ${this.currentScene.name}`);

                // Update UI Title
                // In React world, this might be handled via state, but for now keeping DOM manip or hook later
                // We'll emit an event or update game state that React observes
                if (this.game.onSceneChange) {
                    this.game.onSceneChange(this.currentScene.name);
                }
            }
        } else {
            console.error(`Scene not found: ${sceneId}`);
        }
    }

    update(deltaTime: number): void {
        if (this.currentScene) {
            this.currentScene.update(deltaTime);
        }
    }

    render(ctx: CanvasRenderingContext2D): void {
        if (this.currentScene) {
            this.currentScene.render(ctx);
        }
    }
}
