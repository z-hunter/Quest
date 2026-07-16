---
type: scene-subsystem
---

# SceneTextLayer: semantic projection

Файл: `src/scene/SceneTextLayer.ts`.

## Роль

`SceneTextLayerQuery` — read-only facade над Scene graph. Он превращает physical spatial hierarchy в semantic snapshot для parser и player-facing LOOK/EXAMINE. Это не второй world model и не владелец состояния.

## Типы

- `SceneTextLayerEntry` — semantic object entry;
- `SceneTextLayerAccessState` — actionable/visible/access-blocked state;
- `SceneTextLayerSnapshot` — cached projection;
- `SceneTextTargetDescriptor` — relation-aware target;
- `ActiveBlockingComponentState` — active switch/blocker state.

## Queries

`getAccessState(object)`, `getRelationDescendants(anchorNodeId, relation)`, `getRelationAccessStates(...)`, `getTargetDescriptor(...)`. Snapshot cache invalidates through a scene-derived key and is rebuilt by `ensureSnapshot()`.

## Anchor rule

Titled objects are semantic anchors. Untitled technical nodes collapse upward; effective relation is the first meaningful edge from nearest titled ancestor. Direct semantic descendants ограничивают LOOK/EXAMINE и не раскрывают технических grandchildren.

## Access

Projection учитывает inactive subscene, switch/blocker, hidden/revealed flags, storage accessibility и interaction locks. Поэтому parser context должен строиться через `ParserWorldModelBuilder`/SceneTextLayer, а не через прямой dump `Scene.entities`.

Связанные: [[Scene-Hierarchy]], [[Parser-and-AI]], [[API-Contracts]].
