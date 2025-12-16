import React, { useEffect, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { Game } from '../../core/Game';

export const PropertiesPanel: React.FC = () => {
    const { selectedObjectId, selectedObjectType, hierarchyVersion, incrementHierarchyVersion, objectVersion, incrementObjectVersion } = useEditorStore();
    const [obj, setObj] = useState<any>(null);

    // Refresh local object reference when selection or hierarchy changes
    useEffect(() => {
        const editor = Game.instance?.editor;
        if (!editor) return;

        if (editor.selectedObject === 'SETTINGS') {
            // Special case: Bind to Global Settings
            setObj(Game.instance.settings);
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
            <div id="editor-panel" className="bg-gray-900 border-l border-gray-700 h-full p-2 text-sm text-gray-400">
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
            if (obj.setSprite) obj.setSprite(value);
        }
    };

    return (

        <div id="editor-panel" className="editor-sidebar right">
            <div className="editor-header">
                <span>{selectedObjectType === 'SETTINGS' ? 'SETTINGS' : 'PROPERTIES'}</span>
                <button className="e-btn" onClick={() => (useEditorStore.getState().toggle(false))}>X</button>
            </div>

            <div className="editor-content">
                {selectedObjectType !== 'SETTINGS' && (
                    <>
                        <div className="e-row">
                            <label className="e-label">Type</label>
                            <div style={{ color: '#fff', fontFamily: 'monospace' }}>{selectedObjectType}</div>
                        </div>

                        {/* Common: Name -> ID */}
                        <div className="e-row">
                            <label className="e-label">ID</label>
                            <input
                                type="text"
                                className="e-input"
                                value={obj.name || ''}
                                onChange={(e) => handleChange('name', e.target.value)}
                            />
                        </div>
                    </>
                )}

                {/* Walkbox/Triggerbox Properties */}
                {(selectedObjectType === 'Walkbox' || selectedObjectType === 'Triggerbox') && (
                    <div className="e-row">
                        <button
                            className="e-btn e-btn-yellow"
                            style={{ width: '100%', marginBottom: '5px' }}
                            onClick={() => {
                                if (confirm("Redraw polygon? Current points will be cleared.")) {
                                    if (obj.points) obj.points = [];
                                    Game.instance.editor.startCreating(selectedObjectType as any);
                                    Game.instance.editor.redrawSelected();
                                }
                            }}
                        >
                            Redraw Polygon
                        </button>
                        <div className="e-label">
                            To edit, drag vertices on screen. Hold Shift for 18° snap.
                        </div>
                    </div>
                )}

                {/* Actor Specific Properties (States) */}
                {selectedObjectType === 'Actor' && (
                    <div className="e-row" style={{ borderTop: '1px solid #444', paddingTop: '5px' }}>
                        <div className="e-label" style={{ color: '#aaf', fontWeight: 'bold' }}>ANIMATION STATES</div>
                        <div className="e-label" style={{ marginBottom: '5px' }}>
                            States: {obj.animator?.animations ? Object.keys(obj.animator.animations).join(', ') : 'None'}
                        </div>
                        <button className="e-btn" style={{ width: '100%' }} onClick={() => alert("Detailed State Editor coming soon.")}>
                            + Manage States
                        </button>
                    </div>
                )}

                {/* Entity Transforms */}
                {(selectedObjectType === 'Entity' || selectedObjectType === 'Actor' || selectedObjectType === 'Static') && (
                    <>
                        <div className="e-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                            <div>
                                <label className="e-label">X</label>
                                <input type="number" className="e-input" value={obj.x} onChange={(e) => handleChange('x', e.target.value, true)} />
                            </div>
                            <div>
                                <label className="e-label">Y</label>
                                <input type="number" className="e-input" value={obj.y} onChange={(e) => handleChange('y', e.target.value, true)} />
                            </div>
                            <div>
                                <label className="e-label">Width</label>
                                <input type="number" className="e-input" value={obj.width} onChange={(e) => handleChange('width', e.target.value, true)} />
                            </div>
                            <div>
                                <label className="e-label">Height</label>
                                <input type="number" className="e-input" value={obj.height} onChange={(e) => handleChange('height', e.target.value, true)} />
                            </div>
                        </div>

                        <div className="e-row">
                            <label className="e-label">Sprite</label>
                            <div style={{ display: 'flex', gap: '5px' }}>
                                <input type="text" className="e-input" style={{ flex: 1 }} value={obj.spriteName || ''} onChange={(e) => handleChange('spriteName', e.target.value)} />
                                <button className="e-btn" onClick={() => Game.instance.editor.openFileBrowser?.('load', 'assets', (f) => handleChange('spriteName', f))}>...</button>
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

                        <div className="e-row">
                            <label className="e-label" style={{ display: 'flex', alignItems: 'center', color: '#ccc' }}>
                                <input type="checkbox" style={{ marginRight: '5px' }} checked={!!obj.ignoreScaling} onChange={(e) => handleChange('ignoreScaling', e.target.checked)} />
                                Disable Depth Scaling
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
