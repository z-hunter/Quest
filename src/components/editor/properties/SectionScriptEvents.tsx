import React from 'react';
import { usePropertiesContext } from './PropertiesContext';
import { Select } from '../../common/Select';

export const SectionScriptEvents: React.FC = () => {
  const { game, obj, setSectionRef, incrementObjectVersion } = usePropertiesContext();
  const o = obj as any;

  return (
    <div ref={setSectionRef(5)} className="properties-section-block" data-section={5}>
      <div className="properties-section-header properties-section-purple">
        <div className="properties-section-title">
          <span className="properties-section-number properties-section-purple">5</span>
          <span className="properties-section-label">SCRIPT EVENTS</span>
        </div>
        <div className="properties-section-actions">
          <Select
            value=""
            className="compact-action-select"
            placeholder="+ ADD"
            onChange={(value) => {
              const verb = value;
              if (!verb) return;
              if (!o.interactions) o.interactions = {};
              if (!o.interactions[verb]) {
                o.interactions[verb] = '';
                if (game.editor.selectedObject) {
                  if (!(game.editor.selectedObject as any).interactions) {
                    (game.editor.selectedObject as any).interactions = {};
                  }
                  (game.editor.selectedObject as any).interactions[verb] = '';
                }
                incrementObjectVersion();
              }
            }}
            options={[
              { value: 'look', label: 'Look' },
              { value: 'use', label: 'Use' },
              { value: 'talk', label: 'Talk' },
              { value: 'pickup', label: 'Pickup' },
            ]}
            style={{ width: '8em' }}
          />
        </div>
      </div>

      {o.interactions &&
        Object.keys(o.interactions).map((verb) => (
          <div key={verb} style={{ display: 'flex', alignItems: 'center', marginTop: '2px' }}>
            <div className="ui-text-light" style={{ width: '40px', fontSize: '0.85em' }}>
              {verb.toUpperCase()}
            </div>
            <input
              type="text"
              className="e-input"
              style={{ flex: 1, fontSize: '0.85em' }}
              placeholder="Script ID"
              value={o.interactions[verb]}
              onChange={(e) => {
                o.interactions[verb] = e.target.value;
                if (game.editor.selectedObject) {
                  (game.editor.selectedObject as any).interactions[verb] = e.target.value;
                }
                incrementObjectVersion();
              }}
            />
            <button
              className="e-btn e-btn-red"
              style={{ marginLeft: '2px', padding: '0 4px', fontSize: '0.85em' }}
              onClick={() => {
                delete o.interactions[verb];
                if (game.editor.selectedObject) {
                  delete (game.editor.selectedObject as any).interactions[verb];
                }
                incrementObjectVersion();
              }}
            >
              x
            </button>
          </div>
        ))}
    </div>
  );
};
