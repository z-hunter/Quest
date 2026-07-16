---
type: scene-subsystem
---

# Components, Inventory и Surface storage

## Component model

`src/systems/ComponentSystem.ts` и `src/systems/types.ts` задают `AnyComponent` union. SceneObject components описывают authored/runtime capabilities: `Inventory`, `Surface`, `Exit`, `Entry`, `Subscene`, `Switch`, `Blocker`, `State`, а также visual/interaction-related components.

`Exit` связывает сцену с `targetSceneId/targetEntryId`; `Entry` задаёт placement incoming actor. `Switch`/`Blocker` участвуют в access checks и relation blocking. `StateEventSystem` применяет state side effects при scene activation.

## InventoryManager

Файл: `src/systems/InventoryManager.ts`.

Это canonical storage layer, а не просто UI list. Он:

- hydrat’ит component item refs после scene change;
- синхронизирует `visible` и `spatial` для items;
- поддерживает Inventory/Surface/under/behind relations;
- удаляет duplicate/stale scene references;
- проверяет groups, active subscene и accessibility;
- оценивает geometry размещения на surface (`evaluateSurfacePlacement`, `placeEntityOnSurface`);
- предоставляет storage candidates и auto-drop selection.

Главные операции: `getInventoryEntities`, `getSurfaceEntities`, `addInventoryEntity`, `removeEntityFromInventory`, `addEntityToSurface`, `removeEntityFromSurface`, `handleSceneChange`, `findInventoryOwnerForEntity`.

## Ownership rule

Parser/UI/scripts вызывают GameSemanticAPI; raw component arrays не меняются напрямую. Scene graph, InventoryManager и semantic layer должны оставаться синхронными.

Связанные: [[Scene-Hierarchy]], [[API-Contracts]], [[Scripting-and-Game-API]].
