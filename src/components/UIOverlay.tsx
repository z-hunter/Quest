import React, { useState, useEffect } from 'react';
import { Game } from '../core/Game';
import { FileBrowser } from './FileBrowser';
import { useEditorStore } from '../store/editorStore';

import { SpriteEditorPanel } from './tools/SpriteEditorPanel';

interface UIOverlayProps {
    game: Game | null;
}

export const UIOverlay: React.FC<UIOverlayProps> = ({ game }) => {
    const [message, setMessage] = useState<string | null>(null);
    const [fileBrowser, setFileBrowser] = useState<{ open: boolean, mode: 'save' | 'load', dir: string, onConfirm: (f: string) => void, extension?: string, title?: string } | null>(null);

    // Editor Store State
    const { enabled: editorEnabled, spriteEditorEnabled } = useEditorStore();

    useEffect(() => {
        if (game) {
            // Bind Game callbacks to React state
            game.onMessage = (text) => setMessage(text);

            // Bind File Browser Request
            game.onRequestFileBrowser = (mode, dir, onConfirm, extension, title) => {
                setFileBrowser({ open: true, mode, dir, onConfirm, extension, title });
            };

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
                        autoFocus={!editorEnabled}
                        disabled={editorEnabled}
                        onKeyDown={(e) => {
                            console.log(`[UIOverlay] Input Key: ${e.key}`);
                            // Layer 2: React Event Fallback (fires if Global Capture misses or bubbles up)

                            // F1: Toggle Scene Editor
                            if (e.key === 'F1') {
                                e.preventDefault();
                                game?.editor.toggle();
                                return;
                            }

                            // F5: Toggle Sprite Editor
                            if (e.key === 'F5') {
                                e.preventDefault();
                                game?.spriteEditor.toggle();
                                return;
                            }

                            // Enter: Parse Command
                            if (e.key === 'Enter') {
                                const val = e.currentTarget.value.trim().toUpperCase();
                                if (val && game) {
                                    game.parser.parse(val);
                                    e.currentTarget.value = '';
                                }
                            }
                        }}
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
                <div style={{ pointerEvents: 'auto', zIndex: 5000, position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
                    <FileBrowser
                        mode={fileBrowser.mode}
                        directory={fileBrowser.dir}
                        onConfirm={handleBrowserConfirm}
                        onCancel={() => setFileBrowser(null)}
                        extension={fileBrowser.extension}
                        title={fileBrowser.title}
                    />
                </div>
            )}

            {/* NEW REACT EDITOR UI */}
            {/* Sprite Editor is now part of App layout */}

            {editorEnabled && (
                <div className="editor-overlay">
                    {/* Panels are now in App.tsx */}
                </div>
            )}
        </>
    );
};
