import React, { useEffect, useState } from 'react';
import { Game } from '../../core/Game';
import { useEditorStore } from '../../store/editorStore';

export const SpritePropertiesPanel: React.FC = () => {
    const { spriteVersion, incrementSpriteVersion, toggleSpriteEditor } = useEditorStore();
    const spriteEditor = Game.instance.spriteEditor;

    // Force re-render when spriteVersion changes
    const [, setTick] = useState(0);
    useEffect(() => {
        setTick(v => v + 1);
    }, [spriteVersion]);

    const handlePropChange = (field: string, value: any) => {
        (spriteEditor.sprite as any)[field] = value;
        spriteEditor.updatePreview();
        incrementSpriteVersion();
    };

    const handleEditorChange = (field: string, value: any) => {
        (spriteEditor as any)[field] = value;
        spriteEditor.updatePreview();
        incrementSpriteVersion();
    };

    return (
        <div id="editor-panel" className="editor-sidebar right">
            <div className="editor-header">
                <span>SPRITE PROPERTIES</span>
                <button className="e-btn" onClick={() => toggleSpriteEditor(false)}>X</button>
            </div>

            <div className="editor-content">
                <div className="e-row">
                    <label className="e-label">Sprite ID/File</label>
                    <input
                        className="e-input"
                        value={spriteEditor.sprite.id}
                        onChange={(e) => handlePropChange('id', e.target.value)}
                    />
                </div>

                <div className="e-row">
                    <label className="e-label">Image File</label>
                    <div style={{ display: 'flex', gap: '5px' }}>
                        <input
                            type="text"
                            className="e-input"
                            style={{ flex: 1 }}
                            value={spriteEditor.sprite.imageFile}
                            onChange={(e) => handlePropChange('imageFile', e.target.value)}
                        />
                        <button className="e-btn" onClick={() => spriteEditor.promptLoadImage()}>...</button>
                    </div>
                </div>

                <div className="e-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                    <div>
                        <label className="e-label">X (Offset)</label>
                        <input type="number" className="e-input" value={spriteEditor.sprite.x} onChange={(e) => handlePropChange('x', parseInt(e.target.value) || 0)} />
                    </div>
                    <div>
                        <label className="e-label">Y (Offset)</label>
                        <input type="number" className="e-input" value={spriteEditor.sprite.y} onChange={(e) => handlePropChange('y', parseInt(e.target.value) || 0)} />
                    </div>
                </div>

                <div className="e-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                    <div>
                        <label className="e-label">Width</label>
                        <input type="number" className="e-input" value={spriteEditor.sprite.width} onChange={(e) => handlePropChange('width', parseInt(e.target.value) || 0)} />
                    </div>
                    <div>
                        <label className="e-label">Height</label>
                        <input type="number" className="e-input" value={spriteEditor.sprite.height} onChange={(e) => handlePropChange('height', parseInt(e.target.value) || 0)} />
                    </div>
                </div>

                <div className="e-row">
                    <label className="e-label">Frame Count</label>
                    <input type="number" className="e-input" value={spriteEditor.sprite.frames} onChange={(e) => handlePropChange('frames', parseInt(e.target.value) || 1)} />
                </div>

                <div className="e-row" style={{ borderTop: '1px solid #444', paddingTop: '10px', marginTop: '10px' }}>
                    <label className="e-label">Preview</label>
                    <div style={{ width: '100%', aspectRatio: '1/1', background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #444' }}>
                        <canvas id="se-preview-canvas" width="250" height="250" style={{ maxWidth: '100%', maxHeight: '100%' }}></canvas>
                    </div>
                </div>

                {/* Animation Controls */}
                <div className="e-row" style={{ marginTop: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                        <button
                            className={`e-btn ${spriteEditor.isPlaying ? 'e-btn-green' : ''}`}
                            style={{ flex: 1, marginRight: '5px' }}
                            onClick={() => spriteEditor.togglePlay()}
                        >
                            {spriteEditor.isPlaying ? 'PAUSE' : 'PLAY'}
                        </button>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <label className="e-label" style={{ marginRight: '5px', marginBottom: 0 }}>Speed(ms)</label>
                            <input
                                type="number"
                                className="e-input"
                                style={{ width: '60px' }}
                                value={spriteEditor.previewSpeed}
                                onChange={(e) => handleEditorChange('previewSpeed', parseInt(e.target.value) || 100)}
                            />
                        </div>
                    </div>

                    {!spriteEditor.isPlaying && (
                        <div className="e-row">
                            <label className="e-label">Frame: {spriteEditor.currentFrame}</label>
                            <input
                                type="range"
                                min="0"
                                max={(spriteEditor.sprite.frames || 1) - 1}
                                value={spriteEditor.currentFrame}
                                onChange={(e) => spriteEditor.setFrame(parseInt(e.target.value))}
                                style={{ width: '100%' }}
                            />
                        </div>
                    )}
                </div>

                {/* Visualization Controls */}
                <div className="e-row" style={{ borderTop: '1px solid #444', paddingTop: '10px' }}>
                    <label className="e-label">Background</label>
                    <div style={{ display: 'flex', gap: '5px', marginBottom: '10px' }}>
                        <button className="e-btn" style={{ background: '#000', border: spriteEditor.previewBg === 'black' ? '2px solid #fff' : '1px solid #555', width: '30px', height: '20px' }} onClick={() => handleEditorChange('previewBg', 'black')}></button>
                        <button className="e-btn" style={{ background: '#999', border: spriteEditor.previewBg === 'checker' ? '2px solid #fff' : '1px solid #555', width: '30px', height: '20px' }} onClick={() => handleEditorChange('previewBg', 'checker')}></button>
                        <button className="e-btn" style={{ background: '#ff00ff', border: spriteEditor.previewBg === 'pink' ? '2px solid #fff' : '1px solid #555', width: '30px', height: '20px' }} onClick={() => handleEditorChange('previewBg', 'pink')}></button>

                        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                            <label className="e-label" style={{ display: 'flex', alignItems: 'center', margin: 0, cursor: 'pointer' }}>
                                <input type="checkbox" checked={spriteEditor.showRulers} onChange={(e) => handleEditorChange('showRulers', e.target.checked)} style={{ marginRight: '5px' }} />
                                Rulers
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
