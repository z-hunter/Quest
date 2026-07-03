# Refactor: Split PropertiesPanel.tsx

## Context

`src/components/editor/PropertiesPanel.tsx` is a 4404-line / 177 KB monolithic React component. It contains ALL property editing UI for every object type (Entity, Actor, Quad, Triggerbox, Walkbox, Scene, Settings, Multi-Selection). It must be split into a modular component tree while preserving all existing behavior exactly. No visual or functional changes are allowed — this is a **pure structural refactor**.

## Tech Stack
- React 19 (functional components, hooks)
- Vanilla CSS (styles are in `src/index.css`, class names like `e-row`, `e-label`, `e-input`, `e-btn`, `editor-sidebar`, etc.)
- State from Zustand store (`useEditorStore`) and `useGame()` hook
- Custom `<Select>` component from `src/components/common/Select.tsx`

## Critical Constraints

1. **NO visual or behavioral changes.** The refactored panel must be pixel-identical and functionally identical to the existing one.
2. **Preserve the section model.** Section numbers (0–6), section header colors (blue/red/yellow/purple/neutral), and digit-key scrolling must all survive.
3. **Preserve undo integration.** The `lastUndoObjectKeyRef` / `lastUndoMultiKeyRef` pattern must remain unified so undo batching works correctly.
4. **Preserve tooltip system.** The `PROPERTIES_LABEL_TOOLTIPS` dictionary and `useEffect` that applies tooltips based on label text must remain.
5. **Preserve `handleChange` semantics.** The central `handleChange(field, value, enforceNumber)` function handles undo snapshot, direct object mutation, hierarchy refresh, sprite reload, ignore-scaling compensation, and animation speed sync. All sub-components must use this shared function.
6. **After refactoring, run `npm run typecheck` and `npm run build` to verify. Both must pass.**

## Current Structure Map

The file has these logical regions:

| Lines | Content | Target File |
|---|---|---|
| 1–10 | Imports | `PropertiesPanel.tsx` (stays) |
| 11–136 | Constants: `SPATIAL_RELATION_OPTIONS`, `PROPERTIES_LABEL_TOOLTIPS` | `propertiesConstants.ts` |
| 138–148 | `normalizeTooltipLabelText()` | `propertiesConstants.ts` |
| 150–176 | Component start, hooks, state declarations | `PropertiesPanel.tsx` (stays) |
| 179–191 | Object binding logic (`obj = ...`) | `PropertiesPanel.tsx` (stays) |
| 193–267| Shared helper hooks (spatial parent options, etc.) | `propertiesHooks.ts` |
| 289–296 | `getSharedValue()` | `propertiesUtils.ts` |
| 298–305 | `getSharedBooleanState()` | `propertiesUtils.ts` |
| 307–312 | `formatPanelNumber()` | `propertiesUtils.ts` |
| 314–332 | `setSectionRef`, `scrollToSection` | `PropertiesPanel.tsx` (stays) |
| 334–402 | Polygon/Quad centroid utilities, translate helpers | `propertiesUtils.ts` |
| 452–522 | `applyPolygonScaleDraft()` | Pass as callback from parent |
| 524–556 | `applyToMulti()`, `applyToMultiRoots()` | Pass as callbacks from parent |
| 627–701 | TA handlers (Open/Read/Delete) | Pass as callbacks from parent |
| 703–768 | `renderSection()`, `renderOpacityBlurControls()` | `propertiesUtils.ts` (export as components) |
| 778–806 | Empty / loading state return | `PropertiesPanel.tsx` |
| 808–1418 | **MULTI SELECTION** panel | `MultiSelectionProperties.tsx` |
| 1420–1500 | `handleChange()` + type flags | `PropertiesPanel.tsx` (stays, shared) |
| 1502–1712 | **Section 0** (ID, Title, TA, GroupID, Parent) — shared across single-object types | `SectionIdentity.tsx` |
| 1715–1941 | **Entity/Actor/Static: Sections 1+2** (Transform + Visual) | `EntityProperties.tsx` |
| 1943–1976 | **Walkbox Properties** | `WalkboxProperties.tsx` |
| 1978–2070 | **Triggerbox: Section 1** (Transform) | `TriggerboxProperties.tsx` |
| 2072–2526 | **Quad: Sections 1+2** (Transform + Vertices + Visual) | `QuadProperties.tsx` |
| 2528–3405 | **Section 3: COMPONENTS** (shared across types) | `SectionComponents.tsx` |
| 3407–3641 | **Section 4: ACTOR PROP** (Actor-only) | `ActorProperties.tsx` |
| 3644–3718 | **Section 5: SCRIPT EVENTS** (shared) | `SectionScriptEvents.tsx` |
| 3720–3798 | **Section 6**: Bottom misc (Lock, Disabled, Redraw Polygon for TB) | `SectionMisc.tsx` |
| 3800–4133 | **SCENE Properties** (Camera + Scaling) | `SceneProperties.tsx` |
| 4135–4399 | **SETTINGS Properties** (Editor + CRT) | `SettingsProperties.tsx` |

## Target File Structure

```
src/components/editor/properties/
├── PropertiesPanel.tsx          # Thin orchestrator (~200 lines)
├── propertiesConstants.ts       # SPATIAL_RELATION_OPTIONS, PROPERTIES_LABEL_TOOLTIPS, normalizeTooltipLabelText
├── propertiesUtils.ts           # formatPanelNumber, getSharedValue, getSharedBooleanState, geometry helpers
├── propertiesTypes.ts           # SharedPropertiesContext type
├── PropertiesContext.tsx        # React context for shared state (game, obj, handleChange, etc.)
├── MultiSelectionProperties.tsx # Lines 808–1418
├── SectionIdentity.tsx          # Lines 1502–1712 (Section 0)
├── EntityProperties.tsx         # Lines 1715–1941 (Sections 1+2 for Entity/Actor/Static)
├── WalkboxProperties.tsx        # Lines 1943–1976
├── TriggerboxProperties.tsx     # Lines 1978–2070 (Section 1 for Triggerbox)
├── QuadProperties.tsx           # Lines 2072–2526 (Sections 1+2 for Quad)
├── SectionComponents.tsx        # Lines 2528–3405 (Section 3: Components)
├── ActorProperties.tsx          # Lines 3407–3641 (Section 4: Actor Props)
├── SectionScriptEvents.tsx      # Lines 3644–3718 (Section 5)
├── SectionMisc.tsx              # Lines 3720–3798 (Section 6: Lock/Disabled)
├── SceneProperties.tsx          # Lines 3800–4133 (Scene Camera + Scaling)
└── SettingsProperties.tsx       # Lines 4135–4399 (Editor + CRT Settings)
```

## Shared State Strategy

Use a React Context (`PropertiesContext`) to share commonly-needed state without prop-drilling:

```typescript
interface PropertiesContextValue {
  game: Game;
  obj: any;
  selectedObjectType: string;
  selectedObjectId: string | null;
  mode: string | null;
  objectVersion: number;
  selectedVertexIndex: number | null;
  uiScale: number;

  // Shared mutation functions
  handleChange: (field: string, value: any, enforceNumber?: boolean) => void;
  incrementObjectVersion: () => void;
  incrementHierarchyVersion: () => void;

  // Shared render helpers
  formatPanelNumber: (value: any) => number | string;
  renderSection: (section: number, title: string | null, color: string, children: React.ReactNode) => JSX.Element;
  renderOpacityBlurControls: (...args) => JSX.Element;
  setSectionRef: (section: number) => (node: HTMLDivElement | null) => void;
}
```

## Execution Steps

Execute in this exact order. After each step, the file should still compile.

### Step 1: Create utility files
1. Create `src/components/editor/properties/propertiesConstants.ts`
   - Move `SPATIAL_RELATION_OPTIONS` (lines 11–17)
   - Move `PROPERTIES_LABEL_TOOLTIPS` (lines 19–136)
   - Move `normalizeTooltipLabelText` (lines 138–148)

2. Create `src/components/editor/properties/propertiesUtils.ts`
   - Move `formatPanelNumber` logic (will be a plain function)
   - Move `getSharedValue()`, `getSharedBooleanState()`
   - Move geometry helpers: `getPolyCentroid`, `getQuadCentroid`, `translatePolyTo`, `translateQuadTo`, `scalePolyByFactor`, `scaleQuadVerticesByFactor`

3. Create `src/components/editor/properties/propertiesTypes.ts`
   - Define `PropertiesContextValue` interface

4. Create `src/components/editor/properties/PropertiesContext.tsx`
   - Create context and provider

### Step 2: Extract leaf components (bottom-up, smallest first)
1. `SettingsProperties.tsx` — Lines 4135–4399. Self-contained, no cross-refs.
2. `SceneProperties.tsx` — Lines 3800–4133. Self-contained.
3. `WalkboxProperties.tsx` — Lines 1943–1976. Very small.
4. `SectionScriptEvents.tsx` — Lines 3644–3718. Uses `obj.interactions`.
5. `SectionMisc.tsx` — Lines 3720–3798. Uses Lock/Disabled/Redraw.
6. `ActorProperties.tsx` — Lines 3407–3641. Uses animSets, direction, speed.
7. `SectionIdentity.tsx` — Lines 1502–1712. Section 0 shared code.

### Step 3: Extract larger components
1. `SectionComponents.tsx` — Lines 2528–3405. All component editors (Backface, Item, Inventory, Surface, Subscene, Subtrigger, Switch, Shadow, WalkBox, 3d-parallax). This is the biggest sub-component.
2. `EntityProperties.tsx` — Lines 1715–1941. Entity/Actor/Static Transform + Visual.
3. `TriggerboxProperties.tsx` — Lines 1978–2070. Triggerbox Transform.
4. `QuadProperties.tsx` — Lines 2072–2526. Quad Transform + Vertices + Visual.

### Step 4: Extract MultiSelectionProperties
1. `MultiSelectionProperties.tsx` — Lines 808–1418. This is the second-biggest block. It has its own rendering path with `applyToMulti`/`applyToMultiRoots`.

### Step 5: Wire up orchestrator
1. Rewrite `PropertiesPanel.tsx` as a thin orchestrator:
   - Import all sub-components
   - Keep tooltip `useEffect`, section scroll hotkeys, and panel wrapper
   - Switch on `selectedObjectType` and render the right components
   - Keep the original import path (`src/components/editor/PropertiesPanel.tsx`) as a re-export to avoid touching any other file

### Step 6: Verification
1. Run `npm run typecheck` — must pass
2. Run `npm run build` — must pass
3. Visual check: open editor, select each object type, verify panel renders identically

## Re-export Strategy

To avoid touching ANY import in other files, the original path must keep working:

```typescript
// src/components/editor/PropertiesPanel.tsx (after refactor)
export { PropertiesPanel } from './properties/PropertiesPanel';
```

## Model Recommendation

**Recommended model for execution: Claude Sonnet 4 (you, the current model)**

Reasoning:
- This is a **large-scale mechanical refactor** with high risk of subtle regressions (lost props, broken callbacks, wrong refs).
- It requires reading and understanding 4400 lines of deeply interconnected JSX/hooks code and moving pieces without breaking anything.
- Claude Sonnet 4 has the best combination of:
  - Very large effective context window (can hold the full file map)
  - Extremely precise code manipulation (minimizes copy-paste errors)
  - Strong TypeScript/React understanding
  - Meticulous attention to edge cases in refactors
- GPT Codex would be fine for individual step execution but may lose context across the multi-step plan.

Alternative: If you want to parallelize, you could split Step 2 (the leaf components) across multiple Codex sessions since they're independent, but the orchestrator step (Step 5) should be done by a model with full context.

## Estimated Effort
- Steps 1–4: ~2–3 agent sessions (or 1 long session)
- Step 5: ~1 session  
- Step 6: ~15 minutes manual + automated verification
- **Total: ~1 day of focused work**
