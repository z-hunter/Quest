# Game Master / NPC Puppet Master

## Ответственность

`NpcPuppetMaster` (`src/mechanics/NpcPuppetMaster.ts`) — оркестратор поведения NPC, а не источник истины мира. Он собирает контекст, вызывает `ILlmProvider`, принимает JSON-план, нормализует его и передаёт детерминированному executor-у.

## Контур вызова

1. `scheduleNpc(scene, npcId, trigger)` ставит NPC в очередь.
2. `enqueueNpc` объединяет близкие события; scene/NPC rate budgets ограничивают вызовы.
3. `NpcWorldModelBuilder` строит static projection и dynamic context.
4. `buildStrategySystemPrompt`/`buildStrategyMessages` формируют static prefix и dynamic suffix.
5. Provider возвращает текст/stream; `normalizeResponse`, `normalizePlan`, `normalizeStep` декодируют DSL.
6. `ActorPlanExecutor` выполняет шаги; continuation возобновляется по completion-событиям.

## План и guardrails

Поддерживаются `MOVE_TO`, `TAKE`, `PUT`, `OPEN`, `CLOSE`, `SAY`, `COMMAND`, `USE`, `WAIT`, `THINK_STRATEGY`, `MEMORY_SET`, `OBJECTIVES_SET`, `TRAVERSE_EXIT`. `validatePlanItems` отбрасывает неизвестные targetId; `expandImplicitApproaches` добавляет необходимые подходы.

`interruptOn` прекращает хвост плана на `ACTION_FAILED`, `ITEM_FOUND` или `WORLD_CHANGED`. Повторяющиеся недостижимые движения, no-progress и цепочки continuation подавляются; pending state и action history очищаются при terminal failure.

## Асинхронность и бюджеты

Вызовы батчатся с debounce, отдельные NPC и сцена имеют sliding-window лимиты. `pendingPlanContinuations`, wait/move/action schedulers и `executePlanAndTrackContinuation` разделяют сетевой inference и локальное продолжение; ожидание движения не требует нового LLM-вызова.

## Наблюдаемость

`getLastDebugInfo` и trace hooks дают prompt hash, provider/model, plan validation, continuation и loop-guard причины. Console peek-команды отображают эти данные, но не меняют семантическое состояние.

[[NPC-World-Model]] · [[NPC-Plan-and-Command-Execution]] · [[LLM-Provider-Contracts]] · [[AI-Validation-and-Guardrails]]
