---
type: data-model
---

# Форматы данных и asset pipeline

## Каталоги

| Путь | Формат/роль |
| --- | --- |
| `public/scenes/*.json` | сцены, объекты, camera/spatial и authored properties |
| `public/prefabs/*.json` | повторно используемые entity templates |
| `public/sprites/*.json` | sprite metadata, frames и animation states |
| `public/vetool/*.json` | visual/editor tool data |
| `src/assets/*.svg` | editor/UI icons |

`AssetLoader.ts`, `SceneManager.ts`, `EditorPersistenceManager.ts` образуют путь load/edit/save. Runtime representations создаются из JSON в `Scene`, `Entity`, `Actor` и component systems.

## Text Assets

`TextAssetManager.ts` разрешает поле как `string` или `string[]`; массивы соединяются `\n` и поддерживают blank lines. `description/details` используются player-facing output, а `lore` может быть доступен только parser/LLM context.

## Расширение схемы

Новое поле проходит через load → TypeScript type/entity → editor property panel → persistence → runtime consumer → semantic projection, если оно видно parser или UI. Raw spatial data и semantic text context не следует дублировать.

Связанные заметки: [[Scenes-and-Spatial-Model]], [[UI-and-Editor]], [[Parser-and-AI]].
