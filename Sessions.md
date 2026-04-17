## Session Entry - 2026-04-15 18:16 Europe/Warsaw

# Session Summary

## Session Goal

Продолжить реализацию `InventorySys.md`, довести контейнерную и семантическую систему до рабочего состояния, устранить parser/runtime регрессии вокруг `PUT/TAKE`, оформить inventory hierarchy в сцене, а затем синхронизировать проектную документацию с фактической реализацией.

## What Was Implemented

### 1. `PUT` from nearby scene items

- Реализована поддержка `PUT <item> ...` не только для предметов из инвентаря, но и для nearby scene items.
- Добавлено правило: такая операция допустима только если и source-item, и target доступны персонажу.
- При конфликте между held item и nearby scene item parser теперь уходит в clarification вместо молчаливого выбора одного варианта.

### 2. Relation-aware built-in containers

- Built-in `Inventory` и `Surface` на titled-объектах стали relation-aware контейнерными слотами.
- Поддерживаются relation: `in`, `on`, `under`, `behind`.
- Добавлено правило “один контейнер на relation”.
- Runtime и parser теперь различают контейнерные слоты по relation, а не считают контейнер у объекта единым.

### 3. Semantic hidden objects

- Реализовано поле `hidden` для titled-объектов:
  - `false`
  - `lookable`
  - `examinable`
- `lookable` раскрывается через `LOOK`-контекст, relation-look и mouse title reveal.
- `examinable` раскрывается только успешным `EXAMINE`.
- До раскрытия объект отсутствует в parser world model и scene text layer.

### 4. `Blocker` + generalized blocking semantics

- Добавлен компонент `Blocker`.
- `Switch` и `Blocker` получили:
  - `transparent`
  - `blockedRelation`
- Семантика стала общей:
  - opaque blocker/switch скрывает и блокирует;
  - transparent blocker/switch оставляет видимость, но блокирует reachability;
  - `blockedRelation` управляет тем, какие spatial-descendants считаются заблокированными.

### 5. Inventory hierarchy projection

- Предметы в inventory теперь не удаляются из scene model полностью.
- Они живут в scene hierarchy как скрытые `IN`-дети владельца inventory.
- Для text layer и parser при этом используется не техническое `IN`, а relation самого inventory-slot'а.
- Это даёт правильную семантику вида:
  - предмет технически `IN Cabinet`
  - но текстово `BEHIND the Cabinet`

### 6. Editor sync for inventory membership

- Добавлена синхронизация inventory membership из editor spatial edits.
- Если в editor поменять у `Entity` `Parent/Relation` так, что он станет `IN`-ребёнком inventory-owner, это теперь синхронизируется в `InventoryManager`.
- Обратное действие тоже убирает предмет из inventory storage.
- Это подключено и для single-edit, и для multi-edit панелей свойств.

### 7. `PUT` clarification continuation fix

- Исправлен важный parser-bug:
  - если `PUT` запрашивал clarification между held item и nearby scene item,
  - follow-up ответ пользователя раньше терял исходную цель (`INTO recorder`) и превращался в отдельную команду.
- Теперь parser сохраняет original pending envelope и при follow-up патчит именно исходный `putTarget.item`.
- Благодаря этому после выбора конкретного предмета сохраняется исходная destination-часть команды.

## Important Architecture / Runtime Decisions

### Inventory hierarchy sync should be explicit

- Важно не трактовать каждый `IN`-child под inventory-owner как inventory content автоматически.
- Это сломало бы старый direct-spatial контент.
- Поэтому синхронизация inventory membership должна происходить от явных editor spatial edits, а не от жадного чтения сцены.

### Inventory slot relation is semantic, not technical

- Предметы inventory технически живут как `IN`-дети владельца.
- Но для parser/text layer их effective relation определяется relation inventory-slot'а.
- Это ключевой контракт для built-in inventory.

### `PUT` clarification must preserve original action envelope

- Clarification для `PUT` не должен превращать follow-up в новый голый `PUT <item>`.
- Нужно сохранять исходную action-структуру, иначе теряется target и появляются ложные ошибки вида `You aren't carrying ...`.

## Parser / Mechanics / Scene / Subscene / Inventory Changes

### Parser

- Уточнён `PUT` source resolution.
- Добавлен безопасный continuation path для pending clarification.
- Расширена world-model семантика для hidden/blocker/inventory-slot projection.

### Runtime / Game / Inventory

- `InventoryManager` теперь хранит inventory items как hidden scene children.
- Added `syncEntityStorageFromSpatialPlacement(entity)` as editor-facing bridge between scene hierarchy and inventory storage.
- `PUT/TAKE` и scene/inventory transitions поддерживают updated storage contract.

### Scene / Text Layer

- Scene text layer теперь учитывает:
  - hidden semantic state
  - blocker semantics
  - inventory-slot relation projection

### Subscene

- Контракт `Subscene.itemScale` и взаимодействие с items уже сохранён и остаётся частью активной модели.
- В автотестовой документации отражено, что покрываются subscene item sync и runtime scaling behavior.

## Documentation Updated

Были обновлены проектные документы:

- `InventorySys.md`
  - переведён из состояния “частично план / частично описание” в актуализированный контракт контейнерной системы
  - зафиксированы `Blocker`, `hidden`, inventory hierarchy projection и `PUT` clarification continuation
- `GDD.md`
  - добавлены high-level описания `Inventory`, relation-aware `Surface`, `hidden`, `Blocker`, `blockedRelation`
- `Autotests.md`
  - обновлено описание покрываемых контрактов для:
    - `PUT/TAKE`
    - `hidden`
    - `Blocker`
    - inventory hierarchy sync
    - clarification continuation

## Tests Run

During the session the following checks were run successfully:

- `npx tsc -p tsconfig.app.json --noEmit`
- `npx vitest run tests/game/semantic-api.test.ts tests/parser/world-model-context.test.ts`
- `npx vitest run tests/integration/parser-game.test.ts`
- `npx vitest run`

Последний полный прогон, выполненный в рамках сессии, дал:

- `115 passed`

## Commits Created During the Session

- `a6c952d` — `Allow PUT from nearby scene items`
  - `PUT` теперь умеет использовать nearby scene item без предварительного `TAKE`
- `6da70d6` — `Implement hidden blockers and inventory hierarchy sync`
  - hidden semantics
  - blocker semantics
  - inventory hierarchy projection/sync
  - `PUT` clarification continuation fix

## Current State

Контейнерная система, parser world model и inventory hierarchy находятся в значительно более завершённом состоянии, чем в начале сессии.

Сейчас проект уже имеет:

- рабочие relation-aware контейнеры;
- hidden/lookable/examinable semantics;
- blocker semantics;
- inventory projection через scene hierarchy;
- editor-driven inventory sync;
- исправленный clarification path для `PUT`.

Документация обновлена, но на момент wrap-up она ещё не была закоммичена отдельным doc-коммитом.

## Remaining Work / Next Recommended Steps

Наиболее логичные следующие шаги:

1. Закоммитить актуальные doc-изменения отдельным коммитом.
2. Сделать отдельный actor/ownership audit:
   - смена active actor
   - `protected` inventory behavior
   - visibility/accessibility contracts для non-player owner workflows
3. При желании добавить более удобный hierarchy UX, если потребуется drag-and-drop workflow поверх уже работающей логики.

## Risks / Caveats / Open Questions

- Multi-actor contract по смыслу уже поддерживается архитектурно, но не был добит отдельным целевым pass'ом в этой сессии.
- Документация обновлена в worktree, но не зафиксирована commit'ом.
- Важно помнить, что inventory synchronization из hierarchy должен оставаться explicit-driven, иначе можно сломать legacy direct-spatial scene content.

## Current Uncommitted Changes In Worktree

На момент создания этого summary в рабочем дереве есть незакоммиченные изменения в:

- `src/entities/Entity.ts`
- `src/entities/SceneObject.ts`
- `src/scene/Scene.ts`
- `tests/game/semantic-api.test.ts`
- `tests/scene/scene-interaction.test.ts`

Эти изменения не являются частью уже зафиксированного summary-коммита `6da70d6`, поэтому перед продолжением работы их нужно отдельно проверить и интерпретировать как текущее незавершённое состояние репозитория.

## Session Entry - 2026-04-15 15:36 +02:00

# Session Summary

## Session Goal

- Исправить регрессию загрузки сцены, при которой предметы из главного инвентаря игрока не появлялись в UI inventory panel и команда `INVENTORY` отвечала `You are not carrying anything.`
- Проверить, не остаётся ли аналогичная проблема у внешних и вложенных контейнеров после `switchTo/loadScene`.
- Закрепить для проекта постоянную ссылку на NotebookLM-блокнот `Scanline Engine` и подключить его как сохранённый источник.

## What Was Implemented

### 1. Scene-load hydration для главного инвентаря игрока

- В `InventoryManager` добавлен `handleSceneChange()`.
- Новый bootstrap на смене сцены очищает устаревшие inventory caches, заново гидратирует runtime-state из `Inventory.items`, восстанавливает `game.inventory` для главного inventory игрока и повторно применяет скрытое `IN`-размещение для предметов в хранилищах.
- `SceneManager.switchTo()` теперь вызывает этот bootstrap сразу после переключения текущей сцены.

### 2. Тестовое покрытие для scene switch / load

- В `tests/game/semantic-api.test.ts` добавлен регрессионный тест на гидратацию player inventory из scene inventory component.
- В `tests/game/navigation-and-spatial.test.ts` добавлены два регрессионных теста:
  - гидратация обычного внешнего `Inventory` после `switchTo`;
  - гидратация untitled nested inventory extension с корректной проекцией через titled anchor.
- Тестовый harness `tests/fixtures/gameSemanticFactory.ts` синхронизирован с реальным поведением `switchTo`, чтобы такие сценарии проверялись честно.

### 3. Уточнение одного существующего container/surface теста

- В `tests/game/semantic-api.test.ts` уточнён старый fixture для вложенной `Surface`: relation теперь явно `in`, и ожидаемое runtime spatial placement предмета согласовано с этой моделью.
- Это не было новой функциональной правкой runtime, а приведением существующего теста в соответствие с явной relation-aware container моделью.

### 4. NotebookLM project wiring

- В `AGENTS.md` добавлена точная ссылка на NotebookLM-блокнот `Scanline Engine`:
  `https://notebooklm.google.com/notebook/9f146be7-7c4a-4bb0-b7b4-7f20079e85b0`
- Блокнот добавлен в NotebookLM library как сохранённый источник `Scanline Engine`.
- Блокнот выбран активным по умолчанию для текущей работы.
- Выполнен тестовый вопрос в NotebookLM по рискованным зонам spatial containers / InventorySys.

## Important Architecture / Runtime Decisions

### Scene hydration должна оставаться explicit-driven

- База знаний и локальный код сходятся в том, что при загрузке сцен нельзя жадно считать любой `IN`-child частью контейнера.
- Гидратация runtime inventory state должна идти от явных `Inventory.items` и relation-aware storage slots, иначе ломается совместимость со старым direct-spatial контентом.

### Канонический runtime state по-прежнему живёт в InventoryManager

- `Inventory.items` остаётся сериализуемым источником для scene load/switch.
- После загрузки канонический runtime-state восстанавливается в `InventoryManager`, а уже от него читаются UI, `showInventory()`, parser world model и semantic API.

### Nested container projection после switchTo подтверждена тестами

- После текущей правки и новой тестовой серии подтверждено:
  - внешний `Inventory` корректно гидратируется из `component.items`;
  - untitled nested inventory extensions тоже гидратируются;
  - text/spatial projection после этого остаётся relation-aware и проходит через ближайший titled anchor.

## Parser / Mechanics / Scene / Subscene / Inventory Changes

### Inventory / Scene

- Исправлен runtime gap между scene serialization (`Inventory.items`) и live player inventory (`game.inventory`).
- Смена сцены теперь корректно восстанавливает player inventory и non-player container stores.

### Parser / Semantic API

- Поведение `INVENTORY` после scene load теперь соответствует сериализованному состоянию сцены.
- Проверка через NotebookLM подсветила следующие зоны для будущего внимания:
  - multi-actor inventory contract;
  - protected / NPC workflows;
  - дополнительные serialization/load fixtures;
  - совместимость spatial hierarchy с legacy group-based subscene activation.

## Tests Run

- `npm run test -- tests/game/semantic-api.test.ts`
  - Passed
- `npm run test -- tests/integration/parser-game.test.ts`
  - Passed
- `npm run typecheck`
  - Passed
- `npm run test -- tests/game/navigation-and-spatial.test.ts`
  - Passed
- `npm run test -- tests/game/semantic-api.test.ts tests/integration/parser-game.test.ts`
  - Passed

## Commits Created During the Session

- Коммитов в этой сессии не создавалось.

## Remaining Work / Next Recommended Steps

- Проверить аналогичную гидратацию для `Surface.items` после `switchTo/loadScene`, особенно у nested surfaces и untitled extension chains.
- Провести отдельный audit multi-actor inventory contract:
  - active actor switching;
  - NPC inventory visibility/accessibility;
  - `protected` semantics вне player-owned inventory.
- При следующем крупном заходе в scene serialization/load добавить ещё более прямые fixtures или integration tests именно для JSON-driven scene load, а не только для in-memory scene switch.

## Risks, Caveats, Open Questions, Or Non-Committed Changes

- В worktree остались некоммиченные изменения в:
  - `AGENTS.md`
  - `src/core/InventoryManager.ts`
  - `src/scene/SceneManager.ts`
  - `tests/fixtures/gameSemanticFactory.ts`
  - `tests/game/navigation-and-spatial.test.ts`
  - `tests/game/semantic-api.test.ts`
- Также в worktree уже был пользовательский/внерамочный файл `public/scenes/test_room.json`; он не изменялся в рамках этой сессии.
- `Sessions.md` остаётся неотслеживаемым файлом в репозитории и был обновлён как cumulative session log.

## Session Entry - 2026-04-15 16:38 +02:00

# Session Summary

## Session Goal

- Слегка оптимизировать левую панель `Hierarchy` в редакторе сцены.
- Понять, почему в этой сессии не работает доступ к NotebookLM через MCP.
- Зафиксировать устойчивое поведение для будущих сессий, чтобы агент не застревал на ложноположительном NotebookLM health-check.

## What Was Implemented

### 1. UI cleanup для `Hierarchy`

- В `src/components/editor/HierarchyPanel.tsx` селект создания объекта был перенесён из отдельной строки в header панели справа от `OBJECTS`.
- Placeholder сокращён с `+ Add Object` до `+ADD`.
- Ширина селекта уменьшена, чтобы он стабильно помещался в header.
- Освобождена отдельная строка в верхней части панели.

### 2. Уплотнение зоны filter/list

- В той же панели уменьшен, а затем полностью убран нижний отступ у блока с toolbar и filter.
- В результате список объектов начинается заметно ближе к строке фильтра.

### 3. Диагностика NotebookLM

- Проверено поведение NotebookLM MCP и CLI на этой Windows-машине.
- MCP `get_health` возвращал `authenticated: true`, но реальный `mcp__notebooklm__ask_question` падал с:
  - `browserType.launchPersistentContext`
  - `Target page, context or browser has been closed`
- При этом в момент диагностики CLI ещё подтверждал доступ к notebook:
  - `python -m notebooklm list --json` видел notebook `Scanline Engine`
  - `python -m notebooklm ask ... --notebook 9f146be7-7c4a-4bb0-b7b4-7f20079e85b0 --json` успешно отвечал

### 4. Обновление глобальных NotebookLM skills

- В `C:\Users\Professional\.codex\skills\notebooklm\SKILL.md` добавлен Windows-specific reliability override:
  - нельзя доверять только `get_health`
  - нужен реальный smoke-test через `ask_question`
  - при падении MCP нужно сразу проверять CLI
  - если CLI жив, можно продолжать работу через CLI, не блокируя задачу на починке MCP
- В `C:\Users\Professional\.codex\skills\notebooklm-cli\SKILL.md` добавлено правило, что на этой машине CLI является предпочтительным fallback при ошибках `launchPersistentContext`.

### 5. Обновление project instructions

- В `AGENTS.md` проекта добавлен `NotebookLM Connectivity Rule`.
- Теперь новый агент прямо из project-level instructions увидит:
  - что `get_health` недостаточно;
  - что нужен реальный `ask_question` smoke-test;
  - что при browser-launch ошибках надо немедленно проверить CLI;
  - что CLI fallback допустим для project recall;
  - что MCP repair нужен только если обе ветки сломаны или задача явно про ремонт NotebookLM.

## Important Architecture / Runtime Decisions

### NotebookLM readiness must be validated by a real query

- Для этой машины `authenticated: true` в MCP не означает, что NotebookLM реально доступен.
- Рабочим считается только путь, который прошёл живой query:
  - либо MCP `ask_question`,
  - либо CLI `python -m notebooklm ask ... --notebook <uuid> --json`.

### CLI fallback is acceptable for project recall

- Если MCP ломается на browser/profile launch, а CLI ещё отвечает, нужно использовать CLI для recall вместо остановки работы.
- Починка MCP должна быть отдельным troubleshooting flow, а не обязательным блокером каждой сессии.

## Parser / Mechanics / Scene / Subscene / Inventory Changes

- Архитектурных изменений runtime/parser/mechanics в этой сессии не вносилось.
- Изменения затронули editor UI (`HierarchyPanel`) и project/process documentation around NotebookLM usage.

## Tests Run

- `npm run typecheck`
  - Passed

## Commits Created During the Session

- Коммитов в этой сессии не создавалось.

## Remaining Work / Next Recommended Steps

1. Если нужен именно MCP path, провести отдельный repair pass:
   - закрыть все Chrome/Chromium окна;
   - при необходимости выполнить cleanup persistent profile;
   - заново пройти auth;
   - повторно проверить не только `get_health`, но и реальный `ask_question`.
2. Если важнее просто рабочий NotebookLM recall, можно продолжать использовать CLI path, когда он авторизован.
3. При следующем визуальном polish-pass панели editor можно при желании ещё подправить стиль `+ADD`, чтобы он выглядел ближе к компактной кнопке.

## Risks, Caveats, Open Questions, Or Non-Committed Changes

- На момент wrap-up NotebookLM upload шага выполнить не удалось:
  - CLI-команды `source list/add` начали отвечать `Authentication expired or invalid`
  - поэтому актуальный `Sessions.md` не был перезалит в notebook автоматически
- Важно: в ходе одной и той же сессии NotebookLM CLI сначала успешно отвечал на `list` и `ask`, а позже уже сообщал об истёкшей auth-сессии. Значит, состояние NotebookLM может быть нестабильным и его нужно перепроверять непосредственно перед операциями записи/загрузки.
- Изменения в глобальных skill-файлах находятся вне репозитория, но важны для будущих локальных сессий на этой машине.

## Session Entry - 2026-04-17 14:08 +02:00

## Session Goals

1. Clarify whether `local_rag` is available and why an initial project-context lookup returned no content.
2. Configure `local_rag` so it indexes Quest project documentation, not only exported memory docs.
3. Document the intended knowledge-recall model for future agents.
4. Extend the local `wrap-up-session` skill so wrap-up sends richer project context to NotebookLM.

## What Was Implemented

### 1. local_rag availability and indexing model

- Confirmed `agent_memory` was available with hundreds of durable records.
- Confirmed `local_rag` was available and already indexed exported memory docs.
- Found the initial miss cause: `mcp__local_rag__summarize_project_context` was called with full Windows path context `D:\GAMES\New folder\Quest`, while indexed memory docs use context label `Quest`.
- Verified that `mcp__local_rag__semantic_search` worked across the index and returned Quest-related memory docs.

### 2. Project documentation mirroring into local_rag

- Updated local RAG startup script:
  - `C:\Users\Professional\.codex\tools\agent-memory-mcp\start-local-rag.ps1`
- Added `Sync-QuestProjectDocsForRag`, which mirrors root Quest documentation into:
  - `C:\Users\Professional\.codex\tools\agent-memory-mcp\local-rag-data\docs\projects\Quest`
- Mirrored files include root human-authored docs such as:
  - `AGENTS.md`
  - `Autotests.md`
  - `Commands.md`
  - `GDD.md`
  - `InventorySys.md`
  - `Parser.md`
  - `ParserSmoke.md`
  - `README.md`
  - `Sessions.md`
  - `Tauri.md`
  - `TextAssets.md`
  - `tech-spec.md`
- Excluded noisy/service folders such as `.git`, `node_modules`, `dist`, `.agent`, `.playwright-mcp`, and similar generated/tooling folders.
- Ran a manual mirror and `mcp__local_rag__index_documents`.
- Verified `mcp__local_rag__repo_list` now sees `docs/projects/Quest`.
- Verified semantic search returns root project docs such as `docs/projects/Quest/AGENTS.md` and `docs/projects/Quest/Autotests.md`.

### 3. Knowledge recall model documented

- Added a `Knowledge Recall Model` section to project `AGENTS.md`.
- The documented source order is:
  1. `agent_memory` for precise durable facts, decisions, runbooks, incidents, commit context, and fresh conclusions.
  2. NotebookLM for broad architecture/document synthesis, after a real readiness/smoke test.
  3. `local_rag` as local fallback/sidecar for fuzzy recall, semantic search, and related-doc discovery.
  4. The repository itself as source of truth for current code, verified with `rg`, file reads, and tests.
- Documented key `local_rag` caveats:
  - use `context: "Quest"` for `summarize_project_context`, not the full Windows path;
  - use `semantic_search` when the exact document or memory title is unknown;
  - use `repo_list` with `path: "docs/projects/Quest"` to verify project-doc mirror visibility;
  - fresh `agent_memory` entries may not appear in `local_rag` until the mirror/index refreshes.

### 4. wrap-up-session skill extended

- Updated local skill:
  - `C:\Users\Professional\.codex\skills\wrap-up-session\SKILL.md`
- Added script:
  - `C:\Users\Professional\.codex\skills\wrap-up-session\scripts\build-notebooklm-memory-dump.ps1`
- New wrap-up contract:
  - append/update `Sessions.md`;
  - record durable facts to `agent_memory`;
  - refresh the local RAG memory-doc mirror when possible;
  - build a curated `AgentMemory.md`;
  - replace NotebookLM sources `Sessions.md`, `GDD.md`, and `AgentMemory.md`.
- `AgentMemory.md` is generated outside the repo by default:
  - `C:\Users\Professional\.codex\tmp\notebooklm-wrap-up\AgentMemory.md`
- The memory dump filters out:
  - `working` memory;
  - review queue / review-required records;
  - records unrelated to Quest / Scanline / autotests terms.
- `GDD.md` was added to the NotebookLM replacement set because Project Flow can change it when feature implementation changes.

## Important Architecture / Runtime Decisions

- `local_rag` is not live `agent_memory`; it indexes a file mirror.
- Use `agent_memory` directly for freshest durable facts.
- Use `local_rag` for semantic/fuzzy retrieval across exported memory and mirrored project docs.
- NotebookLM remains the broad synthesis layer but must be treated as unstable on this machine and checked with a real CLI/MCP query before relying on it.
- `GDD.md` should be kept in NotebookLM along with `Sessions.md` and curated memory because gameplay feature implementation can update product/design direction.

## Parser / Mechanics / Scene / Subscene / Inventory Changes

- No runtime/parser/mechanics implementation changes were made in this wrap-up work.
- The work was infrastructure/process/documentation oriented:
  - local RAG indexing setup;
  - project instructions;
  - wrap-up skill behavior;
  - NotebookLM source replacement workflow.

## Tests And Checks Run

- `mcp__local_rag__index_documents`
  - Passed.
- `mcp__local_rag__repo_list` for `docs/projects/Quest`
  - Confirmed project docs are visible.
- `mcp__local_rag__semantic_search`
  - Confirmed new `AGENTS.md` knowledge model is searchable.
- PowerShell parser check for:
  - `C:\Users\Professional\.codex\tools\agent-memory-mcp\start-local-rag.ps1`
  - Passed.
- `python C:\Users\Professional\.codex\skills\.system\skill-creator\scripts\quick_validate.py C:\Users\Professional\.codex\skills\wrap-up-session`
  - Passed: `Skill is valid!`
- PowerShell parser check for:
  - `C:\Users\Professional\.codex\skills\wrap-up-session\scripts\build-notebooklm-memory-dump.ps1`
  - Passed.
- Test generation of `AgentMemory.md`
  - Passed, then temporary test files were removed.

## Commits Created During The Session

- No git commits were created during this wrap-up/configuration session.
- Recent prior commits visible in history included:
  - `1ae89ec` - `Fix PUT target validation before source clarification`
  - `468c154` - `Fixed critical "matroska" issue with putting items into itself and also incorrect recursive cointainer finding`
  - `2344069` - `AI rules update`
  - `ae2fcdf` - `Fix undo preserving polygon spatial nesting`
  - `7f92b28` - `Fix subscene surface placement semantics`

## Remaining Work / Next Recommended Steps

1. On a future full wrap-up, verify NotebookLM auth immediately before source replacement:
   - `python -m notebooklm list --json`
   - `python -m notebooklm ask "ping..." --notebook 9f146be7-7c4a-4bb0-b7b4-7f20079e85b0 --json`
2. If CLI auth fails, re-authenticate with `python -m notebooklm login` or repair state using the project NotebookLM connectivity rule.
3. Consider adding a deterministic helper script later for NotebookLM replacement itself if CLI source deletion/addition remains repetitive or fragile.
4. Consider including a small `wrap-up` dry-run mode later to preview `AgentMemory.md` selection before NotebookLM upload.

## Risks, Caveats, Open Questions, Or Non-Committed Changes

- Changes to local skill files and local RAG startup script are outside the Quest git repository.
- `Sessions.md` was updated in the repository during this wrap-up, so the repo has an uncommitted documentation change after this entry.
- The local RAG memory mirror can lag behind live `agent_memory`; future wrap-up runs should record durable facts first, then refresh/export memory, then build `AgentMemory.md`.
- NotebookLM source replacement may still be blocked by auth instability on this Windows machine.
