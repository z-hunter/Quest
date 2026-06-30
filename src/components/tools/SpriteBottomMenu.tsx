import React from 'react';
import { useGame } from '../../hooks/useGame';
import { useEditorStore } from '../../store/editorStore';
import { isTauriRuntime } from '../../platform/fileApi';

export const SpriteBottomMenu: React.FC = () => {
  const { toggleSpriteEditor } = useEditorStore();
  const game = useGame();
  const spriteEditor = game.spriteEditor;
  const [ctrlPressed, setCtrlPressed] = React.useState(false);
  const isBrowser = !isTauriRuntime();

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        setCtrlPressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        setCtrlPressed(false);
      }
    };
    const handleBlur = () => {
      setCtrlPressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  return (
    <div className="editor-bottom-menu">
      <button className="e-menu-btn" onClick={() => spriteEditor.switchToSceneEditor()}>
        <span className="hotkey-accent">F1</span> Scene
      </button>
      <button className="e-menu-btn" onClick={() => spriteEditor.saveSprite()}>
        <span className="hotkey-accent">F2</span> Save
      </button>
      <button className="e-menu-btn" onClick={() => spriteEditor.loadSprite()}>
        <span className="hotkey-accent">F3</span> Load
      </button>
      <button className="e-menu-btn" onClick={() => spriteEditor.newSprite()}>
        <span className="hotkey-accent">F4</span> New
      </button>
      <button className="e-menu-btn" onClick={() => toggleSpriteEditor(false)}>
        <span className="hotkey-accent">F5</span> Close
      </button>
      {ctrlPressed && isBrowser ? (
        <button className="e-menu-btn" onClick={() => window.open('/vetool.html', '_blank')}>
          <span className="hotkey-accent">F6</span> VETOOL TAB
        </button>
      ) : (
        <button
          className="e-menu-btn"
          onClick={() => {
            window.location.href = '/vetool.html';
          }}
        >
          <span className="hotkey-accent">F6</span> VETOOL
        </button>
      )}
    </div>
  );
};
