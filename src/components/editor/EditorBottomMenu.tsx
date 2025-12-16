import React from 'react';
import { Game } from '../../core/Game';
import { useEditorStore } from '../../store/editorStore';

export const EditorBottomMenu: React.FC = () => {
    const { toggle, toggleSpriteEditor } = useEditorStore();

    const handleAction = (action: string) => {
        const editor = Game.instance.editor;

        switch (action) {
            case 'F1': toggle(false); break; // Close Editor
            case 'F2': editor.saveScene(false); break;
            case 'ShiftF2': editor.saveScene(true); break;
            case 'F3': editor.promptLoadScene(); break;
            case 'F4': editor.startCreatingNewScene(); break;
            case 'F5': toggleSpriteEditor(true); break;
            case 'F9': editor.selectObject('SETTINGS'); break;
        }
    };

    const keys = [
        { label: 'F1 Game', action: 'F1' },
        { label: 'F2 Save', action: 'F2' },
        { label: 'F3 Load', action: 'F3' },
        { label: 'F4 New', action: 'F4' },
        { label: 'F5 Sprite', action: 'F5' },
        { label: 'F9 Settings', action: 'F9' },
    ];

    return (
        <div className="editor-bottom-menu" style={{ zIndex: 2000 }}>
            {keys.map(k => (
                <button
                    key={k.label}
                    className="e-menu-btn"
                    onClick={() => handleAction(k.action)}
                >
                    <span className="hotkey-accent">{k.label.split(' ')[0]}</span>
                    {k.label.split(' ').slice(1).join(' ')}
                </button>
            ))}
        </div>
    );
};
