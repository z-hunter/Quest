# Current Status: Maintenance & Refinement

**Overview:** The core architecture for scenes, actors, and unified referencing is stable. Current efforts focus on refining the editor experience and expanding scriptable interactions.

## Recently Completed
- [x] **Object Locking:** Implemented `Alt+L` hotkey and click-through logic for locked objects in Scene Editor.
- [x] **Unified Object and Group Referencing:** Integrated `#group` syntax across all components.
- [x] **UI Layout Refinement:** Panel resizing, grouped properties, and SVG icons.
- [x] **Quad Object Documentation:** Added comprehensive details to `GDD.md`.
- [x] **Sprite Editor Fixes:** Resolved issues with saving and path handling.

## Active/Pending Tasks
- [ ] **Interaction Scripting:** Implement more complex demo scripts in `src/scripts/main.ts` to test `Subscene`, `Switch`, and `Subtrigger`.
- [ ] **Inventory System:** Basic logic for picking up items (currently `Item` component exists but full inventory UI/logic is minimal).
- [ ] **Click Occlusion Logic:** Further refine cursor behavior when multiple interactive objects overlap.

## Notes
- `context.md` has been updated to reflect the new architecture.
- Follow the **Serialization Standard** when adding new properties.
