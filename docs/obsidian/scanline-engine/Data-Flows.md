---
type: data-flow
---

# Сквозные потоки данных

## Запуск

```text
src/main.tsx
  → App.tsx
  → useGame.ts
  → new Game(...)
  → AssetLoader / SceneManager
  → Game.start()
  → requestAnimationFrame loop
```

## Кадр

```text
timestamp → Game.loop
          → Game.update(deltaTime)
              → SceneManager.update
              → editor.update (editor mode)
              → ScriptRegistry.update
          → Game.render
              → SceneManager.render(ctx)
              → CRTFilter / editor overlay
              → React/Canvas UI
```

## Команда игрока

```text
UIOverlay / ConsoleOverlay
  → Game.submitGameplayInput(text)
  → Parser context (ParserWorldModelBuilder)
  → deterministic parser or NLP/LLM/SLM cascade
  → ParserCascadeEnvelope / ParserToolAction
  → GameSemanticAPI
  → Scene / Inventory / Actor mutation
  → GameActionOutcome
  → logResponse / onMessage / UI
```

## Editor persistence

```text
React editor panel
  → editorStore + EditorSelection/Transform/Snapping
  → Scene/Entity graph
  → EditorUndoManager
  → EditorPersistenceManager
  → public/scenes/*.json or prefab/sprite JSON
  → AssetLoader / SceneManager on reload
```

## Scene transition

```text
goToScene(target)
  → GameSemanticAPI / SceneManager
  → load target JSON
  → validate spatial/components
  → set current scene + onSceneChange
  → renderer and parser world model observe new scene
```

Связанные заметки: [[Architecture]], [[Runtime-and-Rendering]], [[Parser-and-AI]], [[Data-Formats-and-Assets]].
