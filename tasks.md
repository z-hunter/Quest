# Autotests Plan

## Goal

Introduce the first iteration of automated tests for `Scanline` / `Blue Signal` with focus on deterministic parser, core, and scene-runtime behavior.

This iteration should:
- cover the most fragile gameplay contracts;
- avoid heavy browser/UI end-to-end coverage;
- use small dedicated fixtures instead of live content scenes;
- be cheap to maintain while the architecture is still evolving.

Out of scope for this iteration:
- full Playwright coverage;
- LLM-stage testing;
- testing against large real content scenes as the main source of truth.

## Target Stack

- [x] Add `vitest` as the test runner.
- [x] Add `npm run test` script.
- [x] Keep the first iteration in a lightweight test environment:
  - prefer `node` environment;
  - use `jsdom` only if a specific test truly needs it.

## Test Architecture

The first iteration should use three layers:

1. Unit tests for parser and helpers.
2. Runtime tests for scene/spatial/subscene behavior.
3. Thin integration tests for parser + game on tiny fixtures.

Avoid starting with canvas/UI/browser assertions.

## Fixtures and Helpers

- [x] Create `tests/fixtures/sceneFactory.ts`
  - helpers for minimal `Scene` setup;
  - helpers for entities, triggerboxes, subscenes, switches, and spatial links.

- [x] Create `tests/fixtures/gameFactory.ts`
  - minimal `Game`/`IGame` test harness;
  - controllable logging, messages, sounds, and inventory.

- [x] Create `tests/fixtures/parserFactory.ts`
  - build parser with small fixture world;
  - helpers for running parser input and reading outcomes.

- [x] Create `tests/fixtures/textAssetFactory.ts`
  - minimal parser/engine text assets for tests;
  - keep messages stable and deterministic.

- [x] Decide fixture style for first iteration:
  - start with programmatic fixtures;
  - add tiny JSON fixture scenes later only if load/serialization tests need them.

## First Test Files

### Parser

- [x] `tests/parser/resolution.test.ts`
  Cover:
  - exact title match;
  - synonym match;
  - partial match;
  - ambiguity clarification;
  - deterministic tie-break:
    - inventory first;
    - nearest scene object when needed.

- [x] `tests/parser/commands.test.ts`
  Cover:
  - `teleport with id`;
  - wrong item -> no effect;
  - `use id on boombox`;
  - multi-argument parsing for `USE X ON Y`;
  - missing-argument prompt cases.

- [x] `tests/parser/core.test.ts`
  Cover:
  - unified envelope intake;
  - pre-API escalation;
  - post-API escalation;
  - linear plan execution;
  - custom command validation path.

### Scene / Runtime

- [x] `tests/scene/spatial-index.test.ts`
  Cover:
  - direct parent/child lookup;
  - relation grouping (`in`, `on`, `under`, `behind`);
  - direct-child helper stays non-recursive.

- [x] `tests/scene/subscene-activation.test.ts`
  Cover:
  - direct entity child activates;
  - direct triggerbox child activates;
  - nested subscene becomes available;
  - grandchildren do not activate automatically.

- [x] `tests/scene/subscene-cleanup.test.ts`
  Cover:
  - switch reset on subscene close;
  - `sound1` path fires correctly;
  - spatially included switch resets too, not only group-based targets.

### Thin Integration

- [x] `tests/integration/parser-game.test.ts`
  Cover only a few end-to-end flows on tiny fixtures:
  - `look under chair`;
  - `teleport with your id card`;
  - one far-but-visible `examine` case.

## Recommended Implementation Order

1. [x] Add `vitest` infrastructure.
2. [x] Add factories/helpers.
3. [x] Implement spatial runtime tests first:
   - `spatial-index.test.ts`
   - `subscene-activation.test.ts`
   - `subscene-cleanup.test.ts`
4. [x] Implement parser command/resolution tests.
5. [x] Add one thin integration test file.

## Success Criteria For Iteration 1

- [x] `npm run test` works locally.
- [x] Tests do not depend on large mutable content scenes.
- [x] The most fragile parser/runtime contracts are covered.
- [x] Failing tests point to a specific layer:
  - parser;
  - core;
  - scene runtime;
  - subscene behavior.

## Notes

- Keep UI click behavior out of the first iteration unless a contract cannot be tested elsewhere.
- Prefer deterministic fixtures over browser automation.
- Keep tests readable enough that they double as executable architecture documentation.
- `Autotests.md` is the current developer-facing description of the test system, fixtures, coverage, and usage workflow.
- Current progress:
  - `vitest` bootstrap is in place;
  - runtime spatial/subscene tests are green;
  - parser resolution, commands, and core tests are green;
  - one thin integration smoke file is green;
  - current status: first autotest iteration is functionally complete.
