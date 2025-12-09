import React, { useState, useEffect } from 'react';
import { Game } from '../core/Game';

interface UIOverlayProps {
    game: Game | null;
}

export const UIOverlay: React.FC<UIOverlayProps> = ({ game }) => {
    const [sceneTitle, setSceneTitle] = useState('Title');
    const [score] = useState(0);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        if (game) {
            // Bind Game callbacks to React state
            game.onSceneChange = (title) => setSceneTitle(title);
            game.onMessage = (text) => setMessage(text);

            // Initialize UI bindings
            setTimeout(() => {
                game.bindUI();
            }, 0);

            // Initial sync
            if (game.sceneManager.currentScene) {
                setSceneTitle(game.sceneManager.currentScene.name);
            }
        }
    }, [game]);

    const dismissMessage = () => {
        setMessage(null);
        if (game) {
            // game.dismissMessage(); // If we had this method exposed or needed logic
            // Refocus input
            const input = document.getElementById('parser-input');
            if (input) input.focus();
        }
    };

    return (
        <>
            <div id="ui-layer">
                <div id="status-bar">
                    <span id="score-display">Score: {score} of 100</span>
                    <span id="scene-title-display">{sceneTitle}</span>
                </div>

                <div id="command-line">
                    <span className="prompt">&gt;</span>
                    {/* 
                        We keep the ID 'parser-input' because Parser.ts looks for it.
                        In a full refactor, we would bind this to React state and call game.parser.parse() 
                    */}
                    <input type="text" id="parser-input" autoComplete="off" autoFocus />
                </div>
            </div>

            {/* Message Box */}
            {message && (
                <div id="message-box" onClick={dismissMessage}>
                    <p id="message-text">{message}</p>
                    <div className="message-footer">Click to continue</div>
                </div>
            )}

            {/* 
                Editor Overlay 
                Wraps the entire editor interface. Controlled by SceneEditor visibility.
            */}
            <div id="editor-wrapper" className="hidden">
                <div className="editor-main-area">
                    {/* Left Panel: Hierarchy */}
                    <div id="hierarchy-panel">
                        <div className="editor-header">
                            <h3>SCENE</h3>
                        </div>
                        <div id="scene-properties-item" className="scene-prop-item">Scene Properties</div>
                        <div id="entity-list"></div>
                    </div>

                    {/* Right Panel: Properties */}
                    <div id="editor-panel">
                        <div className="editor-header">
                            <h3>PROPERTIES</h3>
                            <button id="btn-close-editor">X</button>
                        </div>

                        {/* Properties Form (Reusing IDs for SceneEditor binding) */}
                        <div id="section-scene-props" className="editor-section">
                            <label>Scene Title:</label>
                            <input type="text" id="editor-scene-title" />

                            <h4 style={{ marginTop: '10px' }}>Scaling</h4>
                            <label><input type="checkbox" id="scale-enabled" /> Enabled</label><br />
                            <label>Min: <input type="number" id="scale-min" step="0.1" style={{ width: '50px' }} /></label>
                            <label>Max: <input type="number" id="scale-max" step="0.1" style={{ width: '50px' }} /></label><br />
                            <label>Horizon Y: <input type="number" id="scale-horizon" style={{ width: '50px' }} /></label>
                            <label>Front Y: <input type="number" id="scale-front" style={{ width: '50px' }} /></label>
                        </div>

                        <div id="section-tools" className="editor-section">
                            <h4>Tools</h4>
                            <div className="tool-group">
                                <h5>Walkbox</h5>
                                <label><input type="checkbox" id="chk-draw-mode" /> Draw Mode</label>
                                <button id="btn-clear-walkbox">Clear</button>
                            </div>
                            <div className="tool-group" style={{ marginTop: '10px' }}>
                                <h5>Add Entity</h5>
                                <input type="text" id="sprite-name-input" placeholder="Name" style={{ width: '100px' }} />
                                <button id="btn-add-sprite">Add</button>
                            </div>
                        </div>

                        {/* Entity Properties (Hidden by default, shown when Entity selected) */}
                        <div id="section-entity-props" className="editor-section hidden">
                            <h5>Selected Object</h5>
                            <label>Img: <input type="text" id="prop-image" style={{ width: '100px', marginBottom: '5px' }} /></label><br />
                            <label>X: <input type="number" id="prop-x" style={{ width: '50px' }} /></label>
                            <label>Y: <input type="number" id="prop-y" style={{ width: '50px' }} /></label><br />
                            <label>Scale: <input type="number" id="prop-scale" step="0.1" style={{ width: '50px' }} /></label>
                            <label>Layer: <input type="number" id="prop-layer" style={{ width: '50px' }} /></label>
                        </div>

                        <div className="editor-section">
                            <h4>File</h4>
                            <button id="btn-save-json">Save JSON</button>
                            <label className="file-upload">
                                Load JSON
                                <input type="file" id="file-load-json" accept=".json" />
                            </label>
                        </div>
                    </div>
                </div>

                {/* Bottom Bar: F-Keys */}
                <div id="editor-bottom-bar">
                    <button className="f-key-btn" onClick={() => game?.editor?.toggle()}><span className="f-num">F1</span>Game</button>
                    <button className="f-key-btn" id="btn-f2-save"><span className="f-num">F2</span>Save</button>
                    <button className="f-key-btn" id="btn-f3-load"><span className="f-num">F3</span>Load</button>
                    <button className="f-key-btn" id="btn-f4-new"><span className="f-num">F4</span>New</button>
                    <button className="f-key-btn" id="btn-f5-sprite"><span className="f-num">F5</span>Sprite</button>
                    <button className="f-key-btn" id="btn-f9-settings"><span className="f-num">F9</span>Settings</button>
                </div>
            </div>
        </>
    );
};
