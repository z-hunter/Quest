import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { useGame } from '../../hooks/useGame';
import { Select } from '../../components/common/Select';
import { QuadObject } from '../../entities/QuadObject';
import { Entity } from '../../entities/Entity';

export const PropertiesPanel: React.FC = () => {
  const game = useGame();
  const {
    selectedObjectId,
    selectedObjectType,
    incrementHierarchyVersion,
    incrementObjectVersion,
    objectVersion,
    mode,
    selectedVertexIndex,
  } = useEditorStore();
  const [groupIdDraft, setGroupIdDraft] = React.useState('');
  const [multiSpatialParentDraft, setMultiSpatialParentDraft] = React.useState('');
  const [multiSpatialRelationDraft, setMultiSpatialRelationDraft] = React.useState('');
  const [resolvedTitle, setResolvedTitle] = React.useState('');
  const [textAssetPath, setTextAssetPath] = React.useState('');
  const [isReadingTA, setIsReadingTA] = React.useState(false);
  const [hasTextAsset, setHasTextAsset] = React.useState(false);
  const lastUndoObjectKeyRef = React.useRef<string | null>(null);

  // Derived Object Binding (Source of Truth)
  // We re-render whenever objectVersion changes.
  let obj: any = null;
  void objectVersion;
  if (game) {
    if (selectedObjectId === 'SETTINGS') {
      obj = game.settings;
    } else if (selectedObjectId === 'SCENE') {
      obj = game.sceneManager.currentScene;
    } else if (game.editor && game.editor.selectedObject) {
      obj = game.editor.selectedObject;
    }
  }

  const uiScale = game?.settings?.editor?.uiScale || 1.0;
  const supportsTextAsset =
    selectedObjectType === 'SCENE' ||
    (selectedObjectType !== 'MULTI' &&
      selectedObjectType !== 'SETTINGS' &&
      game?.editor?.selectedObject?.type !== 'Walkbox');
  const multiObjects = game?.editor?.selectionManager?.hasMultiSelection()
    ? game.editor.selectionManager.getSelectedObjects()
    : [];
  const spatialRelationOptions = [
    { value: '', label: '(None)' },
    { value: 'in', label: 'In' },
    { value: 'on', label: 'On' },
    { value: 'under', label: 'Under' },
    { value: 'behind', label: 'Behind' },
  ];
  const getSpatialRelationOptions = React.useCallback(
    (hasParent: boolean) =>
      hasParent ? spatialRelationOptions.filter((option) => option.value !== '') : spatialRelationOptions,
    [spatialRelationOptions]
  );

  const getSpatialDescendantNames = React.useCallback((rootNames: string[]) => {
    const scene = game?.sceneManager?.currentScene;
    if (!scene || !rootNames.length) return new Set<string>();

    const allObjects = [...scene.entities, ...scene.walkbox, ...scene.triggerboxes];
    const childrenByParent = new Map<string, string[]>();

    allObjects.forEach((item: any) => {
      const parentId = typeof item?.spatial?.parentNodeId === 'string' ? item.spatial.parentNodeId.trim() : '';
      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      if (!parentId || !name) return;
      const children = childrenByParent.get(parentId) || [];
      children.push(name);
      childrenByParent.set(parentId, children);
    });

    const visited = new Set<string>();
    const stack = [...rootNames.filter(Boolean)];
    while (stack.length) {
      const current = stack.pop()!;
      const children = childrenByParent.get(current) || [];
      children.forEach((child) => {
        if (visited.has(child)) return;
        visited.add(child);
        stack.push(child);
      });
    }

    return visited;
  }, [game]);

  const getSceneSpatialParentOptions = React.useCallback(() => {
    const scene = game?.sceneManager?.currentScene;
    if (!scene || !obj) {
      return [{ value: '', label: '(None)' }];
    }

    const excludedNames = new Set<string>([obj?.name].filter(Boolean));
    getSpatialDescendantNames([obj?.name]).forEach((name) => excludedNames.add(name));

    const allObjects = [...scene.entities, ...scene.walkbox, ...scene.triggerboxes];
    const options = allObjects
      .filter((item: any) => item && !excludedNames.has(item.name))
      .map((item: any) => ({
        value: item.name,
        label: item.customName?.trim() || item.name,
      }));

    return [{ value: '', label: '(None)' }, ...options];
  }, [game, obj, getSpatialDescendantNames]);

  const getMultiSpatialParentOptions = React.useCallback(() => {
    const scene = game?.sceneManager?.currentScene;
    if (!scene || !multiObjects.length) {
      return [{ value: '', label: '(None)' }];
    }

    const selectedNames = new Set(multiObjects.map((item: any) => item?.name).filter(Boolean));
    getSpatialDescendantNames(Array.from(selectedNames)).forEach((name) => selectedNames.add(name));

    const allObjects = [...scene.entities, ...scene.walkbox, ...scene.triggerboxes];
    const options = allObjects
      .filter((item: any) => item && !selectedNames.has(item.name))
      .map((item: any) => ({
        value: item.name,
        label: item.customName?.trim() || item.name,
      }));

    return [{ value: '', label: '(None)' }, ...options];
  }, [game, multiObjects, getSpatialDescendantNames]);

  const getSharedValue = (arr: any[], getter: (o: any) => any) => {
    if (!arr.length) return '';
    const first = getter(arr[0]);
    for (let i = 1; i < arr.length; i++) {
      if (getter(arr[i]) !== first) return '';
    }
    return first ?? '';
  };

  const getSharedBooleanState = (arr: any[], getter: (o: any) => boolean) => {
    if (!arr.length) return 'off';
    const first = !!getter(arr[0]);
    for (let i = 1; i < arr.length; i++) {
      if (!!getter(arr[i]) !== first) return 'mixed';
    }
    return first ? 'on' : 'off';
  };

  const applyToMulti = (fn: (o: any) => void) => {
    multiObjects.forEach(fn);
    incrementObjectVersion();
    incrementHierarchyVersion();
  };

  const applyToMultiRoots = (fn: (o: any) => void) => {
    const selectedNames = new Set(multiObjects.map((item: any) => item?.name).filter(Boolean));
    multiObjects.forEach((o: any) => {
      const parentId = typeof o?.spatial?.parentNodeId === 'string' ? o.spatial.parentNodeId.trim() : '';
      if (parentId && selectedNames.has(parentId)) return;
      fn(o);
    });
    incrementObjectVersion();
    incrementHierarchyVersion();
  };

  React.useEffect(() => {
    if (selectedObjectType !== 'MULTI' || multiObjects.length <= 1) {
      setMultiSpatialParentDraft('');
      setMultiSpatialRelationDraft('');
      return;
    }

    const sharedParent = getSharedValue(multiObjects, (o: any) => o.spatial?.parentNodeId || '');
    const sharedRelation = getSharedValue(
      multiObjects,
      (o: any) => (o.spatial?.parentNodeId ? o.spatial?.relation || 'in' : o.spatial?.relation || '')
    );

    setMultiSpatialParentDraft(sharedParent === '' ? '' : sharedParent);
    setMultiSpatialRelationDraft(sharedRelation === '' ? '' : sharedRelation);
  }, [selectedObjectType, selectedObjectId, objectVersion, multiObjects.length]);

  const loadResolvedTitle = React.useCallback(
    async (forceReload: boolean = false) => {
      if (!game || !obj || selectedObjectType === 'MULTI' || selectedObjectType === 'SETTINGS') {
        setResolvedTitle('');
        setTextAssetPath('');
        setHasTextAsset(false);
        return;
      }

      if (!supportsTextAsset) {
        setResolvedTitle('');
        setTextAssetPath('');
        setHasTextAsset(false);
        return;
      }

      if (selectedObjectType === 'SCENE') {
        const scene = game.sceneManager.currentScene;
        if (!scene) return;
        const asset = forceReload
          ? await game.textAssets.readSceneAsset(scene, true)
          : await game.textAssets.readSceneAsset(scene, false);
        setHasTextAsset(!!asset);
        setResolvedTitle(game.textAssets.getResolvedSceneField(scene, 'title') || '');
        setTextAssetPath(game.textAssets.getSceneAssetProjectPath(scene.id));
        return;
      }

      if (game.editor?.selectedObject) {
        const selected = game.editor.selectedObject;
        const asset = forceReload
          ? await game.textAssets.readObjectAsset(selected, true)
          : await game.textAssets.readObjectAsset(selected, false);
        setHasTextAsset(!!asset);
        setResolvedTitle(game.textAssets.getResolvedObjectField(selected, 'title') || '');
        setTextAssetPath(game.textAssets.getObjectAssetProjectPath(selected.name));
      }
    },
    [game, obj, selectedObjectType, supportsTextAsset]
  );

  React.useEffect(() => {
    loadResolvedTitle(false).catch((err) => {
      console.error('Failed to load text asset title:', err);
    });
  }, [loadResolvedTitle, selectedObjectId, selectedObjectType]);

  const handleOpenTA = async () => {
    if (!game || !obj) return;
    try {
      if (selectedObjectType === 'SCENE') {
        const scene = game.sceneManager.currentScene;
        if (!scene) return;
        await game.textAssets.openSceneAsset(scene);
      } else if (game.editor?.selectedObject) {
        await game.textAssets.openObjectAsset(game.editor.selectedObject);
      }
      await loadResolvedTitle(true);
    } catch (err) {
      console.error('Failed to open text asset:', err);
      game.showNotification?.(`Failed to open TA: ${err}`);
    }
  };

  const handleReadTA = async () => {
    if (!game || !obj) return;
    setIsReadingTA(true);
    try {
      const path =
        selectedObjectType === 'SCENE'
          ? game.textAssets.getSceneAssetProjectPath(game.sceneManager.currentScene?.id || '')
          : game.editor?.selectedObject
            ? game.textAssets.getObjectAssetProjectPath(game.editor.selectedObject.name)
            : '';
      const defaultContent =
        selectedObjectType === 'SCENE'
          ? JSON.stringify(
              game.textAssets.buildDefaultSceneAsset(game.sceneManager.currentScene as any),
              null,
              2
            )
          : game.editor?.selectedObject
            ? JSON.stringify(
                game.textAssets.buildDefaultObjectAsset(game.editor.selectedObject),
                null,
                2
              )
            : '{}';

      await fetch('/api/read-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content: defaultContent }),
      });
      await loadResolvedTitle(true);
      incrementObjectVersion();
      game.showNotification?.('Text asset reloaded');
    } catch (err) {
      console.error('Failed to read text asset:', err);
      game.showNotification?.(`Failed to read TA: ${err}`);
    } finally {
      setIsReadingTA(false);
    }
  };

  const handleDeleteTA = async () => {
    if (!game || !obj || !hasTextAsset) return;
    const confirmed = window.confirm(`Delete text asset?\n${textAssetPath}`);
    if (!confirmed) return;

    try {
      if (selectedObjectType === 'SCENE') {
        const scene = game.sceneManager.currentScene;
        if (!scene) return;
        await game.textAssets.deleteSceneAsset(scene);
      } else if (game.editor?.selectedObject) {
        await game.textAssets.deleteObjectAsset(game.editor.selectedObject);
      }
      await loadResolvedTitle(true);
      incrementObjectVersion();
      game.showNotification?.('Text asset deleted');
    } catch (err) {
      console.error('Failed to delete text asset:', err);
      game.showNotification?.(`Failed to delete TA: ${err}`);
    }
  };

  React.useEffect(() => {
    lastUndoObjectKeyRef.current = null;
    if (selectedObjectType !== 'MULTI') {
      setGroupIdDraft('');
    }
  }, [selectedObjectType, selectedObjectId]);

  if (!obj || !game) {
    return (
      <div
        id="editor-panel"
        className="editor-sidebar right"
        onMouseEnter={() => {
          if (game) game.isMouseOverUI = true;
        }}
        onMouseLeave={() => {
          if (game) game.isMouseOverUI = false;
        }}
        onBlurCapture={() => {
          lastUndoObjectKeyRef.current = null;
        }}
        style={{ fontSize: `${12 * uiScale}px` }}
      >
        <div className="editor-header">
          <span>{selectedObjectId === 'SETTINGS' ? 'SETTINGS (Loading...)' : 'PROPERTIES'}</span>
        </div>
        <div className="editor-content ui-text-muted ui-text-italic">
          {selectedObjectId === 'SETTINGS' ? 'Loading Settings...' : 'No Selection'}
        </div>
      </div>
    );
  }

  if (selectedObjectType === 'MULTI' && multiObjects.length > 1) {
    const group = game.editor.selectionManager.getGroupTransform();
    const entitiesAndQuads = multiObjects.filter((o: any) => o instanceof Entity);
    const quads = multiObjects.filter((o: any) => (o as any).type === 'Quad');
    const sharedLayer = getSharedValue(multiObjects, (o) => o.layer ?? 0);
    const sharedParallax = getSharedValue(entitiesAndQuads, (o: any) => o.parallax ?? 1);
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
    const sharedParentNodeId = getSharedValue(multiObjects, (o: any) => o.spatial?.parentNodeId || '');
    const sharedLocked = getSharedBooleanState(multiObjects, (o: any) => !!o.locked);
    const sharedDisabled = getSharedBooleanState(multiObjects, (o: any) => !!o.disabled);

    return (
      <div
        id="editor-panel"
        className="editor-sidebar right"
        onMouseEnter={() => {
          if (game) game.isMouseOverUI = true;
        }}
        onMouseLeave={() => {
          if (game) game.isMouseOverUI = false;
        }}
        onBlurCapture={() => {
          lastUndoObjectKeyRef.current = null;
        }}
        style={{ fontSize: `${12 * uiScale}px` }}
      >
        <div className="editor-header">
          <span>MULTI SELECTION ({multiObjects.length})</span>
          <button className="e-btn" onClick={() => useEditorStore.getState().toggle(false)}>
            X
          </button>
        </div>
        <div className="editor-content">
          <div className="e-row">
            <label className="e-label">Group #ID</label>
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
                    if (filtered.length !== existing.length) {
                      changedCount++;
                    }
                    o.groupID = filtered.join(',');
                    return;
                  }

                  const merged = [...new Set([...existing, ...prepared])];
                  if (merged.length !== existing.length) {
                    changedCount++;
                  }
                  o.groupID = merged.join(',');
                });

                if (changedCount > 0) {
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

          <div
            className="e-row"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}
          >
            <div>
              <label className="e-label">Group X</label>
              <input
                type="number"
                className="e-input"
                value={group.offsetX.toFixed(2)}
                onChange={(e) => {
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
                value={group.offsetY.toFixed(2)}
                onChange={(e) => {
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

          <div className="e-row">
            <label className="e-label">Group Scale</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="e-input"
              value={group.scale.toFixed(3)}
              onChange={(e) => {
                const s = parseFloat(e.target.value);
                game.editor.selectionManager.applyGroupTransform(
                  group.offsetX,
                  group.offsetY,
                  isNaN(s) ? 1 : s
                );
                incrementObjectVersion();
              }}
            />
          </div>

          <div
            className="e-row"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}
          >
            <div>
              <label className="e-label">Layer</label>
              <input
                type="number"
                className="e-input"
                placeholder="mixed"
                value={sharedLayer === '' ? '' : sharedLayer}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  if (isNaN(v)) return;
                  applyToMulti((o) => {
                    o.layer = v;
                  });
                }}
              />
            </div>
            {entitiesAndQuads.length > 0 ? (
              <div>
                <label className="e-label">Parallax</label>
                <input
                  type="number"
                  step="0.1"
                  className="e-input ui-text-muted"
                  placeholder="mixed"
                  value={sharedParallax === '' ? '' : sharedParallax}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (isNaN(v)) return;
                    applyToMulti((o: any) => {
                      if (o instanceof Entity) o.parallax = v;
                    });
                  }}
                />
              </div>
            ) : (
              <div />
            )}
          </div>

          {entitiesAndQuads.length > 0 && (
            <div
              className="e-row"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}
            >
              <div>
                <label className="e-label">Opacity</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  className="e-input"
                  placeholder="mixed"
                  value={sharedOpacity === '' ? '' : sharedOpacity}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (isNaN(v)) return;
                    applyToMulti((o: any) => {
                      if (o instanceof Entity) o.opacity = v;
                    });
                  }}
                />
              </div>
              <div>
                <label className="e-label">Blur</label>
                <input
                  type="number"
                  className="e-input"
                  placeholder="mixed"
                  value={sharedBlur === '' ? '' : sharedBlur}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    if (isNaN(v)) return;
                    applyToMulti((o: any) => {
                      if (o instanceof Entity) o.blur = v;
                    });
                  }}
                />
              </div>
            </div>
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
                    value={sharedColor === '' ? '#ffffff' : sharedColor}
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
                    value={sharedColor === '' ? '' : sharedColor}
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
                  <label className="e-label">Blend</label>
                  <Select
                    value={sharedBlendMode === '' ? 'source-over' : sharedBlendMode}
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
                    value={sharedGridX === '' ? '' : sharedGridX}
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
                    value={sharedGridY === '' ? '' : sharedGridY}
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
                    value={sharedGridWidth === '' ? '' : sharedGridWidth}
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
                    value={sharedGridColor === '' ? '#ffffff' : sharedGridColor}
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
                    value={sharedGridColor === '' ? '' : sharedGridColor}
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

          <div
            className="e-row"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}
          >
            <div style={{ display: 'flex', alignItems: 'end' }}>
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
            <label
              className="e-label"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 0 }}
            >
              <input
                type="checkbox"
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
              Lock
            </label>
          </div>

          <div className="e-row">
            <label className="e-label">Parent</label>
            <Select
              className="parent-id-select"
              value={multiSpatialParentDraft}
              onChange={(value) => {
                const nextRelation = !value ? '' : multiSpatialRelationDraft || 'in';
                game.editor.saveUndoState();
                setMultiSpatialParentDraft(value || '');
                setMultiSpatialRelationDraft(nextRelation);
                applyToMultiRoots((o: any) => {
                  o.spatial = {
                    ...(o.spatial || {}),
                    parentNodeId: value || null,
                    relation: value ? nextRelation || 'in' : null,
                  };
                });
              }}
              options={getMultiSpatialParentOptions()}
              style={{ width: '100%' }}
            />
          </div>

          <div className="e-row">
            <label className="e-label">Relation</label>
            <Select
              value={multiSpatialRelationDraft}
              onChange={(value) => {
                game.editor.saveUndoState();
                setMultiSpatialRelationDraft(value || '');
                applyToMultiRoots((o: any) => {
                  o.spatial = {
                    ...(o.spatial || {}),
                    parentNodeId: o.spatial?.parentNodeId || null,
                    relation: value || (o.spatial?.parentNodeId ? 'in' : null),
                  };
                });
              }}
              options={getSpatialRelationOptions(!!sharedParentNodeId)}
              style={{ width: '100%' }}
            />
          </div>

          <div className="e-row">
            <label
              className="e-label"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 0 }}
            >
              <input
                type="checkbox"
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
          </div>
        </div>
      </div>
    );
  }

  const handleChange = (field: string, value: any, enforceNumber = false) => {
    if (!obj) return;

    if (selectedObjectType !== 'SETTINGS' && game?.editor) {
      const objectKey = selectedObjectType === 'SCENE'
        ? `SCENE:${obj.id || ''}`
        : `${selectedObjectType || 'Object'}:${obj.name || ''}`;
      if (lastUndoObjectKeyRef.current !== objectKey) {
        game.editor.saveUndoState();
        lastUndoObjectKeyRef.current = objectKey;
      }
    }

    let finalVal = value;
    if (enforceNumber) {
      finalVal = parseFloat(value);
      if (isNaN(finalVal)) finalVal = 0;
    }

    // Apply directly to the source of truth
    obj[field] = finalVal;

    // Signal update
    incrementObjectVersion();

    // Special handling for Name changes (needs hierarchy refresh)
    if (field === 'name') {
      incrementHierarchyVersion();
    }

    // Special handling for Sprite changes (reload)
    if (field === 'spriteName') {
      if (obj.setSprite) obj.setSprite(finalVal);
    }

    // Special handling for Ignore Scaling (preserve visual size)
    if (field === 'ignoreScaling') {
      const isIgnored = finalVal;
      const scene = game.sceneManager.currentScene;
      if (
        scene &&
        (selectedObjectType === 'Static' ||
          selectedObjectType === 'Actor' ||
          selectedObjectType === 'Entity')
      ) {
        const ent = obj;
        const currentVisW = ent.width;
        const currentVisH = ent.height;
        const modelScale = ent.modelScale || 1.0;

        let targetFactor = modelScale;

        if (!isIgnored) {
          let depthFactor = 1.0;
          if (scene.scaling && scene.scaling.enabled) {
            depthFactor = scene.getScaling(ent.y);
          }
          targetFactor = modelScale * depthFactor;
        }

        if (targetFactor !== 0) {
          ent.baseWidth = currentVisW / targetFactor;
          ent.baseHeight = currentVisH / targetFactor;
        } else {
          ent.baseWidth = currentVisW;
          ent.baseHeight = currentVisH;
        }

        ent.scale = targetFactor;
        // No need to setObj, direct mod is done.
      }
    }

    // Special handling for Animation Speed (Live Update)
    if (field === 'animationSpeed') {
      if (obj.animator) {
        obj.animator.frameDuration = finalVal;
      }
    }
  };

  return (
    <div
      id="editor-panel"
      className="editor-sidebar right"
      onMouseEnter={() => {
        if (game) game.isMouseOverUI = true;
      }}
      onMouseLeave={() => {
        if (game) game.isMouseOverUI = false;
      }}
      style={{ fontSize: `${12 * uiScale}px` }}
    >
      <div className="editor-header">
        <span>
          {selectedObjectType === 'SETTINGS' ? 'SETTINGS' : selectedObjectType?.toUpperCase()}
        </span>
        <button className="e-btn" onClick={() => useEditorStore.getState().toggle(false)}>
          X
        </button>
      </div>

      <div className="editor-content">
        {selectedObjectType !== 'SETTINGS' && (
          <>
            {/* Common: Name -> ID */}
            <div className="e-row">
              <label className="e-label">{selectedObjectType === 'SCENE' ? 'ID/File' : 'ID'}</label>
              <input
                type="text"
                className="e-input"
                value={selectedObjectType === 'SCENE' ? obj.id || '' : obj.name || ''}
                onChange={(e) => {
                  // Local update only
                  const val = e.target.value;
                  if (selectedObjectType === 'SCENE') obj.id = val;
                  else obj.name = val;
                  incrementObjectVersion();
                }}
                onBlur={(e) => {
                  // Commit with Validation
                  const rawVal = e.target.value;
                  const finalVal = rawVal.trim();
                  const field = selectedObjectType === 'SCENE' ? 'id' : 'name';

                  // Validation (Only for Name/ID)
                  let isValid = true;
                  const scene = game?.sceneManager?.currentScene;

                  if (selectedObjectType !== 'SCENE' && scene) {
                    // Check duplicates
                    // Check Entities
                    const dupEntity = scene.entities.find(
                      (ent) => ent.name === finalVal && ent !== game?.editor?.selectedObject
                    );
                    // Check Triggerboxes
                    const dupTrigger = scene.triggerboxes
                      ? scene.triggerboxes.find(
                          (tb) => tb.name === finalVal && tb !== game?.editor?.selectedObject
                        )
                      : null;

                    if (dupEntity || dupTrigger) {
                      console.warn(`[PropertiesPanel] Duplicate Name '${finalVal}' rejected.`);
                      // @ts-ignore
                      if (game.showMessage) game.showMessage(`Name '${finalVal}' already exists!`);
                      isValid = false;
                    }
                  }

                  if (isValid) {
                    handleChange(field, finalVal);
                  } else {
                    // Revert to original from real object
                    let realObj: any = null;
                    if (game?.editor) realObj = game.editor.selectedObject;

                    if (realObj) {
                      if (selectedObjectType === 'SCENE') obj.id = realObj.id;
                      else obj.name = realObj.name;
                      incrementObjectVersion();
                    }
                  }
                }}
              />
            </div>
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
                    <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                      <button className="e-btn" onClick={handleOpenTA}>
                        {hasTextAsset ? 'Open TA' : 'Create TA'}
                      </button>
                      <button className="e-btn" onClick={handleReadTA} disabled={isReadingTA}>
                        {isReadingTA ? 'Syncing...' : 'Sync TA'}
                      </button>
                      {hasTextAsset && (
                        <button className="e-btn" onClick={handleDeleteTA}>
                          Delete TA
                        </button>
                      )}
                    </div>
                    <div className="e-label ui-text-muted ui-text-small">
                      {textAssetPath}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {selectedObjectType !== 'SETTINGS' && selectedObjectType !== 'SCENE' && (
          <div className="e-row">
            <label className="e-label">Group #ID</label>
            <input
              type="text"
              className="e-input"
              value={obj.groupID || ''}
              onChange={(e) => {
                const val = e.target.value;
                // Auto-format: Ensure every token starts with #
                // 1. Split by comma
                const tokens = val.split(',');
                const newTokens = tokens.map((t) => {
                  // Don't auto-add to the very last token if it's empty (user just typed comma)
                  if (t.length === 0) return '';

                  let clean = t;
                  // If this is a new char entry (not just backspace), check prefix
                  const trimmed = t.trimStart();
                  if (trimmed.length > 0 && !trimmed.startsWith('#')) {
                    // Find where the white space ends to insert #
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

        {/* Entity Properties (Static, Actor, Entity) - Moved & Compacted */}
        {(selectedObjectType === 'Entity' ||
          selectedObjectType === 'Actor' ||
          selectedObjectType === 'Static') && (
          <>
            {/* Transform: X, Y, W, H */}
            <div
              className="e-row"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '5px' }}
            >
              <div>
                <label className="e-label">X</label>
                <input
                  type="number"
                  className="e-input"
                  value={obj.x ?? 0}
                  onChange={(e) => handleChange('x', e.target.value, true)}
                />
              </div>
              <div>
                <label className="e-label">Y</label>
                <input
                  type="number"
                  className="e-input"
                  value={obj.y ?? 0}
                  onChange={(e) => handleChange('y', e.target.value, true)}
                />
              </div>
              <div>
                <label className="e-label">W</label>
                <input
                  type="number"
                  className="e-input"
                  value={obj.width ?? 0}
                  onChange={(e) => handleChange('width', e.target.value, true)}
                />
              </div>
              <div>
                <label className="e-label">H</label>
                <input
                  type="number"
                  className="e-input"
                  value={obj.height ?? 0}
                  onChange={(e) => handleChange('height', e.target.value, true)}
                />
              </div>
            </div>

            {/* Scale, Layer, Parallax */}
            <div
              className="e-row"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}
            >
              <div>
                <label className="e-label">Scale</label>
                <input
                  type="number"
                  step="0.1"
                  className="e-input"
                  value={obj.modelScale || 1}
                  onChange={(e) => handleChange('modelScale', e.target.value, true)}
                />
              </div>
              <div>
                <label className="e-label">Layer</label>
                <input
                  type="number"
                  className="e-input"
                  value={obj.layer || 0}
                  onChange={(e) => handleChange('layer', e.target.value, true)}
                />
              </div>
              <div>
                <label className="e-label">Parallax</label>
                <input
                  type="number"
                  step="0.1"
                  className="e-input"
                  value={obj.parallax ?? 1}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    const newP = isNaN(val) ? 1.0 : val;
                    const oldP = obj.parallax !== undefined ? obj.parallax : 1.0;

                    // Auto-Correct Position to prevent visual jump
                    // NewPos = OldPos + Cam * (NewP - OldP)
                    const scene = game.sceneManager.currentScene;
                    if (scene && game.editor.selectedObject) {
                      const camX = scene.camera.x;
                      const camY = scene.camera.y;

                      const dx = camX * (newP - oldP);
                      const dy = camY * (newP - oldP);

                      // Apply to Local
                      obj.x += dx;
                      obj.y += dy;

                      // Apply to Real (Must do this manually as handleChange only does the targeting field)
                      if (
                        game.editor &&
                        game.editor.selectedObject &&
                        'x' in game.editor.selectedObject
                      ) {
                        (game.editor.selectedObject as any).x = obj.x;
                        (game.editor.selectedObject as any).y = obj.y;
                      }
                    }

                    handleChange('parallax', newP, true);
                  }}
                />
              </div>
            </div>

            {(selectedObjectType === 'Entity' ||
              selectedObjectType === 'Actor' ||
              selectedObjectType === 'Static') && (
              <div
                className="e-row"
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}
              >
                <div>
                  <label className="e-label">Parent</label>
                  <Select
                    className="parent-id-select"
                    value={obj.spatial?.parentNodeId || ''}
                    onChange={(value) => {
                      game.editor.saveUndoState();
                      obj.spatial = {
                        ...(obj.spatial || {}),
                        parentNodeId: value || null,
                        relation: value ? obj.spatial?.relation || 'in' : null,
                      };
                      incrementObjectVersion();
                      incrementHierarchyVersion();
                    }}
                    options={getSceneSpatialParentOptions()}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label className="e-label">Relation</label>
                  <Select
                    value={obj.spatial?.relation || ''}
                    onChange={(value) => {
                      game.editor.saveUndoState();
                      obj.spatial = {
                        ...(obj.spatial || {}),
                        parentNodeId: obj.spatial?.parentNodeId || null,
                        relation: value || (obj.spatial?.parentNodeId ? 'in' : null),
                      };
                      incrementObjectVersion();
                      incrementHierarchyVersion();
                    }}
                    options={getSpatialRelationOptions(!!obj.spatial?.parentNodeId)}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            )}

            {/* Color & Blend Mode */}
            <div
              className="e-row"
              style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '5px' }}
            >
              <div>
                <label className="e-label">Color</label>
                <div style={{ display: 'flex', gap: '5px' }}>
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
                    value={obj.color || '#AAAAAA'}
                    onChange={(e) => handleChange('color', e.target.value)}
                  />
                  <input
                    type="text"
                    className="e-input"
                    style={{ flex: 1, minWidth: 0 }}
                    value={obj.color || ''}
                    onChange={(e) => handleChange('color', e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="e-label">Blend Mode</label>
                <Select
                  value={obj.blendMode || 'source-over'}
                  onChange={(value) => handleChange('blendMode', value)}
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

            {/* Opacity & Blur */}
            <div
              className="e-row"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}
            >
              <div>
                <label className="e-label">
                  Opacity ({Math.round((obj.opacity !== undefined ? obj.opacity : 1.0) * 100)}%)
                </label>
                <input
                  type="range"
                  className="e-input"
                  style={{ width: '100%' }}
                  min="0"
                  max="1"
                  step="0.05"
                  value={obj.opacity !== undefined ? obj.opacity : 1.0}
                  onChange={(e) => handleChange('opacity', e.target.value, true)}
                />
              </div>
              <div>
                <label className="e-label">Blur ({obj.blur || 0}px)</label>
                <input
                  type="range"
                  className="e-input"
                  style={{ width: '100%', direction: 'ltr' }}
                  min="0"
                  max="50"
                  step="1"
                  value={50 - (obj.blur || 0)}
                  onChange={(e) => handleChange('blur', 50 - parseInt(e.target.value))}
                />
              </div>
            </div>

            {/* Sprite */}
            <div className="e-row">
              <label className="e-label">Sprite</label>
              <div style={{ display: 'flex', gap: '5px' }}>
                <input
                  type="text"
                  className="e-input"
                  style={{ flex: 1 }}
                  value={obj.spriteName || ''}
                  onChange={(e) => handleChange('spriteName', e.target.value)}
                />
                <button
                  className="e-btn"
                  onClick={() =>
                    game.openFileBrowser('load', 'public/sprites', (f) =>
                      handleChange('spriteName', f)
                    )
                  }
                >
                  ...
                </button>
              </div>
            </div>

            {/* Colliders + Flags */}
            <div
              className="e-row"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}
            >
              <div>
                <label className="e-label">Collider W</label>
                <input
                  type="number"
                  className="e-input"
                  value={obj.colliderWidth ?? 0}
                  onChange={(e) => handleChange('colliderWidth', e.target.value, true)}
                />
              </div>
              <div>
                <label className="e-label">Collider H</label>
                <input
                  type="number"
                  className="e-input"
                  value={obj.colliderHeight ?? 0}
                  onChange={(e) => handleChange('colliderHeight', e.target.value, true)}
                />
              </div>
            </div>

            <div className="e-row">
              <label className="e-label" style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  style={{ marginRight: '5px' }}
                  checked={!!obj.ignoreScaling}
                  onChange={(e) => handleChange('ignoreScaling', e.target.checked)}
                />
                Disable Depth Scaling
              </label>
            </div>

            <div className="e-row">
              <label className="e-label" style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  style={{ marginRight: '5px' }}
                  checked={!!obj.locked}
                  onChange={(e) => handleChange('locked', e.target.checked)}
                />
                Lock Object
              </label>
            </div>
            <div className="e-row">
              <label className="e-label ui-inline-flex-center ui-text-accent-red">
                <input
                  type="checkbox"
                  style={{ marginRight: '5px' }}
                  checked={!!obj.disabled}
                  onChange={(e) => handleChange('disabled', e.target.checked)}
                />
                Disabled (Hidden)
              </label>
            </div>

            {/* Interactions */}
            <div className="e-row ui-divider-blue" style={{ marginTop: '10px', paddingTop: '5px' }}>
              <div
                className="e-label ui-text-accent-blue ui-font-bold"
                style={{ display: 'flex', justifyContent: 'space-between' }}
              >
                <span>SCRIPT EVENTS</span>
                <Select
                  value=""
                  className="compact-action-select"
                  placeholder="+ ADD"
                  onChange={(value) => {
                    const verb = value;
                    if (!verb) return;
                    if (!obj.interactions) obj.interactions = {};
                    if (!obj.interactions[verb]) {
                      obj.interactions[verb] = '';
                      // Sync to real object
                      if (game.editor.selectedObject) {
                        if (!(game.editor.selectedObject as any).interactions)
                          (game.editor.selectedObject as any).interactions = {};
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

              {obj.interactions &&
                Object.keys(obj.interactions).map((verb) => (
                  <div
                    key={verb}
                    style={{ display: 'flex', alignItems: 'center', marginTop: '2px' }}
                  >
                    <div className="ui-text-light" style={{ width: '40px', fontSize: '0.85em' }}>
                      {verb.toUpperCase()}
                    </div>
                    <input
                      type="text"
                      className="e-input"
                      style={{ flex: 1, fontSize: '0.85em' }}
                      placeholder="Script ID"
                      value={obj.interactions[verb]}
                      onChange={(e) => {
                        obj.interactions[verb] = e.target.value;
                        // Sync to real object
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
                        delete obj.interactions[verb];
                        // Sync to real object
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
          </>
        )}

        {/* Walkbox/Triggerbox Properties */}
        {(selectedObjectType === 'Walkbox' || selectedObjectType === 'Triggerbox') && (
          <div className="e-row">
            {selectedObjectType === 'Walkbox' && (
              <div className="e-row">
                <label className="e-label">Mode</label>
                <Select
                  value={obj.mode || 'Invert'}
                  onChange={(value) => handleChange('mode', value)}
                  options={[
                    { value: 'Invert', label: 'Invert (Standard)' },
                    { value: 'Add', label: 'Add (Bridge)' },
                    { value: 'Subtract', label: 'Subtract (Hole)' },
                  ]}
                  style={{ width: '100%', marginBottom: '5px' }}
                />
              </div>
            )}
            <button
              className="e-btn e-btn-yellow"
              style={{ width: '100%', marginBottom: '5px' }}
              onClick={(e) => {
                if (confirm('Redraw polygon? Current points will be cleared.')) {
                  // Clean Redraw Logic: Editor handles clearing and mode setting
                  game.editor.redrawSelected();
                  // Blur the button so hitting Enter doesn't re-trigger it
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

            {selectedObjectType === 'Triggerbox' && (
              <>
                <div className="e-row">
                  <label className="e-label">Layer</label>
                  <input
                    type="number"
                    className="e-input"
                    value={obj.layer || 0}
                    onChange={(e) => handleChange('layer', e.target.value, true)}
                  />
                </div>
                <div
                  className="e-row"
                  style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}
                >
                  <div>
                    <label className="e-label">Parent</label>
                    <Select
                      className="parent-id-select"
                      value={obj.spatial?.parentNodeId || ''}
                      onChange={(value) => {
                        game.editor.saveUndoState();
                        obj.spatial = {
                          ...(obj.spatial || {}),
                          parentNodeId: value || null,
                          relation: value ? obj.spatial?.relation || 'in' : null,
                        };
                        incrementObjectVersion();
                        incrementHierarchyVersion();
                      }}
                      options={getSceneSpatialParentOptions()}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label className="e-label">Relation</label>
                    <Select
                      value={obj.spatial?.parentNodeId ? obj.spatial?.relation || 'in' : obj.spatial?.relation || ''}
                      onChange={(value) => {
                        game.editor.saveUndoState();
                        obj.spatial = {
                          ...(obj.spatial || {}),
                          parentNodeId: obj.spatial?.parentNodeId || null,
                          relation: value || (obj.spatial?.parentNodeId ? 'in' : null),
                        };
                        incrementObjectVersion();
                        incrementHierarchyVersion();
                      }}
                      options={getSpatialRelationOptions(!!obj.spatial?.parentNodeId)}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
              </>
            )}

            <div className="e-row">
              <label className="e-label" style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  style={{ marginRight: '5px' }}
                  checked={!!obj.locked}
                  onChange={(e) => handleChange('locked', e.target.checked)}
                />
                Lock Object (Prevent Mouse Edit)
              </label>
            </div>
            <div className="e-row">
              <label className="e-label ui-inline-flex-center ui-text-accent-red">
                <input
                  type="checkbox"
                  style={{ marginRight: '5px' }}
                  checked={!!obj.disabled}
                  onChange={(e) => handleChange('disabled', e.target.checked)}
                />
                Disabled (Hidden in Game)
              </label>
            </div>
          </div>
        )}

        {/* Quad Properties */}
        {selectedObjectType === 'Quad' && (
          <div className="e-row">
            {/* Layer */}
            <div className="e-row">
              <label className="e-label">Layer</label>
              <input
                type="number"
                className="e-input"
                value={obj.layer || 0}
                onChange={(e) => handleChange('layer', e.target.value, true)}
              />
            </div>

            {/* Opacity / Blur */}
            <div
              className="e-row"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}
            >
              <div>
                <label className="e-label">
                  Opacity ({Math.round((obj.opacity !== undefined ? obj.opacity : 1.0) * 100)}%)
                </label>
                <input
                  type="range"
                  className="e-input"
                  style={{ width: '100%' }}
                  min="0"
                  max="1"
                  step="0.05"
                  value={obj.opacity !== undefined ? obj.opacity : 1.0}
                  onChange={(e) => handleChange('opacity', e.target.value, true)}
                />
              </div>
              <div>
                <label className="e-label">Blur ({obj.blur || 0}px)</label>
                <input
                  type="range"
                  className="e-input"
                  style={{ width: '100%', direction: 'ltr' }}
                  min="0"
                  max="50"
                  step="1"
                  value={50 - (obj.blur || 0)}
                  onChange={(e) => handleChange('blur', 50 - parseInt(e.target.value))}
                />
              </div>
            </div>

            {/* Fill Color */}
            <div className="e-row">
              <label
                className="e-label"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginBottom: '4px',
                  color: obj.filled !== false ? '#ffffff' : 'inherit',
                }}
              >
                <input
                  type="checkbox"
                  style={{ marginRight: '5px' }}
                  checked={obj.filled !== false}
                  onChange={(e) => handleChange('filled', e.target.checked)}
                />
                Fill Color
              </label>
              {obj.filled !== false && (
                <div style={{ display: 'flex', gap: '5px' }}>
                  <input
                    type="color"
                    className="e-input"
                    style={{ width: '30px', padding: 0, height: '20px' }}
                    value={obj.color || '#888888'}
                    onChange={(e) => handleChange('color', e.target.value)}
                  />
                  <input
                    type="text"
                    className="e-input"
                    style={{ flex: 1 }}
                    value={obj.color || ''}
                    onChange={(e) => handleChange('color', e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Retro Grid */}
            <div className="e-row">
              <label
                className="e-label"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  color: obj.isGrid ? '#ffffff' : 'inherit',
                }}
              >
                <input
                  type="checkbox"
                  style={{ marginRight: '5px' }}
                  checked={obj.isGrid || false}
                  onChange={(e) => handleChange('isGrid', e.target.checked)}
                />
                Retro Grid
              </label>
            </div>

            {obj.isGrid && (
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
                      value={obj.gridLinesX ?? 5}
                      onChange={(e) => handleChange('gridLinesX', parseInt(e.target.value))}
                      min={1}
                      max={50}
                    />
                  </div>
                  <div>
                    <label className="e-label">Grid Y</label>
                    <input
                      type="number"
                      className="e-input"
                      value={obj.gridLinesY ?? 5}
                      onChange={(e) => handleChange('gridLinesY', parseInt(e.target.value))}
                      min={1}
                      max={50}
                    />
                  </div>
                  <div>
                    <label className="e-label">Width</label>
                    <input
                      type="number"
                      className="e-input"
                      value={obj.lineWidth ?? 1.0}
                      onChange={(e) => handleChange('lineWidth', parseFloat(e.target.value))}
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
                      style={{ width: '30px', padding: 0, height: '20px' }}
                      value={obj.gridColor || '#ffffff'}
                      onChange={(e) => handleChange('gridColor', e.target.value)}
                    />
                    <input
                      type="text"
                      className="e-input"
                      style={{ flex: 1 }}
                      value={obj.gridColor || ''}
                      onChange={(e) => handleChange('gridColor', e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            {/* Blend & Sort (Extras) */}
            <div
              className="e-row"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}
            >
              <div>
                <label className="e-label">Blend Mode</label>
                <Select
                  value={obj.blendMode || 'source-over'}
                  onChange={(value) => handleChange('blendMode', value)}
                  options={[
                    { value: 'source-over', label: 'Normal' },
                    { value: 'multiply', label: 'Multiply' },
                    { value: 'screen', label: 'Screen' },
                    { value: 'overlay', label: 'Overlay' },
                    { value: 'lighter', label: 'Add (Lighter)' },
                    { value: 'difference', label: 'Difference' },
                  ]}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label className="e-label">Sort Mode</label>
                <Select
                  value={obj.sortMode || 'ignore'}
                  onChange={(value) => handleChange('sortMode', value)}
                  options={[
                    { value: 'ignore', label: 'Ignore Y (Manual Layer)' },
                    { value: 'v0', label: 'By Vertex 0 (TL)' },
                    { value: 'v1', label: 'By Vertex 1 (TR)' },
                    { value: 'v2', label: 'By Vertex 2 (BR)' },
                    { value: 'v3', label: 'By Vertex 3 (BL)' },
                  ]}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div
              className="e-label"
              style={{ marginTop: '5px', borderBottom: '1px solid #444', marginBottom: '5px' }}
            >
              VERTICES (X / Y / P)
            </div>
            {obj.vertices &&
              obj.vertices.map((v: any, i: number) => {
                const isSelected = selectedVertexIndex === i;
                return (
                  <div
                    key={i}
                    style={{
                      marginBottom: '5px',
                      background: '#222',
                      padding: '4px',
                      borderRadius: '4px',
                      border: isSelected ? '1px solid yellow' : '1px solid transparent',
                    }}
                  >
                    <div className="ui-text-muted ui-text-tiny" style={{ marginBottom: '2px' }}>
                      Vertex {i}{' '}
                      {i === 0
                        ? '(TL)'
                        : i === 1
                          ? '(TR)'
                          : i === 2
                            ? '(BR)'
                            : i === 3
                              ? '(BL)'
                              : ''}
                      {v.binding && (
                        <span
                          style={{
                            color: '#00FFFF',
                            marginLeft: '5px',
                            display: 'inline-flex',
                            alignItems: 'center',
                          }}
                        >
                          L:
                          {v.binding.targetName.length > 8
                            ? v.binding.targetName.slice(0, 8) + '..'
                            : v.binding.targetName}
                          <button
                            title="Unbind Vertex"
                            style={{
                              background: '#444',
                              border: '1px solid #666',
                              color: '#fff',
                              fontSize: '0.7em',
                              marginLeft: '4px',
                              cursor: 'pointer',
                              padding: '0 4px',
                              borderRadius: '2px',
                              height: '16px',
                              lineHeight: '14px',
                            }}
                            onClick={() => {
                              const binding = v.binding;
                              // Unbind Self (UI Copy)
                              delete v.binding;
                              incrementObjectVersion();

                              // Sync to real object & Unbind Reverse
                              if (game.editor.selectedObject) {
                                const sel = game.editor.selectedObject as any;

                                // Unbind Self (Real)
                                if (sel.vertices[i].binding) delete sel.vertices[i].binding;

                                // Unbind Reverse (Real)
                                if (binding && binding.type === 'vertex') {
                                  const scene = game.sceneManager.currentScene;
                                  if (scene) {
                                    const target = scene.entities.find(
                                      (e: any) => e.name === binding.targetName
                                    );
                                    if (target && (target as any).type === 'Quad') {
                                      const tQuad = target as any;
                                      const tIdx = binding.index;
                                      if (tIdx !== undefined && tQuad.vertices[tIdx]) {
                                        const tV = tQuad.vertices[tIdx];
                                        // Check if target is bound back to US (Mutual)
                                        if (
                                          tV.binding &&
                                          tV.binding.type === 'vertex' &&
                                          tV.binding.targetName === sel.name &&
                                          tV.binding.index === i
                                        ) {
                                          delete tV.binding;
                                        }
                                      }
                                    }
                                  }
                                }

                                game.editor.saveUndoState();
                              }
                            }}
                          >
                            U
                          </button>
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '2px' }}>
                      <input
                        type="number"
                        className="e-input"
                        style={{ width: '33%' }}
                        value={Math.round(v.x)}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (v.x !== val) {
                            const diff = val - v.x;

                            // Propagate to Group
                            const scene = game.sceneManager.currentScene;
                            if (scene && (game.editor.selectedObject as any).type === 'Quad') {
                              const group = QuadObject.getConnectedVertices(
                                scene,
                                game.editor.selectedObject as QuadObject,
                                i
                              );
                              group.forEach((ref) => {
                                ref.v.x += diff;
                              });
                            } else {
                              v.x = val;
                            }

                            incrementObjectVersion();
                            game.editor.saveUndoState();
                          }
                        }}
                      />
                      <input
                        type="number"
                        className="e-input"
                        style={{ width: '33%' }}
                        value={Math.round(v.y)}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (v.y !== val) {
                            const diff = val - v.y;

                            // Propagate to Group
                            const scene = game.sceneManager.currentScene;
                            if (scene && (game.editor.selectedObject as any).type === 'Quad') {
                              const group = QuadObject.getConnectedVertices(
                                scene,
                                game.editor.selectedObject as QuadObject,
                                i
                              );
                              group.forEach((ref) => {
                                ref.v.y += diff;
                              });
                            } else {
                              v.y = val;
                            }

                            incrementObjectVersion();
                            game.editor.saveUndoState();
                          }
                        }}
                      />
                      <input
                        type="number"
                        className="e-input"
                        style={{ width: '33%' }}
                        step="0.1"
                        value={v.p}
                        onChange={(e) => {
                          const newP = parseFloat(e.target.value);
                          const oldP = v.p;
                          const diffP = newP - oldP;

                          const scene = game.sceneManager.currentScene;
                          if (scene && (game.editor.selectedObject as any).type === 'Quad') {
                            const group = QuadObject.getConnectedVertices(
                              scene,
                              game.editor.selectedObject as QuadObject,
                              i
                            );

                            group.forEach((ref) => {
                              // Auto-Correct Position to prevent visual jump
                              // NewPos = OldPos + Cam * (NewP - OldP)
                              const camX = scene.camera.x;
                              const camY = scene.camera.y;
                              ref.v.x += camX * diffP;
                              ref.v.y += camY * diffP;

                              ref.v.p = newP; // All adopt the new P? Yes, per "changes parallax together".
                            });
                          } else {
                            // Single logic
                            if (scene) {
                              const camX = scene.camera.x;
                              const camY = scene.camera.y;
                              v.x += camX * diffP;
                              v.y += camY * diffP;
                            }
                            v.p = newP;
                          }

                          incrementObjectVersion();
                          game.editor.saveUndoState();
                        }}
                      />
                    </div>
                  </div>
                );
              })}

            <div className="e-row">
              <label className="e-label" style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  style={{ marginRight: '5px' }}
                  checked={!!obj.locked}
                  onChange={(e) => handleChange('locked', e.target.checked)}
                />
                Lock Object
              </label>
            </div>
            <div className="e-row">
              <label className="e-label ui-inline-flex-center ui-text-accent-red">
                <input
                  type="checkbox"
                  style={{ marginRight: '5px' }}
                  checked={!!obj.disabled}
                  onChange={(e) => handleChange('disabled', e.target.checked)}
                />
                Disabled
              </label>
            </div>
            {/* Tips moved to bottom */}
          </div>
        )}

        {/* Trigger Components */}
        {(selectedObjectType === 'Triggerbox' ||
          selectedObjectType === 'Entity' ||
          selectedObjectType === 'Actor' ||
          selectedObjectType === 'Static' ||
          selectedObjectType === 'Quad') && (
          <div className="e-row ui-divider-red" style={{ paddingTop: '5px', marginTop: '5px' }}>
            <div
              className="e-label ui-text-accent-red ui-font-bold"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <span>COMPONENTS</span>
              <div>
                <Select
                  options={[
                    { value: 'Item', label: 'Item (Pickup)' },
                    { value: 'Subscene', label: 'Subscene' },
                    { value: 'Subtrigger', label: 'Subtrigger' },
                    { value: 'Switch', label: 'Switch' },
                    ...(selectedObjectType === 'Quad'
                      ? [
                          { value: 'Backface', label: 'Backface' },
                          { value: '3d-parallax', label: '3d-parallax' },
                          { value: 'WalkBox', label: 'WalkBox (Collider)' },
                        ]
                      : []),
                    ...(selectedObjectType === 'Actor'
                      ? [{ value: 'Shadow', label: 'Shadow' }]
                      : []),
                  ]}
                  placeholder="+ Add Component"
                  onChange={(value) => {
                    const type = value;
                    if (!type) return;
                    if (!obj.components) obj.components = [];

                    if (type === 'Subscene') {
                      obj.components.push({
                        type: 'Subscene',
                        targetGroupId: '',
                        title: '',
                        description: '',
                      });
                    } else if (type === 'Subtrigger') {
                      obj.components.push({ type: 'Subtrigger', target: '' });
                    } else if (type === 'Item') {
                      obj.components.push({ type: 'Item' });
                    } else if (type === 'Switch') {
                      obj.components.push({
                        type: 'Switch',
                        groupId1: '',
                        groupId2: '',
                        state: 1,
                        idKey: '',
                        sound1: '',
                        sound2: '',
                      });
                    } else if (type === 'Backface') {
                      obj.components.push({
                        type: 'Backface',
                        vertexA: 0,
                        vertexB: 1,
                        axis: 'x',
                        op: '>',
                        targetId: obj.name, // Auto-fill with self
                        cullingType: 'layer', // Default
                      });
                    } else if (type === 'Shadow') {
                      obj.components.push({
                        type: 'Shadow',
                        shadowQuadId: '',
                        offsetX: 0,
                        offsetY: 0,
                        triggerId: '',
                      });
                    } else if (type === '3d-parallax') {
                      obj.components.push({ type: '3d-parallax' });
                    } else if (type === 'WalkBox') {
                      obj.components.push({ type: 'WalkBox', mode: 'Invert' });
                    }

                    if (game.editor.selectedObject) {
                      (game.editor.selectedObject as any).components = obj.components;
                    }
                    incrementObjectVersion();
                    // No need to reset value as Select component handles it or we pass empty value
                  }}
                  style={{ width: '100%' }}
                  value=""
                />
              </div>
            </div>

            {obj.components &&
              obj.components.map((comp: any, idx: number) => (
                <div
                  key={idx}
                  style={{
                    background: '#332',
                    padding: '5px',
                    marginBottom: '5px',
                    borderRadius: '4px',
                    border: '1px solid #553',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '5px',
                    }}
                  >
                    <span className="ui-font-bold" style={{ color: '#fb8' }}>{comp.type}</span>
                    <button
                      className="e-btn e-btn-red"
                      style={{ padding: '0 5px' }}
                      onClick={() => {
                        obj.components.splice(idx, 1);
                        if (game.editor.selectedObject) {
                          (game.editor.selectedObject as any).components = obj.components;
                        }
                        incrementObjectVersion();
                      }}
                    >
                      x
                    </button>
                  </div>

                  {comp.type === 'Backface' && (
                    <>
                      <div
                        style={{
                          fontSize: '0.8em',
                          color: '#ccc',
                          fontStyle: 'italic',
                          marginBottom: '4px',
                        }}
                      >
                        Lowers Layer if A [op] B (e.g. A.x &gt; B.x).
                      </div>
                      <div className="e-row" style={{ display: 'flex', gap: '5px' }}>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '0.75em' }}>
                            Vert A (0-3)
                          </label>
                          <input
                            type="number"
                            className="e-input"
                            min="0"
                            max="3"
                            value={comp.vertexA}
                            onChange={(e) => {
                              comp.vertexA = parseInt(e.target.value);
                              incrementObjectVersion();
                            }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '0.75em' }}>
                            Vert B (0-3)
                          </label>
                          <input
                            type="number"
                            className="e-input"
                            min="0"
                            max="3"
                            value={comp.vertexB}
                            onChange={(e) => {
                              comp.vertexB = parseInt(e.target.value);
                              incrementObjectVersion();
                            }}
                          />
                        </div>
                      </div>
                      <div className="e-row" style={{ display: 'flex', gap: '5px' }}>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '0.75em' }}>
                            Axis
                          </label>
                          <Select
                            value={comp.axis}
                            onChange={(value) => {
                              comp.axis = value;
                              incrementObjectVersion();
                            }}
                            options={[
                              { value: 'x', label: 'X' },
                              { value: 'y', label: 'Y' },
                            ]}
                            style={{ width: '40px' }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '0.75em' }}>
                            Op
                          </label>
                          <Select
                            value={comp.op}
                            onChange={(value) => {
                              comp.op = value;
                              incrementObjectVersion();
                            }}
                            options={[
                              { value: '>', label: '>' },
                              { value: '<', label: '<' },
                            ]}
                            style={{ width: '40px' }}
                          />
                        </div>
                      </div>

                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '9px' }}>
                          Culling Type
                        </label>
                        <Select
                          value={comp.cullingType || 'layer'}
                          onChange={(value) => {
                            comp.cullingType = value;
                            incrementObjectVersion();
                          }}
                          options={[
                            { value: 'layer', label: 'Change Layer' },
                            { value: 'render', label: 'Disable Render' },
                          ]}
                          style={{ width: '100%' }}
                        />
                      </div>
                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Target ID(s) (Optional)
                        </label>
                        <input
                          type="text"
                          className="e-input"
                          value={comp.targetId || ''}
                          onChange={(e) => {
                            comp.targetId = e.target.value;
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                    </>
                  )}

                  {comp.type === 'Item' && (
                    <>
                      <div
                        style={{
                          fontSize: '10px',
                          color: '#ccc',
                          fontStyle: 'italic',
                          marginBottom: '4px',
                        }}
                      >
                        Can be picked up by player.
                      </div>
                      <div className="e-row">
                        <label
                          className="e-label ui-text-accent-blue ui-inline-flex-center"
                          style={{ fontSize: '10px' }}
                        >
                          <input
                            type="checkbox"
                            style={{ marginRight: '5px' }}
                            checked={!!comp.ignoreDistance}
                            onChange={(e) => {
                              comp.ignoreDistance = e.target.checked;
                              incrementObjectVersion();
                            }}
                          />
                          Ignore Distance (Always Pickup)
                        </label>
                      </div>
                    </>
                  )}

                  {comp.type === 'Subscene' && (
                    <>
                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Target ID(s)
                        </label>
                        <input
                          type="text"
                          className="e-input"
                          value={comp.targetGroupId || ''}
                          onChange={(e) => {
                            comp.targetGroupId = e.target.value;
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Title
                        </label>
                        <input
                          type="text"
                          className="e-input"
                          value={comp.title || ''}
                          onChange={(e) => {
                            comp.title = e.target.value;
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Description
                        </label>
                        <input
                          type="text"
                          className="e-input"
                          value={comp.description || ''}
                          onChange={(e) => {
                            comp.description = e.target.value;
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                    </>
                  )}

                  {comp.type === 'Subtrigger' && (
                    <>
                      <div className="e-row">
                        <div
                          style={{
                            fontSize: '10px',
                            color: '#ccc',
                            fontStyle: 'italic',
                            marginBottom: '4px',
                          }}
                        >
                          Delegates click to another Triggerbox.
                        </div>
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Target Trigger (Name/ID)
                        </label>
                        <input
                          type="text"
                          className="e-input"
                          value={comp.target || ''}
                          onChange={(e) => {
                            comp.target = e.target.value;
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                    </>
                  )}

                  {comp.type === '3d-parallax' && (
                    <>
                      <div className="e-row">
                        <div style={{ fontSize: '10px', color: '#ccc', fontStyle: 'italic' }}>
                          Interpolates Actor Parallax based on Quad's vertexes P.
                        </div>
                      </div>
                    </>
                  )}

                  {comp.type === 'WalkBox' && (
                    <>
                      <div className="e-row">
                        <div
                          style={{
                            fontSize: '10px',
                            color: '#ccc',
                            fontStyle: 'italic',
                            marginBottom: '5px',
                          }}
                        >
                          Treats this Quad as a Walkbox collider.
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <label className="e-label" style={{ marginRight: '5px' }}>
                            Mode:
                          </label>
                          <Select
                            value={comp.mode || 'Invert'}
                            onChange={(value) => {
                              comp.mode = value;
                              incrementObjectVersion();
                            }}
                            options={[
                              { value: 'Invert', label: 'Invert (Walk Inside)' },
                              { value: 'Add', label: 'Add (Walk Inside)' },
                              { value: 'Subtract', label: 'Subtract (Hole)' },
                            ]}
                            style={{ width: '100%' }}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {comp.type === 'Switch' && (
                    <>
                      <div className="e-row" style={{ display: 'flex', gap: '2px' }}>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '9px' }}>
                            Target(s) 1
                          </label>
                          <input
                            type="text"
                            className="e-input"
                            style={{ width: '100%' }}
                            value={comp.groupId1 || ''}
                            onChange={(e) => {
                              comp.groupId1 = e.target.value;
                              incrementObjectVersion();
                            }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '9px' }}>
                            Target(s) 2
                          </label>
                          <input
                            type="text"
                            className="e-input"
                            style={{ width: '100%' }}
                            value={comp.groupId2 || ''}
                            onChange={(e) => {
                              comp.groupId2 = e.target.value;
                              incrementObjectVersion();
                            }}
                          />
                        </div>
                      </div>

                      <div
                        className="e-row"
                        style={{ display: 'flex', gap: '5px', alignItems: 'center' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <label
                            className="e-label"
                            style={{ fontSize: '10px', marginRight: '5px' }}
                          >
                            State:
                          </label>
                          <Select
                            value={String(comp.state)}
                            onChange={(value) => {
                              comp.state = parseInt(value);
                              incrementObjectVersion();
                            }}
                            options={[
                              { value: '1', label: '1' },
                              { value: '2', label: '2' },
                            ]}
                            style={{ width: '40px' }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '9px' }}>
                            Key Item ID
                          </label>
                          <input
                            type="text"
                            className="e-input"
                            style={{ width: '100%' }}
                            value={comp.idKey || ''}
                            onChange={(e) => {
                              comp.idKey = e.target.value;
                              incrementObjectVersion();
                            }}
                          />
                        </div>
                      </div>

                      <div
                        className="e-row"
                        style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}
                      >
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '9px' }}>
                            Sound 1
                          </label>
                          <div style={{ display: 'flex' }}>
                            <input
                              type="text"
                              className="e-input"
                              style={{ width: '100%' }}
                              value={comp.sound1 || ''}
                              onChange={(e) => {
                                comp.sound1 = e.target.value;
                                incrementObjectVersion();
                              }}
                            />
                            <button
                              className="e-btn"
                              style={{ fontSize: '10px', padding: '0 4px', marginLeft: '2px' }}
                              onClick={() => {
                                if (game) {
                                  game.openFileBrowser(
                                    'load',
                                    'public/sounds',
                                    (file) => {
                                      // Strip 'public/sounds/' prefix if present? Or keeps relative?
                                      // AssetLoader handles 'public/' prefix.
                                      // Let's store just the filename if it's in public/sounds, or relative path.
                                      // FileBrowser usually returns full path relative to project root or something?
                                      // Game.ts: openFileBrowser ... onConfirm: (f) => ...
                                      // Let's assume f is the filename if we are in that dir?
                                      // Usually FileBrowser returns what's clicked.
                                      // Let's just use the basename if possible, or relative path.
                                      // Actually FileBrowser return value depends on implementation.
                                      // Let's assume it returns relative path 'public/sounds/file.mp3'
                                      let val = file;
                                      if (val.startsWith('public/sounds/'))
                                        val = val.replace('public/sounds/', '');
                                      if (val.startsWith('/sounds/'))
                                        val = val.replace('/sounds/', '');

                                      comp.sound1 = val;
                                      incrementObjectVersion();
                                    },
                                    '.mp3,.wav'
                                  ); // Pass multiple extensions if supported?
                                }
                              }}
                            >
                              ...
                            </button>
                          </div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '9px' }}>
                            Sound 2
                          </label>
                          <div style={{ display: 'flex' }}>
                            <input
                              type="text"
                              className="e-input"
                              style={{ width: '100%' }}
                              value={comp.sound2 || ''}
                              onChange={(e) => {
                                comp.sound2 = e.target.value;
                                incrementObjectVersion();
                              }}
                            />
                            <button
                              className="e-btn"
                              style={{ fontSize: '10px', padding: '0 4px', marginLeft: '2px' }}
                              onClick={() => {
                                if (game) {
                                  game.openFileBrowser(
                                    'load',
                                    'public/sounds',
                                    (file) => {
                                      let val = file;
                                      if (val.startsWith('public/sounds/'))
                                        val = val.replace('public/sounds/', '');
                                      if (val.startsWith('/sounds/'))
                                        val = val.replace('/sounds/', '');
                                      comp.sound2 = val;
                                      incrementObjectVersion();
                                    },
                                    '.mp3,.wav'
                                  );
                                }
                              }}
                            >
                              ...
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {comp.type === 'Shadow' && (
                    <>
                      <div className="e-row">
                        <div
                          style={{
                            fontSize: '10px',
                            color: '#ccc',
                            fontStyle: 'italic',
                            marginBottom: '4px',
                          }}
                        >
                          Controls a shadow quad based on trigger zones.
                        </div>
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Shadow Quad ID
                        </label>
                        <input
                          type="text"
                          className="e-input"
                          value={comp.shadowQuadId || ''}
                          onChange={(e) => {
                            comp.shadowQuadId = e.target.value;
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                      <div className="e-row" style={{ display: 'flex', gap: '5px' }}>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '10px' }}>
                            Offset X
                          </label>
                          <input
                            type="number"
                            className="e-input"
                            value={comp.offsetX || 0}
                            onChange={(e) => {
                              comp.offsetX = parseFloat(e.target.value);
                              incrementObjectVersion();
                            }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '10px' }}>
                            Offset Y
                          </label>
                          <input
                            type="number"
                            className="e-input"
                            value={comp.offsetY || 0}
                            onChange={(e) => {
                              comp.offsetY = parseFloat(e.target.value);
                              incrementObjectVersion();
                            }}
                          />
                        </div>
                      </div>
                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Trigger ID(s) (Zone)
                        </label>
                        <input
                          type="text"
                          className="e-input"
                          value={comp.triggerId || ''}
                          onChange={(e) => {
                            comp.triggerId = e.target.value;
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                    </>
                  )}
                </div>
              ))}
          </div>
        )}

        {selectedObjectType === 'Quad' && (
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

        {selectedObjectType === 'Actor' && (
          <>
            <div className="e-row ui-divider-blue" style={{ paddingTop: '5px' }}>
              <div className="e-label ui-text-accent-blue ui-font-bold">
                ACTOR PROPERTIES
              </div>
            </div>

            {/* Is Player */}
            <div className="e-row">
              <label className="e-label ui-inline-flex-center ui-text-accent-blue">
                <input
                  type="checkbox"
                  style={{ marginRight: '5px' }}
                  checked={!!obj.isPlayer}
                  onChange={(e) => handleChange('isPlayer', e.target.checked)}
                />
                Is Player
              </label>
            </div>

            {/* Direction */}
            <div className="e-row">
              <label className="e-label">Direction</label>
              <Select
                value={obj.direction || 'down'}
                onChange={(value) => {
                  handleChange('direction', value);
                  if (
                    game.editor.selectedObject &&
                    (game.editor.selectedObject as any).setDirection
                  ) {
                    (game.editor.selectedObject as any).setDirection(value);
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

            {/* Speed */}
            <div className="e-row">
              <label className="e-label">Move Speed</label>
              <input
                type="number"
                step="0.01"
                className="e-input"
                value={obj.speed !== undefined ? obj.speed : 0.1}
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
                value={obj.animationSpeed !== undefined ? obj.animationSpeed : 150}
                onChange={(e) => handleChange('animationSpeed', e.target.value, true)}
              />
            </div>

            {/* Animation Sets */}
            <div className="e-row" style={{ marginTop: '10px' }}>
              <div
                className="e-label ui-text-accent-blue ui-font-bold"
                style={{ display: 'flex', justifyContent: 'space-between' }}
              >
                <span>ANIMATION SETS</span>
                <button
                  className="e-btn"
                  style={{ padding: '0 5px', fontSize: '10px' }}
                  onClick={() => {
                    if (!obj.animSets) obj.animSets = {};
                    // Auto naming
                    let newId = 'idle';
                    if (obj.animSets['idle']) newId = 'walk';
                    if (obj.animSets['walk']) newId = 'state_' + Object.keys(obj.animSets).length;

                    // Add to local obj
                    obj.animSets[newId] = {
                      id: newId,
                      up: null,
                      down: null,
                      left: null,
                      right: null,
                    };

                    // Add to real obj
                    if (
                      game.editor.selectedObject &&
                      (game.editor.selectedObject as any).addAnimSet
                    ) {
                      (game.editor.selectedObject as any).addAnimSet(newId);
                    }
                    incrementObjectVersion();
                  }}
                >
                  + ADD
                </button>
              </div>
            </div>

            {/* List Sets */}
            {obj.animSets &&
              Object.keys(obj.animSets).map((setId) => {
                const set = obj.animSets[setId];
                return (
                  <div
                    key={setId}
                    style={{
                      background: '#222',
                      padding: '5px',
                      marginBottom: '5px',
                      borderRadius: '4px',
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
                          color: '#ddd',
                          background: 'transparent',
                          border: 'none',
                          borderBottom: '1px solid #444',
                          maxWidth: '100px',
                        }}
                        defaultValue={setId}
                        onBlur={(e) => {
                          const newName = e.target.value.trim();
                          if (newName && newName !== setId) {
                            if (obj.animSets[newName]) {
                              alert(`Animation set '${newName}' already exists!`);
                              e.target.value = setId;
                              return;
                            }
                            obj.animSets[newName] = obj.animSets[setId];
                            if (obj.animSets[newName].id) obj.animSets[newName].id = newName;
                            delete obj.animSets[setId];
                            incrementObjectVersion();
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                      />
                      <button
                        className="e-btn e-btn-red"
                        style={{ padding: '0 5px' }}
                        onClick={() => {
                          if (confirm(`Delete animation set '${setId}'?`)) {
                            delete obj.animSets[setId];
                            if (
                              game.editor.selectedObject &&
                              (game.editor.selectedObject as any).removeAnimSet
                            ) {
                              (game.editor.selectedObject as any).removeAnimSet(setId);
                            }
                            incrementObjectVersion();
                          }
                        }}
                      >
                        x
                      </button>
                    </div>

                    {/* Directions */}
                    {['down', 'up', 'left', 'right'].map((dir) => (
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
                              // Sync to real object
                              if (
                                game.editor.selectedObject &&
                                (game.editor.selectedObject as any).animSets
                              ) {
                                const realSet = (game.editor.selectedObject as any).animSets[setId];
                                if (realSet) realSet[dir] = f;
                                // If this is the current state, update sprite immediately
                                (game.editor.selectedObject as any).updateSpriteForState();
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
        )}

        {/* SCENE Properties */}
        {selectedObjectType === 'SCENE' && (
          <>
            {/* Camera properties */}
            {(obj.camera || obj.defaultCamera) && (
              <div className="e-row ui-divider-blue" style={{ paddingTop: '5px' }}>
                <div className="e-label ui-text-accent-blue ui-font-bold">
                  CAMERA
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}>
                  <div>
                    <label className="e-label">Cam X</label>
                    <input
                      type="number"
                      className="e-input"
                      value={obj.camera ? Math.round(obj.camera.x) : 0}
                      onChange={(e) => {
                        if (obj.camera) {
                          obj.camera.x = parseFloat(e.target.value);
                          incrementObjectVersion();
                        }
                      }}
                    />
                  </div>
                  <div>
                    <label className="e-label">Cam Y</label>
                    <input
                      type="number"
                      className="e-input"
                      value={obj.camera ? Math.round(obj.camera.y) : 0}
                      onChange={(e) => {
                        if (obj.camera) {
                          obj.camera.y = parseFloat(e.target.value);
                          incrementObjectVersion();
                        }
                      }}
                    />
                  </div>
                  <div>
                    <label className="e-label">Zoom</label>
                    <input
                      type="number"
                      step="0.1"
                      className="e-input"
                      value={obj.camera ? obj.camera.zoom : 1}
                      onChange={(e) => {
                        if (obj.camera) {
                          obj.camera.zoom = parseFloat(e.target.value);
                          incrementObjectVersion();
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="e-row" style={{ marginTop: '5px' }}>
                  <label className="e-label" style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      style={{ marginRight: '5px' }}
                      checked={!!obj.autoCenter}
                      onChange={(e) => handleChange('autoCenter', e.target.checked)}
                    />
                    Auto-Center on Player
                  </label>
                </div>
                <div
                  className="e-row"
                  style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}
                >
                  <div>
                    <label className="e-label">Cam Spd</label>
                    <input
                      type="number"
                      step="0.1"
                      className="e-input"
                      value={obj.cameraSpeed || 5}
                      onChange={(e) =>
                        handleChange('cameraSpeed', parseFloat(e.target.value), true)
                      }
                    />
                  </div>
                  <div>
                    <label className="e-label">Dead X</label>
                    <input
                      type="number"
                      className="e-input"
                      value={obj.camDeadzoneX !== undefined ? obj.camDeadzoneX : 50}
                      onChange={(e) =>
                        handleChange('camDeadzoneX', parseFloat(e.target.value), true)
                      }
                    />
                  </div>
                  <div>
                    <label className="e-label">Dead Y</label>
                    <input
                      type="number"
                      className="e-input"
                      value={obj.camDeadzoneY !== undefined ? obj.camDeadzoneY : 30}
                      onChange={(e) =>
                        handleChange('camDeadzoneY', parseFloat(e.target.value), true)
                      }
                    />
                  </div>
                </div>
                <>
                  <div className="e-row" style={{ marginTop: '5px' }}>
                    <div className="e-label ui-text-accent-blue">
                      Camera Bounds (Min/Max)
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                      <div>
                        <label className="e-label">Min X</label>
                        <input
                          type="number"
                          className="e-input"
                          placeholder="None"
                          value={obj.camMinX !== undefined ? obj.camMinX : ''}
                          onChange={(e) =>
                            handleChange(
                              'camMinX',
                              e.target.value === '' ? undefined : parseFloat(e.target.value),
                              false
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="e-label">Max X</label>
                        <input
                          type="number"
                          className="e-input"
                          placeholder="None"
                          value={obj.camMaxX !== undefined ? obj.camMaxX : ''}
                          onChange={(e) =>
                            handleChange(
                              'camMaxX',
                              e.target.value === '' ? undefined : parseFloat(e.target.value),
                              false
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="e-label">Min Y</label>
                        <input
                          type="number"
                          className="e-input"
                          placeholder="None"
                          value={obj.camMinY !== undefined ? obj.camMinY : ''}
                          onChange={(e) =>
                            handleChange(
                              'camMinY',
                              e.target.value === '' ? undefined : parseFloat(e.target.value),
                              false
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="e-label">Max Y</label>
                        <input
                          type="number"
                          className="e-input"
                          placeholder="None"
                          value={obj.camMaxY !== undefined ? obj.camMaxY : ''}
                          onChange={(e) =>
                            handleChange(
                              'camMaxY',
                              e.target.value === '' ? undefined : parseFloat(e.target.value),
                              false
                            )
                          }
                        />
                      </div>
                    </div>
                  </div>
                </>
              </div>
            )}

            {/* Default Camera (Start Position) */}
            {obj.defaultCamera && (
              <div className="e-row ui-divider-blue" style={{ paddingTop: '5px' }}>
                <div className="e-label ui-text-accent-blue ui-font-bold">
                  DEFAULT CAMERA
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}>
                  <div>
                    <label className="e-label">Def X</label>
                    <input
                      type="number"
                      className="e-input"
                      value={Math.round(obj.defaultCamera.x)}
                      onChange={(e) => {
                        obj.defaultCamera.x = parseFloat(e.target.value);
                        incrementObjectVersion();
                      }}
                    />
                  </div>
                  <div>
                    <label className="e-label">Def Y</label>
                    <input
                      type="number"
                      className="e-input"
                      value={Math.round(obj.defaultCamera.y)}
                      onChange={(e) => {
                        obj.defaultCamera.y = parseFloat(e.target.value);
                        incrementObjectVersion();
                      }}
                    />
                  </div>
                  <div>
                    <label className="e-label">Def Zoom</label>
                    <input
                      type="number"
                      step="0.1"
                      className="e-input"
                      value={obj.defaultCamera.zoom}
                      onChange={(e) => {
                        obj.defaultCamera.zoom = parseFloat(e.target.value);
                        incrementObjectVersion();
                      }}
                    />
                  </div>
                </div>
                <div className="e-row" style={{ marginTop: '5px' }}>
                  <button
                    className="e-btn"
                    style={{ width: '100%' }}
                    onClick={() => {
                      if (obj.camera && obj.defaultCamera) {
                        obj.defaultCamera.x = obj.camera.x;
                        obj.defaultCamera.y = obj.camera.y;
                        obj.defaultCamera.zoom = obj.camera.zoom;
                        incrementObjectVersion();
                      }
                    }}
                  >
                    Set Current as Default
                  </button>
                </div>
              </div>
            )}

            {/* Scaling Settings */}
            {game.sceneManager.currentScene && (
              <div className="e-row ui-divider-yellow" style={{ paddingTop: '5px' }}>
                <div className="e-label ui-text-accent-yellow ui-font-bold">
                  SCALING
                </div>
                {(() => {
                  const s = game.sceneManager.currentScene.scaling;
                  return (
                    <>
                      <div className="e-row">
                        <label
                          className="e-label"
                          style={{ display: 'flex', alignItems: 'center' }}
                        >
                          <input
                            type="checkbox"
                            style={{ marginRight: '5px' }}
                            checked={s.enabled}
                            onChange={(e) => {
                              game.editor.setScalingEnabled(e.target.checked);
                              incrementObjectVersion();
                            }}
                          />
                          Enable Depth Scaling
                        </label>
                      </div>
                      {s.enabled && (
                        <div
                          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}
                        >
                          <div>
                            <label className="e-label">Min</label>
                            <input
                              type="number"
                              step="0.1"
                              className="e-input"
                              value={s.min}
                              onChange={(e) => {
                                s.min = parseFloat(e.target.value);
                                incrementObjectVersion();
                              }}
                            />
                          </div>
                          <div>
                            <label className="e-label">Max</label>
                            <input
                              type="number"
                              step="0.1"
                              className="e-input"
                              value={s.max}
                              onChange={(e) => {
                                s.max = parseFloat(e.target.value);
                                incrementObjectVersion();
                              }}
                            />
                          </div>
                          <div>
                            <label className="e-label">Horizon Y</label>
                            <input
                              type="number"
                              className="e-input"
                              value={s.horizon}
                              onChange={(e) => {
                                s.horizon = parseFloat(e.target.value);
                                incrementObjectVersion();
                              }}
                            />
                          </div>
                          <div>
                            <label className="e-label">Front Y</label>
                            <input
                              type="number"
                              className="e-input"
                              value={s.front}
                              onChange={(e) => {
                                s.front = parseFloat(e.target.value);
                                incrementObjectVersion();
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </>
        )}

        {/* SETTINGS Properties */}
        {selectedObjectType === 'SETTINGS' && (
          <>
            <div className="e-row">
              <label
                className="e-label ui-text-accent-green ui-font-bold"
                style={{ marginBottom: '10px' }}
              >
                EDITOR SETTINGS
              </label>
            </div>

            {/* UI Scale */}
            <div className="e-row">
              <label
                className="e-label"
                style={{ display: 'flex', justifyContent: 'space-between' }}
              >
                UI Scale <span>{(obj.editor?.uiScale || 1.0).toFixed(1)}x</span>
              </label>
              <input
                type="number"
                className="e-input"
                min="0.5"
                max="2.0"
                step="0.1"
                value={obj.editor?.uiScale || 1.0}
                onChange={(e) => {
                  if (!obj.editor) obj.editor = { uiScale: 1.0 };
                  obj.editor.uiScale = parseFloat(e.target.value);
                  incrementObjectVersion();
                  // Trigger re-render of other panels that might depend on this?
                  // Hierarchy panel subscribes to hierarchyVersion, but maybe we need a global UI version?
                  // For now, let's just force update via state.
                  useEditorStore.getState().incrementHierarchyVersion();
                }}
              />
            </div>

            <div className="e-row" style={{ marginTop: '10px' }}>
              <label
                className="e-label ui-text-accent-green ui-font-bold"
                style={{ marginBottom: '10px' }}
              >
                CRT EFFECT SETTINGS
              </label>
            </div>

            {/* Enabled Toggle */}
            <div className="e-row">
              <label className="e-label" style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  style={{ marginRight: '5px' }}
                  checked={obj.crt?.enabled ?? true}
                  onChange={(e) => {
                    if (obj.crt) {
                      obj.crt.enabled = e.target.checked;
                      incrementObjectVersion();
                    }
                  }}
                />
                Enable CRT Filter
              </label>
            </div>

            {/* Controls (Only if enabled) */}
            {obj.crt?.enabled && (
              <>
                <div className="e-row">
                  <label
                    className="e-label"
                    style={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    Curvature <span>{obj.crt.curvature.toFixed(2)}</span>
                  </label>
                  <input
                    type="range"
                    className="e-input"
                    min="0"
                    max="0.5"
                    step="0.01"
                    value={obj.crt.curvature}
                    onChange={(e) => {
                      obj.crt.curvature = parseFloat(e.target.value);
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div className="e-row">
                  <label
                    className="e-label"
                    style={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    Vignette <span>{obj.crt.vignette.toFixed(2)}</span>
                  </label>
                  <input
                    type="range"
                    className="e-input"
                    min="0"
                    max="1"
                    step="0.05"
                    value={obj.crt.vignette}
                    onChange={(e) => {
                      obj.crt.vignette = parseFloat(e.target.value);
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div className="e-row">
                  <label
                    className="e-label"
                    style={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    Scanline Count <span>{Math.round(obj.crt.scanlineCount)}</span>
                  </label>
                  <input
                    type="range"
                    className="e-input"
                    min="100"
                    max="2000"
                    step="50"
                    value={obj.crt.scanlineCount}
                    onChange={(e) => {
                      obj.crt.scanlineCount = parseFloat(e.target.value);
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div className="e-row">
                  <label
                    className="e-label"
                    style={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    Scanline Intensity <span>{obj.crt.scanlineIntensity.toFixed(2)}</span>
                  </label>
                  <input
                    type="range"
                    className="e-input"
                    min="0"
                    max="1"
                    step="0.05"
                    value={obj.crt.scanlineIntensity}
                    onChange={(e) => {
                      obj.crt.scanlineIntensity = parseFloat(e.target.value);
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div className="e-row">
                  <label
                    className="e-label"
                    style={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    RGB Split <span>{obj.crt.aberration.toFixed(1)}</span>
                  </label>
                  <input
                    type="range"
                    className="e-input"
                    min="0"
                    max="5"
                    step="0.1"
                    value={obj.crt.aberration}
                    onChange={(e) => {
                      obj.crt.aberration = parseFloat(e.target.value);
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div className="e-row">
                  <label
                    className="e-label"
                    style={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    Bloom <span>{obj.crt.bloom.toFixed(2)}</span>
                  </label>
                  <input
                    type="range"
                    className="e-input"
                    min="0"
                    max="1"
                    step="0.05"
                    value={obj.crt.bloom}
                    onChange={(e) => {
                      obj.crt.bloom = parseFloat(e.target.value);
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div className="e-row">
                  <label
                    className="e-label"
                    style={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    Phosphor / Grain{' '}
                    <span>{obj.crt.phosphor ? obj.crt.phosphor.toFixed(2) : '0.00'}</span>
                  </label>
                  <input
                    type="range"
                    className="e-input"
                    min="0"
                    max="1"
                    step="0.05"
                    value={obj.crt.phosphor || 0}
                    onChange={(e) => {
                      obj.crt.phosphor = parseFloat(e.target.value);
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div className="e-row">
                  <label className="e-label" style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      style={{ marginRight: '5px' }}
                      checked={obj.crt.bezelGlow}
                      onChange={(e) => {
                        obj.crt.bezelGlow = e.target.checked;
                        incrementObjectVersion();
                      }}
                    />
                    Bezel Glow
                  </label>
                </div>
              </>
            )}

            <div className="e-row ui-divider-neutral" style={{ marginTop: '20px', paddingTop: '10px' }}>
              <button
                className="e-btn"
                style={{ width: '100%', padding: '8px' }}
                onClick={() => {
                  if (game && game.saveSettings) {
                    game.saveSettings();
                  }
                }}
              >
                SAVE SETTINGS
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
