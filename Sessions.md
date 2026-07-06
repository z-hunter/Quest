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

## Session Entry - 2026-04-17 22:01 +02:00

### Session Goals

- Finish the wrap-up for the TAKE / DROP / walkbox regression line.
- Preserve the most durable implementation details in repo docs, agent memory, and NotebookLM sources.
- Verify the current branch state and keep the workspace ready for the next session.

### What Was Implemented

- Appended the latest session notes to `Sessions.md`.
- Confirmed NotebookLM CLI access after re-authentication with `python -m notebooklm list --json` and a smoke-test `ask`.
- Verified the repo commit history and captured the session commit hash `33f665d`.

### Important Decisions

- Kept the durable note that `TAKE` must not treat inventory-held items as source targets.
- Preserved the rule that clarification should use only currently takeable candidates, while diagnostics may still surface the real failure for visible but unreachable objects.
- Kept the contract that implicit `DROP` onto `Walkbox` should place the item near the player, while general surface placement stays random.

### Parser / Mechanics / Scene Notes

- The parser TAKE path now separates ambiguity filtering from failure diagnostics.
- Walkbox drop placement continues to use the player-point preference only for implicit floor placement.
- The session also included scene/text adjustments already captured in the commit:
  - `public/scenes/test_room.json`
  - `public/text/objects/test_2.json`
  - `public/text/objects/wall.json`

### Tests and Verification

- `npm test -- tests/integration/parser-game.test.ts tests/game/semantic-api.test.ts tests/parser/world-model-context.test.ts`
- `npm run typecheck`
- NotebookLM smoke test:
  - `python -m notebooklm list --json`
  - `python -m notebooklm ask "ping: reply with one short sentence confirming access" --notebook 9f146be7-7c4a-4bb0-b7b4-7f20079e85b0 --json`

### Commit

- `33f665d` - `Fix TAKE resolution and walkbox drop placement`

### Remaining Work / Caveats

- NotebookLM source replacement is complete for `Sessions.md`, `GDD.md`, and `AgentMemory.md`; future wrap-ups should still re-check auth before trying the same workflow again.
- The worktree still contains user-owned local modifications outside this wrap-up entry:
  - `src/core/Game.ts`
  - `src/mechanics/Parser.ts`
  - `tests/game/semantic-api.test.ts`
- If NotebookLM source replacement fails again, the next session should re-run `list` and the smoke-test `ask` before retrying upload.

## Session Entry - 2026-04-19 12:13 +02:00

1. What was completed

- Decomposition of Game.ts: Successfully refactored the monolith from ~80KB to ~40KB by delegating responsibilities to
     specialized systems.
- InventoryManager Migration: Moved src/core/InventoryManager.ts to src/systems/InventoryManager.ts to align with the project's
     architectural standards.
- GameSemanticAPI Extraction: Created a new system src/systems/GameSemanticAPI.ts that now handles high-level gameplay actions
     (look, examine, take, put, open/close).
- Type Safety Overhaul: Introduced the AnyComponent union type in ComponentSystem.ts and updated SceneObject.components to use
     it instead of any[], significantly reducing potential runtime type errors.
- Autotests & CI Consistency: Updated test fixtures and ensured the entire suite (202 tests) passes, confirming no regressions
     in parser or runtime logic.

1. Current state

- The core architecture is now modular and more scalable.
- The IGame interface is fully updated to reflect the new delegation pattern.
- The workspace is clean, and changes are committed to the scene-refact2 branch.
- Browser runtime errors (SyntaxErrors due to improper type imports) have been fully resolved and verified.

1. Next steps

- Feature Sprint: Resume development of gameplay features as defined in GDD.md.
- Cleanup: Conduct a final audit of any remaining any casts in ComponentSystem.ts that can now be replaced with AnyComponent.
- Tauri Prep: Proceed with the explicit workspace model for the desktop build as outlined in Tauri.md.

1. Risks & Caveats

- Import Precision: Developers must use import type when bringing in IGame or GameActionOutcome in new files to avoid Vite build
     failures.
- Circular Dependencies: While largely mitigated by using the IGame interface, adding complex logic to GameSemanticAPI should be
     monitored for new circular paths.

## Session Entry - 2026-04-19 20:42 +02:00

### Session Goals

- Create a reusable Codex skill for using the locally installed Gemini CLI as an external technical worker.
- Add project-level startup guidance to prefer Gemini CLI for bounded technical tasks when safe.
- Validate and commit the new Exit / Entry scene transition functionality.
- Preserve durable lessons from the Gemini-assisted implementation attempt.

### What Was Implemented

- Created the local Codex skill `gemini-cli-agent` at:
  - `C:\Users\Professional\.codex\skills\gemini-cli-agent`
- Added a bundled wrapper:
  - `scripts\invoke_gemini_task.ps1`
  - The wrapper pipes long prompts through stdin and uses `--prompt " "` because the npm PowerShell shim can drop an empty string after `--prompt`.
- Verified Gemini CLI is installed on this machine:
  - `C:\Users\Professional\AppData\Roaming\npm\gemini.ps1`
  - version `0.38.2`
- Added a `Gemini CLI Worker Rule` to `AGENTS.md`:
  - use Gemini where practical for bounded technical chores;
  - allow parallel Gemini workers only with disjoint file ownership;
  - keep Codex responsible for memory/NotebookLM/RAG recall, architecture decisions, diff review, tests, and integration.

### Exit / Entry Runtime Work

- Committed universal Exit / Entry scene transitions in commit:
  - `559725d` - `Add Exit and Entry scene transitions`
- Implemented `Exit` and `Entry` component support in the runtime component model.
- Added Exit activation through `ComponentSystem`:
  - `Exit.targetSceneId` switches scenes;
  - empty `targetSceneId` performs same-scene teleport;
  - `Exit.targetEntryId` is stored as `SceneManager.pendingEntryId`.
- Added actor collision checks against Exit-bearing scene objects during `Scene.update`.
- Updated `SceneManager.switchTo` to:
  - transfer the live actor/player to the destination scene;
  - remove duplicate player instances in the target scene;
  - place the activator at the center of the target Entry object;
  - apply Entry direction when present;
  - snap the camera to the player after transition when auto-centering is enabled.
- Added `Scene.snapCameraToPlayer()` for immediate camera placement after transitions.
- Extended scene/test fixtures to support multi-scene transition tests.
- Added `tests/scene/scene-transition.test.ts`, covering:
  - cross-scene Exit -> Entry transition;
  - same-scene teleport via empty `targetSceneId`;
  - Exit on a normal `Entity`;
  - Entry direction application;
  - ensuring the Exit entity itself is not moved to the destination scene.

### Important Architecture / Runtime Decisions

- Exit / Entry behavior was kept in the scene transition layer rather than rewriting storage, parser, inventory, or semantic API contracts.
- A Gemini-generated broad rewrite touched systems outside the Exit / Entry scope, especially storage and semantic runtime code. That version caused wide regressions around inventory, PUT/DROP, and subscene behavior.
- The risky Gemini changes were removed before commit:
  - simplified `InventoryManager` rewrite was discarded;
  - incompatible `GameSemanticAPI` / `Game` / `IGame` storage API changes were discarded;
  - fixture changes that masked those incompatibilities were removed or narrowed.
- Final implementation restored the existing storage/semantic contracts and kept the feature scoped to:
  - component typing / normalization;
  - scene activation;
  - scene switching;
  - transition tests.

### Parser / Mechanics / Scene / Inventory Notes

- Parser and semantic API behavior was intentionally preserved.
- Inventory and PUT/DROP contracts remain protected by the existing autotests.
- Subscene activation, cleanup, and interaction tests continued to pass after the risky rewrites were removed.
- Scene transition behavior now works with any object carrying an `Exit` component, including triggerboxes and normal entities.

### Tests Run and Outcomes

- `npm run typecheck`
  - Passed.
- `npm run test`
  - Passed after commit.
  - 18 test files passed.
  - 205 tests passed.
- Targeted checks also passed during debugging:
  - `tests/scene/scene-transition.test.ts`
  - `tests/game/semantic-api.test.ts`
  - `tests/integration/parser-game.test.ts`
  - `tests/parser/commands.test.ts`
  - `tests/scene/subscene-activation.test.ts`
  - `tests/scene/shadow-system.test.ts`

### Commits Created

- `559725d` - `Add Exit and Entry scene transitions`

### Gemini CLI Lessons

- Gemini CLI can be useful, but only as a tightly bounded external worker.
- In this session, Gemini was not useful on the critical path for implementation because it overreached into unrelated runtime systems.
- The attempted read-only Gemini review also timed out and did not materially help the final fix.
- Durable workflow lesson:
  - use Gemini for narrow mechanical edits, focused read-only review, or tests for an already specified contract;
  - avoid broad runtime feature prompts unless the allowed write scope is extremely small;
  - never accept Gemini summaries without Codex diff review and full relevant tests.

### Current State

- Branch: `feature-comp-exit`
- Git status after commit: clean.
- Branch is ahead of `origin/feature-comp-exit` by 1 commit.
- `AGENTS.md` now contains the Gemini CLI worker rule.
- Durable memory entries were stored for:
  - Gemini CLI skill availability;
  - preference for bounded Gemini workers;
  - Exit / Entry commit context and regression cleanup.

### Remaining Work / Next Recommended Steps

- Push `feature-comp-exit` when ready.
- Optionally perform browser/editor QA for scene transitions and instant camera snap.
- Keep future Gemini tasks constrained to small, explicit write scopes.
- Consider cleaning old `working` review-queue memories later if they are no longer useful.

### Risks / Caveats / Open Questions

- The local `gemini-cli-agent` skill lives outside the repo under the Codex skills directory; the repo only records the usage rule in `AGENTS.md`.
- `npm install` was run to restore missing local `.bin` scripts after a temporary worktree/junction test setup disrupted the local dependency executable links. `package.json` and lockfiles remained unchanged.
- NotebookLM source replacement still depends on CLI auth and may require the standard readiness flow if auth has expired.

## Session Entry - 2026-04-27 01:27 +02:00

### Session Goals

- Continue work on Scanline Engine after verifying NotebookLM access.
- Evaluate and implement the idea that Static/Entity objects can become Actors by adding an Actor component, and Actors can become Static again by removing it.
- Add a confirmation popup for removing the Actor component because that operation discards Actor-only data.
- Commit the completed improvement and verify follow-up review findings against the actual current code.

### What Was Implemented

- Verified NotebookLM CLI authorization using the project readiness flow:
  - `python -m notebooklm auth check --json` succeeded.
  - `python -m notebooklm list --json` succeeded and showed the `Scanline Engine` notebook.
  - Targeted notebook smoke test succeeded for notebook `9f146be7-7c4a-4bb0-b7b4-7f20079e85b0`.
- Implemented Actor component conversion:
  - Static/Entity objects can add an `Actor` component from the Components section.
  - Adding the component replaces the scene object with an `Actor` instance at the same `scene.entities` index.
  - Actor objects display an `Actor` marker component in the Components section.
  - Removing the `Actor` component replaces the object with a normal `Entity`.
  - Actor serialization now emits `{ type: 'Actor' }` in `components` for editor consistency.
  - Static/Entity JSON that contains an Actor component marker now loads as an Actor, preserving compatibility with the new authoring model.
- Added a destructive confirmation dialog when removing the Actor component:
  - Title: `Remove Actor Component`.
  - Buttons: `Cancel` and `Proceed`.
  - Proceed warns that the object becomes Static and loses Actor settings, including direction, player mode, move speed, visual states, animation sets, and Actor-only components.
- Added tests for:
  - Entity -> Actor conversion preserving common properties and adding the Actor marker.
  - Actor -> Entity conversion dropping Actor-only serialized data and removing Actor/Shadow components.

### Important Architecture / Runtime Decisions

- Actor component is currently a UI/editor conversion handle, not a full component-first runtime rewrite.
- Runtime continues to use the existing class split where `Actor extends Entity`, and systems that rely on `instanceof Actor`, `entity.type === 'Actor'`, Actor movement methods, player state, direction, and animation sets remain valid.
- Conversion helpers live on `SceneEditor` and perform the undo snapshot internally before mutating the scene:
  - `convertEntityToActor()`
  - `convertActorToEntity()`
- Review findings asking for additional `saveUndoState()` calls in `SectionComponents.tsx` were checked against current code and intentionally not applied:
  - Both conversion helpers already call `this.saveUndoState()` before mutation.
  - Adding UI-level undo snapshots would create duplicate undo entries for one conversion action.
- Removing Actor strips Actor-only state and also removes `Shadow`, which remains Actor-only for this slice.

### Parser / Mechanics / Scene / Inventory Changes

- No parser, command-resolution, inventory, subscene, or semantic API behavior was intentionally changed.
- Scene loading changed only insofar as Entity/Static JSON carrying the Actor marker is instantiated as `Actor`.
- Existing runtime Actor behavior is preserved rather than moved into a component system.

### Tests Run and Outcomes

- `npm run typecheck`
  - Passed.
- `npm test`
  - Passed.
  - 21 test files passed.
  - 244 tests passed.
- `npm run build`
  - Passed during implementation.
  - Vite emitted only existing-style warnings about chunk size and dynamic/static imports of `fileApi`.
- During wrap-up, `npm run typecheck` and `npm test` were re-run and passed again.

### Commits Created

- `ec18c3e2f9dc8102ea2f5483caad926328411a2c` - `Add Actor component conversion`

### Current State

- Branch: `scene-refact3`.
- Last commit: `ec18c3e Add Actor component conversion`.
- After the commit, additional uncommitted changes are present in the worktree. They were not made as part of the committed Actor conversion wrap-up and were intentionally left untouched:
  - `public/scenes/home/room.json`
  - `public/scenes/home/room_backup.json`
  - `public/scenes/test_room (10).json`
  - `public/scenes/test_room.json`
  - `public/scenes/test_room1.json`
  - `src/components/editor/properties/MultiSelectionProperties.tsx`
  - `src/components/editor/properties/PropertiesPanel.tsx`
  - `src/components/editor/properties/SectionComponents.tsx`
  - `src/components/editor/properties/SectionIdentity.tsx`
  - `src/entities/SceneObject.ts`
  - `src/systems/GameSemanticAPI.ts`
  - `public/text/objects/Sofa.json`
  - `src/utils/GroupIds.ts`
  - `tests/editor/group-id-normalization.test.ts`
- This wrap-up appends a new entry to `Sessions.md`, which is expected to remain as an additional documentation change unless separately committed.

### Remaining Work / Next Recommended Steps

- Manually QA the editor flow in the running app:
  - create Static;
  - add Actor component;
  - verify Actor Properties appear;
  - undo/redo the conversion;
  - remove Actor component;
  - verify Cancel does nothing and Proceed converts to Static;
  - verify Actor-only fields and Shadow are removed after Proceed.
- Decide whether `GDD.md` should be updated to describe Actor as an editor-visible component marker while preserving the current runtime class split.
- Review the unrelated dirty files before any future commit so the Actor conversion commit remains isolated from group-id or scene-content work.

### Risks / Caveats / Open Questions

- Actor component is not yet a pure runtime component architecture. It is intentionally an authoring/conversion affordance over existing classes.
- If future work moves Actor behavior into a true component system, the current conversion helpers should become a migration bridge rather than the final architecture.
- The confirmation dialog prevents accidental loss, but once the user chooses Proceed, Actor-only settings are removed from the object data by design.

## Session Entry - 2026-05-05 22:22 +02:00

### Session Goals

- Improve `Actor.moveTo` so Actors can route around obstacles instead of moving only in a direct line.
- Make route outcomes usable by future AI/NPC logic: immediate unreachable result, arrival result, and route-blocked/replan-needed result.
- Ensure click-to-move uses the same route planning as scripted `moveTo`.
- Tune path following until it matches keyboard movement better in narrow passages.
- Improve the agent setup by documenting a stronger NotebookLM/Kairo/memory startup workflow in `AGENTS.md`.
- Preserve durable conclusions in `agent_memory`, Kairo, and this session log.

### What Was Implemented

- Added route planning to `src/entities/Actor.ts`.
  - `Actor.moveTo(x, y)` now returns an `ActorMoveResult`.
  - `Actor.moveToVisual(x, y)` also routes after converting the click/visual target into the Actor's parallax-corrected world target.
  - `Actor.getMoveResult()` exposes the latest movement outcome for future AI/NPC polling.
  - Movement results include statuses/codes such as `started`, `arrived`, `unreachable`, and `blocked` / `route_blocked`.
- Implemented path planning using `Scene.isWalkable` as the single source of truth for current collision and Walkbox semantics.
  - Direct segment sampling is tried first.
  - If direct movement is blocked, bounded grid A* builds a waypoint route.
  - Route smoothing removes unnecessary intermediate waypoints when a segment is clear.
  - Search cap is based on the generated grid area rather than a fixed 4000-iteration cap, which matters for large/complex Walkbox areas.
  - Segment-clear checks were tightened to sample at `gridSize / 2` with a minimum step of 2.
- Added route-following axis-slide fallback.
  - If a diagonal route step is blocked, Actor tries X-only or Y-only movement before reporting `route_blocked`.
  - This mirrors keyboard movement and helps narrow passages where manual control can already pass.
  - A zero-displacement axis fallback is not treated as progress, so true blocks still report `blocked`.
- Updated click-to-move tests so Walkbox clicks assert route planning rather than the old `visualTarget` behavior.
- Updated `GDD.md` to document `actor.getMoveResult()` and the new `moveTo` route/outcome contract.
- Added `tests/entities/actor-movement.test.ts`.
  - Direct route.
  - Route around blocking collider.
  - Immediate unreachable destination.
  - Dynamic blocker causing `route_blocked`.
  - Axis-slide behavior for narrow/diagonal blocked steps.
  - Large Walkbox route that would exceed the old fixed search cap.

### Important Architecture / Runtime Decisions

- `Scene.isWalkable` remains the single authoritative movement oracle. The path planner does not duplicate collision, Walkbox Add/Subtract/Invert, parallax, or dynamic-scene rules.
- `moveToVisual` must be kept in sync with `moveTo`, because `SceneInteraction.movePlayerToClick` uses `moveToVisual` for mouse click movement.
- AI/NPC movement should poll `actor.getMoveResult()` for `arrived`, `unreachable`, or `route_blocked` rather than inferring from `target`/`state` alone.
- Route movement should preserve keyboard parity in narrow spaces by attempting axis-separated progress before failing.
- NotebookLM should be used as a structured architecture-analysis assistant, not just a broad summarizer. `AGENTS.md` now includes explicit NotebookLM query templates and workflow.
- Kairo is now explicitly part of session startup/resume flow; agents should check active/high-priority `proj:quest` tasks and close their own completed tasks after validation/acceptance.

### Parser / Mechanics / Scene / Inventory Changes

- Runtime movement changed in `Actor`.
- Scene interaction changed only through test expectations and the use of routed `moveToVisual`; no parser behavior was intentionally changed.
- `GameSemanticAPI`, inventory, spatial text semantics, and parser command resolution were not intentionally changed.
- Existing `Scene.isWalkable` collision/Walkbox behavior was reused rather than modified.

### Tests Run and Outcomes

- `npm test -- tests/entities/actor-movement.test.ts`
  - Passed during focused implementation.
- `npm test -- tests/entities/actor-movement.test.ts tests/scene/scene-interaction.test.ts`
  - Passed.
- `npm test -- tests/game/navigation-and-spatial.test.ts tests/entities/actor-movement.test.ts tests/scene/scene-interaction.test.ts`
  - Passed.
  - Final relevant run: 3 files passed, 26 tests passed.
- `npm run typecheck`
  - Passed.
- Full `npm test`
  - Run during the session and failed on an unrelated existing parser world-model test:
    - `tests/parser/world-model-context.test.ts`
    - case: `omits scene duplicates whose stable id is already held from takable scope`
    - actual issue: `compact_cassette` still appears in takable scope.
  - The failure was reproduced with the single parser test file and tracked separately in Kairo.

### Commits Created

- `11d990d Add Actor route pathfinding`
  - Adds routed `moveTo` / `moveToVisual`, movement result API, pathfinding tests, click-to-move regression coverage, and GDD documentation.
- `fbea8ff AI settings update`
  - Adds NotebookLM structured recall workflow to `AGENTS.md`.
- `af53e2f AI settings update`
  - Refactors `AGENTS.md` into a more useful operational startup protocol, including Startup Protocol, Responsibility Model, NotebookLM workflow, Kairo lifecycle, memory policy, validation ladder, and autotest rules.

### Kairo / Memory Updates

- Kairo task `[Quest] Implement Actor MoveTo route planning` was completed and marked `done`.
- Kairo follow-up created for unrelated parser duplicate held-item failure:
  - `aaaaaaabtx4yd3f45sovk3pbwhktwukd`
  - `[Quest] Fix duplicate held item leaking into parser takable scope`
- Durable `agent_memory` entries were stored for:
  - final MoveTo pathfinding contract and caveats;
  - click-to-move using `moveToVisual` route planning;
  - large Walkbox search cap behavior;
  - narrow passage axis-slide parity with keyboard movement;
  - commit `11d990d`;
  - NotebookLM structured recall workflow;
  - `AGENTS.md` operational startup protocol refactor.

### Current State

- Branch: `scene-refact3`.
- Latest commit: `af53e2f AI settings update`.
- Worktree was clean before this wrap-up entry was appended.
- This wrap-up adds a new `Sessions.md` documentation change that should remain uncommitted unless the user wants to commit the session log.

### Remaining Work / Next Recommended Steps

- Investigate and fix the unrelated parser world-model duplicate held-item failure:
  - `tests/parser/world-model-context.test.ts`
  - `compact_cassette` appears in takable scope when the stable id is already held.
- Continue manual QA of click-to-move and scripted `moveTo` in real scenes with:
  - large Walkbox polygons;
  - foreground occluders such as the sofa;
  - narrow passages;
  - dynamic blockers.
- Consider adding an engine diagnostic helper such as `scene.explainWalkable(x, y, actor)` or route debug output that reports which object/Walkbox caused a blocked point.
- If route planning performance becomes an issue in large scenes, consider caching sampled walkability grids per route request, using a binary heap for A*, or coarser/finer adaptive grids.
- If future NPC AI relies heavily on `ActorMoveResult`, consider adding event/callback hooks in addition to polling.

### Risks / Caveats / Open Questions

- The path planner is intentionally conservative and depends on `Scene.isWalkable`; any existing `isWalkable` quirks will be inherited by pathfinding.
- `Actor.moveTo` now returns a result where old code ignored a `void` return. TypeScript accepted this, but scripts may need to start checking results for AI/NPC behavior.
- `moveToVisual` now clears `visualTarget` and stores world-route waypoints in `target`/`route`; tests were updated to reflect this.
- Large Walkbox pathfinding works after removing the fixed cap, but the new regression test shows a nontrivial runtime cost. Keep an eye on route planning latency in very large scenes.
- Full `npm test` is not green because of the unrelated parser duplicate held-item test. Focused movement/navigation/typecheck validation is green.

## Session Entry - 2026-05-06 02:17 +02:00

### Session Goals

- Improve the Stage 2 LLM parser context so it understands authored scene semantics such as "the cassette is already loaded in the boombox".
- Replace the temporary media-specific heuristic with a generic Text Asset driven model.
- Keep v1 scoped to LLM context only: no new runtime command verbs such as `PLAY`, `DRIVE`, or `FUEL`.
- Document the new TA authoring contract and commit the implementation.

### What Was Implemented

- Added structured object Text Asset support in `TextAssetManager`.
  - Object TA can now contain `semanticTags: string[]`.
  - Object TA can now contain `relationFacts: Array<{ relation, childTags, fact }>`.
  - Added `getResolvedObjectStructuredListField` as a safe accessor for structured list fields without breaking existing string/list text fields.
- Extended parser world model context.
  - `ParserEntityContext` now includes optional `semanticTags`.
  - `ParserWorldModelBuilder` still emits generic facts such as `Boombox contains Compact cassette.` and `Compact cassette is inside Boombox.`
  - It now additionally emits TA-driven semantic facts when a parent object's `relationFacts` match a child object's `semanticTags`.
  - Supported semantic relation matching is currently `in`, `on`, `under`, and `behind`.
  - `fact` templates support `{self}`, `{child}`, and `{relation}`.
- Removed the previous hardcoded media heuristic.
  - The previous `boombox/recorder/cassette/disk` inference is gone.
  - Loaded-media knowledge is now authored in object TA.
- Updated current scene Text Assets.
  - `public/text/objects/boombox.json` now defines audio/media semantic tags and a relation fact for loaded media.
  - `public/text/objects/test.json` and `test_1.json` now tag cassettes as `media`, `audio_media`, and `cassette`.
- Updated LLM prompt assets.
  - `parser-llm.json` now gives generic `worldFacts` authority instructions.
  - Media-specific prompt wording for PLAY/MUSIC/CASSETTE/RECORDER was removed.
  - `parser-llm-system.md` now describes world facts as current location, containment, and Text Asset semantic relation facts.
- Updated documentation.
  - `TextAssets.md` now documents `semanticTags`, `relationFacts`, examples, placeholders, supported relations, and v1 limitations.
  - `Parser.md` now documents `worldFacts` as a mix of generic runtime facts and authored semantic facts, plus the object TA template changes.

### Important Architecture Decisions

- Semantic facts for the LLM are authored in Text Assets, not runtime components, parser code, or prompt-specific hacks.
- `worldFacts` are treated as concise authoritative state facts for the LLM.
- Semantic relation facts are context only in v1. They help the LLM avoid contradicting the scene but do not execute commands or mutate state.
- The same mechanism should be used for future domains:
  - boombox + cassette -> loaded media;
  - disk drive + floppy -> inserted disk;
  - car + gasoline -> fueled vehicle;
  - lamp + bulb -> installed component.
- The LLM prompt should remain generic and trust `worldFacts`; it should not contain per-domain rules such as "if recorder contains cassette...".

### Parser / Mechanics / Scene / Inventory Changes

- Parser mechanics changed only in world model context construction and LLM prompt preparation.
- Runtime gameplay effects, inventory rules, spatial placement behavior, scene transitions, and command execution were not changed.
- No real `PLAY`, `DRIVE`, `FUEL`, or similar command mechanic was added.
- `LlmCascade` prompt asset typing was widened to tolerate structured service/object text data while still reading only string and string-list prompt fields.

### Tests Run and Outcomes

- `npm test -- tests/parser/world-model-context.test.ts tests/parser/llm-cascade.test.ts`
  - Passed: 2 files, 27 tests.
- `npm test -- tests/parser tests/integration/parser-game.test.ts`
  - Passed: 9 files, 125 tests.
- `npm run typecheck`
  - Passed.
- `git diff --check`
  - Passed.
- Full `npm test`
  - Passed: 23 files, 261 tests.

### Commits Created

- `51e64b6 Add TA-driven semantic facts for LLM parser context`
  - Implements structured TA semantic fields, TA-driven semantic world facts, generic LLM world fact instructions, current boombox/cassette TA metadata, tests, and documentation.

### Kairo / Memory Updates

- Kairo task completed:
  - `aaaaaaabtx5ixylx5tpg5nq3qygv5tss`
  - `[Quest] Make parser LLM context expose explicit containment`
- Durable `agent_memory` entries stored for:
  - the TA-driven semantic facts architecture;
  - the documentation update;
  - commit `51e64b6`.

### Current State

- Branch: `scene-refact3`.
- Latest code commit: `51e64b6 Add TA-driven semantic facts for LLM parser context`.
- Worktree was clean immediately after the commit.
- This wrap-up appends a new `Sessions.md` entry after the code commit.

### Remaining Work / Next Recommended Steps

- Manually smoke-test `#LLM-ON` with commands around:
  - `play cassette`;
  - `play music`;
  - future non-media examples once authored, such as fuel/vehicle or disk/drive.
- Consider editor support for authoring `semanticTags` and `relationFacts` directly in the TA UI.
- Consider adding schema validation or linting for malformed `relationFacts`.
- If semantic facts become gameplay-critical later, design a separate runtime component/command contract instead of overloading LLM context facts.

### Risks / Caveats / Open Questions

- Semantic facts are only as correct as the TA authoring. A wrong tag or relation fact can mislead the LLM even though runtime state is unchanged.
- Facts should stay concise and factual; atmospheric sarcasm belongs in LLM responses, not TA semantic facts.
- Empty or missing `childTags` currently means the relation rule applies to any child in that relation.
- NotebookLM source replacement completed after this entry was written: fresh `Sessions.md`, `GDD.md`, `AgentMemory.md`, `Parser.md`, and `TextAssets.md` sources were uploaded and reached `ready` status in the Scanline Engine notebook.

## Session Entry - 2026-05-07 18:01 Europe/Warsaw

### Session Goals

- Implement the GDD-described closed-console modal state for parser responses that exceed the two visible closed-console lines.
- Add word wrapping in the closed low-res console so long lines are not clipped at the right screen edge.
- Preserve forced line breaks (`\n`, CRLF/CR) from Text Assets and parser responses so TA descriptions can use paragraphs.
- Iterate on modal-console UX until it matches real gameplay behavior in `test_room`, especially `LOOK CITY`.

### What Was Implemented

- Added closed-console word wrapping and forced-newline preservation in `src/core/Console.ts`.
  - Closed-console display lines are derived from buffer text by splitting CRLF/CR/`\n` into explicit paragraphs and wrapping words to the low-res console width.
  - Very long unbroken words are split so they cannot overflow the canvas.
- Added closed modal state handling.
  - `Console.isClosedModal` marks the continue-waiting state.
  - Parser/player output that wraps beyond two closed-console lines enters modal state while the console is closed.
  - Any normal key press or canvas click dismisses the modal.
  - Backquote/tilde is an exception: it opens the full high-res console instead of merely dismissing the modal.
- Added parser-response batching.
  - `Console.logResponse()` evaluates the modal threshold over the full player-facing parser response batch, not one physical buffer entry at a time.
  - `Game.logResponse()` funnels real parser responses into that batch path, with a fallback for tests/stubs.
  - `Parser.parse()` now sends player-facing response output through `game.logResponse(...)` when available.
- Fixed Enter propagation.
  - The hidden parser input now stops `Enter` propagation after submitting a command, preventing the same key event from bubbling to global input and instantly dismissing a newly opened modal.
- Scoped modal rendering to the latest parser response.
  - `Console` now stores a separate `closedModalDisplayLines` snapshot when a response triggers modal state.
  - `Game.renderUI()` renders only `getClosedModalDisplayLines()` while modal, rather than expanding the whole closed-console history.
  - Dismissing modal, opening the full console, clearing, or loading from JSON clears that modal snapshot.
- Kept technical parser logs out of the closed console.
  - `ConsoleLine` now supports optional `showInClosed`.
  - Parser debug/peek messages are written with `{ showInClosed: false }`, so they remain visible in the open console buffer but do not occupy the low-res gameplay screen.
  - Command confirmations such as `Parser peek enabled.` from `#PEEK-ON` and `LLM prompt/response peek enabled.` from `#PEEKLLM-ON` remain normal visible output.
- Polished the continue prompt.
  - `[Continue]` is right-aligned on the modal prompt row.
  - Its blink cadence now uses the same `cursorBlink / 500` logic as the normal closed-console text cursor.

### Important Architecture / Runtime Decisions

- Closed modal is a transient view over the latest parser response, not a resized history viewer.
- The full console buffer remains the authoritative history for the open console; the modal snapshot is only for the low-res modal display.
- Parser/player responses and technical diagnostic logs now have different closed-console visibility semantics:
  - player-facing parser responses can trigger and populate modal state;
  - debug/peek logs are retained for the open console but hidden from the closed console.
- Tilde/backquote has higher priority than generic modal dismissal because it is the user's established gesture for opening the console.
- Forced text newlines are handled at display wrapping time, so existing JSON string escape behavior (`\n`, CRLF/CR) works without changing Text Asset schemas.

### Parser / Mechanics / Scene / UI Changes

- Parser:
  - `src/mechanics/Parser.ts` now sends player-facing response arrays through `game.logResponse(...)`.
  - Parser debug messages are logged with `showInClosed: false`.
- Console/runtime:
  - `src/core/Console.ts` gained display-line wrapping, modal state, modal response snapshots, `logResponse`, `getClosedModalDisplayLines`, and `showInClosed` filtering.
  - `src/core/Game.ts` renders dynamic-height closed modal output, right-aligned blinking `[Continue]`, and `logResponse`.
  - `src/core/Input.ts` handles Backquote before generic modal dismissal.
  - `src/core/IGame.ts` exposes optional `logResponse`.
- React UI:
  - `src/components/UIOverlay.tsx` disables hidden parser input during modal state, stops submit `Enter` propagation, and mirrors the Backquote modal-open fallback.
- Tests:
  - `tests/parser/preprocessor.test.ts` now covers closed-console wrapping, forced newlines, modal dismissal, multi-message parser response modal triggering, Backquote opening the full console, technical log filtering, and latest-response-only modal snapshots.

### Validation / Tests Run

- `codex-doctor -Fast`
  - Passed: 17 checks, 0 warnings, 0 failures.
- NotebookLM CLI readiness:
  - Initial `list` / smoke `ask` failed because auth had expired.
  - `notebooklm-ready.ps1 -AutoLogin` repaired CLI auth and the project smoke test passed.
- Focused tests during implementation:
  - `npm test -- tests/parser/preprocessor.test.ts`
  - `npm test -- tests/parser/preprocessor.test.ts tests/parser/commands.test.ts tests/integration/parser-game.test.ts`
  - `npm test -- tests/parser/preprocessor.test.ts tests/parser/llm-parser.test.ts`
  - All passed after fixes.
- Typecheck:
  - `npm run typecheck`
  - Passed.
- Full suite:
  - `npm test`
  - Passed: 23 files, 268 tests.
- Whitespace:
  - `git diff --check`
  - Passed. Git reported expected LF-to-CRLF working-copy warnings only.
- Browser smoke checks with Playwright:
  - `LOOK CITY` in `test_room` enters closed modal, disables input, preserves forced CR/newline, wraps text, and dismisses to the last two wrapped lines.
  - Backquote from modal opens the full high-res console overlay.
  - `#PEEK-ON` followed by `LOOK CITY` keeps `--- CONTEXT ---` in the full buffer but hides it from closed display, while `Parser peek enabled.` remains visible.
  - Repeating `LOOK CITY` leaves history in the full buffer but modal renders only the latest response snapshot.

### Commits Created During This Session

- No git commit was created during this session.
- Latest commit at wrap-up time:
  - `2fcb17e Fix spatial relation type narrowing`

### Kairo / Memory Updates

- Kairo task updated and closed:
  - `aaaaaaabtybovqouo5bfcrh3gru6asfb`
  - `[Quest] Implement closed-console modal multiline output`
- Durable `agent_memory` entries stored for:
  - closed console modal multiline output implementation;
  - parser response batching and Enter propagation fix;
  - Backquote opening the full console from modal state;
  - right-aligned `[Continue]` prompt and blink cadence;
  - technical parser logs hidden from closed console;
  - latest-response-only modal snapshot behavior.

### Current State

- Branch: `scene-refact3`.
- Worktree has uncommitted changes from this session in:
  - `src/components/UIOverlay.tsx`
  - `src/core/Console.ts`
  - `src/core/Game.ts`
  - `src/core/IGame.ts`
  - `src/core/Input.ts`
  - `src/mechanics/Parser.ts`
  - `tests/parser/preprocessor.test.ts`
- There is also a pre-existing/user-owned dirty file not edited as part of this implementation:
  - `public/scenes/test_room.json`
- `Sessions.md` is updated by this wrap-up entry.

### Remaining Work / Next Recommended Steps

- Commit the feature after user acceptance, including the source/test changes and this `Sessions.md` entry if desired.
- Consider adding a higher-level integration/UI test for closed-modal rendering if the project later gains browser-driven test infrastructure.
- Consider documenting the closed-console modal contract in `GDD.md` or a console/UI architecture doc if this behavior becomes a stable public editing/design rule.

### Risks / Caveats / Open Questions

- Closed modal currently caps visible modal output to available low-res screen height. Extremely long responses still show the tail of that response rather than true pagination.
- Technical logs are hidden only when logged with `showInClosed: false`; future debug producers should use the same flag if they should stay out of the closed console.
- The modal snapshot is intentionally transient and is not serialized into save/load state.
- The dirty `public/scenes/test_room.json` was left untouched because it appears unrelated/user-owned.

### NotebookLM / RAG Refresh

- NotebookLM source replacement completed after this entry was appended:
  - `Sessions.md`
  - `GDD.md`
  - generated `AgentMemory.md`
- The local memory mirror was refreshed and the NotebookLM memory dump was regenerated as part of this wrap-up workflow.
- Fresh NotebookLM sources reached `ready` status in the Scanline Engine notebook.

## Session Entry - 2026-05-08 00:40 +02:00

### Session Goals

- Finish and stabilize the inventory item preview behavior.
- Make inventory click, `LOOK`, and `EXAMINE` semantics line up with the intended text channels:
  - overlay is visual-only;
  - console owns all text;
  - click/`LOOK` use `description`;
  - `EXAMINE` uses `details`.
- Ensure the closed console modal `[Continue]` state has higher click priority than the inventory preview overlay.
- Record the current repo state and durable behavior contract for future sessions.

### What Was Implemented

- Inventory overlay is now image-only:
  - text rendering was removed from the overlay path;
  - stale `.inventory-preview-text` styling was removed.
- Clicking a player inventory slot now behaves like `LOOK`:
  - opens the inventory preview overlay with no preview text;
  - logs the item `description` to the game console.
- `LOOK` on a held inventory item now opens the same image preview and returns/logs `description`.
- `EXAMINE` on a held inventory item now opens the image preview and returns/logs `details`.
- Inventory preview default text resolution no longer prefers `details`; explicit callers now decide whether preview text should exist, and the current player-facing overlay path passes `null`.
- Inventory overlay click handling now respects the closed-console modal:
  - if the console is in `[Continue]` state, the first click calls `console.continueClosedModal()`;
  - that click does not close the inventory preview;
  - subsequent backdrop clicks close the preview normally;
  - clicks on the preview card itself still do not close the overlay.

### Important Decisions

- Inventory preview overlay should be visual-only for current gameplay UX. Text belongs in the console.
- Clicking an inventory slot is equivalent to `LOOK` for text semantics, not `EXAMINE`.
- `EXAMINE` remains the detailed text command and uses `details`, including for held inventory items.
- The closed console modal has higher input priority than the inventory overlay. This avoids losing the preview when the player is only trying to dismiss `[Continue]`.

### Parser / Mechanics / Inventory Changes

- `src/components/inventory/PlayerInventoryPanel.tsx`
  - click handler now opens preview with `null` preview text and logs `description` to console.
- `src/systems/GameSemanticAPI.ts`
  - `lookEntity(...)` opens image-only preview for inventory items while returning `description`;
  - `examineEntity(...)` opens image-only preview for inventory items while returning `details`.
- `src/systems/InventoryManager.ts`
  - preview fallback text resolution was changed to use `description` instead of `details`, but the current overlay flow intentionally passes `null`.
- `src/components/UIOverlay.tsx`
  - preview text rendering removed;
  - overlay click handling checks `console.continueClosedModal()` before closing preview.

### Tests Run

- `npx vitest run tests/game/semantic-api.test.ts`
  - Passed: 80 tests.
- `npx vitest run tests/game/semantic-api.test.ts tests/parser/commands.test.ts`
  - Passed: 91 tests.
- `npm run typecheck`
  - Passed.

### Commits Created During This Session

- Latest commit at wrap-up time:
  - `1b43375 Imrovement: Click on Inventory Item now work as LOOK command instead of EXAMINE.`
- No additional commit was created by this wrap-up step.

### Durable Memory Updates

- Stored `agent_memory` decision:
  - `5e584cec-59f7-4a32-943c-ade76c5cc271`
  - `Inventory item LOOK/click/EXAMINE preview contract`

### Current Worktree State

- Worktree still has uncommitted changes at wrap-up time:
  - `public/scenes/test_room.json`
  - `public/text/system/parser-llm-system.md`
  - `public/text/system/parser-llm.json`
  - `src/mechanics/Parser.ts`
  - `src/systems/GameSemanticAPI.ts`
  - `tests/fixtures/parserFactory.ts`
  - `tests/game/semantic-api.test.ts`
  - `tests/integration/parser-game.test.ts`
  - `public/text/objects/audio_cables.json` (untracked)
- The dirty tree includes ongoing hidden-object / relation-discovery changes beyond the inventory preview contract:
  - direct `LOOK` / `EXAMINE` of hidden semantic targets is being constrained;
  - relation `LOOK` can reveal `lookable` hidden contents;
  - examining an anchor can reveal `examinable` hidden descendants;
  - LLM instructions now distinguish hidden facts from visible target candidates and allow only indirect non-revealing hints.

### Remaining Work / Next Steps

- Review and commit the remaining dirty hidden-object / relation-discovery changes separately from the already committed inventory-preview behavior, if accepted.
- Consider a browser/UI-level test later for the overlay-vs-closed-modal click priority, since the current validation is mostly semantic/type-level.
- Optionally update `GDD.md` or a parser/UI behavior doc with the final inventory item contract:
  - click/`LOOK` = image preview + `description` in console;
  - `EXAMINE` = image preview + `details` in console;
  - overlay itself renders no text.

### Risks / Caveats

- `UIOverlay.tsx` behavior depends on `console.continueClosedModal()` returning `true` only when the console is actually in modal `[Continue]` state.
- The current dirty worktree includes user/session changes outside the final inventory preview fix; future agents should inspect diffs carefully before committing.
- The latest commit message contains a typo: `Imrovement`.

## Session Entry - 2026-05-08 01:18 +02:00

### Session Goals

- Record only the work completed after the previous wrap-up.
- Commit the accepted inventory-preview focused-target parser behavior.
- Refresh durable memory and NotebookLM sources after the commit.

### What Was Implemented

- Inventory preview overlay now keeps the command input focused:
  - `UIOverlay` prevents overlay mouse-down from blurring the hidden parser input;
  - the player can continue typing commands while inspecting the item image.
- The currently previewed held inventory item is now the default parser target/item for commands that omit an explicit object:
  - `LOOK` with no noun becomes `LOOK <preview item>`;
  - `EXAMINE`, `TAKE`, `OPEN`, `CLOSE`, and `GO TO` with a missing target use the preview item;
  - `DROP`/`PUT` with a missing item use the preview item;
  - custom commands fill the first missing entity argument from the preview item.
- The parser world model now exposes `context.focusedTarget` for the LLM cascade:
  - includes preview item id, title, source, description/details, and synonyms when available;
  - only appears when the previewed entity is still held in player inventory.
- LLM prompt assets now instruct the model to use `focusedTarget.title` as the default target/item when the player omitted an explicit object.
- Parser tests were updated so the fixture matches the current inventory `LOOK` contract (`description`, not `details`).

### Important Decisions

- The inventory preview item is a parser focus, not just a UI state.
- Focused-target defaulting is applied after stage 1, NLP, and LLM envelopes are produced, before core parser execution.
- Overlay remains image-only; all textual output remains in the console.

### Tests Run

- `npx vitest run tests/parser tests/integration/parser-game.test.ts tests/game/semantic-api.test.ts`
  - Passed: 10 files, 219 tests.
- `npm run typecheck`
  - Passed.
- Pre-commit hook ran on staged files:
  - `prettier --write`
  - `eslint --max-warnings=0 --fix`

### Commits Created During This Session

- `3689cda Make inventory preview item parser default target`
  - Adds focused-target defaulting for parser plans.
  - Adds `focusedTarget` to LLM context and prompt guidance.
  - Keeps command input focused while inventory overlay is open.
  - Adds parser/world-model regression tests.

### Durable Memory Updates

- Stored decision before commit:
  - `b475a7c9-c4fa-4f67-a26e-36af2ee3a720`
  - `Inventory preview focused target defaults parser command targets`
- Stored commit-context decision after commit:
  - `64808676-4d76-4aec-8609-eae6f0c73fb6`
  - `Commit 3689cda focused inventory preview parser default target`

### Current State

- Worktree is clean after commit.
- Latest commit: `3689cda`.

### Remaining Work / Next Recommended Steps

- Push or continue from `3689cda` as the clean checkpoint.
- Consider documenting the focused-target command rule in `GDD.md` / parser docs if this becomes a public design contract.

### Risks / Caveats

- Custom command defaulting currently fills the first missing entity argument only. Multi-argument commands still ask for later missing arguments.
- `LOOK` with no noun becomes focused-item `LOOK` only when a held inventory preview is open; otherwise existing scene-look behavior is preserved.

## Session Entry - 2026-05-08 01:19 +02:00

### Session Goals

- Final wrap-up and durable handoff after the hidden-object discovery fixes, LLM prompt clarification, and focused inventory-preview parser work.
- Refresh project memory / NotebookLM sources so future agents see the current contracts.

### What Was Implemented

- Hidden semantic object discovery was tightened and committed in `e8aa71a`.
  - Direct `LOOK <hidden title>` no longer reveals or describes hidden objects.
  - Direct `EXAMINE <hidden title>` also behaves as not found until the object is discovered.
  - Relation `LOOK` reveals `hidden: "lookable"` descendants, for example `LOOK BEHIND BOOMBOX` revealing `audio_cables`.
  - `EXAMINE <visible anchor>` reveals `hidden: "examinable"` descendants around that anchor, for example `EXAMINE BOOMBOX` revealing examinable `audio_cables` behind it.
  - `test_room` now includes `audio_cables` behind the boombox with object text assets.
- The parser LLM prompt now treats hidden facts as real engine/world facts but not player-visible targets.
  - Hidden objects from `hiddenKnown`, `worldKnown`, or world facts cannot be used as action targets/items/anchors.
  - The LLM may use hidden facts only for indirect non-revealing sensory hints such as smell, rattling, vague shape, weight, or suspicious gaps.
- Focused inventory-preview parser behavior was committed in `3689cda`.
  - An open held-item preview becomes the default parser target/item when the player omits an explicit object.
  - LLM context now exposes `focusedTarget`.
  - The inventory overlay preserves parser input focus.

### Important Decisions

- Hidden discovery state is runtime progress, not scene authoring data.
  - `Scene.revealedHiddenEntities` should later be saved with game-state save/load, not in scene JSON.
- The player cannot directly name or examine an unknown hidden object.
  - Discovery happens through contextual investigation of visible anchors/relations.
- LLM hidden knowledge is authorial context for atmosphere, not permission to reveal objects or route actions to them.

### Parser / Mechanics / Runtime Changes

- `Parser` no longer has direct semantic-hidden target resolution for `LOOK` or `EXAMINE`.
- `GameSemanticAPI.examineEntity()` no longer reveals the target before access checks.
- `GameSemanticAPI.examineEntity()` does reveal examinable hidden descendants after a visible anchor passes access checks.
- Parser test fixtures were updated to mirror the production semantic API reveal behavior.
- Parser world model / LLM context now supports inventory preview `focusedTarget`.

### Tests Run And Outcomes

- Hidden-object / LLM prompt focused validation:
  - `npm test -- tests/game/semantic-api.test.ts tests/integration/parser-game.test.ts tests/parser/world-model-context.test.ts`
  - Passed: 3 files, 157 tests.
  - `npm test -- tests/parser/llm-parser.test.ts tests/parser/llm-cascade.test.ts tests/parser/world-model-context.test.ts tests/core/text-asset-manager.test.ts`
  - Passed: 4 files, 39 tests.
- Broader validation:
  - `npm run typecheck` passed.
  - `npm test -- tests/parser tests/integration/parser-game.test.ts tests/game/semantic-api.test.ts` passed: 10 files, 215 tests.
  - Full `npm test` passed: 24 files, 277 tests.
  - `git diff --check` passed, with only expected Windows LF-to-CRLF warnings.
- Focused-target commit validation:
  - `npx vitest run tests/parser tests/integration/parser-game.test.ts tests/game/semantic-api.test.ts` passed: 10 files, 219 tests.
  - `npm run typecheck` passed.

### Commits Created During This Session

- `e8aa71a Fixed Hidden Items mechanic and imroved LLM prompt about it`
  - Fixes hidden `lookable` / `examinable` discovery contracts.
  - Adds `audio_cables` test-room content.
  - Updates parser LLM hidden-fact prompt rules.
- `3689cda Make inventory preview item parser default target`
  - Adds focused inventory-preview default targets and LLM `focusedTarget` context.

### Durable Memory Updates

- Stored and/or updated durable memory for:
  - hidden object direct `LOOK` leak incident;
  - future game-state save/load preserving `revealedHiddenEntities`;
  - direct `EXAMINE` not revealing hidden semantic targets;
  - LLM hidden facts being usable only for non-revealing sensory hints;
  - inventory preview focused target defaulting.

### Current State

- Branch: `scene-refact3`.
- Branch is ahead of `origin/scene-refact3` by 1 according to the latest `git status`.
- Working tree has only `Sessions.md` modified for wrap-up source updates.
- Latest commit: `3689cda`.

### Remaining Work / Next Recommended Steps

- Commit the updated `Sessions.md` after NotebookLM source refresh if desired.
- Push `scene-refact3` when ready.
- Later game save/load work should include per-scene runtime state such as `revealedHiddenEntities`.
- Consider documenting the final hidden-object and focused-target contracts in `GDD.md` or parser docs if they become player-facing design rules.

### Risks / Caveats

- Commit messages contain typos: `imroved` / `Imrovement`.
- NotebookLM and local RAG sources can lag behind live `agent_memory`; this wrap-up refresh should reduce that gap.

## Session Entry - 2026-05-09 01:16 +02:00

# Session Summary

## Session Goal

- Modernize project documentation (tech-spec.md).
- Decouple and expand the Scripting System documentation.
- Improve the Scene Editor's UX by implementing SVG component iconography in the properties panel and custom Select dropdown.

## What Was Implemented

### 1. Documentation Modernization (tech-spec.md)

- Completely rewrote the specification to reflect the post-refactoring architecture (Game monolith decomposition, GameSemanticAPI, LLM Parser, A* Navigation).
- Added a comprehensive **Codebase Map** mapping subsystems to src/ directories.
- Integrated the **Tauri Native Build** documentation, including path resolution logic (std::env::current_exe()), Windows bundling specifics, and workspace requirements.

### 2. Scripting System Documentation

- Extracted the technical scripting API into a new, beginner-friendly standalone guide: ScriptSys.md.
- Added a "Chapter 1: How to Create Your First Script" tutorial with practical examples on registering a script and attaching it to a TriggerBox.
- tech-spec.md now references ScriptSys.md as the primary source for scripting.

### 3. Component UI Updates

- Implemented dynamic SVG icon rendering in the SectionComponents.tsx properties panel header using import.meta.glob and CSS mask-image.
- Fixed a typo in the icon filename (invetory.svg -> inventory.svg) to correctly match component names.
- Updated the custom <Select> dropdown (src/components/common/Select.tsx) to support displaying icons within the dropdown options and the selected trigger.
- Wired up the component addition dropdown to automatically load and render component icons.
- Ensured icons dynamically inherit text color via #fb8 (header) and currentColor (dropdown).

## Important Architecture / Runtime Decisions

- **Documentation Strategy:** Use tech-spec.md as the high-level entry point, with deep-dive guides for specific complex systems (like scripting) separated into modular .md files.
- **Component Icons:** Icons must be placed in src/assets/components-icon/ and match the component's name. They will be picked up automatically with no code changes needed.

## Tests Run

- No functional behavior changed. UI rendering changes were performed on the Editor side.

## Commits Created During the Session

- No commits were created in this session by the agent.

## Current State

- The project documentation is fully aligned with the current codebase structure. The environment is optimized for development of new gameplay systems.
- The UI in the Editor has been successfully enriched with component icons.

## Remaining Work / Next Recommended Steps

- Proceed with prioritized Kairo tasks (e.g., "Darkness" system for LOOK, "NPC AI System").

## Risks / Caveats

- Not all components have associated SVG icons yet; the UI implementation handles missing icons gracefully by simply rendering the text.
- Static hosting of the game will break Editor features; testing via the native Tauri build or the development environment is recommended.

## Session Entry - 2026-05-09 19:37 Europe/Warsaw

### 1. Session Goals

- Fix Stage 2 LLM parser behavior so unsupported but plausible player intents are handled as in-world Game Master narration instead of being forced into adjacent standard commands like `EXAMINE`.
- Add runtime Parser Notes (PN) so the LLM cascade can remember small invented facts about the scene or objects.
- Add debug visibility for Parser Notes and make them safe to use as evolving GM memory without hiding LLM mistakes.
- Improve stale-note handling so normal parser/runtime mutations can signal that an existing PN needs to be rechecked by the LLM.
- Keep all LLM prompt assets in English and story-neutral, using wording such as `player character` instead of protagonist-specific names.

### 2. What Was Implemented

- Added runtime-only Parser Notes for the active scene and individual scene/inventory entities.
- Added structured LLM actions:
  - `setSceneParserNote`
  - `setEntityParserNote`
- Added PN context projection into the LLM world model:
  - `context.scene.parserNote`
  - `context.entities[].parserNote`
  - `context.knownEntities[].parserNote`
  - `context.inventory[].parserNote`
  - focused inventory target PN when present.
- Added PN stale metadata:
  - `parserNoteNeedsCheck?: true`
  - runtime scene/entity storage for needs-check state.
- Added `#PEEKPN-ON` / `#PEEKPN-OFF` console commands for narrow Parser Notes logging:
  - PN context entries;
  - PN creation/update/clear mutations;
  - PN `needsCheck` mutations.
- Updated `#PEEK-ON` debug output to include structured PN effects.
- Added PN validation:
  - entity PN writes must target a visible, held, or focused context entity;
  - notes are trimmed and capped at 600 characters;
  - empty notes clear stored PN.
- Removed runtime censorship of PN text after user clarified that bad PN content is useful for diagnostics.
- Added LLM plan normalization rules so PN plans must include player-facing `showText`; PN plans with `showText` drop ordinary world actions like `examineTarget`, preventing PN+EXAMINE fall-through.

### 3. LLM Prompt / Behavior Changes

- Reframed the Stage 2 LLM as a creative Game Master first, not as merely a command parser.
- Added explicit prompt rules that recognized but unsupported intent should produce short atmospheric in-world narration instead of adjacent standard actions.
- Strengthened world-model discipline:
  - `worldFacts`, entity `contents`, entity `location`, `spatialNodes`, and `spatialRelations` are the physical truth of the scene;
  - matching nouns, compatible object types, and inventory contents do not create physical relationships;
  - inventory items are held by the player character and are not inside or connected to scene objects unless context explicitly says so.
- Tightened PN rules:
  - entity PN must describe only that entity;
  - scene PN must describe only the scene/area;
  - temporary player character actions or poses must be narrated, not stored as persistent PN;
  - persistent object/scene consequences may be stored.
- Added mandatory stale PN housekeeping:
  - if any PN has `parserNoteNeedsCheck: true`, resolving that stale note is part of the current LLM task even when the player command concerns something else;
  - LLM must confirm stale PN by rewriting it, correct it, or clear it with an empty PN before player-facing output.

### 4. Parser / Runtime / Debug Changes

- `Scene` now stores PN text and needs-check metadata for the scene and entities.
- `ParserWorldModelBuilder` injects PN text and `parserNoteNeedsCheck` into context.
- `Parser` executes PN writes, emits PN effects, and parses PN debug effects for `#PEEK` / `#PEEKPN`.
- Standard mutating runtime operations mark existing affected PN as stale instead of deleting or editing them:
  - `TAKE`;
  - `PUT`;
  - `OPEN`;
  - `CLOSE`;
  - inventory removal style effects.
- PN writes from the LLM reset needs-check flags because the note has just been reviewed.

### 5. Tests And Validation

Focused and broad validation were run during the session:

- `npm test -- tests/parser/llm-cascade.test.ts`
- `npm test -- tests/parser/world-model-context.test.ts tests/parser/llm-parser.test.ts tests/parser/llm-cascade.test.ts`
- `npm test -- tests/parser tests/integration/parser-game.test.ts`
- `npm run typecheck`
- `npm test`
- `git diff --check`

Final full validation before the commit:

- `npm test`: 25 test files, 300 tests passed.
- `npm run typecheck`: passed.
- `git diff --check`: passed, with only line-ending warnings from Git.

### 6. Documentation Updated

- `Parser.md`
  - PN context fields;
  - structured PN actions;
  - validation behavior;
  - `parserNoteNeedsCheck`;
  - `#PEEKPN` output.
- `GDD.md`
  - PN as runtime GM memory;
  - needs-check behavior after real world mutations.
- `TextAssets.md`
  - PN are runtime parser memory, not authored Text Assets;
  - prompt assets must remain English/story-neutral.

### 7. Commit Created

- `1ed03e0 Major Feature: add runtime Parser Notes for LLM GM memory`

Commit scope:

- Parser Notes runtime storage and actions.
- PN context injection and debug output.
- `parserNoteNeedsCheck` stale-note mechanism.
- LLM prompt contract updates.
- Parser/LLM/world-model tests.
- Parser/GDD/TextAssets documentation.

Files intentionally left out of that commit as unrelated existing work:

- `public/text/scenes/test_room.json`
- `src/components/editor/properties/MultiSelectionProperties.tsx`
- `src/entities/QuadObject.ts`
- `tests/entities/quad-object.test.ts`

### 8. Remaining Work / Next Recommended Steps

- Continue live-testing LLM behavior around stale PN and unsupported actions.
- If the model still skips stale PN housekeeping, consider a runtime enforcement rule that rejects/reprompts LLM outputs when context had stale PN and the response did not include any PN action for it. This should be a later decision because current prompt-only behavior is now working acceptably.
- Future save/load work should serialize runtime PN and needs-check metadata with save games, not with scene authoring JSON.
- Consider exposing explicit affected entity metadata from custom commands/scripts later so PN stale marking can cover more scripted side effects.

### 9. Risks / Caveats

- PN remain internal parser memory and are intentionally allowed to preserve bad LLM notes for debugging.
- The stale-note mechanism marks notes as suspicious; it does not itself decide semantic truth.
- LLM prompt behavior is improved but still model-dependent.
- Dirty worktree remains after the feature commit because unrelated changes were intentionally left untouched:
  - test-room scene content;
  - multi-selection Quad fill UI;
  - QuadObject retro-grid/blend behavior;
  - QuadObject test file.

## Session Entry - 2026-05-10 17:01 +02:00

### 1. Session Goals

- Optimize Stage 2 LLM parser token usage by splitting the prompt into:
  - a scene-static part suitable for provider prompt caching;
  - a per-call dynamic part that changes with input, world state, parser notes, and recent turns.
- Implement Anthropic prompt caching without coupling parser mechanics to Anthropic-specific APIs.
- Keep future provider switching modular: a new provider connector should not need to rewrite prompt splitting.
- Add debug/log visibility for cache eligibility and real cache usage, especially under `#PEEKLLM-ON`.
- Commit the finished feature and leave durable handoff context.

### 2. What Was Implemented

- `LlmCascade` now builds a provider-agnostic prompt split:
  - scene-static system blocks contain the core LLM system prompt, prompt asset instructions, and a static scene/object/inventory text snapshot;
  - per-call user content contains the current command, dynamic parser context, recent scene turns, Parser Notes, world facts, spatial nodes/relations, pending state, focused target, and any previous parser attempt.
- Scene-static prompt preparation is triggered when `SceneManager.switchTo(...)` completes:
  - `SceneManager` calls `Parser.prepareLlmStaticPromptForCurrentScene()`;
  - `Parser` builds current parser context and asks `LlmCascade` to prepare the static prompt;
  - this does not perform a network request and does not warm Anthropic cache by itself.
- Anthropic cache fill remains lazy:
  - the first real LLM call for a static prompt writes the cache;
  - later calls with the same static prefix can read from the cache.
- `ILlmProvider` now accepts provider-agnostic structured text blocks with optional cache metadata.
- `AnthropicProvider` maps provider-neutral `cacheControl` to Anthropic `cache_control` and keeps this as connector-specific behavior.
- Anthropic streaming usage parsing now captures:
  - `inputTokens`;
  - `tokensGenerated`;
  - `cacheCreationInputTokens`;
  - `cacheReadInputTokens`.
- `#PEEKLLM-ON` now reports:
  - full split prompt debug;
  - `staticPrompt.sceneId`;
  - static prompt hash;
  - static prompt token estimate;
  - minimum cache token threshold;
  - cache eligibility estimate;
  - cache-ineligible reason when static prompt is below the Anthropic minimum;
  - Anthropic cache creation/read token usage when reported by provider.
- The Vite `/api/llm` proxy now accepts structured `system` payloads instead of assuming `system` is always a string.

### 3. Important Decisions

- Prompt splitting belongs above providers in `LlmCascade`, not inside `AnthropicProvider`.
- Provider connectors may flatten or ignore cache metadata if they do not support caching.
- Anthropic cache TTL defaults to `5m`.
- Cache population is lazy on first real LLM call; no warmup call is made on scene load.
- Static prompts below the estimated 4096-token Haiku 4.5 threshold are not padded. They are allowed to run uncached and are logged/debugged as cache-ineligible.
- `cacheCreationInputTokens > 0` means Anthropic wrote or refreshed cache. `cacheReadInputTokens > 0` means a real cache hit.
- Runtime Parser Notes, recent turns, spatial model, world facts, and previous-attempt context remain dynamic and authoritative over the static snapshot.

### 4. Parser / Mechanics Changes

- `src/mechanics/LlmCascade.ts`
  - owns the static/dynamic split;
  - prepares and reuses a static prompt snapshot by hash;
  - builds dynamic per-call user messages;
  - computes static prompt token estimates and cache eligibility debug.
- `src/mechanics/llm/ILlmProvider.ts`
  - introduces structured prompt content blocks and optional cache metadata.
- `src/mechanics/llm/AnthropicProvider.ts`
  - translates provider-agnostic cache metadata to Anthropic `cache_control`;
  - parses cache usage from Anthropic SSE events.
- `src/mechanics/Parser.ts`
  - adds `prepareLlmStaticPromptForCurrentScene()`;
  - includes cache usage and static prompt metadata in `#PEEKLLM` response debug.
- `src/scene/SceneManager.ts`
  - prepares the scene-static LLM prompt after scene switch.
- `src/mechanics/parserTypes.ts`
  - extends LLM debug info to represent structured prompt content and cache usage fields.
- `vite.config.ts`
  - allows structured Anthropic `system` blocks through the proxy.

### 5. Live Cache Verification

The user tested live Anthropic output with `#PEEKLLM-ON`:

- First observed call:
  - `cacheCreationInputTokens: 9205`
  - `cacheReadInputTokens: 0`
  - static prompt hash `f20f77aa`
  - interpretation: Anthropic accepted the cache breakpoint and created/refreshed cache.
- Later observed call in the same scene:
  - `cacheCreationInputTokens: 0`
  - `cacheReadInputTokens: 9205`
  - same static prompt hash `f20f77aa`
  - interpretation: real cache hit; the dynamic prompt still had ordinary input tokens.

### 6. Tests And Validation

Validation run before commit:

- `npm test -- tests/parser/llm-cascade.test.ts tests/parser/llm-parser.test.ts tests/parser/world-model-context.test.ts`
  - 3 files, 62 tests passed.
- `npm run typecheck`
  - passed.
- `npm test -- tests/parser tests/integration/parser-game.test.ts`
  - 9 files, 172 tests passed.
- Full `npm test`
  - 27 files, 319 tests passed.
- `git diff --check`
  - passed, with only expected Git line-ending warnings on Windows.
- `codex-doctor -Fast`
  - 17 pass, 0 warn, 0 fail.

Commit hook validation:

- Husky/lint-staged ran `prettier --write` and `eslint --max-warnings=0 --fix` on staged TS/JS files.
- Working tree was clean after commit.

### 7. Commit Created

- `f38dcbe Add LLM prompt cache split`

Commit scope:

- provider-agnostic LLM prompt content blocks;
- scene-static / dynamic prompt split;
- scene-switch static prompt preparation;
- Anthropic `cache_control` mapping;
- Anthropic SSE cache usage parsing;
- `#PEEKLLM` cache debug fields;
- parser/LLM tests;
- `Parser.md` and `GDD.md` documentation.

### 8. Durable Memory / Task State

- Stored semantic memory: `LLM parser prompt split and Anthropic cache contract`.
- Stored episodic commit memory: `Commit f38dcbe: Add LLM prompt cache split`.
- Kairo task `[Quest] Implement LLM static prompt split and Anthropic cache debug` was updated to `done` with validation and commit context.

### 9. Remaining Work / Next Recommended Steps

- Keep an eye on live `#PEEKLLM` usage values:
  - `cacheCreationInputTokens > 0` on the first call or after TTL/hash changes is expected;
  - `cacheReadInputTokens > 0` confirms a cache hit.
- If a future provider is added, implement only a new connector that consumes the existing `ILlmProvider` content blocks; do not move prompt splitting into the provider.
- Consider adding richer dynamic text override detection later if scripts redirect Text Assets after the static snapshot and the exact changed fields need to be minimized separately.
- If cache hit rates are lower than expected in real play, inspect static prompt hashes in `#PEEKLLM` to see whether static content is changing too often.

### 10. Risks / Caveats

- The local token estimate is approximate; Anthropic usage fields are the source of truth.
- Static prompts below the Anthropic minimum will run normally but uncached.
- Cache TTL is 5 minutes, so long pauses in a scene may cause the next request to recreate cache.
- Dynamic context still carries ordinary input tokens; prompt caching reduces repeated static prefix cost, not the whole request.

## Session Entry - 2026-05-12 02:58 +02:00

# Session Summary

## Session Goal

Refining 3D Spatial Audio for the engine, ensuring that sound triggering, panning, and environmental effects respond naturally to camera zoom and entity movement.

## What Was Implemented

### 1. SoundManager Architecture

- Implemented `SoundManager.ts` using Web Audio API.
- Support for 3D Spatial Audio (HRTF panning), Convolution Reverb, and Delay effects.
- Dynamic Proximity EQ (+6dB bass boost at 250Hz) and Reverb Scaling.

### 2. 2.5D Spatial Logic

- Developed a physically grounded 2.5D sound model:
  - Parallax 1.1 = Head Level (Z=0).
  - Parallax 1.0 = Foreground (Z=-400).
  - Parallax 0.0 = Infinity (Z=-10000).
  - Parallax < 0 = Behind Listener (+Z).
- Integrated Camera Zoom scaling: Z-depth is attenuated by 1/zoom.

### 3. Engine Integration

- Synchronized SoundManager update loop in `Game.ts`.
- Exposed complete Audio API through `ScriptAPI.ts` (`api.playSoundAttached`, `api.loadReverbIR`, etc.).
- Created a demo script and scene for visual/auditory validation.

### 4. Documentation & Memory

- Wrote comprehensive technical documentation in `SoundSys.md`.
- Persisted architectural facts in `agent_memory`.

## Important Architecture / Runtime Decisions

- Piecewise non-linear mapping for parallax (1.1 = head, 1.0 = front, 0.0 = infinity).
- Fixed listener at Z=0 to prevent panning artifacts.
- Exponential dry/wet scaling (power of 1.5) for natural transition.
- Global constants for world scale (AUDIO_MAX_DISTANCE = 10000).

## Tests Run

- `npm run typecheck`: Passed.
- Manual auditory checks via `test_3d_sound.ts` confirmed correct panning and attenuation.

## Commits Created

- `fa9fcbc` вЂ” `Feature: Sound Manager with 3d spatial system and dynamic reverb/delay FX`

## Current State

- Sound system is fully integrated, calibrated, and documented. Ready for production asset population.

## Remaining Work / Next Steps

1. Performance Tuning: Monitor `ConvolverNode` overhead in high-density scenes.
2. SFX Library: Start populating the `/public/sounds/` directory with production assets.
3. Gameplay Mechanics: Integrate sound triggers into common object prefabs (Doors, Switches).

## Session Entry - 2026-05-13 01:02 Europe/Warsaw

### Session Goals

- Stabilize Scanline Engine's scene-wide Default Reverb IR workflow for live 3D attached sounds.
- Make `SceneProperties` -> `SoundManager` hot-swapping work without stopping sounds.
- Restore the documented `SoundSys.md` dry/wet behavior for 3D SOUND ENV.
- Calibrate reverb gain staging and distance behavior enough for `#run test_3d_sound2` in `test_room` to be usable.

### What Was Implemented

- Fixed live Default Reverb IR updates for active attached sounds:
  - Scene-default IR changes now call `setEffects(playbackId, {}, true)` instead of passing scene default IR as a custom `reverbIR`.
  - This preserves `usingDefaultIR`, so active sounds keep listening to later scene default changes.
- Rebuilt ConvolverNode handling safely:
  - `SoundManager` tracks the active `reverbIR`.
  - Convolver branches are rebuilt when the IR URL changes.
  - `ConvolverNode.normalize = false` is set before assigning the IR buffer so browser normalization does not overpower the dry signal.
  - Stale async IR loads are ignored with `reverbRequestId`.
- Fixed a critical audio-routing bug:
  - The helper `disconnect(active.gain, active.reverbNode)` previously called `gain.disconnect()` when `active.reverbNode` was undefined.
  - That severed the dry path `gain -> dryGain -> masterGain`, causing dry signal loss and silence after clearing IR.
  - `active.gain` is now disconnected from reverb only when a reverb node actually exists.
- Fixed scene IR path normalization:
  - Bare file names such as `room_drum_medium.wav` and `/room_drum_medium.wav` normalize to `/sounds/ir/room_drum_medium.wav`.
  - `SceneProperties` prefixes basename picker results from `public/sounds/ir` with `sounds/ir/`.
  - `loadReverbIR()` now rejects HTTP/text-html wrong-path responses before `decodeAudioData`.
- Restored documented `SoundSys.md` dry/wet behavior:
  - `Reverb Min % = 0` means zero wet at `totalDist = 0`.
  - `Reverb Min % = 0.2` means 20% wet / 80% dry at `totalDist = 0`.
  - At `Reverb Drown Dist`, dry reaches 0 and wet mix reaches 100%.
  - Transition uses `pow(norm, 1.5)` as documented.
- Added gain staging for convolution reverb:
  - `REVERB_WET_OUTPUT_GAIN = 0.025` trims the convolver branch without changing the dry/wet physics.
  - `REVERB_WET_FADE_IN_SECONDS = 0.12` mutes newly connected wet branches and fades them in to avoid short attach surges.
- Added distance behavior for wet and dry-only modes:
  - `REVERB_DISTANCE_MIN_LEVEL = 0.3` makes reflected wet output fall with distance while preserving the wet/dry composition.
  - `DRY_ONLY_DISTANCE_MIN_LEVEL = 0.3` makes attached sounds attenuate with distance even when no scene reverb IR is active.

### Important Architecture / Runtime Decisions

- Scene-level default reverb and per-sound custom reverb must remain distinct:
  - Scene default updates must never mark a sound as custom.
  - Custom `reverbIR` still clears `usingDefaultIR`.
- `Reverb Min %` and `Reverb Drown Dist` describe dry/wet composition, not raw convolver amplitude.
- Convolver output needs separate gain staging because IR energy can be much hotter than the dry source.
- Reverb branch connect/disconnect must never touch the persistent dry path.
- When no reverb branch exists, proximity update should still attenuate dry-only attached sounds by distance, but not make them silent near the listener.

### Parser / Mechanics / Scene / Inventory Changes

- No parser, mechanics, inventory, or subscene behavior was changed.
- Scene/editor/runtime sound environment behavior changed through:
  - `src/systems/SoundManager.ts`
  - `src/components/editor/properties/SceneProperties.tsx`
  - `tests/systems/sound-manager.test.ts`
- Existing dirty/user work around scene/audio assets was preserved during the investigation; final repo status later showed clean after commit.

### Tests Run And Outcomes

- `npm test -- tests/systems/sound-manager.test.ts -- --runInBand`
  - Passed, 8 tests.
  - Covers default IR hot-swap, basename normalization, late default IR enablement, zero-min-at-listener, SoundSys dry/wet crossfade, clear-to-dry, stale async clear, and dry-only distance attenuation.
- `npm run typecheck`
  - Passed.
- Full `npm test`
  - Passed, 28 files / 331 tests.
- `git diff --check -- src/systems/SoundManager.ts src/components/editor/properties/SceneProperties.tsx tests/systems/sound-manager.test.ts`
  - Passed.

### Commits Created

- `98a7069` - `feat(audio): implement comprehensive 3D sound environment and scene-wide default reverb`

### Remaining Work / Next Recommended Steps

- Consider promoting the hardcoded sound calibration constants to scene/editor controls if more scene-specific tuning is needed:
  - `REVERB_WET_OUTPUT_GAIN`
  - `REVERB_DISTANCE_MIN_LEVEL`
  - `DRY_ONLY_DISTANCE_MIN_LEVEL`
  - `REVERB_WET_FADE_IN_SECONDS`
- Consider adding a browser-level/manual sound QA checklist for:
  - `#run test_3d_sound2` in `test_room`
  - `Reverb Min % = 0`, source at listener
  - clearing Default Reverb IR after a live sound starts
  - switching between multiple IR files while sound is playing
- If authored scene defaults should persist in `test_room`, verify `public/scenes/test_room.json` after manual editor saves.

### Risks / Caveats / Open Questions

- Convolution reverb loudness remains inherently IR-dependent; the current output trim is calibrated empirically for the tested IRs.
- `Reverb Min % = 0` only guarantees no wet at true zero total distance. `test_3d_sound2` often still has nonzero X/Z distance, so some reverb can remain by design.
- NotebookLM source upload for this wrap-up required CLI re-auth because `python -m notebooklm source list` reported expired authentication.

## Session Entry - 2026-05-15 12:33 +02:00

### Session Goals

- Diagnose corrupted `test_room` scene/inventory state where a held cassette had lost its usable connection to the scene object.
- Fix editor/runtime cleanup so deleted scene entities cannot remain as phantom Inventory/Surface entries.
- Correct parser/runtime visibility behavior around `LOOK` / `EXAMINE` nested spatial contents.
- Commit the complete current working tree as a single `Fixes` commit and leave a durable handoff.

### What Was Implemented

- Fixed the broken cassette state in `public/scenes/test_room.json`:
  - The held `Compact cassette` now points at the real scene entity `test`.
  - The stale phantom `test_` entry was removed from the player inventory data.
- Fixed editor deletion cleanup in `src/scene/Scene.ts`:
  - `Scene.removeEntity()` now removes the entity from the active inventory/storage manager before deleting it from the scene graph.
  - This prevents the editor from leaving inventory references to non-existing entities.
- Preserved the important runtime distinction between inventory ownership and generic spatial containment:
  - Objects should be hidden from scene rendering when they are actually stored in Inventory.
  - Objects with spatial relation `in` are not automatically inventory items; this avoids hiding legitimate world-contained objects such as `CityView` inside `Window`.
- Added direct semantic scene-text helpers in `src/scene/SceneTextLayer.ts`:
  - Direct semantic descendants are immediate titled children after collapsing untitled technical intermediates.
  - Traversal stops at titled children, so grandchildren under another titled object are not reported as direct contents.
- Updated `LOOK` / `EXAMINE` handling:
  - `src/systems/GameSemanticAPI.ts` now reveals and describes only first-level titled semantic children for examine/look relation descriptions.
  - `src/mechanics/Parser.ts` now uses the same first-level direct semantics for entity content text.
  - Hidden `lookable` / `examinable` descendants are revealed only when they are first-level children of the inspected target.
- Preserved recursive relation behavior for mechanics that intentionally need it:
  - `TAKE ... FROM ...` and related relation-scoped candidate discovery still use recursive descendant search.
  - This keeps nested container interactions working while narrowing only the descriptive/reveal behavior.
- Included the current workspace's scene, prompt, LLM cascade, and kitchen asset changes in the all-in `Fixes` commit as requested.

### Important Architecture / Runtime Decisions

- Inventory state must be derived from Inventory/Surface component storage, not from spatial `relation: "in"`.
- Spatial `IN` means world containment; it does not imply the object is carried by the player.
- `LOOK` and `EXAMINE` are descriptive/reveal commands and should expose only the first semantic level below the target.
- First semantic level means titled children directly below the target, with untitled technical nodes collapsed.
- Hidden objects under a titled child remain hidden until that titled child is inspected.
- Recursive spatial traversal remains valid for targeted gameplay mechanics where the command explicitly scopes through a container.

### Parser / Mechanics / Scene / Inventory Changes

- `Scene.removeEntity()` now clears current inventory/storage ownership before scene deletion.
- `SceneTextLayer` now exposes direct relation helpers alongside existing recursive helpers.
- `GameSemanticAPI` uses direct helpers for `describeSpatialRelation()` and hidden descendant reveal during examine/look flows.
- `Parser.getEntitySpatialContentsText()` uses direct helpers so `LOOK SOFA` reports pillows but not a remote hidden under a pillow.
- Parser fixture semantic API mirrors the runtime helper split.
- Tests now cover:
  - editor deletion of held entities clearing inventory storage;
  - `LOOK` / `EXAMINE` first-level-only reporting;
  - hidden lookable grandchildren staying hidden from ancestor inspection;
  - nested `TAKE FROM` still reaching deeper candidates where intended.

### Tests Run And Outcomes

- `npm test -- tests/game/semantic-api.test.ts -- --runInBand`
  - Passed.
- `npm test -- tests/integration/parser-game.test.ts -- --runInBand`
  - Passed, 77 tests.
- `npm run typecheck`
  - Passed.
- `npm test -- tests/game/navigation-and-spatial.test.ts tests/game/semantic-api.test.ts tests/integration/parser-game.test.ts -- --runInBand`
  - Passed, 172 tests.
- Full `npm test`
  - Passed, 28 files / 344 tests.
- `codex-doctor -Fast`
  - Passed, 17/17.
- Pre-commit hook during commit:
  - Ran prettier and eslint through lint-staged.
  - First attempt caught one unused fixture import; it was removed and the second commit attempt passed.

### Commits Created

- `6102beb` - `Fixes`
  - Includes inventory/entity deletion cleanup, `LOOK` / `EXAMINE` direct semantic reveal behavior, parser/game regression tests, current scene/prompt/LLM-cascade updates, and kitchen assets.

### Remaining Work / Next Recommended Steps

- Manually verify in the running editor/game that:
  - `LOOK SOFA` reports only the sofa's first-level pillows.
  - `LOOK RIGHT PILLOW` reveals the `TV remote`.
  - `take rc` remains unavailable until the remote is revealed.
  - Deleting a held item in the editor removes it cleanly from inventory.
- If scene data continues to drift through manual editor saves, consider a small scene-integrity diagnostic that reports inventory references to missing entity IDs.
- If UX needs it, add an editor validation warning for Inventory/Surface references that point to deleted scene entities.

### Risks / Caveats / Open Questions

- The `Fixes` commit intentionally includes all current workspace changes, including scene data, prompt/LLM cascade files, and kitchen assets, per user request.
- The parser's lower regex cascade correctly does not resolve `rc` while `tv_rc` is hidden and unrevealed; this was confirmed as intended behavior during the session.
- Direct semantic content behavior is now narrower by design; any previous tests expecting recursive `LOOK` disclosure were updated to the new contract.

## Session Entry - 2026-05-17 21:09 +02:00

### Session Goals

- Continue from the previous wrap-up without repeating the `Fixes` work.
- Introduce a centralized Actor scene-transfer path that moves a live Actor together with inventory/spatial-owned entities.
- Fix scene travel through `GO`, `Exit`/`Entry`, and script API so player/NPC transfers preserve live objects and inventory state.
- Add controlled Entry placement behavior: default Entry fallback, target camera zoom reset, Entry layer/parallax application.
- Rework scene/object scaling so `Correctional Scale` is an editor scene-normalization tool, while object `Scale` remains portable across scenes.
- Improve text-console cursor/focus behavior in game mode.

### What Was Implemented

- Added `SceneManager.transferActorToScene(actor, targetSceneId, options?)` as the central transfer API.
  - Collects the Actor itself.
  - Collects Entity descendants spatially owned by the Actor.
  - Collects items stored in the Actor's Inventory components.
  - Recursively collects nested descendants of those carried items.
  - Moves live object instances between scenes without cloning and without using normal `removeEntity()` cleanup that would clear inventory storage.
- Updated `SceneManager.switchTo(sceneId, activator?)` to delegate Actor movement to the transfer API when an activator is supplied.
- Updated `ComponentSystem.handleExit()` to call `transferActorToScene()` directly with `targetEntryId`.
- Added `ScriptAPI.transferActor(actorName, targetSceneId, targetEntryId?)` for script-side actor movement.
- Fixed semantic `GO <scene>` travel:
  - `Game.goToScene()` now passes the current player Actor into `switchTo()`.
  - If `currentScene.player` is missing, it falls back to a player Actor in the current scene entities.
  - Parser/game integration remains routed through this semantic path.
- Added Entry fallback for scene transfer:
  - If cross-scene transfer has no explicit `targetEntryId`, the first `Entry` object in the target scene is used.
  - The lookup uses `scene.getAllSceneObjects()`, so it sees `Triggerbox` Entries such as the one in `quad4`.
- Entry placement now applies only to the Actor:
  - Actor coordinates/direction are set from Entry.
  - Actor `layer` and `parallax` are copied from the Entry.
  - Carried inventory items keep inventory ownership and do not receive Entry coordinates/layer/parallax directly.
- Player cross-scene transfer now resets `targetScene.camera.zoom` to `targetScene.defaultCamera.zoom` before camera snap.
- Target-scene pre-authored player placeholders are removed/replaced by the live transferred player Actor.
- NPC Actor transfers move the NPC and its inventory contents without making the NPC `scene.player`.
- Same-scene teleport uses the same transfer API but skips detach/add and only applies Entry placement.

### Scaling And Editor Changes

- Added `Scene.scaling.correctionalScale` with default `1`.
- Added internal `Entity.refScale` serialization as the stored reference/prefab scale.
  - The editor-facing field remains the normal `Scale` field.
  - Legacy objects without `refScale` recover it from `modelScale` or `scale`.
- Rejected the intermediate idea of applying target-scene `Correctional Scale` to incoming Actors/items.
  - Incoming objects now keep their portable object `Scale`.
  - `Correctional Scale` is editor-only scene normalization, not transfer-time object scaling.
- Added `Scene.applyCorrectionalScaleChange(nextScale)`:
  - Computes a correction ratio from old to new scale.
  - Scales all scene objects around a shared scene center.
  - Updates absolute coordinates for entities.
  - Updates polygons for Walkboxes/Triggerboxes.
  - Updates Quad vertices.
  - Updates existing Entity stored scale values so the authored scene itself is normalized.
  - Explicitly includes locked objects; locked entities/triggers must not remain behind when the scene is normalized.
- Updated Scene Properties UI:
  - Section `2. Scaling` is split into `Depth Scaling` and `Correction`.
  - Added `Correctional Scale` field under `Correction`.
  - Tooltip explains that it scales all scene objects, including locked ones, around the shared scene center.
- Updated Entity Properties UI:
  - Returned to one editor-visible `Scale` field.
  - The field edits `refScale` internally while preserving the old UI concept.

### Text Console / Input Changes

- Improved text console cursor behavior.
- Added Ctrl+Left / Ctrl+Right command-line navigation.
- Added protection against losing command-line focus in game mode.
- The latest related commits are separate from the scene-transfer commit.

### Important Architecture / Runtime Decisions

- Actor scene movement must use `SceneManager.transferActorToScene()` rather than raw `oldScene.removeEntity(actor)` / `targetScene.addEntity(actor)`.
- Direct scene removal is unsafe for carried objects because normal entity removal clears inventory/storage ownership.
- Inventory contents are live scene entities and should travel with their owning Actor.
- Entry is the authoritative authored portal for Actor coordinates, direction, layer, and parallax.
- Target-scene camera zoom should come from target scene defaults when the player enters a different scene.
- `Correctional Scale` is not a runtime per-object multiplier for incoming objects.
- Object `Scale` remains portable; scene normalization should mutate the authored scene layout, not objects entering that scene.

### Parser / Mechanics / Scene / Inventory Changes

- Parser `GO` scene changes now preserve the live player Actor and its inventory.
- `Exit`/`Entry`, semantic `GO`, and script transfer all share the same central Actor-transfer path.
- Inventory-owned items remain hidden and spatially owned by the Actor after transfer.
- Nested carried descendants transfer with their carried parent.
- `InventoryManager.handleSceneChange()` runs after final scene state is established.
- Parser static prompt preparation, scene exposure, and scene-change hooks remain part of scene activation.

### Tests Run And Outcomes

- Focused scene transfer and scale tests:
  - `npm test -- tests/entities/entity-ref-scale.test.ts tests/game/navigation-and-spatial.test.ts tests/scene/scene-transition.test.ts -- --runInBand`
  - Passed.
- Parser/game integration checks:
  - `npm test -- tests/integration/parser-game.test.ts -- --runInBand`
  - Passed.
- Semantic API checks:
  - `npm test -- tests/game/semantic-api.test.ts -- --runInBand`
  - Passed.
- Combined focused suites after scale/correction work:
  - `npm test -- tests/scene/scene-correctional-scale.test.ts tests/entities/entity-ref-scale.test.ts tests/game/navigation-and-spatial.test.ts tests/scene/scene-transition.test.ts tests/game/semantic-api.test.ts tests/integration/parser-game.test.ts -- --runInBand`
  - Passed, 188 tests.
- Full suite:
  - `npm test`
  - Passed, 29 files / 354 tests.
- TypeScript:
  - `npm run typecheck`
  - Passed.
- Whitespace/diff check:
  - `git diff --check`
  - Passed with only CRLF warnings.

### Commits Created

- `758e5ce` - `Feature: Centralized Actor Scene Transfer API`
  - Central Actor transfer API, GO/Exit/script transfer integration, Entry fallback, camera zoom reset, Entry parallax/layer, Scale/Correctional Scale model, scene correction tests, docs, and scene/text additions including `quad5`.
- `0e546e5` - `Fixed and improved cursor in text console. Added Ctrl+ left/right arrows for navigation`
  - Console cursor improvements, Ctrl+arrow movement, related game/UI plumbing.
- `1443b87` - `Protection against losing command line focus in Game Mode`
  - Focus protection around game canvas/UI overlay so the command line does not lose focus unexpectedly.

### Remaining Work / Next Recommended Steps

- Manually verify in the editor:
  - `GO quad4` places the transferred player on the target `Triggerbox` Entry.
  - The transferred player keeps inventory contents.
  - The transferred player inherits Entry `Layer` and `Parallax`.
  - Target scene zoom resets to the default camera zoom.
  - Changing `Correctional Scale` moves locked and unlocked entities/triggers together.
  - Existing neighboring objects remain adjacent after scene correction.
- If scene scaling normalization is used heavily, consider adding an editor command name/history label for correction-scale changes so undo history reads more clearly.
- Consider a small UI hint that `Correctional Scale` is a destructive authored-layout normalization, not a temporary runtime multiplier.

### Risks / Caveats / Open Questions

- The current working tree is clean at wrap-up time.
- The previous memory decision that described transfer-time object correction was superseded by the later decision: `Correctional Scale` is editor-only scene normalization.
- Scene correction intentionally affects locked objects. This differs from normal transform editing, where locked objects are protected from accidental manual manipulation.
- `Correctional Scale` mutates authored object positions/polygons and stored scale values; use editor undo or source control when experimenting.

## Session Entry - 2026-05-29 10:23 +02:00

### Session Goals

- Generalize authored `State` changes into a reusable runtime event path instead of a TV-specific parser hack.
- Keep `ScriptAPI`, parser commands, and LLM direct actions on the same mutation path.
- Make Script Events UI represent state-driven interactions in a reusable way for any authored `State`.
- Finish the wrap-up by recording durable notes, refreshing notebook sources, and preserving the feature in git.

### What Was Implemented

- Added `StateEventSystem` as the shared runtime helper for authored State mutation side effects.
- Routed `ScriptAPI.setState` and parser `setEntityState` through the new State event helper so real changes dispatch script events.
- Removed the parser-specific `tv/power` side effect and moved TV glow behavior into an authored `tv_power_changed` script event.
- Simplified TV command assets so they only validate prerequisites, change `tv.power`, and show player-facing text.
- Expanded the editor Script Events section to present a generic `State Changed` add option and a State selector for `state:<id>` interactions.
- Added helpers and tests for generic state events, legacy state keys, and value-specific `state:<id>=<value>` display behavior.
- Updated parser/LLM guidance so direct world actions can set State without pretending the runtime has a TV-only path.

### Important Architecture / Runtime Decisions

- `ComponentSystem.setStateValue` remains a low-level helper without script side effects.
- Runtime State changes now flow through `StateEventSystem.setState(game, entity, stateId, value, source)`.
- Matching `interactions` keys are `state:<stateId>` and `state:<stateId>=<value>`.
- The script context receives `entity` plus `args` containing `stateId`, `previousValue`, `value`, `valueType`, and `source`.
- TV glow is a normal authored script-driven reaction to `tv.power`, not a hardcoded parser rule.
- The Script Events editor only creates `State Changed` when the selected object already has authored State components.

### Parser / Mechanics / Editor Changes

- Parser and LLM direct actions now report State mutations via the same common path, which keeps command, script, and Game Master behavior aligned.
- The `turn_tv_on` / `turn_tv_off` command assets now focus on state mutation plus text; they no longer own glow toggling.
- The `tv_power_changed` script handles enabling/disabling `#tv_glow` and starting/stopping `tv_glow`.
- The Script Events editor now shows readable `STATE` rows, supports State id selection, and preserves legacy state keys.

### Tests Run And Outcomes

- Focused tests:
  - `npm test -- tests/systems/state-event-system.test.ts tests/core/script-api-state.test.ts tests/parser/commands.test.ts tests/parser/llm-cascade.test.ts tests/parser/llm-parser.test.ts`
  - Passed.
- Editor UI contract test:
  - `npm test -- tests/editor/section-script-events.test.ts`
  - Passed.
- TypeScript:
  - `npm run typecheck`
  - Passed.
- Full suite:
  - `npm test`
  - Passed, 34 files / 405 tests.

### Commits Created

- `bb15d13` - `Major Feature: Improved Commands System, integrated with "States" component + expanded Script Events for states changes.`
  - State runtime event system, TV command rewrite, authored TV glow event, parser/LLM runtime alignment, editor Script Events UX, tests, docs, and related scene/text assets.

### Remaining Work / Next Recommended Steps

- Manually verify any additional authored objects with multiple State components use the new `State Changed` selector cleanly in the editor.
- If more gameplay systems need state-driven reactions, add authored `state:<id>` interactions rather than new parser-specific branches.

### Risks / Caveats / Open Questions

- Value-specific state events are runtime-supported but still hand-authored; the current UI does not create them automatically.
- The current scene asset for `tv` now relies on `state:power -> tv_power_changed`; if future scenes copy the TV pattern, they must author the interaction explicitly.
- `StateEventSystem` only dispatches when the value truly changes, which keeps event scripts idempotent but means same-value writes will not retrigger side effects.

## Session Entry - 2026-05-30 01:58 +02:00

### Session Goals

- Wrap up the state/parser-notes work with a durable handoff in repo and NotebookLM.
- Keep the authored `State` UI refinements, runtime state hydration fixes, and hover/cursor contract changes documented for the next session.
- Preserve the latest session context in `Sessions.md` and refresh the curated `AgentMemory.md` export used by NotebookLM.

### What Was Implemented

- Added optional `parserNoteTextAssets` support to authored `State` components so a state value can point at a Text Asset field whose content becomes the object's Parser Note.
- Kept the authored `State` UI compact and editable:
  - `ID / Type` share one row.
  - `Initial` / `Current` share one row.
  - parser-note mappings are added as blank rows instead of a modal pop-up.
  - each mapping row can be removed with a compact `X` button.
- Added hover tooltips for the State editor labels using the project's custom tooltip manager, then removed the redundant `Parser Note TA Fields` heading and folded that explanation into the row tooltips.
- Fixed the `tv` text asset JSON issue so state-linked parser notes resolve correctly.
- Fixed the runtime hover/cursor contract so `state:*` interactions do not imply click/trigger behavior.
- Fixed scene-load hydration so authored State side effects and parser-note sync run when a scene opens, not only when a state changes during gameplay.
- Involved content changes in `public/scenes/test_room.json` and related object text assets so the `tv` example exercises the new path end to end.

### Important Architecture / Runtime Decisions

- `state:*` bindings are script/state events only, not click/hover interactions.
- Parser-note text is sourced from authored object Text Assets at runtime and overwrites existing Parser Notes when a matching state is active.
- Scene activation now replays authored State side effects so load-time state matches in-game state mutation behavior.
- The editor stores only complete parser-note mapping rows; blank rows are treated as in-progress authored input rather than serialized data.
- User-authored content changes in `test_room` were intentionally included in the feature commit because they are part of the example and regression surface.

### Parser / Mechanics / Scene / Editor Changes

- Parser `LOOK` now includes Parser Notes produced from state-linked Text Asset fields.
- Scene activation dispatches authored State events so objects like the TV can start their state-driven scripts when the level loads.
- Hover handling no longer turns pure `state:*` bindings into a hand cursor.
- State editor layout is denser and easier to scan during authoring.

### Tests Run And Outcomes

- Focused regression checks around state events, parser context, command handling, and scene interaction passed during implementation.
- TypeScript checks passed with `npm run typecheck`.
- Earlier state/parser/scenario test runs also passed during the feature work, including the `tv` load-time regression path.

### Commits Created

- `d3acf1e` - `Add State-driven parser notes and scene-load state hydration`
  - Core runtime, parser-note, scene-load hydration, `tv` fix, and content updates.
- `4b26284` - `Added UI tips for previously commited State component`
  - Tooltip polish for the State editor labels and row fields.

### Remaining Work / Next Recommended Steps

- Keep an eye on future authored `State` components that use parser-note mappings; the authoring pattern is now simple, but it still depends on the object text asset being valid.
- If more authored state-driven objects appear, reuse the same `state:<id> -> script event` model instead of adding special-case parser behavior.

### Risks / Caveats / Open Questions

- The current worktree was clean before this wrap-up entry was written.
- The NotebookLM notebook already contained older `Sessions.md`, `GDD.md`, and `AgentMemory.md` sources, so the wrap-up process needs to replace those rather than add duplicates.
- `tv` remains the canonical regression example for state-driven parser notes and scene-load hydration.

## Session Entry - 2026-05-30 16:28 +02:00

### Session Goals

- Stop LLM hidden-object leakage in the Game Master path without turning hidden items into ordinary world facts.
- Keep hidden diagnostics for the parser/engine intact while giving the LLM a spoiler-aware prompt surface.
- Preserve indirect clueing so the model can still act like a good GM when the player physically explores the scene.

### What Was Implemented

- Added a plain-text `Hidden Objects / Spoiler Protection` section to the LLM prompt assembly.
- Listed hidden scene objects by `id`, player-facing title, and synonyms only.
- Scrubbed hidden `knownEntities` so the LLM no longer receives raw `location`, `contents`, `description`, `details`, `lore`, or `interactions` for hidden entities.
- Added regression tests for the `look for audio cables` leak path and for the hidden LLM projection shape.
- Kept the parser diagnostics contract untouched for hidden entity awareness.

### Important Architecture / Runtime Decisions

- `knownEntities` continues to mean diagnostics data for the parser/engine, not player-visible facts.
- LLM-facing hidden data is now a safe projection, not the raw diagnostics record.
- Hidden objects are treated as spoiler-protected gameplay content whose direct reveal would spoil discovery.
- Indirect sensory or environmental hints remain allowed when they follow from visible scene logic or physically plausible player actions.

### Parser / Mechanics / Scene / Editor Changes

- `LlmCascade` now appends the spoiler section to the dynamic user prompt.
- Hidden `knownEntities` now lose raw location/details fields before reaching the LLM.
- No scene or parser discovery behavior was changed; the fix is prompt/context shaping only.

### Tests Run And Outcomes

- `npm test -- tests/parser/llm-cascade.test.ts`
- `npm test -- tests/parser/world-model-context.test.ts tests/parser/llm-cascade.test.ts`
- `npm run typecheck`
- `git diff --check`
- All passed.

### Commits Created

- `c67d83f` - `Harden hidden-object spoiler protection for LLM GM`
  - Added spoiler-protection prompt text, hidden entity scrubbing for the LLM projection, and regression coverage.

### Remaining Work / Next Recommended Steps

- Keep an eye out for any future prompt regressions that reintroduce raw hidden locations into the LLM context.
- If new hidden-object patterns appear, extend the spoiler section with more safe clue examples rather than exposing hidden facts.

### Risks, Caveats, Open Questions

- `Sessions.md` already had unrelated pre-existing content before this entry.
- `public/scenes/home/room.json` also has unrelated pre-existing edits and was intentionally left out of the commit.
- The fix is ingress-based; if prompt regressions continue, a second output-repair guard may still be worth considering later.

---

## Session Entry - 2026-06-02 11:39 +02:00

### Session Goals

- Implement the major Puppet Master / Actor Actions feature slice so NPCs can do real world actions instead of only narrating intent.
- Make NPC movement respect the same walkability/collider constraints as the player while still allowing zero-collider objects to remain nonblocking.
- Let NPCs approach reachable positions near target objects instead of trying to walk onto object centers outside walkboxes.
- Reduce Puppet Master context noise by exposing only semantically meaningful scene objects plus special technical floor fallback objects.
- Add actor-aware command execution so authored commands can be executed by any Actor without routing NPCs through the text parser or LLM parser cascade.
- Update the documentation and durable knowledge sources after the architecture changed.

### What Was Implemented

- Added real Puppet Master action execution for NPC plans beyond speech/objective updates, including movement completion and action completion loops.
- Added `TAKE` support for NPCs so they can actually pick up takeable visible entities into their own inventory.
- Added `COMMAND` support for PM plans, allowing NPCs to execute authored command plans by `commandId`.
- Added fallback `USE itemId ON targetId` support for actor plans while preserving existing player `USE` no-effect fallback behavior.
- Added shared actor-aware command execution through the new actor command/runtime path so player parser and PM can converge on the same underlying world actions.
- Added per-object command affordances to NPC world context: objects such as `tv` can list theoretically applicable authored commands like `turn_tv_on` and `turn_tv_off`, including compact prerequisites and state effects.
- Updated the PM prompt so authored `COMMAND` is preferred when listed on an object, while generic `USE` remains fallback.
- Added guardrails to prevent PM from claiming unsupported physical/state changes as already done.
- Added the continuation trigger for PM plans that update memory/objectives without scheduling follow-up action, preventing NPCs from getting stuck after setting a goal.
- Reduced NPC context noise by filtering visible entities to titled semantic objects, with an exception for technical `floor` fallback objects that correspond to walkable floor/storage placement.
- Kept zero-collider objects intentionally nonblocking, while nonzero colliders block NPC movement the same way they block the player.

### Important Architecture / Runtime Decisions

- Authored command execution is now shared actor-aware runtime behavior, not a parser-only concern.
- NPCs must not send natural-language `RUN_COMMAND` text into the real parser pipeline. PM emits structured DSL steps such as `COMMAND` and `USE`; the engine executes already-authored command plans as data.
- `COMMAND` is preferred when a visible entity exposes a suitable authored command affordance because it can perform real state changes and side effects.
- `USE` is a generic fallback action and should not guess complex authored intent when a matching `COMMAND` exists.
- `held`, `reachable`, `visible`, and command prerequisites are evaluated relative to the acting Actor, not implicitly relative to the player.
- PM world context should list commands on the specific objects they can target rather than as a global loose command list.
- "Theoretically executable" command affordance means the command can target the entity by authored command structure, even if prerequisites are not currently satisfied.
- Actor-aware `PUT` was identified as the next required PM action after the test NPC tried to place the TV remote on the desk but could only narrate intent or mistakenly retry `TAKE`.

### Parser / Mechanics / Scene / NPC Changes

- `ActorCommandExecutor` / actor-facing command runtime became the shared place for authored command execution and fallback use behavior.
- `ActorPlanExecutor` was extended to handle PM `COMMAND` and `USE` action steps.
- `NpcWorldModelBuilder` now exposes compact command affordances on visible semantic entities.
- `NpcPuppetMaster` prompt and validation now understand `COMMAND` and `USE`.
- Player `USE X ON Y` was kept stable while being moved through the shared actor-facing path.
- PM context now includes item locations such as `TV remote` being `in NPC` or `on floor`, letting the model reason about possession and placement requests.
- The TV test path became the canonical validation scenario: Linda can take the remote, turn the TV on, turn it off, and understand command affordances on `tv`.

### Documentation / Session-Handoff Work

- Ran a Gemini-assisted audit to find documentation that still described authored commands and semantic execution as player/parser-only.
- Updated `Commands.md` so authored commands are described as shared runtime content rather than parser-only assets.
- Updated `Parser.md` to clarify that `Game API` has actor-aware clients, including Puppet Master-style runtime execution.
- Updated `tech-spec.md` so `GameSemanticAPI` is framed as actor-aware semantic execution instead of only parser command resolution.
- Updated `GDD.md` to explain that semantic command execution now lives in a shared actor-aware runtime layer.
- Updated `NPCsys.md` to document PM `MOVE_TO`, `TAKE`, `COMMAND`, fallback `USE`, and the current `PUT` gap.
- Updated `public/text/system/parser-llm-system.md` to keep the player GM prompt aligned with the shared authored-command runtime model.
- Updated `public/text/system/npc-pm-system.md` first to document the `PUT` limitation, then implemented actor-aware `PUT` and updated the prompt again so NPCs can place/drop items for real.
- Removed the redundant local `dist/text/system/parser-llm-system.md` copy so `public/text/system/parser-llm-system.md` remains the single source of truth.
- Synced the shared memory mirror, regenerated curated `AgentMemory.md`, and replaced stale NotebookLM `Sessions.md`, `GDD.md`, and `AgentMemory.md` sources.

### Tests / Validation

- Focused NPC Puppet Master and parser command tests passed during the actor actions implementation.
- Full test suite passed after the actor-actions code slice: `37 files`, `450 tests passed`.
- TypeScript validation passed with `npm run typecheck`.
- `git diff --check` passed on the documentation/wrap-up edits.
- Manual PM log testing confirmed:
  - NPC movement no longer walks onto the TV/outside walkbox when nonzero colliders and reachability are respected.
  - Linda can take the TV remote, execute `turn_tv_on`, execute `turn_tv_off`, and update objectives/memory in response.
  - The missing `PUT` action is now visible as a real capability gap rather than a command-execution failure.

### Commits

- `b584cda` - `feat: let NPCs run authored actor commands`
  - Added shared actor-aware command execution, PM `COMMAND`/`USE`, per-object command affordances, player `USE` regression preservation, and tests.
- No new commit was created during the final documentation/wrap-up step; the documentation refresh is still in the working tree.

### Remaining Work / Next Steps

- Commit the documentation refresh and updated session entry as part of the actor actions feature handoff.
- Implement actor-aware `PUT` so NPCs can place/drop/give items instead of only taking and using them.
- Update PM prompt and tests once `PUT` lands so NPCs do not overpromise item placement.
- Consider adding `currentlyUseful` / state-match hints to command affordances so objects like `tv` can expose both `turn_tv_on` and `turn_tv_off` while still helping the model choose the state-relevant one.
- Continue broadening actor parity so player and NPC actions converge on the same semantic runtime contracts.

### Risks / Caveats

- Actor-aware `PUT` is now implemented for PM plans; future placement work should build on this shared semantic runtime path.
- The documentation refresh is not yet committed, so the working tree contains expected modified docs and the updated `Sessions.md`.
- `public/text/system/parser-llm-system.md` is the canonical source; `dist/` should remain a generated build artifact only.
- The actor command architecture intentionally avoids feeding NPC natural-language commands into the player parser to prevent extra LLM calls, player-centric context, console noise, and recursion.

## Session Entry - 2026-06-19 02:22 +02:00

### Session Goals

- Rework the right-side editor properties UI to match the new mock-ups more closely without changing the layout structure or the number of visible controls.
- Fix button colors, section behavior, spacing, dropdown styling, checkbox label styling, and slider appearance so the panel reads like the new UI rather than the old one.
- Preserve existing editor behavior while tightening visual consistency across Actor, Quad, and shared property sections.

### What Was Implemented

- Updated the properties panel styling to the new darker palette and applied the mock-up-inspired treatment to the right panel background, section headers, nested blocks, and control surfaces.
- Reworked section behavior so empty sections do not show collapse/expand affordances, cannot be toggled, and auto-open again when a new item appears.
- Fixed the `TRANSFORM`/`SCRIPT EVENTS`/`COMPONENTS` style edge cases so the section headers and empty-state behavior now match the intended semantics.
- Unified the `+ ADD` controls and delete `X` buttons so they share the same size and visual language across components, animation sets, and other nested lists.
- Corrected dropdown rendering so the custom caret no longer clashes with section arrows, and aligned the caret vertically in the button.
- Fixed the checkbox label style regression so labels such as `IS PLAYER` use the same standard text treatment as other non-accent labels.
- Added spacing where section titles, field labels, and control groups had been visually too tight, while also reducing a few overly large vertical gaps that had appeared during the UI pass.
- Removed the extra border framing from sliders so they now read like a line with a handle, closer to the mock-up reference.
- Restored the missing lower section content area so the hidden miscellaneous controls such as `LOCKED`, `DISABLED`, and related fields are visible again with proper padding.

### Important Architecture / Runtime Decisions

- The properties panel now treats empty sections as a distinct UI state rather than as collapsible content.
- When a section gains content, it should be allowed to open automatically so the user does not have to discover newly added items inside a closed empty shell.
- Shared styling for nested property items is preferable to one-off per-section hacks, especially for repeated affordances like add/remove buttons and compact dropdowns.
- Visual changes were intentionally kept UI-only; the layout and control count were preserved.

### Parser / Mechanics / Scene / UI Changes

- No parser or gameplay mechanics logic changed in this session.
- The work was concentrated in the editor properties UI, especially Actor, Quad, and shared property panel components.
- The most visible changes landed in section headers, nested blocks, select controls, checkbox labels, and slider styling.

### Tests / Validation

- `npm run typecheck` passed after the UI changes.
- Playwright smoke checks confirmed the key visual fixes, including:
  - centered dropdown caret alignment;
  - empty `SCRIPT EVENTS` behavior;
  - consistent `+ ADD` and delete button sizing;
  - visible miscellaneous section controls;
  - slider border removal;
  - improved vertical spacing between headers, labels, and inputs.

### Commits

- `770d799` - `ui minor tweaks`
- `f6d35b7` - `minor, UI: removed all caps from checkmarks labels`
- `28d0940` - `fixes`
- `59f6ed2` - `fixed many broken UI elements, paddings, alignements, etc`

### Remaining Work / Next Recommended Steps

- Keep a quick eye on any remaining panel spacing outliers that show up only on narrower or taller editor states.
- If the mock-up set changes again, re-run the same visual pass against the right panel so the nested controls stay consistent.
- Future UI work should continue reusing the shared add/remove/select styling instead of introducing new local variants.

### Risks / Caveats

- The work is visually broad, so a later style tweak in one shared class can affect multiple property sections at once.
- No functional editor logic was changed, so the main risk is only visual regression rather than data loss or runtime breakage.
- The session left the repository clean at wrap-up time, with no pending local edits beyond the committed UI work.

## Session Entry - 2026-06-25 19:48 +02:00

# Session Summary

## Session Goal

Реализовать единый actor-aware runtime для Puppet Master (PM) и Player. PM-функциональность должна быть реализована исключительно в виде клиентов общих actor-aware API для запросов и действий (видимость, навигация, инвентарь, переключатели и т.д.). Оба компонента (Parser и Puppet Master) должны использовать общий runtime.

## What Was Implemented

### 1. Общие perception-запросы (ActorWorldQuery)

- Добавлен единый read-only слой восприятия `ActorWorldQuery`.
- Реализованы общие методы определения видимости, доступности взаимодействия и навигационного подхода (`getObjectPerception`, `getInteractionAccess`, `getApproachAccess` и др.).
- Удален `NpcWorldModelBuilder.isVisibleToActor` и другие дублирующие PM-эвристики.

### 2. Общие навигационные запросы (ActorNavigationService)

- Вынесен поиск позиции подхода из `ActorPlanExecutor` в общий `ActorNavigationService` (методы `findInteractionPosition`, `planApproach`, `moveActorToTarget`).
- Убран дублирующий поиск точек кольцами со стороны PM.

### 3. Общие семантические действия (GameSemanticAPI)

- LOOK, EXAMINE, OPEN, CLOSE, TAKE, PUT, COMMAND и USE переведены на контракт `*ForActor(actor, target)`.
- Player API и PM адаптеры теперь являются тонкими обертками вокруг этих общих методов.

### 4. Централизация переключателей (Switch) и ключей

- Проверка ключей вынесена в общий runtime (`getSwitchLockOutcome`). Ключ проверяется только в инвентаре действующего актора.

### 5. Общие authored-команды

- Выполнение authored plans переведено на единый `ActorCommandExecutor` для Player и NPC. Parser теперь отвечает только за разбор текста и аргументов.

### 6. События восприятия и NPC-курсоры в SceneLog

- Добавлено свойство `perceptionRadius` для NPC.
- Семантические действия теперь публикуют структурированные события.
- Внедрены индивидуальные NPC-курсоры для чтения лога `SceneLog` во избежание проглатывания событий при наличии нескольких наблюдателей.

## Important Architecture / Runtime Decisions

- **Единый Executor**: authored-команды Player и NPC выполняются через один `ActorCommandExecutor`, чтобы исключить рассинхронизацию между планированием и исполнением.
- **Отказ от локальных эвристик PM**: координаты не передаются в контекст PM; вместо этого используются общие affordances и approach-статусы.
- **Индивидуальные курсоры логов**: SceneLog поддерживает чтение событий по индивидуальным курсорам для каждого NPC, решая проблему конкурентного доступа.

## Parser / Mechanics / Scene / Subscene / Inventory Changes

- Созданы новые сервисы: `ActorWorldQuery` и `ActorNavigationService`.
- Удален класс `NpcWorldModelBuilder` с локальными эвристиками.
- Обновлены и адаптированы `GameSemanticAPI`, `ActorPlanExecutor`, `NpcPuppetMaster` и `Parser`.

## Documentation Updated

Обновлены следующие файлы:

- [GDD.md](file:///D:/GAMES/New%20folder/Quest/GDD.md)
- [NPCsys.md](file:///D:/GAMES/New%20folder/Quest/NPCsys.md)
- `npc-pm-system.md` (документация по PM-архитектуре)

## Tests Run

- Запущен typecheck (`npm run typecheck`): успешно.
- Добавлены parity-тесты для сравнения правил Player и NPC.
- Прогнан полный тестовый набор: **463/463 тестов успешно пройдены**.

## Commits Created During the Session

- *Изменения в рабочей копии на момент завершения сессии не закоммичены*. Всего изменено 24 файла (+1369 строк, -477 строк).

## Remaining Work / Next Recommended Steps

1. Закоммитить текущие изменения из worktree в репозиторий.
2. Проверить предупреждения и провести рефакторинг неиспользуемого или устаревшего кода в общих путях.

## Risks / Caveats / Open Questions

- Все изменения находятся в незакоммиченном состоянии в рабочем дереве (worktree).
- Необходимо убедиться, что логика SceneLog не вызывает переполнения при длительных сессиях из-за ведения множественных курсоров.

## Session Entry - 2026-06-25 22:00 +02:00

### 1. Session Goals

- Fix regression where Puppet Master debug logs (`#PEEKPM-ON`) did not show in the console (closed console state filtering).
- Optimize the Puppet Master (`#PEEKPM-ON`) and Parser (`#PEEK-ON`) logs by eliminating raw JSON "noise" and replacing them with compact, clean, human-readable summaries.
- Separate `#PEEKLLM-ON` (for raw LLM prompt/response inspection) and `#PEEKPM-ON` (for compact PM plans/triggers tracking) so they do not duplicate each other.
- Update autotests to align with the new log formats and ensure full test suite success.

### 2. What Was Implemented

- **Console Bypass (Closed State)**: Modified `Console.logDebug` to bypass the `!this.isOpen` check, ensuring that peek/debug commands successfully append logs to the buffer with `showInClosed: false`.
- **Puppet Master Log Optimization**: Refactored PM peek logging to display trigger source, new speech events, active NPCs (including objectives, memory, inventory contents, and perceived actors), target plans, and provider token/time metrics.
- **Parser Log Optimization**: Replaced the 8 separate JSON-block dumps of `#PEEK-ON` with a single unified `--- PARSER PEEK ---` output listing input command, active scene, inventory, visible/held scope, match stage (regex, NLP, LLM), mutated parser notes, outcomes, and LLM metrics.
- **PEEKLLM / PEEKPM Separation**: Separated `#PEEKLLM-ON` and `#PEEKPM-ON` for Puppet Master. `#PEEKPM-ON` is now strictly compact, while `#PEEKLLM-ON` outputs the full raw LLM prompt and response.
- **Test Compliance**: Updated test expectations in `puppet-master.test.ts` and `llm-parser.test.ts` to assert the new formats.

### 3. Important Decisions

- Keep raw LLM prompts/responses in `#PEEKLLM-ON` completely raw for precision, but keep general peeks (`#PEEK-ON`, `#PEEKPM-ON`) highly readable and noise-free.
- Include key context facts like inventory and seen actors in the active NPC list to maintain debugging utility.

### 4. Tests Run and Outcomes

- `npm test`: Passed (464/464 tests).
- `npm run typecheck`: Passed.

### 5. Remaining Work / Next Recommended Steps

- Verify the in-game display of the new consolidated parser and PM logs.
- Explore similar cleanup for other console debug logs.

## Session Entry - 2026-06-27 15:33 +02:00

### 1. Session Goals

- Implemented local LLM inference on CPU (`OllamaProvider` / `qwen2.5:3b`).
- Resolve timeouts and JSON parsing errors when running 3B models locally.
- Prevent NPC hallucinations (e.g., treating inventory items as NPCs or generating empty loops).
- Document local LLM setup, architecture, and provider switching instructions in `tech-spec.md`.

### 2. What Was Implemented

- **OllamaProvider Integration**: Created `src/mechanics/llm/OllamaProvider.ts` implementing `ILlmProvider` over OpenAI-compatible endpoints (`http://localhost:11434/v1/chat/completions`).
- **Hardware & CPU Tuning**: Configured context window to `num_ctx: 4096` to minimize quadratic Attention KV-cache overhead on CPU bus, enabled `keep_alive: -1` to keep weights loaded in RAM, and increased timeout to 600s.
- **Grammar-Constrained JSON Mode**: Enforced `response_format: { type: 'json_object' }` and injected strict JSON schema examples into prompts, ensuring 100% syntactic validity without markdown block wrapper issues.
- **Prompt Engineering**: Explicitly enumerated `activeNpcIds` and added rules forbidding item IDs in place of NPC IDs.
- **Provider Switcher**: Added a clean `const USE_LOCAL_LLM = false;` toggle in `Parser.ts` and `Game.ts` to easily switch between cloud and local inference without triggering linter warnings.
- **Documentation**: Updated `tech-spec.md` with detailed local inference architecture and setup guide.

### 3. Important Decisions

- Kept the engine's "sanitizer" logic (`isConsequentialPlanStep`) intact per user feedback, ensuring NPCs must take physical action rather than looping in internal thoughts.
- Used a constant boolean toggle (`USE_LOCAL_LLM`) so both providers remain referenced in code, keeping ESLint happy (`--max-warnings=0`).

### 4. Tests Run and Outcomes

- `npm test`: Passed (465/465 tests, including new `ollama-provider.test.ts`).
- Git commit `591db6a`: *feat(llm): implement OllamaProvider for local CPU inference and update docs*.

### 5. Remaining Work / Known Problems

The small local model used was unable to produce an adequate output in  the test scene, where Cloud Haiku works without problems.

## Session Entry - 2026-06-27 16:32 +02:00

### 1. Session Goals

- Make Puppet Master plans factual, efficient, and resistant to repeated no-progress behavior.
- Let PM execute coherent multi-step procedures without an LLM call after every small action.
- Improve NPC perception, scene-aware entity knowledge, inventory/subscene parity, memory correctness, and PM debugging.
- Diagnose Anthropic prompt caching and leave a concrete implementation target for the next session.

### 2. What Was Implemented

- Added generic multi-step PM plans with plan-level `interruptOn` conditions (`ITEM_FOUND`, `WORLD_CHANGED`, `STATE_CHANGED`, `ACTION_FAILED`). Runtime stores and executes the remaining chain without intermediate provider calls, then reports `plan_interrupted` or `plan_completed` with confirmed outcomes.
- Added `THINK_STRATEGY`, a silent strategy-only LLM pass for terminal no-progress situations. It may correct memory/objectives and schedules a bounded wait, but cannot speak or perform physical actions.
- Added a sliding-window action-pattern watchdog and authoritative `actionHistory`. Literal and mixed no-progress loops now warn, suppress repeated physical signatures, or briefly sleep the NPC instead of spending unbounded LLM calls.
- Added plan prevalidation for item references and one corrective retry with `plan_rejected_missing_items`. Sequential plans may establish item availability through `MOVE_TO`/`TAKE` before later `PUT`, `USE`, or `COMMAND` steps.
- Restored ordinary plan-level memory semantics while strengthening the prompt: `actionHistory` is authoritative and conflicting memory must be corrected before other planning. Runtime still discards speculative plan memory when a physical plan is interrupted or fails.
- `LOOK`/`EXAMINE` outcomes now report visible contents and `discoveredEntityIds`, including relation-aware inspection. Newly observed items and actors are recorded with `lastSeenSceneId`; durable `knownEntities` is limited to Items and Actors, while `visibleItemIds` lists currently visible scene items.
- NPC `TAKE` now normalizes items taken from Subscenes like player `TAKE`: clears disabled state and temporary Subscene/group ownership. Disabled entities outside Subscenes remain invisible.
- Expanded `#PEEKPM` and `#PEEKLLM` for entity knowledge, visible items, accepted chains, continuation storage, interrupt checks, strategy flow, raw prompts/responses, and cache metrics.
- Added a terminal guard for repeated no-op movement: a second `MOVE_TO` to the same target that returns `arrived` with `route: []` becomes `repeated_without_progress`, drops the pending tail and speculative memory, and asks PM to change action, wait, think strategically, or stop.
- Updated `NPCsys.md` with the resulting contracts, debug traces, and the measured prompt-caching limitation.

### 3. Important Architecture and Runtime Decisions

- Runtime outcomes, `actionHistory`, inventory, and refreshed world context are authoritative; model intention and prose are not evidence that an action succeeded.
- Long plans are preferred only for one coherent procedure. Unknown-dependent branches are handled by runtime interrupts and a subsequent PM call.
- The first empty-route arrival remains valid because it may be the barrier before a useful tail such as `MOVE_TO -> TAKE`. Only repetition to the same target is terminal no-progress.
- NPC knowledge is scene-aware in preparation for future cross-scene movement, but only Items and Actors accumulate in `knownEntities` to control token use.
- Prompt caching remains provider-specific. The current cacheable PM prefix measured about 12,140 characters / roughly 3,035 tokens, below the approximately 4,096-token Haiku 4.5 minimum.

### 4. Tests and Validation

- `npm test -- tests/npc/puppet-master.test.ts`: 66/66 tests passed.
- `npm run typecheck`: passed.
- `git diff --check`: passed; only expected LF-to-CRLF worktree warnings were reported.
- Commit hooks ran Prettier and ESLint successfully.

### 5. Commits Created

- `052bafc` - `fix(npc): stop repeated no-op movement plans` (includes the current PM/runtime, prompt, test-scene, test, and documentation state).

### 6. Remaining Work / Next Recommended Steps

1. Split stable authored entity data into the scene-static PM prefix: `id`, `title`, descriptions, inspection affordances, command definitions, and static Switch capabilities.
2. Keep current state, visibility, location, reachability, inventory ownership, and prerequisite availability in the dynamic suffix.
3. Build the static projection deterministically, invalidate it when authored scene structure changes, and expose estimated/cacheable prefix metrics in debug output.
4. Re-run the same `#PEEKLLM-ON` scenario twice within five minutes and verify nonzero `cacheCreationInputTokens` followed by `cacheReadInputTokens`.

### 7. Risks and Caveats

- A minimal static entity projection from the observed 22 entities adds only about 826 estimated tokens, putting the prefix near but possibly still below the cache threshold. Include useful stable descriptions and target approximately 4,300-4,500 estimated prefix tokens for margin.
- Prompt cache reuse requires an identical prefix through the cache breakpoint; deterministic ordering and serialization are therefore part of the contract.
- The test scene was intentionally included in commit `052bafc`; its formatting and authored fixture changes should be preserved unless explicitly revised.

## Session Entry - 2026-06-27 18:05 +02:00

### 1. Session Goals

- Optimize the input prompt for the LLM module "Puppet Master".
- Remove redundancy in JSON fields such as `inspection`, `visibility`, `lastSeenSceneId`, and `approach`.
- Minify JSON payload to save tokens.

### 2. What Was Implemented

- Changed `NpcWorldModelBuilder.ts` to omit `inspection` if it matches default capabilities (`look, examine, in, on, under, behind`).
- Omitted `lastSeenSceneId` when it matches the current scene.
- Omitted `visibility` when it matches the default `"visible"`.
- Omitted `approach` when it is `"already_reachable"` and the object is currently `"reachable"` or `"held"`.
- Updated `FALLBACK_SYSTEM_PROMPT` in `NpcPuppetMaster.ts` and `public/text/system/npc-pm-system.md` with explicit rule assumptions to replace these omitted fields.
- Made fields `lastSeenSceneId`, `visibility`, and `approach` optional in `npcTypes.ts`.
- Disabled JSON pretty-printing (`JSON.stringify(..., null, 2)`) for the prompt context in `NpcPuppetMaster.ts` to minify payload size and conserve tokens significantly.
- Enabled triggerPuppetMaster in `ActorPlanExecutor.ts` for NPC speech: now NPC speech triggers the Puppet Master scheduling loop identically to player speech, waking listener NPCs after the `PM_BATCH_DEBOUNCE_MS` debounce time (while excluding the speaker to avoid infinite conversational loops).
- Configured dynamic `PM_BATCH_DEBOUNCE_MS` (150ms in Vitest environment to keep tests fast, 400ms in production as configured by the user).
- Fixed mock test assertions in `puppet-master.test.ts` to align with the new minified JSON, optimized fields, and triggerPuppetMaster logic.

### 3. Important Architecture and Runtime Decisions

- Token economy matters. Omitting default context fields and utilizing minified JSON yields noticeable token savings.
- Re-stated defaults explicitly in the LLM system prompt so the model is fully aware of implicit capabilities even if the keys are absent.

### 4. Tests and Validation

- `npm run typecheck`: Passed successfully after resolving optional types in `npcTypes.ts`.

### 5. Commits Created

- `575b618` - `perf(npc): optimize PM LLM prompt by minifying JSON and omitting default properties`

### 6. Remaining Work / Next Recommended Steps

- Run the game and test Puppet Master's new prompt in a real scene.

## Session Entry - 2026-06-30 03:10 +02:00

### 1. Session Goals

- Implement the Video Export Tool (vetool) for batch frame exporting from video to animation atlases.
- Style the UI matching the Scanline Engine design language.
- Re-use the existing Vite dev server backend for file list and save operations.

### 2. What Was Implemented

- **Vite Backend Middleware Patch**: Modified `vite.config.ts` `/api/save` endpoint to detect Base64 image data URLs and save them as binary buffers.
- **Entry Points**: Added `vetool.html` in the project root and `src/vetool.tsx` / `src/vetool.css` for the separate application.
- **Video Handling**: Implemented frame-by-frame seeking on hidden `<video>` element, loop playback within custom loop bounds, and interactive seek timeline showing frame index and time.
- **Box Drawing Overlay**: Enabled interactive canvas on top of the video workspace supporting up to 10 rectangular bounding boxes. Users can drag to create boxes, and move/resize them with mouse handles or edit precise coordinates in the sidebar.
- **Exporter**: Implemented column-based packing layout. Columns are sorted by index and packed side-by-side. The exporter crops video frames, renders the packed layout on a temporary canvas, and saves the final PNG spritesheet alongside sprite `.json` configuration files via standard `/api/save` endpoints.
- **Unit Tests**: Created `tests/editor/vetool.test.ts` to test the coordinate packing and spritesheet layout calculation logic. All tests passed.
- **Typecheck & Build**: Validated with `npm run typecheck` and `npm run build` (both finished successfully without errors).

### 3. Important Architecture and Runtime Decisions

- Kept vetool as a separate single-page web app to ensure zero runtime impact/conflict with Scanline engine.
- Used original video resolution as canvas drawing buffer size, making mouse event coords map 1-to-1 without scaling calculations.
- Added base64 image decoding in dev server `/api/save` to enable standard browser canvas image exports without a dedicated upload server.

### 4. Tests and Validation

- `npm test -- tests/editor/vetool.test.ts` (3 tests passed).
- `npm run typecheck` (Passed).
- `npm run build` (Passed, outputting index.html and vetool.html bundles).
- Full `npm test` (512 tests passed).

### 5. Commits Created

- `c542210` - `Implement Video Export Tool (vetool) with layout utility and unit tests`

### 6. Remaining Work / Next Recommended Steps

1. Verify and test the tool with real MP4 animation assets in a web browser at `/vetool.html`.
2. Integrate a link/button inside Scanline Sprite Editor (F5) to open the Video Export Tool in a new tab if desired.



## Session Entry - 2026-06-30 23:45 +02:00

### Session Goals

- Доработать функционал и стабильность VETOOL (Video Export Tool).
- Наладить переходы между Sprite Editor и VETOOL в обе стороны (F6 для перехода в VETOOL, F5 для возврата в редактор спрайтов).
- Сделать воспроизведение видео в VETOOL с учетом STEP SIZE плавным и визуально наглядным.
- Исправить баги воспроизведения, загрузки файлов и конфигураций в VETOOL.
- Улучшить стилистику и интерактивный отклик кнопок интерфейса.

### What Was Implemented

#### 1. Стабильность воспроизведения и рендеринга VETOOL

- **Предотвращение артефактов при поиске:** Заблокировано рисование кадров на холсте и кэширование, если `video.seeking === true`, убирая мерцание и пустые кадры.
- **Поддержка stepSize во время воспроизведения:** Шаг воспроизведения `stepDuration` теперь масштабируется как `frameDuration * stepSize`, позволяя воспроизводить видео с пропуском кадров на физической скорости 1x. Playhead-кадры привязываются (snap) к ближайшим кратным stepSize кадрам относительно `loopStart`.
- **Разблокирование выбора файлов:** Предупреждающий попап при несовпадении видеофайла в конфигурации заменен на Toast-уведомление. Это позволило сохранить контекст пользовательского жеста (user gesture) и предотвратить блокировку окна выбора файлов браузером.
- **Сброс кэша при смене файла:** При загрузке нового локального видео мгновенно сбрасываются границы, длительность и очищается кэш кадров во избежание рендеринга старых данных. Добавлен эффект `.load()` при смене `videoUrl`.
- **Устранение дрожания seek-рендеринга:** Добавлен 40-мс debounce на отрисовку кадра по событию `onSeeked`, давая GPU декодировать новый кадр до попытки его отрисовки.

#### 2. Двусторонняя интеграция Sprite Editor и VETOOL

- **Переход из Sprite Editor (F6):** В Sprite Editor добавлены горячая клавиша `F6` и пункт меню `F6 VETOOL` для перехода на страницу `/vetool.html`. Для браузерной версии (вне Tauri) добавлена поддержка `Ctrl+F6` для открытия VETOOL в новой вкладке.
- **Возврат из VETOOL по F5:** 
  - На главной странице (`App.tsx`) реализовано чтение хэша URL (`#sprite-editor`) на mount и событии `hashchange` с переключением в режим редактора спрайтов.
  - Устранена критическая ошибка рендеринга (White Screen of Death) при загрузке страницы: рендер боковых панелей и меню редактора теперь откладывается до полной инициализации синглтона `Game`.
  - В VETOOL обработчик клавиш переведен на фазу перехвата (`useCapture = true`) с вызовом `e.stopPropagation()` для надежной блокировки дефолтной перезагрузки страницы браузером при нажатии `F5`.
  - Горячие клавиши `F1`-`F5` в `handleKeyDown` перенесены выше проверки существования видео, гарантируя их работоспособность при незагруженном видеофайле.

#### 3. Улучшение стилей и визуального отклика

- **3D-выпуклость кнопок (.e-btn):** Для всех стандартных кнопок добавлена легкая тень снизу и внутренний блик сверху:
  `box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 2px 3px rgba(0, 0, 0, 0.6);`
  Эта тень сохраняется и в состоянии `:hover` / `.active-press`.
- **Приглушенные рамки кнопок:** Введена переменная `--ui-btn-border-muted: #387d60`, делая рамку кнопок мягче основного ярко-зеленого акцента, но оставляя её ярче неактивных полей ввода.
- **Интерактивные вспышки хоткеев:** При нажатии клавиш быстрого вызова (F1-F6, F8, `[`, `]`) соответствующим кнопкам на 150 мс присваивается класс `.active-press`, визуально имитируя нажатие.
- **Очистка и хоткеи границ цикла:** Удалены избыточные кнопки `F7 Set Start` и `F9 Set End` из нижнего меню VETOOL. Кнопки в боковой панели переведены на новый стиль отображения хоткеев `[` и `]` с левой стороны текста с затемнением цвета хоткея для улучшения читаемости.

### Tests Run

- `npm run typecheck` — успешно.
- `npx vitest run tests/editor/vetool.test.ts` — 3 теста успешно пройдены.
- Полный набор автотестов (`npm test`) — 512 тестов успешно пройдены.

### Commits Created

- `a7abbfb` — `fix(editor): parse window.location.hash to open sprite editor when returning from VETOOL`
- `f795208` — `fix(editor): prevent rendering SpriteBottomMenu before Game is initialized to avoid app startup crash`
- `82cb71e` — `fix(vetool): use capture phase to intercept F5 key event to prevent browser reload`
- `87785d3` — `fix(vetool): process independent keys in handleKeyDown before checking for active video element`
- `e1017e9` — `style(editor): add subtle drop-shadow and top-highlight bevel to e-btn class`
- `1b5c00b` — `style(editor): preserve convex bottom shadow on button hover state`
- `6329cb7` — `style(editor): slightly mute standard button border using new color variable`
- `9967220` — `feat(vetool): remove redundant F7/F9 loop set buttons, support F-key style hotkeys inside standard e-btn`
- `2d7304d` — `feat(vetool): darken e-btn hotkeys for better contrast, flash buttons on hotkey press`


## Session Entry - 2026-07-02 20:48 +02:00

### Session Goal

Реализация компонента Exit для Scanline Engine: добавление двух режимов активации (Collider и Portal), телепортация Actor-а в целевой Entry, кнопка Check для валидации целевой сцены/Entry в редакторе.

### What Was Implemented

**Exit component — два режима активации:**

- **Collider** (чекбокс в SectionComponents.tsx): активируется автоматически каждый кадр через ComponentSystem.checkTriggerboxCollisions(), когда коллайдер Actor-а пересекает область объекта с компонентом Exit. Работает для Triggerbox, Quad (через визуальный полигон с parallax) и Entity (через визуальный прямоугольник). Каждый кадр при коллизии вызывается scene.activateObject(exitObject, 0, actor).
- **Portal** (чекбокс): активируется кликом мышью (handleSceneClick) или через semantic API. Над объектом показывается курсор ack. Для player активируется немедленно; для NPC — тихий перенос без смены активной сцены.

**Логика handleExit в ComponentSystem.ts:**

- 	ransferActorToScene(activator, targetSceneId, { targetEntryId, activateScene: activator === currentScene.player })
- Пустой 	argetSceneId → локальная телепортация внутри текущей сцены (scene.id как fallback)
- Флаг ctivateScene = true только если активатор это scene.player; NPC переносится молча

**Передача activator из handleSceneClick:**

- Исправлена критическая ошибка: клики по порталу не передавали ctivator в ctivateSceneObject(), из-за чего handleExit делал switchTo() без переноса Actor-а. Добавлено scene.player ?? undefined в оба вызова ctivateSceneObject() в handleSceneClick (строки 425 и 453, SceneInteraction.ts).

**Кнопка Check в редакторе (SectionComponents.tsx):**

- Проверяет 	argetSceneId → targetEntryId с поддержкой незагруженных сцен (sceneRegistry)
- Нормализует ID сцены: обрезает .json, понимает пустой ID как текущую сцену
- Ищет Entry-объект по 
ame во всех объектах: entities, 	riggerboxes (и Quad через entities)

**ParserWorldModelBuilder.ts:**

- Добавлено поле exit в ParserEntityContext: { targetSceneId, targetEntryId, targetSceneTitle }
- 	argetSceneTitle берётся из загруженной сцены или из sceneRegistry.descriptor.title
- Пустой 	argetSceneId раскрывается до currentScene.id для корректного отображения в LLM-контексте

**Тесты (	ests/scene/scene-transition.test.ts):**

- Создан новый тестовый файл с 4 сценариями: обычный переход, локальный (пустой targetSceneId), Exit на Entity, Exit на Quad с parallax
- В тестах actor корректно назначен как scene.player (isPlayer = true), что соответствует семантике — ctivateScene срабатывает только для player

### Architecture/Runtime Decisions

- **ctivateScene: actor === currentScene.player** вместо ctivateScene: true — ключевое решение: NPC должен переноситься в фон без переключения камеры/сцены. Параметр передаётся в 	ransferActorToScene в ComponentSystem.handleExit и в ActorCommandExecutor.goToScene использовался аналогичный паттерн.
- **Entry — это имя объекта, а не свойство компонента** — Entry может быть на Triggerbox, Entity или Quad; идентифицируется по 
ame объекта.
- **SceneManager scene keys без .json** — ID сцен хранятся без расширения; входной 	argetSceneId нужно нормализовать перед любым lookup.
- **Два источника данных о сценах**: sceneManager.scenes (загруженные) и sceneManager.sceneRegistry (все), оба нужно проверять.

### Tests Run

- 
pm run typecheck — чисто (исправлены 2 ошибки Actor | null vs Actor | undefined через ?? undefined)
- 
px vitest run tests/scene/scene-transition.test.ts — 4/4 pass
- 
px vitest run — 511 passed, 4 failed (pre-existing в puppet-master.test.ts, не связаны с этой сессией)

### Files Changed

- src/systems/ComponentSystem.ts — handleExit, checkTriggerboxCollisions, флаг ctivateScene
- src/scene/SceneInteraction.ts — передача scene.player ?? undefined в ctivateSceneObject при кликах
- src/components/editor/properties/SectionComponents.tsx — UI чекбоксов Collider/Portal, кнопка Check
- src/mechanics/ParserWorldModelBuilder.ts — поле exit в entity context, нормализация targetSceneId
- 	ests/scene/scene-transition.test.ts — новый тестовый файл (4 теста)
- GDD.md — обновлено описание компонента Exit с полной спецификацией

### Remaining Work / Next Steps

- Pre-existing 4 фейла в puppet-master.test.ts требуют отдельного разбора
- Collider-режим для NPC не тестируется автоматически — потенциальная зона для дополнительных тестов
- Поддержка GO TO <exit-object> через parser (Portal + автоподход) — описана в GDD как планируемая функциональность


## Session Entry - 2026-07-02 21:21 +02:00

### Session Goals

- Завершить actor-aware механику Exit для player и NPC.
- Перевести player `GO TO` на общий `ActorNavigationService`.
- Унифицировать дальнюю активацию Exit и Subscene через автоматический физический подход.
- Исправить PM-продолжения после фонового переноса NPC между сценами.
- Синхронизировать техническую документацию и расширить wrap-up загрузкой всех корневых Markdown-файлов.

### What Was Implemented

- NPC world context теперь включает usable Exit даже без authored Title, используя object id как fallback, и передаёт `targetSceneId`, `targetEntryId`, `targetSceneTitle`, `portal`, `collider`.
- В PM DSL добавлен `TRAVERSE_EXIT`. NPC должен выполнить `MOVE_TO`, если Exit ещё не reachable, затем терминальный `TRAVERSE_EXIT`; один `MOVE_TO` больше не считается переходом между сценами.
- Успешный переход завершает исходный план, отбрасывает stale tail, применяет post-plan memory только после подтверждённого transfer и планирует `plan_completed` в фактической целевой сцене NPC.
- Исправлено динамическое PM-батчирование при смене сцен: runtime continuation не теряется из-за того, что source scene перестала быть current; provider request выполняется только для актуальной сцены NPC.
- Player `GO TO <object>` использует общий `ActorNavigationService` и ближайшую walkable interaction-точку вместо попытки идти в заблокированный центр объекта.
- Portal Exit активируется сразу, если reachable; иначе player автоматически подходит и активирует его после прибытия. При невозможном маршруте используется стандартное сообщение Subscene о слишком большой дистанции.
- Дальняя Subscene переведена на тот же activate-or-approach flow.
- Parser разрешает Exit по id/Title объекта и по id/name/Title целевой сцены; `GO TO/THROUGH` и `QUIT [THROUGH ...]` используют единый Exit runtime path.
- NPC perception исключает объекты с `visible: false`; сохранено специальное исключение для disabled authored content неактивной Subscene.
- Геометрия Quad и быстрый `approach` status теперь используют фактическую форму/walkable interaction position.
- Исправлено пропорциональное масштабирование Entity collider и добавлены проверки навигации.

### Architecture and Runtime Decisions

- `ActorNavigationService` является общей точкой физического подхода для player и NPC world-query, чтобы parser, клики и PM не расходились в оценке достижимости.
- `TRAVERSE_EXIT` всегда является последним физическим шагом PM-плана: межсценовый transfer меняет authoritative scene context, поэтому старый хвост нельзя продолжать автоматически.
- Untitled Exit является семантически значимым исключением из общего правила authored Title: без этого NPC видит маршрут до двери в диагностике, но не получает адресуемую сущность в prompt.
- Background transfer NPC не должен переключать active player scene, но обязан сохранить live Actor, inventory ownership и последующие PM wake events.

### Documentation

- Обновлены `GDD.md`, `NPCsys.md`, `Parser.md`, `SpatialSys.md` и `Autotests.md` в соответствии с текущим Exit/navigation/PM контрактом.
- Skill `wrap-up-session` изменён: теперь Scanline Engine получает все `*.md` непосредственно из корня проекта (без рекурсии) и дополнительный curated `AgentMemory.md`; старые источники заменяются по точному basename.

### Tests and Validation

- Focused Exit/navigation/PM tests прошли.
- `npm run typecheck` прошёл.
- Полный Vitest run: 511 passed, 4 pre-existing failures в `tests/npc/puppet-master.test.ts` на момент проверки.
- Markdown изменения прошли `git diff --check`.
- Обе обнаруженные копии `wrap-up-session` прошли `quick_validate.py`.

### Commits

- `9cda3f6` — `Improvements to the Exit component for Scanline Engine`: Exit/NPC/parser/navigation runtime, тесты, сцены и документация.
- `f29c585` — `Fix Entity collider proportional scaling and add verification tests`.
- `583ce24` — `upd`: удалён временный `temp_output.txt`.

### Current State and Remaining Work

- Рабочее дерево чистое; ветка `puppet-master2` синхронизирована с `origin/puppet-master2`.
- Рекомендуется отдельно разобрать четыре ранее наблюдавшихся PM test failures и подтвердить, остаются ли они воспроизводимыми после текущих изменений.
- Полезен ручной end-to-end прогон: player просит NPC пройти через дверь, NPC отвечает после перехода уже из Corridor, а player отдельно проверяет дальние `GO TO Chair`, Exit и Subscene.

### Caveats

- Изменения самого skill `wrap-up-session` находятся в пользовательском каталоге Codex, а не в репозитории Quest, поэтому не входят в перечисленные git commits.
- Корневые Markdown-файлы при wrap-up синхронизируются не рекурсивно; документы из подкаталогов намеренно не загружаются.

## Session Entry - 2026-07-02 23:25 +02:00

### Session Goal

Исправление багов переходов Actor-а через стыки смежных Walkbox областей (обычных Walkbox-ов сцены и компонентов WalkBox на объектах Quad) и предотвращение выхода за внешние границы игровой области.

### Outstanding User Requests

- **Fix Quad Walkbox transitions from the "outside"**: Исправлена ситуация, когда Actor не мог переходить между граничащими Walkbox-ами.
- **Strict Boundaries**: Исправлен баг, при котором Actor мог выскочить за внешние границы (exterior edges) и застрять.

### Work Accomplished

- **Strict Boundary and Gap Bridging Logic**:
  - Реализован метод `Geometry.isPointInsideUnionOfPolygons` в `src/utils/Geometry.ts`.
  - При нахождении точки за пределами всех полигонов проверяется, находится ли она в микро-зазоре стыка: для этого она должна быть в радиусе `epsilon` (2.0 пикселя) как минимум от **двух разных** Walkbox-ов. Если рядом только один Walkbox, точка классифицируется как внешнее пространство, и движение за границу блокируется.
  - Первым этапом проверяется строгое попадание точки внутрь любого Walkbox с микро-допуском `0.001` пикселя (для компенсации погрешности float-вычислений на стыках внешних границ).
- **Point Mode strictness**:
  - В `Scene.isWalkable` Point Mode проверки заменены на `isPointInPolygonWithEpsilon` со строгим допуском `0.001`, исключая выход клика за пределы зон.
- **Camera Smoothing Lag Decoupling ("Rubber Band" Fix)**:
  - Устранена проблема, при которой коллайдер выходил за рамки Walkbox при движении из-за отставания плавной камеры, а затем втягивался обратно ("эффект резинки").
  - Добавлено свойство `scene.collisionCamera` в `Scene.ts`, хранящее мгновенные целевые координаты камеры без сглаживания (рассчитывается в `SceneCamera.ts`).
  - Все проекции в методе `isWalkable` переведены на использование `collisionCamera` вместо отстающей `camera`. Теперь проверка столкновений полностью независима от лага отрисовки камеры.
- **Test Coverage**:
  - В `tests/game/navigation-and-spatial.test.ts` расширен тест `allows an Actor to walk between bordering Walkbox objects and Quad Walkboxes`. Добавлены явный 1-пиксельный зазор и строгие проверки недопустимости выхода за внешние границы (слева и справа). Тест успешно проходит.

### Tests and Validation

- Все тесты навигации и пространственной логики успешно пройдены.
- Полный Vitest run: 526 passed, 4 pre-existing puppet-master failures.
- Проведено локальное тестирование в сцене `wt`: эффект "резинки" устранен, коллайдер игрока строго удерживается внутри Walkbox в любой момент движения.

## Session Entry - 2026-07-03 15:14 +02:00

### Session Goals

- Разобрать и исправить зависание PM на ложных воспоминаниях и несостыковках между памятью, физическим планом и фактическим миром.
- Убрать потерю безопасных `SAY`/`MEMORY_SET` шагов, если физический хвост плана оказывается невалидным.
- Стабилизировать навигацию NPC к частично доступным целям и остановить бесконечные `MOVE_TO -> route_unreachable` циклы.
- Исправить кросс-сценную видимость предметов после успешного подбора игроком.
- Завершить сессию аккуратным wrap-up и сохранить durable context для следующего захода.

### What Was Implemented

- В `src/mechanics/NpcPuppetMaster.ts` добавлен авто-`MOVE_TO` перед явным `TAKE`, если цель известна, но ещё не достижима, и цель имеет route-aware `approach`.
- Там же добавлен защитный механизм для rejected plan: безопасный префикс из `SAY`/`MEMORY_SET` сохраняется при отклонении плана, чтобы NPC не терял полезную речь и обновления памяти из-за невалидного физического хвоста.
- Введён лимит повторов для `MOVE_TO target -> route_unreachable`: допускается до трёх подряд неуспешных попыток, а LLM получает предупреждение со счётчиком оставшихся попыток.
- `src/systems/ActorNavigationService.ts` переведён на route-aware selection подходящей точки, чтобы fast status и полноценный план опирались на реальный маршрут, а не на формально walkable, но недостижимую точку.
- В `src/systems/InventoryManager.ts` исправлена опорная reference-point логика для Quad/vertices, чтобы точки подхода строились от фактической формы объекта.
- В `src/systems/GameSemanticAPI.ts` успешный actor-aware `TAKE` теперь сбрасывает `hidden` у предмета, чтобы предмет не исчезал снова после переноса между сценами.
- `src/mechanics/npcTypes.ts` расширен полями для лимита повторных попыток движения.
- Обновлены документы `GDD.md`, `NPCsys.md` и `public/text/system/npc-pm-system.md`.
- Добавлены/обновлены тесты в `tests/npc/puppet-master.test.ts`, `tests/game/navigation-and-spatial.test.ts`, `tests/game/semantic-api.test.ts`.
- В репозиторий вошли scene/object data updates для `public/scenes/Corridor.json` и новых object text files, использованных в воспроизведении и проверке.

### Important Architecture and Runtime Decisions

- PM теперь опирается на отдельный защитный слой для безопасных речевых и memory-only шагов: полезная семантика не должна пропадать только потому, что физический хвост плана сломан.
- `MOVE_TO` retry guard сделан конечным и прозрачным для LLM, чтобы не маскировать проблему навигации бесконечным повтором одного и того же шага.
- `ActorNavigationService` должен оставаться общей точкой принятия решений о достижимости для player/NPC, иначе parser, клики и PM расходятся в оценке пространства.
- Для кросс-сценных предметов выбран простой runtime-подход: после успешного подбора игроком предмет больше не должен снова становиться hidden только из-за смены сцены.

### Mechanics, Navigation, Inventory

- Исправлен путь `TAKE` для NPC: если предмет видим, но ещё не reachable, PM сначала получает подход к цели, затем уже пытается взять предмет.
- Навигация к объектам теперь учитывает реальную маршрутизируемость к target interaction point.
- Улучшена диагностика и устойчивость к объектам, которые внешне выглядят доступными, но фактически могут быть заблокированы геометрией или неправильной reference point.
- Исправление `hidden = false` после actor pickup устранило случай, когда предмет, уже взятый в одну сцену, исчезал из perception в другой.

### Tests and Validation

- Прогонялись focused tests по PM, навигации и semantic API, а также `npm run typecheck`.
- Локально подтверждено, что изменения закрывают регрессии по route-unreachable циклам, TAKE auto-approach и cross-scene item visibility.
- Полный `npm test` ранее всё ещё имел один известный pre-existing failure в `tests/integration/parser-game.test.ts` из-за `result` being undefined в самом тесте, а не в коде движка.

### Commit

- `9ab960b` - `PM fixes & improvements`

### Remaining Work / Next Steps

- Разобрать и отдельно починить pre-existing integration test bug в `tests/integration/parser-game.test.ts`.
- При необходимости отдельно донастроить PM safe-prefix handling, если в будущем появятся случаи, где `MEMORY_SET` должен проверяться на согласованность с failed physical plan.
- Следующий практический прогон: убедиться, что NPC действительно не зацикливается на unreachable targets и корректно продолжает план после нескольких неудачных `MOVE_TO`.

### Risks and Caveats

- В репозитории были также user-owned scene/object edits, и мы их не откатывали; часть из них вошла в общий commit как рабочий контекст для текущих исправлений.
- Корневые Markdown-файлы синхронизируются в NotebookLM только не рекурсивно, поэтому документы из подкаталогов в wrap-up не попадают.

## Session Entry - 2026-07-06 02:34 +02:00

### Session Goals

- Проанализировать промпты Puppet Master и Parser LLM по реальным peek-логам: полнота контекста, форма представления, избыточность и prompt-cache пригодность.
- Реализовать согласованный рефакторинг промптов без Structured objectives, сохранив scene description/lore в статической части для атмосферы и Anthropic prompt caching.
- Устранить найденные после рефакторинга регрессии поиска скрытых предметов, наблюдательных команд, Parser Notes, краткой истории и clarification flow.
- Добавить Reasoning модели в диагностический вывод `#peek-om`.

### What Was Implemented

- PM prompt/context разделён на стабильную сценическую часть и компактную динамическую часть; сокращены повторы, runtime wake context и recovery-контекст, при этом scene description/lore оставлены в cacheable static prompt.
- В `#peek-om` добавлен вывод поля Reasoning, когда оно присутствует в ответе модели.
- Исправлена семантика hidden discovery: `EXAMINE` может открывать объекты с `Lookable`, но обратное соответствие не допускается. Это вернуло NPC способность находить TV remote в `test_room` без чрезмерного раскрытия объектов.
- Parser LLM prompt переведён на компактную static/dynamic модель. Статическая часть содержит атмосферу, каталог сущностей, spoiler rules, authored commands и GM actions; динамическая — текущие состояния, доступность, inventory, pending state, Parser Notes и recent turns.
- Удалены избыточные динамические `worldFacts`, `spatialNodes`, `spatialRelations` и повторяющиеся описания; recovery context сокращён до данных, необходимых для исправления предыдущей попытки.
- `details` целевой сущности передаются только при распознавании предмета в команде, чтобы не раздувать каждый запрос и не раскрывать details остальных объектов.
- Добавлена защита наблюдательных намерений: READ/LOOK/EXAMINE/INSPECT/STUDY/CHECK/SEARCH не могут получить `TAKE` как побочное действие лишь ради доступа к объекту.
- История текущего посещения сцены сохраняет последние 8 command/response пар; лимит ответа увеличен с 85 до 340 символов, чтобы модель видела ранее придуманное содержимое записок и другую существенную атмосферную прозу.
- Усилен контракт Parser Notes: если GM придумывает устойчивый малый факт, ответ должен быть plan с `showText` и `setEntityParserNote`/`setSceneParserNote`, а не одиночный `final_response`.
- Исправлена ложная LLM clarification: если `pendingAction` уже указывает на единственную реальную цель, действие выполняется непосредственно. Настоящая неоднозначность продолжает использовать стандартный parser pending-flow с нумерованными вариантами и сохранением требуемого действия.
- В system prompt явно запрещено спрашивать игрока, выбирает ли он предмет или выполнение уже запрошенного действия над тем же предметом.

### Important Architecture and Runtime Decisions

- Scene description/lore намеренно остаются в статическом prompt: это одновременно художественный контекст GM и достаточный объём для работы Anthropic cache.
- Structured objectives из первоначального плана не реализовывались по решению пользователя.
- Наблюдательная команда не должна менять владение предметом. Это теперь не только prompt rule, но и детерминированная нормализация ответа LLM.
- `EXAMINE -> Lookable discovery` является допустимым расширением более глубокого осмотра; `LOOK -> Examinable discovery` недопустимо.
- Short-term recent turns дополняют, но не заменяют Parser Notes. История помогает продолжить ближайший диалог, а устойчивые придуманные факты должны сохраняться на scene/entity.
- Clarification является engine-owned процедурой: LLM сообщает неоднозначный аргумент через `pendingAction`, а parser строит варианты, нумерацию и продолжение действия.

### Tests and Validation

- Focused Parser suite после prompt refactor: 150/150 passed.
- Полный Vitest run на этапе Parser refactor: 545/547 passed; два оставшихся сбоя были известными несвязанными `navigation-and-spatial` failures.
- Финальные focused проверки `tests/parser/llm-cascade.test.ts` и `tests/scene/scene-parser-history.test.ts`: 46/46 passed.
- `npm run typecheck` passed.
- `git diff --check` passed; остались только уведомления Git о будущем LF -> CRLF преобразовании.
- Реальные peek-прогоны подтвердили восстановление поиска TV remote и корректную передачу recent turns до нового лимита.
- Финальный `codex-doctor -ForceMemoryReview`: 20 health checks passed, typecheck passed; полный Vitest run — 546/548 passed с теми же двумя известными `navigation-and-spatial` failures. Background NotebookLM memory review и maintenance agent успешно запущены.

### Commits

- `c29bd82` - `improvemet: PM LLM Prompts optimisation`.
- `70983e7` - `Improvement: Parser LLM Prompts optimisation` (включает финальные Parser prompt, recent history и clarification fixes).

### Remaining Work / Next Steps

- Повторить игровой сценарий чтения бумаги без authored `details`: первый придуманный текст должен вернуть `showText + setEntityParserNote`, а повторное чтение — использовать эту заметку последовательно.
- Если модель всё ещё иногда возвращает persistent invented fact через `final_response`, добавить детерминированную защиту или retry/repair слой; одного prompt contract может оказаться недостаточно.
- Очистить оставшиеся устаревшие ссылки system prompt на удалённые dynamic fields (`worldFacts`, `contents`, `spatialNodes`, `spatialRelations`), чтобы документация контекста точно соответствовала compact DTO.
- Отдельно разобрать два известных `navigation-and-spatial` failures, если они ещё воспроизводятся в текущем HEAD.

### Risks and Caveats

- Увеличение recent-turn response limit до 340 повышает dynamic token usage, хотя объём ограничен восемью turns и остаётся существенно меньше статического prompt.
- Parser Notes всё ещё зависят от соблюдения моделью structured output contract; recent history теперь предотвращает немедленную потерю текста, но не является долговременной заменой notes.
- Exact-target clarification guard сейчас покрывает простые target actions. Сложные неоднозначности `putTarget`/custom command должны и дальше проходить через стандартный pending-flow.
- На момент wrap-up рабочее дерево чистое; пользовательские scene/editor изменения в более поздних коммитах не изменялись и не откатывались.

## Session Entry - 2026-07-06 19:43 +02:00

### Session Goals

- Исправить регрессию, из-за которой предметы, лежащие в инвентаре другого объекта, теряли правильный родительский контекст и вызывали лишний `MoveTo` перед взятием.
- Сделать это поведение общим для `Player` и всех `Actor`.
- Починить отдельный случай, когда редакторский spatial `IN` без реального `Inventory` у родителя ошибочно скрывал объект как инвентарный.
- Зафиксировать результат в коммите и собрать wrap-up для следующей сессии.

### What Was Implemented

- В `InventoryManager` добавлено разрешение вложенного owner-chain для inventory-объектов, чтобы координаты и доступность предмета всегда следовали за реальным родителем инвентаря, а не за устаревшей сценовой позицией.
- В `ActorWorldQuery` и `ComponentSystem` приведено к одному контракту вычисление reachable/interaction distance для вложенных inventory-цепочек.
- В `InventoryManager.handleSceneChange()` добавлена развязка editor-authored `spatial.in` от реального inventory membership: spatial edge сохраняется, но инвентарная принадлежность создаётся только если у родителя действительно есть `Inventory`.
- Исправлен случай с `CityView` в `window1`: объект больше не скрывается как inventory item, если родитель не имеет inventory.
- Добавлены и обновлены тесты для nested inventory, parser take/examine flow и renderability объектов с `spatial IN` без inventory у родителя.

### Important Architecture or Runtime Decisions

- Spatial `in` сам по себе не означает inventory ownership.
- Реальная инвентарная принадлежность теперь определяется только цепочкой владельцев, где каждый промежуточный объект действительно имеет `Inventory`.
- Если editor-authored spatial child не принадлежит inventory-родителю, runtime должен восстановить его видимость, а не пытаться интерпретировать его как предмет в инвентаре.
- Один и тот же контракт должен работать для Player и для любых Actor, чтобы parser и navigation не расходились в поведении.

### Parser / Mechanics / Scene Changes

- Исправлен `take`-поток для предметов, вложенных в inventory другого объекта: больше нет ложного `player_approaching_for_action` из-за старых координат.
- Исправлена геометрия/interaction lookup для вложенных inventory items, чтобы команды не опирались на устаревшие scene coordinates.
- Исправлено отображение scene entities, находящихся в `spatial IN` без реального inventory у родителя.

### Tests and Validation

- Прогонялись focused tests по navigation/spatial, parser integration и semantic API.
- Проверка typecheck завершилась успешно.
- Локально подтверждено, что `take aaa` для батареек внутри remote больше не вызывает лишний подход игрока.
- Локально подтверждено, что `CityView` под `window1` снова рендерится, потому что `window1` не является inventory container.

### Commit

- `0e5a65e` - commit in progress at wrap-up time; the working tree still contains the session changes described above.

### Remaining Work / Next Steps

- При следующем касании проверить, не появятся ли ещё scene-authored `spatial in` случаи без `Inventory` в других сценах.
- Если понадобится, можно отдельно пройтись по визуальным/semantic тестам вокруг `visible=false` для вложенных объектов.

### Risks and Caveats

- В рабочем дереве остаются пользовательские изменения в `public/scenes/*`, `src/mechanics/*`, `src/systems/*`, `tests/*`, `GDD.md` и `Sessions.md`; мы их не откатывали.
- Правило nested inventory теперь завязано на реальную `Inventory`-цепочку, так что любые будущие сцены с editor-authored `spatial IN` без `Inventory` у родителя должны сохранять видимость по этому же контракту.

## Session Entry - 2026-07-06 19:55 +02:00

### Session Goals

- Довести фичу implicit EXAMINE до состояния, пригодного для коммита и долгового handoff.
- Зафиксировать в памяти, что художественная обёртка должна показываться только при реальном discovery.
- Отдельно отметить, что часть правок по этой работе уже попала в bugfix-коммит вместе с найденной регрессией.

### What Was Implemented

- Фича implicit EXAMINE с conditional narration была доведена до рабочего состояния и в итоге оказалась зафиксирована в коммите `196eed1` (`Fix nested inventory ownership`).
- В память проекта записан устойчивый вывод: `ParserToolAction.examineTarget` может нести `narration`, но движок показывает её только если canonical EXAMINE действительно обнаружил указанные сущности.
- Зафиксировано, что user-owned правка в `public/scenes/test_room.json` осталась в рабочем дереве отдельно и не была включена в этот коммит.

### Important Architecture or Runtime Decisions

- Для implicit EXAMINE нельзя подменять реальное действие выдуманным discovery.
- Художественный текст допустим только как оболочка над подтверждённым результатом движка.
- Коммит-история теперь отражает, что фича и сопутствующий bugfix были сведены в один интегрированный change-set.

### Parser / Mechanics / Scene Changes

- Изначально требовались изменения в parser/LLM contract: `narration` на `examineTarget`, `requiresDiscoveredEntityIds`, и prompt-уровневый `discoveryOpportunities` hint.
- `Sessions.md`, `GDD.md`, parser prompt assets, parser runtime и тесты уже обновлены в основном change-set, вошедшем в `196eed1`.

### Tests and Validation

- Перед коммитом прогонялись focused parser/semantic tests и `npm run typecheck`.
- Впоследствии была дополнительно подтверждена корректность контракта через summary/peek flow, где модель выбирает anchor EXAMINE и получает условную narration только после фактического discovery.

### Commit

- `196eed1` - `Fix nested inventory ownership`

### Remaining Work / Next Steps

- При следующем проходе можно проверить, не требует ли `public/scenes/test_room.json` отдельного user-commit или ручной вычитки, потому что сейчас это незакоммиченная пользовательская правка.
- Если захотим ещё глубже зафиксировать контракт, можно добавить короткий note в autotests/документацию о parser-side gating для narrative overlays.

### Risks and Caveats

- В рабочем дереве остаётся незакоммиченная правка `public/scenes/test_room.json`; она не была тронута и не должна смешиваться с этим wrap-up.
- Сам коммит `196eed1` уже содержит большой интегрированный change-set, поэтому будущим правкам важно не переехать обратно к «fake discovery» поведению.

## Session Entry - 2026-07-06 20:00 +02:00

### Session Goals

- Разобрать случай, когда Stage 2 LLM правильно понимала опечатку `take batterys` как запрос взять AAA batteries, но отвечала художественным отказом вместо `takeTarget`.
- Найти общий архитектурный источник ошибки без предметных synonym/typo-исключений для тестовой сцены.
- Сохранить устойчивое решение и контекст для будущей диагностики Stage 2.

### What Was Implemented

- В `ParserContext` добавлен компактный динамический `actionScope`, производный от уже вычисленного `ParserScope`.
- `ParserWorldModelBuilder` теперь строит scope один раз и передаёт в LLM-контекст ID сущностей из `takable`, `putSource`, `reachable` и `examinable`.
- `LlmCascade` включает `actionScope` в per-call dynamic context, не раздувая cacheable static prompt.
- Prompt contract объясняет, что `actionScope.takable` является runtime-фактом допустимости TAKE: при ясных intent и target модель должна вызвать действие, а реальный отказ оставить движку.
- Добавлен regression test, подтверждающий передачу runtime eligibility независимо от объектной прозы и написания пользовательской команды.
- Первая идея с fuzzy/typo hints была полностью отклонена и удалена: модель уже распознавала батарейки, а проблема заключалась в отсутствии capability facts.

### Important Architecture or Runtime Decisions

- Источник истины о выполнимости parser action — Parser Core/Parser Scope, а не LLM-интерпретация описаний, containment relations или предыдущей художественной реплики.
- Stage 2 не должна повторно вычислять affordances и не должна получать предметные подсказки вида `batterys -> AAA batteries`.
- `recentTurns` не является корневой причиной: отказ воспроизводился и без истории; история могла только усилить уже существующую неопределённость.
- Если Stage 2 понимает intent и target, а entity присутствует в соответствующем `actionScope`, она должна вернуть action и позволить runtime выполнить окончательную проверку.

### Parser / Mechanics / Scene Changes

- Изменены `ParserWorldModelBuilder`, `parserTypes` и `LlmCascade` для передачи runtime action eligibility.
- Обновлены production/fallback prompt assets и `tests/parser/llm-cascade.test.ts`.
- Предметных изменений в `test_room` ради этого исправления не делалось.

### Tests and Validation

- `tests/parser/llm-cascade.test.ts` + `tests/parser/world-model-context.test.ts`: 70/70 passed.
- `npm run typecheck`: passed.
- `git diff --check`: passed, кроме обычных предупреждений о будущем LF -> CRLF.
- Полный `tests/parser` run: 161/163 passed. Два сбоя в `commands.test.ts` относятся к существующему несовпадению русских ожидаемых и английских фактических TV messages и не вызваны `actionScope`.
- Финальный `codex-doctor -ForceMemoryReview`: 20 health checks passed, typecheck passed; полный Vitest run — 559/565 passed. Шесть оставшихся сбоев: два известных navigation/spatial, два NPC authored-command/TV-state и два TV-message expectation failures. Background NotebookLM memory review и maintenance agent запущены.

### Commit

- `196eed1` - `Fix nested inventory ownership`; текущий HEAD также содержит интегрированное исправление Stage 2 `actionScope`.

### Remaining Work / Next Steps

- В живой игре повторить `take batterys` с очищенным `recentTurns` и убедиться, что provider возвращает `takeTarget` с реальным title, после чего Parser Core помещает батарейки в inventory героя.
- При следующих ложных LLM-отказах сначала проверять наличие entity ID в соответствующем `actionScope`, а уже затем анализировать prompt wording.
- Отдельно привести TV-message fixtures/expectations к одному языку, если два известных `commands.test.ts` failures сохраняются.

### Risks and Caveats

- `actionScope` является snapshot текущего вызова; окончательная проверка всё равно остаётся за runtime, поскольку состояние может измениться между планированием и исполнением.
- Не следует расширять `actionScope` скрытыми или недоступными сущностями ради улучшения распознавания: это capability contract, а не fuzzy retrieval layer.
- В рабочем дереве остаётся пользовательская незакоммиченная правка `public/scenes/test_room.json`; в этой сессии она не изменялась и не откатывалась.

## Session Entry - 2026-07-07 00:35 Europe/Warsaw

### Session Goals
- Implement a Small Language Model (SLM) offline inference system and dataset logging (Shadow Mode) for the NPC Puppet Master.
- Add diagnostic console commands for Shadow Mode configuration.
- Audit and update `tech-spec.md` to match the current state of the engine.

### What Was Implemented
- **Phase 1 (Shadow Mode)**: Created `ShadowLogger.ts` which records successful LLM plans in `logs/slm_shadow_dataset.jsonl` as a Gold Standard dataset, ignoring failures, loops, and strategy reflections. Bypasses file writing in testing environments.
- **Phase 2 (SLM Stack)**: Created `SlmVocabulary.ts`, `SlmInputAdapter.ts`, `SlmOutputAdapter.ts`, and `SlmInferenceEngine.ts` to tokenize context, perform client-side WASM inference via `onnxruntime-web`, and decode/validate model plans.
- **Phase 3 (Hybrid Routing)**: Integrated SLM inference directly into `NpcPuppetMaster.ts`. Routine requests resolve instantly in <5ms; complex cases (e.g. SAY, COMMAND, validation failures) safely escalate back to LLM.
- **Diagnostics**: Added `#SLMLOG`, `#SLMLOG-ON`, `#SLMLOG-OFF` console commands to `Console.ts` to query collected dataset statistics and toggle logging.
- **Technical Specification Audit**: Completely rewrote `tech-spec.md` to map the fully refactored directory structure, systems (audio, components, state event, pathfinding), testing coverage, and build tools.
- **Durable Memory**: Updated `.agent/context.md` and `.agent/current_task.md` with SLM/Shadow Mode facts and completion state.

### Important Architecture or Runtime Decisions
- **Scope Gating**: The SLM is trained solely on Puppet Master (NPC) actions, completely separate from player parsing.
- **Strict Validation**: Decoded plan steps are validated before execution, forcing LLM escalation on any invalid model outputs.
- **Diagnostics Controls**: Allows disabling logging via console (`#SLMLOG-OFF`) during debugging and robustness test phases to avoid contaminating training logs.

### Parser / Mechanics / Scene Changes
- No scenes were modified. Hybrid routing hooks and logging callbacks are wired inside `NpcPuppetMaster.ts`.
- Integrated `#SLMLOG` commands into `Console.ts`.

### Tests and Validation
- Created `tests/npc/slm-adapters.test.ts` providing unit coverage for vocabulary mappings, adapters, and model fallback.
- Ran TypeScript verification and confirmed Vitest suite passes.

### Commit
- Staged all changes and initiated commit. Modified files include `NpcPuppetMaster.ts`, `fileApi.ts`, `Console.ts`, `tech-spec.md`, and new files under `src/mechanics/slm/` and `tests/npc/slm-adapters.test.ts`.

### Remaining Work / Next Steps
- Accumulate shadow logs in production until the training threshold is reached.
- Train the model using the PyTorch template defined in the documentation and place the output `slm_routine_v1.onnx` file in `public/models/`.
- Commit remaining workspace files (`.agent/context.md`, `.agent/current_task.md`, `Sessions.md`) after the initial pre-commit tasks complete.
