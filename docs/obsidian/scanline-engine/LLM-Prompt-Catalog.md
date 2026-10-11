# Каталог prompt-ов LLM и их хранение

## Где лежат prompt-ресурсы

### Основные system prompts

- `public/text/system/parser-llm-system.md` — system prompt для `LlmCascade` (Game Master/parser).
- `public/text/system/npc-pm-system.md` — system prompt для `NpcPuppetMaster`.

Оба файла загружаются через `fetch` и кэшируются в runtime. При недоступном fetch используется встроенный `FALLBACK_SYSTEM_PROMPT` в `src/mechanics/LlmCascade.ts` и `src/mechanics/NpcPuppetMaster.ts`.

### Сервисные prompt assets

`TextAssetManager.readServiceAsset` читает JSON из `public/text/system/`:

- `parser-llm.json` — секции для сборки LLM-контекста: `world_fact_instructions`, `parser_note_instructions`, forced handoff, post-API recovery/not-found/escalation, labels и response reminder.
- `parser.json` — player-facing шаблоны deterministic parser (LOOK/EXAMINE/TAKE/PUT/OPEN/CLOSE/GO/USE и clarification), не system prompt модели.
- `parser-training.json` — примеры для ранних parser stages.
- `parser-lexicon.json` — aliases, normalization/polite prefixes, articles, relation markers.
- `engine.json` — runtime-строки действий/навигации; `scripts.json` — тексты script-результатов.
- `commands/*.json` — authored command definitions, которые попадают в доступные affordances.

Scene/object Text Assets (`public/text/scenes/<id>.json`, `public/text/objects/<id>.json`) поставляют lore, description, details, synonyms, semantic tags, relation facts, parser notes и authored commands; это данные prompt, а не prompt-код.

## Содержание parser/Game Master prompt

`parser-llm-system.md` задаёт роль noir Game Master, стиль короткого player-facing текста и правила соответствия языка игрока. Он описывает:

- private JSON world snapshot и запрет раскрывать внутренние поля;
- допустимые действия `showText`, LOOK/EXAMINE, TAKE/PUT, OPEN/CLOSE, GO, inventory и Parser Note actions;
- Parser Notes как приватную runtime-память с `parserNoteNeedsCheck`;
- world-model discipline: `worldFacts`, contents/location, spatial nodes/relations — физическая истина;
- hidden-entity/discovery protection и запрет выдумывать объекты/связи;
- faithful executable equivalents, clarification с `pendingAction`, single linear plan;
- строгий JSON envelope: `plan`, `final_response`, `clarification` или `fallback`.

`LlmCascade.buildStaticPromptParts` собирает system text + сервисные инструкции + `Scene-Static Context`; `buildDynamicUserMessage` добавляет ввод игрока, динамический world model, parser notes, pending state, recent turns и previous attempt.

## Содержание NPC Puppet Master prompt

`npc-pm-system.md` задаёт DSL-планирование NPC, а не narration. Он содержит:

- список разрешённых шагов `SAY`, `MOVE_TO`, `TRAVERSE_EXIT`, `LOOK`, `EXAMINE`, `OPEN`, `CLOSE`, `TAKE`, `PUT`, `COMMAND`, `USE`, `WAIT`, `THINK_STRATEGY`, `OBJECTIVES_SET`, `MEMORY_SET`;
- семантику каждого шага, reachability/route, exits, inventory и authored commands;
- `interruptOn`, plan-level memory, action outcomes и правила не считать ожидаемый результат фактом;
- authority `currentSceneId`, actionHistory и refreshed context;
- no-progress/repeated action ограничения и запрет прямой мутации мира.

`NpcPuppetMaster.buildSystemPrompt` добавляет к system prompt кэшируемый `Scene-Static NPC Context` (`projectionVersion`, scene, static entity projection). `buildMessages` добавляет динамический JSON: trigger, NPC objectives/memory/inventory, known entities, action history, new/recent SceneLog events и dynamic entities.

## Отдельный strategy prompt

`buildStrategySystemPrompt` использует встроенный `STRATEGY_SYSTEM_PROMPT` в `NpcPuppetMaster.ts` и тот же static entity projection. `buildStrategyMessages` требует JSON `npc_strategy_response` и разрешает только обновление `memory`, `objectives` и `waitMs`; речь и физические действия в strategy-ответе запрещены. Это отдельный LLM-вызов для `THINK_STRATEGY`.

## Static/dynamic и caching

Parser и NPC разделяют prompt на:

1. неизменяемый system/static prefix;
2. текущий dynamic suffix в user message.

Для Anthropic static scene block помечается `cacheControl: { type: 'ephemeral', ttl: '5m' }`. `LlmCascade` строит static hash (`fnv1a32`-descriptor) и пересобирает его при изменении scene/Text Assets; NPC использует аналогичный `getStaticPrefixDebug`/hash. Dynamic JSON уплотняется: убираются default-поля и pretty-print отступы.

## Provider и SLM

`ILlmProvider` получает уже собранные `system` и `messages`; Anthropic переводит cache blocks в API `cache_control`, Ollama получает обычный локальный JSON-запрос. SLM не использует prose prompt: `SlmInputAdapter` кодирует компактный token context, `SlmVocabulary` задаёт спецтокены, `SlmOutputAdapter` декодирует typed result. При недостаточном результате происходит эскалация в LLM cascade.

[[Text-Assets-Implementation]] · [[Parser-Implementation]] · [[Parser-Cascade-Contracts]] · [[Game-Master-Implementation]] · [[NPC-World-Model]] · [[LLM-Provider-Contracts]] · [[SLM-and-Neural-Runtime]]
