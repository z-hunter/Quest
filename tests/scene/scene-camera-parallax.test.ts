import { describe, expect, it } from 'vitest';
import { updateSceneCamera } from '../../src/scene/SceneCamera';
import { createSceneFixture } from '../fixtures/sceneFactory';

describe('Scene camera parallax centering', () => {
  it('centers a parallaxed Player in screen space rather than raw world space', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 100, 100);
    player.parallax = 0.5;
    fixture.scene.cameraSpeed = 5;

    updateSceneCamera(fixture.scene, 200, { centeringDirX: 0, centeringDirY: 0 });

    expect(fixture.scene.camera.x).toBeCloseTo((100 + fixture.scene.camDeadzoneX) / 0.5, 6);
    expect(fixture.scene.camera.y).toBeCloseTo(
      (100 - player.height / 2 + fixture.scene.camDeadzoneY) / 0.5,
      6
    );
  });

  it('preserves the legacy camera target at P=1', () => {
    const fixture = createSceneFixture();
    const player = fixture.addPlayer('Hero', 100, 100);
    fixture.scene.cameraSpeed = 5;

    updateSceneCamera(fixture.scene, 200, { centeringDirX: 0, centeringDirY: 0 });

    expect(fixture.scene.camera.x).toBeCloseTo(100 + fixture.scene.camDeadzoneX, 6);
    expect(fixture.scene.camera.y).toBeCloseTo(
      100 - player.height / 2 + fixture.scene.camDeadzoneY,
      6
    );
  });
});
