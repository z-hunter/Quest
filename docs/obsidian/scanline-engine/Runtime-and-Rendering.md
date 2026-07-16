---
type: runtime
---

# Runtime и рендеринг

## Цикл `Game`

`Game.start()` запускает animation loop; `loop(timestamp)` вычисляет время и вызывает `update(deltaTime)`, затем `render()`. `stop()` и `destroy()` освобождают runtime. В `Game.ts` отдельно хранятся `rendererCanvas` и `bufferCanvas`: design-resolution buffer масштабируется в display canvas.

## Render path

```text
Game.render()
  → SceneRenderer
      → scene entities / visual depth / parallax
      → subscene and effect passes
  → optional CRTFilter
  → Game.renderUI(CanvasRenderingContext2D)
```

Основные файлы: `src/core/Game.ts`, `src/graphics/SceneRenderer.ts`, `src/graphics/CRTFilter.ts`, `src/scene/SceneCamera.ts`, `src/core/Resolution.ts`, `src/core/Animator.ts`.

## Системы кадра

`ActorNavigationService` и `ActorWorldQuery` обслуживают движение и проверку доступности; `ThreeDParallaxSystem`, `ShadowSystem`, `BackfaceSystem` влияют на визуальный результат; `SoundManager` и `AudioManager` работают с аудио-состоянием. `StateEventSystem` доставляет события изменения состояния.

## API/UI bridge

`Game` предоставляет `onMessage`, `onSceneChange`, `subscribeInventoryUi`, методы inventory preview и управление command input. Это явные точки синхронизации с React, а не общий mutable Zustand-store для runtime.

Связанные заметки: [[Architecture]], [[Scenes-and-Spatial-Model]], [[UI-and-Editor]].
