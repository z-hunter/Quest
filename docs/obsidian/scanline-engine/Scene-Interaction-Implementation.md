---
type: implementation
system: SceneInteraction
---

# SceneInteraction и SceneCamera — реализация

## Pointer routing

`src/scene/SceneInteraction.ts` экспортирует `HoverCursor` (`eye|hand|back`) и функции hit/activation. Scene delegates `getHitObject`, `checkHover`, `onClick`, `activateObject` в этот routing layer.

Путь pointer:

```text
screen point → camera/world conversion
            → depth/selection priority + hitTest
            → disabled/locked/subscene/access filters
            → moveToVisual OR component/script activation
```

State-only interaction keys (`state:*`) исключаются из ordinary click/hover affordance. Portal Exit может вызвать SceneManager transition; NPC activation использует actor-aware path.

## Camera

`src/scene/SceneCamera.ts` содержит `CameraCenteringState` и helper `updateSceneCamera`. Scene различает visual `camera` и instantaneous `collisionCamera`; camera bounds/deadzone/zoom влияют на rendering, а navigation использует collision snapshot.

Связанные: [[Scene-Interaction-and-Camera]], [[SceneManager-Implementation]], [[Actor-Access-and-Navigation]].
