# Text Assets

## V1 decision

We start with a minimal text asset system for scene and object descriptions.

Text assets are stored separately from scene and prefab JSON files:

- `public/text/scenes/<scene-id>.json`
- `public/text/objects/<object-id>.json`

Since scene/object IDs according to GDD can contain paths like "building\room", which means that the 'room.json scene' is located in the 'building' folder, there may be subfolders inside these folders.

## Main rules

- Scene text asset is created automatically when a scene is created or first saved, if it does not exist yet.
- Object text asset is stored independently from scenes and prefabs, because objects may exist outside a scene or move between scenes.
- Missing text asset files are not errors; runtime falls back to existing built-in fields.
- Text assets contain only data, not code.
- Dynamic text changes are controlled by scripts through runtime properties of scenes and objects.

## Minimal fields

Scene asset:

- `title`
- `description`

Object asset:

- `title`
- `description`

## Custom text variants

Text assets may also contain custom named fields in the same JSON file, for example:

- `description_morning`
- `description_evening`
- `title_locked`

These are alternative text values that can be activated at runtime.

## Runtime redirection

The redirection table does not live inside text asset JSON files.

Instead, each scene and object may have a runtime property such as `textRedirects` that remaps standard text fields to custom fields from the same text asset.

Example:

```json
{
  "description": "description_evening"
}
```

Meaning:

- when runtime asks for `description`, it should use `description_evening` from the text asset;
- if no redirect is set, the default `description` field is used;
- if redirect points to a missing field, runtime should fall back to the standard field.

Scripts do not generate text themselves. They only change which named text field is currently active.

## Runtime integration

- `title` maps to the user-facing object or scene name.
- `description` maps to the basic text used by parser/runtime for `look` or `look around`.
- Existing runtime fields remain as fallback and for backward compatibility.
- Parser and UI should read only the resolved standard fields, not custom variant names directly.
