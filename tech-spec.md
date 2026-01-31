# Quest Engine Technical Specification

## 1. Architecture Overview (Current)

The engine architecture has undergone significant refactoring to separate concerns, improve maintainability, and ensure UI reactivity.

### 1.1. Scene Editor Decomposition
The monolithic `SceneEditor` class has been decomposed into specialized managers using a **Facade Pattern**.

*   **`SceneEditor.ts` (Facade)**: The central entry point. calls are delegated to specific managers. It holds the shared state (reference to Game, generic Input handlers).
*   **`EditorSelectionManager.ts`**: Handles object selection logic (Scene, Settings, Entities), exclusive selection rules, and **Reactive Notifications**.
*   **`EditorTransformManager.ts`**: Handles mouse interaction in the canvas (Drag, Resize, Gizmos).
*   **`EditorUndoManager.ts`**: Manages the Undo/Redo stack (Command Pattern).
*   **`EditorUI.ts`**: Manages DOM overlays and event listeners for the non-React parts of the UI (Context menus, Hierarchy updates).

```mermaid
classDiagram
    class SceneEditor {
        +enabled: boolean
        +selectObject(obj)
    }
    class EditorSelectionManager {
        -selectedObject
        +notifyObjectChanged()
    }
    class EditorTransformManager {
        +onMouseDown()
        +onMouseMove()
    }
    class EditorUndoManager {
        +undo()
        +saveState()
    }
    
    SceneEditor --> EditorSelectionManager
    SceneEditor --> EditorTransformManager
    SceneEditor --> EditorUndoManager
```

### 1.2. Rendering Pipeline
Rendering logic was extracted from `Scene.ts` into a dedicated **Descriptive Renderer**.

*   **`SceneRenderer.ts`**: Stateless renderer. Receives a `Scene` and `Context` and draws the frame.
*   **Pipeline**:
    1.  **Background Color/Image**
    2.  **Parallax Layers** (Sorted by Z-index/Layer ID)
    3.  **Entities** (Sorted by Y-coordinate for pseudo-3D capability)
    4.  **Foreground Effects** (Blur, Scanlines - via `SceneRenderer.renderBlurEffect`)
    5.  **Debug Overlays** (Walkboxes, Colliders - only if Editor enabled)

### 1.3. Reactive Data Binding (Zero-Cost Observations)
To synchronize Game Logic (Scripts/Physics) with Editor UI without polling overhead:

*   **Smart Entities**: `Entity.ts` uses TypeScript Getters/Setters for mutable properties (`x`, `y`, `parallax`, `width`, `height`).
*   **Lazy Notification**:
    ```typescript
    set x(val) {
        this._x = val;
        // Check avoids cost when playing game logic
        if (this.game.editor && this.game.editor.enabled) { 
             notify() 
        }
    }
    ```
*   **Batched Updates**: `EditorSelectionManager` uses a dirty flag and `requestAnimationFrame` to coalesce multiple property changes into a single Zustand Store update per frame.

---

## 2. Roadmap & Future Tasks

### 2.1. Immediate Term (Editor Polish)
*   [ ] **React-based Hierarchy**: Currently `EditorUI.refreshHierarchy` builds HTML via string concatenation. Migrate this to a pure React component (`HierarchyPanel.tsx`) consuming the `useEditorStore`.
*   [ ] **Controlled Components for Properties**: The Properties Panel currently relies on direct DOM manipulation (`input.value = ...`). Refactor to use React Controlled Components synced with `useEditorStore` versioning for smoother two-way binding.
*   [ ] **DOM Element Caching**: In `EditorUI`, cache references to frequently accessed DOM elements (like property inputs) to avoid `document.getElementById` thrashing.

### 2.2. Medium Term (Engine Features)
*   [ ] **Asset Database**: Centralized manifest for all assets (sprites, sounds) to prevent duplicate loading and allow preloading strategies.
*   [ ] **Typed Signals/Events**: Replace ad-hoc EventListeners with a lightweight Signals implementation for internal engine communication (e.g., `onSceneChange`, `onEntityDestroy`).

### 2.3. Long Term (Architecture)
*   [ ] **ECS Migration (Partial)**: The current `Entity` + `Components` array is a hybrid. Moving towards a stricter Entity-Component-System could improve performance for complex scenes (systems iterating over arrays of components rather than objects).
*   [ ] **Virtual Scripting VM**: Isolate user scripts from the engine core to prevent crashes and allow for sandboxed execution (e.g., `yield` support for cutscenes).

## 3. Editor Subsystems

### 3.1. Undo/Redo System
The `EditorUndoManager` implements a stack-based history system (Command Pattern variant) to safely handle state restoration.

*   **State Snapshots**: The system serializes the entire scene state (`scene.toJSON()`) onto a history stack for every undoable action.
*   **Buffer Limit**: A `MAX_HISTORY` constant (currently 10) enforces a fixed buffer size. Oldest states are shifted out when the limit is reached to manage memory.
*   **Double-Stack**:
    *   `undoStack`: Holds past states.
    *   `redoStack`: Holds future states (popped from undo).
    *   *Note*: Pushing a new state to `undoStack` automatically clears the `redoStack`.
*   **Bug Fix (Double-Undo)**: Object creation flows must ensure `saveUndoState()` is called exactly once. Redundant calls in `EditorTransformManager` were removed in favor of the initial setup in `SceneEditor`.

### 3.2. Toolbar & UI Composition
The Editor Toolbar is implemented as a modular React component, decoupled from specific panels.

*   **`EditorToolbar.tsx`**: A pure functional component containing actions for Save, Load, Undo, Redo, Copy, Paste, and Delete.
*   **Integration**: Primarily rendered within `HierarchyPanel.tsx`. It connects to the `EditorFacade` methods (`game.editor.undo()`, etc.).
*   **Redo Button**: Implemented visually using the `undoIcon` with a CSS transform (`scaleX(-1)`) to minimize asset usage.

### 3.3. Notification System (Toast vs Console)
The engine distinguishes between Editor Feedback and System Logs to prevent UI clutter.

*   **Toast Notifications (`game.showNotification`)**:
    *   **Usage**: Immediate, ephemeral feedback for editor actions (e.g., "Undo (-1)", "Saved").
    *   **Implementation**: `UIOverlay.tsx` renders these. Crucially, messages are Objects `{ id: number, text: string }`. The unique `id` (timestamp) is used as a React `key` to force the component to re-mount. This is required to reliably restart the CSS `fadeOut` animation for sequential identical messages.
*   **System Console (`game.onMessage`)**:
    *   **Usage**: Persistent log for script errors, debug info, or game logic events.
    *   **Implementation**: Renders to the scrollable Console Overlay.
