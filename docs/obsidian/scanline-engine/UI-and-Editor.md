---
type: ui
---

# UI и editor

## Игровой UI

`GameCanvas.tsx` хостит canvas; `UIOverlay.tsx` маршрутизирует пользовательский текст к console/game; `ConsoleOverlay.tsx` отображает console output. `PlayerInventoryPanel.tsx` и `InventoryEntityCanvas.tsx` показывают inventory и preview. `useGame.ts` связывает React lifecycle с Game.

## Editor state и панели

`src/store/editorStore.ts` — Zustand-состояние editor UI. Основные панели: `HierarchyPanel.tsx`, `EditorToolbar.tsx`, `EditorBottomMenu.tsx`, `PropertiesPanel.tsx`; объектные свойства находятся в `components/editor/properties/*`.

## Editor managers

`SceneEditor.ts` и `SpriteEditor.ts` используют `EditorSelectionManager`, `EditorTransformManager`, `EditorSnappingSystem`, `EditorUndoManager`, `EditorPersistenceManager` из `src/tools/editor/*`. Типичный поток:

```text
pointer/keyboard event → selection/transform manager
                       → scene/entity mutation
                       → undo stack + persistence JSON
                       → renderer preview
```

Связанные заметки: [[Architecture]], [[Data-Formats-and-Assets]], [[Scenes-and-Spatial-Model]].
