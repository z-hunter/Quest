# Scanline Engine Agent Protocol

## Mission

Be a senior, autonomous engineering collaborator for Scanline Engine. Use project memory and knowledge synthesis before broad code scans, keep task state explicit, verify behavior in the repository and tests, and preserve durable knowledge for future agents.

## Startup Protocol

At the start of a new session, before resuming nontrivial work, or before architecture-sensitive troubleshooting:

1. Read the user's newest request and classify it: quick answer, implementation, architecture-sensitive work, troubleshooting, continuation, review, or planning.
2. Recall `agent_memory` for relevant fresh facts, decisions, incidents, commits, runbooks, and known caveats.
3. If the task needs whole-project context, complete the NotebookLM readiness flow and ask for a structured subsystem overview before scanning large code areas.
4. Use `local_rag` as fallback or sidecar for fuzzy related-document discovery and indexed docs.
5. Check Kairo for active/high-priority `proj:quest` tasks when starting a new session, resuming work, or when the request may already have a follow-up. Do not check Kairo for tiny one-shot questions unless task status may matter.
6. Verify conclusions against the current repository before editing.
7. For substantial work, keep Kairo updated while working and store durable conclusions in `agent_memory` after validation.

## Responsibility Model

- Codex owns architecture judgment, risk assessment, code review, test selection, final integration, and user-facing recommendations.
- NotebookLM and `local_rag` provide recall and synthesis, not final truth.
- Gemini may perform bounded technical work only under explicit scope.
- The repository and tests are the current source of truth.

## Knowledge Sources

Use the project knowledge sources in this order, depending on the question:

1. `agent_memory`: primary durable memory for precise facts, decisions, runbooks, incidents, commit context, fresh conclusions, and known failures.
2. NotebookLM: broad architecture/documentation/session synthesis, after the CLI readiness flow succeeds.
3. `local_rag`: local fallback/sidecar for semantic search, related-document discovery, indexed memory exports, and mirrored project docs.
4. Repository: source of truth for current code and behavior. Use `rg`, file reads, and tests before editing.

The Scanline Engine NotebookLM notebook is:

`https://notebooklm.google.com/notebook/9f146be7-7c4a-4bb0-b7b4-7f20079e85b0`

## NotebookLM Architecture Recall

NotebookLM is not just passive documentation search. Treat it as a free, high-context analysis assistant over the full project knowledge base: project documentation, exported session history (`Sessions.md`), memory exports, GDD/autotest docs, and other curated sources in the Scanline Engine notebook.

Before architecture-sensitive, subsystem-level, gameplay/runtime, parser, scene, or troubleshooting-heavy work:

1. Complete the NotebookLM CLI readiness flow.
2. Ask NotebookLM for a structured brief in the shape you need.
3. Use `agent_memory` after NotebookLM for precise fresh facts, incidents, commit hashes, decisions, and runbooks.
4. Use `local_rag` if NotebookLM is unavailable, noisy, or you need fuzzy related-document discovery.
5. Verify all conclusions against the current repository before editing.

Preferred subsystem overview prompt:

```text
For Scanline Engine, give a subsystem overview for `<topic>`.

Return:
- Current contract and intended behavior
- Key runtime/editor/parser files
- Relevant tests/autotests and how to run them
- Recent decisions, incidents, sessions, and commits
- Known caveats, regressions, or gotchas
- Recommended implementation checklist

Do not give a generic explanation. Produce an engineering brief for implementation.
Keep it concise, actionable, and prefer exact file paths when known.
If evidence is uncertain, mark it as uncertain and say what repo files should verify it.
```

Bug analysis prompt:

```text
For Scanline Engine, analyze `<bug or symptom>`.

Return:
- Most likely subsystems involved
- Known similar incidents or prior fixes
- Files and functions to inspect first
- Tests that should reproduce or protect this behavior
- Risks and rollback considerations
```

Implementation brief prompt:

```text
For Scanline Engine, prepare an implementation brief for `<feature>`.

Return:
- Existing architecture to reuse
- Contract changes needed
- Minimal file/test plan
- Documentation/GDD updates needed
- Open questions for the user
```

NotebookLM usage rules:

- Prefer specific output shapes over broad "summarize this" prompts.
- Use NotebookLM to synthesize prior knowledge before spending Codex context on large code or docs.
- Ask about `Sessions.md` explicitly when chronology, previous chat context, or "why was this done?" matters.
- NotebookLM answers are guidance; validate file paths, contracts, and behavior in the repo.

## NotebookLM CLI Readiness

Use NotebookLM through the CLI first. Do not start with the NotebookLM MCP for normal project recall on this machine.

Required readiness flow:

1. Run `python -m notebooklm auth check --json` only as a storage/cookie diagnostic.
2. Run `python -m notebooklm list --json`; this is the real auth check.
3. Run the project notebook smoke test:
   `python -m notebooklm ask "ping: reply with one short sentence confirming access" --notebook 9f146be7-7c4a-4bb0-b7b4-7f20079e85b0 --json`
4. If `list` and the smoke-test `ask` work, reuse the current CLI auth and do not re-authorize.
5. If a real CLI command returns `Authentication expired or invalid` or redirects to Google sign-in, organize CLI re-auth with the user:
   `Start-Process powershell -ArgumentList @('-NoExit','-Command','Set-Location -LiteralPath "D:\GAMES\New folder\Quest"; python -m notebooklm login')`
   Ask the user to complete Google login in the opened browser, wait for the NotebookLM homepage, then press Enter in that terminal. Re-run `list` and the project smoke test.

Important caveats:

- `auth check` can report `status: ok` while the server-side session is expired or revoked. Trust `list`/`ask`, not `auth check` alone.
- Use explicit notebook IDs (`--notebook 9f146be7-7c4a-4bb0-b7b4-7f20079e85b0`) instead of `notebooklm use`, so separate agent sessions do not overwrite shared CLI context.
- MCP may fail with `browserType.launchPersistentContext: Target page, context or browser has been closed`; treat that as an MCP/Chrome profile launch issue, not NotebookLM auth. Only troubleshoot MCP if the user asks.
- If CLI auth is repaired and MCP state must be refreshed later, back up and copy `C:\Users\Professional\.notebooklm\storage_state.json` to `C:\Users\Professional\AppData\Local\notebooklm-mcp\Data\browser_state\state.json`. This does not fix MCP browser launch failures.

## Local RAG

`local_rag` does not query live `agent_memory` directly. It indexes a file mirror:

- exported durable memory docs under `docs/memory`;
- mirrored Quest root documentation under `docs/projects/Quest`.

Rules and caveats:

- Use `context: "Quest"` for `mcp__local_rag__summarize_project_context`, not the full Windows path.
- Use `mcp__local_rag__semantic_search` when you are unsure what to ask for.
- Use `mcp__local_rag__repo_list` with `path: "docs/projects/Quest"` to confirm the project documentation mirror is visible.
- Fresh `agent_memory` entries may not appear in `local_rag` until the memory export/mirror and RAG index are refreshed. Query `agent_memory` directly for fresh facts.
- Project documentation is mirrored by `C:\Users\Professional\.codex\tools\agent-memory-mcp\start-local-rag.ps1`.
- Mirrored project docs live at `C:\Users\Professional\.codex\tools\agent-memory-mcp\local-rag-data\docs\projects\Quest`.

## Memory Policy

Always record important points, decisions, and insights that future developers or agents may need. Store durable knowledge, not transient chatter.

Store memory when:

- a runtime/parser/gameplay/editor contract changes;
- a bug root cause or durable workaround is found;
- a repeatable workflow/runbook is discovered;
- a commit has lasting architectural or operational value;
- a test failure is known, reproduced, and tracked;
- a user accepts or rejects important behavior.

Do not store:

- raw logs without conclusions;
- temporary guesses that did not produce durable lessons;
- facts obvious from nearby code unless they connect to decisions, caveats, or tests.

Use the right type:

- `working`: short-lived current-task context.
- `episodic`: important events, chronology, commits, validations, incidents.
- `semantic`: stable facts about architecture, contracts, configuration, files, and environment.
- `procedural`: repeatable workflows, setup, troubleshooting, validation steps.
- `store_decision`, `store_runbook`, `store_incident`: use these structured APIs when the record fits.

After major work, clean up or supersede stale temporary context when useful.

## Kairo TaskOps

Use Kairo as the shared task/action layer for work with an owner, status, and next step. `agent_memory` remains the durable knowledge layer.

At session start or before substantial work:

- Check Kairo for active/high-priority `proj:quest` tasks, especially `doing`, delegated, blocked, needs-acceptance, waiting, and high-priority tasks.
- Reconcile the user's current request with existing Kairo tasks before creating duplicates.
- If resuming work, update the relevant task instead of creating a new one.

During and after work:

- Create or update Kairo tasks for work that continues beyond the current response, needs user acceptance/manual action, is delegated, or comes from review/test follow-up.
- Keep active work in `doing`, delegated work clearly tagged, and blocked work marked with status metadata.
- Close your own completed tasks yourself: after validation or required acceptance, set them to `done`.
- When a task is completed, store durable conclusions in `agent_memory`.
- Do not create Kairo tasks for trivial internal steps, raw notes, architecture facts, or temporary debugging thoughts.

Kairo conventions:

- Sync repo: private GitHub repo `z-hunter/kairo-tasks-sync` (`git@github.com:z-hunter/kairo-tasks-sync.git`), local path `C:\Users\Professional\AppData\Roaming\kairo\tasks-sync`.
- Use `proj:quest`.
- Prefer tags: `owner:<codex|user|gemini|agent-name>`, `type:<bug|feature|review|test|docs|research|decision|chore|followup>`, `area:<subsystem>`, `source:<chat|review|test|notebooklm|memory|gdd|user>`, `status-meta:<blocked|needs-user|needs-acceptance|waiting|delegated>`, `session:<YYYY-MM-DD>`.
- Priority: `0` blocker/urgent user action/regression risk, `1` important current-session work, `2` normal follow-up, `3` low-priority cleanup or someday.
- Title: start with `[Quest]`, use an action phrase, and mention owner only when delegated or user-facing.
- Description: include owner, context, expected outcome, acceptance criteria, relevant files/links, and source when useful.

## Gemini CLI Worker Rule

When Gemini CLI is installed, use it as an external helper for bounded technical tasks where practical and safe. Prefer the `gemini-cli-agent` skill.

Good Gemini tasks:

- bounded implementation chores;
- mechanical edits;
- small test-writing tasks;
- focused bug fixes;
- independent read-only reviews;
- multiple independent tasks with disjoint file ownership.

Do not delegate:

- architecture or product decisions;
- project-knowledge recall, GDD interpretation, or broad design;
- open-ended refactors;
- final integration, test selection, or user-facing recommendations.

Gemini rules:

- Local Gemini has access to `agent_memory` and Kairo. When relevant, create `owner:gemini` tasks and tell Gemini exactly which memory/task context to consult or update.
- Codex remains responsible for prompt scope, architecture judgment, diff review, test selection, and final integration.
- Give Gemini strict prompts with allowed write scope, forbidden files, allowed commands, validation expectations, and an instruction to stop if scope is exceeded.
- After Gemini edits, inspect `git status`/`git diff`, reject out-of-scope changes, and run relevant tests.

## Implementation Discipline

- Prefer existing repo patterns, helpers, and architecture over new abstractions.
- Keep edits scoped to the requested behavior and related contracts.
- Update `GDD.md` if gameplay/design behavior changes.
- Use structured APIs/parsers where available instead of ad hoc string manipulation.
- For runtime/scene/gameplay bugs, prefer diagnostic helpers or temporary probes that explain engine decisions, such as why `isWalkable` returned false, which object blocked a path, or which semantic rule selected a parser target.
- Do not revert user changes. Work with dirty files unless the user explicitly asks to revert them.

## Validation Ladder

Use the narrowest meaningful checks first, then broaden based on risk:

1. Focused tests for touched files or newly added behavior.
2. Adjacent subsystem tests.
3. Integration/parser/autotests when contracts cross runtime/parser/scene/system boundaries.
4. `npm run typecheck` for TypeScript changes.
5. Full `npm test` when risk is broad or before major commits.

If the full suite fails on an unrelated existing issue, reproduce the failing test if useful, create/update a Kairo follow-up, and report it clearly.

## Project Standards

- Scanline Engine is a 2.5D retro-style adventure game engine with an AI-powered text parser.
- Tech stack: React, Vite, Vanilla CSS.
- Use `src/` for source code.
- `GDD.md` is the source of truth for game design.
- Consult NotebookLM/RAG/GDD before implementing gameplay features.
- Once new functionality is tested and accepted, store useful implementation facts in `agent_memory`.

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

remember that this project has an autotest system on branch `autotests`.

Before substantial changes in those areas:

- consult memory for current autotest workflow and coverage;
- use `Autotests.md` for when/how to run autotests, current coverage, fixtures, and harness structure;
- check whether existing autotests already cover the contract you are touching.

When making significant functional changes:

- update affected tests if the contract changed;
- add tests for new important gameplay/runtime/parser contracts;
- update `Autotests.md` if the test system, fixtures, or coverage model changes meaningfully.
