import React, { useEffect, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { Game } from '../../core/Game';

export const PropertiesPanel: React.FC = () => {
    const { selectedObjectId, selectedObjectType, hierarchyVersion, incrementHierarchyVersion, objectVersion, incrementObjectVersion, mode } = useEditorStore();
    const [obj, setObj] = useState<any>(null);

    // Refresh local object reference when selection or hierarchy changes
    useEffect(() => {
        const editor = Game.instance?.editor;
        if (!editor) return;

        const sel = editor.selectedObject as any;
        if (sel === 'SETTINGS') {
            // Special case: Bind to Global Settings
            setObj(Game.instance.settings);
        } else if (sel === 'SCENE') {
            // Special case: Bind to Current Scene
            setObj({ ...Game.instance.sceneManager.currentScene });
        } else if (editor.selectedObject) {
            setObj(editor.selectedObject);
            // Force update to read new values
            setObj({ ...editor.selectedObject });
        } else {
            setObj(null);
        }
    }, [selectedObjectId, hierarchyVersion, objectVersion]);

    if (!obj && selectedObjectId !== 'SETTINGS') {
        return (
            <div
                id="editor-panel"
                className="bg-gray-900 border-l border-gray-700 h-full p-2 text-sm text-gray-400"
                onMouseEnter={() => { if (Game.instance) Game.instance.isMouseOverUI = true; }}
                onMouseLeave={() => { if (Game.instance) Game.instance.isMouseOverUI = false; }}
            >
                <div className="font-bold border-b border-gray-700 mb-2 pb-1">PROPERTIES</div>
                No Selection
            </div>
        );
    }

    const handleChange = (field: string, value: any, enforceNumber = false) => {
        if (!obj) return;

        if (enforceNumber) {
            value = parseFloat(value);
            if (isNaN(value)) value = 0;
        }

        // 1. Identify Real Object
        let realObj: any = null;
        if (selectedObjectId === 'SCENE') {
            realObj = Game.instance?.sceneManager?.currentScene;
        } else if (selectedObjectId === 'SETTINGS') {
            realObj = Game.instance?.settings;
        } else if (Game.instance && Game.instance.editor) {
            realObj = Game.instance.editor.selectedObject;
        }

        // 2. Apply to Real Object
        if (realObj) {
            realObj[field] = value;
        } else {
            console.error(`[PropertiesPanel] Failed to find Real Object for ID: ${selectedObjectId}`);
        }

        // 3. Update Local State
        obj[field] = value;
        setObj({ ...obj }); // Force re-render

        // Signal update back to store/game loop if needed
        incrementObjectVersion();

        // Special handling for Name changes (needs hierarchy refresh)
        if (field === 'name') {
            incrementHierarchyVersion();
        }

        // Special handling for Sprite changes (reload)
        if (field === 'spriteName') {
            if (realObj && realObj.setSprite) realObj.setSprite(value);
        }

        // Special handling for Ignore Scaling (preserve visual size)
        if (field === 'ignoreScaling') {
            const isIgnored = value;
            const scene = Game.instance.sceneManager.currentScene;
            if (scene && realObj && (selectedObjectType === 'Static' || selectedObjectType === 'Actor' || selectedObjectType === 'Entity')) {
                const ent = realObj; // Use Real Object
                const currentVisW = ent.width;
                const currentVisH = ent.height;
                const modelScale = ent.modelScale || 1.0;

                let targetFactor = modelScale;

                if (!isIgnored) {
                    // Enable Depth Scaling: Scale = Model * Depth
                    let depthFactor = 1.0;
                    if (scene.scaling && scene.scaling.enabled) {
                        depthFactor = scene.getScaling(ent.y);
                    }
                    targetFactor = modelScale * depthFactor;
                }

                // Recalculate Base Dimensions to maintain Visual Size
                if (targetFactor !== 0) {
                    ent.baseWidth = currentVisW / targetFactor;
                    ent.baseHeight = currentVisH / targetFactor;
                } else {
                    ent.baseWidth = currentVisW;
                    ent.baseHeight = currentVisH;
                }

                // Apply immediate scale to prevent jitter
                ent.scale = targetFactor;

                // Sync to local object
                obj.baseWidth = ent.baseWidth;
                obj.baseHeight = ent.baseHeight;
                obj.scale = ent.scale;
                setObj({ ...obj });
            }
        }

        // Special handling for Animation Speed (Live Update)
        if (field === 'animationSpeed') {
            if (realObj && realObj.animator) {
                realObj.animator.frameDuration = value;
            }
        }
    };

    return (

        <div
            id="editor-panel"
            className="editor-sidebar right"
            onMouseEnter={() => { if (Game.instance) Game.instance.isMouseOverUI = true; }}
            onMouseLeave={() => { if (Game.instance) Game.instance.isMouseOverUI = false; }}
        >
            <div className="editor-header">
                <span>{selectedObjectType === 'SETTINGS' ? 'SETTINGS' : 'PROPERTIES'}</span>
                <button className="e-btn" onClick={() => (useEditorStore.getState().toggle(false))}>X</button>
            </div>

            <div className="editor-content">
                {selectedObjectType !== 'SETTINGS' && (
                    <>
                        <div className="e-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label className="e-label" style={{ marginBottom: 0 }}>Type</label>
                            <div style={{ color: '#fff', fontFamily: 'monospace' }}>{selectedObjectType}</div>
                        </div>

                        {/* Common: Name -> ID */}
                        <div className="e-row">
                            <label className="e-label">{selectedObjectType === 'SCENE' ? 'ID/File' : 'ID'}</label>
                            <input
                                type="text"
                                className="e-input"
                                value={selectedObjectType === 'SCENE' ? (obj.id || '') : (obj.name || '')}
                                onChange={(e) => handleChange(selectedObjectType === 'SCENE' ? 'id' : 'name', e.target.value)}
                            />
                        </div>
                    </>
                )}

                {selectedObjectType !== 'SETTINGS' && selectedObjectType !== 'SCENE' && (
                    <div className="e-row">
                        <label className="e-label">Group ID</label>
                        <input
                            type="text"
                            className="e-input"
                            value={obj.groupID || ''}
                            onChange={(e) => handleChange('groupID', e.target.value)}
                        />
                    </div>
                )}

                {/* Walkbox/Triggerbox Properties */}
                {(selectedObjectType === 'Walkbox' || selectedObjectType === 'Triggerbox') && (
                    <div className="e-row">
                        {selectedObjectType === 'Walkbox' && (
                            <div className="e-row">
                                <label className="e-label">Mode</label>
                                <select
                                    className="e-input"
                                    value={obj.mode || 'Invert'}
                                    onChange={(e) => handleChange('mode', e.target.value)}
                                >
                                    <option value="Invert">Invert (Standard)</option>
                                    <option value="Add">Add (Bridge)</option>
                                    <option value="Subtract">Subtract (Hole)</option>
                                </select>
                            </div>
                        )}
                        <button
                            className="e-btn e-btn-yellow"
                            style={{ width: '100%', marginBottom: '5px' }}
                            onClick={(e) => {
                                if (confirm("Redraw polygon? Current points will be cleared.")) {
                                    // Clean Redraw Logic: Editor handles clearing and mode setting
                                    Game.instance.editor.redrawSelected();
                                    // Blur the button so hitting Enter doesn't re-trigger it
                                    (e.target as HTMLElement).blur();
                                }
                            }}
                        >
                            Redraw Polygon
                        </button>
                        <div className="e-label">
                            {mode && mode.includes('DRAW')
                                ? "Click to add points. Press ENTER to finish. Hold Shift for 22.5° snap."
                                : "To edit, drag vertices on screen. Hold Shift for 22.5° snap."}
                        </div>

                        <div className="e-row">
                            <label className="e-label" style={{ display: 'flex', alignItems: 'center', color: '#ccc' }}>
                                <input type="checkbox" style={{ marginRight: '5px' }} checked={!!obj.locked} onChange={(e) => handleChange('locked', e.target.checked)} />
                                Lock Object (Prevent Mouse Edit)
                            </label>
                        </div>
                        <div className="e-row">
                            <label className="e-label" style={{ display: 'flex', alignItems: 'center', color: '#faa' }}>
                                <input type="checkbox" style={{ marginRight: '5px' }} checked={!!obj.disabled} onChange={(e) => handleChange('disabled', e.target.checked)} />
                                Disabled (Hidden in Game)
                            </label>
                        </div>
                    </div>
                )}

                {/* Trigger Components */}
                {selectedObjectType === 'Triggerbox' && (
                    <div className="e-row" style={{ borderTop: '1px solid #444', paddingTop: '5px', marginTop: '5px' }}>
                        <div className="e-label" style={{ color: '#faa', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>
                            <span>COMPONENTS</span>
                            <button className="e-btn" style={{ padding: '0 5px', fontSize: '10px' }} onClick={() => {
                                if (!obj.components) obj.components = [];
                                // Add Subscene Component
                                obj.components.push({ type: 'Subscene', targetGroupId: '', name: '' });
                                // Sync real object
                                if (Game.instance.editor.selectedObject) {
                                    (Game.instance.editor.selectedObject as any).components = obj.components;
                                }
                                setObj({ ...obj });
                            }}>+ Subscene</button>
                        </div>

                        {obj.components && obj.components.map((comp: any, idx: number) => (
                            <div key={idx} style={{ background: '#332', padding: '5px', marginBottom: '5px', borderRadius: '4px', border: '1px solid #553' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                    <span style={{ fontWeight: 'bold', color: '#fb8' }}>{comp.type}</span>
                                    <button className="e-btn e-btn-red" style={{ padding: '0 5px' }} onClick={() => {
                                        obj.components.splice(idx, 1);
                                        if (Game.instance.editor.selectedObject) {
                                            (Game.instance.editor.selectedObject as any).components = obj.components;
                                        }
                                        setObj({ ...obj });
                                    }}>x</button>
                                </div>

                                {comp.type === 'Subscene' && (
                                    <>
                                        <div className="e-row">
                                            <label className="e-label" style={{ fontSize: '10px' }}>Target Group ID</label>
                                            <input type="text" className="e-input" value={comp.targetGroupId || ''} onChange={(e) => {
                                                comp.targetGroupId = e.target.value;
                                                setObj({ ...obj });
                                            }} />
                                        </div>
                                        <div className="e-row">
                                            <label className="e-label" style={{ fontSize: '10px' }}>Name (Optional)</label>
                                            <input type="text" className="e-input" value={comp.name || ''} onChange={(e) => {
                                                comp.name = e.target.value;
                                                setObj({ ...obj });
                                            }} />
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {selectedObjectType === 'Actor' && (
                    <>
                        <div className="e-row" style={{ borderTop: '1px solid #444', paddingTop: '5px' }}>
                            <div className="e-label" style={{ color: '#aaf', fontWeight: 'bold' }}>ACTOR PROPERTIES</div>
                        </div>

                        {/* Is Player */}
                        <div className="e-row">
                            <label className="e-label" style={{ display: 'flex', alignItems: 'center', color: '#aaf' }}>
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
                            <select
                                className="e-input"
                                value={obj.direction || 'down'}
                                onChange={(e) => {
                                    handleChange('direction', e.target.value);
                                    // Also trigger sprite update on the real object immediately
                                    if (Game.instance.editor.selectedObject && (Game.instance.editor.selectedObject as any).setDirection) {
                                        (Game.instance.editor.selectedObject as any).setDirection(e.target.value);
                                    }
                                }}
                            >
                                <option value="down">Down</option>
                                <option value="up">Up</option>
                                <option value="left">Left</option>
                            </select>
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
                            <div className="e-label" style={{ color: '#aaf', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>
                                <span>ANIMATION SETS</span>
                                <button className="e-btn" style={{ padding: '0 5px', fontSize: '10px' }} onClick={() => {
                                    if (!obj.animSets) obj.animSets = {};
                                    // Auto naming
                                    let newId = 'idle';
                                    if (obj.animSets['idle']) newId = 'walk';
                                    if (obj.animSets['walk']) newId = 'state_' + Object.keys(obj.animSets).length;

                                    // Add to local obj
                                    obj.animSets[newId] = { id: newId, up: null, down: null, left: null, right: null };

                                    // Add to real obj
                                    if (Game.instance.editor.selectedObject && (Game.instance.editor.selectedObject as any).addAnimSet) {
                                        (Game.instance.editor.selectedObject as any).addAnimSet(newId);
                                    }
                                    setObj({ ...obj });
                                }}>+ ADD</button>
                            </div>
                        </div>

                        {/* List Sets */}
                        {obj.animSets && Object.keys(obj.animSets).map((setId) => {
                            const set = obj.animSets[setId];
                            return (
                                <div key={setId} style={{ background: '#222', padding: '5px', marginBottom: '5px', borderRadius: '4px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                        <span style={{ fontWeight: 'bold', color: '#ddd' }}>{setId}</span>
                                        <button className="e-btn e-btn-red" style={{ padding: '0 5px' }} onClick={() => {
                                            if (confirm(`Delete animation set '${setId}'?`)) {
                                                delete obj.animSets[setId];
                                                if (Game.instance.editor.selectedObject && (Game.instance.editor.selectedObject as any).removeAnimSet) {
                                                    (Game.instance.editor.selectedObject as any).removeAnimSet(setId);
                                                }
                                                setObj({ ...obj });
                                            }
                                        }}>x</button>
                                    </div>

                                    {/* Directions */}
                                    {['down', 'up', 'left', 'right'].map((dir) => (
                                        <div key={dir} style={{ display: 'flex', gap: '5px', marginBottom: '2px', alignItems: 'center' }}>
                                            <div style={{ width: '30px', fontSize: '10px', color: '#888' }}>{dir.toUpperCase()}</div>
                                            <input
                                                type="text"
                                                className="e-input"
                                                style={{ flex: 1, fontSize: '10px', padding: '1px' }}
                                                value={set[dir] || ''}
                                                readOnly
                                            />
                                            <button className="e-btn" style={{ padding: '0 5px' }} onClick={() => {
                                                Game.instance.openFileBrowser('load', 'public/sprites', (f) => {
                                                    set[dir] = f;
                                                    // Sync to real object
                                                    if (Game.instance.editor.selectedObject && (Game.instance.editor.selectedObject as any).animSets) {
                                                        const realSet = (Game.instance.editor.selectedObject as any).animSets[setId];
                                                        if (realSet) realSet[dir] = f;
                                                        // If this is the current state, update sprite immediately
                                                        (Game.instance.editor.selectedObject as any).updateSpriteForState();
                                                    }
                                                    setObj({ ...obj });
                                                });
                                            }}>...</button>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </>
                )}

                {/* Entity Transforms */}
                {(selectedObjectType === 'Entity' || selectedObjectType === 'Actor' || selectedObjectType === 'Static') && (
                    <>
                        <div className="e-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                            <div>
                                <label className="e-label">X</label>
                                <input type="number" className="e-input" value={obj.x ?? 0} onChange={(e) => handleChange('x', e.target.value, true)} />
                            </div>
                            <div>
                                <label className="e-label">Y</label>
                                <input type="number" className="e-input" value={obj.y ?? 0} onChange={(e) => handleChange('y', e.target.value, true)} />
                            </div>
                            <div>
                                <label className="e-label">Width</label>
                                <input type="number" className="e-input" value={obj.width ?? 0} onChange={(e) => handleChange('width', e.target.value, true)} />
                            </div>
                            <div>
                                <label className="e-label">Height</label>
                                <input type="number" className="e-input" value={obj.height ?? 0} onChange={(e) => handleChange('height', e.target.value, true)} />
                            </div>
                        </div>

                        <div className="e-row">
                            <label className="e-label">Sprite</label>
                            <div style={{ display: 'flex', gap: '5px' }}>
                                <input type="text" className="e-input" style={{ flex: 1 }} value={obj.spriteName || ''} onChange={(e) => handleChange('spriteName', e.target.value)} />
                                <button className="e-btn" onClick={() => Game.instance.openFileBrowser('load', 'public/sprites', (f) => handleChange('spriteName', f))}>...</button>
                            </div>
                        </div>

                        <div className="e-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}>
                            <div>
                                <label className="e-label">Scale</label>
                                <input type="number" step="0.1" className="e-input" value={obj.modelScale || 1} onChange={(e) => handleChange('modelScale', e.target.value, true)} />
                            </div>
                            <div>
                                <label className="e-label">Layer</label>
                                <input type="number" className="e-input" value={obj.layer || 0} onChange={(e) => handleChange('layer', e.target.value, true)} />
                            </div>
                            <div>
                                <label className="e-label">Parallax</label>
                                <input type="number" step="0.1" className="e-input" value={obj.parallax ?? 1} onChange={(e) => handleChange('parallax', e.target.value, true)} />
                            </div>
                        </div>

                        {/* Colliders */}
                        <div className="e-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                            <div>
                                <label className="e-label">Collider W</label>
                                <input type="number" className="e-input" value={obj.colliderWidth ?? 0} onChange={(e) => handleChange('colliderWidth', e.target.value, true)} />
                            </div>
                            <div>
                                <label className="e-label">Collider H</label>
                                <input type="number" className="e-input" value={obj.colliderHeight ?? 0} onChange={(e) => handleChange('colliderHeight', e.target.value, true)} />
                            </div>
                        </div>

                        <div className="e-row">
                            <label className="e-label" style={{ display: 'flex', alignItems: 'center', color: '#ccc' }}>
                                <input type="checkbox" style={{ marginRight: '5px' }} checked={!!obj.ignoreScaling} onChange={(e) => handleChange('ignoreScaling', e.target.checked)} />
                                Disable Depth Scaling
                            </label>
                        </div>

                        <div className="e-row">
                            <label className="e-label" style={{ display: 'flex', alignItems: 'center', color: '#ccc' }}>
                                <input type="checkbox" style={{ marginRight: '5px' }} checked={!!obj.locked} onChange={(e) => handleChange('locked', e.target.checked)} />
                                Lock Object (Prevent Mouse Edit)
                            </label>
                        </div>
                        <div className="e-row">
                            <label className="e-label" style={{ display: 'flex', alignItems: 'center', color: '#faa' }}>
                                <input type="checkbox" style={{ marginRight: '5px' }} checked={!!obj.disabled} onChange={(e) => handleChange('disabled', e.target.checked)} />
                                Disabled (Hidden in Game)
                            </label>
                        </div>
                    </>
                )}

                {/* SCENE Properties */}
                {selectedObjectType === 'SCENE' && (
                    <>
                        <div className="e-row">
                            <label className="e-label">Title</label>
                            <input type="text" className="e-input" value={obj.name || ''} onChange={(e) => handleChange('name', e.target.value)} />
                        </div>

                        {/* Camera properties */}
                        {(obj.camera || obj.defaultCamera) && (
                            <div className="e-row" style={{ borderTop: '1px solid #444', paddingTop: '5px' }}>
                                <div className="e-label" style={{ color: '#aaf', fontWeight: 'bold' }}>CAMERA</div>
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
                                                    setObj({ ...obj });
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
                                                    setObj({ ...obj });
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
                                                    setObj({ ...obj });
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
                                <div className="e-row">
                                    <label className="e-label">Cam Speed</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        className="e-input"
                                        value={obj.cameraSpeed || 5}
                                        onChange={(e) => handleChange('cameraSpeed', parseFloat(e.target.value), true)}
                                    />
                                </div>
                                <>
                                    <div className="e-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                                        <div>
                                            <label className="e-label">Deadzone X</label>
                                            <input
                                                type="number"
                                                className="e-input"
                                                value={obj.camDeadzoneX !== undefined ? obj.camDeadzoneX : 50}
                                                onChange={(e) => handleChange('camDeadzoneX', parseFloat(e.target.value), true)}
                                            />
                                        </div>
                                        <div>
                                            <label className="e-label">Deadzone Y</label>
                                            <input
                                                type="number"
                                                className="e-input"
                                                value={obj.camDeadzoneY !== undefined ? obj.camDeadzoneY : 30}
                                                onChange={(e) => handleChange('camDeadzoneY', parseFloat(e.target.value), true)}
                                            />
                                        </div>
                                    </div>
                                    <div className="e-row" style={{ marginTop: '5px' }}>
                                        <div className="e-label" style={{ color: '#aaf' }}>Camera Bounds (Min/Max)</div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                                            <div>
                                                <label className="e-label">Min X</label>
                                                <input
                                                    type="number"
                                                    className="e-input"
                                                    placeholder="None"
                                                    value={obj.camMinX !== undefined ? obj.camMinX : ''}
                                                    onChange={(e) => handleChange('camMinX', e.target.value === '' ? undefined : parseFloat(e.target.value), false)}
                                                />
                                            </div>
                                            <div>
                                                <label className="e-label">Max X</label>
                                                <input
                                                    type="number"
                                                    className="e-input"
                                                    placeholder="None"
                                                    value={obj.camMaxX !== undefined ? obj.camMaxX : ''}
                                                    onChange={(e) => handleChange('camMaxX', e.target.value === '' ? undefined : parseFloat(e.target.value), false)}
                                                />
                                            </div>
                                            <div>
                                                <label className="e-label">Min Y</label>
                                                <input
                                                    type="number"
                                                    className="e-input"
                                                    placeholder="None"
                                                    value={obj.camMinY !== undefined ? obj.camMinY : ''}
                                                    onChange={(e) => handleChange('camMinY', e.target.value === '' ? undefined : parseFloat(e.target.value), false)}
                                                />
                                            </div>
                                            <div>
                                                <label className="e-label">Max Y</label>
                                                <input
                                                    type="number"
                                                    className="e-input"
                                                    placeholder="None"
                                                    value={obj.camMaxY !== undefined ? obj.camMaxY : ''}
                                                    onChange={(e) => handleChange('camMaxY', e.target.value === '' ? undefined : parseFloat(e.target.value), false)}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </>
                            </div>
                        )}

                        {/* Default Camera (Start Position) */}
                        {obj.defaultCamera && (
                            <div className="e-row" style={{ borderTop: '1px solid #444', paddingTop: '5px' }}>
                                <div className="e-label" style={{ color: '#aaf', fontWeight: 'bold' }}>DEFAULT CAMERA</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}>
                                    <div>
                                        <label className="e-label">Def X</label>
                                        <input
                                            type="number"
                                            className="e-input"
                                            value={Math.round(obj.defaultCamera.x)}
                                            onChange={(e) => {
                                                obj.defaultCamera.x = parseFloat(e.target.value);
                                                setObj({ ...obj });
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
                                                setObj({ ...obj });
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
                                                setObj({ ...obj });
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
                                                setObj({ ...obj });
                                            }
                                        }}
                                    >
                                        Set Current as Default
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Scaling Settings */}
                        {Game.instance.sceneManager.currentScene && (
                            <div className="e-row" style={{ borderTop: '1px solid #444', paddingTop: '5px' }}>
                                <div className="e-label" style={{ color: '#ffaa00', fontWeight: 'bold' }}>SCALING</div>
                                {(() => {
                                    const s = Game.instance.sceneManager.currentScene.scaling;
                                    return (
                                        <>
                                            <div className="e-row">
                                                <label className="e-label" style={{ display: 'flex', alignItems: 'center', color: '#ccc' }}>
                                                    <input
                                                        type="checkbox"
                                                        style={{ marginRight: '5px' }}
                                                        checked={s.enabled}
                                                        onChange={(e) => {
                                                            Game.instance.editor.setScalingEnabled(e.target.checked);
                                                            setObj({ ...obj });
                                                        }}
                                                    />
                                                    Enable Depth Scaling
                                                </label>
                                            </div>
                                            {s.enabled && (
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                                                    <div>
                                                        <label className="e-label">Min</label>
                                                        <input type="number" step="0.1" className="e-input" value={s.min}
                                                            onChange={(e) => { s.min = parseFloat(e.target.value); setObj({ ...obj }); }} />
                                                    </div>
                                                    <div>
                                                        <label className="e-label">Max</label>
                                                        <input type="number" step="0.1" className="e-input" value={s.max}
                                                            onChange={(e) => { s.max = parseFloat(e.target.value); setObj({ ...obj }); }} />
                                                    </div>
                                                    <div>
                                                        <label className="e-label">Horizon Y</label>
                                                        <input type="number" className="e-input" value={s.horizon}
                                                            onChange={(e) => { s.horizon = parseFloat(e.target.value); setObj({ ...obj }); }} />
                                                    </div>
                                                    <div>
                                                        <label className="e-label">Front Y</label>
                                                        <input type="number" className="e-input" value={s.front}
                                                            onChange={(e) => { s.front = parseFloat(e.target.value); setObj({ ...obj }); }} />
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
                            <label className="e-label" style={{ color: '#0f0', fontWeight: 'bold', marginBottom: '10px' }}>CRT EFFECT SETTINGS</label>
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
                                            setObj({ ...obj });
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
                                    <label className="e-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        Curvature <span>{obj.crt.curvature.toFixed(2)}</span>
                                    </label>
                                    <input type="range" className="e-input" min="0" max="0.5" step="0.01"
                                        value={obj.crt.curvature}
                                        onChange={(e) => { obj.crt.curvature = parseFloat(e.target.value); setObj({ ...obj }); }} />
                                </div>
                                <div className="e-row">
                                    <label className="e-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        Vignette <span>{obj.crt.vignette.toFixed(2)}</span>
                                    </label>
                                    <input type="range" className="e-input" min="0" max="1" step="0.05"
                                        value={obj.crt.vignette}
                                        onChange={(e) => { obj.crt.vignette = parseFloat(e.target.value); setObj({ ...obj }); }} />
                                </div>
                                <div className="e-row">
                                    <label className="e-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        Scanline Count <span>{Math.round(obj.crt.scanlineCount)}</span>
                                    </label>
                                    <input type="range" className="e-input" min="100" max="2000" step="50"
                                        value={obj.crt.scanlineCount}
                                        onChange={(e) => { obj.crt.scanlineCount = parseFloat(e.target.value); setObj({ ...obj }); }} />
                                </div>
                                <div className="e-row">
                                    <label className="e-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        Scanline Intensity <span>{obj.crt.scanlineIntensity.toFixed(2)}</span>
                                    </label>
                                    <input type="range" className="e-input" min="0" max="1" step="0.05"
                                        value={obj.crt.scanlineIntensity}
                                        onChange={(e) => { obj.crt.scanlineIntensity = parseFloat(e.target.value); setObj({ ...obj }); }} />
                                </div>
                                <div className="e-row">
                                    <label className="e-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        RGB Split <span>{obj.crt.aberration.toFixed(1)}</span>
                                    </label>
                                    <input type="range" className="e-input" min="0" max="5" step="0.1"
                                        value={obj.crt.aberration}
                                        onChange={(e) => { obj.crt.aberration = parseFloat(e.target.value); setObj({ ...obj }); }} />
                                </div>
                                <div className="e-row">
                                    <label className="e-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        Bloom <span>{obj.crt.bloom.toFixed(2)}</span>
                                    </label>
                                    <input type="range" className="e-input" min="0" max="1" step="0.05"
                                        value={obj.crt.bloom}
                                        onChange={(e) => { obj.crt.bloom = parseFloat(e.target.value); setObj({ ...obj }); }} />
                                </div>
                                <div className="e-row">
                                    <label className="e-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        Phosphor / Grain <span>{obj.crt.phosphor ? obj.crt.phosphor.toFixed(2) : '0.00'}</span>
                                    </label>
                                    <input type="range" className="e-input" min="0" max="1" step="0.05"
                                        value={obj.crt.phosphor || 0}
                                        onChange={(e) => { obj.crt.phosphor = parseFloat(e.target.value); setObj({ ...obj }); }} />
                                </div>
                                <div className="e-row">
                                    <label className="e-label" style={{ display: 'flex', alignItems: 'center' }}>
                                        <input
                                            type="checkbox"
                                            style={{ marginRight: '5px' }}
                                            checked={obj.crt.bezelGlow}
                                            onChange={(e) => { obj.crt.bezelGlow = e.target.checked; setObj({ ...obj }); }}
                                        />
                                        Bezel Glow
                                    </label>
                                </div>
                            </>
                        )}

                        <div className="e-row" style={{ marginTop: '20px', borderTop: '1px solid #333', paddingTop: '10px' }}>
                            <button
                                className="e-btn"
                                style={{ width: '100%', padding: '8px' }}
                                onClick={() => {
                                    if (Game.instance && Game.instance.saveSettings) {
                                        Game.instance.saveSettings();
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
