# Current Task: Unified Object and Group Referencing (Completed)

**Objective:** Unify the referencing system so components can target both individual objects and groups simultaneously using a unified syntax (`#group` vs `objectID`).

## Status

- [x] **Core Reference Logic:**
  - [x] Implemented `resolveTarget` in `Scene.ts` to handle mixed lists of Groups (#) and Object IDs.
  - [x] Updated `SceneObject` to support multiple Group IDs (comma-separated).
- [x] **Editor Support:**
  - [x] Properties Panel now auto-prefixes `#` for Group ID entries.
  - [x] Updated UI labels to "Target ID(s)" for clarity.
- [x] **Component Updates:**
  - [x] **Subscene:** Now accepts mixed targets.
  - [x] **Switch:** Now accepts mixed targets for State 1 / State 2 groups.
  - [x] **Backface:** Refactored to use `resolveTarget` and work on ANY object type (not just Quads).

## Notes

- `Scene.resolveTarget` is the central helper for resolving string inputs to object lists.
- Group IDs must strictly start with `#`.
- Components can now affect arbitrary combinations of objects.
