---
type: scene-subsystem
---

# Иерархия и spatial graph

## Типы

`src/scene/spatialTypes.ts` определяет:

- `SpatialRelationType`: `in | on | under | behind | near`;
- `SpatialPlacement`: parent node id + relation;
- `SpatialSubsceneData`;
- `SpatialNodeDescriptor`;
- `SpatialIndex`.

`near` — proximity/visual relation; storage containers используют effective relations без `near`.

## Индексация

`Scene.getSpatialNodeDescriptors()` строит descriptors, `getSpatialIndex()` — индекс по node id, `getSpatialNode()` — lookup, `getDirectSpatialChildren()` — relation-scoped children. `Scene.getSpatialDescendantObjects()` используется для subscene/inventory traversal.

Физический graph и semantic projection различаются:

```text
SceneObject.spatial → Scene spatial index → SceneTextLayerQuery
                                         → parser/UI semantic descendants
```

Безымянные технические узлы не должны становиться player-facing anchor. `SceneTextLayer` поднимает effective relation к ближайшему titled ancestor.

## Subscene

Subscene component/trigger активирует modal subtree. Активный subscene влияет на visibility, interaction, storage accessibility и `itemScale`; `Scene` синхронизирует subscene item scales. Object внутри inactive subtree может быть известен контексту, но не обязан быть actionable.

Связанные: [[Scene-Text-Layer]], [[Scene-Components-and-Storage]], [[Scenes-and-Spatial-Model]].
