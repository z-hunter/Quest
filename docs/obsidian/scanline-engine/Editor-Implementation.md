---
type: implementation
system: editor
---

# Scene/Sprite Editor — реализация

## Entry points

`src/tools/SceneEditor.ts` и `src/tools/SpriteEditor.ts` orchestrate authoring mode. React panels in `src/components/editor/*` and property panels invoke editor capabilities.

## Managers

`src/tools/editor/EditorSelectionManager.ts` owns selection; `EditorTransformManager.ts` applies position/scale/vertex transforms; `EditorSnappingSystem.ts` quantizes/aligns geometry; `EditorUndoManager.ts` tracks reversible mutations; `EditorPersistenceManager.ts` serializes authored graph.

## State boundary

`src/store/editorStore.ts` owns editor mode (`SELECT|DRAW_WALKBOX|DRAW_TRIGGER`), selection/tool UI state. It must not become the owner of runtime Scene state. Managers mutate Scene objects and notify React/editor store.

## Authoring flow

```text
pointer/tool input
  → selection/transform/snapping manager
  → Scene/Entity/Quad/Polygon mutation
  → undo snapshot
  → persistence JSON
  → runtime renderer preview
```

Связанные: [[UI-and-Editor]], [[Editor-Persistence]], [[Scene-Schema]], [[Entity-Schema]].
