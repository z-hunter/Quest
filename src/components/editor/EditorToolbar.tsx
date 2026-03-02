import React from 'react';
import { useGame } from '../../hooks/useGame';
import undoIcon from '../../assets/arrow-counter-clockwise.svg';
import pasteIcon from '../../assets/clipboard-text.svg';
import copyIcon from '../../assets/copy-simple.svg';
import saveIcon from '../../assets/floppy-disk.svg';
import loadIcon from '../../assets/folder-open.svg';
import deleteIcon from '../../assets/trash.svg';

export const EditorToolbar: React.FC = () => {
  const game = useGame();
  const uiScale = game?.settings?.editor?.uiScale || 1.0;

  const handleDelete = () => {
    game.editor.deleteSelectedObject();
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: '2px',
        marginBottom: '5px',
      }}
    >
      {/* Toolbar Icons - explicit px scaling */}
      <button
        className="toolbar-icon-btn"
        onClick={() => game.editor.saveObject()}
        title="Save Object (Ctrl+S)"
      >
        <img
          src={saveIcon}
          className="toolbar-icon"
          style={{ width: `${16 * uiScale}px`, height: `${16 * uiScale}px` }}
          alt="Save"
        />
      </button>
      <button
        className="toolbar-icon-btn"
        onClick={() => game.editor.loadObject()}
        title="Load Object (Ctrl+O)"
      >
        <img
          src={loadIcon}
          className="toolbar-icon"
          style={{ width: `${16 * uiScale}px`, height: `${16 * uiScale}px` }}
          alt="Load"
        />
      </button>
      <button className="toolbar-icon-btn" onClick={() => game.editor.undo()} title="Undo (Ctrl+Z)">
        <img
          src={undoIcon}
          className="toolbar-icon"
          style={{ width: `${16 * uiScale}px`, height: `${16 * uiScale}px` }}
          alt="Undo"
        />
      </button>
      <button className="toolbar-icon-btn" onClick={() => game.editor.redo()} title="Redo (Ctrl+Y)">
        <img
          src={undoIcon}
          className="toolbar-icon"
          style={{
            width: `${16 * uiScale}px`,
            height: `${16 * uiScale}px`,
            transform: 'scaleX(-1)',
          }}
          alt="Redo"
        />
      </button>
      <button
        className="toolbar-icon-btn"
        onClick={() => game.editor.copySelectedObjectToClipboard()}
        title="Copy (Ctrl+C)"
      >
        <img
          src={copyIcon}
          className="toolbar-icon"
          style={{ width: `${16 * uiScale}px`, height: `${16 * uiScale}px` }}
          alt="Copy"
        />
      </button>
      <button
        className="toolbar-icon-btn"
        onClick={() => game.editor.pasteObjectFromClipboard()}
        title="Paste (Ctrl+V)"
      >
        <img
          src={pasteIcon}
          className="toolbar-icon"
          style={{ width: `${16 * uiScale}px`, height: `${16 * uiScale}px` }}
          alt="Paste"
        />
      </button>
      <button className="toolbar-icon-btn" onClick={handleDelete} title="Delete Selected (Del)">
        <img
          src={deleteIcon}
          className="toolbar-icon"
          style={{ width: `${16 * uiScale}px`, height: `${16 * uiScale}px` }}
          alt="Delete"
        />
      </button>
    </div>
  );
};
