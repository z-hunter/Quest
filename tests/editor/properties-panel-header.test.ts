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
const { Game } = await import('../../src/core/Game');
const { useEditorStore } = await import('../../src/store/editorStore');
const { PropertiesPanel } = await import('../../src/components/editor/properties/PropertiesPanel');

afterAll(() => domWindow.happyDOM.close());

describe('PropertiesPanel header dynamic update', () => {
  it('dynamically updates header title when object id/name is changed', async () => {
    const mockObject: any = {
      name: 'npc_guard',
      type: 'Actor',
      x: 100,
      y: 200,
      components: [],
    };

    const mockScene: any = {
      id: 'test_scene',
      entities: [mockObject],
      walkbox: [],
      triggerboxes: [],
      folders: [],
      camera: { x: 0, y: 0 },
      getEntityParserNote: vi.fn().mockReturnValue(''),
    };

    const mockGame: any = {
      settings: { editor: { uiScale: 1 } },
      sceneManager: { currentScene: mockScene },
      editor: {
        selectedObject: mockObject,
        saveUndoState: vi.fn(),
      },
      textAssets: {
        readObjectAssetById: vi.fn().mockResolvedValue(null),
        getResolvedObjectAssetField: vi.fn().mockReturnValue(''),
        getResolvedObjectField: vi.fn().mockReturnValue(''),
        getObjectAssetProjectPath: vi.fn().mockReturnValue(''),
      },
      showMessage: vi.fn(),
    };

    Game.instance = mockGame;

    useEditorStore.getState().selectObjects(['Actor:npc_guard'], 'npc_guard', 'Actor');

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(PropertiesPanel));
    });

    const headerSpan = container.querySelector('.editor-header span');
    expect(headerSpan).not.toBeNull();
    expect(headerSpan?.textContent).toBe('ACTOR: npc_guard');

    // Find Identity ID input and change value
    const idInput = container.querySelector(
      '.properties-section-block[data-section="0"] input'
    ) as HTMLInputElement | null;
    expect(idInput).not.toBeNull();
    expect(idInput?.value).toBe('npc_guard');

    function setInputValue(input: HTMLInputElement, value: string) {
      const setter = Object.getOwnPropertyDescriptor(
        domWindow.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new domWindow.Event('input', { bubbles: true }));
    }

    await act(async () => {
      // Simulate user typing and blur
      if (idInput) {
        setInputValue(idInput, 'npc_soldier');
        idInput.dispatchEvent(new domWindow.Event('change', { bubbles: true }));
        idInput.dispatchEvent(new domWindow.Event('focusout', { bubbles: true }));
        idInput.dispatchEvent(new domWindow.Event('blur', { bubbles: false }));
      }
    });

    // Check that object name, store selectedObjectId, and panel header are all updated dynamically
    expect(mockObject.name).toBe('npc_soldier');
    expect(useEditorStore.getState().selectedObjectId).toBe('npc_soldier');
    expect(useEditorStore.getState().selectedObjectKeys).toEqual(['Actor:npc_soldier']);
    expect(headerSpan?.textContent).toBe('ACTOR: npc_soldier');

    await act(async () => {
      root.unmount();
      container.remove();
    });
  });
});
