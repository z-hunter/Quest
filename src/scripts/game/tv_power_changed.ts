import { ScriptRegistry } from '../../core/ScriptRegistry';
import type { SceneObject } from '../../entities/SceneObject';

const GROUP_TAG = '#tv_glow';
const GLOW_SCRIPT_ID = 'tv_glow';

const hasGroupTag = (groupID: string | null | undefined, tag: string): boolean =>
  String(groupID || '')
    .split(',')
    .map((entry) => entry.trim())
    .includes(tag);

ScriptRegistry.register('tv_power_changed', ({ game, args }) => {
  const value = args?.value;
  if (value !== 'on' && value !== 'off') return;

  const scene = game.sceneManager.currentScene;
  const sceneObjects: SceneObject[] =
    typeof scene?.getAllSceneObjects === 'function' ? scene.getAllSceneObjects() : [];

  sceneObjects
    .filter((object) => hasGroupTag((object as any).groupID, GROUP_TAG))
    .forEach((object) => {
      object.disabled = value === 'off';
    });

  if (value === 'on') {
    if (ScriptRegistry.isRunning(GLOW_SCRIPT_ID)) {
      ScriptRegistry.stop(GLOW_SCRIPT_ID);
    }
    if (ScriptRegistry.has(GLOW_SCRIPT_ID)) {
      ScriptRegistry.execute(GLOW_SCRIPT_ID, { game });
    }
    return;
  }

  ScriptRegistry.stop(GLOW_SCRIPT_ID);
});
