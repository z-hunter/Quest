# Current Task: Fix copy/paste hotkeys in Scene Editor text fields

## Status: COMPLETED ✅

## Summary of the implementation
- **Fixed hotkey and paste interception**: Fixed an issue in the Scene Editor where standard copy/paste hotkeys (Ctrl+C, Ctrl+V, Shift+Insert) did not work when typing inside textareas and select fields (such as "MEMORY" and "CURRENT OBJECTIVES" in the NPC properties panel).
- **SceneEditor.ts**: Updated the keydown handler `handleGlobalKey` to use the helper `isTypingInField` for copy/paste checks instead of only checking `!(document.activeElement instanceof HTMLInputElement)`. This prevents custom Scene Object copy/paste from hijacking standard browser copying/pasting in textareas.
- **EditorSelectionManager.ts**: Updated the global paste event listener `handleGlobalPaste` to return early if the active element is a textarea or select element, ensuring the browser's default paste action handles the text input instead of trying to deserialize it as a Scene Object.
- **SpriteEditor.ts**: Updated the `isInputFocused` check to also include textareas and select elements.

## Verification
- Added a new unit test suite `tests/editor/scene-editor-hotkeys.test.ts` to verify that copy, paste, and global paste handlers are not intercepted when focused on text fields (`HTMLInputElement`, `HTMLTextAreaElement`, `HTMLSelectElement`), but function correctly when no text fields are focused.
- Ran all Vitest tests (`npm test`): Passed (641 tests).
