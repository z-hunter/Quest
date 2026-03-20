import React from 'react';
import { useGame } from '../../hooks/useGame';
import { useEditorStore } from '../../store/editorStore';

export const EditorBottomMenu: React.FC = () => {
  const game = useGame();
  const { toggle, toggleSpriteEditor } = useEditorStore();

  const [fps, setFps] = React.useState(0);
  const [sceneMem, setSceneMem] = React.useState(0);
  const [sceneCount, setSceneCount] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setFps(game.fps);
      const stats = game.sceneManager.getSceneCacheStats();
      setSceneMem(stats.estimatedMemory);
      setSceneCount(stats.loadedScenes);
    }, 500);
    return () => clearInterval(interval);
  }, [game]);

  const handleAction = (action: string) => {
    const editor = game.editor;

    switch (action) {
      case 'F1':
        toggle(false);
        break; // Close Editor
      case 'F2':
        editor.saveScene(false);
        break;
      case 'ShiftF2':
        editor.saveScene(true);
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
    }
  };

  const keys = [
    { label: 'F1 Game', action: 'F1' },
    { label: 'F2 Save', action: 'F2' },
    { label: 'F3 Load', action: 'F3' },
    { label: 'F4 New', action: 'F4' },
    { label: 'F5 Sprite', action: 'F5' },
    { label: 'F9 Settings', action: 'F9' },
  ];

  return (
    <div className="editor-bottom-menu" style={{ zIndex: 2000 }}>
      <div className="mem-counter">{`MEM ${sceneMem} | ${sceneCount}`}</div>
      {keys.map((k) => (
        <button key={k.label} className="e-menu-btn" onClick={() => handleAction(k.action)}>
          <span className="hotkey-accent">{k.label.split(' ')[0]}</span>
          {k.label.split(' ').slice(1).join(' ')}
        </button>
      ))}
      <div className="fps-counter">FPS: {fps}</div>
    </div>
  );
};
