# Current Task: Entry/Exit Implementation & Camera Snapping

## Status: COMPLETED ✅

## What was done this session

### 1. Game.ts Decomposition ✅
- **InventoryManager** moved to `src/systems/`.
- **GameSemanticAPI** extracted to `src/systems/`.
- MONOLITH reduced from 80KB to 40KB.

### 2. Universal Exit/Entry Components ✅
- Implemented `Exit` and `Entry` components working on ANY object type (Entities, Triggerboxes, Quads).
- Supported **Same-Scene Teleportation** (empty `targetSceneId`).
- Automated collision-based transitions in `ComponentSystem`.
- Verified actor transfer and state persistence (NPCs & Player).

### 3. Camera Snap ✅
- Implemented `scene.snapCameraToPlayer()` for instant positioning after transition.
- Fixed bug where camera would "stick" to old player reference after scene load.

### 4. Verification ✅
- `npm run typecheck` passed.
- `npm run test` passed: 18 files, 205 tests.
- Restored storage/semantic runtime contracts after a partial API rewrite caused PUT/DROP and inventory regressions.

## Next Steps
1. **Feature Development**: Resume gameplay features as per `GDD.md`.
2. **Architecture Audit**: Review remaining "any" casts in `ComponentSystem.ts`.
3. **Browser QA**: Optionally verify instant camera snap visually in the editor/runtime.
