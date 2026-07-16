---
type: implementation
system: SceneRenderer
---

# SceneRenderer — render passes

Файл: `src/graphics/SceneRenderer.ts`.

`render(ctx, scene)` is the visual projection of Scene state. It resolves visual positions/parallax, orders objects by layer/depth, renders background/entities/geometry, then optional debug polygons for walkboxes/triggers and blur/effect passes.

`renderWalkboxes` and `renderDebugPolygon` are diagnostics; `renderLayer` handles object layers and sorting. SceneRenderer does not own entity state or persistence. It reads Scene and delegates entity/Quad render methods.

```text
Game.render → SceneManager.render → Scene.render(ctx)
            → SceneRenderer.render(ctx, scene)
            → Quad/Entity render + effects/debug
            → Game UI/CRT overlay
```

Связанные: [[Core-Game-Implementation]], [[Runtime-and-Rendering]], [[Parallax-Shadow-Backface]].
