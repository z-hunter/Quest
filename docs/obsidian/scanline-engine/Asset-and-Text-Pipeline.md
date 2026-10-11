---
type: implementation
system: assets
---

# AssetLoader и TextAssetManager

## AssetLoader

Файл: `src/core/AssetLoader.ts`.

`SpriteData` загружается и кэшируется через image entries со state `active|warm|cold`. SceneManager сообщает scene sprite refs: `markSceneSpriteRefs`, `renameSceneSpriteRefs`, `releaseSceneSpriteRefs`, `syncSceneCacheState`. Loader считает `ImageCacheStats`, budget bytes и evict’ит unused images.

```text
Scene instantiate → collect sprite names
                  → AssetLoader scene refs
                  → image cache state/budget
                  → Entity/Quad render
```

## TextAssetManager

Файл: `src/core/TextAssetManager.ts`.

Normalizes scene/object/service text assets, maps ids to project paths/URLs, builds default assets, resolves scalar/list fields and interpolates params. `string|string[]` поддерживает multiline text; parser services включают lexicon, training и command specs.

Ключевые методы: `getSceneAssetProjectPath`, `getObjectAssetProjectPath`, `getParserLexicon`, `getParserTraining`, `getParserCommands`, `getResolvedSceneField`, `getResolvedObjectField`, `getServiceText`, `getServiceList`, `clearCaches`.

Связанные: [[Data-Formats-and-Assets]], [[Parser-World-Model]], [[Core-Game-Implementation]].
