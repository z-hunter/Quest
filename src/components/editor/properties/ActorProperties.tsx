import React from 'react';
import { usePropertiesContext } from './PropertiesContext';
import { Select } from '../../common/Select';
import { Actor, type ActorDirection } from '../../../entities/Actor';

export const ActorProperties: React.FC = () => {
  const { game, obj, handleChange, formatPanelNumber, setSectionRef, incrementObjectVersion } =
    usePropertiesContext<Actor>();
  const actor = obj;

  return (
    <>
      <div ref={setSectionRef(4)} className="properties-section-block" data-section={4}>
        <div className="properties-section-header properties-section-blue">
          <div className="properties-section-title">
            <span className="properties-section-number properties-section-blue">4</span>
            <span className="properties-section-label">ACTOR PROP.</span>
          </div>
        </div>
      </div>

      {/* Is Player */}
      <div className="e-row">
        <label className="e-label ui-inline-flex-center">
          <input
            type="checkbox"
            style={{ marginRight: '5px' }}
            checked={!!actor.isPlayer}
            onChange={(e) => handleChange('isPlayer', e.target.checked)}
          />
          Is Player
        </label>
      </div>

      {/* Direction */}
      <div className="e-row">
        <label className="e-label">Direction</label>
        <Select
          value={actor.direction || 'down'}
          onChange={(value) => {
            handleChange('direction', value);
            const selectedActor = game.editor.selectedObject as Actor;
            if (selectedActor && typeof selectedActor.setDirection === 'function') {
              selectedActor.setDirection(value as ActorDirection);
            }
          }}
          options={[
            { value: 'down', label: 'Down' },
            { value: 'up', label: 'Up' },
            { value: 'left', label: 'Left' },
            { value: 'right', label: 'Right' },
          ]}
          style={{ width: '100%', marginBottom: '5px' }}
        />
      </div>

      {/* Move Speed */}
      <div className="e-row">
        <label className="e-label">Move Speed</label>
        <input
          type="number"
          step="0.01"
          className="e-input"
          value={formatPanelNumber(actor.speed !== undefined ? actor.speed : 0.1)}
          onChange={(e) => handleChange('speed', e.target.value, true)}
        />
      </div>

      {/* Anim Speed */}
      <div className="e-row">
        <label className="e-label">Anim Speed (ms)</label>
        <input
          type="number"
          step="10"
          className="e-input"
          value={formatPanelNumber(actor.animationSpeed !== undefined ? actor.animationSpeed : 150)}
          onChange={(e) => handleChange('animationSpeed', e.target.value, true)}
        />
      </div>

      {/* Animation Sets */}
      <div className="e-row" style={{ marginTop: '10px' }}>
        <div
          className="e-label ui-text-accent-blue ui-font-bold"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <span>ANIMATION SETS</span>
          <button
            className="e-btn e-action-add-btn"
            onClick={() => {
              if (!actor.animSets) actor.animSets = {};
              let newId = 'idle';
              if (actor.animSets['idle']) newId = 'walk';
              if (actor.animSets['walk']) newId = 'state_' + Object.keys(actor.animSets).length;

              actor.animSets[newId] = {
                id: newId,
                up: null,
                down: null,
                left: null,
                right: null,
              };

              const selectedActor = game.editor.selectedObject as Actor;
              if (selectedActor && typeof selectedActor.addAnimSet === 'function') {
                selectedActor.addAnimSet(newId);
              }
              incrementObjectVersion();
            }}
          >
            + ADD
          </button>
        </div>
      </div>

      {/* List Sets */}
      {actor.animSets &&
        Object.keys(actor.animSets).map((setId) => {
          const set = actor.animSets[setId];
          return (
            <div
              key={setId}
              className="component-block"
              style={{
                marginBottom: '5px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '5px',
                }}
              >
                <input
                  type="text"
                  className="e-input"
                  style={{
                    fontWeight: 'bold',
                    color: 'var(--ui-input-text)',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--ui-input-border)',
                    maxWidth: '100px',
                  }}
                  defaultValue={setId}
                  onBlur={(e) => {
                    const newName = e.target.value.trim();
                    if (newName && newName !== setId) {
                      if (actor.animSets[newName]) {
                        alert(`Animation set '${newName}' already exists!`);
                        e.target.value = setId;
                        return;
                      }
                      actor.animSets[newName] = actor.animSets[setId];
                      if (actor.animSets[newName].id) actor.animSets[newName].id = newName;
                      delete actor.animSets[setId];
                      incrementObjectVersion();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                />
                <button
                  className="e-btn e-btn-red e-action-delete-btn"
                  onClick={() => {
                    if (confirm(`Delete animation set '${setId}'?`)) {
                      delete actor.animSets[setId];
                      const selectedActor = game.editor.selectedObject as Actor;
                      if (selectedActor && typeof selectedActor.removeAnimSet === 'function') {
                        selectedActor.removeAnimSet(setId);
                      }
                      incrementObjectVersion();
                    }
                  }}
                >
                  x
                </button>
              </div>

              {/* Directions */}
              {(['down', 'up', 'left', 'right'] as const).map((dir) => (
                <div
                  key={dir}
                  style={{
                    display: 'flex',
                    gap: '5px',
                    marginBottom: '2px',
                    alignItems: 'center',
                  }}
                >
                  <div className="ui-text-muted ui-text-micro" style={{ width: '30px' }}>
                    {dir.toUpperCase()}
                  </div>
                  <input
                    type="text"
                    className="e-input"
                    style={{ flex: 1, fontSize: '10px', padding: '1px' }}
                    value={set[dir] || ''}
                    readOnly
                  />
                  <button
                    className="e-btn"
                    style={{ padding: '0 5px' }}
                    onClick={() => {
                      game.openFileBrowser('load', 'public/sprites', (f) => {
                        set[dir] = f;
                        const selectedActor = game.editor.selectedObject as Actor;
                        if (selectedActor && selectedActor.animSets) {
                          const realSet = selectedActor.animSets[setId];
                          if (realSet) realSet[dir] = f;
                          selectedActor.updateSpriteForState();
                        }
                        incrementObjectVersion();
                      });
                    }}
                  >
                    ...
                  </button>
                </div>
              ))}
            </div>
          );
        })}
    </>
  );
};
