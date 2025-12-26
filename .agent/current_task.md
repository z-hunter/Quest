# Current Task: Notifications & Smart Save (Completed)

**Objective:** Enhance the editor experience by adding non-blocking "Toast" notifications and streamlining the save workflow with "Smart Save" functionality.

## Status

- [x] **Walkbox Modes (Previous Task):**
  - [x] Implemented Add, Subtract, Invert modes.
  - [x] Updated rendering logic for proper composition.
  - [x] Added UI controls to Properties Panel.
- [x] **Notifications:**
  - [x] Replaced blocking `alert` and "Click to continue" modal with non-blocking Toast UI.
  - [x] Implemented `showMessage` in `Game.ts` to trigger toasts.
  - [x] Styled toasts to match retro aesthetic (Green border, fade out).
- [x] **Sprite Editor Improvements:**
  - [x] **Smart Save (F2):** Saves directly if `sprite.id` is valid.
  - [x] **Save As (Shift+F2):** Always prompts file browser.
  - [x] **Visualization:** Added background options (Black/Pink/Checker) and Rulers.
  - [x] Fixed "Empty Preview" bug.
- [x] **Scene Editor Improvements:**
  - [x] **Smart Save (F2):** Saves directly if `scene.id` is valid.
  - [x] **Save As (Shift+F2):** Always prompts file browser.
  - [x] Renamed "ID" label to "ID/File" for clarity.

## Notes

- The blocking interaction flow has been removed, making the editor feel much faster.
- "Smart Save" significantly reduces friction for iterative updates.
- Walkbox modes allow for complex navigation meshes (bridges, holes).
