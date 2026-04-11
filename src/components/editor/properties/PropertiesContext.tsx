import React from 'react';
import type { Game } from '../../../core/Game';

export interface PropertiesContextValue {
  game: Game;
  obj: unknown;
  selectedObjectType: string;
  selectedObjectId: string | null;
  mode: string | null;
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

export const usePropertiesContext = (): PropertiesContextValue => {
  const ctx = React.useContext(PropertiesContext);
  if (!ctx) {
    throw new Error('usePropertiesContext must be used inside PropertiesContext.Provider');
  }
  return ctx;
};
