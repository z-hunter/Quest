import React, { useState, useEffect, useRef } from 'react';
import { Game } from '../core/Game';
import { FileBrowser } from './FileBrowser';

interface UIOverlayProps {
    game: Game | null;
}

export const UIOverlay: React.FC<UIOverlayProps> = ({ game }) => {
    const [message, setMessage] = useState<string | null>(null);
    const [fileBrowser, setFileBrowser] = useState<{ open: boolean, mode: 'save' | 'load', dir: string, onConfirm: (f: string) => void } | null>(null);

    // Ref to access current state in callbacks if needed, though we pass handlers directly

    useEffect(() => {
        if (game) {
            // Bind Game callbacks to React state
            game.onMessage = (text) => setMessage(text);

            // Expose a method for the Editor to open the FileBrowser
            // We attach it to the editor instance directly since it's the bridge
            if (game.editor) {
                game.editor.openFileBrowser = (mode: 'save' | 'load', dir: string, onConfirm: (f: string) => void) => {
                    setFileBrowser({ open: true, mode, dir, onConfirm });
                };
            }

            // Initialize UI bindings
            setTimeout(() => {
                game.bindUI();
            }, 0);
        }
    }, [game]);

    const dismissMessage = () => {
        setMessage(null);
        if (game) {
            const input = document.getElementById('parser-input');
            if (input) input.focus();
        }
    };

    const handleBrowserConfirm = (filename: string) => {
        if (fileBrowser) {
            fileBrowser.onConfirm(filename);
            setFileBrowser(null);
        }
    };

    return (
        <>
            <div id="ui-layer" style={{ pointerEvents: 'none' }}>
                <div id="command-line" style={{ border: 'none', background: 'transparent' }}>
                    <input
                        type="text"
                        id="parser-input"
                        autoComplete="off"
                        autoFocus
                        style={{
                            opacity: 0,
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            width: '1px',
                            height: '1px',
                            pointerEvents: 'none',
                            zIndex: 9999
                        }}
                    />
                </div>
            </div>

            {/* Message Box */}
            {message && (
                <div id="message-box" onClick={dismissMessage}>
                    <p id="message-text">{message}</p>
                    <div className="message-footer">Click to continue</div>
                </div>
            )}

            {/* File Browser Modal */}
            {fileBrowser && fileBrowser.open && (
                <div style={{ pointerEvents: 'auto' }}>
                    <FileBrowser
                        mode={fileBrowser.mode}
                        directory={fileBrowser.dir}
                        onConfirm={handleBrowserConfirm}
                        onCancel={() => setFileBrowser(null)}
                    />
                </div>
            )}

            {/* Editor Overlay */}
            <div id="editor-wrapper" className="hidden">
                <div className="editor-main-area">
                    {/* Left Panel: Hierarchy & Tools */}
                    <div id="hierarchy-panel">
                        <div className="editor-header">
                            <h3> OBJECTS</h3>
                        </div>

                        {/* Object Management Toolbar */}
                        <div className="editor-toolbar" style={{ padding: '5px', borderBottom: '1px solid #0f0', marginBottom: '5px' }}>

                            <div style={{ display: 'flex', gap: '5px', marginBottom: '5px' }}>
                                <select id="add-object-type" style={{ width: '70px', background: '#000', color: '#0f0', border: '1px solid #0f0' }}>
                                    <option value="Static">Static (S)</option>
                                    <option value="Actor">Actor (A)</option>
                                    <option value="Walkbox">Walkbox (W)</option>
                                    <option value="Triggerbox">Trigger (T)</option>
                                </select>
                                <button id="btn-add-object" style={{ flex: 1 }}>Add</button>
                                <button id="btn-dup-object" style={{ flex: 0.4 }}>Dup</button>
                            </div>
                            <div style={{ display: 'flex', gap: '5px' }}>
                                <button id="btn-delete-object" style={{ flex: 1 }}>Del</button>
                                <button id="btn-save-object" style={{ flex: 1 }}>Save</button>
                                <button id="btn-load-object" style={{ flex: 1 }}>Load</button>
                            </div>
                        </div>

                        <div id="scene-properties-item" className="scene-prop-item" onClick={() => game?.editor?.selectObject('SCENE')}>Scene</div>
                        <div id="entity-list"></div>
                    </div>

                    {/* Right Panel: Properties */}
                    <div id="editor-panel">
                        <div className="editor-header">
                            <h3>PROPERTIES</h3>
                            <button id="btn-close-editor">X</button>
                        </div>

                        {/* Scene Properties */}
                        <div id="section-scene-props" className="editor-section hidden">
                            <label>Filename (ID):</label>
                            <input type="text" id="editor-scene-id" style={{ width: '100%', marginBottom: '5px' }} />
                            <label>Scene Title:</label>
                            <input type="text" id="editor-scene-title" style={{ width: '100%' }} />

                            <h4 style={{ marginTop: '10px' }}>Depth Scaling</h4>
                            <label><input type="checkbox" id="scale-enabled" /> Enabled</label><br />
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                                <label>Min: <input type="number" id="scale-min" step="0.1" style={{ width: '40px' }} /></label>
                                <label>Max: <input type="number" id="scale-max" step="0.1" style={{ width: '40px' }} /></label>
                                <label>Horiz: <input type="number" id="scale-horizon" style={{ width: '40px' }} /></label>
                                <label>Front: <input type="number" id="scale-front" style={{ width: '40px' }} /></label>
                            </div>

                            <h4 style={{ marginTop: '10px' }}>Camera</h4>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                                <label style={{ gridColumn: '1 / -1' }}>Current LookAt:</label>
                                <label>X: <input type="number" id="cam-x" style={{ width: '50px' }} /></label>
                                <label>Y: <input type="number" id="cam-y" style={{ width: '50px' }} /></label>
                                <label style={{ gridColumn: '1 / -1' }}>Zoom: <input type="number" id="cam-zoom" step="0.1" style={{ width: '50px' }} /></label>
                                <label style={{ gridColumn: '1 / -1' }}><input type="checkbox" id="cam-auto-center" /> Auto-Center on Player</label>

                                <label style={{ gridColumn: '1 / -1', marginTop: '5px' }}>Default (Start):</label>
                                <label>X: <input type="number" id="def-cam-x" style={{ width: '50px' }} /></label>
                                <label>Y: <input type="number" id="def-cam-y" style={{ width: '50px' }} /></label>
                                <label>Zoom: <input type="number" id="def-cam-zoom" step="0.1" style={{ width: '50px' }} /></label>
                                <button id="btn-camera-reset">Reset to Default</button>
                            </div>
                        </div>

                        {/* Entity Properties */}
                        <div id="section-entity-props" className="editor-section hidden">
                            <h5 id="selected-entity-name">Object</h5>

                            <label>Name:</label>
                            <input type="text" id="prop-name" style={{ width: '100%' }} />

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px', marginTop: '5px' }}>
                                <label>X: <input type="number" id="prop-x" style={{ width: '50px' }} /></label>
                                <label>Y: <input type="number" id="prop-y" style={{ width: '50px' }} /></label>
                                <label>W: <input type="number" id="prop-width" style={{ width: '50px' }} /></label>
                                <label>H: <input type="number" id="prop-height" style={{ width: '50px' }} /></label>
                            </div>

                            <label style={{ marginTop: '5px', display: 'block' }}>Sprite:</label>
                            <div style={{ display: 'flex', gap: '5px' }}>
                                <input type="text" id="prop-image" style={{ flex: 1 }} />
                                <button id="btn-prop-sprite">...</button>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px', marginTop: '5px' }}>
                                <label>Scale: <input type="number" id="prop-scale" step="0.1" style={{ width: '50px' }} /></label>
                                <label>Layer: <input type="number" id="prop-layer" style={{ width: '50px' }} /></label>
                                <label>Parallax: <input type="number" id="prop-parallax" step="0.1" style={{ width: '50px' }} /></label>
                            </div>

                            <div id="prop-actor-group" className="hidden mt-2 border-t border-gray-600 pt-2">
                                <div className="mb-2">
                                    <label className="block text-gray-400 text-xs mb-1">State</label>
                                    <select id="prop-actor-state" className="w-full bg-gray-700 text-white px-2 py-1 text-sm rounded border border-gray-600">
                                        <option value="idle">Idle</option>
                                        <option value="walk">Walk</option>
                                        <option value="talk">Talk</option>
                                        <option value="interact">Interact</option>
                                    </select>
                                </div>
                                <div className="mb-2">
                                    <label className="block text-gray-400 text-xs mb-1">Speed</label>
                                    <input type="number" id="prop-actor-speed" step="0.01" min="0.01" max="2.0" className="w-full bg-gray-700 text-white px-2 py-1 text-sm rounded border border-gray-600" />
                                </div>
                                <div className="mb-2 flex items-center">
                                    <input type="checkbox" id="prop-actor-isplayer" className="mr-2" />
                                    <label htmlFor="prop-actor-isplayer" className="text-gray-300 text-sm">Is Player</label>
                                </div>
                            </div>
                            <label><input type="checkbox" id="prop-no-scaling" /> Disable Depth-Scaling</label>
                        </div>

                        {/* Walkbox Properties */}
                        <div id="section-walkbox-props" className="editor-section hidden">
                            <h5>Walkbox / Trigger</h5>
                            <label>Name:</label>
                            <input type="text" id="prop-walkbox-name" style={{ width: '100%', marginBottom: '5px' }} />
                            <button id="btn-clear-walkbox" style={{ width: '100%' }}>Redraw</button>
                            {/* Draw Mode is auto-handled now, hiding checkbox but keeping element for logic refs */}
                            <label style={{ display: 'none' }}><input type="checkbox" id="chk-draw-mode" /> Draw Mode</label>
                        </div>

                        {/* F9 Settings Panel */}
                        <div id="section-settings" className="editor-section hidden">
                            <h3>GLOBAL SETTINGS</h3>
                            <h4>CRT Effects</h4>
                            <div className="inspector-content" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>

                                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center' }}>
                                    <input type="checkbox" id="crt-enabled" defaultChecked />
                                    <label htmlFor="crt-enabled" style={{ marginLeft: '5px' }}>Enable CRT Filter</label>
                                </div>

                                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center' }}>
                                    <input type="checkbox" id="crt-glow" defaultChecked />
                                    <label htmlFor="crt-glow" style={{ marginLeft: '5px' }}>Bezel Glow (High Quality)</label>
                                </div>

                                <label style={{ gridColumn: '1 / -1' }}>Curvature:</label>
                                <input type="range" id="crt-curvature" min="0" max="1" step="0.05" style={{ gridColumn: '1 / -1', width: '100%' }} />

                                <label style={{ gridColumn: '1 / -1' }}>Scanlines (Count):</label>
                                <input type="range" id="crt-scanlines" min="100" max="600" step="10" style={{ gridColumn: '1 / -1', width: '100%' }} />

                                <label style={{ gridColumn: '1 / -1' }}>Scanlines (Intensity):</label>
                                <input type="range" id="crt-intensity" min="0" max="1" step="0.05" style={{ gridColumn: '1 / -1', width: '100%' }} />

                                <label style={{ gridColumn: '1 / -1' }}>Aberration:</label>
                                <input type="range" id="crt-aberration" min="0" max="5" step="0.1" style={{ gridColumn: '1 / -1', width: '100%' }} />

                                <label style={{ gridColumn: '1 / -1' }}>Vignette:</label>
                                <input type="range" id="crt-vignette" min="0" max="1" step="0.05" style={{ gridColumn: '1 / -1', width: '100%' }} />

                                <label style={{ gridColumn: '1 / -1' }}>Phosphor/Surface Grain:</label>
                                <input type="range" id="crt-phosphor" min="0" max="1" step="0.05" style={{ gridColumn: '1 / -1', width: '100%' }} />

                                <label style={{ gridColumn: '1 / -1' }}>Bloom / Halation:</label>
                                <input type="range" id="crt-bloom" min="0" max="1" step="0.05" style={{ gridColumn: '1 / -1', width: '100%' }} />

                                <button id="btn-save-settings" style={{ gridColumn: '1 / -1', marginTop: '10px' }}>Save Settings (LocalStorage)</button>
                            </div>
                        </div>
                    </div>
                </div >

                {/* Bottom Bar: F-Keys */}
                < div id="editor-bottom-bar" >
                    <button className="f-key-btn" onClick={() => game?.editor?.toggle()}><span className="f-num">F1</span>Game</button>
                    <button className="f-key-btn" id="btn-f2-save"><span className="f-num">F2</span>Save</button>
                    <button className="f-key-btn" id="btn-f3-load"><span className="f-num">F3</span>Load</button>
                    <button className="f-key-btn" id="btn-f4-new"><span className="f-num">F4</span>New</button>
                    <button className="f-key-btn" id="btn-f5-sprite"><span className="f-num">F5</span>Sprite</button>
                    <button className="f-key-btn" id="btn-f9-settings"><span className="f-num">F9</span>Settings</button>
                </div >
            </div >
        </>
    );
};
