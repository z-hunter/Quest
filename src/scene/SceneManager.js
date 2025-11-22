class SceneManager {
    constructor(game) {
        this.game = game;
        this.currentScene = null;
        this.scenes = new Map();
    }

    addScene(scene) {
        this.scenes.set(scene.id, scene);
    }

    switchTo(sceneId) {
        if (this.scenes.has(sceneId)) {
            this.currentScene = this.scenes.get(sceneId);
            console.log(`Switched to scene: ${this.currentScene.name}`);

            // Update UI Title
            const titleEl = document.getElementById('scene-title-display');
            if (titleEl) {
                titleEl.textContent = this.currentScene.name;
            }
        } else {
            console.error(`Scene not found: ${sceneId}`);
        }
    }

    update(deltaTime) {
        if (this.currentScene) {
            this.currentScene.update(deltaTime);
        }
    }

    render(ctx) {
        if (this.currentScene) {
            this.currentScene.render(ctx);
        }
    }
}
