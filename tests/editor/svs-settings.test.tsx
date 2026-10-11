import React, { act } from 'react';
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
const { CRTSettingsSection, DisplaySettingsSection } =
  await import('scanline-virtual-screen/react');
const { createDefaultQuestSettings, QUEST_SCREEN_MODES } =
  await import('../../src/core/displaySettings');

const roots: ReturnType<typeof createRoot>[] = [];

afterEach(() => {
  act(() => {
    roots.splice(0).forEach((root) => root.unmount());
  });
  domWindow.document.body.replaceChildren();
});

afterAll(() => domWindow.happyDOM.close());

describe('SVS controlled settings integration', () => {
  it('shows all Quest display modes', () => {
    const element = document.createElement('div');
    document.body.append(element);
    const root = createRoot(element);
    roots.push(root);
    const profile = createDefaultQuestSettings().screenProfile;

    act(() => {
      root.render(
        React.createElement(DisplaySettingsSection, {
          value: profile,
          modes: QUEST_SCREEN_MODES,
          onChange: () => undefined,
        })
      );
    });

    expect(element.querySelectorAll('option')).toHaveLength(3);
    expect(element.querySelector('select')?.value).toBe('quest-420x300');
  });

  it('emits a whole profile when CRT emulation changes', () => {
    const element = document.createElement('div');
    document.body.append(element);
    const root = createRoot(element);
    roots.push(root);
    const profile = createDefaultQuestSettings().screenProfile;
    let nextProfile = profile;

    act(() => {
      root.render(
        React.createElement(CRTSettingsSection, {
          value: profile,
          onChange: (next) => {
            nextProfile = next;
          },
        })
      );
    });

    expect(element.textContent).toContain('Final image');
    expect(element.textContent).toContain('Raster');
    const toggle = element.querySelector('input[type="checkbox"]') as HTMLInputElement;
    act(() => {
      toggle.click();
    });

    expect(nextProfile.virtualScreen.modeId).toBe('quest-420x300');
    expect(nextProfile.crt.crtEmulation).toBe(false);
  });
});
