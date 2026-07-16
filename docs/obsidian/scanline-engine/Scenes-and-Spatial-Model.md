---
type: subsystem
---

# Scenes, entities и spatial model

## Состав

`Scene` (`src/scene/Scene.ts`) хранит граф объектов, camera и scene interaction. `SceneManager.ts` загружает/переключает сцены. `SceneSubscene.ts` задаёт вложенные части пространства; `SceneSpatialValidator.ts` проверяет связи.

Runtime entities: `Entity`, `Actor`, `SceneObject`, `QuadObject`, `PolygonObject`, `Folder`, `Triggerbox`, `Walkbox` в `src/entities/*`. Components типизированы в `src/systems/types.ts` и обрабатываются `ComponentSystem.ts`.

## Два представления пространства

```text
raw spatial graph (.spatial.parentNodeId + relation)
                 ↓
SceneTextLayer semantic projection
                 ↓
parser context / player-facing descriptions
```

`SceneTextLayer.ts` сворачивает безымянные технические узлы к ближайшему озаглавленному semantic anchor. Это предотвращает утечку internal ids в текст и parser.

## Семантические операции

`Game`/`GameSemanticAPI` выполняют `look`, `examine`, `take`, `put`, `open`, `close`, переходы и inventory operations. `InventoryManager.ts` поддерживает отношения Inventory/Surface и синхронизирует scene visibility/spatial state. Parser не должен менять raw graph напрямую.

Связанные заметки: [[Data-Formats-and-Assets]], [[Parser-and-AI]], [[Scripting-and-Game-API]].

Детальная карта Scene: [[Scene-Core]], [[Scene-Objects]], [[Scene-Hierarchy]], [[Scene-Manager]], [[Scene-Components-and-Storage]], [[Scene-Text-Layer]], [[Scene-Interaction-and-Camera]].
