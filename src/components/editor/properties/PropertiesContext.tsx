import React from 'react';
import type { Game } from '../../../core/Game';
import type { SceneObject } from '../../../entities/SceneObject';

export type SelectedObjectType =
  | 'Entity'
  | 'Actor'
  | 'Static'
  | 'Triggerbox'
  | 'Walkbox'
  | 'Quad'
  | 'SCENE'
  | 'SETTINGS'
  | 'MULTI'
  | string;

export type Mode = 'edit' | 'select' | 'DRAW' | string | null;

export type ObjType = SceneObject | Record<string, any> | null;

export interface PropertiesContextValue<T extends ObjType = ObjType> {
  game: Game;
  obj: T;
  selectedObjectType: SelectedObjectType;
  selectedObjectId: string | null;
  mode: Mode;
  selectedVertexIndex: number | null;
  uiScale: number;

  // Mutation helpers
  handleChange: (field: string, value: unknown, enforceNumber?: boolean) => void;
  incrementObjectVersion: () => void;
  incrementHierarchyVersion: () => void;

  // Shared render helpers
  formatPanelNumber: (value: unknown) => number | string;
  setSectionRef: (section: number) => (node: HTMLDivElement | null) => void;
  scrollToSection: (section: number) => void;

  // Undo ref keys (for batching)
  lastUndoObjectKeyRef: React.MutableRefObject<string | null>;
}

export const PropertiesContext = React.createContext<PropertiesContextValue | null>(null);

export function usePropertiesContext<T extends ObjType = ObjType>(): PropertiesContextValue<T> {
  const ctx = React.useContext(PropertiesContext);
  if (!ctx) {
    throw new Error('usePropertiesContext must be used inside PropertiesContext.Provider');
  }
  return ctx as PropertiesContextValue<T>;
}
