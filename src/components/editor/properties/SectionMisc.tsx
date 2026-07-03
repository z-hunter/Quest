import React from 'react';
import { usePropertiesContext } from './PropertiesContext';
import { Select } from '../../common/Select';

interface SectionMiscProps {
  isTriggerbox: boolean;
  isQuad: boolean;
}

interface EditorObject {
  locked?: boolean;
  disabled?: boolean;
  hidden?: boolean | 'lookable' | 'examinable';
}

export const SectionMisc: React.FC<SectionMiscProps> = ({ isTriggerbox, isQuad }) => {
  const { game, obj, handleChange, mode, setSectionRef } = usePropertiesContext();
  const o = obj as EditorObject;
  const hasTitle = !!game.textAssets.getResolvedObjectField(o as any, 'title')?.trim();

  return (
    <div
      ref={setSectionRef(6)}
      className="properties-section-block properties-section-headless"
      data-section={6}
    >
      {isTriggerbox && (
        <>
          <button
            className="e-btn e-btn-yellow"
            style={{ width: '100%', marginBottom: '5px' }}
            onClick={(e) => {
              if (confirm('Redraw polygon? Current points will be cleared.')) {
                game.editor.redrawSelected();
                (e.target as HTMLElement).blur();
              }
            }}
          >
            Redraw Polygon
          </button>
          <div className="e-label">
            {mode && mode.includes('DRAW')
              ? 'Click to add points. Press ENTER to finish. Hold Shift for 22.5° snap.'
              : 'To edit, drag vertices on screen. Hold Shift for 22.5° snap.'}
          </div>
        </>
      )}

      {isQuad && (
        <div
          className="e-label ui-text-dim"
          style={{
            marginTop: '10px',
            fontSize: '10px',
            fontStyle: 'italic',
            paddingTop: '5px',
          }}
        >
          Drag VERTEX: Hold ALT to snap to vertices/grid.
          <br />
          Hold SHIFT for angle snap.
        </div>
      )}

      <div
        className="e-row"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px',
          marginTop: isTriggerbox || isQuad ? '10px' : 0,
        }}
      >
        <label
          className="e-label"
          title="Toggle lock hotkey: Alt-L"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 0 }}
        >
          <input
            type="checkbox"
            title="Alt-L"
            checked={!!o.locked}
            onChange={(e) => handleChange('locked', e.target.checked)}
          />
          Lock Object
        </label>

        <label
          className="e-label"
          title="Toggle disabled hotkey: Alt-D"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 0 }}
        >
          <input
            type="checkbox"
            title="Alt-D"
            checked={!!o.disabled}
            onChange={(e) => handleChange('disabled', e.target.checked)}
          />
          Disabled
        </label>
      </div>

      {hasTitle && (
        <div className="e-row" style={{ marginTop: '8px' }}>
          <label className="e-label" style={{ fontSize: '10px' }}>
            Hidden
          </label>
          <Select
            value={o.hidden === 'lookable' || o.hidden === 'examinable' ? o.hidden : 'false'}
            onChange={(value) =>
              handleChange('hidden', value === 'lookable' || value === 'examinable' ? value : false)
            }
            options={[
              { value: 'false', label: 'False' },
              { value: 'lookable', label: 'Lookable' },
              { value: 'examinable', label: 'Examinable' },
            ]}
            style={{ width: '100%' }}
          />
        </div>
      )}
    </div>
  );
};
