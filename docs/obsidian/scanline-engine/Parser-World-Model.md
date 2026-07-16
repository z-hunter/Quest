---
type: implementation
system: ParserWorldModelBuilder
---

# ParserWorldModelBuilder — context projection

Файл: `src/mechanics/ParserWorldModelBuilder.ts`.

## Ownership

Builder — read-only adapter от `Game/Scene` к `ParserWorldModel`; он не хранит authoritative world state и не мутирует entities.

## Build flow

```text
build(rawInput, pendingState)
  → buildContext
      → focused target
      → scene + recent turns
      → visible/known entity contexts
      → inventory contexts
      → typed state contexts
      → spatial nodes/relations
      → scope slices
  → ParserWorldModel
```

Контекст разделяет player-facing title, technical id, location, content (`description/details/lore`), item/take flags, hidden/access state, coordinates и semantic relations. `buildScope()` даёт slices для visible, held, takable, known и других command-specific candidate sets.

## Text/spatial boundary

`getTextVisibleSceneObjects` и SceneTextLayer отфильтровывают технические nodes; parser не получает необработанный `Scene.entities` как prompt. `buildSpatialRelations` использует semantic projection, а `getSceneObjectCoordinates` даёт actor/approach data отдельно.

## Parser memory

Scene parser note, entity parser notes и recent turns добавляются только как runtime context. Они не превращаются в authored scene schema.

Связанные: [[Scene-Text-Layer]], [[Scene-Hierarchy]], [[Parser-Implementation]], [[Parser-Cascade-Contracts]].
