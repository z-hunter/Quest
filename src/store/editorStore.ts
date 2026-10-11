import { create } from 'zustand';

export interface PanelConfig {
  collapsed: number[];
  scrollTop: number;
}

export type EditorMode = 'SELECT' | 'DRAW_WALKBOX' | 'DRAW_TRIGGER';

interface EditorState {
  enabled: boolean;
  mode: EditorMode;
  selectedObjectId: string | null;
  selectedObjectType: string | null; // 'Entity', 'Walkbox', 'Triggerbox', 'SCENE', 'SETTINGS'
  selectedObjectKeys: string[];

  // Panel Configuration
  panelConfig: Record<string, PanelConfig>;
  setPanelConfig: (type: string, config: PanelConfig) => void;

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
  selectObjects: (keys: string[], primaryId: string | null, type: string | null) => void;
  setSceneInfo: (name: string, filename: string) => void;
  incrementHierarchyVersion: () => void;
  incrementObjectVersion: () => void;
  spriteEditorEnabled: boolean;
  toggleSpriteEditor: (force?: boolean) => void;
  spriteVersion: number;
  incrementSpriteVersion: () => void;

  // Quad Vertex Selection
  selectedVertexIndex: number;
  selectVertex: (index: number) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  enabled: false,
  mode: 'SELECT',
  selectedObjectId: null,
  selectedObjectType: null,
  selectedObjectKeys: [],
  selectedVertexIndex: -1,
  panelConfig: {},
  sceneName: '',
  sceneFilename: '',
  hierarchyVersion: 0,
  objectVersion: 0,

  toggle: (force) => set((state) => ({ enabled: force !== undefined ? force : !state.enabled })),

  setMode: (mode) => set({ mode }),

  selectObject: (id, type) =>
    set({
      selectedObjectId: id,
      selectedObjectType: type,
      selectedObjectKeys: id ? [id] : [],
      selectedVertexIndex: -1,
    }),

  selectObjects: (keys, primaryId, type) =>
    set({
      selectedObjectKeys: keys,
      selectedObjectId: primaryId,
      selectedObjectType: type,
      selectedVertexIndex: -1,
    }),

  selectVertex: (index) => set({ selectedVertexIndex: index }),

  setPanelConfig: (type, config) =>
    set((state) => ({
      panelConfig: {
        ...state.panelConfig,
        [type]: config,
      },
    })),

  setSceneInfo: (name, filename) => set({ sceneName: name, sceneFilename: filename }),

  incrementHierarchyVersion: () =>
    set((state) => ({ hierarchyVersion: state.hierarchyVersion + 1 })),
  incrementObjectVersion: () => set((state) => ({ objectVersion: state.objectVersion + 1 })),

  // Sprite Editor
  spriteEditorEnabled: false,
  toggleSpriteEditor: (force) =>
    set((state) => ({
      spriteEditorEnabled: force !== undefined ? force : !state.spriteEditorEnabled,
    })),
  spriteVersion: 0,
  incrementSpriteVersion: () => set((state) => ({ spriteVersion: state.spriteVersion + 1 })),
}));
