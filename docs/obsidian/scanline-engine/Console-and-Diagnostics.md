# Virtual Console и диагностические команды

## Архитектура

`src/core/Console.ts` — runtime-консоль, принадлежащая экземпляру `Game` (`game.console`). Она хранит:

- `buffer: ConsoleLine[]` — строки `output`, `command`, `error`, `info`, `dialogue` с timestamp;
- `history: string[]` — последние 50 команд без непосредственных дублей;
- состояние `isOpen` и закрытого modal-показа длинного вывода;
- флаги parser/LLM/NPC peek и переключатели cascade stages.

Буфер ограничен `MAX_BUFFER_LINES = 2000`. `subscribe()` уведомляет React/UI и другие диагностические потребители. `log`, `logResponse`, `updateLine`, `logDebug` разделяют обычный вывод, потоковый ответ и debug telemetry.

Физическое открытие/закрытие переключается backquote в `src/core/Input.ts` и отражается в `UIOverlay.tsx`. React-слой `ConsoleOverlay.tsx` подписывается на Console, показывает buffer и ввод; сам Console не зависит от React. При закрытой консоли длинный вывод может открыть modal continuation, который закрывается через `continueClosedModal()`.

## Жизненный цикл команды

`processCommand(input)`:

1. игнорирует ввод в closed modal или пустую строку;
2. пишет исходную строку как `command` и добавляет её в history;
3. отделяет первое слово как command name, приводит только его к uppercase;
4. сохраняет casing аргументов;
5. вызывает callback из registry или пишет `Unknown command`.

`registerCommand(name, callback)` позволяет динамически добавлять команды; `#HELP` перечисляет встроенные и зарегистрированные команды. Игровой ввод проходит отдельный `preprocessGameplayInput`: `i → INVENTORY`, `x ... → EXAMINE ...`, `l ... → LOOK ...`, `q → QUIT`.

## Справка `#HELP`

### Управление runtime

- `#HELP` — список developer-команд и dynamic commands.
- `#CLS` — очистка buffer.
- `#RUN <script_id> [args...]` — запуск записи из `ScriptRegistry`.
- `#HALT [script_id]` — остановка всех или одного script.
- `#HALTNPC` — остановка всех NPC через `NpcPuppetMaster.haltAllNpcs()`.
- `#VALIDATE-SPATIAL` — `SceneSpatialValidator.validate` текущей сцены, вывод ошибок/warnings.

### Parser и LLM cascade

- `#STAGE1-ON/OFF` — включить/выключить Stage 1 regex parser.
- `#STAGE2-ON/OFF` — включить/выключить Stage 2 NLP handoff.
- `#LLM-ON/OFF` — включить/выключить Stage 2 LLM cascade.
- `#C1-ON` — normal Cascade 1 execution.
- `#C1-OFF` — принудительный LLM handoff для Cascade 1. Поддерживается также кириллическая форма `#С1-ON/OFF`.

### Peek/debug режимы

- `#PEEK-ON/OFF` — parser context, scope, stages, envelope и result JSON.
- `#PEEKLLM-ON/OFF` — system/dynamic prompts, raw responses, timings и cache metrics.
- `#PEEKPN-ON/OFF` — создание, обновление, очистка и stale-маркеры Parser Notes.
- `#PEEKPM-ON/OFF` — подробные wake/plan/continuation debug-сообщения Puppet Master.

### Сбор SLM dataset

- `#SLMLOG` — статистика Shadow Mode: enabled, samples текущей сессии и общее число JSONL-записей.
- `#SLMLOG-ON/OFF` — переключатель `ShadowLogger.isLoggingEnabled`.

Подробный формат данных описан в [[SLM-Dataset-Collection]].

## Связь с Parser и Puppet Master

`Parser` пишет промежуточные envelope и streaming LLM output через `log`, `updateLine` и `logDebug`. Peek-флаги только включают telemetry; они не меняют parser action contract.

`NpcPuppetMaster` и `NpcWorldModelBuilder` используют `parserPeekPmEnabled` для compact PM traces. `parserPeekLlmEnabled` раскрывает prompt/debug snapshot, включая static prefix и dynamic context. `#PEEKPN` показывает приватные Parser Notes, не player-facing narration.

`logDebug` не выводит закрытый debug-поток, если консоль закрыта и ни один peek-флаг не включён. Это отделяет обычный игровой текст от шумной диагностики.

## Контракты UI и состояния

`ConsoleLine.showInClosed` управляет тем, какие сообщения могут быть видны при закрытой консоли. `ConsoleOverlay` рендерит scrollable buffer, а canvas-слой `Game.renderConsole` способен отрисовать компактное закрытое представление. `UIOverlay` блокирует gameplay input, когда открыта консоль, editor или modal choice.

## Связи

[[Parser-Implementation]] · [[LLM-Prompt-Catalog]] · [[Game-Master-Implementation]] · [[SLM-Dataset-Collection]] · [[React-UI-Data-Flow]] · [[Script-Runtime]] · [[SceneSpatialValidator-Implementation]]
