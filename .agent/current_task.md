# Current Task: Refining Sprite Editor

**Objective:** Polish the Sprite Editor implementation, fixing UX issues and ensuring seamless integration with the Scene Editor.

## Status
- [x] **Fix File Loading Info:** Ensure the Sprite Editor displays the filename and resolution of the loaded image correctly.
- [x] **Fix Hotkeys:**
    - [x] `Ctrl+O` should trigger "Load Image" in Sprite Editor context.
    - [x] `Ctrl+S` should save the sprite.
    - [x] Prevent default browser actions for these shortcuts.
- [ ] **Fix Navigation (F5):** 
    - [ ] Ensure F5 correctly toggles *back* to Scene Editor from Sprite Editor (currently might be stuck or reloading page).
    - [ ] Verify F5 switches *to* Sprite Editor from Scene Editor.
- [ ] **Data Persistence:**
    - [ ] Make sure changes in Sprite Editor are reflected immediately if that sprite is used in the active Scene.
- [ ] **Visual Feedback:**
    - [ ] Add better visual indicators for the currently selected frame in the atlas view.

## Notes
- Recent conversation highlighted issues with `Ctrl+O` not working as expected in the Sprite Editor.
- Need to verify if the global event listener in `Game.ts` or `SceneEditor.ts` is correctly delegating input based on the active mode (`EDITOR` vs `SPRITE_EDITOR`).
