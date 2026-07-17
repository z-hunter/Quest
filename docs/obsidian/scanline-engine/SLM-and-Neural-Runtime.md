# SLM и нейросетевой runtime

Локальный быстрый путь реализован в `src/mechanics/slm/`:

- `SlmInputAdapter` кодирует компактный runtime context в `SlmEncodedInput`;
- `SlmVocabulary` содержит специальные токены действий, отношений и state flags;
- `SlmInferenceEngine` запускает inference через `onnxruntime-web`;
- `SlmOutputAdapter` декодирует токены в typed result;
- `DynamicEntityMapping` связывает pointer-токены с реальными строковыми entity IDs;
- `ShadowLogger` сравнивает локальный результат с fallback/LLM без изменения мира.

Подробный pipeline формирования обучающих примеров описан в [[SLM-Dataset-Collection]]. Полный offline pipeline теперь находится в `scripts/slm/pipeline.py` и запускается командой `npm run slm:pipeline`: export → safety filtering/deduplication → deterministic 80/10/10 split → GRU train → held-out eval → ONNX opset 17 → compatibility manifest.

Runtime сначала загружает `slm_routine_v1.manifest.json` и проверяет schema version, SHA-256 словаря, tensor names/dtypes и допустимый ONNX opset. Только после успешной проверки создаётся `onnxruntime-web` session. Любая несовместимость безопасно переводит запрос на LLM fallback.

Артефакты:

- `artifacts/slm/` — очищенный dataset, splits, checkpoint и eval report;
- `public/models/slm_routine_v1.onnx` — runtime model;
- `public/models/slm_routine_v1.manifest.json` — lineage и compatibility contract.

SLM подходит для рутинных navigation/take/use решений и должен эскалировать неизвестную команду, генерацию речи или недостаточный confidence в `LlmCascade`/`NpcPuppetMaster`. Ни SLM, ни LLM не являются state authority: окончательная проверка выполняется parser core, `GameSemanticAPI`, navigation и actor executors.

[[LLM-Provider-Contracts]] · [[Parser-Cascade-Contracts]] · [[AI-Data-Flow]]
