# Обучение NLP.js в `NlpCascade`

## Роль

`src/mechanics/NlpCascade.ts` — Stage 1.2 parser. Это локальный intent classifier, а не world reasoner и не исполнитель действий. Его задача — сопоставить свободный английский ввод с одним из authored intents и вернуть confidence/target для Parser Core.

Поддерживаемые intent labels:

`look`, `examine`, `take`, `put`, `open`, `close`, `quit`, `goTo`, `showInventory`.

## Источник обучающих фраз

Основной asset: `public/text/system/parser-training.json`, читается через `TextAssetManager.readParserTrainingAsset()`.

Текущий asset содержит 101 utterance:

| Intent | Фраз |
|---|---:|
| `look` | 17 |
| `examine` | 14 |
| `take` | 17 |
| `put` | 7 |
| `open` | 6 |
| `close` | 6 |
| `quit` | 2 |
| `goTo` | 20 |
| `showInventory` | 12 |

Фразы включают короткие canonical commands, синонимичные глаголы, articles и более свободные естественные формулировки. Asset — классификационный набор примеров, а не перечень объектов сцены: entity titles и synonyms разрешаются позже через lexicon/scope.

## `initialize()` lifecycle

1. Защита от повторного запуска: `ready` возвращает resolved promise, `initPromise` объединяет concurrent callers.
2. `TextAssetManager` читает training asset.
3. Динамически импортируются `@nlpjs/core`, `@nlpjs/nlp`, `@nlpjs/lang-en-min`.
4. Создаётся NLP.js `Container`; в него подключаются `ArrToObj`, `Normalizer`, `Tokenizer`, `Stopwords`, `Stemmer`, `LangEn`.
5. Создаётся `new Nlp({ autoSave:false, autoLoad:false, forceNER:false, languages:['en'], nlu:{useNoneFeature:true} }, container)`.
6. Вычисляется cache key из полного JSON training data.
7. При cache hit модель импортируется; при ошибке import cache удаляется и выполняется новое обучение.
8. При cache miss каждая пара `(intent, utterance)` регистрируется через `manager.addDocument('en', utterance, intent)`.
9. Вызывается `await manager.train()`.
10. Обученная модель экспортируется через `manager.export(true)` и сохраняется в localStorage.

`autoSave`/`autoLoad` отключены: приложение само контролирует cache lifecycle и versioning.

## Preprocessing и inference

Перед `manager.process` NLP cascade удаляет хвостовые `?.!,` и пробелы. NLP.js возвращает `intent` и `score`.

- пустой intent или `None` → `reason: none_intent`;
- `score < 0.58` (`NLP_CONFIDENCE_THRESHOLD`) → `reason: low_confidence` и handoff дальше;
- label вне `SupportedIntent`/неподходящий для конкретной normalized input → `unsupported_intent`;
- valid intent → `normalizeTargetForIntent` извлекает target через parser lexicon.

NLP.js не выбирает entity ID, не проверяет visibility/reachability и не меняет Scene. После классификации `buildActions` создаёт обычный `ParserCascadeEnvelope` (`stage: 'nlp-v2'`) с тем же `ParserToolAction[]`, который использует Stage 1.1.

## Cache contract

Prefix: `quest:nlp:model:v1:`. Полный training JSON хэшируется `getModelCacheKey`; изменение порядка/содержания training asset меняет key и автоматически создаёт новую модель.

Кэш хранится только при наличии `window.localStorage`; в environments без `window` training выполняется без persistence. `manager.export(true)` даёт сериализуемую модель; `readCachedModel`/`writeCachedModel` и `removeCachedModel` инкапсулируют storage operations.

Debug (`NlpCascadeDebugInfo`) сообщает input, normalized input, raw intent, score, matched, reason и target. Init diagnostics отдельно фиксируют cache hit/miss, cache key, train time, model bytes и total init time.

## Граница с остальным parser

```text
parser-training.json
        ↓
NLP.js addDocument/train/export
        ↓
intent + confidence + cleaned target
        ↓
ParserCascadeEnvelope (nlp-v2)
        ↓
Parser Core: scope/synonyms → entityId → GameSemanticAPI
```

Таким образом, training NLP.js обучает только mapping language → intent. `parser-lexicon.json`, `ParserWorldModelBuilder`, target resolver, deterministic preconditions, `GameSemanticAPI` и player-facing response не входят в обучение NLP.js.

## Fallback semantics

Если initialization или inference не дал usable result, `NlpCascade` оставляет envelope для следующего Stage 2 LLM. Ошибка модели не считается успешным parser action и не мутирует мир.

[[Parser-Cascade-Architecture]] · [[Parser-Data-Contracts]] · [[Parser-World-Model]] · [[Asset-and-Text-Pipeline]] · [[Configuration-and-UI-Tokens]]
