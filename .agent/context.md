# Project Context & Memory

## Current Focus

We have successfully implemented **Actor Animation Sets**, **Directional Sprites**, and a **Unified Referencing System**. The focus is now on **Game Logic & High-Level Mechanics**, including complex interactions via components like **Subscene**, **Switch**, and **Backface Culling**, as well as refining the **Scripting API** for more dynamic gameplay.

## Architectural Decisions

- **Framework:** React + Vite.
- **Rendering:** Hybrid approach.
- **Game View:** HTML5 Canvas for performance (pixel manipulation, CRT effects).
- **Editor UI:** React components overlaying the canvas (simulating retro UI).
- **State Management:** Direct manipulation of Game singleton + local React state for UI. Standardized via `toJSON`/`load` patterns.
- **Serialization Standard:**
  - **Single Source of Truth:** `fromJSON` / `toJSON` in the Class.
  - **Factory Pattern:** Editors/Loaders must use `Class.fromJSON(data)` instead of manual reconstruction.
  - **Extension Rule:** Adding a property requires updates to: Class, Constructor, `toJSON`, `fromJSON`, and Editor UI.
- **Unified Referencing System:**
  - Components (Subscene, Switch, etc.) use a unified syntax for targeting objects: `objectID` or `#groupID`.
  - `Scene.resolveTarget(query)` is the central utility for resolving IDs and Groups into object lists.
  - Group IDs must start with `#`.
- **Anchor-Based Parallax:**
  - Logic shifted from runtime `visualOffset` to editor-side coordinate compensation.
  - When an object's parallax changes, the editor automatically adjusts its X/Y coordinates to keep it visually stationary relative to the camera anchor.
- **Component-Based Logic:** Objects like `TriggerBox` or `Quad` can have optional components (e.g., `SubsceneComponent`, `BackfaceComponent`) that encapsulate behavior.
- **Scripting:**
  - Simplified registration in `src/scripts/main.ts`.
  - Event-based triggers: `LOOK`, `TAKE`, `USE`, `USE <ITEMID>`.
  - Global `ScriptRegistry` for user-defined logic.

- **AI & Local LLM Parser:**
  - Migrated from cloud providers to local CPU inference (Ollama / `qwen2.5:3b`) optimized for 16 GB RAM machines.
  - Hardware-enforced JSON Mode (`response_format: { type: 'json_object' }`) ensures 100% valid DSL plans without parsing errors.

## Features Implemented

- **Game Engine Core:** Basic loop, canvas rendering, CRT shader simulation. Optimized rendering context management to prevent stack leaks.
- **Scene Editor (F1):**
  - Object placement (Static, Actor, WalkBox, TriggerBox, Quad).
  - **Editor Decoupling:** File I/O operations (Save/Load) are handled by `EditorPersistenceManager` to keep `SceneEditor` focused on interaction.
  - **Advanced Snapping:** Zoom-aware (20px) threshold. Support for horizontal grid edges and Entity corners (with automatic parallax adoption).
  - **Walkbox Modes:** Invert (Standard), Add (Bridge), Subtract (Hole).
  - **Walkbox Modes:** Invert (Standard), Add (Bridge), Subtract (Hole).
  - **Quad Objects:** 4-vertex primitives with vertex-specific Parallax, Retro-Grid mode, and Sorting modes.
  - **Unified Y-Sorting:** Stable Z-ordering between Quads and Entities via consistent Visual Y calculation (Screen Space Depth).
  - **Auto-Center Fix:** Player keyboard input no longer blocked by UI hover states while Auto-Center is active.
  - **Unified Properties Panel:** Dynamic fields based on object type and components.
  - **UI Layout:** Resizable panels (extending to bottom), grouped camera/depth settings, and SVG icons.
  - **F-Key Menu:** Retro style (F1-F9) with dynamic color styling support.
- **Sprite Editor (F5):**
  - Frame/Animation definition, loading images (atlases), and interactive preview.
  - Integration with Scene Editor for quick asset iteration.
- **Entity Visuals:**
  - **Visual Effects:** Opacity, Blur, and Blend Mode support for all Entity-derived objects (Static, Actor).
  - **Alignment:** Colliders are bottom-aligned to the object's base.
- **Advanced Trigger Components:**
  - **Subscene:** Modal "close-up" view with auto-close logic.
  - **Switch:** Toggling between two groups/states with sound and key requirements.
  - **Subtrigger:** External click area for triggering other objects.
  - **Backface Culling:** Hiding or layering objects based on owner vertex orientation.
- **Object Locking:**
  - Ability to lock/unlock objects via `Alt+L` (hotkey) or Property Panel (checkbox).
  - Locked objects are transparent to mouse clicks in the Scene Editor but selectble in Hierarchy.
  - Locking only affects the editor; objects behave normally in-game.
- **Video Export Tool (vetool):**
  - Independent web application served via `vetool.html` at `/vetool.html`.
  - Frame-by-frame navigation, timeline playback loops, and customizable frame steps.
  - Interactive bounding boxes drawn directly on the video viewport with resize handles and sidebar inputs.
  - Automatic column-based grid spritesheet packaging and batch saving of PNG assets and sprite JSON configs.
  - Reuses Scanline's Vite dev server backend endpoints by adding Base64 binary decoding support to `/api/save`.

## Known Issues / Technical Debt

- **Click Occlusion:** Refinement needed for nested components or overlapping interactive areas (Cursor logic refined but complex).
- **Hotkeys:** Potential conflicts between browser and editor shortcuts; `Alt+D` implemented for toggling "Disabled" state.
- **Reference Integrity:** Deleting objects/groups does not automatically clean up references in other components (e.g., TargetID).

## Navigation & Hotkeys

- **F1:** Scene Editor
- **F5:** Sprite Editor
- **F9:** Settings
- **Alt + D:** Toggle "Disabled" state for selected objects.
- **Alt + L:** Toggle "Locked" state (Prevents selection in Canvas).
- **Ctrl + C / V:** Copy/Paste objects.
- **Del:** Delete selected object.
- **Space:** Select Scene (when over canvas).
