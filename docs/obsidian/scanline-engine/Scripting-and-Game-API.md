---
type: api
---

# Scripting и Game API

## Script system

`ScriptRegistry.ts`, `ScriptAPI.ts`, `scripts/loader.ts`, `scripts/main.ts` связывают authored scripts с runtime. Примеры и тестовые скрипты лежат в `src/scripts/game`, `src/scripts/demos`, `src/scripts/tests`.

## Семантический API

`Game.ts` и `GameSemanticAPI.ts` предоставляют единый контракт для parser, NPC и scripts:

| Область | Методы/точки |
| --- | --- |
| input/feedback | `submitGameplayInput`, `log`, `showMessage`, `showNotification`, `text` |
| inspect | `lookScene`, `lookEntity`, `examineEntity`, `describeSpatialRelation` |
| inventory | `getInventoryEntities`, `addInventoryEntity`, `removeEntityFromInventory`, `showInventory` |
| placement | `getSurfaceEntities`, `addEntityToSurface`, `putEntity`, `removeEntityFromSurface` |
| navigation | `goToScene`, `goToEntity` |
| container | `openEntity`, `closeEntity`, `closeFocusedView` |
| UI bridge | `subscribeInventoryUi`, preview methods, command focus |

Контракт возвращает структурированные `GameActionOutcome` и player-facing text. Изменение мира должно идти через эти операции, чтобы сохранялись inventory, visibility, spatial и UI invariants.

Связанные заметки: [[Parser-and-AI]], [[Scenes-and-Spatial-Model]], [[Runtime-and-Rendering]].
