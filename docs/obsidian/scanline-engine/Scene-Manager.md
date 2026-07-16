---
type: scene-subsystem
---

# SceneManager: lifecycle, loading и transfer

Файл: `src/scene/SceneManager.ts`.

## Жизненный цикл

`SceneManager` регистрирует scenes, `switchTo(sceneId, activator?)` меняет current scene, `update(deltaTime)` и `render(ctx)` делегируют текущей сцене. `instantiateScene()` превращает JSON data в runtime Scene graph; `ensureSceneLoaded()` загружает отсутствующую сцену.

## Actor transfer

`transferActorToScene(actor, targetSceneId, options?)` переносит live Actor без cloning, включая owned descendants и inventory relations. Detach/attach обходят destructive `Scene.removeEntity` semantics; target Entry задаёт actor placement, layer/parallax/direction. После activation dispatch’ится scene-load state event.

## Cache

Manager оценивает graph weight и texture bytes, строит device memory profile, pin’ит current scene и evict’ит cached scenes при лимитах. Ключевые методы: `cacheScene`, `touchScene`, `evictScenesIfNeeded`, `getSceneCacheStats`, `estimateSceneGraphWeight`.

## Scene JSON path

`SceneManager` владеет mapping scene id/path и instantiation; отдельного `SceneLoader.ts` в текущем `src/scene` нет. Реальные fixtures лежат в `public/scenes/*.json`.

Связанные: [[Scene-Core]], [[Data-Formats-and-Assets]], [[Data-Flows]].
