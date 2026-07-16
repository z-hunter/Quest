---
type: implementation
system: editor-properties
---

# Editor properties panels

Файлы: `src/components/editor/properties/*`.

## Dispatch

`PropertiesPanel`/`PropertiesContext` select panel by selected object type/component. Specialized panels include `EntityProperties`, `ActorProperties`, `QuadProperties`, `WalkboxProperties`, `TriggerboxProperties`, `FolderProperties`, `SceneProperties`, `SettingsProperties`, `MultiSelectionProperties`.

Sections handle identity, components, script events, misc flags, transforms, visual properties, scene camera/scaling and settings. Shared helpers live in `propertiesUtils.tsx`, `propertiesConstants.ts`, `SectionIdentityUtils.ts`, `SectionScriptEventsUtils.ts`.

## Mutation flow

```text
controlled field
  → PropertiesContext/manager callback
  → selected SceneObject property
  → editor selection changed notification
  → undo snapshot
  → renderer preview + persistence dirty state
```

Panels should use typed component helpers and preserve `SERIALIZABLE_PROPS`; runtime-only fields (parser notes, owner pointers, interaction lock) are not editor-authored properties.

Связанные: [[Editor-Implementation]], [[Editor-Persistence]], [[Component-Schema]].
