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
                Legacy Editor Panels 
                These need to exist for SceneEditor.ts to find them.
                We hide them by default (CSS will handle .hidden).
            */}
            <div id="hierarchy-panel">
                <div className="editor-header">
                    <h3>SCENE HIERARCHY</h3>
                </div>
                <div id="entity-list"></div>
            </div>

            <div id="editor-panel">
                <div className="editor-header">
                    <h3>DEV MODE (F1)</h3>
                    <button id="btn-close-editor">X</button>
                </div>

                <div className="editor-section">
                    <label>Scene Title:</label>
                    <input type="text" id="editor-scene-title" />
                </div>

                <div className="editor-section">
                    <h4>Scaling</h4>
                    <label><input type="checkbox" id="scale-enabled" /> Enabled</label><br />
                    <label>Min: <input type="number" id="scale-min" step="0.1" style={{ width: '50px' }} /></label>
                    <label>Max: <input type="number" id="scale-max" step="0.1" style={{ width: '50px' }} /></label><br />
                    <label>Horizon Y: <input type="number" id="scale-horizon" style={{ width: '50px' }} /></label>
                    <label>Front Y: <input type="number" id="scale-front" style={{ width: '50px' }} /></label>
                </div>

                <div className="editor-section">
                    <h4>Walkbox</h4>
                    <label><input type="checkbox" id="chk-draw-mode" /> Draw Mode</label>
                    <button id="btn-clear-walkbox">Clear Walkbox</button>
                    <div className="help-text">Check to draw. Enter to finish.</div>
                </div>

                <div className="editor-section">
                    <h4>Sprites</h4>
                    <input type="text" id="sprite-name-input" placeholder="image.png" />
                    <button id="btn-add-sprite">Add Sprite</button>

                    <div id="sprite-properties" className="hidden" style={{ marginTop: '10px', borderTop: '1px dashed #555', paddingTop: '5px' }}>
                        <h5>Selected Sprite</h5>
                        <label>Img: <input type="text" id="prop-image" style={{ width: '100px', marginBottom: '5px' }} /></label><br />
                        <label>X: <input type="number" id="prop-x" style={{ width: '50px' }} /></label>
                        <label>Y: <input type="number" id="prop-y" style={{ width: '50px' }} /></label><br />
                        <label>Scale: <input type="number" id="prop-scale" step="0.1" style={{ width: '50px' }} /></label>
                        <label>Layer: <input type="number" id="prop-layer" style={{ width: '50px' }} /></label>
                    </div>
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
        </>
    );
};
