Original prompt: Давай временно переключимся с парсера к архитектуре приложения и придумаем способ автоматического управления загруженными сценами, чтобы не получалось так, что каждая открытая сцена остаётся в RAM. Возможно, разумно хранить несколько наиболее часто загружаемых сцен, а редко загружаемые из памяти выгружать. И вообще мониторить кол-во памяти занятое сценами, и регулировать кол-во сцен в кэше в зависимости от этого

- Решение: вводим Scene Registry + adaptive scene cache.
- Scene cache policy: единая для runtime и editor.
- Budget: по estimated scene weight, не по browser memory API.
- UI: в нижней строке editor слева показывать `MEM x | y`, где `x` — estimated memory, `y` — число сцен в cache.
- Важно не трогать локальные артефакты пользователя: `public/scenes/bug.json`, `public/scenes/ttt.json`, `public/scenes/test_room.json`, `public/text/scenes/new_scene.json`, `tasks.md`, `.nvimlog`.
- Реализовано: SceneManager разделён на registry + cache metadata; добавлены estimated weight, eviction, cache stats и registry scan по `public/scenes`.
- Реализовано: `game.goTo()` теперь ищет сцену через `sceneRegistry`, а не только среди живых scene instances.
- Реализовано: bottom menu editor показывает `MEM x | y` слева.
- Реализовано: save/save-as синхронизирует scene registration, чтобы cache/registry не теряли сцену после смены id.
- Проверки: `npm run -s typecheck` и `npm run -s build` проходят.
- Ограничение среды: локальный `npm run dev` smoke test в этой сессии блокируется sandbox-ошибкой `vite -> esbuild spawn EPERM`, поэтому браузерный прогон не был надёжно выполнен.
- Новое: добавлен debug-profiler сцен в `SceneManager`.
- `profileCurrentSceneMemory()` снимает snapshot по текущей сцене: weight units, heap snapshot, texture estimate, bytes-per-unit.
- `profileScenes([...])` прогоняет серию сцен, по очереди загружает их и печатает `console.table(...)` с `deltaMb`, `textureMb`, `kbPerUnit`.
- Debug API проброшен в `window.__QUEST_DEBUG__`:
  - `__QUEST_DEBUG__.profileCurrentSceneMemory()`
  - `__QUEST_DEBUG__.profileScenes([...])`
  - `__QUEST_DEBUG__.game`
- Browser smoke (MCP): `__QUEST_DEBUG__.profileCurrentSceneMemory()` и `__QUEST_DEBUG__.profileScenes(['test_room'])` отрабатывают, новых console errors нет.
- Новый этап: scene cache и image cache сведены в согласованную texture-first модель.
- Scene weight теперь должен доминирующе учитывать texture bytes, а старый graph-weight используется как малый корректирующий вклад.
- Budgets scene cache подняты в 3 раза; image cache получил отдельный budget по device class.
- В `GDD.md` в конец раздела `Техническая реализация` добавлено описание profiler и примеры вызова через `window.__QUEST_DEBUG__`.
- Проверка browser loop: skill client не запустился, потому что в окружении нет пакета 'playwright'; для smoke test использован встроенный browser MCP.

- New task: make editor bottom menu modifier-aware (Ctrl/Alt/Shift), with dynamic labels such as D ENABLE/DISABLE based on selected object state.
- Implemented state-driven EditorBottomMenu with modifier modes; added Alt/Shift Save As path and Ctrl action set; pending browser smoke verification.

- Verified in browser: bottom menu now switches between base / Alt / Ctrl / Shift layouts, and Alt mode updates D from Disable to Enable after toggling selected object disabled state.\n
- Selection slots implemented: Shift+1/2 saves current selection; 1/2 restores it; empty slot shows toast.\n
- Refactored Game.ts: extracted InventoryManager and GameSemanticAPI to src/systems/; added AnyComponent union type for strict component safety.
- Implemented universal Exit and Entry components: works on any object, supports same-scene teleport, automated collision-based actor transfer.
- Implemented instant camera snap: camera now perfectly follows player during transitions without smoothing delay.
- Infrastructure: Manually installed Playwright MCP and skill to .gemini directory (requires session restart to activate).

- 2026-07-02: implemented passive observed-Actor action events. `perceptionRadius` moved from NPC component to Actor, player sees nearby foreign actions as bracketed console lines, and observed actions no longer wake PM.
- Added structured/localized LOOK/EXAMINE, OPEN/CLOSE, TAKE/PUT, USE/COMMAND and Exit observation messages; SceneLog now stores `knownByActorIds` with legacy migration.
- Validation: typecheck passes; focused observed-action/SceneLog/Exit tests pass; full suite is 525 passed with the same 4 pre-existing PM failures.
- Browser loop caveat: Vite started successfully, but the required skill client could not launch because package `playwright` is not installed; the app also exposes neither `window.render_game_to_text` nor `window.advanceTime`, so deterministic parser-scene verification still needs dedicated instrumentation.

- 2026-07-27: implemented textured Quad rendering. Quad now reuses `spriteName`/Animator, supports `stretch` and independently-scaled `tile` UV mesh modes, and defaults to homography-based texture perspective. Texture replaces fill/checkerboard while Retro Grid remains above it. Added properties UI, GDD/vault documentation, and focused geometry/render tests. Browser loop remains blocked because the local `playwright` package is not installed.
- 2026-07-27: fixed Canvas2D hairline seams in textured Quad meshes by expanding each affine triangle by 0.75 screen pixel and clipping the combined result to the original Quad boundary. Focused Quad and snapping tests pass; browser loop is still blocked by the missing local `playwright` package.
- 2026-07-27: replaced source-resolution-proportional Quad tessellation after it caused severe FPS loss. Stretch now uses one cell rendered as a four-triangle fan through the homography center (four draw calls total), removing the single-diagonal paper-fold behavior. Tile still creates one cell per repeat. Seam overlap is 1.25 screen pixels, capped at 8% of the triangle's shortest edge.
- 2026-07-27: replaced the fixed textured-Quad fan with bounded screen-space mesh adaptation (maximum 32 triangles), independent of source sprite resolution. Nearly affine Stretch Quads now use a single flat affine draw. Seam coverage expands only triangle clips; their UV transforms remain calculated from original vertices to prevent overlap-induced texture mismatch. Typecheck, focused Quad tests, full test suite, and production build pass. Browser skill client remains unavailable because the local `playwright` package is missing.
