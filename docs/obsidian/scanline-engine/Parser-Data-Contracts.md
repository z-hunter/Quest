# Parser data contracts: Context, Envelope и DSL

## `ParserContext`

`src/mechanics/parserTypes.ts` определяет serializable snapshot: `rawInput`, `normalizedInput`, optional `focusedTarget` (inventory preview), player coordinates, scene (`id`, title, description, lore, parser note, active subscene, recent turns), entities, known entities, inventory, `worldFacts`, spatial nodes/relations, action scope и pending state.

`ParserEntityContext` переносит id/title, item, location/contents, visibility/accessibility, reachability, synonyms, semanticTags, description/details/lore, parser notes, states, interactions и exit metadata. Это read-only projection, не Entity-ссылка.

## `ParserScope` и world model

`ParserScope` содержит slices `visible`, `held`, `takable`, `putSource`, `reachable`, `examinable`, `subscene`, `worldKnown`, `hiddenKnown`. `ParserWorldModel = { context, scope }`.

`ParserWorldModelBuilder` вычисляет scope из Scene, inventory, subscene, blockers и spatial relations. Context предназначен для NLP/LLM/debug, scope — для candidate resolution.

## `ParserCascadeEnvelope`

Поля envelope:

- `stage`: `regex-v1 | pending-resolution | nlp-v2 | llm-v3`;
- `output.kind`: `plan` с `actions` или `handoff_up` с `reason`, `rawInput`, `verb`, `noun`;
- `debug`: raw/normalized input, verb/noun, relation/anchor, pending intent, intent, score, source и focused default target.

`stage` — provenance, `output.kind` — control flow, `debug` — telemetry. Debug не является gameplay truth.

## Structured plan DSL

`ParserToolAction` — discriminated union. Базовые actions: `lookScene`, `lookTarget`, `lookRelationTarget`, `examineTarget`, `examineRelationTarget`, `takeTarget`, `putTarget`, `openTarget`, `closeTarget`, `goToTarget`, `showInventory`, `quitCurrentView`.

Наратив/память: `showText`, `parserFailure`, `setSceneParserNote`, `setEntityParserNote`, `llmClarification`.

Authored/runtime: `resolveArgumentEntity`, `runCustomCommand`, `setEntityState`, `setGroupDisabled`, `runScript`, `stopScript`. Неизвестные types, invalid relations и missing required fields отбрасываются normalizer-ом.

Plan линейный: actions исполняются по порядку без циклов/ветвлений; ошибка, clarification или escalation могут остановить хвост.

## LLM response forms

```json
{ "kind": "plan", "actions": [{ "type": "lookTarget", "target": "desk" }] }
{ "kind": "final_response", "message": "..." }
{ "kind": "clarification", "question": "...", "pendingAction": { "type": "takeTarget", "target": "key" } }
{ "kind": "fallback" }
```

`LlmCascade.normalizeResponse` превращает final response в безопасный `showText`, clarification — в pending flow, fallback — в no-action/handoff. Текстовые targets остаются текстовыми до Core resolution в canonical entity IDs.

## Outcomes и pending

Semantic API/executors возвращают structured outcome вида `status: ok | failed | escalate | needs_clarification`, `code`, `message`, `data`, `effects`. Core решает продолжение, response, pending или LLM retry.

`ParserPendingState` хранит `intent`, question, originalInput, optional `pendingEnvelopeJson`, `pendingArg`, commandId, options и `clarificationAllowsMultiple`. Следующий ввод сначала проходит `resolvePendingAction`; option number восстанавливает исходный envelope со stage `pending-resolution`.

`ParserResponse` разделяет `playerMessage(s)`, `debugMessages` и `nextPendingState`, поэтому player text, telemetry и continuation state не смешиваются.

[[Parser-Cascade-Architecture]] · [[Parser-Subsystems-and-Dataflow]] · [[API-Contracts]] · [[Scripting-and-Game-API]]
