---
type: implementation
system: visual-effects
---

# Parallax, shadows и backface systems

## ThreeDParallaxSystem

`src/systems/ThreeDParallaxSystem.ts` iterates Actors over `QuadObject` floor/plane. It checks actor visual position, interpolates `quad.getParallaxAt(..., true)`, updates actor parallax and converts visual position back to world position. Shadow vertices receive the same correction.

## ShadowSystem

`src/systems/ShadowSystem.ts` resolves `shadow.triggerId` and `shadow.shadowQuadId`, tests actor visual feet against trigger/quad geometry, toggles shadow visibility and positions/scales vertices from actor scale. Static cache stores normalized shadow offsets; editor dragging invalidates cache to avoid fighting authoring.

`ShadowComponent`: `shadowQuadId`, `offsetX`, `offsetY`, `triggerId`.

## BackfaceSystem

`src/systems/BackfaceSystem.ts` compares selected quad vertices in visual space (`axis x|y`, `op >|<`). On match it either hides target (`cullingType: render`) or changes `renderLayer` (`cullingType: layer`). Optional `targetId` resolves groups/objects through Scene target resolution.

Связанные: [[Scene-Objects]], [[Scene-Interaction-Implementation]], [[Runtime-and-Rendering]].
