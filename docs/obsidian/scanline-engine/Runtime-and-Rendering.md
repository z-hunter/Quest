---
type: runtime
---

# Runtime и рендеринг

## Цикл `Game`

`Game.start()` запускает animation loop; `loop(timestamp)` вычисляет время и вызывает `update(deltaTime)`, затем `render()`. `stop()` и `destroy()` освобождают runtime. В `Game.ts` отдельно хранятся `rendererCanvas` и `bufferCanvas`: активный source-mode buffer масштабируется в display canvas.

## Render path

```text
Game.render()
  → SceneRenderer
      → scene entities / visual depth / parallax
      → subscene and effect passes
  → VirtualScreenRenderer (SVS, один экземпляр)
  → Game.renderUI(CanvasRenderingContext2D) / editor overlays
```

Основные файлы: `src/core/Game.ts`, `src/core/displaySettings.ts`, `src/graphics/SceneRenderer.ts`, `src/scene/SceneCamera.ts`, `src/core/Resolution.ts`, `src/core/Animator.ts`. SVS подключается как внешний display-модуль по Git-тегу `v2.0.2`; Quest не дублирует его CRT filter.

## Source modes и layering

`quest-420x300` — default; дополнительные source-режимы — `quest-800x600` и
`quest-1024x768`. `Game.setScreenProfile()` нормализует профиль, обновляет
`bufferCanvas` и active resolution, а `GameCanvas` синхронно меняет viewport,
output canvas и editor/UI canvases с учётом DPR. World и закрытая консоль идут
в source buffer до SVS; открытая консоль, DOM editor и selection overlays
рисуются после SVS.

## Системы кадра

`ActorNavigationService` и `ActorWorldQuery` обслуживают движение и проверку доступности; `ThreeDParallaxSystem`, `ShadowSystem`, `BackfaceSystem` влияют на визуальный результат; `SoundManager` и `AudioManager` работают с аудио-состоянием. `StateEventSystem` доставляет события изменения состояния.

## API/UI bridge

`Game` предоставляет `onMessage`, `onSceneChange`, `subscribeInventoryUi`, методы inventory preview и управление command input. Это явные точки синхронизации с React, а не общий mutable Zustand-store для runtime.

Связанные заметки: [[Architecture]], [[Scenes-and-Spatial-Model]], [[UI-and-Editor]].
