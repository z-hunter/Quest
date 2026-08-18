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
const { SectionComponents } =
  await import('../../src/components/editor/properties/SectionComponents');

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    domWindow.HTMLTextAreaElement.prototype,
    'value'
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new domWindow.Event('input', { bubbles: true }));
}

function blur(textarea: HTMLTextAreaElement) {
  textarea.dispatchEvent(new domWindow.Event('focusout', { bubbles: true }));
}

function renderProperties(object: any, selectedObjectType: string, textAssets: any) {
  const incrementObjectVersion = vi.fn();
  const context = {
    game: { textAssets, editor: { saveUndoState: vi.fn() } },
    obj: object,
    selectedObjectType,
    selectedObjectId: object.name,
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
        React.createElement(SectionComponents)
      )
    );
  });
  return {
    container,
    component: object.components[0] as any,
    incrementObjectVersion,
    cleanup: () =>
      act(() => {
        root.unmount();
        container.remove();
      }),
  };
}

function renderNpcProperties() {
  const object = {
    name: 'guard',
    components: [
      {
        type: 'NPC',
        memory: ['The remote is near the sofa.'],
        objectives: [
          {
            id: 'old-root',
            text: 'Turn on the TV',
            subtasks: [{ id: 'old-child', text: 'Find the remote', subtasks: [] }],
          },
        ],
      },
    ],
  };
  const textAssets = {
    getResolvedObjectField: vi.fn(() => 'Guard'),
    getResolvedNpcMemory: vi.fn(() => ['Authored fact']),
    getResolvedNpcMemoryRevision: vi.fn(() => '["Authored fact"]'),
    getResolvedNpcObjectives: vi.fn(() => []),
    getResolvedNpcObjectivesRevision: vi.fn(() => '[]'),
  };
  return renderProperties(object, 'Actor', textAssets);
}

afterAll(() => domWindow.happyDOM.close());

describe('SectionComponents NPC cognition editor', () => {
  it('edits newline memory and a two-space objective tree while regenerating IDs', () => {
    const rendered = renderNpcProperties();
    const [memory, objectives] = Array.from(rendered.container.querySelectorAll('textarea'));

    expect(memory?.value).toBe('The remote is near the sofa.');
    expect(objectives?.value).toBe('Turn on the TV\n  Find the remote');

    act(() => {
      setTextareaValue(memory!, 'The remote is near the sofa.\nRick borrowed it.');
      blur(memory!);
      setTextareaValue(objectives!, 'Turn on the TV\n  Find the remote\n    Ask Rick');
      blur(objectives!);
    });

    expect(rendered.component.memory).toEqual([
      'The remote is near the sofa.',
      'Rick borrowed it.',
    ]);
    expect(rendered.component.objectives).toEqual([
      expect.objectContaining({
        text: 'Turn on the TV',
        subtasks: [
          expect.objectContaining({
            text: 'Find the remote',
            subtasks: [expect.objectContaining({ text: 'Ask Rick' })],
          }),
        ],
      }),
    ]);
    expect(rendered.component.objectives[0].id).not.toBe('old-root');
    expect(rendered.component.objectives[0].subtasks[0].id).not.toBe('old-child');
    expect(rendered.component.objectivesInitializedFromTA).toBe(true);
    expect(rendered.incrementObjectVersion).toHaveBeenCalledTimes(2);
    rendered.cleanup();
  });

  it('keeps the textarea draft and runtime tree when indentation is invalid', () => {
    const rendered = renderNpcProperties();
    const objectives = rendered.container.querySelectorAll('textarea')[1]!;
    const before = structuredClone(rendered.component.objectives);

    act(() => {
      setTextareaValue(objectives, 'Turn on the TV\n   Invalid indent');
      blur(objectives);
    });

    expect(objectives.value).toBe('Turn on the TV\n   Invalid indent');
    expect(rendered.component.objectives).toEqual(before);
    expect(rendered.container.textContent).toContain('indentation must use pairs of spaces');
    expect(rendered.incrementObjectVersion).not.toHaveBeenCalled();
    rendered.cleanup();
  });

  it('adds Surface with ON relation to a titleless Quad', () => {
    const object = { name: 'floor', components: [] };
    const textAssets = { getResolvedObjectField: vi.fn(() => '') };
    const rendered = renderProperties(object, 'Quad', textAssets);
    const addSelect = rendered.container.querySelector('.custom-select-trigger') as HTMLElement;

    act(() => addSelect.click());
    const surfaceOption = Array.from(rendered.container.querySelectorAll('.custom-option')).find(
      (option) => option.textContent === 'Surface'
    ) as HTMLElement;
    act(() => surfaceOption.click());

    expect(object.components).toEqual([
      expect.objectContaining({ type: 'Surface', relation: 'on' }),
    ]);
    rendered.cleanup();
  });
});
