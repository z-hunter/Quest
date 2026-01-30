import { AssetLoader } from "./AssetLoader";
import { AudioManager } from "./AudioManager";
import { SceneManager } from "../scene/SceneManager";
import { SceneEditor } from "../tools/SceneEditor";
import { Entity } from "../entities/Entity";

export interface IGame {
    assets: AssetLoader;
    audio: AudioManager;
    sceneManager: SceneManager;
    editor: SceneEditor;
    inventory: Entity[];

    showMessage(text: string): void;
    showNotification?(text: string): void; // Optional
    onSceneChange?(sceneName: string): void;
    playSound(name: string): void;
    openFileBrowser(mode: 'load' | 'save', dir: string, callback: (file: string) => void, extension?: string): void;

    // Core property access needed by entities/systems
    input: any;
    isMouseOverUI?: boolean;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D | null;
    bufferCanvas: HTMLCanvasElement;
}
