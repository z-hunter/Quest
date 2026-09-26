# Architecture

[← README](../README.md) · [Public API →](./api.md)

SVS is a browser-side pipeline. It accepts a ready source canvas from the host, composites runtime overlays in the source's virtual coordinate system, and produces an output canvas through CRT WebGL or Canvas 2D pass-through rendering.

```text
host source canvas + runtime overlays
              │
              ▼
       OverlayCompositor
              │
              ▼
  VirtualScreenRenderer facade
       │                  │
       ▼                  ▼
  CRTFilter (WebGL)   Canvas 2D pass-through
       │                  │
       └──── output HTMLCanvasElement ────┘
```

## Ownership boundary

| SVS owns | The host owns |
|---|---|
| Profile validation and legacy migration | Mode catalogue and dimensions |
| Virtual-pixel overlay compositing | Source-canvas content |
| CRT filter and WebGL lifecycle | RAF, resize observation and error presentation |
| Optional xterm-to-canvas adapter | Whether an xterm adapter exists at all |
| Controlled React sections | Profile state, persistence and surrounding UI |

This boundary is deliberate. A game normally supplies a Canvas 2D frame. A terminal host may create the optional xterm adapter only while it needs a terminal scene. No terminal object, subscription, or redraw work exists when the host has not created that adapter.

## Profile and modes

`ScreenProfile` is the canonical persisted payload:

```ts
type ScreenProfile = {
  schemaVersion: 1;
  virtualScreen: { modeId: string };
  terminal: TerminalSettings;
  crt: CRTVisualSettings;
};
```

Profiles store `modeId`, not width, height, or aspect ratio. The host resolves the ID through its own `ScreenMode[]` catalogue. `normalizeProfile()` accepts this schema and the legacy `{ version: 1, resolution, crt }` wire format. If a saved mode is absent, it retains the remaining valid settings and falls back to the host's current valid mode.

## Overlays

`ScreenOverlay` values contain a `CanvasImageSource`, virtual-pixel `x`, `y`, `width`, `height`, `zIndex`, and optional opacity. They are not persisted in `ScreenProfile`.

The compositor copies the source canvas first, then draws overlays in stable ascending `zIndex` order. Equal z-index values preserve the input order. `normalizedOverlay()` converts host coordinates in the `0..1` range at the boundary.

## Rendering lifecycle

`VirtualScreenRenderer` owns its compositor and, when enabled, its `CRTFilter`. Call `render()` from the host's frame loop and call `dispose()` when the output canvas is discarded, a tab closes, or the host replaces the WebGL context. Resize the host canvases before the next render and call `clearPersistence()` when a resize invalidates phosphor history.

The facade is deliberately not a scheduler: it does not own `requestAnimationFrame`, `ResizeObserver`, tabs, or error UI.

The terminal adapter does not inspect successive screens to discover TUI movement, maintain diagnostics, calculate tab colours, interpret host mode IDs, or render branded preview content. A host determines whether a terminal operation is a buffer scroll or a region scroll and calls the explicit API.
