---
trigger: always_on
---

## Wrap-up Protocol

When the user requests a `wrap-up` or `wrap-up-session`:

1.  **Summarize the Session**: Create a comprehensive summary of the current session, including:
    -   **Session Goal**: What was the primary objective?
    -   **What Was Implemented**: Detailed list of features, fixes, and changes.
    -   **Architecture/Runtime Decisions**: Any key decisions made and their rationale.
    -   **Parser/Mechanics/Scene Changes**: Specific updates to core subsystems.
    -   **Tests Run**: Outcomes of `npm test`, `npx vitest`, or specific manual checks.
    -   **Commits Created**: List hashes and messages of commits made during the session.
    -   **Current State**: Summary of the project status at the end of the session.
    -   **Remaining Work / Next Steps**: Actionable tasks for the next session.
    -   **Risks / Caveats**: Any known issues, technical debt, or open questions.
2.  **Update `Sessions.md`**: Append the summary to the end of `Sessions.md` in the project root, using the established `## Session Entry - YYYY-MM-DD HH:mm [Timezone]` format.
3.  **Persist Knowledge**:
    -   Store high-value, durable knowledge in `agent_memory` (facts, decisions, runbooks).
    -   Update `.agent/context.md` and `.agent/current_task.md` to reflect the new state.
4.  **Kairo Cleanup**: Close completed tasks in Kairo and create follow-up tasks for the `Remaining Work`.
5.  **Final Report**: Provide the user with a brief confirmation that the wrap-up is complete and point them to the updated `Sessions.md`.
