import React from 'react';
import { usePropertiesContext } from './PropertiesContext';
import { Select } from '../../common/Select';
import { Entity } from '../../../entities/Entity';
import { normalizeGroupIdList } from '../../../utils/GroupIds';
import { findDuplicateSceneObjectName } from './SectionIdentityUtils';
import { useFileWatcher } from '../../../hooks/useFileWatcher';

interface SectionIdentityData {
  id?: string;
  name?: string;
  groupID?: string | null;
  spatial?: {
    parentNodeId?: string | null;
    relation?: string | null;
  };
}

interface SectionIdentityProps {
  isScene: boolean;
  isSettings: boolean;
  isWalkbox: boolean;
  supportsTextAsset: boolean;
  resolvedTitle: string;
  textAssetPath: string;
  hasTextAsset: boolean;
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
  } = usePropertiesContext<SectionIdentityData>();
  const o = obj;
  const identityValue = isScene ? o.id || '' : o.name || '';
  const [identityDraft, setIdentityDraft] = React.useState(identityValue);

  React.useEffect(() => {
    setIdentityDraft(identityValue);
  }, [identityValue]);

  const handleFileChanged = React.useCallback(
    (eventType: string) => {
      if (eventType === 'change' || eventType === 'add') {
        onReadTA();
      }
    },
    [onReadTA]
  );

  useFileWatcher(textAssetPath, handleFileChanged);

  return (
    <div ref={setSectionRef(0)} className="properties-section-block" data-section={0}>
      <div className="properties-section-header properties-section-sky">
        <div className="properties-section-title">
          <span className="properties-section-number properties-section-sky">0</span>
          <span className="properties-section-label">Identity</span>
        </div>
      </div>
      <div className="properties-section-body">
        {/* ID / ID/File */}
        <div className="e-row">
          <label className="e-label">{isScene ? 'ID/File' : 'ID'}</label>
          <input
            type="text"
            className="e-input"
            value={identityDraft}
            onChange={(e) => {
              setIdentityDraft(e.target.value);
            }}
            onBlur={(e) => {
              const rawVal = e.target.value;
              const finalVal = rawVal.trim();
              const field = isScene ? 'id' : 'name';

              let isValid = true;
              const scene = game?.sceneManager?.currentScene;

              if (!isScene && scene) {
                const duplicate = findDuplicateSceneObjectName(
                  scene,
                  finalVal,
                  game?.editor?.selectedObject || o
                );

                if (!finalVal) {
                  console.warn('[PropertiesPanel] Empty Name rejected.');
                  game.showMessage('Name cannot be empty!');
                  isValid = false;
                } else if (duplicate) {
                  console.warn(`[PropertiesPanel] Duplicate Name '${finalVal}' rejected.`);
                  game.showMessage(`Name '${finalVal}' already exists!`);
                  isValid = false;
                }
              }

              if (isValid) {
                handleChange(field, finalVal);
                setIdentityDraft(finalVal);
              } else {
                setIdentityDraft(identityValue);
                incrementObjectVersion();
              }
            }}
          />
        </div>

        {/* Title / Text Asset */}
        {supportsTextAsset && (
          <div className="e-row">
            <label className="e-label">Title</label>
            <div
              style={{
                color: 'var(--ui-input-text)',
                padding: '2px 0',
                wordBreak: 'break-word',
                fontFamily: 'var(--ui-mono-font)',
              }}
            >
              {resolvedTitle || <span className="ui-text-muted italic">No title</span>}
            </div>
            {textAssetPath && (
              <>
                <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                  <button className="e-btn" onClick={onOpenTA}>
                    {hasTextAsset ? 'Open TA' : 'Create TA'}
                  </button>
                  {hasTextAsset && (
                    <button className="e-btn" onClick={onDeleteTA}>
                      DEL. TA
                    </button>
                  )}
                </div>
                <div className="e-label ui-text-muted ui-text-small properties-ta-path">
                  {textAssetPath}
                </div>
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
                handleChange(
                  'groupID',
                  normalizeGroupIdList(e.target.value, { preserveEmptyTokens: true })
                );
              }}
              onBlur={(e) => {
                handleChange('groupID', normalizeGroupIdList(e.target.value));
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
                  if (o instanceof Entity) {
                    game.inventoryManager?.syncEntityStorageFromSpatialPlacement?.(o);
                  }
                  incrementObjectVersion();
                  incrementHierarchyVersion();
                }}
                options={getSceneSpatialParentOptions()}
                style={{ width: '100%' }}
                filterable={true}
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
                    if (o instanceof Entity) {
                      game.inventoryManager?.syncEntityStorageFromSpatialPlacement?.(o);
                    }
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
    </div>
  );
};
