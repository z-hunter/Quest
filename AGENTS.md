# Project Instructions

- To get answers to previous session logs and project documentation, you can use your NotebookLM skill (Scanline Engine's notebook, URL: `https://notebooklm.google.com/notebook/9f146be7-7c4a-4bb0-b7b4-7f20079e85b0`). You can ask NotebookLM questions, and it will answer based on the project's entire knowledge base.
- Always consult NotebookLM for architecture/codebase recall first (if possible), instead of having to re-analyze the codebase each time. This saves tokens and allows us to do more.

- You ALWAYS record all important points, decisions, and insights you, and other developers, might need in the future in your memory (agent-memory-MCP)

- Before implementing anything, check the contents of your memory for all related information. Use RAG if available.

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
