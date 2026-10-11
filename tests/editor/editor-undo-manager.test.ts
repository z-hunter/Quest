import { describe, expect, it, vi } from 'vitest';
import { EditorUndoManager } from '../../src/tools/editor/EditorUndoManager';

describe('EditorUndoManager', () => {
  it('restores serialized scene settings, preserves the current camera view, and tracks dirty state', () => {
    const initial = {
      id: 'room',
      name: 'Room',
      filename: 'room.json',
      scaling: { enabled: true, min: 0.5, max: 1.5, horizon: 100, front: 200 },
      camera: { x: 10, y: 20, zoom: 1 },
      camMinX: 0,
      autoCenter: true,
      cameraSpeed: 5,
      camDeadzoneX: 50,
      camDeadzoneY: 30,
      box3dPerspective: 1,
      box3dOcclusionMode: 'exact',
      camMaxX: 500,
      soundEnv: { audioMaxDistance: 1000 },
      textRedirects: { old: 'new' },
      displayOrder: ['item'],
      entities: [],
      folders: [],
      walkbox: [],
      triggerboxes: [],
    };
    const scene: any = {
      ...initial,
      defaultCamera: { ...initial.camera },
      camera: { x: 300, y: 400, zoom: 2 },
      soundEnv: { ...initial.soundEnv, reverbMaxDist: 200 },
      toJSON: () => ({
        ...initial,
        id: scene.id,
        filename: scene.filename,
        scaling: { ...scene.scaling },
        camera: { ...scene.defaultCamera },
        soundEnv: { ...scene.soundEnv },
        cameraSpeed: scene.cameraSpeed,
        box3dOcclusionMode: scene.box3dOcclusionMode,
        camMinX: scene.camMinX,
        textRedirects: { ...scene.textRedirects },
        displayOrder: [...scene.displayOrder],
      }),
    };
    const editor: any = {
      game: {
        sceneManager: { currentScene: scene, syncSceneRegistration: vi.fn() },
        showNotification: vi.fn(),
      },
      createObjectFromData: vi.fn(),
      selectObject: vi.fn(),
      transformManager: { drawMode: false },
      refreshHierarchy: vi.fn(),
    };
    const undo = new EditorUndoManager(editor);
    undo.markSaved();
    undo.saveUndoState();
    scene.cameraSpeed = 12;
    scene.box3dOcclusionMode = 'fast';
    scene.defaultCamera = { x: 70, y: 80, zoom: 1.5 };
    scene.scaling = { ...scene.scaling, max: 3, correctionalScale: 4 };
    scene.soundEnv.audioMaxDistance = 5000;
    scene.soundEnv.currentOnly = true;
    scene.camMinX = undefined;
    scene.textRedirects.old = 'changed';
    scene.displayOrder = [];
    scene.id = 'room-renamed';
    scene.filename = 'renamed.json';

    undo.undo();

    expect(scene.cameraSpeed).toBe(5);
    expect(scene.box3dOcclusionMode).toBe('exact');
    expect(scene.defaultCamera).toEqual(initial.camera);
    expect(scene.scaling.max).toBe(1.5);
    expect(scene.scaling).not.toHaveProperty('correctionalScale');
    expect(scene.camMinX).toBe(0);
    expect(scene.textRedirects).toEqual({ old: 'new' });
    expect(scene.displayOrder).toEqual(['item']);
    expect(scene.soundEnv).toEqual({ audioMaxDistance: 1000, reverbMaxDist: 200 });
    expect(scene.camera).toEqual({ x: 300, y: 400, zoom: 2 });
    expect(scene.id).toBe('room');
    expect(scene.filename).toBe('room.json');
    expect(editor.game.sceneManager.syncSceneRegistration).toHaveBeenCalledWith(
      scene,
      'room-renamed',
      expect.anything(),
      false
    );
    expect(undo.isDirty()).toBe(false);

    undo.redo();

    expect(scene.cameraSpeed).toBe(12);
    expect(scene.box3dOcclusionMode).toBe('fast');
    expect(scene.defaultCamera).toEqual({ x: 70, y: 80, zoom: 1.5 });
    expect(scene.scaling.max).toBe(3);
    expect(scene.scaling.correctionalScale).toBe(4);
    expect(scene.soundEnv.audioMaxDistance).toBe(5000);
    expect(scene.camera).toEqual({ x: 300, y: 400, zoom: 2 });
    expect(scene.id).toBe('room-renamed');
    expect(scene.filename).toBe('renamed.json');
    expect(undo.isDirty()).toBe(true);
  });
});
