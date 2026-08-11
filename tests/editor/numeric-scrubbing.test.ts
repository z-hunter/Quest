import React, { act, useRef, useState } from 'react';
import { Window } from 'happy-dom';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

const domWindow = new Window();
Object.assign(globalThis, {
  window: domWindow,
  document: domWindow.document,
  HTMLElement: domWindow.HTMLElement,
  HTMLInputElement: domWindow.HTMLInputElement,
  Event: domWindow.Event,
  Node: domWindow.Node,
  Text: domWindow.Text,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import('react-dom/client');
const { useNumericScrubbing } =
  await import('../../src/components/editor/properties/propertiesUtils');

function ScrubFixture() {
  const panelRef = useRef<HTMLDivElement>(null);
  const [min, setMin] = useState(0.5);
  const [max, setMax] = useState(1);
  useNumericScrubbing(panelRef);

  return React.createElement(
    'div',
    { ref: panelRef },
    React.createElement(
      'label',
      { className: 'e-label' },
      'Min',
      React.createElement('input', {
        type: 'number',
        step: '0.01',
        value: min,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          setMin(Number(event.target.value)),
      })
    ),
    React.createElement(
      'label',
      { className: 'e-label' },
      'Max',
      React.createElement('input', {
        type: 'number',
        step: '0.01',
        value: max,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          setMax(Number(event.target.value)),
      })
    )
  );
}

function renderFixture() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(React.createElement(ScrubFixture)));
  return {
    container,
    cleanup: () =>
      act(() => {
        root.unmount();
        container.remove();
      }),
  };
}

afterAll(() => domWindow.happyDOM.close());

describe('numeric label scrubbing', () => {
  let rendered: ReturnType<typeof renderFixture> | null = null;

  afterEach(() => {
    rendered?.cleanup();
    rendered = null;
  });

  it('scrubs a number input owned by the clicked label, not its next sibling', () => {
    rendered = renderFixture();
    const [minLabel] = Array.from(rendered.container.querySelectorAll('label'));

    act(() => {
      minLabel.dispatchEvent(
        new domWindow.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10 })
      );
      document.dispatchEvent(new domWindow.MouseEvent('mousemove', { clientX: 22 }));
      document.dispatchEvent(new domWindow.MouseEvent('mouseup'));
    });

    const [minInput, maxInput] = Array.from(
      rendered.container.querySelectorAll<HTMLInputElement>('input')
    );
    expect(minInput.value).toBe('0.52');
    expect(maxInput.value).toBe('1');
  });

  it('does not intercept direct input interaction', () => {
    rendered = renderFixture();
    const minInput = rendered.container.querySelector<HTMLInputElement>('input')!;
    const event = new domWindow.MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 10,
    });

    act(() => minInput.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
  });
});
