---
type: implementation
system: SceneManager
---

# SceneManager — реализация

Файл: `src/scene/SceneManager.ts`.

## Ownership

SceneManager владеет registry/cache сцен, current scene, transition lifecycle, actor transfer и адаптивным memory budget. `Scene` владеет собственным graph; Manager не дублирует entity model.

## Load pipeline

```text
scene id
  → ensureSceneLoaded
  → instantiateScene(id, data, path)
  → create Scene + instantiate Entity/Actor/Quad/Polygon/Folder
  → syncSceneRegistration
  → cache/pin current scene
  → InventoryManager.handleSceneChange
  → StateEventSystem scene-load dispatch
```

`syncSceneRegistration(scene, previousId?, sourceData?)` обновляет registry/path metadata. `getScenePathFromScene` восстанавливает authored path для persistence/cache.

## Transition

`switchTo(sceneId, activator?)` выбирает target; с Actor вызывает `transferActorToScene`. Transfer собирает actor, spatial descendants и storage-owned entities, detach’ит их без destructive `Scene.removeEntity`, attach’ит в target и применяет Entry placement. Затем `finalizeSceneActivation` обновляет current scene, hydration, camera и state events.

## Cache algorithm

Manager считает graph weight (`estimateSceneGraphWeight`), sprite texture bytes и total weight units. Device memory profile определяет budget; current/pinned сцена не evict’ится. `touchScene` обновляет recency, `evictScenesIfNeeded` вызывает `evictScene` для старых unpinned entries.

Публичный diagnostic API: `getSceneCacheStats`, `exposeEntitiesToWindow`.

Связанные: [[Scene-Manager]], [[Scene-Components-and-Storage]], [[Data-Flows]].
