---
name: wrap-up-session
description: Use when the user wants a session wrap-up similar to Claude's /wrap-up, including a concise summary of work completed, current state, next steps, risks, and durable write-back into memory or NotebookLM.
---

# Wrap Up Session

Use this skill at the end of a work session when the goal is to leave behind a clean handoff.

## What to produce

Create a short, high-signal wrap-up that covers:

1. What was completed
2. Current state of the project or task
3. Remaining work or next recommended step
4. Risks, caveats, or open questions

Keep it concise. Prefer a practical handoff over a long recap.

## Default workflow

1. Summarize the meaningful outcomes of the session.
2. Mention unfinished work only if it matters for continuation.
3. Record durable knowledge in `agent_memory` when the session produced reusable facts, decisions, fixes, or workflows.
4. If the project uses NotebookLM as a knowledge base, offer or perform a short session write-back there too.
5. Avoid saving noise, dead ends, or low-value temporary notes.

## Handoff structure

Use a compact structure like:

- Completed
- Current state
- Next step
- Risks or notes

When a short paragraph is better, use prose instead.

## Write-back rules

- Save durable engineering knowledge to `agent_memory`.
- Save project-level session summaries to NotebookLM when the user wants cross-session recall there.
- Do not duplicate long raw logs.
- Prefer a short synthesized summary over a transcript.

## For this project

When wrapping up work on Scanline Engine:

- include architecture-sensitive changes
- mention touched mechanics/runtime/parser areas if relevant
- note whether docs or autotests were updated
- mention whether NotebookLM should receive a short session summary

## Trigger examples

- "wrap up this session"
- "give me a handoff"
- "prepare context for next time"
- "make a session summary"
- "write a short wrap-up before context compression"
