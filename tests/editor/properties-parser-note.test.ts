import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PropertiesContext } from '../../src/components/editor/properties/PropertiesContext';
import { SectionParserNote } from '../../src/components/editor/properties/SectionParserNote';

function renderParserNote(note: string) {
  const scene = {
    getEntityParserNote: vi.fn(() => note),
    setEntityParserNote: vi.fn(),
  };
  const context = {
    game: { sceneManager: { currentScene: scene } },
    obj: { name: 'radio', scene },
    selectedObjectType: 'Entity',
    selectedObjectId: 'radio',
    mode: 'edit',
    selectedVertexIndex: null,
    uiScale: 1,
    handleChange: vi.fn(),
    incrementObjectVersion: vi.fn(),
    incrementHierarchyVersion: vi.fn(),
    formatPanelNumber: vi.fn(),
    setSectionRef: vi.fn(() => vi.fn()),
    scrollToSection: vi.fn(),
    lastUndoObjectKeyRef: { current: null },
    anyExpanded: true,
    collapseAll: vi.fn(),
    expandAll: vi.fn(),
  };

  return renderToStaticMarkup(
    React.createElement(
      PropertiesContext.Provider,
      { value: context as any },
      React.createElement(SectionParserNote)
    )
  );
}

describe('SectionParserNote', () => {
  it('is omitted when the selected object has no runtime Parser Note', () => {
    expect(renderParserNote('')).toBe('');
  });

  it('renders the runtime Parser Note in a vertically resizable editor', () => {
    const markup = renderParserNote('The radio remembers the last station.');

    expect(markup).toContain('Parser Note (PN)');
    expect(markup).toContain('The radio remembers the last station.');
    expect(markup).toContain('resize:vertical');
    expect(markup).toContain('data-section="7"');
  });
});
