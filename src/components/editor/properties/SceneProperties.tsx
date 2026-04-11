import React from 'react';
import { usePropertiesContext } from './PropertiesContext';

export const SceneProperties: React.FC = () => {
  const { game, obj, formatPanelNumber, setSectionRef, incrementObjectVersion, handleChange } =
    usePropertiesContext();

  if (!obj) return null;
  const scene = obj as any;

  return (
    <>
      {(scene.camera || scene.defaultCamera) && (
        <div ref={setSectionRef(1)} className="properties-section-block" data-section={1}>
          <div className="properties-section-header properties-section-blue">
            <div className="properties-section-title">
              <span className="properties-section-number properties-section-blue">1</span>
              <span className="properties-section-label">Camera</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}>
            <div>
              <label className="e-label">Cam X</label>
              <input
                type="number"
                className="e-input"
                value={scene.camera ? formatPanelNumber(scene.camera.x) : 0}
                onChange={(e) => {
                  if (scene.camera) {
                    scene.camera.x = parseFloat(e.target.value);
                    incrementObjectVersion();
                  }
                }}
              />
            </div>
            <div>
              <label className="e-label">Cam Y</label>
              <input
                type="number"
                className="e-input"
                value={scene.camera ? formatPanelNumber(scene.camera.y) : 0}
                onChange={(e) => {
                  if (scene.camera) {
                    scene.camera.y = parseFloat(e.target.value);
                    incrementObjectVersion();
                  }
                }}
              />
            </div>
            <div>
              <label className="e-label">Zoom</label>
              <input
                type="number"
                step="0.1"
                className="e-input"
                value={scene.camera ? formatPanelNumber(scene.camera.zoom) : 1}
                onChange={(e) => {
                  if (scene.camera) {
                    scene.camera.zoom = parseFloat(e.target.value);
                    incrementObjectVersion();
                  }
                }}
              />
            </div>
          </div>

          <div className="e-row" style={{ marginTop: '5px' }}>
            <label className="e-label" style={{ display: 'flex', alignItems: 'center' }}>
              <input
                type="checkbox"
                style={{ marginRight: '5px' }}
                checked={!!scene.autoCenter}
                onChange={(e) => handleChange('autoCenter', e.target.checked)}
              />
              Auto-Center on Player
            </label>
          </div>

          <div
            className="e-row"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}
          >
            <div>
              <label className="e-label">Cam Spd</label>
              <input
                type="number"
                step="0.1"
                className="e-input"
                value={formatPanelNumber(scene.cameraSpeed || 5)}
                onChange={(e) => handleChange('cameraSpeed', parseFloat(e.target.value), true)}
              />
            </div>
            <div>
              <label className="e-label">Dead X</label>
              <input
                type="number"
                className="e-input"
                value={formatPanelNumber(
                  scene.camDeadzoneX !== undefined ? scene.camDeadzoneX : 50
                )}
                onChange={(e) => handleChange('camDeadzoneX', parseFloat(e.target.value), true)}
              />
            </div>
            <div>
              <label className="e-label">Dead Y</label>
              <input
                type="number"
                className="e-input"
                value={formatPanelNumber(
                  scene.camDeadzoneY !== undefined ? scene.camDeadzoneY : 30
                )}
                onChange={(e) => handleChange('camDeadzoneY', parseFloat(e.target.value), true)}
              />
            </div>
          </div>

          <div className="e-row" style={{ marginTop: '5px' }}>
            <div className="e-label ui-text-accent-blue">Camera Bounds (Min/Max)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
              <div>
                <label className="e-label">Min X</label>
                <input
                  type="number"
                  className="e-input"
                  placeholder="None"
                  value={scene.camMinX !== undefined ? formatPanelNumber(scene.camMinX) : ''}
                  onChange={(e) =>
                    handleChange(
                      'camMinX',
                      e.target.value === '' ? undefined : parseFloat(e.target.value),
                      false
                    )
                  }
                />
              </div>
              <div>
                <label className="e-label">Max X</label>
                <input
                  type="number"
                  className="e-input"
                  placeholder="None"
                  value={scene.camMaxX !== undefined ? formatPanelNumber(scene.camMaxX) : ''}
                  onChange={(e) =>
                    handleChange(
                      'camMaxX',
                      e.target.value === '' ? undefined : parseFloat(e.target.value),
                      false
                    )
                  }
                />
              </div>
              <div>
                <label className="e-label">Min Y</label>
                <input
                  type="number"
                  className="e-input"
                  placeholder="None"
                  value={scene.camMinY !== undefined ? formatPanelNumber(scene.camMinY) : ''}
                  onChange={(e) =>
                    handleChange(
                      'camMinY',
                      e.target.value === '' ? undefined : parseFloat(e.target.value),
                      false
                    )
                  }
                />
              </div>
              <div>
                <label className="e-label">Max Y</label>
                <input
                  type="number"
                  className="e-input"
                  placeholder="None"
                  value={scene.camMaxY !== undefined ? formatPanelNumber(scene.camMaxY) : ''}
                  onChange={(e) =>
                    handleChange(
                      'camMaxY',
                      e.target.value === '' ? undefined : parseFloat(e.target.value),
                      false
                    )
                  }
                />
              </div>
            </div>
          </div>

          {scene.defaultCamera && (
            <div className="e-row" style={{ marginTop: '5px' }}>
              <div className="e-label ui-text-accent-blue">Default Camera</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}>
                <div>
                  <label className="e-label">Def X</label>
                  <input
                    type="number"
                    className="e-input"
                    value={formatPanelNumber(scene.defaultCamera.x)}
                    onChange={(e) => {
                      scene.defaultCamera.x = parseFloat(e.target.value);
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div>
                  <label className="e-label">Def Y</label>
                  <input
                    type="number"
                    className="e-input"
                    value={formatPanelNumber(scene.defaultCamera.y)}
                    onChange={(e) => {
                      scene.defaultCamera.y = parseFloat(e.target.value);
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div>
                  <label className="e-label">Def Zoom</label>
                  <input
                    type="number"
                    step="0.1"
                    className="e-input"
                    value={formatPanelNumber(scene.defaultCamera.zoom)}
                    onChange={(e) => {
                      scene.defaultCamera.zoom = parseFloat(e.target.value);
                      incrementObjectVersion();
                    }}
                  />
                </div>
              </div>
              <div className="e-row" style={{ marginTop: '5px' }}>
                <button
                  className="e-btn"
                  style={{ width: '100%' }}
                  onClick={() => {
                    if (scene.camera && scene.defaultCamera) {
                      scene.defaultCamera.x = scene.camera.x;
                      scene.defaultCamera.y = scene.camera.y;
                      scene.defaultCamera.zoom = scene.camera.zoom;
                      incrementObjectVersion();
                    }
                  }}
                >
                  Set Current as Default
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {game.sceneManager.currentScene && (
        <div ref={setSectionRef(2)} className="properties-section-block" data-section={2}>
          <div className="properties-section-header properties-section-yellow">
            <div className="properties-section-title">
              <span className="properties-section-number properties-section-yellow">2</span>
              <span className="properties-section-label">Scaling</span>
            </div>
          </div>
          {(() => {
            const s = game.sceneManager.currentScene.scaling;
            return (
              <>
                <div className="e-row">
                  <label className="e-label" style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      style={{ marginRight: '5px' }}
                      checked={s.enabled}
                      onChange={(e) => {
                        game.editor.setScalingEnabled(e.target.checked);
                        incrementObjectVersion();
                      }}
                    />
                    Enable Depth Scaling
                  </label>
                </div>
                {s.enabled && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                    <div>
                      <label className="e-label">Min</label>
                      <input
                        type="number"
                        step="0.1"
                        className="e-input"
                        value={formatPanelNumber(s.min)}
                        onChange={(e) => {
                          s.min = parseFloat(e.target.value);
                          incrementObjectVersion();
                        }}
                      />
                    </div>
                    <div>
                      <label className="e-label">Max</label>
                      <input
                        type="number"
                        step="0.1"
                        className="e-input"
                        value={formatPanelNumber(s.max)}
                        onChange={(e) => {
                          s.max = parseFloat(e.target.value);
                          incrementObjectVersion();
                        }}
                      />
                    </div>
                    <div>
                      <label className="e-label">Horizon Y</label>
                      <input
                        type="number"
                        className="e-input"
                        value={formatPanelNumber(s.horizon)}
                        onChange={(e) => {
                          s.horizon = parseFloat(e.target.value);
                          incrementObjectVersion();
                        }}
                      />
                    </div>
                    <div>
                      <label className="e-label">Front Y</label>
                      <input
                        type="number"
                        className="e-input"
                        value={formatPanelNumber(s.front)}
                        onChange={(e) => {
                          s.front = parseFloat(e.target.value);
                          incrementObjectVersion();
                        }}
                      />
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </>
  );
};
