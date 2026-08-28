import React from 'react';
import { usePropertiesContext } from './PropertiesContext';
import { Select } from '../../common/Select';
import { isTauriRuntime } from '../../../platform/fileApi';
import { useEditorStore } from '../../../store/editorStore';
import { SoundManager } from '../../../systems/SoundManager';

interface GameSettings {
  editor?: {
    uiScale?: number;
    viewportZoom?: 'fit' | '1' | '1.5' | '2';
  };
  audio?: {
    attachedVolume?: number;
  };
  crt?: {
    enabled: boolean;
    curvature: number;
    vignette: number;
    scanlineCount: number;
    scanlineIntensity: number;
    aberration: number;
    bloom: number;
    glow?: number;
    persistence?: number;
    beamModulation?: number;
    humBar?: number;
    phosphor?: number;
    bezelGlow: boolean;
  };
}

export const SettingsProperties: React.FC = () => {
  const { obj, formatPanelNumber, incrementObjectVersion } = usePropertiesContext<GameSettings>();
  const isDesktopRuntime = React.useMemo(() => isTauriRuntime(), []);

  // obj = game.settings in the parent
  const settings = obj;

  return (
    <>
      <div className="e-row">
        <label
          className="e-label ui-text-accent-green ui-font-bold"
          style={{ marginBottom: '10px' }}
        >
          EDITOR SETTINGS
        </label>
      </div>

      {/* UI Scale */}
      <div className="e-row">
        <label className="e-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
          UI Scale <span>{formatPanelNumber(settings.editor?.uiScale || 1.0)}x</span>
        </label>
        <input
          type="number"
          className="e-input"
          min="0.5"
          max="2.0"
          step="0.1"
          value={formatPanelNumber(settings.editor?.uiScale || 1.0)}
          onChange={(e) => {
            if (!settings.editor) settings.editor = { uiScale: 1.0 };
            settings.editor.uiScale = parseFloat(e.target.value);
            incrementObjectVersion();
            useEditorStore.getState().incrementHierarchyVersion();
          }}
        />
      </div>

      {isDesktopRuntime && (
        <div className="e-row">
          <label className="e-label">Game Zoom</label>
          <Select
            value={settings.editor?.viewportZoom || 'fit'}
            onChange={(value) => {
              if (!settings.editor) settings.editor = { uiScale: 1.0, viewportZoom: 'fit' };
              settings.editor.viewportZoom = value as 'fit' | '1' | '1.5' | '2';
              incrementObjectVersion();
            }}
            options={[
              { value: 'fit', label: 'Fit to Window' },
              { value: '1', label: '100%' },
              { value: '1.5', label: '150%' },
              { value: '2', label: '200%' },
            ]}
            style={{ width: '100%' }}
          />
        </div>
      )}

      <div className="e-row" style={{ marginTop: '10px' }}>
        <label
          className="e-label ui-text-accent-green ui-font-bold"
          style={{ marginBottom: '10px' }}
        >
          AUDIO SETTINGS
        </label>
      </div>

      <div className="e-row">
        <label className="e-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
          Attached Volume <span>{formatPanelNumber(settings.audio?.attachedVolume ?? 1.0)}x</span>
        </label>
        <input
          type="number"
          className="e-input"
          min="0"
          max="10"
          step="0.05"
          value={formatPanelNumber(settings.audio?.attachedVolume ?? 1.0)}
          onChange={(e) => {
            if (!settings.audio) settings.audio = { attachedVolume: 1.0 };
            const val = parseFloat(e.target.value);
            if (Number.isFinite(val)) {
              settings.audio.attachedVolume = Math.max(0, Math.min(10, val));
              SoundManager.getInstance().setAttachedVolume(settings.audio.attachedVolume);
              incrementObjectVersion();
            }
          }}
        />
      </div>

      <div className="e-row" style={{ marginTop: '10px' }}>
        <label
          className="e-label ui-text-accent-green ui-font-bold"
          style={{ marginBottom: '10px' }}
        >
          CRT EFFECT SETTINGS
        </label>
      </div>

      {/* Enabled Toggle */}
      <div className="e-row">
        <label className="e-label" style={{ display: 'flex', alignItems: 'center' }}>
          <input
            type="checkbox"
            style={{ marginRight: '5px' }}
            checked={settings.crt?.enabled ?? true}
            onChange={(e) => {
              if (settings.crt) {
                settings.crt.enabled = e.target.checked;
                incrementObjectVersion();
              }
            }}
          />
          Enable CRT Filter
        </label>
      </div>

      {/* Controls (Only if enabled) */}
      {settings.crt?.enabled && (
        <>
          <div className="e-row">
            <label className="e-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              Curvature <span>{formatPanelNumber(settings.crt.curvature)}</span>
            </label>
            <input
              type="range"
              className="e-input"
              min="0"
              max="0.5"
              step="0.01"
              value={formatPanelNumber(settings.crt.curvature)}
              onChange={(e) => {
                settings.crt!.curvature = parseFloat(e.target.value);
                incrementObjectVersion();
              }}
            />
          </div>
          <div className="e-row">
            <label className="e-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              Vignette <span>{formatPanelNumber(settings.crt.vignette)}</span>
            </label>
            <input
              type="range"
              className="e-input"
              min="0"
              max="1"
              step="0.05"
              value={formatPanelNumber(settings.crt.vignette)}
              onChange={(e) => {
                settings.crt!.vignette = parseFloat(e.target.value);
                incrementObjectVersion();
              }}
            />
          </div>
          <div className="e-row">
            <label className="e-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              Scanline Count <span>{formatPanelNumber(settings.crt.scanlineCount)}</span>
            </label>
            <input
              type="range"
              className="e-input"
              min="0"
              max="600"
              step="10"
              value={formatPanelNumber(settings.crt.scanlineCount)}
              onChange={(e) => {
                settings.crt!.scanlineCount = parseFloat(e.target.value);
                incrementObjectVersion();
              }}
            />
          </div>
          {settings.crt.scanlineCount > 0 && (
            <>
              <div className="e-row">
                <label
                  className="e-label"
                  style={{ display: 'flex', justifyContent: 'space-between' }}
                >
                  Scanline Intensity{' '}
                  <span>{formatPanelNumber(settings.crt.scanlineIntensity)}</span>
                </label>
                <input
                  type="range"
                  className="e-input"
                  min="0"
                  max="1"
                  step="0.05"
                  value={formatPanelNumber(settings.crt.scanlineIntensity)}
                  onChange={(e) => {
                    settings.crt!.scanlineIntensity = parseFloat(e.target.value);
                    incrementObjectVersion();
                  }}
                />
              </div>
              {settings.crt.scanlineIntensity > 0 && (
                <div className="e-row">
                  <label
                    className="e-label"
                    style={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    Beam Modulation{' '}
                    <span>{formatPanelNumber(settings.crt.beamModulation ?? 0)}</span>
                  </label>
                  <input
                    type="range"
                    className="e-input"
                    min="0"
                    max="1"
                    step="0.05"
                    value={formatPanelNumber(settings.crt.beamModulation ?? 0)}
                    onChange={(e) => {
                      settings.crt!.beamModulation = parseFloat(e.target.value);
                      incrementObjectVersion();
                    }}
                  />
                </div>
              )}
            </>
          )}
          <div className="e-row">
            <label className="e-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              60 Hz Hum Bar <span>{formatPanelNumber(settings.crt.humBar ?? 0)}</span>
            </label>
            <input
              type="range"
              className="e-input"
              min="0"
              max="1"
              step="0.05"
              value={formatPanelNumber(settings.crt.humBar ?? 0)}
              onChange={(e) => {
                settings.crt!.humBar = parseFloat(e.target.value);
                incrementObjectVersion();
              }}
            />
          </div>
          <div className="e-row">
            <label className="e-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              RGB Split <span>{formatPanelNumber(settings.crt.aberration)}</span>
            </label>
            <input
              type="range"
              className="e-input"
              min="0"
              max="5"
              step="0.1"
              value={formatPanelNumber(settings.crt.aberration)}
              onChange={(e) => {
                settings.crt!.aberration = parseFloat(e.target.value);
                incrementObjectVersion();
              }}
            />
          </div>
          <div className="e-row">
            <label className="e-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              Bloom <span>{formatPanelNumber(settings.crt.bloom)}</span>
            </label>
            <input
              type="range"
              className="e-input"
              min="0"
              max="1"
              step="0.05"
              value={formatPanelNumber(settings.crt.bloom)}
              onChange={(e) => {
                settings.crt!.bloom = parseFloat(e.target.value);
                incrementObjectVersion();
              }}
            />
          </div>
          <div className="e-row">
            <label className="e-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              Screen Glow <span>{formatPanelNumber(settings.crt.glow ?? 0.2)}</span>
            </label>
            <input
              type="range"
              className="e-input"
              min="0"
              max="1"
              step="0.05"
              value={formatPanelNumber(settings.crt.glow ?? 0.2)}
              onChange={(e) => {
                settings.crt!.glow = parseFloat(e.target.value);
                incrementObjectVersion();
              }}
            />
          </div>
          <div className="e-row">
            <label className="e-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              Phosphor Trail <span>{formatPanelNumber(settings.crt.persistence ?? 0)}</span>
            </label>
            <input
              type="range"
              className="e-input"
              min="0"
              max="1"
              step="0.05"
              value={formatPanelNumber(settings.crt.persistence ?? 0)}
              onChange={(e) => {
                settings.crt!.persistence = parseFloat(e.target.value);
                incrementObjectVersion();
              }}
            />
          </div>
          <div className="e-row">
            <label className="e-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              Phosphor / Grain <span>{formatPanelNumber(settings.crt.phosphor || 0)}</span>
            </label>
            <input
              type="range"
              className="e-input"
              min="0"
              max="1"
              step="0.05"
              value={formatPanelNumber(settings.crt.phosphor || 0)}
              onChange={(e) => {
                settings.crt!.phosphor = parseFloat(e.target.value);
                incrementObjectVersion();
              }}
            />
          </div>
          <div className="e-row">
            <label className="e-label" style={{ display: 'flex', alignItems: 'center' }}>
              <input
                type="checkbox"
                style={{ marginRight: '5px' }}
                checked={settings.crt.bezelGlow}
                onChange={(e) => {
                  settings.crt!.bezelGlow = e.target.checked;
                  incrementObjectVersion();
                }}
              />
              Bezel Glow
            </label>
          </div>
        </>
      )}

      <div className="e-row ui-divider-neutral" style={{ marginTop: '20px', paddingTop: '10px' }}>
        <button
          className="e-btn"
          style={{ width: '100%', padding: '8px' }}
          onClick={() => {
            // Access game via window for settings panel - same pattern as before
            const g = (window as any).__QUEST_DEBUG__?.game;
            if (g && g.saveSettings) {
              g.saveSettings();
            }
          }}
        >
          SAVE SETTINGS
        </button>
      </div>
    </>
  );
};
