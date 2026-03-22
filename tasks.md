# Properties Panel Redesign Plan

## Goal

Restructure the right-side Properties panel into consistent numbered sections with:
- shared section layout;
- colored headings and dividers;
- section hotkeys `0..6` that scroll the panel to the chosen section;
- unified field placement across object types where possible.

## Scope

In scope:
- `Entity`
- `Actor`
- `Static`
- `Quad`
- `Triggerbox`
- multi-selection panel
- section hotkey navigation for the Properties panel
- new purple section style

Out of scope for this task:
- `Walkbox` property layout changes
- `SETTINGS` redesign
- deep component-specific redesign beyond regrouping under `COMPONENTS`

## Section Model

### Section 0
No title.
Contains:
- ID
- Title
- TA buttons
- Group ID
- Parent / Relation

### Section 1 TRANSFORM
Contains, depending on object type:
- X, Y, H, W
- Scale, Layer, Parallax
- Collider H, W
- Depth Sort mode
- Disable Depth-scaling
- Vertices block for `Quad`

### Section 2 VISUAL
Contains:
- Fill Color
- Blend mode
- Opacity / Blur
- Retro Grid block for `Quad`
- Sprite

### Section 3 COMPONENTS
Contains all component-related editing.

### Section 4 ACTOR PROP.
Actor-only section. Keep current actor-specific controls.

### Section 5 SCRIPT EVENTS
Shared script event section for all non-Walkbox object types.

### Section 6
No title.
Contains all remaining object-specific controls not covered above.

## Implementation Steps

- [ ] Add reusable section wrapper API in `PropertiesPanel.tsx`
- [ ] Add purple section accent style in CSS
- [ ] Add section number badge style (inverse accent)
- [ ] Add Properties-panel hotkey scroll navigation for digits `0..6`
- [ ] Reorganize multi-selection layout into the new section model
- [ ] Reorganize `Entity` / `Actor` / `Static`
- [ ] Reorganize `Quad`
- [ ] Reorganize `Triggerbox`
- [ ] Keep `Walkbox` layout unchanged
- [ ] Keep `SETTINGS` layout unchanged
- [ ] Verify build and manual editor navigation behavior

## Notes

- Parent / Relation should hide `Relation` when Parent is `(None)`.
- Parent dropdown styling should keep natural-case IDs.
- Script Events becomes a common section for all non-Walkbox scene objects.
- Reuse existing component editors and vertex editors where possible instead of rewriting them.
