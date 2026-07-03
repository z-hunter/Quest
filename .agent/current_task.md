# Current Task: Optimize pathfinding and fix walk action for immediate arrivals

## Status: COMPLETED ✅

## Summary of the implementation
- **Pathfinding Optimization for Unreachable Targets**: Optimized `planApproach` in `src/systems/ActorNavigationService.ts` by capping A* pathfinding attempts at 30, preventing hangs when a target is in a disconnected walkbox.
- **Immediate Arrival & Twitching Fix**: Fixed a bug where commanding an actor to move to their current location (or a location within interaction reach when already reachable) would result in a one-frame walking animation loop ("twitching/jerking") and prevent exit transitions from triggering.
  - Modified `moveTo(x, y)` in `src/entities/Actor.ts` to check if the target destination matches the actor's current position (`Math.abs(x - this.x) < 1.0` and `Math.abs(y - this.y) < 1.0`). If so, it immediately stops and returns an `'arrived'` status (`route_completed`/`arrived`).
  - This ensures `GameSemanticAPI.goToEntity` receives `'arrived'` immediately, triggering the transition without twitching or stalling.
- **Separation of GO TO and GO THROUGH commands**:
  - `GO TO DOOR` now only makes the player walk up to the door and stop, behaving like a walk to any other normal object (e.g. `GO TO CHAIR`).
  - `GO THROUGH DOOR` is the command that makes the player walk to the door and actually execute the exit transition (teleporting them to the target scene).
  - Modified `resolveGoToTarget` in `src/mechanics/Parser.ts` to detect the `"through "` prefix. If present, it strips the prefix, resolves the exit target, and passes `{ traverseExit: true }` to `goToEntity`.
  - Modified `goToEntity` in `src/systems/GameSemanticAPI.ts`, `Game.ts`, and `IGame.ts` to accept an `options` object with a `traverseExit` boolean flag. Exit components are only activated upon arrival/immediately if `traverseExit` is `true`.
  - Modified `resolveQuitTarget` in `Parser.ts` to pass `{ traverseExit: true }` so that `QUIT THROUGH DOOR` correctly triggers the exit transition.

## Verification
- Added pathfinding unit test: Verified `planApproach` aborts instantly on unreachable walkboxes.
- Verified that in the `Corridor` scene, starting from entry `E1` (already reachable) or far away, using `GO TO DOOR` successfully transitions the player to the flat (`test_room`) without jerking, freezing, or stalling.
- Ran all TypeScript typechecks (`npm run typecheck`): Passed.
- Ran all Vitest tests (`npm test`): Passed (538 tests).
