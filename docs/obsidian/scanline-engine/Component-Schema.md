---
type: schema
---

# Component union и JSON-поля

Источник: `src/systems/ComponentSystem.ts`, `AnyComponent`.

| `type` | Основные поля | Роль |
| --- | --- | --- |
| `Subscene` | `targetGroupId`, `itemScale?`, `title?`, `description?` | virtual subtree |
| `Switch` | state/key ids, sounds, group ids, transparent, blockedRelation | open/close state |
| `Blocker` | transparent, blockedRelation | access gate |
| `Subtrigger` | target | nested trigger |
| `Exit` | targetSceneId, targetEntryId, collider?, portal? | transition |
| `Entry` | direction? | arrival marker |
| `Item` | ignoreDistance? | takeability |
| `Actor` | — | actor capability marker |
| `NPC` | enabled, memory, objectives, knownEntities | NPC model state |
| `Inventory` | relation, capacity, groups, protected, items | container |
| `Surface` | relation, capacity, groups, items `{id,x,y}[]` | placement container |
| `State` | id, valueType, initialValue, value, parserNoteTextAssets | typed state |
| `WalkBox` | mode `Invert|Add|Subtract` | navigation polygon mode |
| visual systems | Shadow, Backface, ThreeDParallax fields | render/effect capabilities |

`near` запрещён для storage component relations. Inventory нормализуется к `in`, Surface — к `on`, если relation отсутствует/некорректна. State values нормализуются к `string|number|boolean`; invalid value получает type default.

`ComponentSystem.isStateInteractionKey()` отбрасывает `state:*` keys при определении обычного click interaction.

Связанные: [[Scene-Components-and-Storage]], [[Scene-Hierarchy]], [[Entity-Schema]].
