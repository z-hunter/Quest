import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { Game } from '../../core/Game';

export const HierarchyPanel: React.FC = () => {
    const { hierarchyVersion, selectedObjectId, selectObject } = useEditorStore();

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
            {/* Header Controls */}
            <div className="editor-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '5px' }}>
                <div>OBJECTS</div>
                <div style={{ display: 'flex', gap: '5px' }}>
                    <select
                        className="e-select"
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
                    <button
                        className="e-btn e-btn-red"
                        onClick={handleDelete}
                        title="Delete Selected (Del)"
                    >
                        Delete
                    </button>
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
                    Scene
                </div>

                {/* Entities */}
                {entities.map((ent: any) => (
                    <div
                        key={ent.name}
                        style={{
                            padding: '4px', paddingLeft: '15px', marginBottom: '2px', cursor: 'pointer', borderRadius: '4px',
                            background: selectedObjectId === ent.name ? '#0f0' : 'transparent',
                            color: selectedObjectId === ent.name ? '#000' : '#aaa'
                        }}
                        onClick={() => Game.instance.editor.selectObject(ent)}
                    >
                        {ent.type === 'Actor' ? '👤' : '📦'} {ent.name}
                    </div>
                ))}

                {/* Walkboxes */}
                {walkboxes.map((wb: any, i: number) => (
                    <div
                        key={wb.name || i}
                        style={{
                            padding: '4px', paddingLeft: '15px', marginBottom: '2px', cursor: 'pointer', borderRadius: '4px',
                            background: selectedObjectId === (wb.name || 'Walkbox') ? '#0f0' : 'transparent',
                            color: selectedObjectId === (wb.name || 'Walkbox') ? '#000' : '#aaa'
                        }}
                        onClick={() => Game.instance.editor.selectObject(wb)}
                    >
                        👣 {wb.name || `Walkbox ${i}`}
                    </div>
                ))}

                {/* Triggers */}
                {triggers.map((tb: any, i: number) => (
                    <div
                        key={tb.name || i}
                        style={{
                            padding: '4px', paddingLeft: '15px', marginBottom: '2px', cursor: 'pointer', borderRadius: '4px',
                            background: selectedObjectId === (tb.name || 'Triggerbox') ? '#0f0' : 'transparent',
                            color: selectedObjectId === (tb.name || 'Triggerbox') ? '#000' : '#aaa'
                        }}
                        onClick={() => Game.instance.editor.selectObject(tb)}
                    >
                        ⚡ {tb.name || `Trigger ${i}`}
                    </div>
                ))}
            </div>
        </div>
    );
};
