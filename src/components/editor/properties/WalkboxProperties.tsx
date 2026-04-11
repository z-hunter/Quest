import React from 'react';
import { usePropertiesContext } from './PropertiesContext';
import { Select } from '../../common/Select';

export const WalkboxProperties: React.FC = () => {
  const { game, obj, handleChange, mode } = usePropertiesContext();
  const wb = obj as any;

  return (
    <div className="e-row">
      <div className="e-row">
        <label className="e-label">Mode</label>
        <Select
          value={wb.mode || 'Invert'}
          onChange={(value) => handleChange('mode', value)}
          options={[
            { value: 'Invert', label: 'Invert (Standard)' },
            { value: 'Add', label: 'Add (Bridge)' },
            { value: 'Subtract', label: 'Subtract (Hole)' },
          ]}
          style={{ width: '100%', marginBottom: '5px' }}
        />
      </div>
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
    </div>
  );
};
