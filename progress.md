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
