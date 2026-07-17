# NPC Puppet Master — Hybrid SLM Subsystem

> **Расположение**: `src/mechanics/slm/`  
> **Статус**: runtime и полный offline pipeline реализованы. Модель требует обучения на собранном production dataset перед активацией.

Offline pipeline: `npm run slm:pipeline`. Реализация и зависимости находятся в `scripts/slm/`; runtime принимает ONNX только вместе с совместимым manifest.

---

## Содержание

1. [Цель системы](#цель-системы)
2. [Архитектура: обзор](#архитектура-обзор)
3. [Модули](#модули)
   - [ShadowLogger — сбор датасета](#shadowlogger--сбор-датасета)
   - [SlmVocabulary — токенизатор](#slmvocabulary--токенизатор)
   - [SlmInputAdapter — кодирование контекста](#slminputadapter--кодирование-контекста)
   - [SlmOutputAdapter — декодирование плана](#slmoutputadapter--декодирование-плана)
   - [SlmInferenceEngine — движок инференса](#slminferenceengine--движок-инференса)
4. [Гибридный роутер в NpcPuppetMaster](#гибридный-роутер-в-npcpuppetmaster)
5. [Жизненный цикл плана](#жизненный-цикл-плана)
6. [Обучение SLM: пайплайн](#обучение-slm-пайплайн)
7. [Руководство разработчика](#руководство-разработчика)
   - [Запуск в режиме сбора данных](#запуск-в-режиме-сбора-данных-shadow-mode)
   - [Подключение обученной модели](#подключение-обученной-модели)
   - [Управление моделью во время выполнения](#управление-моделью-во-время-выполнения)
   - [Добавление новых типов шагов](#добавление-новых-типов-шагов)
   - [Отладка и диагностика](#отладка-и-диагностика)
8. [Сценарии использования](#сценарии-использования)
9. [Эскалация: когда SLM уступает LLM](#эскалация-когда-slm-уступает-llm)
10. [Тесты](#тесты)
11. [Известные ограничения и риски](#известные-ограничения-и-риски)

---

## Цель системы

**Puppet Master SLM** — локальная нейросеть, встроенная в игровой движок Scanline Engine, которая берёт на себя рутинное планирование NPC без обращения к LLM API.

### Проблема

`NpcPuppetMaster` вызывает внешний LLM каждый раз, когда NPC нужно:
- определить следующий шаг при пробуждении;
- обработать завершённое действие;
- реагировать на событие в сцене.

Каждый такой вызов — сетевая задержка (~500–2000 мс), потребление токенов и расходы.

### Решение

При наличии обученной модели `slm_routine_v1.onnx`, большинство **рутинных задач** (подобрать предмет, переместиться к цели, выполнить authored-команду) может решить локальная нейросеть за **< 5 мс** без сетевых запросов. К LLM эскалируются только **сложные ситуации**: диалог, когнитивная неопределённость, неизвестные объекты.

---

## Архитектура: обзор

```
NpcPuppetMaster.processWorldModel()
        │
        ▼
┌───────────────────────┐
│   Hybrid Router       │  SlmInferenceEngine.isReady()?
│   (NpcPuppetMaster    │──────────────┐
│    lines ~431–479)    │              │ нет
└───────────────────────┘              │
        │ да                           ▼
        ▼                    ┌─────────────────────┐
┌───────────────────┐        │   LLM Provider API  │
│ SlmInputAdapter   │        │  (Anthropic/OpenAI) │
│ .encode(context)  │        └─────────────────────┘
└───────────────────┘
        │ Int32Array [tokens]
        ▼
┌─────────────────────────┐
│  onnxruntime-web WASM   │
│  slm_routine_v1.onnx    │
└─────────────────────────┘
        │ Int32Array [output tokens]
        ▼
┌────────────────────────┐
│ SlmOutputAdapter       │
│ .decode(tokens, map)   │
└────────────────────────┘
        │
        ├─ kind: 'success'  ──▶  NpcPlan[] → выполняется движком
        │
        └─ kind: 'escalate' ──▶  LLM Provider API
```

---

## Модули

### ShadowLogger — сбор датасета

**Файл**: `src/mechanics/slm/ShadowLogger.ts`

Записывает Gold Standard датасет из реальных игровых сессий. Вызывается из `NpcPuppetMaster` автоматически после каждого успешного LLM-плана.

#### API

```typescript
// Регистрирует начало нового плана (сразу после ответа LLM)
ShadowLogger.logWake(
  npcId: string,
  trigger: NpcIndividualTrigger,
  staticPrefixHash: string,
  dynamicContext: NpcActorContext,
  plans: NpcPlan[]
)

// Фиксирует финальный результат плана
ShadowLogger.commit(
  npcId: string,
  outcome: 'plan_completed' | 'plan_interrupted' | ...,
  worldChanged: boolean
)

// Отменяет запись (при сбое, reject или halt)
ShadowLogger.discard(npcId: string)
```

#### Что попадает в датасет

Фильтры гарантируют попадание только **чистых, проверенных** примеров:

| Условие | Действие |
|---------|----------|
| `outcome !== 'plan_completed'` | отброс |
| `worldChanged === false` | отброс |
| Триггер `repeated_without_progress` | отброс |
| Триггер `pattern_without_progress` | отброс |
| Триггер `plan_continued` | отброс |
| Шаг `THINK_STRATEGY` в плане | отброс |
| В тестовой среде (Vitest) | пропуск записи на диск |

#### Формат записи (JSONL)

Файл: `logs/slm_shadow_dataset.jsonl`. Каждая строка — JSON объект:

```json
{
  "timestamp": 1720915200000,
  "npcId": "guard",
  "wakeTriggerType": "action_completed",
  "wakeTriggerCode": "npc_took_item",
  "staticPrefixHash": "abc123...",
  "minifiedDynamicContext": { "...": "NpcActorContext" },
  "generatedPlans": [{ "npcId": "guard", "steps": ["..."] }],
  "outcome": "plan_completed",
  "worldChanged": true
}
```

`minifiedDynamicContext` — это `NpcActorContext` конкретного NPC: его позиция, видимые сущности, инвентарь, цели, история.

---

### SlmVocabulary — токенизатор

**Файл**: `src/mechanics/slm/SlmVocabulary.ts`

Числовые ID для всех статических элементов словаря.

#### Специальные токены (0–9)

| Токен | ID | Назначение |
|-------|----|-----------|
| `PAD` | 0 | Паддинг |
| `START` | 1 | Начало последовательности |
| `END` | 2 | Конец последовательности |
| `ESCALATE` | 3 | Явный запрос на эскалацию к LLM |

#### Токены действий (10–22)

| Токен | ID | Шаг плана |
|-------|----|-----------|
| `MOVE_TO` | 10 | Перемещение к цели |
| `TAKE` | 11 | Поднять предмет |
| `OPEN` | 12 | Открыть Switch/контейнер |
| `CLOSE` | 13 | Закрыть |
| `PUT` | 14 | Положить предмет |
| `COMMAND` | 15 | Authored-команда |
| `TRAVERSE_EXIT` | 16 | Пройти через выход |
| `LOOK` | 17 | Осмотреть |
| `EXAMINE` | 18 | Исследовать детально |
| `USE` | 19 | Использовать предмет на цели |
| `WAIT` | 20 | Ожидание |
| `SAY` | 21 | Произнести реплику |
| `THINK_STRATEGY` | 22 | Стратегический анализ |

#### Токены пространственных отношений (30–33)

`REL_IN` (30), `REL_ON` (31), `REL_UNDER` (32), `REL_BEHIND` (33)

#### Флаги состояния объектов (40–49)

| Флаг | ID | Значение |
|------|----|---------|
| `FLAG_REACHABLE` | 40 | Объект доступен для взаимодействия |
| `FLAG_HELD` | 41 | Объект в инвентаре NPC |
| `FLAG_ROUTE_AVAILABLE` | 42 | Есть маршрут к объекту |
| `FLAG_UNREACHABLE` | 43 | Объект недоступен |
| `FLAG_CAN_OPEN` | 44 | Switch можно открыть |
| `FLAG_CAN_CLOSE` | 45 | Switch можно закрыть |
| `FLAG_LOCKED` | 46 | Switch заблокирован |
| `FLAG_KEY_HELD` | 47 | Ключ есть у NPC |
| `FLAG_TARGET_OBJECTIVE` | 48 | Объект упомянут в целях NPC |
| `FLAG_ACTOR` | 49 | Другой Actor |

#### Динамические сущности (≥ 100)

ID сущностей из контекста назначаются динамически при кодировании, начиная с `DYNAMIC_ENTITY_BASE = 100`. Это позволяет нейросети работать с объектами, которые не известны заранее, через механизм **pointer-generation** (указательная генерация).

---

### SlmInputAdapter — кодирование контекста

**Файл**: `src/mechanics/slm/SlmInputAdapter.ts`

Преобразует `NpcActorContext` в числовой массив токенов.

#### Структура входной последовательности

```
[START]
  [FLAG_TARGET_OBJECTIVE entity_idx]...   ← цели NPC, сопоставленные с сущностями
  [FLAG_HELD entity_idx]...               ← инвентарь NPC
  [entity_idx FLAG_REACHABLE?             ← видимые сущности со флагами:
               FLAG_ROUTE_AVAILABLE?
               FLAG_UNREACHABLE?
               FLAG_CAN_OPEN?
               FLAG_CAN_CLOSE?
               FLAG_LOCKED?
               FLAG_KEY_HELD?]...
  [entity_idx FLAG_ACTOR]...              ← другие актёры в сцене
[END]
```

#### Пример

Контекст NPC `guard` видит `tv` (reachable) и держит `tv_rc` в инвентаре. Цель: "включить телевизор".

```
INPUT: [1, 48, 100, 41, 101, 100, 40, 2]
         ^   ^    ^   ^   ^    ^   ^   ^
       START OBJ  tv HLD rc   tv RCHB END
```

#### Возвращаемое значение

```typescript
interface SlmEncodedInput {
  tokens: Int32Array;
  mapping: DynamicEntityMapping; // indexToId / idToIndex для декодера
}
```

Поле `mapping` хранит соответствие между динамическими индексами токенов и строковыми ID объектов из игры.

---

### SlmOutputAdapter — декодирование плана

**Файл**: `src/mechanics/slm/SlmOutputAdapter.ts`

Декодирует выходные токены нейросети в `NpcPlan[]`.

```typescript
type SlmDecodeResult =
  | { kind: 'success'; plans: NpcPlan[] }
  | { kind: 'escalate'; reason: string };
```

#### Алгоритм декодирования

1. Читать токены по одному.
2. Если токен == `ESCALATE` → немедленно вернуть `{ kind: 'escalate' }`.
3. Если токен == `END` → завершить цикл.
4. Если токен == действие (`MOVE_TO`, `TAKE`, ...) → прочитать следующий токен как `entity_idx`, разрешить его в `entityId` через `mapping.indexToId`.
5. Если entityId не найден в mapping → вернуть `{ kind: 'escalate', reason: '...' }`.
6. Для двухаргументных действий (`USE`, `PUT`) читать два последовательных entity_idx.
7. Если декодировано 0 шагов → `{ kind: 'escalate', reason: 'Decoded plan produced 0 steps' }`.

#### Триггеры автоматической эскалации

Адаптер эскалирует при:
- явном `ESCALATE` токене в выводе модели;
- ссылке на entity_idx, отсутствующий в mapping;
- действии без требуемых аргументов;
- неизвестном токене;
- пустом плане.

Это гарантирует, что **в движок попадают только структурно корректные планы**.

---

### SlmInferenceEngine — движок инференса

**Файл**: `src/mechanics/slm/SlmInferenceEngine.ts`

Singleton-класс, управляющий жизненным циклом ONNX-сессии.

#### API

```typescript
// Проверить готовность модели
SlmInferenceEngine.isReady(): boolean

// Принудительно включить / отключить SLM (без выгрузки модели)
SlmInferenceEngine.setEnabled(enabled: boolean): void

// Инициализировать с опциональным кастомным путём к модели
SlmInferenceEngine.init(modelUrl?: string): Promise<boolean>

// Выполнить инференс для контекста NPC
SlmInferenceEngine.infer(context: NpcActorContext): Promise<SlmDecodeResult>
```

#### Загрузка модели

По умолчанию загружается из `/models/slm_routine_v1.onnx`. Загрузка происходит лениво при первом вызове `infer()`, если сессия ещё не создана. При ошибке загрузки движок переходит в режим `escalate` для всех последующих вызовов (fallback на LLM остаётся активным).

#### Технические детали

- Использует `onnxruntime-web` с провайдером `wasm`.
- `import('onnxruntime-web')` — динамический, чтобы не тянуть WASM в bundle при старте.
- Статические поля (`session`, `ortModule`) — singleton на уровне модуля.

---

## Гибридный роутер в NpcPuppetMaster

**Файл**: `src/mechanics/NpcPuppetMaster.ts`, метод `processWorldModel()`, строки ~431–479.

Роутер активируется **только** при следующих условиях:
- в `worldModel` ровно один NPC (одиночная обработка);
- `SlmInferenceEngine.isReady()` возвращает `true`.

### Логика выполнения (быстрый путь)

```
1. Получить NpcActorContext для NPC
2. Вызвать SlmInferenceEngine.infer(context)
3. Если result.kind === 'success':
   a. normalizeResponse()               → санитизировать планы
   b. expandImplicitTakeApproaches()    → MOVE_TO перед TAKE если нужно
   c. validatePlanItems()               → проверить наличие предметов
   d. removePrematureStrategySteps()    → убрать преждевременный THINK_STRATEGY
   e. removeRepeatedNoProgressSteps()   → убрать повторяющиеся бесполезные шаги
   f. Если acceptedPlans.length > 0:
      - executePlanAndTrackContinuation()
      - ShadowLogger.commit() если нет scheduled-шагов
      - maybeScheduleContinuation() для многошаговых планов
      - traceWake('slm_handled_routine', ...)
      ← КОНЕЦ, LLM не вызывается
4. Если result.kind === 'escalate' или планы не прошли валидацию:
   - traceWake('slm_escalated_to_llm', ...)
   - продолжить стандартный LLM-путь ↓
```

### Диагностика роутера (`#PEEKPM`)

- `slm_handled_routine` — план выполнен локально (SLM).
- `slm_escalated_to_llm` — SLM не смог, передано LLM + причина.

---

## Жизненный цикл плана

### Через LLM (запись в датасет)

```
LLM Response → normalizeResponse() → acceptedPlans
                                           │
                              ShadowLogger.logWake()  ← 📝 начало записи
                                           │
                              executePlanAndTrackContinuation()
                                           │
                    ┌──────────────────────┤
                    │                      │
             синхронный план        асинхронный план
                    │                      │
        ShadowLogger.commit()     ShadowLogger.commit()
            ✅ записывается        в continuationCallback
                                   после завершения
```

При отмене, reject или halt → `ShadowLogger.discard()` — запись не производится.

### Через SLM (быстрый путь)

```
SlmInferenceEngine.infer()
     │
     ├─ success → executePlanAndTrackContinuation()
     │               (без logWake — SLM-планы в датасет не пишутся)
     │
     └─ escalate → LLM Provider → стандартный путь выше
```

---

## Обучение SLM: пайплайн

> ⚠️ Этот раздел описывает **внешний** процесс обучения, выполняемый вне игрового движка.

### Шаг 1. Сбор данных (Shadow Mode)

Запустите игру с LLM провайдером. NPC работают через LLM, `ShadowLogger` накапливает успешные планы в `logs/slm_shadow_dataset.jsonl`.

Рекомендуемый объём для первого обучения: **≥ 500 записей** с разнообразными сценариями.

### Шаг 2. Предобработка датасета

Из JSONL-записей создайте пары `(input_ids, output_ids)`:

```python
for entry in jsonl_records:
    context = entry['minifiedDynamicContext']
    plan = entry['generatedPlans'][0]

    input_tokens = slm_input_adapter.encode(context)   # Int32[]
    output_tokens = slm_output_adapter.encode(plan)    # Int32[]

    dataset.append((input_tokens, output_tokens))
```

### Шаг 3. Обучение

Рекомендуемая архитектура: **seq2seq с pointer-generation**.

| Параметр | Рекомендация |
|----------|-------------|
| Embedding size | 64–128 |
| Hidden size | 128–256 |
| Attention | pointer mechanism для entity tokens |
| Loss | cross-entropy |
| Оптимизатор | Adam, lr=1e-3 |

### Шаг 4. Экспорт в ONNX

```python
import torch.onnx

torch.onnx.export(
    model,
    (sample_input,),
    'slm_routine_v1.onnx',
    input_names=['input_ids'],
    output_names=['output_ids'],
    dynamic_axes={'input_ids': {0: 'batch', 1: 'seq_len'}}
)
```

### Шаг 5. Деплой

Скопировать `slm_routine_v1.onnx` в папку `public/models/`. Модель загружается автоматически при первом вызове `SlmInferenceEngine.infer()`.

---

## Руководство разработчика

### Запуск в режиме сбора данных (Shadow Mode)

**Ничего не нужно делать.** Shadow Mode активен по умолчанию всегда, когда работает LLM. Данные пишутся в `logs/slm_shadow_dataset.jsonl`.

Проверить что данные собираются:

```bash
# После нескольких минут игры:
wc -l logs/slm_shadow_dataset.jsonl

# Или на Windows:
(Get-Content logs/slm_shadow_dataset.jsonl | Measure-Object -Line).Lines
```

Если файл пустой — убедитесь что:
1. NPC реально меняют мир (`worldChanged: true` в результатах)
2. LLM провайдер доступен и возвращает планы
3. Нет ошибок в консоли браузера (file API)

### Подключение обученной модели

1. Разместить `slm_routine_v1.onnx` в `public/models/`:
   ```
   Quest/
   └── public/
       └── models/
           └── slm_routine_v1.onnx
   ```

2. Модель загружается автоматически. Проверить в консоли браузера:
   ```
   [SlmInferenceEngine] Successfully loaded ONNX model from: /models/slm_routine_v1.onnx
   ```

3. В трассировке PM (`#PEEKPM`) должны появляться сообщения `slm_handled_routine`.

### Управление моделью во время выполнения

```typescript
import { SlmInferenceEngine } from './src/mechanics/slm/SlmInferenceEngine';

// Отключить SLM (принудительный fallback на LLM)
SlmInferenceEngine.setEnabled(false);

// Включить обратно
SlmInferenceEngine.setEnabled(true);

// Предзагрузить модель заранее (без ожидания первого infer())
await SlmInferenceEngine.init();

// Проверить готовность
if (SlmInferenceEngine.isReady()) {
  console.log('SLM готова к работе');
}

// Использовать альтернативную модель
await SlmInferenceEngine.init('/models/slm_v2_experimental.onnx');
```

### Добавление новых типов шагов

Если нужно добавить новый тип шага (например `TRADE`):

1. **`SlmVocabulary.ts`** — добавить токен:
   ```typescript
   TRADE: 23,
   ```

2. **`SlmOutputAdapter.ts`** — добавить `case` в `switch`:
   ```typescript
   case SLM_TOKENS.TRADE: {
     const itemId = nextEntityId();
     const actorId = nextEntityId();
     if (!itemId || !actorId) {
       return { kind: 'escalate', reason: 'TRADE missing args' };
     }
     steps.push({ type: 'TRADE', itemId, targetId: actorId });
     break;
   }
   ```

3. **`SlmInputAdapter.ts`** — при необходимости добавить флаги состояния для нового контекста.

4. **Переобучить модель** с новым словарём — старая модель не будет знать новый токен.

5. **Обновить тесты** в `tests/npc/slm-adapters.test.ts`.

### Отладка и диагностика

#### В игре (`#PEEKPM` режим)

Ввести `#PEEKPM` в игровой ввод. В UI и консоли появятся логи:
- `slm_handled_routine` — план выполнен через SLM ✅
- `slm_escalated_to_llm` — эскалация к LLM (+ причина)

#### Прямой тест инференса (DevTools консоль браузера)

```javascript
import('/src/mechanics/slm/SlmInferenceEngine').then(m => {
  m.SlmInferenceEngine.infer({
    id: 'guard',
    entities: [
      { id: 'key', interaction: 'reachable', approach: 'already_reachable' }
    ],
    objectives: ['найти ключ'],
    inventory: { available: true, itemIds: [] },
    actors: [],
    position: { x: 10, y: 10 }
  }).then(console.log);
});
```

#### Анализ датасета (PowerShell / bash)

```powershell
# Количество записей в датасете:
(Get-Content logs/slm_shadow_dataset.jsonl | Measure-Object -Line).Lines

# Типы триггеров:
Get-Content logs/slm_shadow_dataset.jsonl |
  ForEach-Object { ($_ | ConvertFrom-Json).wakeTriggerType } |
  Group-Object | Sort-Object Count -Descending
```

```bash
# Bash: статистика типов шагов в планах:
jq -r '.generatedPlans[0].steps[].type' logs/slm_shadow_dataset.jsonl |
  sort | uniq -c | sort -rn

# Топ триггеров:
jq -r '.wakeTriggerType' logs/slm_shadow_dataset.jsonl |
  sort | uniq -c | sort -rn
```

---

## Сценарии использования

### Сценарий 1: NPC подбирает предмет

**Условие**: Guard видит `key` (reachable, route_available). Цель: "найти ключ".

**SLM Input** (упрощённо):
```
[START, FLAG_TARGET_OBJECTIVE, idx:key, idx:key, FLAG_REACHABLE, FLAG_ROUTE_AVAILABLE, END]
```

**SLM Output** (ожидаемый):
```
[START, MOVE_TO, idx:key, TAKE, idx:key, END]
```

**Результат**: NPC движется к ключу и подбирает его — **без вызова LLM**.

---

### Сценарий 2: Переход между комнатами

**Условие**: NPC должен достичь `exit_door` (route_available) и пройти через него.

**SLM Output** (ожидаемый):
```
[START, MOVE_TO, idx:exit_door, TRAVERSE_EXIT, idx:exit_door, END]
```

**Результат**: Переход через выход — **без вызова LLM**.

---

### Сценарий 3: Authored-команда (COMMAND) — эскалация

**Условие**: Guard держит `tv_rc`, TV видимый. Authored-команда `turn_tv_on` на TV.

`COMMAND` требует строкового `commandId`, который нельзя закодировать в pointer-generation токенах. SLM возвращает `ESCALATE`. LLM генерирует правильный `COMMAND` шаг.

> **Будущее**: добавить authored command IDs в статический словарь через `SlmVocabulary`.

---

### Сценарий 4: Диалог (SAY) — эскалация

**Условие**: NPC должен поздороваться с игроком.

`SAY` требует текстовой строки, которую SLM не может сгенерировать. Любой `SAY` шаг автоматически эскалирует к LLM, который генерирует contextual реплику.

---

### Сценарий 5: Нестандартная ситуация — явная эскалация

**Условие**: NPC оказывается в незнакомой ситуации без очевидного маппинга целей на доступные действия.

SLM может:
- вывести токен `ESCALATE` явно (если обучена на таких примерах);
- вывести невалидную последовательность → автоэскалация адаптером.

В обоих случаях LLM выполняет полноценный анализ контекста.

---

## Эскалация: когда SLM уступает LLM

| Причина | Кто инициирует |
|---------|---------------|
| ONNX-модель не загружена | `SlmInferenceEngine` |
| SLM отключён через `setEnabled(false)` | `SlmInferenceEngine` |
| Вывод содержит `ESCALATE` токен | `SlmOutputAdapter` |
| Ссылка на неизвестный entity_idx | `SlmOutputAdapter` |
| Пустой план (0 шагов) | `SlmOutputAdapter` |
| Неизвестный токен действия | `SlmOutputAdapter` |
| `normalizeResponse()` отклоняет план | Hybrid Router |
| `validatePlanItems()` отклоняет план | Hybrid Router |
| Все шаги удалены как no-progress | Hybrid Router |
| Более 1 NPC в `worldModel` | Hybrid Router (не пробует SLM) |

---

## Тесты

**Файл**: `tests/npc/slm-adapters.test.ts`

### Запуск

```bash
npx vitest run tests/npc/slm-adapters.test.ts   # только SLM тесты
npx vitest run tests/npc/                        # все NPC тесты
```

### Покрытие

| Тест | Что проверяет |
|------|--------------|
| `SlmInputAdapter encodes NPC context into tokens` | Кодирование: цели, инвентарь, видимые сущности, флаги |
| `SlmOutputAdapter decodes MOVE_TO + TAKE sequence` | Декодирование двухшагового плана |
| `SlmOutputAdapter returns escalation on ESCALATE token` | Реакция на явный ESCALATE |
| `SlmOutputAdapter escalates on empty plan` | Пустой вывод → эскалация |
| `SlmInferenceEngine returns escalation gracefully when ONNX model is missing` | Graceful fallback при отсутствии модели |

### Изоляция тестов

`ShadowLogger` полностью отключается в тестовой среде (`process.env.VITEST`). Все три метода (`logWake`, `commit`, `discard`) возвращают немедленно без побочных эффектов: нет записи на диск, нет взаимодействия с fake timers.

---

## Известные ограничения и риски

### Текущие ограничения

| Ограничение | Причина | Статус |
|-------------|---------|--------|
| Нет обученной модели | `slm_routine_v1.onnx` не существует | Phase 1 (сбор данных) |
| `SAY` не поддерживается | текстовые строки нельзя tokenize | эскалация к LLM |
| `COMMAND` ограничен | `commandId` — произвольная строка | эскалация к LLM |
| Только одиночные NPC | batch-запросы всегда через LLM | архитектурное решение |
| Нет семантической валидации | OutputAdapter проверяет структуру, не смысл | нормализаторы PM компенсируют |

### Риски при обучении и деплое

- **Dataset bias**: датасет собранный только в одном типе сцен даст слабую генерализацию.
- **Distribution shift**: при обновлении структуры `NpcActorContext` старая модель устаревает.
- **Overfit**: модель может хорошо работать на простых задачах, но всегда эскалировать сложные — это **желательное** поведение при правильной настройке.

### Рекомендации

- Регулярно пересматривать датасет, удалять дубликаты и аномалии.
- Включать в обучение примеры **намеренной эскалации** (где LLM решил нестандартную задачу), чтобы SLM знала, когда лучше уступить.
- После обновлений `npcTypes.ts` — переcмотреть кодирование в `SlmInputAdapter`.
- Версионировать файл модели (`slm_routine_v1.onnx`, `slm_routine_v2.onnx`, ...) и хранить вместе с датасетом, на котором обучена каждая версия.

