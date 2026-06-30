# Scanline Engine Technical Specification

## 1. Architecture Overview

The Scanline Engine is built on a modern web stack designed to emulate retro aesthetics while maintaining high performance, developer ergonomics, and supporting complex semantic text-parsing gameplay.

### 1.1 Core Stack

- **Framework**: React + Vite
- **Language**: TypeScript
- **Rendering**: Hybrid approach
  - **Game View**: HTML5 Canvas for performance (pixel manipulation, CRT shader effects).
  - **Editor UI**: React components overlaying the canvas (simulating retro UI).
- **State Management**:
  - **Engine**: Direct manipulation of a `Game` singleton (recently decomposed to delegate logic to specialized systems).
  - **UI**: Local React state + Zustand for ephemeral editor state.

### 1.2 Design Patterns

- **System Decomposition**: Core logic is split from the `Game` monolith into domain-specific managers (`GameSemanticAPI`, `InventoryManager`, `Parser`).
- **Semantic-Driven**: The world model is driven by Text Assets (TA) that define semantic tags and relations, decoupled from raw visual representation.
- **Facade Pattern**: The `SceneEditor` acts as a central facade, delegating operations to specialized managers.
- **Descriptive Renderer**: `SceneRenderer` is a stateless function that receives a `Scene` and `Context` to draw a frame, decoupling state from presentation.

---

## 2. Codebase Map (Entry Points)

For new developers or AI agents, here is the functional map of the `src/` directory to quickly locate relevant subsystems:

- **`src/mechanics/`**: Text Parser, LLM Integration cascade (`Parser.ts`, LLM prompt builders).
- **`src/systems/`**: High-level gameplay logic.
  - `GameSemanticAPI.ts`: Handles all interaction semantics (`look`, `examine`, `take`, `put`, `open`/`close`).
  - `InventoryManager.ts`: Player inventory and container logic.
  - `ShadowSystem.ts`: Handles dynamic shadows.
- **`src/scene/`**: Spatial hierarchy, scene loading, and geometry.
  - `Scene.ts`: The main scene data structure and walkbox checks.
  - `SceneSpatialValidator.ts`: Enforces spatial relation rules (e.g., forbidding "near" in storage containers).
  - `SceneLoader.ts`: Loading logic for `.json` scenes.
- **`src/core/`**: Fundamental engine loops, Console UI, Text Assets, and Asset loading.
  - `Game.ts`: The central loop and state holder.
  - `Console.ts`: The in-game text console UI.
  - `TextAssetManager.ts`: Loads and caches `.json` text assets.
- **`src/entities/`**: Visual game objects (`Entity.ts`, `Actor.ts`, `QuadObject.ts`) and movement logic (`ActorMovement.ts`).
- **`src/editor/` / `src/components/`**: React-based Scene and Sprite editor UI.

---

## 3. Engine Systems

### 3.1 Navigation & Pathfinding

Actor movement (via `Actor.moveTo`) utilizes **A* (A-Star) Pathfinding** to navigate around obstacles.

- **Single Source of Truth**: The `Scene.isWalkable` method acts as the definitive collision and walkbox oracle for the grid.
- **Behavior**: It reports impossible destinations immediately and gracefully invalidates routes if movement is blocked mid-transit.

### 3.2 Rendering Pipeline

Rendering logic is isolated in `SceneRenderer.ts`.

1. **Parallax Layers Setup**: Prepares context for different depth scales.
2. **Sorting**: Entities sorted by **Layer** and **Visual Y** (Screen Space Depth) for stable ordering.
3. **Render Pass**: Normal Layer -> Subscene Layer -> CRT Shader (Post-processing).
4. **Debug Overlays**: Walkboxes, Triggerboxes & Selection Handles.

### 3.3 Parallax & Coordinate Systems

The engine uses a **2.5D displacement model**. Objects share World Coordinates (X,Y) but appear at different screen locations based on their Parallax Factor (`p`) and Camera Position.

- **Formula**: `VisualPos = RawPos - Camera * (P - 1)`
- **Interaction Alignment**: Snapping and interaction vectors are calculated in **Visual Space** (Screen Space) for WYSIWYG editing.

### 3.4 Shadow System

The Shadow System manages `Actor` shadows, handling depth scaling and floor slopes.

- **Shape Caching**: Captures the "Base Visual Shape" when a shadow is assigned, preventing "Parallax Drift" (skewing/leaning) while maintaining user-designed shapes.

### 3.5 3D Audio System

The engine features a robust spatial audio pipeline built on the Web Audio API, mapping 2.5D parallax to a 3D coordinate system.

- **Coordinate Mapping**: `Parallax 1.1` represents Z=0 (listener plane). Higher values move sources behind/above the listener (+Z), while lower values move them toward infinity (-Z).
- **Proximity EQ**: A dynamic peaking filter (+6dB at 250Hz) applies when sources are within a 100-pixel radius of the camera at parallax 1.1.
- **Convolution Reverb**:
  - **Scene Default**: Scenes can specify a global Impulse Response (IR). Attached sounds automatically inherit this acoustics unless bypassed.
  - **Dynamic Routing**: The graph (`Gain -> Convolver -> WetGain -> Master`) is dynamically rebuilt during IR hot-swaps to bypass Web Audio API's immutable buffer limitation.
  - **Distance Mix**: Dry/Wet balance is calculated frame-by-frame based on the `Reverb Drown Dist` and `Reverb Min %` settings.
- **Gain Staging**: Convolution output is trimmed by a constant factor (`REVERB_WET_OUTPUT_GAIN`) and features a brief fade-in (120ms) to avoid clipping and surges during attachment.

---

## 4. Gameplay & Semantic Systems

### 4.1 Text Parser & LLM Cascade

The game features a hybrid parser system with flexible LLM backend support:

- **Stage 1 (Deterministic)**: A fast, rule-based text parser (`Parser.ts`) handles exact matches, standard verbs, and direct interactions based on the active semantic world model.
- **Stage 2 (LLM Game Master & NPC Puppet Master)**: A fallback AI cascade processes complex player inputs and drives autonomous NPC planning (`NpcPuppetMaster.ts`).

#### LLM Provider Architecture & Local Inference

The engine abstracts LLM connectivity via the `ILlmProvider` interface, allowing seamless switching between cloud and local inference:

1. **`AnthropicProvider` (Cloud)**: Connects to Claude Haiku via API proxy (`/api/llm`). Ideal for cloud deployments or developer environments with API access.
2. **`OllamaProvider` (Local CPU)**: Targets local OpenAI-compatible endpoints (`http://localhost:11434/v1/chat/completions`). Engineered specifically for offline playability on standard CPU hardware (e.g., 16 GB RAM).
   - **Grammar-Constrained JSON Mode**: Enforces strict JSON schema compliance (`response_format: { type: 'json_object' }`), preventing parsing failures on compact 3B models.
   - **CPU Prefill Tuning**: Configured with `num_ctx: 4096` (keeping Attention KV-cache overhead quadratic calculations minimal on CPU memory bus), `keep_alive: -1` (keeping model weights permanently loaded in RAM), and a 600s timeout to safely accommodate initial cold prefill.
   - **Prompt KV-Caching**: Once the initial static scene context is prefilled, subsequent player turns execute almost instantaneously (~1.5s) via Ollama prompt cache hits.

#### Local Setup & Provider Switching Guide

To run Scanline Engine locally without internet connection or API keys:

1. **Install Ollama**: Download from `https://ollama.com`.
2. **Pull the Recommended Model**: Open your terminal and pull the compact 3B model optimized for CPU inference:
   ```bash
   ollama pull qwen2.5:3b
   ```
3. **Switch Provider in Code**:
   Both `src/mechanics/Parser.ts` and `src/core/Game.ts` feature a top-level toggle switch near the imports. Simply set `USE_LOCAL_LLM` to `true`:
   ```typescript
   // Toggle between Ollama local inference (true) and Claude Haiku cloud API (false)
   const USE_LOCAL_LLM = true;
   ```

### 4.2 Spatial Model & Semantic API

- **`GameSemanticAPI`**: Extracted from the `Game` monolith, this system handles the gameplay outcome of actor-aware semantic actions. Parser commands are one source of these actions, but the same runtime layer is also used by other actors and orchestration layers. It manages access states, reveal mechanics (e.g., examining a desk reveals hidden items inside), and item manipulation.
- **Spatial Relations**: Objects have distinct spatial relations (`in`, `on`, `under`, `behind`). The `SceneSpatialValidator` strictly enforces topology (e.g., no recursive containment, rejecting invalid `near` relations in storage configurations).

### 4.3 Text Assets (TA-Driven Model)

Descriptions, synonyms, and failure messages (e.g., `takeFailure`) are loaded from external JSON files via `TextAssetManager`. This removes hardcoded text from the engine and allows the LLM, the Parser, and other actor-aware planners to build a robust contextual world model dynamically.

---

## 5. Entities & Components

### 5.1 Entity Model

- **`Entity`**: Base class for all scene objects. Supports Transform, Visuals, and Parallax.
- **`Actor`**: Entities capable of pathfinding, animation sets, and directional sprites. Note: The engine supports treating static entities as actors via "Actor Markers" in the editor without strict inheritance breaking.
- **`QuadObject`**: Polygon objects for perspective geometry (walls, floors) with per-vertex parallax.

### 5.2 Component System

Objects can attach functional execution components.

- **Type Safety**: The `ComponentSystem` utilizes a strict `AnyComponent` union type instead of `any[]`, significantly reducing runtime errors.
- **Standard Components**:
  - `Subscene`: Modal "close-up" view.
  - `Switch`: Toggles state based on requirements.
  - `TriggerBox`: Executes scripts on overlap.
  - `InventoryContainer`: Defines capacity and spatial rules for item storage.

---

## 6. Editor Architecture

### 6.1 UI Structure

- **Technology**: React + Zustand.
- **Components**: HierarchyPanel (reactive scene tree), PropertiesPanel (two-way binding), SpriteEditor.
- **Tools**: Object Locking (`Alt+L`), Snapping (Grid edges, Entity corners).

### 6.2. Dynamic Tooltip System

The Editor's Properties Panel uses a centralized, dynamic tooltip injection system to maintain consistency and allow for easy global updates of field descriptions.

- **Registry**: All tooltips are defined in `src/components/editor/properties/propertiesConstants.ts` within the `PROPERTIES_LABEL_TOOLTIPS` record.
- **Injection**: The `PropertiesPanel.tsx` component runs a side-effect that scans all `label.e-label` elements. It matches their text content against the registry and injects the corresponding `title` attribute.
- **Convention**: Developers should **not** manually add `title` attributes to labels in specific property components (like `SceneProperties.tsx`). Instead, the label text must match an entry in the registry to receive a tooltip and the associated `e-tooltip-label` CSS styles (help cursor, hover color).
- **Normalization**: The system includes a `normalizeTooltipLabelText` helper to handle common variations and prefixes (e.g., stripping "Mode:" or handling "Opacity").

### 6.3 Standard Buttons & Hotkey Styling (`.e-btn`)

To maintain visual cohesion, standard button elements in the editor panels utilize the `.e-btn` (or `.e-button`) class.

- **Convex 3D Styling**: Buttons feature a subtle 3D bevel effect using a light top inset highlight and a soft bottom drop shadow:
  `box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 2px 3px rgba(0, 0, 0, 0.6);`
- **Muted Borders**: Instead of the bright primary green, standard buttons use a dedicated muted border variable:
  `border: 1px solid var(--ui-btn-border-muted, #387d60);`
  This places their borders midway in brightness between the active UI accent green and the dark unselected input borders.
- **Embedded Hotkey Badges**: Standard buttons support embedding a hotkey indicator on the left using the `.hotkey-accent` helper class:
  ```html
  <button class="e-btn">
    <span class="hotkey-accent">[</span> SET START
  </button>
  ```
  - **Color Contrast**: Inside `.e-btn`, hotkey characters are automatically styled with a dark green color (`#2a5c43`) to prevent them from blending into the button's bright green text.
  - **Hover/Active States**: When the button is hovered or receives the `.active-press` class (solid green fill with black text), the hotkey color automatically resets to black (`#000`) to remain readable.
- **Keypress Feedback (`.active-press`)**: To visually reflect keyboard trigger actions, buttons (both `.e-btn` and `.e-menu-btn`) should receive the `.active-press` class for `150ms` upon keyboard hotkey detection.

---

## 7. Coding Standards & Flows

### 7.1 Serialization Standard

- **Single Source of Truth**: `fromJSON` / `toJSON` methods in the Class definition.
- **Adding Properties**: Define the property, add to `SERIALIZABLE_PROPS`, and implement logic in `load(data)` if side effects are required.

### 7.2 State Management

- **Engine State**: Mutable. Modifications verify `game.editor.enabled` to trigger UI sync.
- **UI State**: Immutable (React/Zustand). Updates react to Engine triggers.

---

## 8. Scripting API

The engine supports a hot-reloadable scripting system for gameplay logic and debug tools.
For a complete beginner's tutorial (including "How to Create Your First Script") and the full API Reference, see the dedicated document:

**[Read the Scripting System Guide](ScriptSys.md)**

---

## 9. Native Application Build (Tauri)

The Scanline Engine can be compiled into a standalone native application using Tauri, allowing it to run without a separate web backend.

### 9.1 Architecture and Interaction

- **Tauri Shell**: The application is a Vite/React project running inside a Tauri webview shell.
- **File System Adapter**: All editor file operations (read, save, delete, list) are abstracted through `src/platform/fileApi.ts`. This adapter dynamically switches between Vite's dev middleware and Tauri's native Rust commands.
- **Rust Backend**: The `src-tauri` directory implements a Rust backend containing commands for managing project files and opening folders natively in the OS Explorer.

### 9.2 Path Resolution and Portability

- **Executable-Relative Paths**: In release builds, path resolution in `src-tauri/src/main.rs` is specifically modified to use `std::env::current_exe()` rather than development-time macros like `CARGO_MANIFEST_DIR`.
- **Autonomy**: This ensures the packaged editor/game can read and write files (e.g., the `public/` directory) relative to the final `.exe` location, guaranteeing true portability across systems.

### 9.3 Windows Build Specifics

- **Icon Configuration**: To successfully generate MSVC installers on Windows, the icon array must be explicitly defined in `tauri.conf.json` within the bundle block (e.g., `"icon": ["icons/icon.ico"]`). Omitting this will cause a `failed to bundle project` error.
- **Build Artifacts**: Running `npm run tauri:build` generates `.msi` installers and `.exe` (NSIS) standalone executables located in `src-tauri\target\release\bundle\`.

### How to build

``bash
npm install -D @tauri-apps/cli

```

3. Then run:

```bash
npm run tauri:dev
```

For a desktop package:

```bash
npm run tauri:build
```

### 9.4 Requirements & Limitations

- **Tooling**: Requires Node.js, Rust/Cargo, and the Tauri CLI.
- **Workspace Model**: It is recommended to transition from the current implicit root directory logic to an explicit **workspace model** to robustly handle paths in the packaged player and editor.
- **Static Hosting**: The advanced Editor features (Scene & Sprite editing) require a local backend (Vite middleware or Tauri) to save files. They will be disabled or non-functional if hosted on a standard static web server.
