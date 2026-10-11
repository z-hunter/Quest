---
type: implementation
system: SceneLog
---

# SceneLog — runtime event buffer

Файл: `src/scene/SceneLog.ts`.

## Data

`SceneLogEntryKind`: `speech|action`. Entry содержит timestamp, actor/display identity, text/action payload и known-by actor scope. `SceneLogData` — persistence shape для scene data.

## API

- `appendSpeech(args)` и `appendAction(args)` добавляют нормализованные события;
- `getUnreadEntries(npcId?)` выдаёт события после per-NPC cursor;
- `markProcessed(timestamp?, npcId?)` двигает cursor;
- `prune(now?)` удаляет устаревшие записи;
- `toJSON()`/`load(data)` обслуживают serialization.

## Role in Scene

SceneLog принадлежит Scene и связывает observable world actions/dialogue с NPC context builders. Это не authoritative world state: entity/component state хранится в Scene/Systems, а log — производный temporal buffer.

Связанные: [[Scene-Schema]], [[Parser-and-AI]], [[Actor-Access-and-Navigation]].
