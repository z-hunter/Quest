---
type: schema
system: parser
---

# Parser types и cascade contracts

Источник: `src/mechanics/parserTypes.ts`.

## Контекстные типы

`ParserEntityContext`, `ParserEntityLocationContext`, `ParserEntityContentContext`, `ParserStateContext`, `ParserInventoryItemContext`, `ParserSpatialNodeContext`, `ParserSpatialRelationContext` описывают read model для commands/LLM.

`ParserContext` объединяет scene, entities, inventory, focused target, pending state, recent turns и text metadata. `ParserScope` индексирует candidate slices; `ParserWorldModel` включает context + scope + envelope metadata.

## Action contract

`ParserToolAction` — унифицированное действие с intent/action name и payload. Тип покрывает inspect, movement, take/put, state, scripts, clarification и custom commands. `ParserCascadeEnvelope` переносит actions, raw input, confidence/metadata и handoff/debug information между stages.

`ParserResult`, `ParserCoreDecision`, `ParserResponse` разделяют: cascade result → core decision → player response. Это предотвращает смешивание LLM text и authoritative mutation.

## LLM normalization

`LlmCascade` валидирует/normalizes JSON action, relations, state values, scope arrays и clarification options перед возвратом envelope. Invalid action не исполняется напрямую.

Связанные: [[Parser-Implementation]], [[Parser-World-Model]], [[Data-Flows]].
