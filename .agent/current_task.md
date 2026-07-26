# Current Task: Optimize Local Teleport Routing & Handle Accidental Portal Triggers

## Status: COMPLETED ✅

## Summary of the Implementation
- **Portal-First Routing**: Integrated same-scene `Exit` -> `Entry` local teleport planning in `Actor.moveTo` and `ActorNavigationService.planLocalTeleportRoute`. When direct A* is blocked or suboptimal, local teleports are evaluated first before running expensive whole-scene A*.
- **A* Search Space & Performance Optimization**:
  - Bound A* iteration limits to prevent main-thread UI freezes on unreachable targets.
  - Added Euclidean distance heuristic pruning in `planLocalTeleportRoute` to eliminate distant (2100px) sub-optimal exits in ~0.01ms.
- **Accidental Portal Collision Handling**:
  - **Player (`isPlayer === true`)**: Local teleports remain transparent in A* (not treated as walls). If the player clicks on the floor in Zone 1 and pathfinding carries them over a local teleport into Zone 2, `resumePlannedMovementAfterLocalTeleport` checks `localTeleportTarget`. Since no intentional teleport target was set (`moveToVisual`), navigation immediately cancels upon arrival in Zone 2, leaving the player in the new area without looping back.
  - **NPCs (`isPlayer === false`)**: Local teleports act as physical obstacles (`isWalkable = false`) when an NPC paths within a single zone, ensuring NPCs walk around screen transitions without accidentally triggering them.
  - **Intentional Local Teleports**: If an Actor (Player or NPC) intentionally paths to a target in Zone 2 via `planLocalTeleportRoute`, `localTeleportTarget` is stored. After teleporting, movement automatically resumes towards the final objective.
  - **Inter-scene Exits**: Exits pointing to other scenes always act as solid obstacles for all actors.

## Verification
- Vitest suite passed: `actor-movement.test.ts` (8/8) and `navigation-and-spatial.test.ts` (32/32).
- Git commit created: `b3242cc` (`feat(navigation): optimize local teleport routing and handle accidental portal triggers`).
