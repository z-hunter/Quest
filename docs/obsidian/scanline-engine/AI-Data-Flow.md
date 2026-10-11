# AI data flow

```text
Text Assets + Scene runtime
        ↓
ParserWorldModelBuilder / NpcWorldModelBuilder
        ↓
static prompt prefix + compact dynamic context
        ↓
SLM fast path ── ESCALATE ──→ LlmCascade / NpcPuppetMaster
        ↓
JSON/token normalization + validation
        ↓
Parser core (player) / ActorPlanExecutor (NPC)
        ↓
GameSemanticAPI + ActorWorldQuery + navigation
        ↓
Scene state, inventory, scripts, SceneLog
        ↓
UI/console and next NPC cursors
```

Authored facts и runtime state передаются отдельно: static prefix кэшируется, dynamic suffix пересобирается после world-changing events. Model output — предложение плана; only deterministic executors can mutate state. SceneLog и per-NPC cursors превращают результат действий в следующий наблюдаемый context.

[[Text-Assets-Implementation]] · [[Game-Master-Implementation]] · [[LLM-Provider-Contracts]] · [[SLM-and-Neural-Runtime]] · [[Data-Flows]]
