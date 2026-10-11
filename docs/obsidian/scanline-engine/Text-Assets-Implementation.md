# Text Assets: реализация и контракты

## Роль

`TextAssetManager` (`src/core/TextAssetManager.ts`) — слой authored-текста между JSON-проектом и runtime. Он разрешает поля сцены/объекта, применяет defaults, нормализует строки/массивы и кэширует результаты. Runtime не должен читать `public/text` напрямую.

## Форматы и области

- `public/text/scenes/<sceneId>.json` — текстовые поля сцены и parser-note.
- `public/text/objects/<objectId>.json` — `title`, `description`, `details`, `lore`, `takeFailure`, `synonyms`, `semanticTags`, `relationFacts` и authored-команды/affordances.
- `public/text/system/*.md` — статические system prompts для parser и NPC Puppet Master.
- Значение может быть `string` или `string[]`; многострочные значения нормализуются перед выдачей.

Ключевые типы: `TextAssetStructuredValue`, `SceneTextAssetData`, `ObjectTextAssetData`.

## Разрешение значения

`getResolvedSceneField`/`getResolvedObjectField` сначала ищут authored значение, затем fallback проекта. Списки имеют отдельные `getResolvedObjectListField` и revision-хеш (`getResolvedObjectListRevision`). `hasAuthoredObjectTitle` отличает сущность с игровым именем от технического узла; это используется фильтрами NPC world model.

Parser-ресурсы доступны через `getParserLexicon`, `getParserTraining`, `getParserCommands`; сервисные тексты и списки — через `getServiceText`/`getServiceList`. `buildDefaultSceneAsset` и `buildDefaultObjectAsset` дают безопасную форму при отсутствии файла. `clearCaches` нужен после editor-save или смены проекта.

## Граница с AI

Text Assets поставляют факты, лексику, lore, affordances и цели, но не изменяют состояние. `ParserWorldModelBuilder` и `NpcWorldModelBuilder` проецируют их в prompt/context. Authored-описания не дублируются в dynamic entities; строковый `entityId` остаётся join key.

## Связи

[[Asset-and-Text-Pipeline]] · [[Parser-World-Model]] · [[NPC-World-Model]] · [[Game-Master-Implementation]] · [[Editor-Persistence]]
