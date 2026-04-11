import React from 'react';
import { usePropertiesContext } from './PropertiesContext';
import { Select } from '../../common/Select';

interface SectionIdentityProps {
  isScene: boolean;
  isSettings: boolean;
  isWalkbox: boolean;
  supportsTextAsset: boolean;
  resolvedTitle: string;
  textAssetPath: string;
  hasTextAsset: boolean;
  isReadingTA: boolean;
  onOpenTA: () => void;
  onReadTA: () => void;
  onDeleteTA: () => void;
  getSpatialRelationOptions: (hasParent: boolean) => { value: string; label: string }[];
  getSceneSpatialParentOptions: () => { value: string; label: string }[];
}

export const SectionIdentity: React.FC<SectionIdentityProps> = ({
  isScene,
  isSettings,
  isWalkbox,
  supportsTextAsset,
  resolvedTitle,
  textAssetPath,
  hasTextAsset,
  isReadingTA,
  onOpenTA,
  onReadTA,
  onDeleteTA,
  getSpatialRelationOptions,
  getSceneSpatialParentOptions,
}) => {
  const {
    game,
    obj,
    setSectionRef,
    handleChange,
    incrementObjectVersion,
    incrementHierarchyVersion,
  } = usePropertiesContext();
  const o = obj as any;

  return (
    <div ref={setSectionRef(0)} className="properties-section-block" data-section={0}>
      {/* ID / ID/File */}
      <div className="e-row">
        <label className="e-label">{isScene ? 'ID/File' : 'ID'}</label>
        <input
          type="text"
          className="e-input"
          value={isScene ? o.id || '' : o.name || ''}
          onChange={(e) => {
            const val = e.target.value;
            if (isScene) o.id = val;
            else o.name = val;
            incrementObjectVersion();
          }}
          onBlur={(e) => {
            const rawVal = e.target.value;
            const finalVal = rawVal.trim();
            const field = isScene ? 'id' : 'name';

            let isValid = true;
            const scene = game?.sceneManager?.currentScene;

            if (!isScene && scene) {
              const dupEntity = scene.entities.find(
                (ent: any) => ent.name === finalVal && ent !== game?.editor?.selectedObject
              );
              const dupTrigger = scene.triggerboxes
                ? scene.triggerboxes.find(
                    (tb: any) => tb.name === finalVal && tb !== game?.editor?.selectedObject
                  )
                : null;

              if (dupEntity || dupTrigger) {
                console.warn(`[PropertiesPanel] Duplicate Name '${finalVal}' rejected.`);
                if ((game as any).showMessage)
                  (game as any).showMessage(`Name '${finalVal}' already exists!`);
                isValid = false;
              }
            }

            if (isValid) {
              handleChange(field, finalVal);
            } else {
              let realObj: any = null;
              if (game?.editor) realObj = game.editor.selectedObject;

              if (realObj) {
                if (isScene) o.id = realObj.id;
                else o.name = realObj.name;
                incrementObjectVersion();
              }
            }
          }}
        />
      </div>

      {/* Title / Text Asset */}
      {supportsTextAsset && (
        <div className="e-row">
          <label className="e-label">Title</label>
          <input
            type="text"
            className="e-input"
            value={resolvedTitle}
            readOnly
            tabIndex={-1}
            onFocus={(e) => e.currentTarget.blur()}
            style={{ pointerEvents: 'none' }}
          />
          {textAssetPath && (
            <>
              <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                <button className="e-btn" onClick={onOpenTA}>
                  {hasTextAsset ? 'Open TA' : 'Create TA'}
                </button>
                <button className="e-btn" onClick={onReadTA} disabled={isReadingTA}>
                  {isReadingTA ? 'Syncing...' : 'Sync TA'}
                </button>
                {hasTextAsset && (
                  <button className="e-btn" onClick={onDeleteTA}>
                    Delete TA
                  </button>
                )}
              </div>
              <div className="e-label ui-text-muted ui-text-small">{textAssetPath}</div>
            </>
          )}
        </div>
      )}

      {/* Group #ID */}
      {!isScene && !isSettings && (
        <div className="e-row">
          <label className="e-label">Group #ID</label>
          <input
            type="text"
            className="e-input"
            value={o.groupID || ''}
            onChange={(e) => {
              const val = e.target.value;
              const tokens = val.split(',');
              const newTokens = tokens.map((t) => {
                if (t.length === 0) return '';
                let clean = t;
                const trimmed = t.trimStart();
                if (trimmed.length > 0 && !trimmed.startsWith('#')) {
                  const firstCharIdx = t.length - trimmed.length;
                  clean = t.substring(0, firstCharIdx) + '#' + trimmed;
                }
                return clean;
              });
              handleChange('groupID', newTokens.join(','));
            }}
          />
        </div>
      )}

      {/* Parent / Relation */}
      {!isScene && !isSettings && !isWalkbox && (
        <div
          className="e-row"
          style={{
            display: o.spatial?.parentNodeId ? 'grid' : 'block',
            gridTemplateColumns: o.spatial?.parentNodeId ? '1fr 1fr' : undefined,
            gap: o.spatial?.parentNodeId ? '5px' : undefined,
          }}
        >
          <div>
            <label className="e-label">Parent</label>
            <Select
              className="parent-id-select"
              value={o.spatial?.parentNodeId || ''}
              onChange={(value) => {
                game.editor.saveUndoState();
                o.spatial = {
                  ...(o.spatial || {}),
                  parentNodeId: value || null,
                  relation: value ? o.spatial?.relation || 'in' : null,
                };
                incrementObjectVersion();
                incrementHierarchyVersion();
              }}
              options={getSceneSpatialParentOptions()}
              style={{ width: '100%' }}
            />
          </div>
          {o.spatial?.parentNodeId && (
            <div>
              <label className="e-label">Relation</label>
              <Select
                value={o.spatial?.relation || 'in'}
                onChange={(value) => {
                  game.editor.saveUndoState();
                  o.spatial = {
                    ...(o.spatial || {}),
                    parentNodeId: o.spatial?.parentNodeId || null,
                    relation: value || (o.spatial?.parentNodeId ? 'in' : null),
                  };
                  incrementObjectVersion();
                  incrementHierarchyVersion();
                }}
                options={getSpatialRelationOptions(true)}
                style={{ width: '100%' }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
