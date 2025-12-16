# Current Task: Refining Sprite Editor

**Objective:** Polish the Sprite Editor implementation, fixing UX issues and ensuring seamless integration with the Scene Editor.

## Status
## Status
- [x] **Fix File Loading Info:** Ensure the Sprite Editor displays the filename and resolution of the loaded image correctly.
- [x] **Fix Hotkeys:**
    - [x] `Ctrl+O` should trigger "Load Image" in Sprite Editor context.
    - [x] `Ctrl+S` should save the sprite.
    - [x] Prevent default browser actions for these shortcuts.
- [x] **Fix Navigation (F5):** 
    - [x] Ensure F5 correctly toggles *back* to Scene Editor from Sprite Editor.
    - [x] Verify F5 switches *to* Sprite Editor from Scene Editor.
- [x] **Sprite Integration:**
    - [x] Fix "Sprite" button in Properties Panel to open correct `public/sprites` folder.
    - [x] Add JSON sprite loading support to `Static` objects (Entity class).
    - [x] Implement Refactoring of Entity to remove legacy image support.
- [x] **Editor UX:**
    - [x] Implement proportional resizing (Shift+Drag) for entities.
- [ ] **Data Persistence:**
    - [ ] Make sure changes in Sprite Editor are reflected immediately if that sprite is used in the active Scene.
- [ ] **Visual Feedback:**
    - [ ] Add better visual indicators for the currently selected frame in the atlas view.

## Notes
- Completed fixes for sprite loading paths and JSON sprite support.
- Added proportional resizing to Editor.
