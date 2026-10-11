# NPC plan и deterministic command execution

## Типы

`src/mechanics/npcTypes.ts` определяет `NpcPlan`, `NpcPlanStep`, `NpcPlanInterruptCondition`, `NpcPuppetMasterResponse`, `NpcPlanExecutionOutcome` и контексты NPC.

## ActorPlanExecutor

`src/mechanics/ActorPlanExecutor.ts` — исполнитель плана с scheduler-ами wait/move/action/strategy. `executePlan` возвращает outcome по шагам. `MOVE_TO` и `TRAVERSE_EXIT` переходят через navigation service и завершаются callback-ом; `TAKE`/`GIVE`/`PUT`/`USE`/`COMMAND` выполняются после проверки доступности. `clearState` и `clearAllPending` снимают pending continuation.

## Continuation и GIVE

`NpcPuppetMaster` хранит continuation под ключом фактической сцены Actor (`sceneId:npcId`). `awaiting_barrier` запрещает обычному scene scan заменить план: события накапливаются, continuation получает приоритет и после завершения отложенные события обрабатываются ровно один раз. Прерывание возможно только через `interruptOn`.

`GIVE` меняет ownership только после успешного semantic outcome `item_given`. До него речь, переговоры, plan-memory и второй план из того же provider response не могут подтверждать передачу. В одном response план recipient, зависящий от GIVE, откладывается; успешный `item_given` публикуется в SceneLog/perception, обновляет inventory и будит recipient для следующего PM turn. Ошибка сохраняет исходный inventory и завершает continuation через `ACTION_FAILED`.

## ActorCommandExecutor

`src/mechanics/ActorCommandExecutor.ts` выполняет authored command affordances. Он разрешает аргумент entity, проверяет reachability/availability и held-state, затем вызывает `actorUseOn`, меняет inventory/state, запускает script или `goToScene`. Ошибка возвращается как typed outcome; прямой мутации от LLM нет.

Таким образом, Game Master выбирает намерение и последовательность, а executor проверяет физические и семантические инварианты мира.

[[Game-Master-Implementation]] · [[Scripting-and-Game-API]] · [[Scene-Interaction-Implementation]]
