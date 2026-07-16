# Архитектурный аудит Scanline Engine и план развития

## Executive assessment

Scanline уже является работающим runtime/editor engine с сильным deterministic core и AI-адаптерами вокруг него. Архитектурно наиболее зрелы Scene/spatial model, parser execution boundary, data-driven Text Assets и общий actor-aware action layer. LLM/NPC-контур функционален, но требует production hardening. SLM пока является инфраструктурным прототипом: runtime adapter и shadow dataset есть, обученной модели и train/eval pipeline нет.

Главный текущий release blocker — не type system, а поведенческая стабильность: `npm run typecheck` проходит, `codex-doctor -Fast` даёт 17/0/0, но полный Vitest сейчас показывает 574/579 passed и 5 failed в 3 test files.

## Системная модель

```text
React/Vite/Tauri + Canvas/WebGL/UI
                 ↓ adapters
Game (runtime orchestration + settings)
                 ↓
Scene / Entity / ComponentSystem / Inventory / Audio / Scripts
                 ↓ query/action boundary
GameSemanticAPI + ActorWorldQuery + Navigation + Executors
                 ↑
Parser (regex → NLP.js → LLM) / NpcPuppetMaster (SLM → LLM)
                 ↑
Text Assets / scene JSON / authored commands / prompts
```

Ключевой инвариант: model/parser/PM предлагают intent или structured plan, но не являются authority состояния. Мутации проходят через deterministic semantic API, navigation, inventory, state и script executors.

## Готовность подсистем

| Подсистема | Состояние | Оценка |
|---|---|---|
| Scene/entity/component/spatial | реализовано, есть validator и extensive tests | production candidate после стабилизации navigation edge cases |
| Parser Stage 1.1/1.2 | реализовано, typed envelope, pending clarification, DSL | наиболее зрелый AI-facing контур |
| Stage 2 LLM | Anthropic/Ollama, prompt cache, normalization, fallback | функционально готов, эксплуатационно требует replay/quotas/telemetry |
| NLP.js | training asset, lazy train, cache/import/export, threshold | готово для intent layer; dataset мал и ручной |
| NPC Puppet Master | plans, async continuation, interrupts, budgets, loop guards | feature-complete, но scheduler/navigation требуют hardening |
| SLM | adapters, vocabulary, ONNX runtime, shadow collection | prototype; модель и обучение отсутствуют |
| Rendering/CRT/UI | canvas/WebGL + React overlay, settings/tokens | функционально готово, нужны browser/E2E и performance budgets |
| Editor/persistence | scene/entity/component editing, Text Assets, scripts | usable, но schema migration/save-state contract нужно формализовать |
| Audio | Web Audio spatial/reverb/panning | реализовано, проверено unit tests |
| Data/assets | JSON scene, Text Assets, service assets, authored commands | сильный data-driven foundation; нужна schema/version validation |

## Сильные стороны

### 1. Правильная граница AI → deterministic runtime

`ParserCascadeEnvelope`, `ParserToolAction`, NPC plan DSL и typed outcomes позволяют менять regex/NLP/LLM/SLM, не дублируя правила мира. Это главный архитектурный актив проекта.

### 2. Единая actor-aware семантика

Player parser и NPC Puppet Master используют общие query/navigation/command правила. Это снижает расхождение между «что может игрок» и «что может NPC».

### 3. Data-driven авторинг

Text Assets, scene JSON, parser assets и authored commands выносят контент из TypeScript. Prompt-ы также разделены на ресурсы и runtime dynamic context.

### 4. Graceful degradation

Stage handoff, LLM fallback, SLM escalation, provider abstraction, plan validation и loop guards позволяют продолжать работу при недоступном или ошибочном AI.

### 5. Хорошая наблюдаемость для AI

Console peek modes, prompt/static hash, timings, provider metrics, SceneLog и ShadowLogger дают основу для debugging и будущего dataset.

## Слабые места и технические риски

### P0: текущая поведенческая нестабильность

Пять падений полного тестового набора:

- `tests/game/navigation-and-spatial.test.ts`: неверный interaction-distance для actor center и неверно выбранная approach point;
- `tests/npc/puppet-master.test.ts`: Exit traversal зацикливает timer polling и превышает 10 000 fake timers;
- `tests/parser/commands.test.ts`: ожидается локализованная missing-remote строка, но приходит английский fallback/service asset.

Пока эти тесты красные, нельзя считать navigation, async NPC continuation и localization contract стабильными.

### P0/P1: неполный SLM production contour

`SlmInferenceEngine` и `ShadowLogger` готовы как runtime infrastructure, но отсутствуют: dataset curation, deduplication, train/validation split, label policy, offline trainer, model registry/versioning, quality gates и поставка `slm_routine_v1.onnx`. Сейчас SLM закономерно эскалирует к LLM.

### P1: runtime state и persistence

Parser Notes, revealed hidden entities, NPC memory/knownEntities/objectives, SceneLog cursors и часть runtime state живут в памяти. Нужен формальный SaveState schema, иначе cross-scene/session continuity и воспроизводимость будут неполными.

### P1: async orchestration complexity

`NpcPuppetMaster`, `ActorPlanExecutor` и navigation используют timers, callbacks, continuations и interrupt conditions. Без explicit state machine, cancellation token и bounded completion contract легко получить повторные wakeups, infinite polling или stale continuation.

### P1: границы кода и типизации

`Game` остаётся крупным orchestrator/singleton; часть integration points использует `any`. Это ускоряет разработку, но усложняет deterministic tests, headless execution и замену runtime adapters.

### P1: provider/LLM эксплуатация

Нужны единые timeout/retry/circuit-breaker policies, redaction и prompt-size budgets, request correlation IDs, provider capability matrix и deterministic replay fixtures. Сейчас контракты есть, но production operations частично находятся за пределами engine.

### P1: editor/schema governance

JSON и Text Assets data-driven, но нужна единая schema/version/migration система. Без неё изменения component fields, commands и Text Assets могут ломать старые сцены или prompt projections.

### P2: performance and scalability

Сцена, parser context, prompt projection и React overlay требуют explicit budgets: entities per scene, context bytes, prompt tokens, render frame time, audio node count, editor selection cost. Кэширование уже есть, но budgets не оформлены как gates.

### P2: test surface

Unit/integration coverage широкая (41 test file), но нужен browser/E2E слой для Canvas/UI/editor/Tauri file APIs и contract tests на serialized assets/provider responses.

## Приоритетный roadmap

### P0 — сделать runtime release-safe

**Статус: выполнено 2026-07-17.** Полный suite: 41 test file / 579 tests; `typecheck` и `lint` проходят. CI теперь запускает `npm test` после build и lint.

1. Исправить 5 красных тестов и зафиксировать invariants:
   - actor-center interaction distance;
   - approach-point ranking;
   - Exit traversal completion/cancellation;
   - locale/service asset resolution in test fixtures.
2. Ввести CI gate: typecheck + full tests + asset/schema validation.
3. Формализовать cancellation/timeout contract для `ActorPlanExecutor` и navigation; ни один continuation не должен poll-ить бесконечно.
4. Добавить deterministic replay fixtures для parser action, NPC plan и semantic outcomes.

Выполненная стабилизация: тесты используют English-only Text Assets; navigation fixtures задают реальный collider и мокают walking-only route API; Exit-continuation тесты продвигают ровно два PM debounce-цикла вместо неконтролируемого `runAllTimersAsync`, который захватывал бесконечный movement watchdog. Runtime cancellation/invalidation уже обеспечиваются `haltAllNpcs` и generation guards; отдельная replay-инфраструктура остаётся частью P1 contract hardening.

### P1 — закрыть production gaps

1. SaveState v1: Scene runtime discoveries, Parser Notes, NPC memory/objectives/known entities, SceneLog cursors и versioned migrations.
2. Parser/AI contract hardening: generated JSON schemas или runtime validators для envelopes, ParserToolAction, NPC DSL и provider responses.
3. LLM operations: provider capability matrix, request IDs, bounded retries, circuit breaker, token/latency budgets, redacted prompt diagnostics и replayable fixtures.
4. Editor/data governance: schemas для scenes/components/Text Assets/commands, migration tool, load/save validation и actionable diagnostics.
5. SLM data pipeline: export JSONL → validate/deduplicate → split by scenario/NPC → offline train → held-out eval → model manifest → ONNX packaging → runtime compatibility test.
6. NPC reliability: explicit continuation state machine, idempotent event handling, stale-trigger rejection и metrics по plan completion/interruption/no-progress.

### P2 — масштабирование и расширяемость

1. Вынести pure world queries, parser core и plan validation в headless packages без `Game` singleton.
2. Ввести performance budgets и benchmark suite для больших сцен, prompt projections и NPC batches.
3. Browser/E2E tests для Console, editor, Canvas overlay, file persistence и Tauri adapters.
4. Plugin boundary для provider, parser command packs, renderer effects и asset domains.
5. Versioned observability export: parser/PM traces, dataset lineage, model version и scene/content hash.

## Критерии готовности следующей стадии

- полный test suite зелёный и воспроизводимый без ручной среды;
- SaveState round-trip сохраняет runtime semantics;
- любой parser/NPC plan можно replay-нуть по зафиксированному context;
- provider failure не блокирует game loop и не оставляет stale continuation;
- SLM имеет held-out accuracy/coverage/latency metrics и rollback на LLM;
- asset/schema migration проверяется до загрузки сцены;
- performance budgets измеряются в CI или отдельном benchmark job.

## Рекомендуемый порядок

Сначала стабилизировать navigation/async/parser localization и тестовый gate. Затем формализовать state/contract boundaries. Только после этого инвестировать в обучение SLM: иначе dataset будет собираться поверх нестабильных semantic outcomes и закрепит ошибки runtime.

[[Architecture]] · [[Parser-Cascade-Architecture]] · [[Parser-Data-Contracts]] · [[SceneManager-Implementation]] · [[Actor-Access-and-Navigation]] · [[Game-Master-Implementation]] · [[SLM-Dataset-Collection]] · [[Configuration-and-UI-Tokens]] · [[Validation]]
