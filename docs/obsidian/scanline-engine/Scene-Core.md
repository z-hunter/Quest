---
type: scene-subsystem
---

# Scene: core model

Файл реализации: `src/scene/Scene.ts`.

## Ответственность

`Scene` владеет физическим и визуальным графом локации: entity objects, folders, triggerboxes, walkboxes, scaling, spatial index, parser-only runtime notes, interaction и frame update/render.

Ключевые данные: `id`, `name`, `entities`, `folders`, `triggerboxes`, `walkboxes`, `scaling`, `activeSubscene`, collision/camera state, text redirects, parser notes и recent parser turns.

## Основные операции

- graph: `addEntity`, `removeEntity`, `addFolder`, `addTriggerbox`, `addWalkbox`, `getAllSceneObjects`, `getObjectByName`, `findEntity`;
- spatial: `getSpatialNodeDescriptors`, `getSpatialIndex`, `getSpatialNode`, `getDirectSpatialChildren`, `getSpatialPlacementForObject`, `getSpatialDescendantObjects`;
- parser memory: `get/setParserNote`, entity parser notes, `mark*NeedsCheck`, `addParserRecentTurn`;
- scale/navigation: `getScaling`, `getCorrectionalScale`, `applyCorrectionalScaleChange`, `isWalkable`, `snapCameraToPlayer`;
- interaction/frame: `getHitObject`, `checkHover`, `onClick`, `activateObject`, `update`, `render`;
- persistence: `toJSON()`.

## Инварианты

- `Scene.entities` не содержит дублирующихся object references с одним id/name.
- Удаление entity очищает storage ownership до удаления из graph.
- `isWalkable` — единая проверка доступности для Actor navigation и collision.
- parser notes — runtime memory и не являются authored scene serialization.

Связанные: [[Scene-Objects]], [[Scene-Hierarchy]], [[Scene-Manager]], [[Data-Flows]].
