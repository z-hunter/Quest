import React from 'react';
import { useGame } from '../../hooks/useGame';
import { useEditorStore } from '../../store/editorStore';

type ModifierMode = 'base' | 'shift' | 'alt' | 'ctrl';

type MenuEntry = {
  hotkey: string;
  text: string;
  action: string;
  enabled?: boolean;
};

export const EditorBottomMenu: React.FC = () => {
  const game = useGame();
  const {
    enabled: editorEnabled,
    toggle,
    toggleSpriteEditor,
    selectedObjectId,
    selectedObjectType,
    selectedObjectKeys,
    objectVersion,
  } = useEditorStore();

  const [fps, setFps] = React.useState(0);
  const [sceneMem, setSceneMem] = React.useState(0);
  const [sceneCount, setSceneCount] = React.useState(0);
  const [modifierMode, setModifierMode] = React.useState<ModifierMode>('base');

  React.useEffect(() => {
    const interval = setInterval(() => {
      setFps(game.fps);
      const stats = game.sceneManager.getSceneCacheStats();
      setSceneMem(stats.estimatedMemory);
      setSceneCount(stats.loadedScenes);
    }, 500);
    return () => clearInterval(interval);
  }, [game]);

  React.useEffect(() => {
    const getModifierMode = (e?: KeyboardEvent): ModifierMode => {
      const altGraph = !!e?.getModifierState?.('AltGraph') || e?.key === 'AltGraph';
      const ctrl = !!e?.ctrlKey;
      const alt = !!e?.altKey;
      const shift = !!e?.shiftKey;
      if (altGraph) return 'alt';
      if (ctrl && !alt) return 'ctrl';
      if (alt) return 'alt';
      if (shift) return 'shift';
      return 'base';
    };

    const syncModifierMode = (e?: KeyboardEvent) => {
      setModifierMode(getModifierMode(e));
    };

    const isMenuModifierKey = (e: KeyboardEvent) =>
      e.key === 'Alt' || e.key === 'AltGraph' || e.code === 'AltLeft' || e.code === 'AltRight';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (editorEnabled && isMenuModifierKey(e)) {
        e.preventDefault();
      }
      syncModifierMode(e);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (editorEnabled && isMenuModifierKey(e)) {
        e.preventDefault();
      }
      syncModifierMode(e);
    };

    const handleBlur = () => setModifierMode('base');

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [editorEnabled]);

  const selectedObject = game.editor?.selectedObject || null;
  const hasObjectSelection =
    (selectedObjectType === 'MULTI' &&
      Array.isArray(selectedObjectKeys) &&
      selectedObjectKeys.length > 0) ||
    (!!selectedObject && selectedObjectType !== 'SCENE' && selectedObjectType !== 'SETTINGS');
  const hasSingleSelectedObject =
    !!selectedObject && selectedObjectType !== 'SCENE' && selectedObjectType !== 'SETTINGS';
  const canHaveSprite =
    hasSingleSelectedObject &&
    (selectedObjectType === 'Static' ||
      selectedObjectType === 'Entity' ||
      selectedObjectType === 'Actor');
  void selectedObjectId;
  void objectVersion;

  const lockActionText = hasSingleSelectedObject
    ? selectedObject.locked
      ? 'Unlock'
      : 'Lock'
    : 'Lock';
  const disableActionText = hasSingleSelectedObject
    ? selectedObject.disabled
      ? 'Enable'
      : 'Disable'
    : 'Disable';

  const handleAction = (action: string) => {
    const editor = game.editor;

    switch (action) {
      case 'F1':
        toggle(false);
        break; // Close Editor
      case 'F2':
        editor.saveScene(false);
        break;
      case 'SaveAs':
        editor.saveScene(true);
        break;
      case 'SaveSelectionSlot1':
        editor.saveSelectionSlot(0);
        break;
      case 'SaveSelectionSlot2':
        editor.saveSelectionSlot(1);
        break;
      case 'F3':
        editor.promptLoadScene();
        break;
      case 'F4':
        editor.newScene();
        break;
      case 'F5':
        toggleSpriteEditor(true);
        break;
      case 'F9':
        editor.selectObject('SETTINGS');
        break;
      case 'Undo':
        editor.undo();
        break;
      case 'Redo':
        editor.redo();
        break;
      case 'Duplicate':
        editor.duplicateSelectedObject();
        break;
      case 'Copy':
        editor.copySelectedObjectToClipboard();
        break;
      case 'Paste':
        void editor.pasteObjectFromClipboard();
        break;
      case 'SaveSelection':
        editor.persistenceManager.saveObject();
        break;
      case 'LoadSelection':
        editor.persistenceManager.loadObject('cursor');
        break;
      case 'ToggleLock':
        if (editor.selectedObject) {
          editor.selectedObject.locked = !editor.selectedObject.locked;
          useEditorStore.getState().incrementObjectVersion();
          useEditorStore.getState().incrementHierarchyVersion();
        }
        break;
      case 'ToggleDisabled':
        if (editor.selectedObject) {
          editor.selectedObject.disabled = !editor.selectedObject.disabled;
          useEditorStore.getState().incrementObjectVersion();
          useEditorStore.getState().incrementHierarchyVersion();
        }
        break;
      case 'AssignSprite':
        if (
          editor.selectedObject &&
          (selectedObjectType === 'Static' ||
            selectedObjectType === 'Entity' ||
            selectedObjectType === 'Actor')
        ) {
          editor.persistenceManager.promptSetSprite();
        }
        break;
    }
  };

  const baseKeys: MenuEntry[] = [
    { hotkey: 'F1', text: 'Game', action: 'F1' },
    { hotkey: 'F2', text: 'Save', action: 'F2' },
    { hotkey: 'F3', text: 'Load', action: 'F3' },
    { hotkey: 'F4', text: 'New', action: 'F4' },
    { hotkey: 'F5', text: 'Sprite', action: 'F5' },
    { hotkey: 'F9', text: 'Settings', action: 'F9' },
  ];

  const shiftKeys: MenuEntry[] = [
    { hotkey: 'F2', text: 'Save As', action: 'SaveAs' },
    { hotkey: '1', text: 'Save Sel. 1', action: 'SaveSelectionSlot1', enabled: hasObjectSelection },
    { hotkey: '2', text: 'Save Sel. 2', action: 'SaveSelectionSlot2', enabled: hasObjectSelection },
  ];

  const altKeys: MenuEntry[] = [
    { hotkey: 'F2', text: 'Save As', action: 'SaveAs' },
    { hotkey: 'L', text: lockActionText, action: 'ToggleLock', enabled: hasSingleSelectedObject },
    {
      hotkey: 'D',
      text: disableActionText,
      action: 'ToggleDisabled',
      enabled: hasSingleSelectedObject,
    },
    {
      hotkey: 'S',
      text: 'Sprite',
      action: 'AssignSprite',
      enabled: canHaveSprite,
    },
  ];

  const ctrlKeys: MenuEntry[] = [
    { hotkey: 'Z', text: 'Undo', action: 'Undo' },
    { hotkey: 'Y', text: 'Redo', action: 'Redo' },
    { hotkey: 'D', text: 'Duplicate', action: 'Duplicate', enabled: hasObjectSelection },
    { hotkey: 'C', text: 'Copy', action: 'Copy', enabled: hasObjectSelection },
    { hotkey: 'V', text: 'Paste', action: 'Paste', enabled: true },
    { hotkey: 'S', text: 'Save Prefab', action: 'SaveSelection', enabled: hasObjectSelection },
    { hotkey: 'O', text: 'Load Prefab', action: 'LoadSelection', enabled: true },
  ];

  const keys =
    modifierMode === 'ctrl'
      ? ctrlKeys
      : modifierMode === 'alt'
        ? altKeys
        : modifierMode === 'shift'
          ? shiftKeys
          : baseKeys;

  return (
    <div className="editor-bottom-menu" style={{ zIndex: 2000 }}>
      <div className="mem-counter">{`MEM ${sceneMem} | ${sceneCount}`}</div>
      {keys.map((k) => (
        <button
          key={`${modifierMode}-${k.hotkey}-${k.text}`}
          className="e-menu-btn"
          onClick={() => handleAction(k.action)}
          disabled={k.enabled === false}
        >
          <span className="hotkey-accent">{k.hotkey}</span>
          {k.text}
        </button>
      ))}
      <div className="fps-counter">FPS: {fps}</div>
    </div>
  );
};
