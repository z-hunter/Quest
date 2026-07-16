---
type: implementation
system: scripts
---

# ScriptRegistry и ScriptAPI

## Registry

`src/core/ScriptRegistry.ts` хранит `ScriptContext`, `ScriptFunction` и registered scripts. `update(deltaTime, sceneId?)` обслуживает active timers/scripts; registry связывает authored ids с executable functions.

## API facade

`src/core/ScriptAPI.ts` создаёт script-facing facade над `IGame`:

- logging/text: `log`, `text`;
- timers: `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `wait`, `update`, `dispose`;
- world lookup: `getQuad`, `getActor`, `getEntity`;
- typed state: `getState`, `setState`;
- scene: `transferActor`, `saveCheckpoint`;
- audio: `playSound`, `playSoundAttached`, `setSoundEffects`, `stopSound`.

`makeGlobal` exposes only deliberate script capabilities. Scripts do not receive raw parser internals; state mutations flow to StateEventSystem/Game API.

Связанные: [[Scripting-and-Game-API]], [[Component-and-State-Events]], [[Core-Game-Implementation]].
