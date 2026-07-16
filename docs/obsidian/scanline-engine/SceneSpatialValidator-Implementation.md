---
type: implementation
system: SceneSpatialValidator
---

# SceneSpatialValidator — реализация

Файл: `src/scene/SceneSpatialValidator.ts`.

## Result contract

Экспортирует `SceneSpatialValidationSeverity` (`error|warning`), `SceneSpatialValidationIssue` и `SceneSpatialValidationResult`. Constructor приватный; validator создаёт результат через статический entrypoint в конце файла.

## Passes

1. `indexObjects()` строит id/name/title lookup по всем Scene objects.
2. `validateSpatialReferences()` проверяет dangling parent references.
3. `validateSpatialCycles()` обходит parent chain и выявляет циклы.
4. `validateComponentConfiguration()` проверяет incompatible component payloads.
5. `validateContainerSlots()` собирает direct/external container slots и ищет duplicate relation slots.
6. `validateStorageMembership()` сопоставляет spatial membership с Inventory/Surface components.
7. `validateActorMainInventories()` проверяет actor main inventory contract.

`addIssue` нормализует severity/code/message/object context; validator не чинит graph молча — он возвращает диагностику для load/save/editor path.

## Invariants

- parent должен существовать и не создавать cycle;
- `near` не storage relation;
- один semantic anchor не получает конфликтующие duplicate slots;
- storage membership требует соответствующего component;
- Actor main inventory должен быть однозначным.

Связанные: [[Scene-Hierarchy]], [[Component-Schema]], [[InventoryManager-Implementation]].
