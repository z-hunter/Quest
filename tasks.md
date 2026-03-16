# Parser Tasks

## Current Scope

These tasks cover the parser roadmap described in `Parser.md`, excluding the future LLM cascade.

## Current Focus

- [x] Introduce parser custom command assets (`Commands.md`, command TA loading, shared command spec format).
- [x] Expand parser DSL/Core so lower layers can mock richer Stage-2-style plans.
- [ ] Implement `TELEPORT WITH` as the first custom command scenario driven by command TA.

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
- [ ] Verify that UI, scripts, and game logic continue using the same shared `Game API`.
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

## Suggested Order

1. Extract a single world-model builder that produces context and scope together.
2. Unify cascade envelopes.
3. Refactor `Parser Core` around the unified protocol.
4. Add `synonyms` support to TA and target resolution.
5. Improve `#PEEK`.
6. Run regression checks and clean up boundaries with `Game API`.

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
