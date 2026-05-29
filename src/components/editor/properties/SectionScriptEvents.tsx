import React from 'react';
import { usePropertiesContext } from './PropertiesContext';
import { Select } from '../../common/Select';
import { ComponentSystem } from '../../../systems/ComponentSystem';

import {
  buildScriptEventAddOptions,
  formatInteractionLabel,
  getInteractionKeyForAddValue,
  getStateEventSelectOptions,
  parseStateEventKey,
  renameInteractionKey,
} from './SectionScriptEventsUtils';

export const SectionScriptEvents: React.FC = () => {
  const { game, obj, setSectionRef, incrementObjectVersion } = usePropertiesContext();
  const o = obj as any;
  const stateIds = ComponentSystem.getStateComponents(o).map((state) => state.id);
  const addOptions = buildScriptEventAddOptions(stateIds);

  const selectedObject = game.editor.selectedObject as any;

  const ensureInteractions = () => {
    if (!o.interactions) o.interactions = {};
    if (selectedObject && !selectedObject.interactions) {
      selectedObject.interactions = {};
    }
  };

  const setInteractionScript = (key: string, scriptId: string) => {
    ensureInteractions();
    o.interactions[key] = scriptId;
    if (selectedObject) {
      selectedObject.interactions[key] = scriptId;
    }
    incrementObjectVersion();
  };

  const deleteInteraction = (key: string) => {
    if (o.interactions) delete o.interactions[key];
    if (selectedObject?.interactions) {
      delete selectedObject.interactions[key];
    }
    incrementObjectVersion();
  };

  const renameInteraction = (oldKey: string, newKey: string) => {
    ensureInteractions();
    const renamed = renameInteractionKey(o.interactions, oldKey, newKey);
    if (!renamed) return;
    if (selectedObject?.interactions) {
      renameInteractionKey(selectedObject.interactions, oldKey, newKey);
    }
    incrementObjectVersion();
  };

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
              const key = getInteractionKeyForAddValue(value, stateIds);
              if (!key) return;
              ensureInteractions();
              if (!o.interactions[key]) {
                setInteractionScript(key, '');
              }
            }}
            options={addOptions}
            style={{ width: '8em' }}
          />
        </div>
      </div>

      {o.interactions &&
        Object.keys(o.interactions).map((verb) => {
          const stateEvent = parseStateEventKey(verb);
          const stateSelectOptions = getStateEventSelectOptions(stateIds, stateEvent.stateId);

          return (
            <div key={verb} style={{ display: 'flex', alignItems: 'center', marginTop: '2px' }}>
              <div
                className="ui-text-light"
                style={{ width: stateEvent.isState ? '44px' : '50px', fontSize: '0.85em' }}
              >
                {formatInteractionLabel(verb)}
              </div>
              {stateEvent.isState && !stateEvent.isValueSpecific && (
                <Select
                  value={stateEvent.stateId}
                  className="compact-action-select"
                  onChange={(stateId) => renameInteraction(verb, `state:${stateId}`)}
                  options={stateSelectOptions}
                  style={{ width: '6.25em', marginRight: '4px', flexShrink: 0 }}
                />
              )}
              <input
                type="text"
                className="e-input"
                style={{ flex: '1 1 120px', minWidth: '90px', fontSize: '0.85em' }}
                placeholder="Script ID"
                value={o.interactions[verb]}
                onChange={(e) => {
                  setInteractionScript(verb, e.target.value);
                }}
              />
              <button
                className="e-btn e-btn-red"
                style={{ marginLeft: '2px', padding: '0 4px', fontSize: '0.85em' }}
                aria-label={`Delete interaction ${verb}`}
                onClick={() => {
                  deleteInteraction(verb);
                }}
              >
                x
              </button>
            </div>
          );
        })}
    </div>
  );
};
