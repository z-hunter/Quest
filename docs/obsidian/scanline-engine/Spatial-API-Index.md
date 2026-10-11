---
type: api-index
---

# Scene и spatial API index

## `Scene`

| Метод | Контракт |
| --- | --- |
| `resolveTarget(targetStr)` | semantic/group target resolution |
| `getSpatialNodeDescriptors()` | flat descriptors for entity/subscene nodes |
| `getSpatialIndex()` | `nodeById`, children by parent, children by relation |
| `getSpatialNode(id)` | descriptor lookup |
| `getDirectSpatialChildren(nodeId, relation?)` | direct relation-scoped children |
| `getSpatialPlacementForObject(obj)` | normalized parent/relation |
| `getSpatialDescendantObjects(nodeId)` | recursive physical descendants |
| `getScaling(y)` | perspective scale at world y |
| `isWalkable(x,y,sourceEntity?)` | collision/navigation predicate |
| `getHitObject(worldX,worldY)` | interaction target |
| `checkHover(x,y)` | `HoverCursor` or null |
| `onClick(x,y)` / `activateObject(...)` | interaction dispatch |
| `toJSON()` | SceneData serialization |

## `SceneManager`

`addScene`, `switchTo`, `transferActorToScene`, `resolveEntryPlacementPosition`, `update`, `render`, `syncSceneRegistration`, `getSceneCacheStats`, `estimateSceneGraphWeight`.

## `SceneTextLayerQuery`

`getAccessState`, `getRelationDescendants`, `getRelationAccessStates`, `getTargetDescriptor`; snapshot is cached and rebuilt when Scene-derived state changes.

## `InventoryManager` scene-facing API

`handleSceneChange`, `getInventoryEntities`, `getSurfaceEntities`, `findInventoryOwnerForEntity`, `isSurfaceAccessible`, `isInventoryAccessible`, `getAccessibleSceneSurfaces`, `evaluateSurfacePlacement`, `placeEntityOnSurface`, `addInventoryEntity`, `removeEntityFromInventory`, `addEntityToSurface`, `removeEntityFromSurface`.

## `GameSemanticAPI` scene operations

`lookScene`, `lookEntity`, `examineEntity`, `describeSpatialRelation`, `takeEntityForActor`, `putEntityForActor`, `openEntityForActor`, `closeEntityForActor`, `goToScene`, `goToEntity`. Они возвращают `GameActionOutcome`, а не raw mutation result.

Связанные: [[API-Contracts]], [[Scene-Core]], [[Scene-Text-Layer]], [[Scene-Components-and-Storage]].
