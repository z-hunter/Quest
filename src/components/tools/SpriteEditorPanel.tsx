import React, { useEffect, useState } from 'react';
import { useGame } from '../../hooks/useGame';
import { useEditorStore } from '../../store/editorStore';

export const SpriteEditorPanel: React.FC = () => {
  const { spriteVersion, hierarchyVersion, toggleSpriteEditor, incrementSpriteVersion } =
    useEditorStore();
  const game = useGame();
  const spriteEditor = game.spriteEditor;
  const uiScale = game.settings.editor?.uiScale || 1.0;

  // Force re-render when spriteVersion changes
  const [, setTick] = useState(0);
  useEffect(() => {
    setTick((v) => v + 1);
  }, [spriteVersion, hierarchyVersion]);

  const handlePropChange = (field: string, value: any) => {
    (spriteEditor.sprite as any)[field] = value;
    spriteEditor.updatePreview();
    incrementSpriteVersion();
  };

  return (
    <div className="sprite-panel" style={{ zIndex: 2000, fontSize: `${12 * uiScale}px` }}>
      <div className="sprite-panel-header">
        <span className="font-bold text-yellow-500">SPRITE EDITOR ({uiScale.toFixed(1)}x)</span>
        <button className="e-btn e-btn-red e-btn-small" onClick={() => toggleSpriteEditor(false)}>
          [X]
        </button>
      </div>

      <div className="editor-content">
        <div className="e-row" style={{ display: 'flex', gap: '5px' }}>
          <div style={{ flex: 1, display: 'flex', gap: '5px' }}>
            <button className="e-btn" style={{ flex: 1 }} onClick={() => spriteEditor.newSprite()}>
              New (F4)
            </button>
            <button className="e-btn" style={{ flex: 1 }} onClick={() => spriteEditor.saveSprite()}>
              Save (F2)
            </button>
          </div>
        </div>
        <div className="e-row" style={{ display: 'flex', gap: '5px' }}>
          <div style={{ flex: 1, display: 'flex', gap: '5px' }}>
            <button className="e-btn" style={{ flex: 1 }} onClick={() => spriteEditor.loadSprite()}>
              Load (F3)
            </button>
            <button
              className="e-btn"
              style={{ flex: 1 }}
              onClick={() => spriteEditor.switchToSceneEditor()}
            >
              To Scene (F1)
            </button>
          </div>
        </div>

        <div className="e-row">
          <label className="e-label">Sprite ID</label>
          <input
            className="e-input"
            value={spriteEditor.sprite.id}
            onChange={(e) => handlePropChange('id', e.target.value)}
          />
        </div>

        <div className="e-row">
          <label className="e-label">Image File</label>
          <div style={{ display: 'flex', gap: '5px' }}>
            <input
              type="text"
              className="e-input"
              style={{ flex: 1 }}
              value={spriteEditor.sprite.imageFile}
              onChange={(e) => handlePropChange('imageFile', e.target.value)}
            />
            <button className="e-btn" onClick={() => spriteEditor.promptLoadImage()}>
              ...
            </button>
          </div>
        </div>

        <div
          className="e-row"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}
        >
          <div>
            <label className="e-label">X (Offset)</label>
            <input
              type="number"
              className="e-input"
              value={spriteEditor.sprite.x}
              onChange={(e) => handlePropChange('x', parseInt(e.target.value) || 0)}
            />
          </div>
          <div>
            <label className="e-label">Y (Offset)</label>
            <input
              type="number"
              className="e-input"
              value={spriteEditor.sprite.y}
              onChange={(e) => handlePropChange('y', parseInt(e.target.value) || 0)}
            />
          </div>
          <div>
            <label className="e-label">Width</label>
            <input
              type="number"
              className="e-input"
              value={spriteEditor.sprite.width}
              onChange={(e) => handlePropChange('width', parseInt(e.target.value) || 0)}
            />
          </div>
          <div>
            <label className="e-label">Height</label>
            <input
              type="number"
              className="e-input"
              value={spriteEditor.sprite.height}
              onChange={(e) => handlePropChange('height', parseInt(e.target.value) || 0)}
            />
          </div>
        </div>

        <div className="e-row">
          <label className="e-label">Frame Count</label>
          <input
            type="number"
            className="e-input"
            value={spriteEditor.sprite.frames}
            onChange={(e) => handlePropChange('frames', parseInt(e.target.value) || 1)}
          />
        </div>

        <div
          className="e-row"
          style={{ borderTop: '1px solid #444', paddingTop: '10px', marginTop: '10px' }}
        >
          <label className="e-label">Preview</label>
          <div
            style={{
              width: '100%',
              aspectRatio: '1/1',
              background: '#222',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #444',
            }}
          >
            <canvas
              id="se-preview-canvas"
              width="200"
              height="200"
              style={{ maxWidth: '100%', maxHeight: '100%' }}
            ></canvas>
          </div>
        </div>
      </div>
    </div>
  );
};
