---
type: subsystem
---

# Parser и AI pipeline

## Конвейер

```text
text input
  → Parser / parserLanguage / parserCommands
  → NlpCascade (детерминированное NLP)
  → LlmCascade (Stage 2 interpretation)
  → ParserCascadeEnvelope / ParserToolAction
  → GameSemanticAPI
  → structured outcome + player text
```

Файлы: `src/mechanics/Parser.ts`, `parserTypes.ts`, `parserLanguage.ts`, `parserCommands.ts`, `NlpCascade.ts`, `LlmCascade.ts`.

## Контекст мира

`ParserWorldModelBuilder.ts` — адаптер от runtime world к semantic parser context. Он использует scene/spatial projection, видимость, held/takable scope, text assets и item flags; parser не является владельцем spatial hierarchy. `TextAssetManager` может передавать скрытый `lore` в AI-контекст, не показывая его обычным LOOK/EXAMINE.

## Провайдеры и SLM

LLM скрыт за `src/mechanics/llm/ILlmProvider.ts`; реализации — `AnthropicProvider.ts`, `OllamaProvider.ts`. Локальный путь: `slm/SlmInferenceEngine.ts`, `SlmInputAdapter.ts`, `SlmOutputAdapter.ts`, `SlmVocabulary.ts`. Каскад должен возвращать унифицированный envelope, чтобы Game исполнял действия одинаково независимо от провайдера.

## NPC

`NpcWorldModelBuilder.ts`, `NpcPuppetMaster.ts`, `ActorPlanExecutor.ts`, `ActorCommandExecutor.ts` строят контекст NPC, план и исполняют действия через тот же world/semantic API, что и player.

Связанные заметки: [[Scenes-and-Spatial-Model]], [[Scripting-and-Game-API]], [[Data-Formats-and-Assets]].
