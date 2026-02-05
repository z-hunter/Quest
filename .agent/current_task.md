# Current Status: Maintenance & Refinement

**Overview:** The core architecture for scenes, actors, and unified referencing is stable. Current efforts focus on refining the editor experience and expanding scriptable interactions.

## Recently Completed

- [x] **Object Locking:** Implemented `Alt+L` hotkey and click-through logic for locked objects in Scene Editor.
- [x] **Unified Object and Group Referencing:** Integrated `#group` syntax across all components.
- [x] **UI Layout Refinement:** Panel resizing, grouped properties, and SVG icons.
- [x] **Quad Object Documentation:** Added comprehensive details to `GDD.md`.
- [x] **Entity Visual Properties:** Added Opacity, Blur, and Blend Mode support to Entity, Static, and Actor classes.
- [x] **Sprite Editor Fixes:** Resolved issues with saving and path handling.
- [x] **Subscene & Undo Fixes:** Resolved rendering context leaks and deep serialization issues for Undo.
- [x] **Anchor-Based Parallax:** Removed `visualOffset` and replaced it with Editor-side coordinate compensation for a smoother workflow.
- [x] **Shadow & Parallax System:** Fixed 'Inside-Out' distortion, 'Pillar' bugs, and implemented Delta Scaling for robust depth alignment.
- [x] **SceneEditor IO Refactoring:** Decoupled file I/O logic into `EditorPersistenceManager` for better modularity.
- [x] **Advanced Snapping & Y-Sorting:** Implemented horizontal grid snapping, Entity corner snapping (parallax-aware), and unified Visual Y-sorting.
- [x] **Auto-Center Fix:** Resolved keyboard movement blockage during camera auto-centering.
- [x] **Magnetic Move & Quad Paste:** Implemented magnetized whole-quad dragging and cursor-aware pasting with auto-unlocking.

## Active/Pending Tasks

- [ ] **Interaction Scripting:** Implement more complex demo scripts in `src/scripts/main.ts` to test `Subscene`, `Switch`, and `Subtrigger`.
- [ ] **Inventory System:** Basic logic for picking up items (currently `Item` component exists but full inventory UI/logic is minimal).
- [ ] **Click Occlusion Logic:** Further refine cursor behavior when multiple interactive objects overlap.

## Notes

- `context.md` has been updated to reflect the new architecture.
- Follow the **Serialization Standard** when adding new properties.
