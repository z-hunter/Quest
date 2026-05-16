# Spatial System

Этот документ описывает пространственную модель сцены Scanline Engine: raw spatial hierarchy, semantic text projection, контейнеры `Inventory`/`Surface`, видимость/доступность и то, как parser использует эту модель.

Цель документа - зафиксировать единый контракт, чтобы runtime, parser, editor, валидатор и тесты не вычисляли spatial truth по разным правилам.

## Основной принцип

В игре есть две разные, но связанные модели:

- **Raw spatial hierarchy** - физическая структура сцены. Она хранится на объектах через `spatial.parentNodeId` и `spatial.relation`.
- **Semantic spatial projection** - текстово значимая проекция raw hierarchy для parser-а, `LOOK`, `TAKE FROM`, `PUT INTO`, сообщений результата и debug context.

Parser не должен считать raw `.spatial` самостоятельным источником истины. Он должен работать с семантической проекцией и runtime-query API, которые строятся поверх `SceneTextLayer`, `InventoryManager` и проверок `Game`.

Raw hierarchy остаётся правдой сцены. Но player-facing текст, parser scope и relation-aware действия используют semantic projection.

## Spatial Relations

Поддерживаемые пространственные отношения:

- `in` - внутри.
- `on` - на поверхности.
- `under` - под.
- `behind` - за.
- `near` - пространственное отношение (proximity). Допускается в `spatial.relation` для визуальной/семантической группировки, но **запрещено** использовать в качестве storage relation.

### Правила использования `near`

- **(1) Validity в данных сцены (Scene Data):** `near` является полностью валидным значением для `spatial.relation` при расстановке объектов на сцене, когда нужно указать, что один объект находится "около" или "рядом" с другим (anchor).
- **(2) Parser / Runtime handling:** Парсер распознает токен `near` (например, `LOOK NEAR DESK`), а рантайм использует это значение исключительно для расчета пространственной близости (proximity-only relation). В отличие от `in` или `on`, `near` не дает доступа к вложенному хранилищу.
- **(3) Validation rules:** Валидатор (validator) **обязан отклонять** (reject) значение `near`, если оно указано внутри конфигурации любых storage containers (например, у компонентов `Inventory` или `Surface`), так как "рядом" не может быть слотом для хранения предметов.

В данных сцены relation обычно задаётся в нижнем регистре. В user-facing тексте relation форматируется человекочитаемо: `in`, `on`, `under`, `behind`, `near`.

## Raw Spatial Hierarchy

У объекта сцены может быть optional spatial placement:

```ts
spatial?: {
  parentNodeId: string;
  // 'near' используется только для proximity и отклоняется в storage components
  relation: 'in' | 'on' | 'under' | 'behind' | 'near';
}
```

`parentNodeId` указывает на другой объект сцены. `relation` описывает отношение текущего объекта к parent.

Пример:

```text
Cabinet
  in -> Book A
    on -> Book B
```

Raw truth:

- `Book A` находится `in Cabinet`.
- `Book B` находится `on Book A`.

Но относительно `Cabinet` обе книги находятся внутри шкафа. Это ключевой anchor-relative принцип, описанный ниже.

## Semantic Anchors

Для текстового слоя значимыми считаются объекты, у которых есть `Title`.

- Объект с `Title` становится semantic anchor.
- Объект без `Title` считается техническим узлом.
- Технические узлы схлопываются в текстовой модели.
- Если на пути вниз встречается новый объект с `Title`, он становится новым semantic anchor.

Это позволяет строить сложную физическую структуру сцены, не засоряя parser техническими объектами вроде `desk_surface`, `under-chair-slot`, `drawer_storage_switch`.

Пример:

```text
Desk (Title)
  in -> drawer_slot (no Title)
    on -> drawer_surface (Surface, no Title)
      on -> Key (Title)
```

Для player-facing текста `Key` не лежит "on drawer_surface". Она описывается относительно ближайшего значимого anchor: например `in the Desk`, если первое отношение от `Desk` к технической цепочке было `in`.

Если в цепочке появляется titled object:

```text
Desk (Title)
  in -> Drawer (Title)
    in -> drawer_surface (Surface, no Title)
      on -> Key (Title)
```

Теперь `Drawer` становится новым semantic anchor. Ключ описывается относительно `Drawer`, а не напрямую относительно `Desk`.

## Anchor-Relative Rule

Spatial relation зависит от anchor, относительно которого задаётся вопрос.

Правило:

> Для relation-aware текста и действий относительно anchor важна первая semantic relation от этого anchor к потомку. Внутренние отношения между более глубокими объектами сохраняются для запросов относительно этих объектов, но не отменяют отношение к внешнему anchor.

Классический пример:

```text
Cabinet (Title)
  in -> Book A (Title)
    on -> Book B (Title)
```

Относительно `Cabinet`:

- `Book A` находится `in Cabinet`.
- `Book B` тоже находится `in Cabinet`, потому что первый relation от `Cabinet` к цепочке - `in`.

Относительно `Book A`:

- `Book B` находится `on Book A`.

Из этого следуют корректные ответы:

- `LOOK IN CABINET` показывает `Book A` и `Book B`.
- `TAKE Book B FROM Cabinet` может найти `Book B`.
- `LOOK ON Book A` показывает `Book B`.
- `TAKE Book B FROM Book A` тоже может быть естественно допустимым.

Это не противоречие. Это одно raw tree, рассмотренное относительно разных anchors.

## SceneTextLayer

`SceneTextLayer` строит semantic projection для parser-а и текстовых команд.

Он отвечает за:

- выбор только titled objects как semantic entries;
- схлопывание untitled technical nodes;
- построение `effectiveParentId` и `effectiveRelation`;
- anchor-relative descendants;
- hidden/blocked/inactive-subscene access state;
- relation-aware target descriptor для сообщений `PUT`, `DROP`, `LOOK`.

Важные структуры:

- `SceneTextLayerEntry` - видимый semantic entry.
- `SceneTextLayerAccessState` - подробное состояние объекта: title, effective parent/relation, hidden, blocked, inactive subscene, gating switch.
- `SceneTextLayerSnapshot` - индекс semantic entries и children maps.
- `SceneTextLayerQuery` - read-side facade для повторного использования projection.

`SceneTextLayer` не должен мутировать сцену. Это read-side слой.

## Containers

Контейнером считается объект или технический storage node с компонентом:

- `Inventory`;
- `Surface`.

Оба компонента являются relation-aware storage slots. Они позволяют не только сказать "у объекта есть контейнер", но и указать, какое spatial relation этот storage slot представляет относительно player-facing anchor.

Контейнеры не создаются автоматически во время обычного gameplay/parser resolution. Если подходящего `Inventory` или `Surface` нет, значит действие невозможно или данные сцены неполные.

## Shared Container Fields

Общие понятия для `Inventory` и `Surface`:

- `relation` - spatial relation слота: `in | on | under | behind`.
- `capacity` - максимальное количество предметов.
- `groups` - разрешённые group IDs. Если пусто, принимаются любые предметы.
- `items` - хранимые item IDs или placements.

Runtime нормализует relations:

- `Inventory.relation` по умолчанию считается `in`.
- `Surface.relation` в runtime по умолчанию считается `on`, если relation отсутствует.

Несмотря на то, что отсутствие `Inventory.relation` и `Surface.relation` является валидным с точки зрения runtime, **SceneSpatialValidator** должен выдавать non-blocking warning, если relation опущен (чтобы явно подсветить implicit defaults). Кроме того, валидатор должен строго требовать (enforce) явного указания `Surface.relation` для authored built-in surfaces.

## Inventory

`Inventory` - контейнер для предметов (`Item`), который прячет содержимое из render layer.

### Inventory Storage State

Предмет, находящийся в `Inventory`:

- остаётся объектом сцены;
- получает `visible = false`;
- получает raw spatial placement `in` относительно owner;
- хранится в component `items`;
- доступен через `InventoryManager`.

Технически item в inventory всегда становится `IN`-child owner-а:

```text
Cabinet (Inventory relation behind)
  in -> Book
```

Но для text/parser слой использует relation inventory slot-а:

```text
Book is behind Cabinet
```

То есть raw storage placement и semantic relation - разные вещи.

### Main Actor Inventory

Главный inventory Actor-а - это `Inventory` component, который:

- расположен непосредственно на Actor;
- имеет relation `in`;
- существует в единственном экземпляре.

Только этот inventory считается "held inventory":

- он отображается в UI inventory;
- он используется командой `INVENTORY`;
- в него попадают предметы при `TAKE`;
- из него берутся предметы при `DROP`/`PUT` без scene source;
- именно его содержимое считается `held` в parser scope.

Если у Actor есть `Inventory` с relation `behind`, `under` или `on`, это обычный скрытый storage slot, а не held inventory.

Если у player Actor нет main `Inventory` с relation `in`, операции, требующие инвентаря (`TAKE`, `DROP`, `INVENTORY`), не создают его автоматически. Это ошибка данных сцены, которую должен подсвечивать валидатор.

### Protected Inventory

`Inventory.protected = true` означает, что внешний Actor не может свободно видеть или манипулировать содержимым этого inventory.

Protected inventory не должен попадать в обычную parser/text layer модель как доступный внешний контейнер. Исключение - собственный inventory Actor-а, которым этот Actor управляет.

## Surface

`Surface` - контейнер-поверхность, который размещает предметы в renderable пространстве.

Предмет, положенный на `Surface`:

- остаётся видимым;
- получает screen/world placement внутри геометрии surface;
- записывается в `Surface.items` как placement `{ id, x, y }`;
- получает `layer`, равный layer поверхности;
- получает raw spatial relation, соответствующий placement relation surface slot-а;
- может наследовать switch groups от surface/switch context.

`Surface` выполняет geometric fit:

- учитывает прямоугольник или polygon surface;
- старается не накладывать новый item на существующие;
- проверяет, что item помещается внутри surface;
- может отклонить placement даже при свободном capacity, если предмет физически не помещается.

Если surface находится внутри активной `Subscene`, item получает subscene-aware placement:

- временный `subsceneItemScale`;
- добавление в runtime-набор active subscene;
- корректный масштаб до расчёта посадочного места и drop animation.

Если surface управляется `Switch` target group, placed item наследует активные group IDs, чтобы переключение switch управляло им вместе с surface. При `TAKE` эти унаследованные groups очищаются.

## Built-In Containers

Built-in container - это `Inventory` или `Surface`, добавленный прямо на titled object.

Пример:

```text
Box (Title, Inventory relation in)
Shelf (Title, Surface relation on)
Chair (Title, Surface relation under)
```

В этом случае relation компонента является relation storage slot-а относительно самого object.

Примеры команд:

- `PUT key IN BOX` ищет `Inventory` или `Surface` с relation `in` на `Box`.
- `PUT book ON SHELF` ищет storage с relation `on` на `Shelf`.
- `PUT cassette UNDER CHAIR` ищет storage с relation `under` на `Chair`.

У одного titled object не должно быть двух storage components с одинаковым relation — даже если это разные типы компонентов (например, один `Inventory`, а другой `Surface`). Валидатор должен подсвечивать такие duplicate relation slots как ошибку.

Пример конфликта (invalid):
- `Box` (Title)
  - `Inventory` (relation: `in`)
  - `Surface` (relation: `in`)

В таком случае команды типа `PUT key IN BOX` должны быть отклонены валидатором из-за неоднозначности (неясно, в какой именно из `in`-слотов класть предмет).

## External / Technical Containers

External container - это storage component на untitled technical node внутри titled anchor.

Пример:

```text
Chair (Title)
  under -> under_chair_slot (no Title)
    on -> actual_surface (Surface relation on, no Title)
```

Player-facing semantics:

- `actual_surface` является surface **under Chair**;
- команда `PUT key UNDER CHAIR` может использовать эту surface;
- внутренний `Surface.relation = on` не превращает её в `ON Chair`.

Главное правило:

> Для external storage relation берётся по первому spatial edge от titled anchor к технической цепочке.

Если на пути вниз встречается titled object, traversal останавливается:

```text
Desk (Title)
  in -> Drawer (Title)
    in -> drawer_surface (Surface, no Title)
```

`drawer_surface` принадлежит `Drawer`, а не `Desk`.

Это защищает семантические объекты от случайного превращения в storage extension родителя.

## Spatial Objects Without Containers

Raw spatial hierarchy может описывать отношения без `Inventory` или `Surface`.

Пример:

```text
Chair (Title)
  under -> Key (Title, Item)
```

Такой item:

- может быть виден через `LOOK UNDER CHAIR`;
- может быть взят через `TAKE KEY`, если доступен;
- не создаёт возможность `PUT KEY UNDER CHAIR`, потому что storage slot `under Chair` отсутствует.

Read-only spatial relation и writable storage capability - разные вещи.

## Visibility, Hidden State, And Actionability

Parser context различает "видно" и "можно действовать".

Объект может быть:

- visible but unreachable;
- visible but blocked;
- hidden but known for diagnostics;
- inside inactive subscene;
- held in inventory;
- disabled and excluded from normal interaction.

### Disabled

Обычные disabled objects не должны участвовать в gameplay/parser как интерактивные объекты.

Исключение: titled objects внутри inactive `Subscene` могут оставаться в semantic visible context, чтобы parser знал о содержимом subscene и мог корректно распознавать команды. Но такие objects не становятся actionable до активации subscene.

### Hidden

Titled object может иметь hidden semantics:

- `lookable` - отсутствует в semantic world model, пока не раскрыт через LOOK context.
- `examinable` - отсутствует, пока не раскрыт через EXAMINE.

Hidden objects могут попадать в diagnostics как `knownEntities`/`hiddenKnown`, но не в обычный visible scope до reveal.

### Blocker And Switch

`Blocker` работает как всегда закрытый semantic blocker.

`Switch` работает как blocker, пока закрыт. В открытом состоянии он не блокирует relation.

Оба могут иметь:

- `transparent`;
- `blockedRelation`.

`blockedRelation` указывает, какое отношение блокируется: `in`, `on`, `under`, `behind`, либо `none`.

Opaque blocker:

- скрывает descendants из visible semantic context;
- делает их inaccessible;
- помещает их только в hidden diagnostics.

Transparent blocker:

- оставляет descendants visible;
- исключает их из actionability scopes (`takable`, `putSource`, `reachable`, `examinable`);
- позволяет parser отвечать "вижу, но не могу взаимодействовать", а не "не вижу".

## Distance And Reachability

Distance - runtime actionability check, а не visibility check.

Далёкий titled object может быть visible, но не reachable.

Для parser это означает:

- `LOOK` может работать на далёком объекте;
- `EXAMINE`, `TAKE`, `PUT` могут вернуть distance failure;
- объект не должен попадать в selectable clarification options для actionable команд, если он не action-ready;
- при этом объект может использоваться для diagnostics, чтобы сказать "слишком далеко", а не "не вижу".

Для предметов на `Surface` distance считается по actual surface placement coordinates из `Surface.items`, если они есть. Нельзя полагаться только на `entity.x/y`, потому что item position может быть stored в surface placement.

Для polygon-объектов distance нельзя считать до среднего центра вершин. Большие или асимметричные полигоны, особенно `Walkbox`/floor surfaces, могут иметь centroid далеко от текущей позиции игрока, хотя игрок стоит внутри того же walkbox. Runtime должен считать distance до polygon как `0`, если player point внутри polygon, иначе как расстояние до ближайшего ребра polygon.

## ParserWorldModel

`ParserWorldModelBuilder` строит context/scope для parser-а. Public JSON shape сохраняется стабильным.

Основные поля:

- `entities` - видимые semantic objects в scene context.
- `knownEntities` - известные, но скрытые/недоступные diagnostics.
- `inventory` - held items из main actor inventory.
- `spatialNodes` - semantic spatial nodes.
- `spatialRelations` - relation-indexed semantic child groups.
- `scope.visible` - видимые objects.
- `scope.held` - held inventory items.
- `scope.takable` - currently takeable objects.
- `scope.putSource` - currently usable PUT sources.
- `scope.reachable` - objects currently reachable/actionable enough for movement/action contexts.
- `scope.examinable` - currently examinable objects plus held items.
- `scope.subscene` - objects in active subscene.
- `scope.worldKnown` - diagnostic list of known runtime objects.
- `scope.hiddenKnown` - hidden/held known diagnostics.

Важное правило:

> `visible` не равно `takable`.

Parser должен использовать `visible` для knowledge и diagnostics, а `takable`/`putSource`/`reachable` для actual action candidate selection.

## Parser Handling

Parser не должен вручную обходить storage через raw `.spatial`, если есть runtime/query API.

Правильные источники:

- `SceneTextLayerQuery` для semantic relation descendants и access states.
- `InventoryManager` для storage traversal, stored items и storage slots.
- `Game` predicates (`canTakeEntity`, `canPutSourceEntity`, `hasPutStorageForRelation`, `isEntityInPutTarget`) для actionability.

### LOOK

`LOOK <target>`:

- использует visible/held semantic scope;
- может раскрывать `lookable` hidden objects;
- для relation form (`LOOK IN BOX`, `LOOK UNDER CHAIR`) использует anchor-relative relation descendants.

`LOOK IN Cabinet` должен показать nested descendants, которые относительно `Cabinet` находятся `in`, даже если между ними есть внутренние titled relations вроде `Book B on Book A`.

### EXAMINE

`EXAMINE <target>`:

- требует actionability выше, чем `LOOK`;
- учитывает distance;
- может раскрывать `examinable` hidden objects;
- для visible-but-far target должен возвращать distance failure, а не not found.

### TAKE

`TAKE <item>`:

- не предлагает held items как source candidates;
- сначала резолвит currently takable candidates;
- если nothing found, fallback-ит в broader visible scope для diagnostics;
- если visible candidate найден, вызывает runtime `takeEntity`, чтобы получить честную причину failure.

Пример:

```text
Paper visible on wall, but player far away.
TAKE PAPER
-> You are too far away from the Paper.
```

Не должно быть:

```text
-> You don't see any paper here.
```

### TAKE ALL / BOTH

Group TAKE (`TAKE ALL papers`, `TAKE BOTH cassettes`) сначала строит batch только из currently takable candidates.

Если currently takable matches отсутствуют, но unscoped visible plural-aware matches есть, parser строит diagnostic actions по visible matches. Execution core остановится на первой failure, и игрок получит честную причину, например distance.

Пример:

```text
Orange paper and Yellow paper are visible but far.
TAKE ALL PAPERS
-> You are too far away from the Orange paper.
```

Это лучше, чем "You don't see any papers here", потому что parser действительно видит objects.

### TAKE FROM / TAKE IN / TAKE ON

Relation-scoped TAKE использует anchor-relative descendants.

Примеры:

- `TAKE Book B FROM Cabinet` может найти `Book B`, если она nested under `Cabinet` через `Book A`.
- `TAKE Book B FROM Book A` сохраняет direct `on Book A` semantics.
- `TAKE ALL books FROM Cabinet` берёт currently takeable anchor-relative descendants.

Если scoped target есть в semantic projection, но не currently takeable, parser должен возвращать runtime failure, а не ложный not found.

### PUT / DROP

`PUT` и `DROP` требуют реальный writable storage:

- `Inventory`;
- `Surface`.

Raw spatial relation без storage не даёт возможности положить предмет.

`PUT key UNDER CHAIR`:

- ищет storage slot `under Chair`;
- учитывает built-in и external untitled storage;
- не создаёт новый container;
- проверяет blocked/access/distance/group/capacity/fit.

`DROP key` без target:

- ищет auto-drop surface;
- в active subscene предпочитает surfaces внутри subscene;
- затем учитывает floor/walkbox surfaces.

### PUT Source Resolution

`PUT` может брать source:

- из held inventory;
- из nearby scene item, если source доступен и target доступен.

Но parser не должен предлагать source clarification среди inaccessible objects.

Если only visible source match exists but cannot be used, parser should return the real failure reason instead of asking clarification or saying not found.

### PUT Target Resolution

Target validation важнее source clarification.

Parser должен сначала понять, существует ли целевой storage для requested relation. Это предотвращает бессмысленные вопросы вроде "какую бумагу?" при `PUT paper IN cassette`, если cassette вообще не является контейнером.

Для distant target diagnostics действует правило:

- если target имеет compatible storage, но далеко - вернуть distance failure;
- если target не имеет compatible storage вообще - вернуть semantic no-place failure (`You can't put that there.`), даже если target далеко.

Причина: если object не может принять предмет даже рядом, сообщение "слишком далеко" вводит игрока в заблуждение.

### Already-In-Target Filtering

Parser должен фильтровать sources, которые уже находятся в resolved target storage.

Проверка должна учитывать:

- direct built-in storage;
- untitled external storage extensions;
- Inventory storage;
- Surface storage.

Она не должна смотреть только direct components на target object.

## Player-Facing Placement Text

Сообщения `PUT`, `DROP`, `LOOK` должны использовать общий semantic target descriptor.

Если item технически placed `on` безымянную `Surface`, которая вложена `in` titled drawer, player-facing текст должен говорить:

```text
You put the Key into the upper drawer.
```

А не:

```text
You put the Key on the upper drawer.
```

Relation берётся не из final technical relation item-to-surface, а из first semantic relation от titled anchor к storage chain.

## Walkbox / Floor

Walkbox может выступать player-facing pseudo-floor/pseudo-ground target для размещения
предметов и как локальный floor-text source для `LOOK`/`EXAMINE floor`.

Особенности:

- `floor` и `ground` должны резолвиться как walkbox/floor target для `PUT`/`DROP`;
- auto-drop может использовать walkbox surface;
- для explicit `PUT item ON FLOOR` или `PUT item IN FLOOR` user-facing сообщение должно нормализоваться к floor placement;
- walkbox может иметь relation fallback для `on`, чтобы floor command работала естественно.
- distance до walkbox floor при `PUT`/`DROP` считается по polygon containment / nearest-edge distance, а не до центра walkbox; игрок, стоящий в любой части текущего walkbox, не должен получать ложное `too far from the floor`.
- direct `LOOK floor` / `EXAMINE floor` сначала проверяют walkbox pseudo-floor, на котором стоит player. `LOOK` использует его `description`, `EXAMINE` использует его `details`.
- Если текущий walkbox отсутствует или у него нет нужного поля (`description` для `LOOK`, `details` для `EXAMINE`), parser ищет обычный visible/held titled object с Title/Synonym `Floor`.
- Если ни current pseudo-floor, ни real `Floor` object не дают текст, parser возвращает стандартное `parser.look_default_object` для floor.
- Если сцене нужен общий осматриваемый пол, не зависящий от текущего walkbox, его можно моделировать отдельным titled object/entity, например `floor-parallax` с Title `Floor` и `synonyms: ["floor", ...]`.

## Subscene

`Subscene` может выступать spatial root.

При активации subscene runtime включает objects, непосредственно вложенные в subscene через spatial hierarchy.

Старый `targetGroupId` сохраняется для совместимости, но spatial hierarchy является источником истины для структуры contents.

Inactive subscene:

- titled objects могут оставаться visible в semantic parser scope;
- они не становятся actionable;
- parser может знать о них для контекстных команд;
- actual operations должны ждать activation.

Active subscene:

- surfaces внутри subscene получают приоритет для `DROP`;
- placed items добавляются в subscene runtime set;
- scale/placement считаются с учётом subscene item scale.

## SceneSpatialValidator

`SceneSpatialValidator` должен подсвечивать проблемы данных, включая:

- missing spatial parents;
- spatial cycles;
- invalid container relations;
- `near` relation used in storage container configuration (must be rejected per Rule (3));
- missing container relations (выдавать non-blocking warning для отсутствующего `Inventory.relation` или `Surface.relation`, чтобы подсветить implicit runtime defaults, и требовать явного `Surface.relation` для authored built-in surfaces);
- duplicate storage slots for same relation;
- конфликт built-in и untitled external container extensions;
- inventory/surface items referencing missing objects;
- storage item mismatch between component items and raw spatial placement;
- hidden semantics on untitled objects;
- отсутствующий или дублированный main actor inventory relation `in`.

Validator не должен исправлять scene silently. Он должен давать diagnostics.

## Testing Contract

Ключевые тестовые области:

- `tests/parser/world-model-context.test.ts` - semantic projection, visible/takable scopes, blockers, inactive subscene.
- `tests/game/semantic-api.test.ts` - runtime `Game` semantic API, `Inventory`/`Surface`, placement, messages.
- `tests/game/navigation-and-spatial.test.ts` - `describeSpatialRelation`, anchor-relative descriptions.
- `tests/integration/parser-game.test.ts` - thin parser/game integration: `TAKE`, `PUT`, relation commands, diagnostics.
- `tests/scene/scene-spatial-validator.test.ts` - validator contracts.
- `tests/scene/spatial-index.test.ts` - raw spatial indexing.

When changing spatial/container/parser behavior:

- update or add regression tests;
- update `Autotests.md` if coverage contract changes;
- update this document if system laws change.

## Common Examples

### Book On Book In Cabinet

```text
Cabinet (Title)
  in -> Book A (Title)
    on -> Book B (Title)
```

Correct:

- `LOOK IN CABINET` -> shows both books.
- `LOOK ON BOOK A` -> shows `Book B`.
- `TAKE Book B FROM Cabinet` -> can resolve `Book B`.
- `TAKE Book B FROM Book A` -> can resolve `Book B`.

### Untitled Surface Inside Drawer

```text
upper drawer (Title)
  in -> d1_surface (Surface, no Title)
    on -> Yellow paper
```

Correct:

- Player-facing text: `Yellow paper` is in the upper drawer.
- `DROP paper` in active drawer subscene -> `You put the Paper into the upper drawer.`

### Under-Chair Technical Surface

```text
Chair (Title)
  under -> under_chair_slot (no Title)
    on -> chair_under_surface (Surface, no Title)
```

Correct:

- `PUT key UNDER CHAIR` can use `chair_under_surface`.
- Text says the key is under the chair.
- The inner surface relation does not make the key "on Chair".

### Raw Spatial Without Storage

```text
Chair (Title)
  under -> Key (Title, Item)
```

Correct:

- `LOOK UNDER CHAIR` can show key.
- `TAKE KEY` can take key if reachable.
- `PUT KEY UNDER CHAIR` fails if no `under` storage slot exists.

### Distant Non-Container PUT Target

```text
Cassette 'Music' is visible but far.
Cassette has no Inventory or Surface.
```

Correct:

```text
PUT paper IN music
-> You can't put that there.
```

Not:

```text
-> You are too far away from the Cassette 'Music'.
```

Distance matters only if the target could accept the action.

### Visible But Distant TAKE ALL

```text
Orange paper and Yellow paper are visible on the wall.
Player is too far away.
```

Correct:

```text
TAKE ALL PAPERS
-> You are too far away from the Orange paper.
```

Not:

```text
-> You don't see any papers here.
```

## Do / Don't

Do:

- Use `SceneTextLayer` / `SceneTextLayerQuery` for parser-facing spatial semantics.
- Use `InventoryManager` for storage traversal and stored item queries.
- Use `Game` predicates for actionability.
- Treat `visible` as knowledge and `takable`/`putSource` as actionable subsets.
- Preserve anchor-relative semantics.
- Stop untitled storage traversal at titled children.
- Keep read-only queries non-mutating.

Don't:

- Do not let parser manually derive storage truth from raw `.spatial`.
- Do not auto-create `Inventory` or `Surface` during parser/runtime command checks.
- Do not treat technical untitled nodes as player-facing objects.
- Do not use final item-to-surface relation as player-facing relation when a titled anchor owns the storage chain.
- Do not include unreachable/inaccessible objects as clarification options for actionable commands.
- Do not say "not found" when a visible object exists but is blocked or too far; return the real runtime diagnostic.

## Glossary

- **Anchor** - titled object relative to which a spatial query is evaluated.
- **Raw spatial hierarchy** - direct object tree using `.spatial.parentNodeId` and `.spatial.relation`.
- **Semantic projection** - player-facing text model produced by `SceneTextLayer`.
- **Technical node** - untitled object used for geometry/storage/implementation.
- **Storage slot** - `Inventory` or `Surface` with a relation.
- **Built-in storage** - storage component directly on a titled object.
- **External storage** - storage component on untitled descendants of a titled object.
- **Main inventory** - actor's direct `Inventory` with relation `in`.
- **Visible** - known in semantic text model.
- **Actionable** - currently usable for an operation after distance/blocker/subscene checks.
- **Anchor-relative descendant** - object considered under a relation relative to a chosen anchor, even if deeper raw relations differ.
