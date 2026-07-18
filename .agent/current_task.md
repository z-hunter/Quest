# Current Task: Fix Save Compatibility Hash Mismatch on Load

## Status: COMPLETED ✅

## Summary of the implementation
- **Root Cause Identified**: The `SaveManager` computes scene compatibility hashes based on `source.authored` data. When a scene was saved or updated in the editor, the raw data on disk was successfully updated. However, the in-memory `SceneManager.authoredSceneData` cache kept the stale pre-edited scene data due to a guard `!this.authoredSceneData.has(sceneId)` in `syncSceneRegistration`.
- **Precedence Mismatch**: Because `getSaveSceneSources()` prioritizes `this.authoredSceneData.get(id)` over `descriptor?.sourceData`, the game save process calculated the fingerprint against the stale authored data, writing the old hash to the save file. Upon reloading the game, the freshly-read file on disk computed the new correct hash, triggering a `Save is incompatible with authored scene` error.
- **Fixed Cache Updating**:
  - Added an optional `updateAuthored` parameter (defaulting to `true`) to `syncSceneRegistration` in `src/scene/SceneManager.ts`.
  - Allowed updating `this.authoredSceneData` if `updateAuthored` is `true`.
  - Passed `updateAuthored: false` when calling `syncSceneRegistration` during save-game restoration (`restoreSavedScenes`), as we only want to register restored runtime data without overwriting the clean authored ground truth.
  - Editor persistence and scene loads update the authored cache cleanly.

## Verification
- Added a new unit test in `tests/systems/save-manager.test.ts` to verify the cache update behavior under different parameters.
- Ran all Vitest tests (`npm test`): Passed (651 tests).
