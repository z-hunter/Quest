import React from 'react';
import { useGame } from '../../hooks/useGame';
import { useEditorStore } from '../../store/editorStore';

export const SpriteBottomMenu: React.FC = () => {
  const { toggleSpriteEditor } = useEditorStore();
  const game = useGame();
  const spriteEditor = game.spriteEditor;

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
    </div>
  );
};
