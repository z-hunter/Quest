# Архитектура каскадов Parser

## Именование уровней

В runtime используются Stage 1.1, Stage 1.2 и Stage 2:

1. **Stage 1.1 — deterministic regex/lexicon parser** (`Parser.runStage1`), включая authored command matcher.
2. **Stage 1.2 — локальный NLP intent layer** (`NlpCascade`), вызываемый после handoff Stage 1.1.
3. **Stage 2 — LLM cascade** (`LlmCascade`), opt-in fallback/Game Master.

В envelope им соответствуют `regex-v1`, `nlp-v2`, `llm-v3`. Версии `v1/v2/v3` — provenance формата, а не три независимых parser-а.

## Почему 1.1 и 1.2 — один каскад

Stage 1 — единый слой распознавания намерения и аргументов до world reasoning:

- 1.1 извлекает intent, target, relation и authored command детерминированно;
- при `handoff_up` 1.2 классифицирует тот же raw input локальной NLP-моделью;
- оба возвращают один `ParserCascadeEnvelope` с линейным `ParserToolAction[]` или `handoff_up`;
- оба читают один `ParserContext`/`ParserScope`, не мутируют мир и не являются narrative reasoning;
- Core не запускает 1.2 после успешного плана 1.1.

1.2 — fallback/расширение recall внутри Stage 1. Два независимых каскада потребовали бы merge/conflict policy; такого параллельного решения в коде нет.

## Порядок `Parser.parse`

`src/mechanics/Parser.ts` выполняет: trim/raw-input guard и shortcut `SAY`; `resolvePendingAction`; `ParserWorldModelBuilder.build`; Stage 1.1; `applyFocusedDefaultTargets`; Stage 1.2 при handoff и включённом `#STAGE2`; Stage 2 при оставшемся handoff и `#LLM-ON`; `runParserCore`; post-API LLM retry для retryable `escalate`; player response, debug, pending state и `recentTurns`.

`#C1-OFF` принудительно отправляет Stage 1 envelope в LLM; это override/diagnostic mode.

## Stage 1.1

`runStage1` использует `getParserLexicon`, `getParserCommands`, `matchStage1Intent`, relation/target normalizers и `matchParserCommandSpec`. Intents: LOOK, EXAMINE, TAKE, PUT, OPEN, CLOSE, QUIT, INVENTORY, GO. Результаты — `ParserToolAction` (`lookScene`, `lookTarget`, `examineTarget`, `takeTarget`, `putTarget`, `openTarget`, `closeTarget`, `quitCurrentView`, `showInventory`, `goToTarget`) или authored command plan.

Нераспознанный ввод получает `handoff_up` с `reason: unsupported_by_stage1`, `rawInput`, `verb`, `noun`.

## Stage 1.2

`src/mechanics/NlpCascade.ts` загружает `parser-training.json`, строит NLP.js model и кэширует её в `localStorage` по hash training data. `NLP_CONFIDENCE_THRESHOLD = 0.58`. NLP классифицирует intent и cleaned target; semantic resolution, reachability, containment, state и side effects остаются в Core. Низкая confidence возвращает handoff/empty.

## Stage 2

`src/mechanics/LlmCascade.ts` загружает `parser-llm-system.md` и `parser-llm.json`, строит static/dynamic prompt, вызывает `ILlmProvider`, извлекает JSON и нормализует разрешённые actions. LLM может предложить plan, final response, structured clarification или fallback, но не вызывает Game API напрямую.

Stage 2 запускается обычным handoff, forced cascade и post-API retry.

[[Parser-Data-Contracts]] · [[Parser-Subsystems-and-Dataflow]] · [[Parser-Implementation]] · [[AI-Cascade-Implementation]] · [[LLM-Prompt-Catalog]] · [[Console-and-Diagnostics]]
