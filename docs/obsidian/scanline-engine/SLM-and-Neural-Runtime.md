# SLM и нейросетевой runtime

Локальный быстрый путь реализован в `src/mechanics/slm/`:

- `SlmInputAdapter` кодирует компактный runtime context в `SlmEncodedInput`;
- `SlmVocabulary` содержит специальные токены действий, отношений и state flags;
- `SlmInferenceEngine` запускает inference через `onnxruntime-web`;
- `SlmOutputAdapter` декодирует токены в typed result;
- `DynamicEntityMapping` связывает pointer-токены с реальными строковыми entity IDs;
- `ShadowLogger` сравнивает локальный результат с fallback/LLM без изменения мира.

Подробный pipeline формирования обучающих примеров описан в [[SLM-Dataset-Collection]]. Runtime только фильтрует и пишет JSONL; очистка, split, токенизация, обучение и сборка ONNX-модели находятся за пределами текущих runtime-контрактов.

SLM подходит для рутинных navigation/take/use решений и должен эскалировать неизвестную команду, генерацию речи или недостаточный confidence в `LlmCascade`/`NpcPuppetMaster`. Ни SLM, ни LLM не являются state authority: окончательная проверка выполняется parser core, `GameSemanticAPI`, navigation и actor executors.

[[LLM-Provider-Contracts]] · [[Parser-Cascade-Contracts]] · [[AI-Data-Flow]]
