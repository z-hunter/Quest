---
type: implementation
system: ComponentSystem
---

# ComponentSystem и StateEventSystem

## ComponentSystem

`src/systems/ComponentSystem.ts` — typed component helpers и низкоуровневые predicates. `AnyComponent` объединяет Subscene, Switch, Blocker, Subtrigger, Exit, Entry, Item, Actor, NPC, Inventory, Surface, State, WalkBox и visual components.

Нормализаторы: `normalizeStateComponent`, `normalizeInventoryRelation`, `normalizeSurfaceRelation`; selectors: `getInventoryComponents`, `getSurfaceComponents`, `getStateComponents`; interaction helpers: `isStateInteractionKey`, `hasClickInteractionKeys`.

State values строго проверяются как string/number/boolean; missing value получает default по valueType. State interaction keys `state:*` не считаются обычными click verbs.

## StateEventSystem

Файл: `src/systems/StateEventSystem.ts`. Тип `StateChangeSource`: `parser | script-api | llm | custom-command | string`; результат описывает changed/unchanged/error path.

State mutation flow:

```text
semantic API / script / parser
  → locate State component by id
  → normalize typed value
  → compare previous/value
  → update only on change
  → dispatch state:<id> and state:<id>=<value> bindings
  → parserNoteTextAssets / UI / scene effects observe result
```

Scene activation dispatches authored active-state events with scene-load source.

Связанные: [[Component-Schema]], [[Scene-Components-and-Storage]], [[Scripting-and-Game-API]].
