---
type: scene-subsystem
---

# Scene interaction и camera

## Interaction

`src/scene/SceneInteraction.ts` определяет hit/hover contract: `HoverCursor` (`eye | hand | back`), activation eligibility, hover cursor и hit object. `Scene.getHitObject`, `checkHover`, `onClick`, `activateObject` связывают world coordinates с object activation.

Interaction учитывает disabled/locked state, z/depth/selection priority, inactive subscene и script-trigger semantics. Keys вида `state:*`/`state:*=` не должны ошибочно становиться click targets.

## Camera

`src/scene/SceneCamera.ts` задаёт camera centering state; Scene хранит camera/collision camera и умеет `snapCameraToPlayer()`. Collision/navigation должны использовать instantaneous collision coordinates, а не только сглаженное visual camera положение.

## Walkability

`Scene.isWalkable(x, y, sourceEntity?)` — boundary для Actor route planning. Walkbox/Collider polygons проверяются с geometry epsilon; Actor использует этот callback в grid route search и route smoothing.

Связанные: [[Scene-Core]], [[Scene-Objects]], [[Runtime-and-Rendering]].
