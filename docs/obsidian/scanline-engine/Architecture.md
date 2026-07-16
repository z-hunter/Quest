---
type: architecture
---

# Архитектура

Scanline Engine — TypeScript/React 2.5D adventure engine. Браузерный runtime и React UI живут в одном приложении; Tauri добавляет desktop-оболочку и файловые возможности.

## Слои

| Слой | Ответственность | Файлы |
| --- | --- | --- |
| Bootstrap | монтирование приложения и режимов | `src/main.tsx`, `src/App.tsx` |
| Runtime core | lifecycle, input, assets, audio, scripts, text | `src/core/*` |
| World | сцены, entities, spatial, camera, interaction | `src/scene/*`, `src/entities/*` |
| Systems | inventory, components, navigation, sound, effects | `src/systems/*` |
| Rendering | scene passes, parallax, CRT | `src/graphics/*` |
| Mechanics/AI | parser, NLP/LLM/SLM, NPC plans | `src/mechanics/*` |
| UI/editor | React overlay, inventory, scene/sprite editors | `src/components/*`, `src/tools/*` |
| Platform | browser/Tauri file bridge | `src/platform/fileApi.ts`, `src-tauri/*` |

## Runtime boundary

`src/core/Game.ts` реализует `IGame` и является главным оркестратором состояния. React-компоненты не владеют world state: они получают экземпляр Game через `src/hooks/useGame.ts`, вызывают его API и подписываются на сообщения/изменения UI. Canvas рендерится runtime, HTML/React — поверх него.

## Потоки

```text
user input → UIOverlay/Console → Game.submitGameplayInput
            → Parser/NLP/LLM → semantic Game API
            → Scene/Inventory/Actor state → GameActionOutcome/message
            → React overlay + next render frame
```

Связанные заметки: [[Runtime-and-Rendering]], [[Parser-and-AI]], [[Scripting-and-Game-API]].
