---
type: scene-subsystem
---

# Объекты сцены и классы

## Иерархия классов

```text
SceneObject
├─ Entity
│  ├─ Actor
│  ├─ QuadObject
│  └─ Folder
└─ PolygonObject
   ├─ Walkbox
   └─ Triggerbox
```

`SceneObject` (`src/entities/SceneObject.ts`) задаёт identity, type, disabled/locked, group id, components, interactions, spatial placement и text redirects; `toJSON()`/`load()` обслуживают общий persistence contract.

`Entity` (`Entity.ts`) добавляет координаты, sprite, scale/parallax/layer, opacity/blend, collider, visibility и inventory-position state. `Actor` добавляет direction/state/animation sets, perception и grid-based route planning (`walkTo`, `moveTo`, `moveToVisual`, `previewRouteTo`, `stop`).

`QuadObject` хранит 4 vertices с `x/y/p`, vertex bindings, sort mode и grid flags; vertices участвуют в parallax, hit testing и геометрии. `PolygonObject` хранит polygon и реализует hit test; Walkbox и Triggerbox специализируют его для навигации и scripted interaction.

## Серилизуемые поля

Реальные scene JSON содержат `type`, `name`, `x/y`, визуальные свойства, `components`, `interactions`, а для Quad — `vertices` и bindings. Полный набор определяется `toJSON()` конкретного класса, а не одним глобальным schema file.

Связанные: [[Scene-Core]], [[Scene-Components-and-Storage]], [[Data-Formats-and-Assets]].
