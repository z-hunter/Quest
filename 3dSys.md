# Box3D и общая 3D-система Scanline Engine

> Статус: описание фактической реализации на 2026-08-30.
> Главные подсистемы: `src/entities/Box3DObject.ts`, `src/graphics/SceneRenderer.ts`, `src/tools/editor/EditorSelectionManager.ts`.
> Этот документ объясняет архитектуру, математику, render pipeline и editor lifecycle. Пользовательские правила остаются в `GDD.md`.

## 1. Краткая модель

Scanline Engine остаётся 2.5D Canvas2D-движком. В нём нет общей mesh-сцены, GPU depth buffer или свободно вращающейся 3D-камеры. Вместо этого все `Box3D` одной `Scene` используют единое физическое пространство XYZ и одну проекцию камеры, а результат проекции передаётся существующим `QuadObject`.

`Box3DObject` — transform-контейнер, наследующийся напрямую от `SceneObject`. Он не рисует собственную картинку. Его видимая оболочка состоит из шести настоящих дочерних Quad:

```text
Scene
└── Box3DObject                  физическая форма и Transform 3D
    ├── Quad face 0             визуал, Grid, texture, components
    ├── Quad face 1
    ├── Quad face 2
    ├── Quad face 3
    ├── Quad face 4
    └── Quad face 5
```

Родитель отвечает за восемь общих физических вершин, масштаб, повороты, положение и проекцию. Quad отвечают за внешний вид и обычные свойства поверхности. Благодаря общим вершинам соседние грани не расходятся при трансформации.

## 2. Системы координат

В коде одновременно существуют четыре пространства. Их нельзя смешивать.

| Пространство       | Что хранит                                            | Где используется                              |
| ------------------ | ----------------------------------------------------- | --------------------------------------------- |
| Box-local XYZ      | Frustum до поворота и перемещения                     | `Box3DObject.getWorldVertices()`              |
| World XYZ          | Физическая сцена после Scale/Rotation/Position        | BSP, raycast, physical depth, surface anchors |
| Projected world XY | Результат pinhole-проекции, записанный в managed Quad | `quad.vertices`, Grid, texture, Quad render   |
| Canvas XY          | Projected world с Camera XY, Zoom и viewport center   | конечный экран, mouse input                   |

Соглашения:

- `+X` направлен вправо;
- `+Y` направлен вниз, как в остальной 2D-сцене;
- `+Z` направлен от камеры в глубину;
- виртуальная камера смотрит вдоль `+Z`;
- у камеры нет сериализуемых `Z`, yaw, pitch или roll;
- `Camera.x/y` задают положение камеры в общей мировой плоскости XY;
- положительный World Z удаляет точку и уменьшает её projected scale, отрицательный приближает.

## 3. Данные Box3D

Основной класс: `src/entities/Box3DObject.ts`.

Сериализуемые поля родителя:

| Группа      | Поля                                               |
| ----------- | -------------------------------------------------- |
| Position    | `x`, `y`, `z`                                      |
| Rotation    | `rotationX`, `rotationY`, `rotationZ`              |
| Axis pivots | `pivotX`, `pivotY`, `pivotZ`, каждый `{x,y,z}`     |
| Scale       | `uniformScale`, `scaleX`, `scaleY`, `scaleZ`       |
| Lower base  | `bottomWidth`, `bottomDepth`                       |
| Upper base  | `topWidth`, `topDepth`, `topOffsetX`, `topOffsetZ` |
| Height      | `height`                                           |
| Cutter      | `cutter`                                           |
| Gizmo       | `axisMode`, `axisRotationX/Y/Z`                    |
| Occlusion   | `occlusionMode`: `inherit` или `fast`              |

Defaults находятся в `src/entities/Box3D.template.json`: размер `100 × 100 × 100`, Scale `1`, pivots в `(0,0,0)`, Rotation `20/30/0`.

Перспектива и базовый режим occlusion не являются свойствами Box. Они хранятся один раз в `Scene.box3dPerspective` и `Scene.box3dOcclusionMode` (`exact` по умолчанию), сериализуются со сценой и применяются ко всем Box. Box может локально выбрать только `fast`; `inherit` использует режим сцены.

### 3.1 Восемь вершин

До Scale и Rotation локальные вершины имеют следующий порядок:

```text
0 = (-topWidth/2 + topOffsetX, -height/2, -topDepth/2 + topOffsetZ)
1 = ( topWidth/2 + topOffsetX, -height/2, -topDepth/2 + topOffsetZ)
2 = ( topWidth/2 + topOffsetX, -height/2,  topDepth/2 + topOffsetZ)
3 = (-topWidth/2 + topOffsetX, -height/2,  topDepth/2 + topOffsetZ)

4 = (-bottomWidth/2,  height/2, -bottomDepth/2)
5 = ( bottomWidth/2,  height/2, -bottomDepth/2)
6 = ( bottomWidth/2,  height/2,  bottomDepth/2)
7 = (-bottomWidth/2,  height/2,  bottomDepth/2)
```

Нумерация граней задаётся единственным массивом `BOX3D_FACE_VERTICES`:

| `box3dFaceIndex` | Индексы физических вершин |
| ---------------: | ------------------------- |
|                0 | `0, 1, 2, 3`              |
|                1 | `4, 7, 6, 5`              |
|                2 | `0, 4, 5, 1`              |
|                3 | `1, 5, 6, 2`              |
|                4 | `2, 6, 7, 3`              |
|                5 | `3, 7, 4, 0`              |

В serialized data нет строковых ролей поверхности. Контрактом является только индекс `0..5` и этот массив.

### 3.2 Frustum, призмы и пирамиды

Верхнее и нижнее основания независимы. Изменение их Width/Depth и верхнего Offset позволяет получать усечённые формы, клинья, призмы и пирамиды.

Нулевые размеры разрешены. При входе в BSP и raycast совпавшие соседние вершины удаляются:

- collapsed Quad с тремя неколлинеарными точками становится физическим треугольником;
- полигон с менее чем тремя точками или нулевой площадью исключается;
- исходный managed Quad остаётся объектом сцены и сохраняет настройки, даже когда его текущая физическая площадь равна нулю.

Нормализация обязательна: нулевая грань не должна создавать BSP-plane с нулевой normal.

## 4. Transform 3D

Порядок преобразований фиксирован:

1. построить восемь local vertices;
2. применить `uniformScale × scaleX/Y/Z` к координатам;
3. повернуть вокруг локальной оси Z и `pivotZ`;
4. повернуть вокруг локальной оси Y и `pivotY`;
5. повернуть вокруг локальной оси X и `pivotX`;
6. прибавить world position `x/y/z`.

Формально, где `Raxis(angle, value)` — поворот `value` вокруг начала соответствующей оси:

```text
q0 = Scale(local)
q1 = pivotZ + Rz(rotationZ, q0 - pivotZ)
q2 = pivotY + Ry(rotationY, q1 - pivotY)
q3 = pivotX + Rx(rotationX, q2 - pivotX)
world = position + q3
```

Порядок вызовов фиксирован: `Z → Y → X`. Каждый pivot задан в координатах входа своего этапа: `pivotZ` — после Scale, `pivotY` — в системе после Z, `pivotX` — в системе после Z и Y. Pivot не переносится предыдущими этапами автоматически и не умножается на Scale. Это stage-space semantics; менять её без миграции существующих Box3D нельзя.

У каждой оси отдельный pivot. `getWorldVertices()` и `syncFaces()` применяют все три этапа. Editor overlay через `getWorldAxisSegments()` начинает преобразование каждой линии с её собственного этапа: Z получает Z/Y/X, Y получает Y/X, X получает X. Поэтому линия проходит через тот же pivot и вдоль той же оси, которые фактически использует соответствующий вызов `rotate()`.

## 5. Общая 3D-камера и перспектива

### 5.1 Focal и параметр сцены

World-space focal вычисляется из базового разрешения:

```text
F = GAME_DESIGN_WIDTH / Camera.zoom
S = Scene.box3dPerspective
```

`S` имеет смысл:

- `0` — ортографическая проекция;
- `1` — стандартная перспектива;
- `>1` — более сильное перспективное схождение.

При `S > 0` виртуальная точка камеры в XYZ:

```text
camera3D = (Camera.x, Camera.y, -F / S)
```

F зависит от Zoom, чтобы Zoom работал как приближение/отдаление камеры при постоянном rectilinear FOV, а не превращался в сверхширокоугольную линзу.

### 5.2 Проекция точки

Для world point `(X,Y,Z)`:

```text
P  = F / (F + S × Z)
X' = Camera.x + (X - Camera.x) × P
Y' = Camera.y + (Y - Camera.y) × P
```

`projectBox3DPoint()` возвращает `{x: X', y: Y', p: P}`. Полученный `P` — физический depth factor и одновременно мост к существующим Surface/Parallax API.

Финальный Canvas transform:

```text
canvasX = viewportCenterX + (X' - Camera.x) × Camera.zoom
canvasY = viewportCenterY + (Y' - Camera.y) × Camera.zoom
```

Все Box используют одни и те же `Camera.x/y`, `F` и `Scene.box3dPerspective`. Поэтому одинаковые мировые точки разных Box всегда совпадают на экране.

Перед проекцией physical face обрезается по near plane на расстоянии `1% × F` перед `camera3D`. Грань, пересекающая plane, превращается во временный render fragment; исходный managed Quad и его authored-настройки не изменяются. Полностью оказавшаяся позади камеры грань исключается, но остальные грани Box продолжают участвовать в BSP, поэтому при входе камеры внутрь объёма видны внутренние стороны его оболочки. В ортографическом режиме near-plane clipping не применяется.

### 5.3 Почему движение камеры показывает глубину

При изменении Camera XY множитель `P` у каждой вершины остаётся функцией её World Z, но выражение `(world - camera) × P` меняется. Ближние и дальние вершины получают разные экранные смещения. Поэтому камера, уходящая ниже объекта, постепенно открывает нижние поверхности, а горизонтальное движение открывает боковые.

Это не обычный Quad-parallax и не независимая перспектива каждого Box. Проекция stateless: одинаковые Scene, Camera и Box всегда дают одинаковый кадр независимо от истории движения.

### 5.4 Near plane

Вершина допустима, пока:

```text
F + S × Z > EPSILON
```

Physical polygon каждой грани обрезается по этой plane. Пересекающая её грань становится временным fragment; полностью находящаяся позади камера грань исключается. Исходные managed Quad не меняются. В ортографическом режиме clipping не нужен.

## 6. Managed Quad: мост между 3D и 2D renderer

`Box3DObject.syncFaces(scene)` пересчитывает все managed-face. Для каждой грани он:

1. получает четыре physical world vertices по `BOX3D_FACE_VERTICES`;
2. сохраняет их в transient `quad.box3dWorldVertices`;
3. проецирует вершины и записывает их в `quad.vertices` в отдельном UV-порядке;
4. ставит `box3dCameraProjected = true`;
5. вычисляет `box3dDepth` как средний физический Z;
6. наследует Layer родителя;
7. принудительно задаёт derived `parallax = 1`, `perspective = true`, `perspectiveAmount = 1`;
8. обновляет transient `box3dHidden`.

`BOX3D_FACE_UV_VERTICES` намеренно отделён от outward winding. Геометрический порядок нужен плоскостям, BSP и raycast; UV-порядок нужен для одинаково ориентированной texture/grid на внешней стороне. Их нельзя объединять в один массив без повторного появления поворота или зеркалирования текстур.

### 6.1 Запрет двойного параллакса

Обычный Quad сначала меняет вершины в `getVisualVertices()`, затем получает общий camera transform renderer-а. Managed-face уже спроецирована общей 3D-камерой. Поэтому `QuadObject.getVisualVertices()` при `box3dCameraProjected` возвращает только XY без vertex-parallax.

Инвариант:

```text
physical XYZ → projectBox3DPoint() → managed Quad XY → Canvas camera transform
```

Нельзя повторно применять к managed-face `vertex.p`, Quad perspective correction или обычную формулу camera-parallax. Это вызывает двойное растяжение и разрушает жёсткую форму Box.

### 6.2 Когда выполняется sync

Синхронизация вызывается:

- перед component update в `Scene.update()`;
- после обновления Camera в `Scene.update()`;
- непосредственно перед render в `SceneRenderer.render()`.

Первый вызов даёт компонентам актуальные physical surfaces. Второй учитывает движение камеры в том же frame. Render-time sync обеспечивает WYSIWYG в редакторе и немедленную реакцию на `3D Perspective`, даже если gameplay update не выполнялся.

## 7. Render, depth и occlusion

### 7.1 Layer

`Layer` остаётся абсолютным ручным приоритетом. Box-face наследуют Layer родителя. BSP никогда не меняет порядок между разными Layer.

В каждом Layer renderer разделяет:

- обычные Entity/Quad, которые идут по стандартному 2D pipeline;
- managed Box faces и прикреплённые Entity, которые входят в отдельный 3D batch.

### 7.2 Полная двухсторонняя оболочка

Система не удаляет задние грани простым backface culling. В batch передаётся полная оболочка, потому что Disabled surface, выключенный Fill или alpha texture должны открывать внутреннюю сторону других граней и находящиеся за ней объекты.

Непрозрачная ближняя поверхность закрывает дальнюю благодаря depth order. Прозрачная поверхность рисуется back-to-front обычным Canvas alpha blend.

### 7.3 Broad phase и BSP

`buildBox3DRenderFragments()`:

1. нормализует полигоны и исключает нулевую площадь;
2. обрезает их по near plane;
3. проецирует screen bounds;
4. делит faces на независимые группы по пересечению 2D AABB;
5. строит CPU BSP внутри каждой группы;
6. рассекает пересекающиеся физические полигоны BSP-плоскостями;
7. обходит дерево относительно общей `camera3D` far-to-near;
8. возвращает projected fragments со ссылкой на исходный Quad или Entity.

Coplanar order детерминирован: scene order, затем Box ID, затем face index.

`exact` строит этот BSP для каждой пересекающейся экранной группы. В `fast` BSP пропускается, а целые faces стабильно сортируются по среднему physical Z. Локальный `Box.occlusionMode = fast` переводит в быстрый путь только свою пересекающуюся группу; это осознанно менее точный, но дешёвый режим.

Лимит `MAX_BSP_FRAGMENTS = 1200` защищает editor от взрывного дробления. После превышения один раз выводится warning, а batch переходит на стабильную сортировку целых faces по average physical Z. Такие fragments получают `depthFallback`; point hit-test использует тот же обратный render order, поэтому выбранная face совпадает с видимой в fallback. Это согласованный graceful fallback, но не точная замена depth buffer для сложных пересечений.

### 7.4 Отрисовка фрагментов

Если face не была рассечена и не является attached Entity, вызывается обычный `Quad.render()` без промежуточного clip. Поэтому texture, Grid, checkerboard, effects и opacity используют общий Quad renderer.

Рассечённые fragments получают Canvas clip по projected polygon, после чего внутри clip рисуется исходный Quad. Для непрозрачного `source-over` используется небольшой coverage overlap, чтобы дальняя оболочка не просвечивала через субпиксельные швы. Texture mesh отдельно расширяет triangle coverage без изменения UV.

### 7.5 Retained bitmap layers и движущиеся surface Entity

`SceneRenderer` кэширует непрозрачные `source-over` Box3D по authored Layer. После точного BSP статические fragments собираются в bitmap-команды, а attached Entity остаются живыми командами между ними. Поэтому несколько Entity могут находиться между разными статическими слоями без принудительного полного live-render.

Инвалидация учитывает Camera, проекцию, геометрию и визуальные свойства статических граней. Для одного Layer удерживается до четырёх ранее встреченных корректных topology-вариантов: при возврате Actor в прежнее отношение «перед/за» к граням bitmap повторно используется, а не рисуется заново.

Если BSP разрезает attached Entity, её clip-fragments также сохраняются. Геометрия входит в ключ только у Entity, которые действительно разрезаны; движение неразрезанного Actor не инвалидирует статические bitmap другого attached Entity.

Когда движущийся Actor сам непрерывно разрезается BSP, topology-вариантов было бы бесконечно много. В этом случае включается `static face bitmaps → live BSP entities`: каждая неподвижная managed face один раз растрируется в отдельный bitmap, затем на каждом кадре готовый bitmap клипуется текущим BSP-fragment. Живыми остаются только fragments Entity. Так сохраняется точная окклюзия, но неподвижные, в том числе нетекстурированные, грани не перерисовываются и не мерцают.

### 7.6 Per-frame texture mesh reuse

Projective texture mesh принадлежит полной managed-face, а не BSP-fragment. Если одна face в текущем кадре встречается в нескольких fragments, `QuadObject` строит её mesh, UV-разбиение и диагонали только один раз. Каждый fragment по-прежнему устанавливает собственный Canvas clip и рисует ту же mesh, поэтому painter order, BSP-окклюзия и texture coverage не меняются.

Кэш действует лишь в пределах одного вызова `SceneRenderer.render()`. Его ключ включает визуальные вершины face, scale контекста, texture mode, tile scale, perspective и compactness. Новый кадр всегда строит mesh заново: динамическое вращение Box3D и движение Camera не могут использовать устаревшие точки.

### 7.7 Renderer profiling

Debug API позволяет включить накопительный профиль Box3D: `api.renderer.setBox3DProfilingEnabled(true)`, `resetBox3DProfile()` и `getBox3DProfile()`. Профиль охватывает построение BSP-fragments, их Canvas2D render, texture mesh, отдельные texture triangles и Grid. Поля `textureMeshBuildCalls` и `textureMeshCacheHits` показывают соответственно число реальных построений полной mesh и число повторных использований для BSP-fragments.

## 8. Hit-test и mouse ray

Point selection и runtime interaction используют общий `raycastBox3DFace()`.

Screen point сначала переводится из Canvas в projected world XY. Затем строится луч:

```text
Perspective: origin = camera3D
             direction = (projectedX - camX, projectedY - camY, F / S)

Orthographic: origin = (projectedX, projectedY, minBatchZ - margin)
              direction = (0, 0, 1)
```

В orthographic-режиме origin выводится из минимальной физической Z проверяемых полигонов; margin не меньше одной world-unit и не меньше их Z-span. Поэтому допустимая геометрия не ограничена скрытой константой Z. Луч пересекается с физическими polygon planes. Для каждого Layer выбирается ближайшее положительное пересечение, затем побеждает самый высокий Layer. При BSP fallback применяется описанный выше render order. Поэтому скрытая задняя поверхность не перехватывает обычный click.

`SceneInteraction` и `EditorTransformManager` используют один resolver. Marquee selection намеренно остаётся 2D и может включать скрытые managed-face.

`intersectBox3DFaceAtScreen()` возвращает physical XYZ пересечения. Editor использует его для перемещения всего Box вдоль плоскости выбранной грани.

## 9. Surface, Grid и 3d-parallax

Managed-face остаётся Quad-поверхностью. У неё работают texture, Retro Grid, Surface, WalkBox, components и spatial children.

Для объекта с `3d-parallax`:

1. обычные Quad metrics определяют `(u,v)` на видимой поверхности;
2. `sampleBox3DFaceAtGrid()` строит camera ray через projected grid point;
3. луч пересекает physical plane грани;
4. physical point смещается на `SURFACE_OFFSET = 0.01` на выбранную сторону;
5. точка снова проецируется и даёт Entity position и физический `P`;
6. `createBox3DSurfaceAnchor()` создаёт transient billboard polygon для общего BSP batch.

`spatial.surfaceSide` сериализуется как `front` или `back`. Если поверхность развернулась обратной стороной к камере, непрозрачная грань закрывает Entity, находящуюся на другой стороне. Alpha/открытая грань позволяет её увидеть.

Attached Entity участвует в том же physical depth order, что и Box faces других Box. Это не отдельный 2D overlay.

Disabled Box или managed-face временно делает её spatial descendants Disabled. Исходное authored-состояние хранится transient marker-ом и восстанавливается после включения; `SceneObject.toJSON()` сериализует authored, а не временно унаследованное значение.

## 10. Editor

### 10.1 Создание и свойства

`3D Box` доступен в `HierarchyPanel`. Создание идёт через общий `SceneEditor.createObjectFromData()` и `DefaultBox3DData`, затем одной операцией создаются родитель и шесть Quad с именами `<BoxName>_face_0..5`.

`Box3DProperties.tsx` показывает Position, Rotation, Scale, frustum dimensions, offsets и три pivots. Кнопка `Axes` переключает сериализуемый gizmo между `object` и `camera`; в object-режиме `Axis rotate X/Y/Z` наклоняет только оси вокруг их Pivot, не меняя frustum. `SceneProperties.tsx` содержит общие настройки `3D Perspective` и `3D Occlusion`: `exact` использует BSP, `fast` сортирует целые грани по средней Z-глубине. У каждого Box есть override `Inherit scene/Fast`; Fast затрагивает только его пересекающуюся экранную группу.

Folder с Box3D на любой глубине получает редакторский режим `Compound Box3D`. `Folder.compoundBox3D` хранит общий центр, накопленные rotation/scale/frustum modifiers, offsets и три world-space pivot; отсутствие поля означает старую сцену и ленивую инициализацию по центру общего AABB. Изменения запекаются в дочерние Box3D, поэтому runtime render/collision pipeline не получает отдельной иерархической матрицы. Новые члены группы не получают прошлые transforms, но участвуют во всех следующих изменениях.

Каждый Compound Box3D хранит независимый режим gizmo. `camera` рисует X горизонтально, Y вертикально и Z точкой/кольцом в направлении камеры; `object` использует мировые направления группы. В object-режиме `axisRotationX/Y/Z` дополнительно наклоняет только gizmo вокруг его Pivot и не влияет на запекаемый group Rotation.

Групповой Rotation композиционно применяет world-axis rotation к текущей ориентации каждого Box3D и раскладывает результат обратно в существующий порядок `Z → Y → X`, компенсируя его собственные pivots через Position. Uniform/axis Scale применяет отношение нового и предыдущего множителя одновременно к параметру формы и смещению Position относительно общего центра. Width/Depth/Height используют только отношение множителей, а Top Offset — разность значений. Минимальный множитель `0.01` сохраняет обратимость запекаемых изменений.

Флаг `Cutter` сериализуется на родителе. Активный Cutter остаётся доступен в hierarchy и через selection overlay, но его оболочка не рисуется как отдельный solid. Вместо этого она динамически вычитается из всех обычных Box3D того же Layer.

Родитель — transform-контейнер: он не имеет собственной картинки, components или runtime hit target. У managed Quad Transform, vertices/P, Layer и Perspective являются derived. Остальные обычные Quad controls остаются доступны.

Ownership определяется одновременно:

```text
quad.box3dFaceIndex = 0..5
quad.spatial.parentNodeId = box.name
```

Менять эти поля вручную нельзя: это разрывает managed contract.

### 10.2 Direct manipulation

- `Ctrl + click` по видимой managed-face выбирает родительский Box;
- left drag — Move X/Y;
- `Ctrl + left drag` — Scale X/Y;
- `Alt + left drag` — Top Width/Depth;
- `Shift + left drag` — Bottom Width/Depth;
- `Ctrl + wheel` — Top Offset X;
- `Shift + wheel` — Top Offset Z;
- middle drag — Rotate Y/X;
- `Ctrl + middle drag` — Rotate Z и Move Z;
- drag при выбранной face — перемещение всего Box в её physical plane.

При выборе родителя editor показывает все восемь physical vertices двумя цветами и XYZ axes. `Axes: Object` использует наклон Box и настраиваемые `Axis rotate X/Y/Z`; `Axes: Camera` держит X горизонтальной, Y вертикальной, Z перпендикулярной экрану. Ось рисуется с учётом shell intersection: camera-side segment виден до точки входа, внутренняя и заслонённая часть скрыта.

### 10.3 Compound Box3D

Folder с хотя бы одним `Box3D` на любой глубине становится Compound Box3D; остальные descendants игнорируются. Folder хранит сериализуемое `compoundBox3D`: общий центр, накопленные значения контролов, три pivot, режим/наклон gizmo. Начальный центр и pivots — центр world AABB всех вершин входящих Box.

Изменения запекаются в дочерние Box. Move сдвигает все Box, центр и pivots; Rotation поворачивает всю группу вокруг выбранного общего pivot; Scale изменяет размеры и расстояния относительно общего центра; Width/Depth/Height меняют только соответствующий размер каждого Box; Top Offset X/Z аддитивны. Новые Box участвуют лишь в последующих изменениях. Все жесты из 10.2 применяются к выбранной Compound Folder; Lock самой Folder блокирует mouse-transform, но Locked/Disabled дочерние Box не исключаются.

Overlay подсвечивает faces всех членов, но рисует один общий набор осей. У Compound доступны те же независимые режимы `Axes: Object` и `Axes: Camera`; наклон настраивается только для object axes и не меняет геометрию группы.

Point click уважает 3D occlusion; marquee включает скрытые вершины/faces по design.

## 11. Serialization, copy и lifecycle

Box и шесть faces сериализуются как отдельные scene objects. Parent хранит transform/frustum, Cutter, состояние gizmo и occlusion override. Внешний вид каждой поверхности живёт в JSON соответствующего Quad. Folder опционально хранит `compoundBox3D`; старые Folder без этого поля остаются совместимыми.

При загрузке `SceneManager`:

- создаёт `Box3DObject` через `fromJSON()`;
- загружает имеющиеся Quad;
- восстанавливает отсутствующий индекс `0..5` default-face и пишет load warning;
- вызывает `syncFaces()`.

Copy/Duplicate/Prefab используют selection payload v3:

- сериализуют полное hierarchy subtree;
- включают шесть managed-face и их spatial descendants;
- не позволяют отдельно копировать managed-face;
- заранее remap-ят object names, folder IDs, bindings и component references;
- при наличии serialized faces создают Box с `skipBoxFaces`, затем восстанавливают точные Quad;
- выбирают только copied roots;
- выполняются одним undo step.

Отдельное удаление managed-face запрещено. Удаление родителя удаляет шесть faces, а их обычных spatial children переводит в root сцены.

## 12. Инварианты для будущих изменений

1. Все Box одной Scene используют только `Scene.box3dPerspective` и одну Camera.
2. Physical XYZ всегда остаётся источником истины; `quad.vertices` — derived projection.
3. Managed Quad не проходит повторный vertex-parallax.
4. Outward face order и UV order остаются раздельными.
5. Layer важнее physical depth.
6. Point hit-test использует тот же camera ray, что и render geometry.
7. Degenerate faces нормализуются до создания Plane.
8. Disabled/alpha openings требуют полной оболочки; безусловный backface culling нарушит этот контракт.
9. Attached Entity должна входить в общий BSP, иначе она не будет корректно заслоняться.
10. Изменение Camera или `3D Perspective` должно отражаться в том же render frame.
11. Cutter изменяет только transient render/raycast fragments; authored Box и managed Quad не переписываются.
12. Retained bitmap cache обязан воспроизводить точный порядок BSP-команд; attached surface Entity остаются live между bitmap-командами.
13. `fast` — только rendering trade-off, а не точная замена BSP для сложных пересечений.

### 12.1 Live Cutter

`getVisibleBox3DFaces()` применяет Boolean Difference до общего BSP:

1. target face последовательно рассекается шестью outward-плоскостями Cutter;
2. части внутри Cutter удаляются, внешние сохраняют ссылку на исходный target Quad;
3. face Cutter обрезается шестью плоскостями target;
4. оставшийся polygon разворачивается и становится внутренней стенкой отверстия со стилем исходного Cutter Quad;
5. полученные fragments проходят обычные near-plane clipping, BSP, projection и raycast.

Cutter без пересечения ничего не меняет. Если он проходит цель насквозь, получается сквозное отверстие; при частичном входе — ниша. Disabled/hidden Cutter не участвует в вычитании. Layer является абсолютной границей операции.

## 13. Ограничения текущей реализации

- Это CPU Canvas2D renderer, не GPU depth buffer.
- Камера не имеет собственного Z и rotation; направление взгляда фиксировано вдоль `+Z`.
- Near plane реализован как polygon clipping, но Camera Z/rotation пока отсутствуют.
- BSP ограничен 1200 fragments и оптимизирован примерно для editor-sized сцен.
- Пересекающиеся друг с другом Cutter могут создавать избыточные coplanar fragments; отдельная оптимизация их union пока не выполняется.
- Полупрозрачность использует painter's algorithm; циклические alpha-overlap могут иметь обычные ограничения такого подхода.
- Physical collision volume Box как отдельный solid collider не реализован. Gameplay collision идёт через возможности его Quad, например WalkBox.
- Родитель Box не является Entity и не предназначен для components/interactions.

Если сцены станут плотными, потребуется GPU renderer с depth buffer. До появления измеримой необходимости CPU BSP остаётся намеренно ограниченным решением.

## 14. Карта кода

| Файл                                                    | Ответственность                                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/entities/Box3DObject.ts`                           | Geometry, projection, managed-face sync, surface anchors, BSP, raycast            |
| `src/entities/Box3D.template.json`                      | Default serialized Box data и шесть face indices                                  |
| `src/entities/EntityPrefabs.ts`                         | Импорт template как `DefaultBox3DData`                                            |
| `src/entities/QuadObject.ts`                            | Managed metadata, no-double-parallax path, texture/Grid rendering и seam coverage |
| `src/scene/Scene.ts`                                    | `box3dPerspective`, sync до/после Camera, serialization                           |
| `src/scene/SceneManager.ts`                             | Loading Box, восстановление отсутствующих faces                                   |
| `src/graphics/SceneRenderer.ts`                         | Layer split, exact/fast occlusion, BSP, retained bitmap cache и diagnostics       |
| `src/scene/SceneInteraction.ts`                         | Runtime point picking через общий raycast                                         |
| `src/systems/ThreeDParallaxSystem.ts`                   | Physical surface anchors и attached Entity                                        |
| `src/tools/SceneEditor.ts`                              | Unified creation/deletion, selection overlay и оси                                |
| `src/tools/editor/EditorTransformManager.ts`            | Click resolver и direct-manipulation gestures                                     |
| `src/tools/editor/EditorSelectionManager.ts`            | Compound membership/transforms/gizmo, copy/duplicate/prefab и reference remap     |
| `src/entities/Folder.ts`                                | Folder serialization и `CompoundBox3DState`                                       |
| `src/components/editor/properties/Box3DProperties.tsx`  | Transform 3D / Frustum / gizmo / occlusion UI                                     |
| `src/components/editor/properties/FolderProperties.tsx` | Compound Box3D UI                                                                 |
| `src/components/editor/properties/SceneProperties.tsx`  | Scene `3D Perspective` и occlusion UI                                             |
| `src/components/editor/properties/QuadProperties.tsx`   | Блокировка derived controls managed-face                                          |
| `src/components/editor/HierarchyPanel.tsx`              | Создание и hierarchy labels `Face 0..5`                                           |

## 15. Тесты

| Файл                                              | Основное покрытие                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `tests/entities/box3d-object.test.ts`             | Geometry, projection, camera invariants, BSP, raycast, openings, UV order, degenerate prism, surface side |
| `tests/entities/quad-object.test.ts`              | Managed visual path и texture coverage                                                                    |
| `tests/systems/three-d-parallax-system.test.ts`   | Surface binding, physical anchor, Disabled inheritance, side/depth behavior                               |
| `tests/editor/editor-selection-hierarchy.test.ts` | Полное copy/duplicate subtree и exact managed faces                                                       |
| `tests/editor/editor-snapping-system.test.ts`     | Point selection, marquee policy, Ctrl-select parent и direct drag                                         |
| `tests/graphics/scene-renderer.test.ts`           | Exact/fast ordering, retained bitmap cache и live surface Entity                                          |
| `tests/editor/folder-properties.test.ts`          | Compound Folder panel, membership, pivots и gizmo modes                                                   |

Минимальная проверка после изменения 3D-системы:

```powershell
npm test -- --run tests/entities/box3d-object.test.ts tests/entities/quad-object.test.ts tests/graphics/scene-renderer.test.ts tests/systems/three-d-parallax-system.test.ts tests/editor/editor-selection-hierarchy.test.ts tests/editor/editor-snapping-system.test.ts tests/editor/folder-properties.test.ts
npm run typecheck
npm run build
```

Для render/camera/editor изменений дополнительно обязательна визуальная проверка Playwright на Box, prism (`Top Width = 0`), alpha/open face и двух пересекающихся Box.
