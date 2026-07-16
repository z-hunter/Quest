---
type: implementation
system: ActorNavigationService
---

# ActorWorldQuery и ActorNavigationService

## ActorNavigationService

Файл: `src/systems/ActorNavigationService.ts`.

Типы: `ActorApproachStatus` (`already_reachable|route_available|unreachable`), `ActorApproachPlan`, `ActorLocalTeleportPlan`.

`planApproach(actor,target)` выбирает direct/reachable, walking approach или local teleport. `planWalkingApproach` использует Actor route planner и `Scene.isWalkable`; `findRoutedApproach` собирает candidate approach points. `planLocalTeleportRoute` анализирует local Exit/Entry edges. `moveActorToTarget` запускает выбранный route и возвращает ActorMoveResult/null.

## ActorWorldQuery

Файл: `src/systems/ActorWorldQuery.ts`.

Это read-only actor-centric projection: `getKnownObjects`, `getActionObservers`, `getActorListeners`, `getObjectPerception`, `getInventoryKnowledge`, `getInspectionAffordance`, `getSwitchAffordance`.

Query учитывает perception radius, visibility/hidden mode, spatial relation, blockers, active subscene и actor inventory knowledge. Параметр fast-path позволяет получить доступность без полного expensive perception calculation.

## Shared contract

Parser, click-to-move, GameSemanticAPI и NPC planning должны пользоваться этими сервисами, а не копировать reachability/perception rules.

Связанные: [[Scene-Interaction-and-Camera]], [[Scene-Text-Layer]], [[Parser-and-AI]], [[API-Contracts]].
