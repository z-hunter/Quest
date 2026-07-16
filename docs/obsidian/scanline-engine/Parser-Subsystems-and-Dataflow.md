# Parser subsystems и обмен данными

## Подсистемы

| Подсистема | Реализация | Ответственность |
|---|---|---|
| Input/normalization | `Console.preprocessGameplayInput`, `parserLanguage.ts` | aliases, prefixes, articles, relation markers |
| Stage 1.1 | `Parser.runStage1`, `parserCommands.ts` | deterministic intent/target и authored commands |
| Stage 1.2 | `NlpCascade.ts` | local intent classification/confidence |
| World model | `ParserWorldModelBuilder.ts` | context, scope, visibility, spatial/semantic facts |
| Target resolver | `Parser.ts` | title/synonym/ID matching, ambiguity, reachability |
| Pending state | `ParserPendingState`, `resolvePendingAction` | clarification и resume плана |
| LLM cascade | `LlmCascade.ts` | prompt, provider, JSON extraction, normalization |
| Command DSL | `parserTypes.ts`, `TextAssetManager` | authored args, preconditions, plan ops |
| Semantic execution | `GameSemanticAPI.ts`, `ActorCommandExecutor` | deterministic mutations/outcomes |
| Parser Notes | Scene/object notes и SceneLog hooks | private facts/stale revalidation |
| Response builder | `Parser.buildResponse`, Game log/UI | player/debug/next pending |
| Diagnostics | `Console`, peek flags | timings, envelopes, prompts, notes, outcomes |

## End-to-end flow

```text
raw input
  ↓ Console preprocessing / SAY shortcut
pending resolution ── option number ──→ pending-resolution envelope
  ↓
ParserWorldModelBuilder → ParserContext + ParserScope
  ↓
Stage 1.1 regex/custom commands
  ├─ plan → focused defaults → Core
  └─ handoff_up → Stage 1.2 NLP
                    ├─ plan → Core
                    └─ handoff_up → Stage 2 LLM (if enabled)
                                      ├─ normalized plan
                                      ├─ final_response/showText
                                      ├─ clarification/pending
                                      └─ fallback
  ↓
Parser Core: text target → entityId, preconditions, sequential execution
  ↓ GameSemanticAPI / command executor
  ↓ outcomes, effects, SceneLog/world state
  ↓ ParserResponse: playerMessages + debugMessages + nextPendingState
```

## Обмен между слоями

Каскады обмениваются serializable envelope/context, а не Entity-ссылками. Stage 1 может выдать textual target; Core разрешает его по scope и synonyms. LLM получает context JSON, но output проходит typed normalizer и не имеет прямого доступа к mutation API.

World-changing outcome обновляет Scene/inventory/state, пишет SceneLog и формирует следующий context. Parser Notes — private channel: LLM предлагает note action, но запись выполняется только Core.

## Handoff и ошибки

- unsupported syntax → `handoff_up`;
- низкая NLP confidence → следующий Stage;
- invalid LLM JSON/action → filtered response/fallback;
- неизвестная или недоступная цель → typed failed или needs_clarification;
- API `escalate` → post-API LLM retry;
- exception в Parser → reset pending/world model и generic parse-unknown response.

## Почему DSL, а не прямой текст

DSL разделяет intent и execution: модель выбирает линейную операцию, а Core проверяет identity, scope, inventory, reachability, containment, state и scripts. Поэтому Stage 1, NLP, LLM и authored commands используют один execution boundary и outcome contract.

[[Parser-Cascade-Architecture]] · [[Parser-Data-Contracts]] · [[Parser-World-Model]] · [[Scene-Interaction-Implementation]] · [[Scene-Log-Implementation]] · [[Console-and-Diagnostics]]
