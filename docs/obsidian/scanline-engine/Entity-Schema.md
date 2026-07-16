---
type: schema
---

# EntityData и SceneObject serialization

## Общий SceneObject слой

`src/entities/SceneObject.ts` сериализует через static `SERIALIZABLE_PROPS`:

```text
name, type, locked, disabled, groupID, customName,
textRedirects, interactions, components, folder, inheritedProps,
layer, visible, hidden, spatial, parallax
```

`interactionLocked` — runtime-only transient state; `scene`, inherited object references и Sets не сериализуются напрямую. `inheritedProps` преобразуется Set ↔ array; пустой `folder`/spatial пропускается.

## EntityData

`src/entities/Entity.ts` расширяет контракт полями:

```text
type/name, groupID, x/y, width/height,
baseWidth/baseHeight, colliderWidth/colliderHeight,
spriteName, color, scale, refScale, modelScale,
layer, parallax, ignoreScaling, isPlayer, speed,
direction, state, animationSpeed, locked, disabled,
customName, components, interactions, visible,
opacity, blendMode, blur, spatial
```

Width/height и collider dimensions — derived values: base dimension × scale. Inventory-owned entity coordinates resolve через `inventoryPositionOwner`.

## ActorData

`Actor` добавляет `isPlayer`, `speed`, `perceptionRadius`, `direction`, `animSets`. Runtime movement fields (`target`, `route`, lastMoveResult) не являются authored scene schema.

## Subclass schemas

- `QuadObject`: vertices `{x,y,p,binding?}`, sortMode, color, opacity/blend, grid fields, filled, blur.
- `PolygonObject/Walkbox/Triggerbox`: polygon vertices; Walkbox mode `Invert|Add|Subtract`; Triggerbox script/components.
- `Folder`: authoring hierarchy metadata, not a physical spatial relation.

Связанные: [[Scene-Schema]], [[Scene-Objects]], [[Scene-Hierarchy]].
