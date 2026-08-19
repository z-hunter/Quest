import React from 'react';
import { usePropertiesContext } from './PropertiesContext';
import { Scene } from '../../../scene/Scene';
import {
  SoundManager,
  type DistanceModelType,
  type PanningModelType,
} from '../../../systems/SoundManager';

type NumberDraftInputProps = {
  value: number;
  step?: string;
  min?: string;
  max?: string;
  className?: string;
  formatPanelNumber: (value: unknown) => number | string;
  onCommit: (value: number) => void;
};

const NumberDraftInput: React.FC<NumberDraftInputProps> = ({
  value,
  step,
  min,
  max,
  className,
  formatPanelNumber,
  onCommit,
}) => {
  const [draft, setDraft] = React.useState(String(formatPanelNumber(value)));
  const [focused, setFocused] = React.useState(false);

  React.useEffect(() => {
    if (!focused) {
      setDraft(String(formatPanelNumber(value)));
    }
  }, [focused, formatPanelNumber, value]);

  return (
    <input
      type="number"
      step={step}
      min={min}
      max={max}
      className={className}
      value={focused ? draft : formatPanelNumber(value)}
      onFocus={() => {
        setFocused(true);
        setDraft(String(formatPanelNumber(value)));
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return;
        const next = Number(raw);
        if (Number.isFinite(next)) {
          onCommit(next);
        }
      }}
      onBlur={() => {
        setFocused(false);
        setDraft(String(formatPanelNumber(value)));
      }}
    />
  );
};

export const SceneProperties: React.FC = () => {
  const { game, obj, formatPanelNumber, setSectionRef, incrementObjectVersion, handleChange } =
    usePropertiesContext<Scene>();

  if (!obj) return null;
  const scene = obj;

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
                    scene.suspendEditorCameraFollow?.();
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
                    scene.suspendEditorCameraFollow?.();
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
                onChange={(e) => {
                  handleChange('autoCenter', e.target.checked);
                  if (e.target.checked) {
                    scene.resumeEditorCameraFollow?.();
                  }
                }}
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
                  <NumberDraftInput
                    step="0.01"
                    className="e-input"
                    value={scene.defaultCamera.zoom}
                    formatPanelNumber={formatPanelNumber}
                    onCommit={(value) => {
                      scene.defaultCamera.zoom = value;
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
                  <div className="e-label ui-text-accent-blue">Depth Scaling</div>
                </div>
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
                <div className="e-row" style={{ marginTop: '8px' }}>
                  <div className="e-label ui-text-accent-blue">Correction</div>
                </div>
                <div className="e-row">
                  <label className="e-label">Correctional Scale</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0.01"
                    className="e-input"
                    value={formatPanelNumber(s.correctionalScale ?? 1)}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      scene.applyCorrectionalScaleChange(Number.isFinite(val) && val > 0 ? val : 1);
                      incrementObjectVersion();
                    }}
                  />
                </div>
              </>
            );
          })()}
        </div>
      )}

      {scene.soundEnv && (
        <div ref={setSectionRef(3)} className="properties-section-block" data-section={3}>
          <div className="properties-section-header properties-section-red">
            <div className="properties-section-title">
              <span className="properties-section-number properties-section-red">3</span>
              <span className="properties-section-label">3D SOUND ENV.</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
            <div>
              <label className="e-label">Max Distance</label>
              <input
                type="number"
                className="e-input"
                value={formatPanelNumber(scene.soundEnv.audioMaxDistance)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    scene.soundEnv.audioMaxDistance = val;
                    SoundManager.getInstance().setEnvironment(scene.soundEnv);
                    incrementObjectVersion();
                  }
                }}
              />
            </div>
            <div>
              <label className="e-label">Reverb Drown Dist</label>
              <input
                type="number"
                className="e-input"
                value={formatPanelNumber(scene.soundEnv.reverbMaxDist)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    scene.soundEnv.reverbMaxDist = val;
                    SoundManager.getInstance().setEnvironment(scene.soundEnv);
                    incrementObjectVersion();
                  }
                }}
              />
            </div>
            <div>
              <label className="e-label">Reverb Min %</label>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                className="e-input"
                value={formatPanelNumber(scene.soundEnv.reverbMinPercent)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    scene.soundEnv.reverbMinPercent = Math.max(0, Math.min(1, val));
                    SoundManager.getInstance().setEnvironment(scene.soundEnv);
                    incrementObjectVersion();
                  }
                }}
              />
            </div>
            <div>
              <label className="e-label">Zoom Sensitivity</label>
              <input
                type="number"
                step="0.1"
                className="e-input"
                value={formatPanelNumber(scene.soundEnv.zoomSensitivity)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    scene.soundEnv.zoomSensitivity = val;
                    SoundManager.getInstance().setEnvironment(scene.soundEnv);
                    incrementObjectVersion();
                  }
                }}
              />
            </div>
            <div>
              <label className="e-label">Ref Distance</label>
              <input
                type="number"
                className="e-input"
                value={formatPanelNumber(scene.soundEnv.pannerRefDistance)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    scene.soundEnv.pannerRefDistance = val;
                    SoundManager.getInstance().setEnvironment(scene.soundEnv);
                    incrementObjectVersion();
                  }
                }}
              />
            </div>
            <div>
              <label className="e-label">Rolloff Factor</label>
              <input
                type="number"
                step="0.1"
                className="e-input"
                value={formatPanelNumber(scene.soundEnv.pannerRolloffFactor)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    scene.soundEnv.pannerRolloffFactor = val;
                    SoundManager.getInstance().setEnvironment(scene.soundEnv);
                    incrementObjectVersion();
                  }
                }}
              />
            </div>
            <div>
              <label className="e-label">Panning Model</label>
              <select
                className="e-input"
                value={scene.soundEnv.panningModel}
                onChange={(e) => {
                  scene.soundEnv.panningModel = e.target.value as PanningModelType;
                  SoundManager.getInstance().setEnvironment(scene.soundEnv);
                  incrementObjectVersion();
                }}
              >
                <option value="HRTF">HRTF</option>
                <option value="equalpower">Equal Power</option>
              </select>
            </div>
            <div>
              <label className="e-label">Distance Model</label>
              <select
                className="e-input"
                value={scene.soundEnv.distanceModel}
                onChange={(e) => {
                  scene.soundEnv.distanceModel = e.target.value as DistanceModelType;
                  SoundManager.getInstance().setEnvironment(scene.soundEnv);
                  incrementObjectVersion();
                }}
              >
                <option value="linear">Linear</option>
                <option value="inverse">Inverse</option>
                <option value="exponential">Exponential</option>
              </select>
            </div>
          </div>

          <div className="e-row" style={{ marginTop: '5px' }}>
            <label className="e-label">Default Reverb IR</label>
            <div style={{ display: 'flex', gap: '5px' }}>
              <input
                type="text"
                className="e-input"
                style={{ flex: 1 }}
                placeholder="None (Dry)"
                value={scene.soundEnv.defaultReverbIR || ''}
                onChange={(e) => {
                  scene.soundEnv.defaultReverbIR = e.target.value;
                  SoundManager.getInstance().setEnvironment(scene.soundEnv);
                  incrementObjectVersion();
                }}
              />
              <button
                className="e-btn"
                title="Select IR File"
                onClick={() => {
                  game.openFileBrowser('load', 'public/sounds/ir', (file) => {
                    // Extract relative path from public/sounds/ir/...
                    // 1. Normalize slashes
                    const normalized = file.replace(/\\/g, '/');
                    // 2. Extract path after 'public/' if present
                    const pubMatch = normalized.match(/\/public\/(.*)$/i);
                    let relative = pubMatch ? pubMatch[1] : normalized;
                    // 3. If no 'public/', check for 'sounds/'
                    if (!pubMatch && relative.includes('sounds/')) {
                      relative = relative.substring(relative.indexOf('sounds/'));
                    }
                    if (!pubMatch && !relative.includes('/')) {
                      relative = `sounds/ir/${relative}`;
                    }
                    // 4. Strip unwanted extensions like .json
                    relative = relative.replace(/\.json$/i, '');
                    // 5. Ensure starts with /
                    if (!relative.startsWith('/')) relative = '/' + relative;

                    scene.soundEnv.defaultReverbIR = relative;
                    SoundManager.getInstance().setEnvironment(scene.soundEnv);
                    incrementObjectVersion();
                  });
                }}
              >
                ...
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
