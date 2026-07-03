# Current Task: Optimize pathfinding for unreachable targets

## Status: COMPLETED ✅

## Summary of the implementation
- Fixed a bug where using `GO <object>` on an unreachable object could freeze/hang the game thread.
- Optimized `planApproach` in `src/systems/ActorNavigationService.ts` by capping the maximum pathfinding attempts (`actor.previewRouteTo`) at 30.
- This prevents the game from executing thousands of A* pathfinding operations over large walkboxes when no reachable point exists.
- The search still retains the original behavior for reachable targets (preferring closest to the target, then closest to the actor).

## Verification
- Added a new unit test in `tests/game/navigation-and-spatial.test.ts` verifying that `planApproach` returns `'unreachable'` in under 1000ms (typically < 20ms) when the player and target are in disconnected rooms/walkboxes.
- Ran all 531 tests in the repository: Passed.
