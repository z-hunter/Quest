# Text Assets

## V1 decision

We start with a minimal text asset system for scene and object descriptions.

Text assets are stored separately from scene and prefab JSON files:

- `public/text/scenes/<scene-id>.json`
- `public/text/objects/<object-id>.json`

System-level text assets live under `public/text/system/`. The current parser/GM LLM system prompt is stored as markdown in `public/text/system/parser-llm-system.md` so it can be edited without changing TypeScript code.

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
- `details`
- `synonyms`
- `semanticTags`
- `relationFacts`

Minimal object assets may still contain only `title` and `description`. Missing optional fields are treated as empty.

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
- `details` maps to the richer text used by parser/runtime for `examine`.
- `synonyms` helps the parser and LLM map player wording to this object.
- Existing runtime fields remain as fallback and for backward compatibility.
- Parser and UI should read only the resolved standard fields, not custom variant names directly.
- The LLM parser cascade receives resolved parser/world context plus the system prompt asset; it should not read arbitrary scene files directly.

## Object semantic fields for LLM context

Object Text Assets can describe lightweight semantic knowledge for the Stage 2 LLM cascade.

This is authoring metadata for context generation only. It does not add real runtime mechanics, command verbs, scripts, state changes, or game effects.

### `semanticTags`

`semanticTags` is an optional string array on an object asset.

It describes what the object is in a reusable way:

```json
{
  "title": "Compact cassette",
  "description": "You see a compact cassette.",
  "synonyms": ["tape", "cassette"],
  "semanticTags": ["media", "audio_media", "cassette"]
}
```

Tags are used by `ParserWorldModelBuilder` when generating `worldFacts` for the LLM prompt. They are not player-facing text and should be short, stable, lowercase identifiers.

Recommended style:

- use broad tags and specific tags together, for example `media`, `audio_media`, `cassette`;
- reuse the same tags across scenes for the same concept;
- prefer semantic role over implementation detail, for example `fuel`, `keycard`, `power_cell`, `light_source`;
- avoid putting prose in tags.

### `relationFacts`

`relationFacts` is an optional array on a parent/container/device object asset.

Each rule says: when this object has a child in a relation, and the child has one of the required tags, add a concise authoritative world fact for the LLM.

Shape:

```json
{
  "relation": "in",
  "childTags": ["media", "audio_media"],
  "fact": "{self} already has {child} loaded."
}
```

Supported `relation` values:

- `in`
- `on`
- `under`
- `behind`

`childTags` matches if the child has at least one listed tag. If `childTags` is empty or missing, the rule applies to every child in that relation.

`fact` supports these placeholders:

- `{self}` - the parent object's resolved `title`;
- `{child}` - the child object's resolved `title`;
- `{relation}` - the matched relation.

Example: media player

```json
{
  "title": "Boombox",
  "synonyms": ["recorder", "radio", "tape recorder"],
  "semanticTags": ["device", "audio_device", "media_player"],
  "relationFacts": [
    {
      "relation": "in",
      "childTags": ["media", "audio_media"],
      "fact": "{self} already has {child} loaded."
    }
  ]
}
```

If `Compact cassette` is inside `Boombox`, the LLM context gets:

```text
Boombox contains Compact cassette.
Compact cassette is inside Boombox.
Boombox already has Compact cassette loaded.
```

Example: vehicle fuel

```json
{
  "title": "Car",
  "semanticTags": ["vehicle"],
  "relationFacts": [
    {
      "relation": "in",
      "childTags": ["fuel"],
      "fact": "{self} has {child} in the tank."
    }
  ]
}
```

```json
{
  "title": "Gasoline",
  "semanticTags": ["fuel", "liquid"]
}
```

If `Gasoline` is inside `Car`, the LLM context gets:

```text
Car contains Gasoline.
Gasoline is inside Car.
Car has Gasoline in the tank.
```

### Important limitations

- These facts are for LLM context only.
- They do not make unsupported commands executable. For example, `PLAY`, `DRIVE`, or `FUEL` still need real command/runtime support if they should change game state.
- They help the LLM avoid contradicting the world. For example, it should not say a cassette is missing if `worldFacts` says it is already loaded.
- Keep facts concise and factual. Tone, sarcasm, and atmospheric refusal text belong in LLM responses, not in semantic facts.
