import React from 'react';
import { Game } from '../../core/Game';
// import { useEditorStore } from '../../store/editorStore';

export const EditorToolbar: React.FC = () => {
    // const { selectObject } = useEditorStore();

    const handleAdd = (type: string) => {
        Game.instance.editor.startCreating(type);
    };

    const handleDelete = () => {
        Game.instance.editor.deleteSelectedObject();
    };

    const handleQuickSave = () => {
        Game.instance.editor.saveScene(false);
    };

    const handleQuickLoad = () => {
        Game.instance.editor.promptLoadScene();
    };

    return (
        <div className="h-8 bg-black border-b border-green-500 flex items-center px-2 gap-2 text-xs" style={{ zIndex: 20 }}>
            <div className="flex gap-1">
                <button className="bg-gray-800 hover:bg-gray-700 text-green-400 px-2 py-1 rounded border border-green-900" onClick={() => handleAdd('Static')}>+ Static</button>
                <button className="bg-gray-800 hover:bg-gray-700 text-blue-400 px-2 py-1 rounded border border-blue-900" onClick={() => handleAdd('Actor')}>+ Actor</button>
                <button className="bg-gray-800 hover:bg-gray-700 text-purple-400 px-2 py-1 rounded border border-purple-900" onClick={() => handleAdd('Walkbox')}>+ Walk</button>
                <button className="bg-gray-800 hover:bg-gray-700 text-yellow-400 px-2 py-1 rounded border border-yellow-900" onClick={() => handleAdd('Triggerbox')}>+ Trig</button>
            </div>

            <div className="w-px h-4 bg-gray-600 mx-1"></div>

            <button className="bg-red-900 hover:bg-red-700 text-white px-2 py-1 rounded" onClick={handleDelete}>Del</button>
            <button className="bg-gray-800 hover:bg-gray-700 text-white px-2 py-1 rounded" onClick={() => Game.instance.editor.duplicateSelectedObject()}>Dup</button>

            <div className="flex-1"></div>

            <button className="bg-gray-800 hover:bg-gray-700 text-white px-2 py-1 rounded" onClick={handleQuickSave}>Save (F2)</button>
            <button className="bg-gray-800 hover:bg-gray-700 text-white px-2 py-1 rounded" onClick={handleQuickLoad}>Load (F3)</button>
        </div>
    );
};
