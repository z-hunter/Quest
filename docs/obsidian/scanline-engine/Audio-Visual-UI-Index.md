---
type: api-index
---

# Runtime effects и UI API index

## Visual/effect entrypoints

- `SceneRenderer.render(ctx, scene)` — scene visual projection.
- `ThreeDParallaxSystem.update(quad, component)` — actor/floor parallax.
- `ShadowSystem.update(actor, shadow)` — shadow geometry/visibility.
- `BackfaceSystem.update(quad, component)` — layer/render culling.
- `SoundManager.play/attachSound/updateAttachedSounds/setEnvironment` — audio graph.

## React bridge entrypoints

- `GameCanvas` — canvas lifecycle/viewport host.
- `UIOverlay` — callbacks, input focus, console/file/choice/inventory bridge.
- `ConsoleOverlay` — console history/modal UI.
- `PlayerInventoryPanel` — inventory projection/arrival animation.
- `PropertiesPanel` family — typed editor property mutations.

## Ownership rule

Effects read Scene/Entity state and may update effect-owned runtime geometry/AudioNodes. React renders projections and sends commands. Game/Scene/Systems remain authoritative for world state.

Связанные: [[SceneRenderer-Implementation]], [[Audio-and-Sound-Implementation]], [[Parallax-Shadow-Backface]], [[React-UI-Data-Flow]], [[Editor-Properties-Implementation]].
