import React from 'react';
import { act } from 'react';
import { Window } from 'happy-dom';
import { afterAll, describe, expect, it, vi } from 'vitest';

const domWindow = new Window();
Object.assign(globalThis, {
  window: domWindow,
  document: domWindow.document,
  HTMLElement: domWindow.HTMLElement,
  HTMLInputElement: domWindow.HTMLInputElement,
  Event: domWindow.Event,
  Node: domWindow.Node,
  Text: domWindow.Text,
  requestAnimationFrame: domWindow.requestAnimationFrame.bind(domWindow),
  cancelAnimationFrame: domWindow.cancelAnimationFrame.bind(domWindow),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import('react-dom/client');
const { PropertiesContext } =
  await import('../../src/components/editor/properties/PropertiesContext');
const { SectionMisc } = await import('../../src/components/editor/properties/SectionMisc');

afterAll(() => domWindow.happyDOM.close());

describe('SectionMisc Box3D hint', () => {
  it('describes Box3D mouse modifiers and wheel actions', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(
          PropertiesContext.Provider,
          {
            value: {
              game: {} as any,
              obj: { locked: false, disabled: false, hidden: false },
              selectedObjectType: 'Box3D',
              selectedObjectId: 'box',
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
            } as any,
          },
          React.createElement(SectionMisc, {
            isTriggerbox: false,
            isQuad: false,
            isBox3D: true,
          })
        )
      );
    });

    expect(container.textContent).toContain(
      'Hold SHIFT: resize bottom; ALT: resize top; CTRL: scale.'
    );
    expect(container.textContent).toContain(
      'CTRL + wheel: top offset X. SHIFT + wheel: top offset Z.'
    );

    act(() => {
      root.unmount();
      container.remove();
    });
  });
});
