import React from 'react';
import { CRTSettingsSection, DisplaySettingsSection } from 'scanline-virtual-screen/react';
import 'scanline-virtual-screen/react/styles.css';
import { usePropertiesContext } from './PropertiesContext';
import { isTauriRuntime } from '../../../platform/fileApi';
import { useEditorStore } from '../../../store/editorStore';
import { SoundManager } from '../../../systems/SoundManager';
import { QUEST_SCREEN_MODES, type QuestSettings } from '../../../core/displaySettings';
import type { ScreenProfile } from 'scanline-virtual-screen/core';

export const SettingsProperties: React.FC = () => {
  const { obj, game, formatPanelNumber, incrementObjectVersion } =
    usePropertiesContext<QuestSettings>();
  const isDesktopRuntime = React.useMemo(() => isTauriRuntime(), []);
  const settings = obj;

  const updateScreenProfile = (profile: ScreenProfile): void => {
    game.setScreenProfile(profile);
    incrementObjectVersion();
  };

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

      <div className="e-row">
        <label className="e-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
          UI Scale <span>{formatPanelNumber(settings.editor.uiScale || 1.0)}x</span>
        </label>
        <input
          type="number"
          className="e-input"
          min="0.5"
          max="2.0"
          step="0.1"
          value={formatPanelNumber(settings.editor.uiScale || 1.0)}
          onChange={(event) => {
            const value = parseFloat(event.target.value);
            if (!Number.isFinite(value)) return;
            settings.editor.uiScale = value;
            incrementObjectVersion();
            useEditorStore.getState().incrementHierarchyVersion();
          }}
        />
      </div>

      {isDesktopRuntime && (
        <div className="e-row">
          <label className="e-label">Game Zoom</label>
          <select
            className="e-input"
            value={settings.editor.viewportZoom}
            onChange={(event) => {
              settings.editor.viewportZoom = event.target
                .value as QuestSettings['editor']['viewportZoom'];
              incrementObjectVersion();
            }}
          >
            <option value="fit">Fit to Window</option>
            <option value="1">100%</option>
            <option value="1.5">150%</option>
            <option value="2">200%</option>
          </select>
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
          Attached Volume <span>{formatPanelNumber(settings.audio.attachedVolume ?? 1.0)}x</span>
        </label>
        <input
          type="number"
          className="e-input"
          min="0"
          max="10"
          step="0.05"
          value={formatPanelNumber(settings.audio.attachedVolume ?? 1.0)}
          onChange={(event) => {
            const value = parseFloat(event.target.value);
            if (!Number.isFinite(value)) return;
            settings.audio.attachedVolume = Math.max(0, Math.min(10, value));
            SoundManager.getInstance().setAttachedVolume(settings.audio.attachedVolume);
            incrementObjectVersion();
          }}
        />
      </div>

      <div className="e-row" style={{ marginTop: '10px' }}>
        <label
          className="e-label ui-text-accent-green ui-font-bold"
          style={{ marginBottom: '10px' }}
        >
          DISPLAY SETTINGS
        </label>
      </div>

      <DisplaySettingsSection
        value={settings.screenProfile}
        modes={QUEST_SCREEN_MODES}
        onChange={updateScreenProfile}
      />
      <CRTSettingsSection value={settings.screenProfile} onChange={updateScreenProfile} />

      <div className="e-row ui-divider-neutral" style={{ marginTop: '20px', paddingTop: '10px' }}>
        <button
          className="e-btn"
          style={{ width: '100%', padding: '8px' }}
          onClick={() => game.saveSettings()}
        >
          SAVE SETTINGS
        </button>
      </div>
    </>
  );
};
