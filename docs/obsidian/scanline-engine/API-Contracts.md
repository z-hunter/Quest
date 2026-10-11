---
type: api
---

# Контракты и типы API

## Core contracts

- `IGame` (`src/core/IGame.ts`) — интерфейс, через который runtime consumers получают Game capability surface.
- `GameActionTypes.ts` — структурированные outcomes для успешных, заблокированных и уточняющих действий.
- `systems/types.ts` — union/component types для inventory, surface, switch, subscene, blocker, shadow, backface и связанных систем.
- `mechanics/parserTypes.ts` — parser envelopes, tool actions, context и scope.
- `scene/spatialTypes.ts` — spatial relations и parent-node references.

## Правило владения

```text
Scene/Game owns world state
ParserWorldModelBuilder projects read context
Parser plans/chooses actions
GameSemanticAPI mutates world
UI renders outcomes and invokes capabilities
```

Такой контракт позволяет Player, NPC и scripts использовать одни и те же проверки доступа, inventory, spatial relation и player-facing messages.

## Capability groups `Game`

`Game.ts` группирует API вокруг input/feedback, inspection, inventory, surface placement, navigation, containers, actor-aware operations и UI bridge. Для actor-пути существуют `lookEntityForActor`, `examineEntityForActor`, `takeEntityForActor`, `putEntityForActor`, `openEntityForActor`, `closeEntityForActor`.

## Неявные зависимости

- UI требует callback/подписок Game, но не должен читать private internals.
- Parser требует semantic projection, а не raw `Scene.entities` без фильтрации.
- Scripts требуют registry/API lifecycle.
- Editor persistence обязана сохранять поля, которые runtime и parser ожидают после reload.

Связанные заметки: [[Scripting-and-Game-API]], [[Scenes-and-Spatial-Model]], [[Parser-and-AI]], [[Data-Flows]].
