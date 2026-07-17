import React from 'react';
import type { SceneObject } from '../../../entities/SceneObject';
import { usePropertiesContext } from './PropertiesContext';

export const SectionParserNote: React.FC = () => {
  const { game, obj, incrementObjectVersion, setSectionRef } = usePropertiesContext<SceneObject>();
  const scene = obj.scene || game.sceneManager.currentScene;
  const entityId = String(obj.name || '').trim();
  const parserNote = entityId ? scene?.getEntityParserNote(entityId) || '' : '';

  if (!parserNote.trim()) return null;

  return (
    <div ref={setSectionRef(7)} className="properties-section-block" data-section={7}>
      <div className="properties-section-header properties-section-neutral">Parser Note (PN)</div>
      <div className="properties-section-body">
        <textarea
          aria-label="Parser Note (PN)"
          className="e-input"
          rows={4}
          spellCheck={false}
          style={{ minHeight: '72px', resize: 'vertical' }}
          value={parserNote}
          onChange={(event) => {
            scene?.setEntityParserNote(entityId, event.target.value);
            incrementObjectVersion();
          }}
        />
      </div>
    </div>
  );
};
