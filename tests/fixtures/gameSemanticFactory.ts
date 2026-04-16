import { Game } from '../../src/core/Game';
import { Scene } from '../../src/scene/Scene';
import { createSceneFixture, type SceneFixture } from './sceneFactory';

export type GameSemanticFixture = SceneFixture & {
  addScene(id: string, name?: string, description?: string): Scene;
};

export function createGameSemanticFixture(sceneId: string = 'test_scene'): GameSemanticFixture {
  const fixture = createSceneFixture(sceneId);

  Object.setPrototypeOf(fixture.game, Game.prototype);
  for (const methodName of [
    'lookScene',
    'lookEntity',
    'examineEntity',
    'openEntity',
    'closeEntity',
    'closeFocusedView',
    'takeEntity',
    'putEntity',
    'addInventoryEntity',
    'removeEntityFromInventory',
    'hasInventoryEntity',
    'getInventoryEntities',
    'addEntityToSurface',
    'removeEntityFromSurface',
    'showInventory',
    'removeInventoryEntity',
    'goToSceneTarget',
    'goToScene',
    'goToEntity',
    'describeSpatialRelation',
    'getSeeMessage',
  ] as const) {
    delete (fixture.game as Record<string, unknown>)[methodName];
  }

  fixture.game.sceneManager.switchTo = (id: string) => {
    const scene = fixture.game.sceneManager.scenes.get(id);
    if (scene) {
      fixture.game.sceneManager.currentScene = scene;
      fixture.game.inventoryManager.handleSceneChange();
      if (fixture.game.onSceneChange) {
        fixture.game.onSceneChange(scene.name);
      }
    }
  };

  return {
    ...fixture,
    addScene(id: string, name = 'Extra Scene', description = `You are in ${name}.`) {
      const scene = new Scene(fixture.game, id, name);
      scene.description = description;
      fixture.game.sceneManager.scenes.set(id, scene);
      fixture.game.sceneManager.sceneRegistry.set(id, {
        id,
        path: `${id}.json`,
        name,
        title: name,
        sourceData: null,
        lastIndexed: Date.now(),
      });
      fixture.textAssets.setScene(id, {
        title: name,
        description,
      });
      return scene;
    },
  };
}
