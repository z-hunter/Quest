import { Scene } from './Scene';
import type { IGame } from '../core/IGame';
import { Entity } from '../entities/Entity';
import { Actor } from '../entities/Actor';
import { Walkbox } from '../entities/Walkbox';
import { Triggerbox } from '../entities/Triggerbox';
import { QuadObject } from '../entities/QuadObject';

export class SceneManager {
    game: IGame;
    currentScene: Scene | null;
    scenes: Map<string, Scene>;

    constructor(game: IGame) {
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

    async loadScene(filename: string): Promise<void> {
        try {
            // Filename comes from FileBrowser as 'path/to/file.json' or 'file.json'
            // We want ID to be 'path\to\file'
            const idFromPath = filename.replace('.json', '').replace(/\//g, '\\');

            const response = await fetch(`/scenes/${filename}?t=${Date.now()}`); // Burst cache
            if (!response.ok) throw new Error('File not found');
            const data = await response.json();

            // Pass the derived ID to loadSceneData
            this.loadSceneData(data, idFromPath);
        } catch (e) {
            console.error(e);
            this.game.showNotification?.("Failed to load scene");
        }
    }

    loadSceneData(data: any, filename?: string): void {
        try {
            // Priority:
            // 1. filename argument (derived from path: "sub\scene")
            // 2. data.id (from json)
            // 3. Fallback
            const sceneId = filename || data.id || 'loaded_scene';
            const newScene = new Scene(this.game, sceneId, data.name || 'Untitled');

            if (filename) {
                // Determine filename for saving (forward slashes)
                newScene.filename = filename.replace(/\\/g, '/');
            }
            else if (data.filename) newScene.filename = data.filename;

            // If ID was missing in File but provided by filename, ensure consistency
            newScene.id = sceneId;

            // Restore Camera
            if (data.camera) {
                newScene.defaultCamera = { ...data.camera };
                newScene.camera = { ...data.camera }; // Apply default to runtime immediately
            }

            if (data.autoCenter !== undefined) {
                newScene.autoCenter = data.autoCenter;
            }
            if (data.cameraSpeed !== undefined) {
                newScene.cameraSpeed = data.cameraSpeed;
            }
            if (data.camDeadzoneX !== undefined) newScene.camDeadzoneX = data.camDeadzoneX;
            if (data.camDeadzoneY !== undefined) newScene.camDeadzoneY = data.camDeadzoneY;
            if (data.camMinX !== undefined) newScene.camMinX = data.camMinX;
            if (data.camMaxX !== undefined) newScene.camMaxX = data.camMaxX;
            if (data.camMinY !== undefined) newScene.camMinY = data.camMinY;
            if (data.camMaxY !== undefined) newScene.camMaxY = data.camMaxY;

            // Restore Cameraling
            if (data.scaling) {
                newScene.scaling = data.scaling;
            }

            // Restore Walkboxes
            if (data.walkbox) {
                newScene.walkbox = (data.walkbox || []).map((wb: any) => {
                    const poly = wb.poly.map((p: any) => ({ x: Number(p.x), y: Number(p.y) }));
                    const w = new Walkbox(poly, wb.name || 'Walkbox');
                    w.load(wb);
                    return w;
                });
            }

            // Restore Triggerboxes
            if (data.triggerboxes) {
                newScene.triggerboxes = (data.triggerboxes || []).map((t: any) => {
                    const poly = t.poly.map((p: any) => ({ x: Number(p.x), y: Number(p.y) }));
                    const tb = new Triggerbox(poly, t.name || 'Triggerbox', t.script || '');
                    tb.load(t);
                    return tb;
                });
            }

            if (data.entities) {
                data.entities.forEach((entityData: any) => {
                    let entity: Entity;

                    if (entityData.type === 'Player') {
                        // Legacy: Convert Player to Actor
                        entity = Actor.fromJSON(this.game, { ...entityData, type: 'Actor', isPlayer: true });
                    } else if (entityData.type === 'Actor') {
                        entity = Actor.fromJSON(this.game, entityData);
                    } else if (entityData.type === 'Quad' || entityData.type === 'Rect') {
                        entity = QuadObject.fromJSON(this.game, entityData);
                    } else {
                        entity = Entity.fromJSON(this.game, entityData);
                    }

                    newScene.addEntity(entity);
                });
            }

            this.addScene(newScene);
            this.switchTo(newScene.id);

            // If Editor is active, it needs to know
            if (this.game.editor) {
                // But SceneManager shouldn't know about Editor details. 
                // Game loop handles binding?
                // Editor handles its own updates via polling or observing currentScene
                this.game.editor.refreshHierarchy(); // Optional: Explicit hook if game.editor exists
                // Better: SceneManager emits event.
            }

            console.log('Scene loaded successfully!');
            // Only notify if explicit? Or maybe "Scene loaded" is good debug.
            // But GDD implies "Scene saved..." is notification. "Scene loaded..." might be noise or notification.
            // Let's use notification.
        } catch (e) {
            console.error('Failed to load scene:', e);
            if (this.game.showNotification) this.game.showNotification('Error loading JSON');
        }
    }
}
