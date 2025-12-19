# Current Task: Implementing Actor Animation Sets

**Objective:** Implement directional sprites and animation states (idle, walk, etc.) for Actor entities, along with the necessary Editor UI to manage them.

## Status

- [x] **Core Actor Logic:**
  - [x] Add `direction` property (up, down, left, right).
  - [x] Add `animSets` structure (state -> direction sprites).
  - [x] Implement `updateSprite` to auto-select sprite based on state & direction.
  - [x] Auto-switching states (idle <-> walk) based on movement.
- [x] **Editor UI (Properties Panel):**
  - [x] Direction selector.
  - [x] Animation Set Manager (Add/Remove sets).
  - [x] File browser integration for directional sprite slots.
  - [x] **Fix:** Ensure Properties Panel correctly identifies `Actor` objects (fixed `SceneEditor` selection bug).
- [x] **Scripting API:**
- [x] **Scripting API:**
  - [x] `setDirection(dir)`
  - [x] `playAnimSet(state)`
  - [x] `resetAnimSet()`
- [x] **Serialization & Editor Integrity:**
  - [x] Implemented `animationSpeed` with serialization.
  - [x] Implemented `modelScale` persistence.
  - [x] Fixed `SceneEditor` object hydration bugs (Ctrl+V, Scale).
  - [x] Documented Serialization Standards in `context.md`.

## Notes

- `Actor` now supports complex visual states and variable animation speeds.
- Editor Copy/Paste (Ctrl+V) is fixed.
- Serialization Standards established to prevent future regression.
