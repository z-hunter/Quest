# AI validation и guardrails

## До исполнения

- JSON extraction и typed normalization отбрасывают malformed response.
- target IDs сверяются с текущим world model; неизвестные item/entity не исполняются.
- affordance, held-state, reachability, inventory capacity и route проверяются детерминированными API.

## Во время исполнения

- `interruptOn` обрывает план при заданных world/action events.
- movement/action completion продолжает pending plan без повторного inference.
- rate budgets и batching ограничивают стоимость/частоту вызовов.
- sliding-window pattern watchdog, repeated-unreachable и continuation guard подавляют циклы и no-progress.

## После исполнения

Только успешная физическая операция пишет SceneLog/worldChanged и обновляет memory/knownEntities. Ошибка не должна сдвигать cursor как успешное наблюдение. Debug/peek telemetry отделена от gameplay state.

[[Game-Master-Implementation]] · [[NPC-Plan-and-Command-Execution]] · [[Scene-Log-Implementation]]
