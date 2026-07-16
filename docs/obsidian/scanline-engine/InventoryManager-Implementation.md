---
type: implementation
system: InventoryManager
---

# InventoryManager — реализация storage

Файл: `src/systems/InventoryManager.ts`.

## Hydration

`handleSceneChange()` восстанавливает runtime ownership после загрузки/transition: component item ids сопоставляются с entity candidates, deduplicate’ятся, затем `syncInventoryEntitySceneState`/surface hydration обновляют `visible`, spatial relation и owner reference.

Если spatial `in` указывает на object без Inventory component, это не считается inventory membership: entity остаётся видимой и ownership разрывается.

## Storage indexes

Manager строит relation-aware store keys и ищет owners через `findInventoryOwnerForEntity`. Поддерживаемые effective relations: `in`, `on`, `under`, `behind`; `near` исключён.

Доступность проверяется через `isInventoryAccessible`, `isSurfaceAccessible`, anchor variants и active-subscene/group rules. `getAccessibleInventoryItems`/`getAccessibleSceneSurfaces` готовят candidates для parser/API.

## Surface placement

`getSceneObjectReferencePoint`, `getSurfaceBounds`, `evaluateSurfacePlacement` и `placeEntityOnSurface` вычисляют footprint с учётом Entity размера/scale, Quad/polygon geometry, relation и subscene item scale. Placement возвращает диагностируемый результат, а не только boolean.

## Mutation boundary

`addInventoryEntity`/`removeEntityFromInventory` и `addEntityToSurface`/`removeEntityFromSurface` — единственные безопасные mutation gateways. Они синхронизируют component refs, Scene graph, hidden/visible state, owner pointers, group inheritance и UI notification.

Связанные: [[Scene-Components-and-Storage]], [[Scene-Hierarchy]], [[Spatial-API-Index]].
