import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { Game } from '../../core/Game';

export const HierarchyPanel: React.FC = () => {
    const { hierarchyVersion, selectedObjectId } = useEditorStore();

    // Force re-render on hierarchy version change (subscription)
    React.useEffect(() => {
        // This effect solely exists to subscribe to hierarchyVersion updates
    }, [hierarchyVersion]);

    const handleAdd = (type: string) => {
        Game.instance.editor.startCreating(type);
    };

    const handleDelete = () => {
        Game.instance.editor.deleteSelectedObject();
    };

    const scene = Game.instance?.sceneManager?.currentScene;

    if (!scene) return <div className="p-2 text-gray-500">No Scene</div>;

    const entities = scene.entities || [];
    const walkboxes = scene.walkbox || [];
    const triggers = scene.triggerboxes || [];

    return (

        <div id="hierarchy-panel" className="editor-sidebar left">
            <div className="editor-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '5px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>OBJECTS</div>
                </div>
                <div style={{ marginBottom: '5px' }}>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(6, 1fr)',
                        gap: '2px',
                        marginBottom: '5px'
                    }}>
                        <button
                            className="e-btn e-btn-small"
                            onClick={() => Game.instance.editor.saveObject()}
                            title="Save Object (Ctrl+S)"
                            style={{ justifyContent: 'center' }}
                        >
                            💾
                        </button>
                        <button
                            className="e-btn e-btn-small"
                            onClick={() => Game.instance.editor.loadObject()}
                            title="Load Object (Ctrl+O)"
                            style={{ justifyContent: 'center' }}
                        >
                            📂
                        </button>
                        <button
                            className="e-btn e-btn-small"
                            onClick={() => Game.instance.editor.undo()}
                            title="Undo (Ctrl+Z)"
                            style={{ justifyContent: 'center' }}
                        >
                            ↩️
                        </button>
                        <button
                            className="e-btn e-btn-small"
                            onClick={() => Game.instance.editor.copySelectedObjectToClipboard()}
                            title="Copy (Ctrl+C)"
                            style={{ justifyContent: 'center' }}
                        >
                            📋
                        </button>
                        <button
                            className="e-btn e-btn-small"
                            onClick={() => Game.instance.editor.pasteObjectFromClipboard()}
                            title="Paste (Ctrl+V)"
                            style={{ justifyContent: 'center' }}
                        >
                            📝
                        </button>
                        <button
                            className="e-btn e-btn-red e-btn-small"
                            onClick={handleDelete}
                            title="Delete Selected (Del)"
                            style={{ justifyContent: 'center' }}
                        >
                            🗑️
                        </button>
                    </div>

                    <select
                        className="e-select"
                        style={{ width: '100%' }}
                        onChange={(e) => {
                            if (e.target.value) {
                                handleAdd(e.target.value);
                                e.target.value = ''; // Reset
                            }
                        }}
                    >
                        <option value="">+ Add Object</option>
                        <option value="Static">Static (S)</option>
                        <option value="Actor">Actor (A)</option>
                        <option value="Walkbox">Walkbox (W)</option>
                        <option value="Triggerbox">Triggerbox (T)</option>
                    </select>
                </div>
            </div>

            <div className="editor-content">
                {/* Scene Node */}
                <div
                    className="e-list-item"
                    style={{
                        padding: '4px', marginBottom: '2px', cursor: 'pointer', borderRadius: '4px',
                        background: selectedObjectId === 'SCENE' ? '#0f0' : 'transparent',
                        color: selectedObjectId === 'SCENE' ? '#000' : '#aaa'
                    }}
                    onClick={() => Game.instance.editor.selectObject('SCENE')}
                >
                    <span style={{
                        filter: selectedObjectId === 'SCENE'
                            ? 'grayscale(100%) brightness(0)'
                            : 'grayscale(100%) sepia(100%) hue-rotate(75deg) saturate(400%)',
                        marginRight: '6px',
                        display: 'inline-block'
                    }}>
                        🎥
                    </span>
                    Scene
                </div>

                {/* Entities */}
                {entities.map((ent: any) => {
                    const isSelected = selectedObjectId === ent.name;
                    return (
                        <div
                            key={ent.name}
                            style={{
                                padding: '4px', paddingLeft: '15px', marginBottom: '2px', cursor: 'pointer', borderRadius: '4px',
                                background: isSelected ? '#0f0' : 'transparent',
                                color: isSelected ? '#000' : '#aaa'
                            }}
                            onClick={() => Game.instance.editor.selectObject(ent)}
                        >
                            <span style={{
                                filter: isSelected
                                    ? 'grayscale(100%) brightness(0)'
                                    : 'grayscale(100%) sepia(100%) hue-rotate(75deg) saturate(400%)',
                                marginRight: '6px',
                                display: 'inline-block'
                            }}>
                                {ent.type === 'Actor' ? '👤' : '📦'}
                            </span>
                            {ent.name}
                        </div>
                    );
                })}

                {/* Walkboxes */}
                {walkboxes.map((wb: any, i: number) => {
                    const id = wb.name || 'Walkbox';
                    const isSelected = selectedObjectId === id;
                    return (
                        <div
                            key={wb.name || i}
                            style={{
                                padding: '4px', paddingLeft: '15px', marginBottom: '2px', cursor: 'pointer', borderRadius: '4px',
                                background: isSelected ? '#0f0' : 'transparent',
                                color: isSelected ? '#000' : '#aaa'
                            }}
                            onClick={() => Game.instance.editor.selectObject(wb)}
                        >
                            <span style={{
                                filter: isSelected
                                    ? 'grayscale(100%) brightness(0)'
                                    : 'grayscale(100%) sepia(100%) hue-rotate(75deg) saturate(400%)',
                                marginRight: '6px',
                                display: 'inline-block'
                            }}>
                                👣
                            </span>
                            {wb.name || `Walkbox ${i}`}
                        </div>
                    );
                })}

                {/* Triggers */}
                {triggers.map((tb: any, i: number) => {
                    const id = tb.name || 'Triggerbox';
                    const isSelected = selectedObjectId === id;
                    return (
                        <div
                            key={tb.name || i}
                            style={{
                                padding: '4px', paddingLeft: '15px', marginBottom: '2px', cursor: 'pointer', borderRadius: '4px',
                                background: isSelected ? '#0f0' : 'transparent',
                                color: isSelected ? '#000' : '#aaa'
                            }}
                            onClick={() => Game.instance.editor.selectObject(tb)}
                        >
                            <span style={{
                                filter: isSelected
                                    ? 'grayscale(100%) brightness(0)'
                                    : 'grayscale(100%) sepia(100%) hue-rotate(75deg) saturate(400%)',
                                marginRight: '6px',
                                display: 'inline-block'
                            }}>
                                ⚡
                            </span>
                            {tb.name || `Trigger ${i}`}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
