---
trigger: always_on
---

## Memory & Context
1. **Always Check Context**: At the start of a session or when switching contexts, READ `.agent/context.md` to understand the project architecture and current state.
2. **Check Current Task**: READ `.agent/current_task.md` to see active tasks, progress, and TODOs.
3. **Update Memory**: When you complete a task or change a major architectural component, YOU MUST UPDATE `.agent/current_task.md` or `.agent/context.md` to reflect the new state. Do not rely on chat history alone.

## Project Standards
- **Tech Stack**: React, Vite, Vanilla CSS (Retro style).
- **Files**: 
  - Use `src/` for source code.
  - `GDD.md` is the source of truth for game design.
- **Workflow**: 
  - Consult `GDD.md` before implementing gameplay features.
  - Update `GDD.md` if design decisions change during implementation.
