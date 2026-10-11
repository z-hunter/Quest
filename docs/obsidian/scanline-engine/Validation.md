---
type: validation
---

# Техническая валидация

Минимальный ladder для изменений:

1. `npm run typecheck`
2. затронутые Vitest tests через `npm test`
3. parser/scene/runtime autotests из `Autotests.md`
4. `npm run lint` и `npm run build` для широких изменений

| Зона | Защитный контур |
| --- | --- |
| API/React | typecheck + Vitest |
| scene/spatial/inventory | autotests и JSON fixtures |
| parser/Game API | parser/autotests и player-facing outcomes |
| editor persistence | save/reload JSON |
| LLM/SLM | `ILlmProvider` contract + deterministic fallback |

Связанные заметки: [[Architecture]], [[Data-Formats-and-Assets]], [[Scripting-and-Game-API]].
