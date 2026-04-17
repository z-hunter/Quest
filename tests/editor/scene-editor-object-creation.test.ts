import { describe, expect, it } from 'vitest';
import { SceneEditor } from '../../src/tools/SceneEditor';
import { createSceneFixture } from '../fixtures/sceneFactory';

function createHeadlessEditor(fixture: ReturnType<typeof createSceneFixture>): SceneEditor {
  (fixture.game.sceneManager as any).exposeEntitiesToWindow = () => {};
  return {
    game: fixture.game,
  } as SceneEditor;
}

describe('SceneEditor object creation', () => {
  it('restores serialized spatial placement for polygon scene objects', () => {
    const fixture = createSceneFixture();
    const editor = createHeadlessEditor(fixture);

    const restoredWalkbox = SceneEditor.prototype.createObjectFromData.call(editor, {
      type: 'Walkbox',
      name: 'Walk_Inside',
      mode: 'Subtract',
      poly: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      spatial: { parentNodeId: 'DeskCloseup', relation: 'in' },
      customName: 'Inner walk area',
      visible: false,
    });

    const restoredTriggerbox = SceneEditor.prototype.createObjectFromData.call(editor, {
      type: 'Triggerbox',
      name: 'DrawerSubscene',
      script: '',
      poly: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ],
      components: [{ type: 'Subscene', title: 'Drawer' }],
      spatial: { parentNodeId: 'DeskCloseup', relation: 'on' },
      hidden: 'lookable',
    });

    expect(restoredWalkbox.spatial).toEqual({ parentNodeId: 'DeskCloseup', relation: 'in' });
    expect(restoredWalkbox.mode).toBe('Subtract');
    expect(restoredWalkbox.customName).toBe('Inner walk area');
    expect(restoredWalkbox.visible).toBe(false);

    expect(restoredTriggerbox.spatial).toEqual({ parentNodeId: 'DeskCloseup', relation: 'on' });
    expect(restoredTriggerbox.components).toEqual([
      { type: 'Subscene', title: 'Drawer', targetGroupId: '' },
    ]);
    expect(restoredTriggerbox.hidden).toBe('lookable');
  });
});
