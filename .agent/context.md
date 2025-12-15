# Project Context & Memory

## Current Focus
We are currently focusing on the **Sprite Editor** and its integration with the Scene Editor. The goal is to make it fully functional for creating and editing sprites/animations.

## Architectural Decisions
- **Framework:** React + Vite.
- **Rendering:** Hybrid approach.
    - **Game View:** HTML5 Canvas for performance (pixel manipulation, CRT effects).
    - **Editor UI:** React components overlaying the canvas (simulating retro UI).
- **State Management:** Currently local component state + direct manipulation of Game singleton. We may need to standardize this (Zustand mentioned in discussions).
- **File Format:**
    - Scenes: `.json` files.
    - Sprites: `.json` files (referencing `.png` assets).
- **Styling:** Vanilla CSS for maximum control over the retro aesthetic (pixel sorting, CRT simulation).

## Features Implemented
- **Game Engine Core:** Basic loop, canvas rendering, CRT shader simulation.
- **Scene Editor (F1):**
    - Object placement (Static, Actor, WalkBox, TriggerBox).
    - Properties panel.
    - Camera control (panning, zooming).
    - Depth scaling (pseudo-3D perspective).
    - Parallax scrolling support.
- **Sprite Editor (F5):**
    - Basic UI structure.
    - Loading images.
    - Defining frames/animations.
    - Preview window.
    - Integration with Scene Editor (switching context).

## Known Issues / Technical Debt
- **Hotkeys:** Conflicts between browser defaults and editor shortcuts (F1, F5, Ctrl+S) need careful handling.
- **Performance:** Need to keep an eye on re-renders when overlaying complex React UI over the Game Loop.
- **Scaling:** Depth scaling logic is complex; `baseWidth`/`baseHeight` recalculations when disabling depth-scaling need to be precise to avoid "popping" artifacts.

## Navigation
- **Game Mode:** The actual gameplay loop.
- **Scene Editor Mode:** Triggered by F1.
- **Sprite Editor Mode:** Triggered by F5 (accessible from Scene Editor).
