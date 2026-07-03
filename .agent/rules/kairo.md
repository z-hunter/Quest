---
trigger: always_on
---

## Kairo TaskOps Skill

Use Kairo CLI for task tracking and status reconciliation in the Scanline Engine project.

### Core Workflow

1. **Check Context**: At the start of a session, run `kairo api list --proj quest` to understand the current backlog and active tasks.
2. **Reconcile**: If the user's request matches an existing task, update its status to `doing` using `kairo api update --id <id> --status doing`.
3. **Track Progress**: For tasks that span multiple turns, keep the description updated with key findings.
4. **Wrap-up**: When a task is finished, mark it as `done` and store any durable knowledge (decisions, runbooks, incidents) in `agent_memory`.

### CLI Command Reference

- **List Project Tasks**:
  `kairo api list --proj quest` (filters tasks carrying the `proj:quest` tag)
- **Create New Task**:
  `kairo api create --title "[Quest] <action phrase>" --description "Owner: <codex|user|gemini>\nContext: <details>\nExpected outcome: <outcome>" --tag "proj:quest" --tag "owner:codex" --tag "type:<bug|feature|chore|research>" --priority <0-3>`
- **Update Task Status**:
  `kairo api update --id <id> --status <todo|doing|done|blocked>`
- **Mark as Done**:
  `kairo api update --id <id> --status done`

### Standard Tagging Taxonomy

- `proj:quest`: Mandatory for all project-related tasks.
- `owner:<codex|gemini|antigravity|user>`: Who is responsible for the task.
- `type:<bug|feature|research|docs|chore|test|decision|review|followup>`: Category of work.
- `area:<parser|scene|systems|ui|core|infra|movement|pathfinding|gdd|llm>`: Specific subsystem.
- `source:<chat|review|test|notebooklm|memory|gdd|user>`: Where the task originated.
- `status-meta:<blocked|needs-user|needs-acceptance|waiting|delegated>`: Additional status metadata.
- `session:<YYYY-MM-DD>`: The session date when the task was created or updated.

### Integration with agent_memory

- Kairo is for **tasks** (the "what" and "status").
- `agent_memory` is for **durable knowledge** (the "how", "why", and "what was learned").
- Always cross-reference: mention the Kairo task ID in memory entries and commit messages when relevant.
