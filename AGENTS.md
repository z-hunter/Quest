# Project Instructions

## Autotests Recall Rule

When working on mechanics/runtime-related code or architecture-sensitive changes in:
- `src/mechanics`
- `src/scene`
- `src/systems`
- `src/core`

and especially on:
- parser behavior;
- `Game` semantic API behavior;
- spatial hierarchy;
- subscene behavior;

recall that this project has an autotest system on branch `autotests`.

Before proceeding with substantial changes in those areas:
- remember that autotests may already cover the contract you are touching;
- consult memory for the current autotest workflow and coverage;
- use `Autotests.md` for the current developer-facing description of:
  - when to run autotests;
  - how to run them;
  - what is currently covered;
  - how fixtures and test harnesses are structured.

## Autotests Maintenance Rule

When making significant functional changes or adding important new behavior in mechanics/runtime code:
- check whether existing autotests still describe the intended behavior;
- update affected tests if the contract changed;
- add new tests when a new important gameplay/runtime/parser contract is introduced;
- update `Autotests.md` if the test system, fixtures, or coverage model changes in a meaningful way.
