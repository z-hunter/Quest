import React from 'react';
import { act } from 'react';
import { Window } from 'happy-dom';
import { afterAll, describe, expect, it, vi } from 'vitest';

const domWindow = new Window();
Object.assign(globalThis, {
  window: domWindow,
  document: domWindow.document,
  HTMLElement: domWindow.HTMLElement,
  HTMLTextAreaElement: domWindow.HTMLTextAreaElement,
  Event: domWindow.Event,
  Node: domWindow.Node,
  Text: domWindow.Text,
  requestAnimationFrame: domWindow.requestAnimationFrame.bind(domWindow),
  cancelAnimationFrame: domWindow.cancelAnimationFrame.bind(domWindow),
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: domWindow.navigator,
});

const { createRoot } = await import('react-dom/client');
const { PropertiesContext } =
  await import('../../src/components/editor/properties/PropertiesContext');
const { SectionParserNote } =
  await import('../../src/components/editor/properties/SectionParserNote');

function renderParserNote(note: string) {
  const scene = {
    getEntityParserNote: vi.fn(() => note),
    setEntityParserNote: vi.fn(),
  };
  const incrementObjectVersion = vi.fn();
  const context = {
    game: { sceneManager: { currentScene: scene } },
    obj: { name: 'radio', scene },
    selectedObjectType: 'Entity',
    selectedObjectId: 'radio',
    mode: 'edit',
    selectedVertexIndex: null,
    uiScale: 1,
    handleChange: vi.fn(),
    incrementObjectVersion,
    incrementHierarchyVersion: vi.fn(),
    formatPanelNumber: vi.fn(),
    setSectionRef: vi.fn(() => vi.fn()),
    scrollToSection: vi.fn(),
    lastUndoObjectKeyRef: { current: null },
    anyExpanded: true,
    collapseAll: vi.fn(),
    expandAll: vi.fn(),
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      React.createElement(
        PropertiesContext.Provider,
        { value: context as any },
        React.createElement(SectionParserNote)
      )
    );
  });

  return {
    container,
    incrementObjectVersion,
    scene,
    cleanup: () =>
      act(() => {
        root.unmount();
        container.remove();
      }),
  };
}

afterAll(() => domWindow.happyDOM.close());

describe('SectionParserNote', () => {
  it('is omitted when the selected object has no runtime Parser Note', () => {
    const rendered = renderParserNote('   ');
    expect(rendered.container.innerHTML).toBe('');
    rendered.cleanup();
  });

  it('renders the runtime Parser Note in a vertically resizable editor', () => {
    const rendered = renderParserNote('The radio remembers the last station.');
    const markup = rendered.container.innerHTML;

    expect(markup).toContain('Parser Note (PN)');
    expect(markup).toContain('The radio remembers the last station.');
    expect(markup).toContain('resize: vertical');
    expect(markup).toContain('data-section="7"');
    rendered.cleanup();
  });

  it('updates the runtime note and invalidates the Properties panel on textarea input', () => {
    const rendered = renderParserNote('The radio remembers the last station.');
    const textarea = rendered.container.querySelector('textarea');
    expect(textarea).not.toBeNull();

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        domWindow.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      valueSetter?.call(textarea, 'The radio is now silent.');
      textarea!.dispatchEvent(new domWindow.Event('input', { bubbles: true }));
    });

    expect(rendered.scene.setEntityParserNote).toHaveBeenCalledWith(
      'radio',
      'The radio is now silent.'
    );
    expect(rendered.incrementObjectVersion).toHaveBeenCalledTimes(1);
    rendered.cleanup();
  });
});
