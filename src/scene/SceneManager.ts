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
        const scene = this.scenes.get(sceneId);
        if (scene) {
            this.currentScene = scene;
            console.log(`Switched to scene: ${this.currentScene.name}`);
            this.exposeEntitiesToWindow();
            // Optional: Notify UI provided by Game
            if (this.game.onSceneChange) {
                this.game.onSceneChange(scene.name);
            }
        } else {
            console.error(`Scene ${sceneId} not found!`);
        }
    }

    exposeEntitiesToWindow(): void {
        if (!this.currentScene) return;

        // Expose all entities by Name to window for Console API usage
        this.currentScene.entities.forEach(entity => {
            if (entity.name) {
                // Sanitize name to be a valid JS identifier if needed, or just warn
                // For now, assuming names are valid identifiers (e.g. Hero, Box, etc.)
                // @ts-ignore
                window[entity.name] = entity;
            }
        });
        console.log(`[SceneManager] Entities exposed to Console: ${this.currentScene.entities.map(e => e.name).join(', ')}`);
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
