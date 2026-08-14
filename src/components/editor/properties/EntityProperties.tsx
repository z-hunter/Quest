import React from 'react';
import { usePropertiesContext } from './PropertiesContext';
import { Select } from '../../common/Select';
import {
  renderOpacityBlurControls,
  renderSpriteEffectsControls,
  renderSection,
} from './propertiesUtils';

interface EntityObject {
  x: number;
  y: number;
  width: number;
  height: number;
  refScale: number;
  modelScale: number;
  layer: number;
  parallax: number;
  depthSortMode: 'manual' | 'parallax' | 'y';
  colliderHeight: number;
  colliderWidth: number;
  ignoreScaling: boolean;
  color: string;
  blendMode: string;
  opacity: number;
  blur: number;
  brightness: number;
  saturation: number;
  contrast: number;
  hueShift: number;
  spriteName: string | null;
}

export const EntityProperties: React.FC = () => {
  const { game, obj, handleChange, formatPanelNumber, setSectionRef } =
    usePropertiesContext<EntityObject>();
  const entity = obj;

  return (
    <>
      {renderSection(
        1,
        'Transform',
        'blue',
        <>
          <div
            className="e-row"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '5px' }}
          >
            <div>
              <label className="e-label">X</label>
              <input
                type="number"
                className="e-input"
                value={formatPanelNumber(entity.x ?? 0)}
                onChange={(e) => handleChange('x', e.target.value, true)}
              />
            </div>
            <div>
              <label className="e-label">Y</label>
              <input
                type="number"
                className="e-input"
                value={formatPanelNumber(entity.y ?? 0)}
                onChange={(e) => handleChange('y', e.target.value, true)}
              />
            </div>
            <div>
              <label className="e-label">H</label>
              <input
                type="number"
                className="e-input"
                value={formatPanelNumber(entity.height ?? 0)}
                onChange={(e) => handleChange('height', e.target.value, true)}
              />
            </div>
            <div>
              <label className="e-label">W</label>
              <input
                type="number"
                className="e-input"
                value={formatPanelNumber(entity.width ?? 0)}
                onChange={(e) => handleChange('width', e.target.value, true)}
              />
            </div>
          </div>

          <div
            className="e-row"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}
          >
            <div>
              <label className="e-label">Scale</label>
              <input
                type="number"
                step="0.1"
                className="e-input"
                value={formatPanelNumber(entity.refScale || entity.modelScale || 1)}
                onChange={(e) => handleChange('refScale', e.target.value, true)}
              />
            </div>
            <div>
              <label className="e-label">Layer</label>
              <input
                type="number"
                className="e-input"
                value={formatPanelNumber(entity.layer || 0)}
                onChange={(e) => handleChange('layer', e.target.value, true)}
              />
            </div>
            <div>
              <label className="e-label">Parallax</label>
              <input
                type="number"
                step="0.1"
                className="e-input"
                value={formatPanelNumber(entity.parallax ?? 1)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  const newP = isNaN(val) ? 1.0 : val;
                  const oldP = entity.parallax !== undefined ? entity.parallax : 1.0;
                  const scene = game.sceneManager.currentScene;
                  if (scene && game.editor.selectedObject) {
                    const camX = scene.camera.x;
                    const camY = scene.camera.y;
                    entity.x += camX * (newP - oldP);
                    entity.y += camY * (newP - oldP);
                    if (
                      game.editor &&
                      game.editor.selectedObject &&
                      'x' in game.editor.selectedObject
                    ) {
                      const sel = game.editor.selectedObject as unknown as EntityObject;
                      sel.x = entity.x;
                      sel.y = entity.y;
                    }
                  }
                  handleChange('parallax', newP, true);
                }}
              />
            </div>
          </div>

          <div className="e-row">
            <label className="e-label">Depth Sort mode</label>
            <Select
              value={entity.depthSortMode || 'y'}
              onChange={(value) => handleChange('depthSortMode', value)}
              options={[
                { value: 'y', label: 'By Y' },
                { value: 'parallax', label: 'By Parallax' },
                { value: 'manual', label: 'Manual (Layer only)' },
              ]}
              style={{ width: '100%' }}
            />
          </div>

          <div
            className="e-row"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}
          >
            <div>
              <label className="e-label">Collider H</label>
              <input
                type="number"
                className="e-input"
                value={formatPanelNumber(entity.colliderHeight ?? 0)}
                onChange={(e) => handleChange('colliderHeight', e.target.value, true)}
              />
            </div>
            <div>
              <label className="e-label">Collider W</label>
              <input
                type="number"
                className="e-input"
                value={formatPanelNumber(entity.colliderWidth ?? 0)}
                onChange={(e) => handleChange('colliderWidth', e.target.value, true)}
              />
            </div>
          </div>

          <div className="e-row">
            <label className="e-label" style={{ display: 'flex', alignItems: 'center' }}>
              <input
                type="checkbox"
                style={{ marginRight: '5px' }}
                checked={!!entity.ignoreScaling}
                onChange={(e) => handleChange('ignoreScaling', e.target.checked)}
              />
              Disable Depth-scaling
            </label>
          </div>
        </>,
        setSectionRef
      )}

      {renderSection(
        2,
        'Visual',
        'yellow',
        <>
          <div
            className="e-row"
            style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '5px' }}
          >
            <div>
              <label className="e-label">Fill Color</label>
              <div style={{ display: 'flex', gap: '5px' }}>
                <input
                  type="color"
                  className="e-input"
                  style={{
                    width: '30px',
                    padding: 0,
                    height: '20px',
                    cursor: 'pointer',
                    border: 'none',
                  }}
                  value={entity.color || '#AAAAAA'}
                  onChange={(e) => handleChange('color', e.target.value)}
                />
                <input
                  type="text"
                  className="e-input"
                  style={{ flex: 1, minWidth: 0 }}
                  value={entity.color || ''}
                  onChange={(e) => handleChange('color', e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="e-label">Blend Mode</label>
              <Select
                value={entity.blendMode || 'source-over'}
                onChange={(value) => handleChange('blendMode', value)}
                options={[
                  { value: 'source-over', label: 'Normal' },
                  { value: 'multiply', label: 'Multiply' },
                  { value: 'screen', label: 'Screen' },
                  { value: 'overlay', label: 'Overlay' },
                  { value: 'lighter', label: 'Add' },
                  { value: 'difference', label: 'Diff' },
                ]}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          {renderOpacityBlurControls(
            entity.opacity !== undefined ? entity.opacity : 1.0,
            entity.blur || 0,
            (nextOpacity) => handleChange('opacity', nextOpacity, true),
            (nextBlur) => handleChange('blur', nextBlur)
          )}

          {renderSpriteEffectsControls(
            entity.brightness !== undefined ? entity.brightness : 1.0,
            entity.saturation !== undefined ? entity.saturation : 1.0,
            entity.contrast !== undefined ? entity.contrast : 1.0,
            entity.hueShift !== undefined ? entity.hueShift : 0,
            (v) => handleChange('brightness', v),
            (v) => handleChange('saturation', v),
            (v) => handleChange('contrast', v),
            (v) => handleChange('hueShift', v)
          )}

          <div className="e-row">
            <label className="e-label">Sprite</label>
            <div style={{ display: 'flex', gap: '5px' }}>
              <input
                type="text"
                className="e-input"
                style={{ flex: 1 }}
                value={entity.spriteName || ''}
                onChange={(e) => handleChange('spriteName', e.target.value)}
              />
              <button
                className="e-btn"
                onClick={() =>
                  game.openFileBrowser('load', 'public/sprites', (f) =>
                    handleChange('spriteName', f)
                  )
                }
              >
                ...
              </button>
            </div>
          </div>
        </>,
        setSectionRef
      )}
    </>
  );
};
