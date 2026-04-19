import React from 'react';
import { usePropertiesContext } from './PropertiesContext';
import { Select } from '../../common/Select';
import { Entity } from '../../../entities/Entity';
import { Triggerbox } from '../../../entities/Triggerbox';
import { useEditorStore } from '../../../store/editorStore';

import {
  getSharedValue,
  getSharedBooleanState,
  renderOpacityBlurControls,
  renderSection,
} from './propertiesUtils';

interface MultiSelectionPropertiesProps {
  multiObjects: unknown[];
  groupIdDraft: string;
  setGroupIdDraft: (v: string) => void;
  multiSpatialParentDraft: string;
  setMultiSpatialParentDraft: (v: string) => void;
  multiSpatialRelationDraft: string;
  setMultiSpatialRelationDraft: (v: string) => void;
  lastUndoMultiKeyRef: React.MutableRefObject<string | null>;
  applyToMulti: (fn: (o: unknown) => void) => void;
  applyToMultiRoots: (fn: (o: unknown) => void) => void;
  getSpatialRelationOptions: (hasParent: boolean) => { value: string; label: string }[];
  getMultiSpatialParentOptions: () => { value: string; label: string }[];
}

export const MultiSelectionProperties: React.FC<MultiSelectionPropertiesProps> = ({
  multiObjects,
  groupIdDraft,
  setGroupIdDraft,
  multiSpatialParentDraft,
  setMultiSpatialParentDraft,
  multiSpatialRelationDraft,
  setMultiSpatialRelationDraft,
  lastUndoMultiKeyRef,
  applyToMulti,
  applyToMultiRoots,
  getSpatialRelationOptions,
  getMultiSpatialParentOptions,
}) => {
  const {
    game,
    formatPanelNumber,
    setSectionRef,
    incrementObjectVersion,
    incrementHierarchyVersion,
  } = usePropertiesContext();
  const getMultiKey = () =>
    `MULTI:${multiObjects
      .map((item: any) => item?.name || '')
      .filter(Boolean)
      .join('|')}`;
  const saveUndoIfNeeded = () => {
    const multiKey = getMultiKey();
    if (game?.editor && lastUndoMultiKeyRef.current !== multiKey) {
      game.editor.saveUndoState();
      lastUndoMultiKeyRef.current = multiKey;
    }
  };

  const group = game.editor.selectionManager.getGroupTransform();
  const entitiesAndQuads = multiObjects.filter((o: any) => o instanceof Entity);
  const parallaxObjects = multiObjects.filter(
    (o: any) => o instanceof Entity || o instanceof Triggerbox || (o as any).type === 'Quad'
  );
  const quads = multiObjects.filter((o: any) => (o as any).type === 'Quad');
  const sharedLayer = getSharedValue(multiObjects, (o: any) => o.layer ?? 0);
  const sharedParallax = getSharedValue(parallaxObjects, (o: any) => o.parallax ?? 1);
  const sharedBlendMode = getSharedValue(
    entitiesAndQuads,
    (o: any) => o.blendMode || 'source-over'
  );
  const sharedOpacity = getSharedValue(entitiesAndQuads, (o: any) => o.opacity ?? 1);
  const sharedBlur = getSharedValue(entitiesAndQuads, (o: any) => o.blur || 0);
  const sharedColor = getSharedValue(
    multiObjects.filter((o: any) => (o as any).color !== undefined),
    (o: any) => o.color || '#ffffff'
  );
  const sharedIsGrid = getSharedBooleanState(quads, (q: any) => !!q.isGrid);
  const sharedGridX = getSharedValue(quads, (q: any) => q.gridLinesX ?? 5);
  const sharedGridY = getSharedValue(quads, (q: any) => q.gridLinesY ?? 5);
  const sharedGridWidth = getSharedValue(quads, (q: any) => q.lineWidth ?? 1.0);
  const sharedGridColor = getSharedValue(quads, (q: any) => q.gridColor || '#ffffff');
  const sharedIgnoreScaling = getSharedBooleanState(
    entitiesAndQuads,
    (o: any) => !!o.ignoreScaling
  );
  const sharedParentNodeId = getSharedValue(
    multiObjects,
    (o: any) => o.spatial?.parentNodeId || ''
  );
  const sharedLocked = getSharedBooleanState(multiObjects, (o: any) => !!o.locked);
  const sharedDisabled = getSharedBooleanState(multiObjects, (o: any) => !!o.disabled);

  return (
    <div>
      <div className="editor-header">
        <span>MULTI SELECTION ({multiObjects.length})</span>
        <button className="e-btn" onClick={() => useEditorStore.getState().toggle(false)}>
          X
        </button>
      </div>
      <div className="editor-content">
        {/* Section 0: Group ID + Parent */}
        {renderSection(
          0,
          null,
          'neutral',
          <>
            <div className="e-row">
              <label
                className="e-label"
                data-tooltip-fixed="true"
                title="Use this field to add or remove group #ID tags for all selected objects at once."
              >
                Group #ID
              </label>
              <div className="e-label ui-text-muted ui-text-small">
                (&lt;Enter&gt; = append, &lt;Ctrl+Enter&gt; = remove)
              </div>
              <input
                type="text"
                className="e-input"
                value={groupIdDraft}
                placeholder="#group"
                onChange={(e) => setGroupIdDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const raw = groupIdDraft.trim();
                  if (!raw) return;
                  const prepared = raw
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean)
                    .map((x) => (x.startsWith('#') ? x : `#${x}`));

                  let changedCount = 0;
                  multiObjects.forEach((o: any) => {
                    const existing = (o.groupID || '')
                      .split(',')
                      .map((x: string) => x.trim())
                      .filter(Boolean);

                    if (e.ctrlKey) {
                      const filtered = existing.filter((x: string) => !prepared.includes(x));
                      if (filtered.length !== existing.length) changedCount++;
                      o.groupID = filtered.join(',');
                      return;
                    }

                    const merged = [...new Set([...existing, ...prepared])];
                    if (merged.length !== existing.length) changedCount++;
                    o.groupID = merged.join(',');
                  });

                  if (changedCount > 0) {
                    saveUndoIfNeeded();
                    incrementObjectVersion();
                    incrementHierarchyVersion();
                    const tagsText = prepared.join(', ');
                    if (e.ctrlKey) {
                      game.showNotification(
                        `Removed ${tagsText} from ${changedCount} object${changedCount === 1 ? '' : 's'}`
                      );
                    } else {
                      game.showNotification(
                        `Appended ${tagsText} to ${changedCount} object${changedCount === 1 ? '' : 's'}`
                      );
                    }
                  }
                  setGroupIdDraft('');
                }}
              />
            </div>

            <div className="e-row">
              <label className="e-label">Parent</label>
              <Select
                className="parent-id-select"
                value={multiSpatialParentDraft}
                onChange={(value) => {
                  const nextRelation = !value ? '' : multiSpatialRelationDraft || 'in';
                  setMultiSpatialParentDraft(value || '');
                  setMultiSpatialRelationDraft(nextRelation);
                  applyToMultiRoots((o: any) => {
                    o.spatial = {
                      ...(o.spatial || {}),
                      parentNodeId: value || null,
                      relation: value ? nextRelation || 'in' : null,
                    };
                    if (o instanceof Entity) {
                      game.inventoryManager?.syncEntityStorageFromSpatialPlacement?.(o);
                    }
                  });
                }}
                options={getMultiSpatialParentOptions()}
                style={{ width: '100%' }}
              />
            </div>

            {sharedParentNodeId && (
              <div className="e-row">
                <label className="e-label">Relation</label>
                <Select
                  value={multiSpatialRelationDraft}
                  onChange={(value) => {
                    setMultiSpatialRelationDraft(value || '');
                    applyToMultiRoots((o: any) => {
                      o.spatial = {
                        ...(o.spatial || {}),
                        parentNodeId: o.spatial?.parentNodeId || null,
                        relation: value || (o.spatial?.parentNodeId ? 'in' : null),
                      };
                      if (o instanceof Entity) {
                        game.inventoryManager?.syncEntityStorageFromSpatialPlacement?.(o);
                      }
                    });
                  }}
                  options={getSpatialRelationOptions(true)}
                  style={{ width: '100%' }}
                />
              </div>
            )}
          </>,
          setSectionRef
        )}

        {/* Section 1: Transform */}
        {renderSection(
          1,
          'Transform',
          'blue',
          <>
            <div
              className="e-row"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}
            >
              <div>
                <label className="e-label">Group X</label>
                <input
                  type="number"
                  className="e-input"
                  value={formatPanelNumber(group.offsetX)}
                  onChange={(e) => {
                    saveUndoIfNeeded();
                    const x = parseFloat(e.target.value);
                    game.editor.selectionManager.applyGroupTransform(
                      isNaN(x) ? 0 : x,
                      group.offsetY,
                      group.scale
                    );
                    incrementObjectVersion();
                  }}
                />
              </div>
              <div>
                <label className="e-label">Group Y</label>
                <input
                  type="number"
                  className="e-input"
                  value={formatPanelNumber(group.offsetY)}
                  onChange={(e) => {
                    saveUndoIfNeeded();
                    const y = parseFloat(e.target.value);
                    game.editor.selectionManager.applyGroupTransform(
                      group.offsetX,
                      isNaN(y) ? 0 : y,
                      group.scale
                    );
                    incrementObjectVersion();
                  }}
                />
              </div>
            </div>

            <div
              className="e-row"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}
            >
              <div>
                <label className="e-label">Group Scale</label>
                <input
                  type="number"
                  step="0.01"
                  className="e-input"
                  value={formatPanelNumber(group.scale)}
                  onChange={(e) => {
                    saveUndoIfNeeded();
                    const s = parseFloat(e.target.value);
                    if (isNaN(s) || s <= 0) return;
                    game.editor.selectionManager.applyGroupTransform(
                      group.offsetX,
                      group.offsetY,
                      s
                    );
                    incrementObjectVersion();
                  }}
                />
              </div>
              <div>
                <label className="e-label">Layer</label>
                <input
                  type="number"
                  className="e-input"
                  placeholder="mixed"
                  value={sharedLayer === '' ? '' : formatPanelNumber(sharedLayer as number)}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    if (isNaN(v)) return;
                    applyToMulti((o: any) => {
                      o.layer = v;
                    });
                  }}
                />
              </div>
              <div>
                {parallaxObjects.length > 0 ? (
                  <>
                    <label className="e-label">Parallax</label>
                    <input
                      type="number"
                      step="0.1"
                      className="e-input ui-text-muted"
                      placeholder="mixed"
                      value={
                        sharedParallax === '' ? '' : formatPanelNumber(sharedParallax as number)
                      }
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (isNaN(v)) return;
                        applyToMulti((o: any) => {
                          if (
                            o instanceof Entity ||
                            o instanceof Triggerbox ||
                            (o as any).type === 'Quad'
                          ) {
                            o.parallax = v;
                          }
                        });
                      }}
                    />
                  </>
                ) : (
                  <div />
                )}
              </div>
            </div>

            {entitiesAndQuads.length > 0 && (
              <div className="e-row">
                <label
                  className="e-label"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 0 }}
                >
                  <input
                    type="checkbox"
                    checked={sharedIgnoreScaling === 'on'}
                    ref={(el) => {
                      if (el) el.indeterminate = sharedIgnoreScaling === 'mixed';
                    }}
                    onChange={(e) => {
                      applyToMulti((o: any) => {
                        if (o instanceof Entity) o.ignoreScaling = e.target.checked;
                      });
                    }}
                  />
                  Disable Depth Scaling
                </label>
              </div>
            )}
          </>,
          setSectionRef
        )}

        {/* Section 2: Visual */}
        {renderSection(
          2,
          'Visual',
          'yellow',
          <>
            {entitiesAndQuads.length > 0 &&
              renderOpacityBlurControls(
                sharedOpacity as number | '',
                sharedBlur as number | '',
                (nextOpacity) => {
                  applyToMulti((o: any) => {
                    if (o instanceof Entity) o.opacity = nextOpacity;
                  });
                },
                (nextBlur) => {
                  applyToMulti((o: any) => {
                    if (o instanceof Entity) o.blur = nextBlur;
                  });
                }
              )}

            {entitiesAndQuads.length > 0 && (
              <div
                className="e-row"
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}
              >
                <div>
                  <label className="e-label">Fill Color</label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input
                      type="color"
                      className="e-input"
                      style={{ width: '32px', padding: 0 }}
                      value={sharedColor === '' ? '#ffffff' : (sharedColor as string)}
                      onChange={(e) => {
                        const v = e.target.value;
                        applyToMulti((o: any) => {
                          if (o.color !== undefined) o.color = v;
                        });
                      }}
                    />
                    <input
                      type="text"
                      className="e-input"
                      placeholder="mixed"
                      value={sharedColor === '' ? '' : (sharedColor as string)}
                      onChange={(e) => {
                        const v = e.target.value;
                        applyToMulti((o: any) => {
                          if (o.color !== undefined) o.color = v;
                        });
                      }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'end' }}>
                  <div style={{ width: '100%' }}>
                    <label className="e-label">Blend Mode</label>
                    <Select
                      value={sharedBlendMode === '' ? 'source-over' : (sharedBlendMode as string)}
                      onChange={(value) => {
                        applyToMulti((o: any) => {
                          if (o instanceof Entity) o.blendMode = value as GlobalCompositeOperation;
                        });
                      }}
                      options={[
                        { value: 'source-over', label: 'Normal' },
                        { value: 'multiply', label: 'Multiply' },
                        { value: 'screen', label: 'Screen' },
                        { value: 'overlay', label: 'Overlay' },
                        { value: 'lighter', label: 'Add' },
                        { value: 'difference', label: 'Diff' },
                      ]}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
              </div>
            )}

            {quads.length > 0 && (
              <div className="e-row">
                <label
                  className="e-label"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    color: sharedIsGrid === 'on' ? '#ffffff' : 'inherit',
                  }}
                >
                  <input
                    type="checkbox"
                    style={{ marginRight: '5px' }}
                    checked={sharedIsGrid === 'on'}
                    ref={(el) => {
                      if (el) el.indeterminate = sharedIsGrid === 'mixed';
                    }}
                    onChange={(e) => {
                      applyToMulti((o: any) => {
                        if ((o as any).type === 'Quad') (o as any).isGrid = e.target.checked;
                      });
                    }}
                  />
                  Retro Grid
                </label>
              </div>
            )}

            {quads.length > 0 && sharedIsGrid !== 'off' && (
              <>
                <div
                  className="e-row"
                  style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}
                >
                  <div>
                    <label className="e-label">Grid X</label>
                    <input
                      type="number"
                      className="e-input"
                      placeholder="mixed"
                      value={sharedGridX === '' ? '' : formatPanelNumber(sharedGridX as number)}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (isNaN(v)) return;
                        applyToMulti((o: any) => {
                          if ((o as any).type === 'Quad') (o as any).gridLinesX = v;
                        });
                      }}
                      min={1}
                      max={50}
                    />
                  </div>
                  <div>
                    <label className="e-label">Grid Y</label>
                    <input
                      type="number"
                      className="e-input"
                      placeholder="mixed"
                      value={sharedGridY === '' ? '' : formatPanelNumber(sharedGridY as number)}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (isNaN(v)) return;
                        applyToMulti((o: any) => {
                          if ((o as any).type === 'Quad') (o as any).gridLinesY = v;
                        });
                      }}
                      min={1}
                      max={50}
                    />
                  </div>
                  <div>
                    <label className="e-label">Width</label>
                    <input
                      type="number"
                      className="e-input"
                      placeholder="mixed"
                      value={
                        sharedGridWidth === '' ? '' : formatPanelNumber(sharedGridWidth as number)
                      }
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (isNaN(v)) return;
                        applyToMulti((o: any) => {
                          if ((o as any).type === 'Quad') (o as any).lineWidth = v;
                        });
                      }}
                      step={0.1}
                      min={0.1}
                      max={10}
                    />
                  </div>
                </div>
                <div className="e-row">
                  <label className="e-label">Grid Color</label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input
                      type="color"
                      className="e-input"
                      style={{ width: '32px', padding: 0 }}
                      value={sharedGridColor === '' ? '#ffffff' : (sharedGridColor as string)}
                      onChange={(e) => {
                        const v = e.target.value;
                        applyToMulti((o: any) => {
                          if ((o as any).type === 'Quad') (o as any).gridColor = v;
                        });
                      }}
                    />
                    <input
                      type="text"
                      className="e-input"
                      placeholder="mixed"
                      value={sharedGridColor === '' ? '' : (sharedGridColor as string)}
                      onChange={(e) => {
                        const v = e.target.value;
                        applyToMulti((o: any) => {
                          if ((o as any).type === 'Quad') (o as any).gridColor = v;
                        });
                      }}
                    />
                  </div>
                </div>
              </>
            )}
          </>,
          setSectionRef
        )}

        {/* Section 6: Lock/Disabled */}
        {renderSection(
          6,
          null,
          'neutral',
          <div
            className="e-row"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}
          >
            <label
              className="e-label"
              title="Toggle lock hotkey: Alt-L"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 0 }}
            >
              <input
                type="checkbox"
                title="Alt-L"
                checked={sharedLocked === 'on'}
                ref={(el) => {
                  if (el) el.indeterminate = sharedLocked === 'mixed';
                }}
                onChange={(e) => {
                  applyToMulti((o: any) => {
                    o.locked = e.target.checked;
                  });
                }}
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
                checked={sharedDisabled === 'on'}
                ref={(el) => {
                  if (el) el.indeterminate = sharedDisabled === 'mixed';
                }}
                onChange={(e) => {
                  applyToMulti((o: any) => {
                    o.disabled = e.target.checked;
                  });
                }}
              />
              Disabled
            </label>
          </div>,
          setSectionRef
        )}
      </div>
    </div>
  );
};
