# Parser Smoke Checks

These checks are intended for quick manual regression testing of the current parser stack in `Scanline`, before the future LLM cascade exists.

Run them in a scene that contains at least:
- one visible object with `title`
- one object with `details`
- one takeable item
- one inventory item after pickup
- one object or scene target addressable via `synonyms`

## Baseline

1. Enable parser debug when needed:
   - `#PEEK-ON`
2. Ensure both lower layers are enabled:
   - `#STAGE1-ON`
   - `#STAGE2-ON`

Expected:
- parser accepts commands normally
- `#PEEK` shows `context`, `scope`, `envelope`, `core`, `result`

## Stage Toggles

1. Disable stage 1:
   - `#STAGE1-OFF`
2. Enter a phrase that only NLP should understand:
   - `go over to the office`
3. Re-enable stage 1:
   - `#STAGE1-ON`
4. Disable stage 2:
   - `#STAGE2-OFF`
5. Retry the same NLP-only phrase.
6. Re-enable stage 2:
   - `#STAGE2-ON`

Expected:
- with `#STAGE1-OFF`, stage 1 bypasses and stage 2 can still parse
- with `#STAGE2-OFF`, stage 1 handoff does not reach NLP

## Clarification Flow

1. `take`
2. respond with a target, for example:
   - `key`

Repeat for:
- `examine`
- `go to`

Expected:
- parser asks clarification question
- second input is treated as continuation
- `pendingState` clears after completion or failure

## Inventory-Aware Resolution

1. Pick up a visible item:
   - `take id`
2. Check inventory:
   - `i`
3. Look at carried item:
   - `look id`
   - `look id card`
4. Examine carried item:
   - `x id`

Expected:
- carried item appears in inventory
- `LOOK` and `EXAMINE` can resolve inventory items
- `TAKE` and `GO TO` do not use inventory as target space

## Synonyms

Use an object that has `synonyms` in its TA.

Examples:
- `look logotype`
- `look recorder`
- `take radio`
- `go to tape recorder`

Expected:
- parser resolves by `title` or `synonyms`
- ambiguity clarification appears if multiple candidates match

## EXAMINE vs LOOK

1. `look boombox`
2. `x boombox`

Expected:
- `LOOK` returns short `description`
- `EXAMINE` returns `details`
- if `details` are missing, parser escalates instead of inventing text locally

## Pre-API vs Post-API Escalation

Pre-API example:
- use input unsupported by stage 1 and stage 2 disabled

Post-API example:
- `x logo` when object has no `details`

Expected:
- pre-API escalation appears in `core`
- post-API escalation appears in `result.outcomes`

## Console Preprocessor

1. `i`
2. `l logo`
3. `x boombox`

Control case:
- `where i am?`

Expected:
- `i` becomes `INVENTORY`
- `l ...` becomes `LOOK ...`
- `x ...` becomes `EXAMINE ...`
- normal sentences containing `i` are not rewritten to inventory commands

## Scope Checks

With `#PEEK-ON`, verify:
- `visible` contains visible scene entities
- `held` contains inventory entities
- `takable` contains only takeable scene entities
- `examinable` contains held, reachable, and subscene entities
- `sceneTargets` contains registered destination scenes

## Current Success Criteria

The smoke run is considered healthy when:
- no parser exceptions appear in the console
- `#PEEK` shows coherent `scope`, `envelope`, and `core` data
- clarification flows work
- inventory-aware resolution works
- synonym resolution works
- stage toggles work
- `LOOK` and `EXAMINE` remain distinct
