---
type: implementation
system: Game
---

# Game — core runtime orchestration

Файл: `src/core/Game.ts`; contract: `src/core/IGame.ts`.

## Lifecycle

```text
constructor
  → create core services (SceneManager, InventoryManager, semantic API, parser, scripts)
  → start()
  → loop(timestamp)
      → update(deltaTime)
      → render()
  → stop()/destroy()
```

`update` делегирует `SceneManager.update`, editor update when enabled и `ScriptRegistry.update`; `render` делегирует scene renderer, CRT and editor overlays. Game owns canvas contexts, settings, callbacks and player-facing message bridge.

## Capability surface

`IGame` exposes semantic look/examine/take/put/open/close/go, inventory/surface APIs, state/scene access, sound, command input, file browser and UI notification methods. `Game` delegates specialized logic to `GameSemanticAPI` and `InventoryManager` rather than embedding every algorithm.

## Input/UI

`submitGameplayInput` routes text to Parser; `sayAsPlayer`/`sayAsActor` and `emitActorAction` produce dialogue/action events. `bindUI`, command input methods, inventory preview subscriptions and `onMessage` connect React to runtime.

## Rendering boundary

`rendererCanvas` is display canvas; `bufferCanvas` is internal design-resolution surface. `renderUI(CanvasRenderingContext2D)` draws runtime UI after scene render.

Связанные: [[Runtime-and-Rendering]], [[API-Contracts]], [[Parser-Implementation]], [[Script-Runtime]].
