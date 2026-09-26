# Host integration

[← Public API](./api.md) · [Development →](./development.md)

SVS integrates at a host's display boundary. The host prepares a source canvas; SVS does not care whether that source came from a game, terminal, video, editor, or scripted scene.

## Core-only host

1. Define a stable `ScreenMode[]` catalogue.
2. Load persisted JSON with `normalizeProfile(input, fallback, modes)`.
3. Resize the source canvas to the selected mode's dimensions.
4. Create one `VirtualScreenRenderer` for the output canvas.
5. In the host RAF, call `render(source, profileToRenderSettings(profile), overlays, sourceChanged)`.
6. Call `clearPersistence()` after a source-size change and `dispose()` when the renderer is no longer used.

The host decides how to report invalid persistence and whether a profile change requires a redraw.

## Overlay host state

Keep interactive image, sprite, cursor, or HUD state in the host. At rendering time turn it into `ScreenOverlay[]` in virtual pixels. If the host naturally stores positions as percentages, use `normalizedOverlay()` immediately before the render call.

Do not serialize a `CanvasImageSource`, object URL, or `ScreenOverlay` in `ScreenProfile`.

## Optional terminal adapter

Only a terminal host needs this entrypoint:

```ts
import { TerminalRenderer } from 'scanline-virtual-screen/terminal';

const terminalRenderer = new TerminalRenderer();
terminalRenderer.bindTerminal(xterm);
// Pass terminalRenderer.sourceCanvas to core.render().

terminalRenderer.dispose();
```

Create the adapter when the host creates the terminal scene and dispose it when that scene closes. A hidden-but-live adapter defeats the optional-lifecycle boundary: it keeps xterm subscriptions and canvas work alive unnecessarily.

If a host needs terminal-specific overlay interaction, it can subclass or wrap `TerminalRenderer` at its own boundary. Scanline Term's `ScanlineTerminalRenderer` is one example: it adds tab-local normalized image state without adding that state to SVS core.

The host is responsible for TUI heuristics and diagnostics. When it has identified a stable region, it calls `beginRegionScroll()`; ordinary normal-buffer scrolling calls `beginBufferScroll()`. SVS only animates the supplied rows and never treats output text as evidence of a scroll.

## Controlled React sections

The host owns profile state and may mount each section independently:

```tsx
import {
  AdvancedCRTSettingsSection,
  DisplaySettingsSection,
  TerminalSettingsSection,
} from 'scanline-virtual-screen/react';
import 'scanline-virtual-screen/react/styles.css';

<DisplaySettingsSection value={profile} modes={availableModes} onChange={setProfile} />
<AdvancedCRTSettingsSection value={profile} onChange={setProfile} />
<TerminalSettingsSection value={profile} fonts={fonts} onChange={setProfile} />
```

When only one mode is available, `DisplaySettingsSection` hides its selector. Terminal settings may remain in a profile even when no terminal adapter exists; a nonterminal host simply omits that section. If a terminal host keeps smooth scrolling outside its persisted profile, pass the optional `smoothScrolling` value and callbacks to `TerminalSettingsSection`; SVS never persists or infers that host state.

## Scanline Term adapter

Scanline Term consumes SVS through its pinned package tag. `src/terminal/ScanlineTerminalRenderer.ts` is its host adapter; `src/crt/useCRT.ts` owns the app-level RAF, resize observation, tab switching, and error reporting. Update the package tag only after the package validations and the Scanline Term integration matrix both pass.
