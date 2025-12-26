# Project Context & Memory

## Current Focus

We have successfully implemented **Actor Animation Sets** and **Directional Sprites**. The focus is now shifting towards **Game Logic & Scripting** to utilize these new capabilities effectively (e.g. interacting with triggers, changing states via script).

## Architectural Decisions

- **Framework:** React + Vite.
- **Rendering:** Hybrid approach.
  - **Game View:** HTML5 Canvas for performance (pixel manipulation, CRT effects).
  - **Editor UI:** React components overlaying the canvas (simulating retro UI).
    - **Notifications:** Non-blocking "Toast" notifications for feedback (e.g. "Saved successfully").
- **State Management:** Currently local component state + direct manipulation of Game singleton. We may need to standardize this (Zustand mentioned in discussions).
- **File Format:**
  - Scenes: `.json` files.
  - Sprites: `.json` files (referencing `.png` assets).
- **Styling:** Vanilla CSS for maximum control over the retro aesthetic (pixel sorting, CRT simulation).
- **Serialization Standard:**
  - **Single Source of Truth:** `fromJSON` / `toJSON` in the Class.
  - **Factory Pattern:** Editors/Loaders must use `Class.fromJSON(data)` instead of manual reconstruction.
  - **Extension Rule:** Adding a property requires updates to: Class, Constructor, `toJSON`, `fromJSON`, and Editor UI.

## Features Implemented

- **Game Engine Core:** Basic loop, canvas rendering, CRT shader simulation.
- **Scene Editor (F1):**
  - Object placement (Static, Actor, WalkBox, TriggerBox).
  - **Walkbox Modes:** Invert (Standard), Add (Bridge), Subtract (Hole).
  - Properties panel with **Smart Save (F2)** and **Save As (Shift+F2)**.
  - Camera control (panning, zooming).
  - Depth scaling (pseudo-3D perspective).
  - Parallax scrolling support.
  - **Actor Animation Sets:**
    - Directional sprites (Up, Down, Left, Right).
    - State management (Idle, Walk, Custom).
    - UI for managing Animation Sets.
- **Sprite Editor (F5):**
  - Basic UI structure.
  - Loading images.
  - Defining frames/animations.
  - Preview window with backgrounds and rulers.
  - **Smart Save (F2)** integration.
  - Integration with Scene Editor (switching context).

## Known Issues / Technical Debt

- **Hotkeys:** Conflicts between browser defaults and editor shortcuts (F1, F5, Ctrl+S) need careful handling.
- **Performance:** Need to keep an eye on re-renders when overlaying complex React UI over the Game Loop.
- **Scaling:** Depth scaling logic is complex; `baseWidth`/`baseHeight` recalculations when disabling depth-scaling need to be precise to avoid "popping" artifacts.

## Navigation

- **Game Mode:** The actual gameplay loop.
- **Scene Editor Mode:** Triggered by F1.
- **Sprite Editor Mode:** Triggered by F5 (accessible from Scene Editor).
