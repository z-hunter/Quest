import React from 'react';
import { usePropertiesContext } from './PropertiesContext';
import { renderOpacityBlurControls, renderSection } from './propertiesUtils';
import { Select } from '../../common/Select';

interface FolderObject {
  type: 'Folder';
  name: string;
  folderId: string;
  defaults?: Record<string, any>;
}

export const FolderProperties: React.FC = () => {
  const { game, obj, formatPanelNumber, setSectionRef, incrementObjectVersion } =
    usePropertiesContext<FolderObject>();

  const folder = obj;

  if (!folder) return null;

  const applyFolderDefault = (prop: string, value: any, isNew: boolean = false) => {
    const scene = game?.sceneManager?.currentScene;
    if (!scene) return;
    const fid = (folder as any).folderId;
    const allObjects = [
      ...scene.entities,
      ...(scene.folders || []),
      ...(scene.walkbox || []),
      ...(scene.triggerboxes || []),
    ];
    for (const child of allObjects as any[]) {
      if ((child as any).folder !== fid) continue;
      if (!((child as any).inheritedProps instanceof Set)) {
        (child as any).inheritedProps = new Set();
      }
      const inherited: Set<string> = (child as any).inheritedProps;
      if (isNew || inherited.has(prop)) {
        (child as any)[prop] = value;
        inherited.add(prop);
      }
    }
  };

  const removeFolderDefault = (prop: string) => {
    const scene = game?.sceneManager?.currentScene;
    if (!scene) return;
    const fid = (folder as any).folderId;
    const ENTITY_DEFAULTS: Record<string, any> = {
      opacity: 1.0,
      blur: 0,
      blendMode: 'source-over',
      color: '#AAAAAA',
      modelScale: 1.0,
      layer: 0,
      parallax: 1.0,
      visible: true,
      ignoreScaling: false,
      colliderWidth: 0,
      colliderHeight: 0,
    };
    const allObjects = [
      ...scene.entities,
      ...(scene.folders || []),
      ...(scene.walkbox || []),
      ...(scene.triggerboxes || []),
    ];
    for (const child of allObjects as any[]) {
      if ((child as any).folder !== fid) continue;
      if (!((child as any).inheritedProps instanceof Set)) {
        (child as any).inheritedProps = new Set();
      }
      const inherited: Set<string> = (child as any).inheritedProps;
      if (inherited.has(prop)) {
        (child as any)[prop] = ENTITY_DEFAULTS[prop] ?? 0;
        inherited.delete(prop);
      }
    }
  };

  return (
    <>
      <div className="e-row">
        <button
          className="e-btn"
          onClick={() => {
            if (!game) return;
            const scene = game.sceneManager?.currentScene;
            if (!scene) return;
            const fid = (folder as any).folderId;
            const allObjects = [
              ...scene.entities,
              ...(scene.folders || []),
              ...(scene.triggerboxes || []),
              ...(scene.walkbox || []),
            ];
            const children = allObjects.filter((o: any) => o.folder === fid);
            if (children.length > 0) {
              game.editor?.selectionManager?.setMultiSelection(children);
            }
          }}
        >
          Select Contents
        </button>
      </div>

      {renderSection(
        1,
        'Children Defaults',
        'purple',
        (() => {
          const defaults = (folder as any).defaults || {};

          const handleDefault = (prop: string, value: any, enforceNumber = false) => {
            game?.editor?.saveUndoState();
            let finalVal = value;
            if (enforceNumber) {
              finalVal = parseFloat(String(value));
              if (isNaN(finalVal)) finalVal = 0;
            }
            const isNew = !(prop in defaults);
            if (!(folder as any).defaults) (folder as any).defaults = {};
            (folder as any).defaults[prop] = finalVal;
            applyFolderDefault(prop, finalVal, isNew);
            incrementObjectVersion();
          };

          const clearDefault = (prop: string) => {
            game?.editor?.saveUndoState();
            removeFolderDefault(prop);
            if ((folder as any).defaults) delete (folder as any).defaults[prop];
            incrementObjectVersion();
          };

          const hasDefault = (prop: string) => prop in defaults;

          return (
            <>
              <div
                className="e-row"
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}
              >
                <div>
                  <label className="e-label">Scale</label>
                  <div style={{ display: 'flex', gap: '2px' }}>
                    <input
                      type="number"
                      step="0.1"
                      className={`e-input${hasDefault('modelScale') ? ' e-inherited' : ''}`}
                      value={hasDefault('modelScale') ? formatPanelNumber(defaults.modelScale) : ''}
                      placeholder="-"
                      onChange={(e) => handleDefault('modelScale', e.target.value, true)}
                    />
                    {hasDefault('modelScale') && (
                      <button
                        className="e-btn e-btn-reset"
                        aria-label="Clear modelScale default"
                        onClick={() => clearDefault('modelScale')}
                      >
                        x
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="e-label">Layer</label>
                  <div style={{ display: 'flex', gap: '2px' }}>
                    <input
                      type="number"
                      className={`e-input${hasDefault('layer') ? ' e-inherited' : ''}`}
                      value={hasDefault('layer') ? formatPanelNumber(defaults.layer) : ''}
                      placeholder="-"
                      onChange={(e) => handleDefault('layer', e.target.value, true)}
                    />
                    {hasDefault('layer') && (
                      <button
                        className="e-btn e-btn-reset"
                        aria-label="Clear layer default"
                        onClick={() => clearDefault('layer')}
                      >
                        x
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="e-label">Parallax</label>
                  <div style={{ display: 'flex', gap: '2px' }}>
                    <input
                      type="number"
                      step="0.1"
                      className={`e-input${hasDefault('parallax') ? ' e-inherited' : ''}`}
                      value={hasDefault('parallax') ? formatPanelNumber(defaults.parallax) : ''}
                      placeholder="-"
                      onChange={(e) => handleDefault('parallax', e.target.value, true)}
                    />
                    {hasDefault('parallax') && (
                      <button
                        className="e-btn e-btn-reset"
                        aria-label="Clear parallax default"
                        onClick={() => clearDefault('parallax')}
                      >
                        x
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div
                className="e-row"
                style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '5px' }}
              >
                <div>
                  <label className="e-label">Fill Color</label>
                  <div style={{ display: 'flex', gap: '2px' }}>
                    <input
                      type="color"
                      className="e-input"
                      style={{
                        width: '30px',
                        padding: 0,
                        height: '20px',
                        cursor: 'pointer',
                        border: 'none',
                      }}
                      value={defaults.color || '#AAAAAA'}
                      onChange={(e) => handleDefault('color', e.target.value)}
                    />
                    <input
                      type="text"
                      className={`e-input${hasDefault('color') ? ' e-inherited' : ''}`}
                      style={{ flex: 1, minWidth: 0 }}
                      value={defaults.color || ''}
                      placeholder="-"
                      onChange={(e) => handleDefault('color', e.target.value)}
                    />
                    {hasDefault('color') && (
                      <button
                        className="e-btn e-btn-reset"
                        aria-label="Clear color default"
                        onClick={() => clearDefault('color')}
                      >
                        x
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="e-label">Blend Mode</label>
                  <div style={{ display: 'flex', gap: '2px' }}>
                    <Select
                      value={hasDefault('blendMode') ? defaults.blendMode : ''}
                      onChange={(value) => handleDefault('blendMode', value)}
                      options={[
                        { value: '', label: '-' },
                        { value: 'source-over', label: 'Normal' },
                        { value: 'multiply', label: 'Multiply' },
                        { value: 'screen', label: 'Screen' },
                        { value: 'overlay', label: 'Overlay' },
                        { value: 'lighter', label: 'Add' },
                        { value: 'difference', label: 'Diff' },
                      ]}
                      style={{ width: '100%' }}
                    />
                    {hasDefault('blendMode') && (
                      <button
                        className="e-btn e-btn-reset"
                        aria-label="Clear blendMode default"
                        onClick={() => clearDefault('blendMode')}
                      >
                        x
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {renderOpacityBlurControls(
                hasDefault('opacity') ? defaults.opacity : '',
                hasDefault('blur') ? defaults.blur : '',
                (nextOpacity) => handleDefault('opacity', nextOpacity, true),
                (nextBlur) => handleDefault('blur', nextBlur)
              )}

              <div className="e-row">
                <label className="e-label" style={{ display: 'flex', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    style={{ marginRight: '5px' }}
                    checked={!!defaults.ignoreScaling}
                    onChange={(e) => {
                      if (e.target.checked) {
                        handleDefault('ignoreScaling', true);
                      } else {
                        clearDefault('ignoreScaling');
                      }
                    }}
                  />
                  Disable Depth-scaling
                </label>
              </div>
            </>
          );
        })(),
        setSectionRef
      )}
    </>
  );
};
