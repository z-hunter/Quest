# SaveState and Saved Games

## Contract

`SaveStateV1` is a versioned JSON runtime delta over authored scene files. Authored geometry, Text Assets, prompts and unchanged scene data remain the baseline and are not copied into every save.

Files are written to `saves/<name>.json` by the shared Vite/Tauri project-file backend. `#SAVE <name>` and `#LOAD <name>` are the diagnostic console entry points.

## Saved state

- current scene and Player position/state/inventory;
- global gameplay score;
- deltas for every loaded or previously materialized changed scene;
- NPC scene location, transform, components, memory, objectives, known entities and inventory;
- entity/component/spatial changes, including Inventory and Surface item lists;
- SceneLog and authored-object runtime changes represented by the structural JSON delta;
- revealed hidden entities, scene/entity Parser Notes, active Subscene, runtime camera and parser recent turns;
- parser pending clarification/Envelope state;
- Puppet Master action history and safe `needs_replan` markers for unfinished continuations;
- console buffer, player command history, open state and all console-controlled parser/LLM/SLM debug switches.

Timers, active pathfinding routes, Promises and raw in-flight LLM requests are never serialized. Loading first cancels active Puppet Master work, reconstructs authored scenes plus deltas, reconciles inventories, restores parser/NPC durable state, then restores the console.

## Schema and compatibility

The root carries `format: scanline`, `version`, metadata and a compatibility block. The compatibility manifest contains an authored-scene fingerprint for every scene represented in the save; a mismatched baseline is rejected instead of applying a delta to incompatible content. Loading validates the structure and manifest before mutating runtime state. Version 1 is the initial migration baseline; later formats must add an explicit migration before passing the V1 validator.

Implementation: `src/systems/saveState.ts`, `src/systems/SaveManager.ts`, `src/scene/SceneManager.ts`, `src/core/Console.ts`.
