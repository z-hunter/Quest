---
type: implementation
system: react-ui
---

# React UI: GameCanvas, UIOverlay и ConsoleOverlay

## GameCanvas

`src/components/GameCanvas.tsx` owns canvas DOM refs, viewport resize/zoom and Game lifecycle binding. It is a host, not a second renderer: Game owns canvas contexts and render loop.

## UIOverlay

`src/components/UIOverlay.tsx` binds `game.onMessage`, file browser and choice dialog callbacks, command input ref, console subscription and inventory UI subscription. It manages focus rules: parser input is focused unless editor/console modal/file dialog owns input.

## ConsoleOverlay

`src/components/ConsoleOverlay.tsx` subscribes to Game console state/history, handles modal/closed-modal continuation and keyboard navigation. Console log selection temporarily suppresses forced command focus.

```text
Game callback/subscription
  → React local state
  → overlay/panel render
  → user event
  → Game method / Parser input
```

Связанные: [[Core-Game-Implementation]], [[Editor-Implementation]], [[Script-Runtime]].
