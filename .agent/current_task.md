# Current Task: Bordering Walkbox Transitions (outside transitions)

## Status: COMPLETED ✅

## Summary of the implementation
- **Bordering Walkbox transitions:** Fixed a bug where an Actor could not transition/walk between contiguous/bordering walkboxes (such as standard Scene Walkboxes and Quad Walkbox components).
- **Strict Boundary Protection:** Implemented `Geometry.isPointInsideUnionOfPolygons` to distinguish between interior shared borders and exterior boundaries.
  - Exterior boundary checks use a strict `0.001` float epsilon, preventing the actor's collider from going outside the walkable boundaries.
  - Interior shared borders use a `2.0` pixel epsilon and require the point to be close to at least *two* different walkboxes to bridge any minor editor misalignment gaps.
- **Point Mode Strictness:** Switched Point Mode walkbox checks in `Scene.ts` to `isPointInPolygonWithEpsilon` with a strict `0.001` epsilon, preventing click target drift outside walkboxes.
- **Verification:** Updated the unit test in `tests/game/navigation-and-spatial.test.ts` to model a 1-pixel gap and verify that the Actor can transition across the shared gap, but is strictly blocked from crossing any exterior walkbox boundaries (left/right). The test suite runs and passes successfully.
