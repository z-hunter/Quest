# Сбор датасета для SLM Puppet Master

## Назначение

`ShadowLogger` (`src/mechanics/slm/ShadowLogger.ts`) собирает обучающие примеры из успешных решений `NpcPuppetMaster`. Это shadow-путь: текущий PM/LLM или SLM обслуживает NPC, а результат попадает в dataset только после фактического завершения плана.

`SlmInferenceEngine` (`src/mechanics/slm/SlmInferenceEngine.ts`) считает отсутствие ONNX-модели нормальным состоянием Phase 1 — Data Collection и оставляет LLM fallback активным.

## Lifecycle записи

```text
NpcPuppetMaster wake → ShadowLogger.logWake(...)
       → pendingLogs[npcId]
       → plan execution / continuation
       → ShadowLogger.commit(...)
       → success + worldChanged → JSONL append
       └ failure/interruption → discard / no sample
```

`logWake` создаёт pending sample только при `isLoggingEnabled`. В тестовом окружении (`VITEST` или `NODE_ENV=test`) запись отключена. Для одного `npcId` одновременно отслеживается один незавершённый wake.

Поля `ShadowLogEntry`:

```ts
{
  timestamp: number,
  npcId: string,
  wakeTriggerType: string,
  wakeTriggerCode?: string,
  staticPrefixHash: string,
  minifiedDynamicContext: unknown,
  generatedPlans: NpcPlan[],
  outcome?: string,
  worldChanged: boolean
}
```

## Фильтрация

`commit` сохраняет строку только если `outcome === 'plan_completed'`, `worldChanged === true`, план не содержит `THINK_STRATEGY`, а trigger не относится к `plan_continued`, `plan_rejected_missing_items`, `plan_interrupted`, `repeated_without_progress`, `pattern_without_progress` или `pattern_loop_sleep`.

Dataset ориентирован на рутинные физические действия с подтверждённым изменением мира; рассуждение, ошибки, циклы и fallback-сценарии отбрасываются.

## Формат и размещение

Каждый принятый пример сериализуется одной JSON-строкой и дописывается через `appendProjectFile` в:

```text
logs/slm_shadow_dataset.jsonl
```

Это runtime/project-data output, а не статический asset из `public/`; файл может отсутствовать до первого принятого sample. `ShadowLogger.getStats()` читает его через `readProjectFileExisting` и возвращает:

```ts
{ enabled: boolean, sessionCount: number, totalCount: number }
```

## Вход и label для будущего SLM

`minifiedDynamicContext` сохраняет компактное состояние NPC в момент wake: scene/trigger, objectives, memory, inventory, known entities, action history, recent events и dynamic entities с affordances/reachability. `generatedPlans` — целевой plan DSL, который может кодироваться через `SlmInputAdapter`/`SlmOutputAdapter` и `SlmVocabulary`.

`staticPrefixHash` связывает sample с версией static prompt/entity projection и позволяет не смешивать данные от разных authored Text Assets или static scene projections.

## Границы

- Logger только фильтрует и пишет JSONL; очистка, split, токенизация, обучение и конвертация в `slm_routine_v1.onnx` в runtime-коде не представлены.
- Запись не производится до подтверждённого физического результата; ожидаемый эффект или plan-level memory не считаются label.
- Ошибка записи логируется и не меняет игровой outcome.
- `ShadowLogger.discard(npcId)` удаляет pending sample при interruption/failure.
- Данные не собираются в тестах, чтобы fixtures не загрязняли dataset.

[[SLM-and-Neural-Runtime]] · [[Game-Master-Implementation]] · [[NPC-Plan-and-Command-Execution]] · [[AI-Validation-and-Guardrails]] · [[AI-Data-Flow]]
