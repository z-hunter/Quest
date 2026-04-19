# Autotests

## Purpose

This document describes the current automated test setup on the `autotests` branch.

The first iteration is intentionally narrow:

- deterministic parser behavior;
- parser core contracts;
- direct `Game` semantic API behavior;
- scene runtime behavior around spatial hierarchy and subscenes;
- one thin parser + game integration layer.

This setup is meant to protect the most fragile gameplay contracts without introducing heavy browser or UI end-to-end coverage.

## Current Stack

- Test runner: `vitest`
- Environment: `node`
- Command:

```bash
npm run test
```

Type safety check:

```bash
npm run typecheck
```

## Design Principles

The current autotest system is built around a few constraints:

- Tests should not depend on large mutable game-content scenes.
- Tests should use small deterministic fixtures.
- Tests should target architecture layers directly:
  - parser;
  - parser core;
  - scene runtime;
  - subscene behavior.
- Tests should be readable enough to act as executable architecture documentation.

Out of scope for this iteration:

- full browser Playwright coverage;
- full UI/canvas assertions;
- live LLM/API testing;
- using live content scenes as the main source of truth.

## File Layout

```text
tests/
  fixtures/
    gameSemanticFactory.ts
    gameFactory.ts
    parserFactory.ts
    sceneFactory.ts
    textAssetFactory.ts
  game/
    navigation-and-spatial.test.ts
    semantic-api.test.ts
  parser/
    commands.test.ts
    core.test.ts
    preprocessor.test.ts
    resolution.test.ts
  scene/
    spatial-index.test.ts
    subscene-activation.test.ts
    subscene-cleanup.test.ts
  integration/
    parser-game.test.ts
vitest.config.ts
```

## Fixture System

The tests use programmatic fixtures instead of real scene files.

### `tests/fixtures/textAssetFactory.ts`

Provides a minimal in-memory text layer for tests:

- object titles, descriptions, details, synonyms;
- scene title and description;
- parser service strings;
- parser lexicon;
- parser training data;
- parser command specs.

Use this when a test needs stable text assets without relying on `public/text/...`.

### `tests/fixtures/gameFactory.ts`

Provides a minimal `IGame`-compatible harness:

- captured player-facing messages;
- captured logs;
- captured played sounds;
- minimal `sceneManager`;
- minimal `textAssets`.

This is the base semantic harness used by scene and parser tests.

### `tests/fixtures/gameSemanticFactory.ts`

Builds on top of `gameFactory.ts` and exposes the real `Game` semantic API methods through `Game.prototype`, while still avoiding full `Game` construction and UI bootstrap.

This fixture exists specifically for direct `Game`-layer contract tests.

Use it when the goal is to test:

- `lookScene`
- `lookEntity`
- `examineEntity`
- `showInventory`
- `removeInventoryEntity`
- `goToSceneTarget`
- `goToScene`
- `goToEntity`
- `describeSpatialRelation`

without pulling parser behavior into the assertion.

### `tests/fixtures/sceneFactory.ts`

Builds a tiny `Scene` on top of the test game harness.

Helpers include:

- `addEntity(...)`
- `addPlayer(...)`
- `addTriggerbox(...)`
- `addWalkbox(...)`

This is the preferred way to build small deterministic runtime worlds for tests.

### `tests/fixtures/parserFactory.ts`

Builds a real `Parser` instance on top of the fixture game and scene.

It wires the parser to a small semantic gameplay harness for:

- `lookScene`
- `lookEntity`
- `examineEntity`
- `takeEntity`
- `showInventory`
- `goToSceneTarget`
- `goToScene`
- `goToEntity`
- `removeInventoryEntity`
- `describeSpatialRelation`

It also exposes:

```ts
await fixture.run('look under chair');
```

which returns captured:

- `messages`
- `logs`
- `pendingIntent`

This is the preferred entry point for parser-side tests.

## Current Test Coverage

### Scene Runtime

#### `tests/scene/spatial-index.test.ts`

Covers:

- parent/child spatial indexing;
- grouping by relation:
  - `in`
  - `on`
  - `under`
  - `behind`
- direct-child lookup staying non-recursive;
- legacy fallback:
  - `parentNodeId + relation:null` behaves as `in`

#### `tests/scene/subscene-activation.test.ts`

Covers:

- direct entity child activation;
- direct triggerbox child activation;
- nested subscene becoming available;
- grandchildren not auto-activating;
- coexistence of:
  - `targetGroupId`
  - direct spatial children
- inventory/surface items staying synchronized with active subscene state;
- `Subscene.itemScale` runtime behavior for items.

#### `tests/scene/subscene-cleanup.test.ts`

Covers:

- `Switch` reset on subscene close;
- `sound1` playback path;
- cleanup for spatially included objects, not only group-based ones.

#### `tests/scene/scene-spatial-validator.test.ts`

Covers:

- `SceneSpatialValidator` happy path for relation-aware containers;
- duplicate container relation detection;
- built-in vs untitled external container extension conflicts;
- broken inventory/surface storage references;
- hidden semantic objects without `Title`;
- missing spatial parents and spatial parent cycles.

### Parser

#### `tests/parser/resolution.test.ts`

Covers:

- exact resolution;
- synonym match;
- partial match;
- ambiguity clarification;
- deterministic tie-break:
  - inventory first;
  - nearest scene object when titles are indistinguishable.
- container-aware TAKE/PUT target resolution edge cases.

#### `tests/parser/commands.test.ts`

Covers:

- `teleport`
- `teleport with id`
- wrong item for teleport -> no effect;
- `use id on boombox`
- missing-argument prompts for custom commands;
- `quit` / `exit` closing inventory preview or active subscene;
- `quit` falling through to parser fallback when nothing is open.

#### `tests/parser/preprocessor.test.ts`

Covers:

- console preprocessor shorthand expansion for:
  - `I`
  - `X`
  - `L`
  - `Q`

#### `tests/parser/core.test.ts`

Covers:

- pre-API handoff path;
- post-API escalation path;
- linear plan stopping after failure;
- core behavior independent of UI.

#### `tests/parser/llm-cascade.test.ts`

Covers:

- mocked LLM plan normalization;
- `final_response` and `clarification` conversion into `showText`;
- invalid JSON / invalid shape / provider error debug data;
- Anthropic SSE parsing without live API calls.
- forced Cascade 1 handoff prompt context for LLM experiments.

#### `tests/parser/llm-parser.test.ts`

Covers:

- `#LLM-ON` / `#LLM-OFF` console toggles;
- `#C1-OFF` / `#C1-ON` forced LLM handoff test mode;
- parser calling the LLM cascade only after lower cascades hand off;
- parser avoiding LLM calls for commands already handled by Stage 1.
- one post-API escalation retry through LLM when `#LLM-ON` is active.

#### `tests/parser/world-model-context.test.ts`

Covers:

- parser world-model entity context projection;
- spatial relation flattening through untitled technical nodes;
- anchor-relative spatial projection: nested titled objects can keep their direct relation to one anchor while still inheriting the outer relation when queried from a larger container;
- parser action resolution using the same anchor-relative relation projection for `TAKE ... FROM ...` and `TAKE ALL ... FROM ...`;
- hidden `lookable` / `examinable` semantic omission until reveal;
- blocker visibility vs reachability;
- player/external inventory projection;
- titled objects inside inactive `Subscene` staying visible to parser scope without becoming operable while runtime-disabled.

### Game

#### `tests/game/semantic-api.test.ts`

Covers:

- `lookScene`;
- `lookEntity`;
- `examineEntity`;
- `showInventory`;
- `removeInventoryEntity`;
- `takeEntity` / `putEntity`;
- container placement and failure reasons;
- hidden `lookable` / `examinable` semantics;
- `Blocker` and `blockedRelation` behavior;
- inventory hierarchy projection and sync.
- actor main inventory semantics: only the actor `Inventory` with relation `IN` is treated as held/UI inventory; other actor inventories are hidden storage slots.
- `PUT`/`DROP` success messages use the semantic parent title plus the first effective spatial relation to technical `Inventory`/`Surface` chains, not the item's final technical relation to the storage node.
- PUT source filtering treats items already stored through untitled target extensions as already inside the player-facing target.
- PUT target diagnostics: a distant target that has no compatible storage reports the semantic “you cannot put that there” failure before any distance failure; distance remains specific to targets that can actually accept the action.
- Surface placement runtime contracts:
  - placed item layer follows the target Surface layer;
  - active `Subscene.itemScale` is applied before placement and drop animation;
  - items placed on Switch-controlled Surface inherit the active Switch target group and are disabled/enabled with it.

This layer verifies `Game` as the shared semantic gameplay API, separate from parser parsing.

#### `tests/game/navigation-and-spatial.test.ts`

Covers:

- `goToSceneTarget`;
- `goToScene`;
- `goToEntity`;
- `describeSpatialRelation`.

This layer is especially useful for validating the shared boundary between parser and world/game semantics.

### Thin Integration

#### `tests/integration/parser-game.test.ts`

Covers a small end-to-end slice on tiny fixtures:

- `look under chair`
- far-but-visible `examine`
- container commands like `TAKE FROM ...` and `PUT ... IN|ON ...`
- `TAKE ALL` plural fallback diagnostics when matching objects are visible but outside the current `takable` scope.
- PUT diagnostics for distant valid storage targets versus distant non-container targets.
- PUT clarification continuation loops preserving the original destination.

This layer is intentionally small.

## How To Run

Run all tests:

```bash
npm run test
```

Run typecheck:

```bash
npm run typecheck
```

Run a specific test file with Vitest directly:

```bash
npx vitest run tests/parser/commands.test.ts
```

Run tests in watch mode:

```bash
npx vitest
```

## How To Add A New Test

### Add a parser test

If the behavior belongs to parser resolution, parser commands, or parser core:

- use `createParserFixture()`
- build the smallest world needed
- run parser input through `fixture.run(...)`
- assert on:
  - player-facing messages;
  - pending intent;
  - scene/inventory side effects.

Example:

```ts
const fixture = createParserFixture();
fixture.addPlayer();
fixture.addEntity('chair', { title: 'Chair', description: 'A chair.' });

const result = await fixture.run('look chair');

expect(result.messages.at(-1)).toBe('A chair.');
```

### Add a scene runtime test

If the behavior belongs to scene/spatial/subscene runtime:

- use `createSceneFixture()`
- build the smallest spatial structure possible
- call runtime helpers or component activation directly
- assert on:
  - enabled/disabled state;
  - `activeSubscene`;
  - `subsceneEntities`;
  - switch state;
  - played sounds.

### Add a new parser command fixture

If a test needs custom command data:

- reuse the default command fixtures already provided;
- or override command assets through:

```ts
fixture.textAssets.setParserCommands([...]);
```

This keeps tests independent from `public/text/system/commands/*.json`.

## Why Programmatic Fixtures Instead Of Real Scenes

The current system intentionally avoids large real content scenes because they:

- change frequently during content work;
- contain noise unrelated to the tested contract;
- make failures harder to localize.

Programmatic fixtures keep failures small and readable.

Real JSON scene fixtures may still be useful later for:

- serialization tests;
- loader tests;
- migration tests.

They are not necessary for the first iteration.

## Current Limitations

- No browser/UI/canvas assertions yet.
- No Playwright layer yet.
- LLM-stage tests are mocked only; normal tests must not call a live provider.
- Parser NLP stage is not the focus of the current suite.
- The direct `Game` tests use a semantic fixture layered on `Game.prototype`, not full `Game` construction.

## Recommended Next Iteration

The next useful expansions would be:

1. Add more parser-core scenarios:
   - clarification continuation loops;
   - more plan-state transitions;
   - more validation branches.

2. Expand console/preprocessor coverage:
   - `#STAGE1-ON/OFF`
   - `#STAGE2-ON/OFF`
   - regression checks that `#STAGE2` still means NLP while `#LLM` controls the LLM cascade

3. Add tiny serialization/load fixtures if scene loading itself needs coverage.

4. Add a very small browser smoke layer only if a runtime contract cannot be tested elsewhere.

## Practical Rule

When adding a test, prefer this order:

1. scene/runtime test
2. parser test
3. thin integration test
4. browser/UI test

If a lower layer can prove the contract, do not jump to a higher one.
