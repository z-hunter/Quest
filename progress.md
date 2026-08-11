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
- 2026-07-27: Retro Grid perspective now rejects homographies for concave, crossed, and collapsed Quads, including transforms whose projective horizon enters the unit square. Those shapes use the existing bounded bilinear fallback. Checkerboard and internal grid strokes are additionally clipped to the Quad contour, matching textured-Quad containment, so malformed editor geometry cannot emit screen-wide rays. Focused Quad tests and typecheck pass; browser skill client remains unavailable because the local `playwright` package is missing.

- 2026-07-30: 3D Perspective Walk follow-up. Replaced per-frame edge-distance interpolation for vertical movement with a continuous ray from the actor to the current visual intersection of the Quad's projected left/right side lines. Actor and per-vertex-parallax Quad geometry are projected into the same visual coordinate space. Focused tests cover ray continuity and camera-projected vanishing-point direction (8 passed); typecheck passes. Browser verification in `logo` traced 12 upward movement samples: the actor remained collinear with the current visual vanishing point until reaching the Quad's top boundary, with no console errors; the inspected screenshot rendered correctly.

- 2026-08-11: implemented Unified Surface Depth. Quad now resolves perspective-corrected local surface coordinates through the same projection used by Retro Grid, and uses them for interpolated P, local movement axes, and Depth scaling controller scale. `3d-parallax` keeps Actor/Static visually fixed while updating P; Actor speed is uniformly P-based for keyboard, click routes, and NPC routes, while `3d-perspective walk` only changes keyboard direction. Added `Depth scaling controller` (Min/Max, last matching visible Quad wins), effective non-mutating Quad geometry, default `ignoreScaling=true` for new/legacy Quads, editor controls, GDD, and regressions. Full `npm test`, typecheck, build, and diff check pass. Browser skill client remains unavailable because local `playwright` is absent.
# 2026-08-11 — Legacy Quad depth-scaling migration

- Added a `depthScalingVersion` save marker for Quad. Old scenes now force Quad `ignoreScaling=true` on load, preserving their authored geometry even when their inherited legacy JSON stored `ignoreScaling: false`.

- 2026-08-11: fixed numeric input handling in `Depth scaling controller`. Numeric label scrubbing now selects a number field owned by its label before inspecting siblings, so `Min` no longer edits `Max`; direct input/spinner interactions are excluded from scrubbing and retain native focus/editing.
- Validation: `npm run typecheck` and focused numeric/UI tests pass. Browser skill client remains unavailable because the local `playwright` package is missing.

- 2026-08-11: stabilized `3d-perspective walk` and 3d-parallax surface tracking. Perspective keyboard axes now turn off in a small edge zone so adjacent Walkbox regions cannot alternate incompatible directions; normal input can reach/cross the boundary. 3d-parallax now stores runtime surface `(u,v)` and reconstructs its visual point through the Retro Grid resolver after camera movement, preventing Actor/Static from drifting relative to grid lines. Focused movement/parallax regressions pass.
- Surface tracking is additionally run in deterministic Scene phases immediately after camera movement and after entity movement, removing dependence on Quad/Actor ordering in `scene.entities`.

- 2026-08-11: fixed Player/Actor snapping near a `3d-parallax` Quad edge with P=1. Camera auto-center now resolves Player position in screen space with P, eliminating camera/P feedback. Actor route targets and waypoints preserve their visual position whenever the surface updates P. Added camera and route regressions.
- Follow-up root cause: `Scene.isWalkable` evaluated Actor with `collisionCamera` while Quad WalkBox geometry used the smoothed render camera. Quad WalkBox collision now consistently uses render camera, preventing a false invisible boundary during auto-center. Added regression coverage.

- 2026-08-11: fixed a second, camera-independent Actor snap at dynamic Quad/WalkBox edges. The terminal route step previously assigned the route point directly when it was closer than one step, bypassing `isWalkable()`. If a 3d-parallax surface boundary changed since route planning, mouse or keyboard movement could therefore place the Actor inside the lower edge and trap it. Terminal steps now use the same walkability guard and stop with `route_blocked`; a focused regression covers the bypass. Focused test, typecheck, full `npm test`, and diff check pass. Browser verification remains blocked because the local `playwright` package is missing.

- 2026-08-11: `t-quad` exposed the remaining lower-edge P=1 snap: the perspective surface inverse used a forward finite difference at `u/v = 1`, producing a zero derivative. Newton iteration could then clamp an interior point to `v=1`, assign P=1 prematurely, and subsequently snap it to the lower grid edge. The inverse now uses central boundary-safe derivatives with a damped, improving-only Newton step. Regression covers an interior point on the `t-quad`-style lower perspective slope; it retains P below 1. Focused tests, typecheck, full suite (69 files / 771 tests), and diff check pass.
