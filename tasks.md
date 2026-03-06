# tasks.md

## Текущий фокус (блокер перед Parser)

Закрыть долг по операциям с множественным выделением в Scene Editor:

- copy/paste группы;
- duplicate группы (`Ctrl + D`);
- save/load prefab для single и group;
- единая логика размещения при вставке.

## Критерии успеха

- [x] `Ctrl + C` копирует single/group выделение как сериализуемый payload.
- [x] `Ctrl + V` вставляет single/group с сохранением относительных позиций группы.
- [x] `Ctrl + D` дублирует single/group с тем же pipeline, что и paste.
- [x] `Ctrl + S` сохраняет single prefab и group prefab.
- [x] Group prefab поддерживает все selectable-типы (`Entity`, `Actor`, `Quad`, `Walkbox`, `Triggerbox`) со свойствами.
- [x] `Ctrl + O` загружает prefab и вставляет в позицию курсора (или в центр вида, если курсор вне canvas).
- [x] Toolbar `Load` сохраняет стандартное поведение загрузки (без cursor-only режима hotkey).
- [x] После paste/duplicate/load снимается старое выделение и выделяются только новые объекты.
- [x] Порядок объектов группы после вставки/дублирования сохраняется.

## Реализация

### Приоритет 1. Сериализация и instantiate pipeline

- [x] Ввести общий формат payload (`single/group`) для clipboard.
- [x] Поддержать legacy single JSON без `kind/version`.
- [x] Реализовать общий pipeline создания объектов из payload (single/group).
- [x] Ввести remap имён и ссылок внутри вставляемой группы.

### Приоритет 2. Hotkeys и редакторные операции

- [x] Перевести `copySelectedObjectToClipboard` на новый pipeline.
- [x] Реализовать duplicate для группы через тот же pipeline.
- [x] Перевести paste на общий pipeline с fallback в центр вида.
- [x] Исправить рендер подсветки multi-selection для Entity (использовать текущий объект цикла).

### Приоритет 3. Prefab single/group

- [x] Расширить `saveObject` на single/group.
- [x] Добавить формат `group_prefab`.
- [x] Расширить `loadObject` на single/group с backward compatibility.
- [x] Разделить режимы загрузки: `Ctrl + O` (`cursor`) и toolbar (`default`).

### Приоритет 4. Документация и приемка

- [x] Обновить GDD по copy/paste/duplicate и prefab single/group.
- [x] Прогнать `npm run typecheck`.
- [x] Прогнать `npm run build`.
- [ ] Ручной smoke-тест в браузере (single/group copy/paste/duplicate/save/load).

## Следующий этап (после закрытия блока)

- [ ] Вернуться к задачам Parser/Text resources.

## Правило сопровождения плана

- [ ] Перед началом новой задачи сверяться с `tasks.md`.
- [ ] При изменении приоритетов обновлять статусы и критерии.
