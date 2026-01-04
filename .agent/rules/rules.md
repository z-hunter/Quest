---
trigger: always_on
---

## Memory & Context
1. **Always Check Context**: At the start of a session or when switching contexts, READ [.agent/context.md](cci:7://file:///c:/Users/Michael/Documents/Quest/.agent/context.md:0:0-0:0) to understand the project architecture and current state.
2. **Check Current Task**: READ [.agent/current_task.md](cci:7://file:///c:/Users/Michael/Documents/Quest/.agent/current_task.md:0:0-0:0) to see active tasks, progress, and TODOs.
3. **Update Memory**: When you complete a task or change a major architectural component, YOU MUST UPDATE [.agent/current_task.md](cci:7://file:///c:/Users/Michael/Documents/Quest/.agent/current_task.md:0:0-0:0) or [.agent/context.md](cci:7://file:///c:/Users/Michael/Documents/Quest/.agent/context.md:0:0-0:0) to reflect the new state. Do not rely on chat history alone.
## Project Standards
- **Tech Stack**: React, Vite, Vanilla CSS (Retro style).
- **Files**: 
  - Use `src/` for source code.
  - `GDD.md` is the source of truth for game design.
- **Workflow**: 
  - Consult `GDD.md` before implementing gameplay features.
  - Update `GDD.md` if design decisions change during implementation.








