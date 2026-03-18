# Parser Tasks

## Current Scope

These tasks cover the parser roadmap described in `Parser.md`, excluding the future LLM cascade.

## Current Focus

- [x] Introduce parser custom command assets (`Commands.md`, command TA loading, shared command spec format).
- [x] Expand parser DSL/Core so lower layers can mock richer Stage-2-style plans.
- [x] Implement `TELEPORT WITH` as the first custom command scenario driven by command TA.
- [x] Extend command assets to support multi-argument parsing for flows like `USE X ON Y`.
- [x] Add parser-side relation grammar recognition for queries like `LOOK UNDER TABLE` and `EXAMINE IN DRAWER`.

## Next Initiative: Spatial Hierarchy In Game

Goal:
- move spatial world structure into `Game` / scene runtime instead of keeping it as parser-only semantics;
- keep `visibility` and `accessibility` explicitly out of scope for this step;
- let parser consume spatial data as part of world context rather than owning it;
- add editor support so scene authors can assign parent object and relation type.

Architecture rules for this initiative:
- `spatial` belongs to the world model, not to the parser;
- parser should only read spatial structure through `ParserWorldModelBuilder`;
- visibility/accessibility remain separate concerns and are not part of this task;
- both direct object-to-object nesting and object/subscene nesting must be supported;
- subscene should act as a virtual spatial node as well as a focus/interaction mechanism.

## Backlog

- [x] Replace the separate `ParserContextBuilder` / `ParserScopeBuilder` idea with one `ParserWorldModelBuilder` that returns both `context` and `scope`.
- [x] Define explicit scope slices:
  - `visible`
  - `held`
  - `takable`
  - `reachable`
  - `examinable`
  - `subscene`
  - `sceneTargets`
- [x] Replace ad-hoc resolution helpers with scope-driven resolution.
- [x] Unify stage outputs so `Stage 1.1` and `Stage 1.2` emit the same Core-facing envelope.
- [x] Refactor `Parser Core` around the unified envelope/protocol.
- [x] Separate pre-API escalation from post-API escalation in `Parser Core`.
- [x] Support linear plan execution in `Parser Core` without requiring LLM.
- [x] Add optional `synonyms` to object TA schema.
- [x] Include `synonyms` in the default object TA template.
- [x] Extend parser target resolution to use:
  - `title`
  - `synonyms`
  - partial matching
  - clarification on ambiguity
- [x] Expand `#PEEK` debug output with:
  - scope data
  - unified envelope data
  - Core decision data
- [x] Verify that UI, scripts, and game logic continue using the same shared `Game API`.
- [ ] Add regression tests / smoke checks for:
  - `#STAGE1-ON/OFF`
  - `#STAGE2-ON/OFF`
  - clarification flows
  - inventory-aware resolution
  - `synonyms`
  - pre-API escalation
  - post-API escalation
  - linear plan execution without LLM
  - manual checklist drafted in `ParserSmoke.md`
- [ ] Extend runtime spatial hierarchy so remaining relation-aware parser queries like `near` can execute against real world data.

## Spatial Hierarchy Plan

### 1. Runtime / Scene Model

- [x] Define shared runtime types for spatial placement:
  - `parentNodeId`
  - `relation`
  - relation enum: `in`, `on`, `under`, `behind`
- [x] Add optional spatial metadata to regular scene entities.
- [x] Extend subscene data so a subscene can act as a virtual spatial node:
  - stable node id
  - title
  - optional description
  - optional spatial parent link
- [x] Build a scene-level spatial index in runtime:
  - node lookup by id
  - children by parent id
  - children grouped by relation
- [ ] Keep this index separate from render hierarchy and separate from visibility/accessibility logic.
- [x] Treat `Subscene` as a virtual spatial node.
- [x] Simplify `Subscene` authored data so spatial identity and nesting come from the owning `Triggerbox`, not duplicate fields on the component.
- [x] Auto-activate direct spatial children when opening a `Subscene`:
  - direct `Entity` children
  - direct `Triggerbox` children
  - direct nested `Subscene` children
- [x] Keep `Subscene` activation non-recursive:
  - opening parent `Subscene A` reveals only direct children
  - children of nested `Subscene B` remain inactive until `B` itself is opened

### 2. Parser Integration

- [x] Extend `ParserWorldModelBuilder` so parser context includes spatial data projected from runtime.
- [x] Define parser-facing relation projection:
  - anchor node id
  - relation type
  - child node ids
- [x] Replace the current relation-query fallback path with real lookup against runtime spatial data.
- [x] Support first real execution cases:
  - `LOOK UNDER X`
  - `LOOK IN X`
  - `LOOK BEHIND X`
- [ ] Keep `near` out of execution until its runtime semantics are clearly defined.
- [x] Preserve current clarification behavior:
  - resolve anchor
  - ambiguity handling
  - tie-break rules for non-usable ambiguity

### 3. Editor / UI Authoring

- [x] Add editor UI for every scene `Entity` to choose:
  - parent object / node
  - relation type
- [ ] Limit parent candidates to valid nodes in the current scene.
- [x] Keep `Subscene` editor UI focused on behavior-facing fields only:
  - title
  - description
  - target group id
- [x] Add editor UI for `Triggerbox` spatial authoring:
  - parent object / node
  - relation type
- [ ] Ensure authoring UI does not imply visibility/accessibility behavior that is not implemented yet.
- [x] Add serialization/deserialization support for the new spatial fields.
- [x] Show spatial nesting visually in `HierarchyPanel` for scene entities:
  - child entities render below their parent
  - nested entities are indented to the right
  - flat list order remains stable for roots and fallback cases
- [x] Extend `HierarchyPanel` spatial nesting display to polygon-based scene objects:
  - `Triggerbox`
  - `Walkbox`

### 4. Migration / Compatibility

- [x] Keep existing scenes valid with all spatial fields optional.
- [x] Preserve current `activeSubscene` / `subsceneEntities` behavior during migration.
- [x] Make parser relation grammar continue to work even before a scene defines any spatial metadata.
- [ ] Add smoke checks for scenes mixing:
  - direct object nesting
  - object inside subscene
  - subscene inside object
  - nested subscene chains

### 5. Documentation

- [x] Update `Parser.md` so it clearly states spatial hierarchy is owned by `Game`, not parser.
- [x] Add or update documentation for scene spatial schema and subscene-as-node behavior.
- [ ] Document the editor workflow for assigning parent object and relation type.

## Suggested Order

1. Extract a single world-model builder that produces context and scope together.
2. Unify cascade envelopes.
3. Refactor `Parser Core` around the unified protocol.
4. Add `synonyms` support to TA and target resolution.
5. Improve `#PEEK`.
6. Run regression checks and clean up boundaries with `Game API`.
7. Introduce runtime spatial hierarchy and then reconnect parser relation queries to it.

## Plan For Step 3

- [x] Define a single `CascadeEnvelope` shape that both `Stage 1.1` and `Stage 1.2` emit.
- [x] Replace the current action/handoff JSON split with the unified envelope.
- [x] Make `Parser Core` consume the unified envelope directly instead of inferring behavior from ad-hoc action types.
- [x] Split `Parser Core` flow into explicit phases:
  - envelope intake
  - pre-API validation/resolution
  - API plan execution
  - post-API outcome analysis
- [x] Introduce a minimal linear plan execution path in `Core` for non-LLM producers.
- [x] Expose enough debug data in `#PEEK` to inspect envelope and Core decisions while refactoring.
