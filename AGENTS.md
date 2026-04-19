# Project Instructions

- To get answers to previous session logs and project documentation, you can use your NotebookLM skill (Scanline Engine's notebook, URL: `https://notebooklm.google.com/notebook/9f146be7-7c4a-4bb0-b7b4-7f20079e85b0`). You can ask NotebookLM questions, and it will answer based on the project's entire knowledge base.
- Always consult NotebookLM for architecture/codebase recall first (if possible), instead of having to re-analyze the codebase each time. This saves tokens and allows us to do more.

- If NotebookLM is not available, use local RAG as fallback.

- You ALWAYS record all important points, decisions, and insights you, and other developers, might need in the future in your memory (agent-memory-MCP)

- Before implementing anything, check the contents of your memory for all related information.

## Knowledge Recall Model

Use the project knowledge sources in this order, depending on the question:

1. `agent_memory` is the primary durable memory layer for precise facts, decisions, runbooks, incidents, commit context, and fresh conclusions from prior work.
2. NotebookLM is the broad architecture/documentation synthesis layer. Use it when a question needs whole-project context, but only after the NotebookLM readiness flow below succeeds.
3. `local_rag` is the local fallback/sidecar for fuzzy recall: semantic search, related-document discovery, and cases where the exact memory title, file name, or subsystem name is unknown.
4. The repository itself is the source of truth for current code. Use `rg`, file reads, and tests to verify behavior before editing.

`local_rag` does not query live `agent_memory` directly. It indexes a file mirror:

- exported durable memory docs under `docs/memory`;
- mirrored Quest root documentation under `docs/projects/Quest`.

Important `local_rag` caveats:

- For `mcp__local_rag__summarize_project_context`, use `context: "Quest"`, not the full Windows path like `D:\GAMES\New folder\Quest`. Earlier misses happened because indexed memory docs use the `Quest` context label.
- Use `mcp__local_rag__semantic_search` when you are unsure what to ask for; it searches across indexed memory and project documentation.
- Use `mcp__local_rag__repo_list` with `path: "docs/projects/Quest"` to confirm the project documentation mirror is visible.
- Fresh `agent_memory` entries may not appear in `local_rag` until the memory export/mirror and RAG index are refreshed. For fresh facts, query `agent_memory` directly first.
- Project documentation is mirrored into `local_rag` by the local startup script at `C:\Users\Professional\.codex\tools\agent-memory-mcp\start-local-rag.ps1`; the mirrored files live at `C:\Users\Professional\.codex\tools\agent-memory-mcp\local-rag-data\docs\projects\Quest`.

## NotebookLM CLI Connectivity Rule

Use NotebookLM through the CLI first. Do not start with the NotebookLM MCP for normal project recall on this machine.

Required readiness flow:

1. Run `python -m notebooklm auth check --json` only as a storage/cookie diagnostic.
2. Run `python -m notebooklm list --json`. This is the real auth check.
3. Run a project notebook smoke test:
   - `python -m notebooklm ask "ping: reply with one short sentence confirming access" --notebook 9f146be7-7c4a-4bb0-b7b4-7f20079e85b0 --json`
4. If `list` and the smoke-test `ask` work, reuse the current CLI auth and do not re-authorize.
5. If a real CLI command returns `Authentication expired or invalid` or redirects to Google sign-in, organize CLI re-auth with the user:
   - start `python -m notebooklm login` in a visible terminal, preferably via:
     `Start-Process powershell -ArgumentList @('-NoExit','-Command','Set-Location -LiteralPath "D:\GAMES\New folder\Quest"; python -m notebooklm login')`
   - ask the user to complete Google login in the opened browser, wait for the NotebookLM homepage, then press Enter in that terminal;
   - re-run `list` and the project smoke-test `ask`.

Important caveats:

- `auth check` can report `status: ok` while the server-side session is expired or revoked. Trust `list`/`ask`, not `auth check` alone.
- Use explicit notebook IDs (`--notebook 9f146be7-7c4a-4bb0-b7b4-7f20079e85b0`) instead of `notebooklm use`, so separate agent sessions do not overwrite shared CLI context.
- MCP may still fail with `browserType.launchPersistentContext: Target page, context or browser has been closed`; treat that as an MCP/Chrome profile launch issue, not as a NotebookLM auth issue. Only troubleshoot MCP if the user explicitly asks for MCP repair.
- If CLI auth is repaired and MCP state must be refreshed later, back up and copy `C:\Users\Professional\.notebooklm\storage_state.json` to `C:\Users\Professional\AppData\Local\notebooklm-mcp\Data\browser_state\state.json`. This does not fix MCP browser launch failures.

## Project Standards

- **What is?**: A 2.5D retro-style adventure game engine, "Scanline Engine" (previously "Quest"), with AI-powered text parser.
- **Tech Stack**: React, Vite, Vanilla CSS.
- **Files**:
  - Use `src/` for source code.
  - `GDD.md` is the source of truth for game design.
- **Workflow**:
  - Consult NotebookLM/RAG/GDD (in order of priority) before implementing gameplay features.
  - Update `GDD.md` if design decisions change during implementation.
  - Once the new functionality has been tested and accepted by the user, commit to memory all the most useful facts obtained during implementation that may be useful to developers in the future.

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
