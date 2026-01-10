import React, { useEffect, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { Game } from '../../core/Game';
import { Select } from '../../components/common/Select';

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
            // Clone object for local UI state
            // NOTE: Spread {...obj} does NOT copy class getters (like Entity.width/height)
            // So we must manually ensure they are copied over for the UI to see them.
            const source = editor.selectedObject as any;
            const clone = { ...source };

            if (clone.width === undefined && source.width !== undefined) clone.width = source.width;
            if (clone.height === undefined && source.height !== undefined) clone.height = source.height;

            setObj(clone);
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


                        {selectedObjectType === 'Triggerbox' && (
                            <div className="e-row">
                                <label className="e-label">Layer</label>
                                <input type="number" className="e-input" value={obj.layer || 0} onChange={(e) => handleChange('layer', e.target.value, true)} />
                            </div>
                        )}

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
                {(selectedObjectType === 'Triggerbox' || selectedObjectType === 'Entity' || selectedObjectType === 'Actor' || selectedObjectType === 'Static') && (
                    <div className="e-row" style={{ borderTop: '1px solid #444', paddingTop: '5px', marginTop: '5px' }}>
                        <div className="e-label" style={{ color: '#faa', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>COMPONENTS</span>
                            <div>
                                <Select
                                    options={[
                                        { value: 'Item', label: 'Item (Pickup)' },
                                        { value: 'Subscene', label: 'Subscene' },
                                        { value: 'Subtrigger', label: 'Subtrigger' },
                                        { value: 'Switch', label: 'Switch' },
                                    ]}
                                    placeholder="+ Add Component"
                                    onChange={(value) => {
                                        const type = value;
                                        if (!type) return;
                                        if (!obj.components) obj.components = [];

                                        if (type === 'Subscene') {
                                            obj.components.push({ type: 'Subscene', targetGroupId: '', name: '' });
                                        } else if (type === 'Subtrigger') {
                                            obj.components.push({ type: 'Subtrigger', target: '' });
                                        } else if (type === 'Item') {
                                            obj.components.push({ type: 'Item' });
                                        } else if (type === 'Switch') {
                                            obj.components.push({
                                                type: 'Switch',
                                                groupId1: '', groupId2: '',
                                                state: 1,
                                                idKey: '',
                                                sound1: '', sound2: ''
                                            });
                                        }

                                        if (Game.instance.editor.selectedObject) {
                                            (Game.instance.editor.selectedObject as any).components = obj.components;
                                        }
                                        setObj({ ...obj });
                                        // No need to reset value as Select component handles it or we pass empty value
                                    }}
                                    style={{ width: '100px', fontSize: '10px' }}
                                    value=""
                                />
                            </div>
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

                                {comp.type === 'Item' && (
                                    <>
                                        <div style={{ fontSize: '10px', color: '#ccc', fontStyle: 'italic', marginBottom: '4px' }}>
                                            Can be picked up by player.
                                        </div>
                                        <div className="e-row">
                                            <label className="e-label" style={{ display: 'flex', alignItems: 'center', color: '#aaf', fontSize: '10px' }}>
                                                <input
                                                    type="checkbox"
                                                    style={{ marginRight: '5px' }}
                                                    checked={!!comp.ignoreDistance}
                                                    onChange={(e) => {
                                                        comp.ignoreDistance = e.target.checked;
                                                        setObj({ ...obj });
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

                                {comp.type === 'Subtrigger' && (
                                    <>
                                        <div className="e-row">
                                            <div style={{ fontSize: '10px', color: '#ccc', fontStyle: 'italic', marginBottom: '4px' }}>
                                                Delegates click to another Triggerbox.
                                            </div>
                                            <label className="e-label" style={{ fontSize: '10px' }}>Target Trigger (Name/ID)</label>
                                            <input type="text" className="e-input" value={comp.target || ''} onChange={(e) => {
                                                comp.target = e.target.value;
                                                setObj({ ...obj });
                                            }} />
                                        </div>
                                    </>
                                )}

                                {comp.type === 'Switch' && (
                                    <>
                                        <div className="e-row" style={{ display: 'flex', gap: '2px' }}>
                                            <div style={{ flex: 1 }}>
                                                <label className="e-label" style={{ fontSize: '9px' }}>Group 1</label>
                                                <input type="text" className="e-input" style={{ width: '100%' }} value={comp.groupId1 || ''} onChange={(e) => { comp.groupId1 = e.target.value; setObj({ ...obj }); }} />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <label className="e-label" style={{ fontSize: '9px' }}>Group 2</label>
                                                <input type="text" className="e-input" style={{ width: '100%' }} value={comp.groupId2 || ''} onChange={(e) => { comp.groupId2 = e.target.value; setObj({ ...obj }); }} />
                                            </div>
                                        </div>

                                        <div className="e-row" style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                                <label className="e-label" style={{ fontSize: '10px', marginRight: '5px' }}>State:</label>
                                                <Select
                                                    value={String(comp.state)}
                                                    onChange={(value) => { comp.state = parseInt(value); setObj({ ...obj }); }}
                                                    options={[
                                                        { value: '1', label: '1' },
                                                        { value: '2', label: '2' },
                                                    ]}
                                                    style={{ width: '40px' }}
                                                />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <label className="e-label" style={{ fontSize: '9px' }}>Key Item ID</label>
                                                <input type="text" className="e-input" style={{ width: '100%' }} value={comp.idKey || ''} onChange={(e) => { comp.idKey = e.target.value; setObj({ ...obj }); }} />
                                            </div>
                                        </div>

                                        <div className="e-row" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                            <div style={{ flex: 1 }}>
                                                <label className="e-label" style={{ fontSize: '9px' }}>Sound 1</label>
                                                <div style={{ display: 'flex' }}>
                                                    <input type="text" className="e-input" style={{ width: '100%' }} value={comp.sound1 || ''} onChange={(e) => { comp.sound1 = e.target.value; setObj({ ...obj }); }} />
                                                    <button className="e-btn" style={{ fontSize: '10px', padding: '0 4px', marginLeft: '2px' }} onClick={() => {
                                                        const game = Game.instance;
                                                        if (game) {
                                                            game.openFileBrowser('load', 'public/sounds', (file) => {
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
                                                                if (val.startsWith('public/sounds/')) val = val.replace('public/sounds/', '');
                                                                if (val.startsWith('/sounds/')) val = val.replace('/sounds/', '');

                                                                comp.sound1 = val;
                                                                setObj({ ...obj });
                                                            }, '.mp3,.wav'); // Pass multiple extensions if supported?
                                                        }
                                                    }}>...</button>
                                                </div>
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <label className="e-label" style={{ fontSize: '9px' }}>Sound 2</label>
                                                <div style={{ display: 'flex' }}>
                                                    <input type="text" className="e-input" style={{ width: '100%' }} value={comp.sound2 || ''} onChange={(e) => { comp.sound2 = e.target.value; setObj({ ...obj }); }} />
                                                    <button className="e-btn" style={{ fontSize: '10px', padding: '0 4px', marginLeft: '2px' }} onClick={() => {
                                                        const game = Game.instance;
                                                        if (game) {
                                                            game.openFileBrowser('load', 'public/sounds', (file) => {
                                                                let val = file;
                                                                if (val.startsWith('public/sounds/')) val = val.replace('public/sounds/', '');
                                                                if (val.startsWith('/sounds/')) val = val.replace('/sounds/', '');
                                                                comp.sound2 = val;
                                                                setObj({ ...obj });
                                                            }, '.mp3,.wav');
                                                        }
                                                    }}>...</button>
                                                </div>
                                            </div>
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
                            <Select
                                value={obj.direction || 'down'}
                                onChange={(value) => {
                                    handleChange('direction', value);
                                    if (Game.instance.editor.selectedObject && (Game.instance.editor.selectedObject as any).setDirection) {
                                        (Game.instance.editor.selectedObject as any).setDirection(value);
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
                        <div className="e-row">
                            <label className="e-label">Display Name</label>
                            <input type="text" className="e-input" placeholder="e.g. Pillar (for Parser)" value={obj.customName || ''} onChange={(e) => handleChange('customName', e.target.value)} />
                        </div>

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

                        {/* Interactions */}
                        <div className="e-row" style={{ marginTop: '10px', borderTop: '1px solid #444', paddingTop: '5px' }}>
                            <div className="e-label" style={{ color: '#aaf', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>
                                <span>SCRIPT EVENTS</span>
                                <Select
                                    value=""
                                    placeholder="+ ADD"
                                    onChange={(value) => {
                                        const verb = value;
                                        if (!verb) return;
                                        if (!obj.interactions) obj.interactions = {};
                                        if (!obj.interactions[verb]) {
                                            obj.interactions[verb] = '';
                                            // Sync to real object
                                            if (Game.instance.editor.selectedObject) {
                                                if (!(Game.instance.editor.selectedObject as any).interactions) (Game.instance.editor.selectedObject as any).interactions = {};
                                                (Game.instance.editor.selectedObject as any).interactions[verb] = '';
                                            }
                                            setObj({ ...obj });
                                        }
                                    }}
                                    options={[
                                        { value: 'look', label: 'Look' },
                                        { value: 'use', label: 'Use' },
                                        { value: 'talk', label: 'Talk' },
                                        { value: 'pickup', label: 'Pickup' },
                                    ]}
                                    style={{ width: '80px', fontSize: '10px' }}
                                />
                            </div>

                            {obj.interactions && Object.keys(obj.interactions).map(verb => (
                                <div key={verb} style={{ display: 'flex', alignItems: 'center', marginTop: '2px' }}>
                                    <div style={{ width: '40px', fontSize: '10px', color: '#ccc' }}>{verb.toUpperCase()}</div>
                                    <input
                                        type="text"
                                        className="e-input"
                                        style={{ flex: 1, fontSize: '10px' }}
                                        placeholder="Script ID"
                                        value={obj.interactions[verb]}
                                        onChange={(e) => {
                                            obj.interactions[verb] = e.target.value;
                                            // Sync to real object
                                            if (Game.instance.editor.selectedObject) {
                                                (Game.instance.editor.selectedObject as any).interactions[verb] = e.target.value;
                                            }
                                            setObj({ ...obj });
                                        }}
                                    />
                                    <button
                                        className="e-btn e-btn-red"
                                        style={{ marginLeft: '2px', padding: '0 4px', fontSize: '10px' }}
                                        onClick={() => {
                                            delete obj.interactions[verb];
                                            // Sync to real object
                                            if (Game.instance.editor.selectedObject) {
                                                delete (Game.instance.editor.selectedObject as any).interactions[verb];
                                            }
                                            setObj({ ...obj });
                                        }}
                                    >x</button>
                                </div>
                            ))}
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
                                <div className="e-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}>
                                    <div>
                                        <label className="e-label">Cam Spd</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            className="e-input"
                                            value={obj.cameraSpeed || 5}
                                            onChange={(e) => handleChange('cameraSpeed', parseFloat(e.target.value), true)}
                                        />
                                    </div>
                                    <div>
                                        <label className="e-label">Dead X</label>
                                        <input
                                            type="number"
                                            className="e-input"
                                            value={obj.camDeadzoneX !== undefined ? obj.camDeadzoneX : 50}
                                            onChange={(e) => handleChange('camDeadzoneX', parseFloat(e.target.value), true)}
                                        />
                                    </div>
                                    <div>
                                        <label className="e-label">Dead Y</label>
                                        <input
                                            type="number"
                                            className="e-input"
                                            value={obj.camDeadzoneY !== undefined ? obj.camDeadzoneY : 30}
                                            onChange={(e) => handleChange('camDeadzoneY', parseFloat(e.target.value), true)}
                                        />
                                    </div>
                                </div>
                                <>
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
                            <label className="e-label" style={{ color: '#79EFA4', fontWeight: 'bold', marginBottom: '10px' }}>CRT EFFECT SETTINGS</label>
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
