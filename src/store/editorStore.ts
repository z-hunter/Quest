import { create } from 'zustand';

export type EditorMode = 'SELECT' | 'DRAW_WALKBOX' | 'DRAW_TRIGGER';

interface EditorState {
    enabled: boolean;
    mode: EditorMode;
    selectedObjectId: string | null;
    selectedObjectType: string | null; // 'Entity', 'Walkbox', 'Triggerbox', 'SCENE', 'SETTINGS'

    // Scene Metadata (Used for Scene Props Panel)
    sceneName: string;
    sceneFilename: string;

    // Signals
    hierarchyVersion: number;
    objectVersion: number;

    // Actions
    toggle: (force?: boolean) => void;
    setMode: (mode: EditorMode) => void;
    selectObject: (id: string | null, type: string | null) => void;
    setSceneInfo: (name: string, filename: string) => void;
    incrementHierarchyVersion: () => void;
    incrementObjectVersion: () => void;
    spriteEditorEnabled: boolean;
    toggleSpriteEditor: (force?: boolean) => void;
    spriteVersion: number;
    incrementSpriteVersion: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
    enabled: false,
    mode: 'SELECT',
    selectedObjectId: null,
    selectedObjectType: null,
    sceneName: '',
    sceneFilename: '',
    hierarchyVersion: 0,
    objectVersion: 0,

    toggle: (force) => set((state) => ({ enabled: force !== undefined ? force : !state.enabled })),

    setMode: (mode) => set({ mode }),

    selectObject: (id, type) => set({ selectedObjectId: id, selectedObjectType: type }),

    setSceneInfo: (name, filename) => set({ sceneName: name, sceneFilename: filename }),

    incrementHierarchyVersion: () => set((state) => ({ hierarchyVersion: state.hierarchyVersion + 1 })),
    incrementObjectVersion: () => set((state) => ({ objectVersion: state.objectVersion + 1 })),

    // Sprite Editor
    spriteEditorEnabled: false,
    toggleSpriteEditor: (force) => set((state) => ({ spriteEditorEnabled: force !== undefined ? force : !state.spriteEditorEnabled })),
    spriteVersion: 0,
    incrementSpriteVersion: () => set((state) => ({ spriteVersion: state.spriteVersion + 1 })),
}));
