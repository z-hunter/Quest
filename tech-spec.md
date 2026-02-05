# Scaline Engine Technical Specification

## 1. Architecture Overview

The Scaline Engine is built on a modern web stack designed to emulate retro aesthetics while maintaining high performance and developer ergonomics.

### 1.1 Core Stack

* **Framework**: React + Vite
* **Language**: TypeScript
* **Rendering**: Hybrid approach
  * **Game View**: HTML5 Canvas for performance (pixel manipulation, CRT shader effects).
  * **Editor UI**: React components overlaying the canvas (simulating retro UI).
* **State Management**:
  * **Engine**: Direct manipulation of a `Game` singleton.
  * **UI**: Local React state + Zustand for ephemeral editor state.

### 1.2 Design Patterns

* **Facade Pattern**: The `SceneEditor` acts as a central facade, delegating operations to specialized managers (`EditorSelectionManager`, `EditorTransformManager`, `EditorUndoManager`).
* **Descriptive Renderer**: `SceneRenderer` is a stateless function that receives a `Scene` and `Context` to draw a frame, decoupling state from presentation.

---

## 2. Engine Systems

### 2.1 Rendering Pipeline

Rendering logic is isolated in `SceneRenderer.ts`.

1. **Parallax Layers Setup**: Prepares context for different depth scales.
2. **Sorting**:
    * Entities sorted by **Layer** (Z-index equivalent).
    * Entities within layers sorted by **Visual Y** (Screen Space Depth).
    * **Unified Y-Sorting**: Stable ordering between Quads and Entities.
3. **Render Pass**:
    * **Background / Normal Layer**: Standard entities and static objects.
    * **Foreground Effects**: Blur (active during subscenes).
    * **Subscene Layer**: Highlighted interactive elements.
    * **CRT Shader**: Post-processing effect (scanlines, curvature).
4. **Debug Overlays**:
    * Walkboxes (Green=Invert, Blue=Add, Red=Subtract).
    * Triggerboxes & Selection Handles.

### 2.2 Parallax & Coordinate Systems

The engine uses a **2.5D displacement model**. Objects share World Coordinates (X,Y) but appear at different screen locations based on their Parallax Factor (`p`) and Camera Position.

#### 2.2.1 Rendering Model

* **Formula**: `VisualPos = RawPos - Camera * (P - 1)`
* **Behavior**:
  * `P = 1.0`: Standard layer. Moves 1:1 with Camera.
  * `P = 0.0`: Infinite distance (Skybox). Visual position = Raw Position + Camera.
  * `P > 1.0`: Foreground. Moves faster than camera.

#### 2.2.2 Anchor-Based Logic

* **Logic**: Parallax compensation is handled in the **Editor**.
* **Behavior**: When `p` is changed, the Editor automatically adjusts the object's X/Y coordinates to keep it visually stationay relative to the camera anchor. This replaces runtime `visualOffset`.

#### 2.2.3 Interaction Formula (Visual Consistency)

To ensure "What You See Is What You Get" during mouse interaction:

* **Relative Parallax**: Transform coordinates directly between parallax planes.
  * `Pos_New = Pos_Old + Camera * (P_Target - P_Source)`
* **Visual Alignment**: Snapping and alignment vectors are calculated in **Visual Space** (Screen Space), not Raw Space.

#### 2.2.4 Known Pitfalls

* **"Double Parallax"**: Avoid applying parallax offsets twice. If a logic block produces a Raw Coordinate but the pipeline expects Visual, apply the inverse transform.
* **Binding Inheritance**: When a vertex is bound to an object, use the **Target Object's `p`** (Effective Parallax), not the vertex's `p`.

### 2.3 Shadow System

The Shadow System manages `Actor` shadows, handling depth scaling and floor slopes.

* **Conflict**: Rigid caching prevents slope deformation; continuous regeneration forbids user-defined shapes.
* **Solution: Shape Caching (Geometric Locking)**
    1. **Cache on Acquire**: Captures the "Base Visual Shape" (vertex offsets normalized by scale) when a shadow is assigned or edited.
    2. **Deterministic Update**: Reconstructs vertices by applying current Actor Scale to cached offsets.
    3. **Result**: Prevents "Parallax Drift" (skewing/leaning) while maintaining the user's designed shape.
    4. **Invalidation**: Cache is only regenerated upon manual user edit.

### 2.4 Reactive Data Binding

To synchronize high-performance Game Logic with the React UI without polling overhead:

* **Smart Entities**: Properties (`x`, `y`, `width`) utilize TypeScript setters.
* **Lazy Notification**:

    ```typescript
    set x(val) {
        this._x = val;
        if (this.game.editor?.enabled) notify(); 
    }
    ```

* **Batched Updates**: `EditorSelectionManager` coalesces multiple changes into a single Zustand store update per frame via `requestAnimationFrame`.

---

## 3. Entities & Components

### 3.1 Entity Model

* **Entity**: Base class for all scene objects. Supports:
  * **Visuals**: Opacity, Blur, Blend Mode.
  * **Transform**: X, Y, Width, Height, Parallax.
* **Static**: Simple sprite-based objects.
* **Actor**: Complex entities with Directional Sprites, Animation Sets, and Shadow support.

### 3.2 Quad Objects

Generic polygon objects (`QuadObject`) for perspective geometry (walls, floors).

* **Per-Vertex Parallax**: Each vertex has independent `p`, allowing 2.5D distortion.
* **Features**: Texture mapping (not implemented yet), Color fill, "Retro Grid" mode.
* **Interpolation**:
  * **Inverse (XY -> P)**: `getParallaxAt(x, y)` uses Barycentric Interpolation to find depth at any point on the surface.
  * **Forward**: Bilinear interpolation for grid snapping.

### 3.3 Components

Objects can attach functional execution components:

* **Subscene**: Modal "close-up" view with auto-close logic.
* **Switch**: Toggles ID/Group states with required items/keys.
* **TriggerBox**: Executes scripts on `enter`, `leave`, `stay`.
* **Backface Culling**: Hides objects based on owner vertex orientation.

### 3.4 Unified Referencing

* **Syntax**: Targets can be specific IDs (`door_1`) or Groups (`#doors`).
* **Resolution**: `Scene.resolveTarget(query)` handles lookup.

---

## 4. Editor Architecture

### 4.1 UI Structure

* **Technology**: React + Zustand.
* **Components**:
  * **HierarchyPanel**: Reactive scene tree.
  * **PropertiesPanel**: Controlled components with two-way binding to Engine Objects.
  * **SpriteEditor**: Integrated asset management (Frame/Anim definition).
* **Tools**:
  * **Object Locking**: `Alt+L` (Click-through in canvas, selectable in Hierarchy).
  * **Snapping**: Zoom-aware threshold (20px), Grid edges, Entity corners.

### 4.2 Application Shortcuts

| Key | Action |
| :--- | :--- |
| **F1** | Scene Editor |
| **F5** | Sprite Editor |
| **F9** | Settings |
| **Alt + D** | Toggle "Disabled" state |
| **Alt + L** | Toggle "Locked" state |
| **Ctrl + Z** | Undo |
| **Ctrl + Y** | Redo |
| **Ctrl + C/V** | Copy / Paste |
| **Del** | Delete selected object |
| **Space** | Select Scene (when over canvas) |

---

## 5. Coding Standards & Flows

### 5.1 Serialization Standard

* **Single Source of Truth**: `fromJSON` / `toJSON` methods in the Class definition.
* **Factory Pattern**: Loaders must use `Class.fromJSON(data)`.
* **Extension Rule**: Adding a property requires updates to:
    1. Class Property
    2. Constructor
    3. `toJSON`
    4. `fromJSON`
    5. Editor UI Component

### 5.2 State Management

* **Engine State**: Mutable. Modifications should verify if `game.editor.enabled` to trigger UI sync.
* **UI State**: Immutable (React/Zustand). Updates react to Engine triggers.

---

## 6. Roadmap

### 6.1 Immediate Term (Editor Polish)

* [ ] **Prefab System**: Save/Load object templates.
* [ ] **Interaction Scripting**: Expand demo scripts for `Subscene`/`Switch`.

### 6.2 Medium Term (Engine Features)

* [ ] **Asset Database**: Centralized manifest to prevent duplicate loading.
* [ ] **Typed Signals**: Replace `EventListener` with lightweight Signals.
* [ ] **Inventory System**: Expand `Item` component into full UI/Logic system.

### 6.3 Long Term (Architecture)

* [ ] **ECS Migration**: Partial move to Entity-Component-System for complex scenes.
* [ ] **Virtual Scripting VM**: Sandboxed execution for user scripts.
