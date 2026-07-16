# NPC World Model

`NpcWorldModelBuilder` (`src/mechanics/NpcWorldModelBuilder.ts`) строит ограниченную проекцию мира для конкретного NPC.

## Состав

- `NpcActorContext`: actor id, scene, inventory, memory, objectives, listeners и доступные действия.
- `NpcStaticEntityContext`: authored title/description, affordances и статические факты.
- `knownEntities`: наблюдавшиеся Items/Actors с `lastSeenSceneId` и последней локацией.
- exits и observed action locations; scene log читается через индивидуальный cursor NPC.

`build(scene, { npcIds })` может строить один или несколько контекстов. `getNpcActors`, `buildStaticEntityProjection`, `getNpcListenerIds` отделяют выборку акторов, статический слой и подписчиков событий.

## Фильтрация знания

В prompt попадают titled entities, видимые акторы, inventory и технический surface/walkbox только там, где он нужен навигации. Безымянные технические узлы и неизвестные открытия не становятся фактами NPC. `hasAuthoredObjectTitle` предотвращает выдачу внутреннего объекта как игрового знания.

Objectives и memory инициализируются из authored Text Assets только при соответствующем флаге; последующие runtime-изменения принадлежат actor state. Наблюдения обновляются после успешных действий и не подменяются ответом модели.

[[Text-Assets-Implementation]] · [[Scene-Log-Implementation]] · [[Game-Master-Implementation]] · [[Parser-World-Model]]
