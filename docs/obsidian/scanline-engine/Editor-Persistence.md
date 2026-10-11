---
type: implementation
system: editor-persistence
---

# Editor persistence и authoring schema

`EditorPersistenceManager` сериализует SceneData и subclass `toJSON()` outputs. `SceneObject.SERIALIZABLE_PROPS` задаёт базовый whitelist; Entity/Actor/Quad расширяют его, а runtime-only state (scene refs, interaction lock, parser notes, owner pointers, animation queues) не должен попадать в authored JSON.

## Round trip

```text
editor graph
  → subclass toJSON
  → SceneData JSON (scenes/prefabs/sprites)
  → SceneManager.instantiateScene
  → class constructors + load(data)
  → ComponentSystem normalization
  → InventoryManager hydration
  → SceneSpatialValidator diagnostics
```

## Stability rules

- Preserve stable `name`/id references used by spatial parentNodeId, vertex bindings, groups and scripts.
- Serialize `Set` values as arrays and normalize back during load.
- Treat missing optional fields through class defaults, not undefined runtime branches.
- Validate storage/spatial graph after load and before save.

Связанные: [[Data-Formats-and-Assets]], [[SceneSpatialValidator-Implementation]], [[SceneManager-Implementation]], [[UI-and-Editor]].
