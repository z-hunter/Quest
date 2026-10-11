---
type: implementation
system: parser-ai
---

# NLP/LLM/SLM cascade — реализация

## NLP

`src/mechanics/NlpCascade.ts` поддерживает deterministic intents (`look`, `examine`, `take`, `put`, `quit`, `goTo`, `showInventory`). `initialize()` строит/кэширует NLP model; cache key вычисляется из training data. `getLastDebugInfo` exposes diagnostics without changing action contract.

Подробный lifecycle обучения, состав `parser-training.json`, NLP.js pipeline и cache import/export описан в [[NLPJS-Training-and-Model-Cache]].

## LLM

`src/mechanics/LlmCascade.ts` разделяет static prompt parts (scene-independent instructions/assets) и dynamic user/context message. Dynamic context compact’ится: entities, known entities, discovery opportunities, focused target, previous attempt. Response parser extracts JSON, validates actions, relations, state values, scope arrays and clarification data.

Provider boundary: `ILlmProvider` → `AnthropicProvider`/`OllamaProvider`; cascade не знает transport details.

## SLM

`src/mechanics/slm/SlmInferenceEngine.ts` + input/output adapters + vocabulary implement local inference path behind the same parser action shape.

## Safety boundary

No cascade directly mutates Scene. Output must become `ParserCascadeEnvelope`, then Parser executes validated `ParserToolAction` through GameSemanticAPI.

Связанные: [[Parser-Cascade-Contracts]], [[Parser-Implementation]], [[Dependencies-and-Platform]].
