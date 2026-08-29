# Scanline Engine Playwright Debug API

The **Debug API** provides programmatic access to engine state, modes, scenes, objects, settings, performance sampling, Box3D renderer diagnostics, and the in-game console. It is designed for automated testing (via Playwright or Vitest Browser) and AI agent interactions without requiring UI clicks, coordinate guessing, or opening submenus.

---

## Availability & Security Guard

- **Target Runtime**: Web/Vite build only (`!isTauriRuntime()`).
- **Tauri Desktop Build**: The API is disabled and omitted in the desktop runtime to prevent unintentional debug state exposure.
- **Entry Points**:
  - `window.__QUEST_DEBUG__.api`
  - `window.__SCANLINE_DEBUG__.api`
- **DOM Indicator**:
  - `<html data-quest-mode="game|scene-editor|sprite-editor">`

---

## API Reference

### 1. Mode Switching (`api.modes` / `api.getMode`, `api.setMode`)

Controls switching between gameplay and built-in editor tools.

| Method | Signature | Description |
| :--- | :--- | :--- |
| `getMode()` | `() => 'game' \| 'scene-editor' \| 'sprite-editor'` | Returns the currently active application mode. |
| `setMode(mode)` | `(mode: 'game' \| 'scene-editor' \| 'sprite-editor') => void` | Cleanly switches to the specified mode. |

#### Mode Behavior:
- `'game'`: Closes Scene Editor and Sprite Editor; restores gameplay parser input focus.
- `'scene-editor'`: Closes Sprite Editor; enables Scene Editor; synchronizes scene hierarchy; disables parser input.
- `'sprite-editor'`: Closes Scene Editor; enables Sprite Editor; disables parser input.
- Both `api.getMode()` / `api.setMode()` and `api.modes.getMode()` / `api.modes.setMode()` are supported.

---

### 2. Scene Loading (`api.scenes.load`)

Loads and activates scenes through the public `SceneManager` pipeline.

| Method | Signature | Description |
| :--- | :--- | :--- |
| `load(filename)` | `(filename: string) => Promise<void>` | Loads, parses, and activates a scene by filename (e.g. `'box3d2_t.json'`). |

- Preserves normal asset preloading, switch audio, and error handling.
- Automatically refreshes the editor hierarchy and store when the Scene Editor is active.
- Resolves only after the scene is fully loaded and ready for inspection.

---

### 3. Scene Objects & Properties (`api.objects`)

Inspects and mutates properties of any object in the active scene without manually selecting it in the UI hierarchy or opening the Properties panel.

| Method | Signature | Description |
| :--- | :--- | :--- |
| `listObjects()` | `() => ObjectDescriptor[]` | Returns a list of all objects in the scene (Scene, Entities, Actors, Walkboxes, Triggerboxes, Folders, Quads, Box3Ds). |
| `getObject(nameOrId)` | `(nameOrId: string) => any` | Retrieves the live runtime object instance (or `SCENE`). |
| `getObjectProperties(nameOrId)` | `(nameOrId: string) => Record<string, any> \| null` | Returns a clean serializable snapshot of the object's properties. |
| `setObjectProperty(nameOrId, prop, value)` | `(nameOrId: string, property: string, value: unknown) => boolean` | Sets a property on the object with automatic type coercion, store invalidation, and renaming. |
| `setObjectProperties(nameOrId, props)` | `(nameOrId: string, properties: Record<string, unknown>) => boolean` | Batch updates multiple properties on an object. |

#### Object Descriptor Interface:
```ts
interface ObjectDescriptor {
  id: string;
  name: string;
  type: string; // 'SCENE' | 'Actor' | 'Static' | 'Entity' | 'Walkbox' | 'Triggerbox' | 'Folder' | 'Quad' | 'Box3D'
  customName?: string;
}
```

#### Mutation Features:
- **Numeric Coercion**: Automatically converts string values for numeric fields (`x`, `y`, `width`, `height`, `opacity`, `layer`, `parallax`, `blur`, etc.).
- **Renaming**: Modifying the `name` property automatically invokes `scene.renameObject(...)` to safely update scene references.
- **Group ID Normalization**: Modifying `groupID` normalizes commas and whitespace.
- **Inherited Props Cleanup**: If the property was inherited from a prototype/template, modifying it removes it from `inheritedProps`.
- **UI Reactivity**: Automatically increments `objectVersion` and `hierarchyVersion` in `useEditorStore` to re-render any open panels.

---

### 4. Settings (`api.settings`)

Controls in-game graphics, audio, and editor settings without opening the F9 modal dialog.

| Method | Signature | Description |
| :--- | :--- | :--- |
| `getSettings()` | `() => Record<string, any>` | Returns a copy of `game.settings`. |
| `getSetting(path)` | `(path: string) => any` | Dot-notation getter (e.g. `'crt.enabled'`, `'editor.uiScale'`, `'audio.attachedVolume'`). |
| `setSetting(path, value)` | `(path: string, value: unknown) => void` | Dot-notation setter with automatic side-effects and persistence. |
| `setSettings(partial)` | `(partialSettings: Record<string, any>) => void` | Deep merge update for multiple settings. |
| `saveSettings()` | `() => void` | Persists current settings to `localStorage`. |
| `loadSettings()` | `() => void` | Reloads settings from `localStorage`. |

#### Automatic Side Effects:
- `audio.attachedVolume` / `audio.*`: Automatically synchronizes `SoundManager.getInstance().setAttachedVolume(...)`.
- `editor.uiScale`: Automatically notifies editor hierarchy store.
- Automatically saves changes to `localStorage` on update.

---

### 5. In-Game Console & Parser (`api.console`)

Sends commands and reads text output from the in-game console (as defined in `GDD.md`).

| Method | Signature | Description |
| :--- | :--- | :--- |
| `sendCommand(command)` | `(command: string) => Promise<void> \| void` | Submits a command: `#...` dev commands are routed to `game.console.processCommand`, gameplay commands to `game.submitGameplayInput`. |
| `getMessages(options?)` | `(options?: GetConsoleMessagesOptions) => ConsoleLine[]` | Returns buffer lines from the in-game console with optional filtering. |
| `isOpen()` | `() => boolean` | Checks whether the in-game console overlay is open. |
| `open()` | `() => void` | Opens the in-game console overlay. |
| `close()` | `() => void` | Closes the in-game console overlay. |
| `toggle()` | `() => void` | Toggles the in-game console overlay. |
| `clear()` | `() => void` | Clears the console text buffer. |
| `log(text, type?)` | `(text: string, type?: ConsoleLineType) => void` | Directly writes a message into the console buffer. |

#### Message Filter Options:
```ts
type ConsoleLineType = 'output' | 'command' | 'error' | 'info' | 'dialogue';

interface GetConsoleMessagesOptions {
  afterTimestamp?: number; // Only return messages created after this timestamp (ms)
  type?: ConsoleLineType | ConsoleLineType[]; // Filter by line type
}

interface ConsoleLine {
  text: string;
  type: ConsoleLineType;
  timestamp: number;
  showInClosed?: boolean;
}
```

---

### 6. Performance Profiling (`api.performance.sample`)

Temporarily instruments the game loop for a requested duration and returns serializable timing metrics.

| Method | Signature | Description |
| :--- | :--- | :--- |
| `sample(options?)` | `(options?: PerformanceSampleOptions) => Promise<PerformanceSampleResult>` | Samples frame rate, frame durations, and section timings over `durationMs` (default: 1000 ms). |

#### Options and Return Shapes:
```ts
interface PerformanceSampleOptions {
  durationMs?: number; // Duration of sampling in ms (default: 1000)
  sections?: Array<'update' | 'render'>; // Subsections to instrument (default: ['update', 'render'])
}

interface SectionMetric {
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  count: number;
}

interface PerformanceSampleResult {
  frameCount: number;
  measuredDurationMs: number;
  fps: number;
  sections: Partial<Record<'update' | 'render', SectionMetric>>;
  frameDurations: {
    p50: number; // 50th percentile (median) frame duration in ms
    p95: number; // 95th percentile frame duration in ms
    minMs: number;
    maxMs: number;
    avgMs: number;
  };
}
```

- **Clean Restoration Guarantee**: Methods are temporarily wrapped during sampling and **always restored** in a `finally` block even if errors occur.

---

### 7. Renderer Diagnostics (`api.renderer.getDiagnostics`)

Returns a serializable snapshot of active Box3D layer rendering diagnostics, bitmap cache hit/miss counts, and command sequences.

| Method | Signature | Description |
| :--- | :--- | :--- |
| `getDiagnostics()` | `() => Box3DRenderDiagnostics` | Returns Box3D bitmap caching diagnostics, fallback reasons, visible face counts, and command sequence per layer. |

#### Diagnostic Return Shapes:
```ts
interface Box3DLayerDiagnostics {
  layer: number;
  cached: boolean; // True if layer was rendered via bitmap cache
  fallbackReason: string | null; // e.g. 'no static faces', 'unsupported blend mode', 'unavailable canvas', or null
  visibleFacesCount: number; // Number of visible Box3D faces on this layer
  bspFragmentsCount: number; // Number of BSP fragments generated
  staticBitmapCommandsCount: number; // Number of static bitmap render passes
  surfaceEntityCommandsCount: number; // Number of live attached surface entity draw passes
  commandSequence: string[]; // e.g. ['bitmap', 'miles', 'bitmap', 'Static_66', 'bitmap']
  commandSequenceSummary: string; // e.g. 'bitmap → miles → bitmap → Static_66 → bitmap'
}

interface Box3DRenderDiagnostics {
  bitmapCacheHits: number; // Accumulated cache hits
  bitmapCacheMisses: number; // Accumulated cache misses
  totalVisibleFaces: number; // Sum of visible faces across all active layers
  totalBspFragments: number; // Sum of BSP fragments across all active layers
  totalStaticBitmapCommands: number;
  totalSurfaceEntityCommands: number;
  layers: Box3DLayerDiagnostics[];
}
```

---

## Playwright / AI Agent Examples

### Example 1: Switching Modes & Loading Scenes

```ts
// Switch to Scene Editor
await page.evaluate(() => window.__QUEST_DEBUG__.api.setMode('scene-editor'));
await expect(page.locator('html')).toHaveAttribute('data-quest-mode', 'scene-editor');

// Load a specific scene and wait for ready
await page.evaluate((sceneName) => {
  return window.__QUEST_DEBUG__.api.scenes.load(sceneName);
}, 'box3d2_t.json');
```

### Example 2: Profiling Performance

```ts
// Sample performance for 2000 ms measuring update and render
const profile = await page.evaluate(() => {
  return window.__QUEST_DEBUG__.api.performance.sample({
    durationMs: 2000,
    sections: ['update', 'render'],
  });
});

console.log(`Measured FPS: ${profile.fps}, p50: ${profile.frameDurations.p50}ms, p95: ${profile.frameDurations.p95}ms`);
expect(profile.fps).toBeGreaterThan(30);
```

### Example 3: Inspecting Box3D Renderer Diagnostics

```ts
const diagnostics = await page.evaluate(() => {
  return window.__QUEST_DEBUG__.api.renderer.getDiagnostics();
});

console.log('Cache hits:', diagnostics.bitmapCacheHits, 'misses:', diagnostics.bitmapCacheMisses);
for (const layer of diagnostics.layers) {
  console.log(`Layer ${layer.layer}: cached=${layer.cached}, sequence: ${layer.commandSequenceSummary}`);
}
```

### Example 4: Modifying Object Properties Without UI Selection

```ts
await page.evaluate(() => {
  const api = window.__QUEST_DEBUG__.api;
  api.objects.setObjectProperties('hero', {
    x: 420,
    y: 260,
    opacity: 0.85,
  });
});

const heroProps = await page.evaluate(() => {
  return window.__QUEST_DEBUG__.api.objects.getObjectProperties('hero');
});
expect(heroProps.x).toBe(420);
```

### Example 5: Changing Settings & Sending In-Game Commands

```ts
// Disable CRT shader for clean automated screenshots
await page.evaluate(() => {
  window.__QUEST_DEBUG__.api.settings.setSetting('crt.enabled', false);
});

// Send gameplay action and retrieve output
const startTime = Date.now();
await page.evaluate(() => window.__QUEST_DEBUG__.api.console.sendCommand('LOOK AT DOOR'));

const messages = await page.evaluate((ts) => {
  return window.__QUEST_DEBUG__.api.console.getMessages({ afterTimestamp: ts, type: 'output' });
}, startTime);

console.log('Output:', messages.map(m => m.text).join('\n'));
```
