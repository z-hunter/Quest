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
