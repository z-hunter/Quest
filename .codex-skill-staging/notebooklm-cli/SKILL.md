---
name: notebooklm-cli
description: Use when working with NotebookLM through its CLI for tasks such as adding local files or URLs as sources, batch-importing project documentation, checking auth, or managing notebook content more directly than the NotebookLM MCP high-level tools allow.
---

# NotebookLM CLI

Use this skill when the task is better served by the local NotebookLM CLI than by the NotebookLM MCP wrapper, especially for source ingestion.

## When to use

- The user wants to add many files to a notebook.
- The user wants to add local files as sources.
- The MCP tools are too high-level and do not expose a needed low-level source command.
- You need direct commands such as `source add`, `source list`, or `auth check`.

## Preferred commands

Use the module form first on this machine:

```powershell
python -m notebooklm --help
python -m notebooklm list
python -m notebooklm source list
python -m notebooklm source add "./doc-1.md" "./doc-2.md"
python -m notebooklm source add "https://example.com/article"
```

If a notebook must be targeted explicitly, check the CLI help first and then pass the notebook/context flag the installed version expects.

## Workflow

1. Confirm authentication before bulk work.
2. Prefer CLI import over browser automation for local files.
3. For project docs, start with top-level Markdown and other human-authored design docs.
4. Avoid bulk-uploading noisy runtime assets unless the user explicitly wants them.
5. After import, verify source count or source titles.

## Authentication notes

- Use `python -m notebooklm auth check --json` for diagnostics.
- On this Windows machine, avoid rich table output when possible; prefer `--json` because plain `auth check` may hit console encoding issues.
- If auth is missing or expired, use the NotebookLM MCP auth flow or `python -m notebooklm login`.

## Import guidance

For this project, prefer this order:

1. Root-level `*.md` docs
2. Focused architecture references such as parser or autotest docs
3. Only then consider structured JSON specs like `public/text/system/*.json` if the user wants deeper engine knowledge in NotebookLM

## Batch patterns

Top-level Markdown in PowerShell:

```powershell
$files = Get-ChildItem -Path . -File -Filter *.md | Sort-Object Name | ForEach-Object { $_.FullName }
python -m notebooklm source add $files
```

Mixed local files and URLs:

```powershell
python -m notebooklm source add "./transcript-1.md" "https://example.com/article" "./report.pdf"
```

## Guardrails

- Prefer CLI over browser uploads when both are possible.
- Do not assume MCP exposes the same low-level commands as the CLI.
- Keep imports curated: docs first, assets only on purpose.
- Re-check CLI help when subcommand flags are unclear because NotebookLM tooling versions may differ.
