# NPC plan и deterministic command execution

## Типы

`src/mechanics/npcTypes.ts` определяет `NpcPlan`, `NpcPlanStep`, `NpcPlanInterruptCondition`, `NpcPuppetMasterResponse`, `NpcPlanExecutionOutcome` и контексты NPC.

## ActorPlanExecutor

`src/mechanics/ActorPlanExecutor.ts` — исполнитель плана с scheduler-ами wait/move/action/strategy. `executePlan` возвращает outcome по шагам. `MOVE_TO` и `TRAVERSE_EXIT` переходят через navigation service и завершаются callback-ом; `TAKE`/`PUT`/`USE`/`COMMAND` выполняются после проверки доступности. `clearState` и `clearAllPending` снимают pending continuation.

## ActorCommandExecutor

`src/mechanics/ActorCommandExecutor.ts` выполняет authored command affordances. Он разрешает аргумент entity, проверяет reachability/availability и held-state, затем вызывает `actorUseOn`, меняет inventory/state, запускает script или `goToScene`. Ошибка возвращается как typed outcome; прямой мутации от LLM нет.

Таким образом, Game Master выбирает намерение и последовательность, а executor проверяет физические и семантические инварианты мира.

[[Game-Master-Implementation]] · [[Scripting-and-Game-API]] · [[Scene-Interaction-Implementation]]
