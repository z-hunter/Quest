import { describe, expect, it } from 'vitest';
import { updateSceneCamera } from '../../src/scene/SceneCamera';
import { EditorTransformManager } from '../../src/tools/editor/EditorTransformManager';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('Scene editor camera autoCenter preservation and suspension', () => {
  it('does not center camera on player when editor is open and follow is suspended, until player moves', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 100, 100);
    fixture.scene.cameraSpeed = 5;
    fixture.scene.autoCenter = true;

    // Simulate editor enabled
    (fixture.scene.game as any).editor = { enabled: true };

    // User pans camera in editor to (500, 300)
    fixture.scene.camera.x = 500;
    fixture.scene.camera.y = 300;
    fixture.scene.suspendEditorCameraFollow();

    // With editor open and follow suspended, updateSceneCamera should NOT move camera
    const state1 = updateSceneCamera(fixture.scene, 200, { centeringDirX: 0, centeringDirY: 0 });
    expect(fixture.scene.camera.x).toBe(500);
    expect(fixture.scene.camera.y).toBe(300);
    expect(fixture.scene.autoCenter).toBe(true);

    // Player moves from (100, 100) to (150, 100)
    player.x = 150;

    // Camera follow should now resume and move towards the player
    updateSceneCamera(fixture.scene, 200, state1);
    expect(fixture.scene.camera.x).not.toBe(500);
    expect(fixture.scene.editorCameraSuspended).toBe(false);
  });

  it('resumes camera follow if editor is closed', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 100, 100);
    fixture.scene.cameraSpeed = 5;
    fixture.scene.autoCenter = true;

    // Follow was suspended in editor
    (fixture.scene.game as any).editor = { enabled: false };
    fixture.scene.camera.x = 500;
    fixture.scene.camera.y = 300;
    fixture.scene.suspendEditorCameraFollow();

    // Since editor is NOT open, camera follow should immediately resume
    updateSceneCamera(fixture.scene, 200, { centeringDirX: 0, centeringDirY: 0 });
    expect(fixture.scene.camera.x).not.toBe(500);
    expect(fixture.scene.editorCameraSuspended).toBe(false);
  });

  it('preserves autoCenter as false if autoCenter was intentionally set to false', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 100, 100);
    fixture.scene.cameraSpeed = 5;
    fixture.scene.autoCenter = false;

    (fixture.scene.game as any).editor = { enabled: true };
    fixture.scene.camera.x = 500;
    fixture.scene.camera.y = 300;

    updateSceneCamera(fixture.scene, 200, { centeringDirX: 0, centeringDirY: 0 });
    expect(fixture.scene.camera.x).toBe(500);

    player.x = 200;
    updateSceneCamera(fixture.scene, 200, { centeringDirX: 0, centeringDirY: 0 });
    // Still does not follow because autoCenter is false
    expect(fixture.scene.camera.x).toBe(500);
  });

  it('preserves scene.autoCenter=true when panning with EditorTransformManager', () => {
    const fixture = createSceneFixture();
    fixture.addPlayer('Hero', 100, 100);
    fixture.scene.autoCenter = true;

    const editor = {
      enabled: true,
      game: fixture.game,
      selectionManager: {
        hasMultiSelection: () => false,
        notifyObjectChanged: () => {},
      },
    };
    (fixture.game as any).canvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      width: 800,
      height: 600,
    };
    (fixture.game as any).sceneManager = { currentScene: fixture.scene };
    (fixture.game as any).editor = editor;

    const transformManager = new EditorTransformManager(editor as any);

    // Simulate right-click mouse down (start pan)
    transformManager.onMouseDown({
      button: 2,
      clientX: 200,
      clientY: 200,
      preventDefault: () => {},
    } as MouseEvent);

    // Check autoCenter is NOT set to false
    expect(fixture.scene.autoCenter).toBe(true);
    expect(fixture.scene.editorCameraSuspended).toBe(true);

    // Simulate mouse move during panning
    transformManager.onMouseMove({
      clientX: 250,
      clientY: 250,
    } as MouseEvent);

    expect(fixture.scene.autoCenter).toBe(true);
    expect(fixture.scene.editorCameraSuspended).toBe(true);
    expect(fixture.scene.camera.x).toBe(-50);
    expect(fixture.scene.camera.y).toBe(-50);
  });
});
