---
type: implementation
system: Parser
---

# Parser — реализация ядра

Файл: `src/mechanics/Parser.ts`.

## Pipeline

```text
raw input
  → focused/pending clarification resolution
  → Stage 1 deterministic parser
  → NLP/LLM handoff when needed
  → ParserCascadeEnvelope
  → ParserCoreDecision / linear ParserToolAction plan
  → approach + GameSemanticAPI execution
  → structured outcome → response + next context
```

Parser владеет command resolution и execution orchestration, но не world state. World state изменяется через `Game`/`GameSemanticAPI`.

## Stage 1

`runStage1`, group/list take and put builders, plural normalization, target candidate ordering and relation-scoped filtering implement deterministic commands. `resolveLookTarget`, `resolveExamineTarget`, `resolveTakeTarget`, `resolvePutTarget`, `resolveOpenCloseTarget`, `resolveGoToTarget` convert text to semantic candidates/outcomes.

## Clarification/retry

Pending action stores intent and options; numbered/text replies are resolved by `resolvePendingClarificationReply`. Recoverable API outcomes can trigger post-API LLM retry; unresolved ambiguity becomes `needs_clarification`, not a raw mutation.

## Execution

`makeCoreDecision`, `executeCoreDecision`, `executeCorePlan`, `executeParserAction` apply actions such as resolve entity, require availability, set state, run/stop script, inventory mutation, actor use and custom command expansion. Parser records scene turns and parser-note effects through Scene runtime methods.

Связанные: [[Parser-and-AI]], [[Parser-World-Model]], [[Parser-Cascade-Contracts]], [[Scripting-and-Game-API]].
