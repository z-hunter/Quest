# Scanline Engine - Editor UI/UX Rework Spec

## 1. Objective
Refactor the React-based Editor UI (`src/components/editor/*`) to adopt a unified "Tech Utility / Brutalist" aesthetic across both the left Hierarchy Panel and the right Properties Panel. The goal is to eliminate visual noise, reduce eye strain during prolonged use, and drastically speed up level design through tactile input mechanics, consistent layouts, and hotkeys.

## 2. Assets & References
Interactive mockups and visual previews have been generated to serve as the exact CSS/HTML blueprint for the refactor. 

**Local HTML Mockups:**
- `C:\Users\Professional\Desktop\hierarchy_panel_mockup.html` (Complete spec for the left Hierarchy Panel)
- `C:\Users\Professional\Desktop\four_panels_mockup.html` (Complete side-by-side spec for Scene, Actor, Quad, and Triggerbox properties)
- `C:\Users\Professional\Desktop\real_actor_mockup.html` (Detailed Actor panel spec with Custom Dropdown logic)

**Visual Previews:**
- `C:\Users\Professional\.gemini\tmp\professional\quest_mockup_hierarchy_preview.png`
- `C:\Users\Professional\.gemini\tmp\professional\quest_mockup_four_panels_exact.png`
- `C:\Users\Professional\.gemini\tmp\professional\quest_mockup_dropdown_icons_preview.png`

## 3. Design Paradigm (Tech Utility)
- **Color Palette Overrides:** 
  - Change base panel backgrounds from pure black (`#000`) to a softer dark green (`#050a07`) to reduce the halo effect of the CRT phosphor text.
  - Section headers must use distinct colors based on their numeric ID:
    - `0` (Identity): `#7dd3fc` (Light Blue)
    - `1` (Transform): `#3b82f6` (Blue)
    - `2` (Visual/Scaling): `#fde047` (Yellow)
    - `3` (Components/3D Sound): `#fca5a5` (Red/Coral)
    - `4` (Actor Props): `#60a5fa` (Blue)
    - `5` (Script Events): `#c4b5fd` (Purple)
    - `6` (Misc): `#9ca3af` (Gray)
- **Typography:**
  - Headers and UI elements: `var(--ui-display-font)` (`Space Grotesk`).
  - Inputs and Data: `var(--ui-mono-font)` (`Courier New` / `monospace`).
  - *Constraint:* Ensure `<select>` and `<input>` elements explicitly inherit `--ui-mono-font` to override browser defaults (e.g., Arial).

## 4. Core Mechanics to Implement

### A. Hierarchy Panel Restyling
- **Toolbar:** Flatten the toolbar into a brutalist row with square, minimal icon buttons. Replace default select boxes with the custom dropdown logic.
- **Tree Rows (`.hierarchy-row`):** 
  - Integrate specific colors for SVG icons based on object type (Scene=Blue, Folder=Yellow, Quad=Blue, Actor/NPC=White, Triggerbox=Red, Walkbox=Purple).
  - Add explicit hover states (`var(--ui-panel-header-bg)`) and selected states (bright green background, black text).
  - Align "Focus Camera" and "Drag Handle" buttons to the far right, revealing them cleanly on hover.

### B. Accordion Sections (Properties)
Replace the static `properties-section-block` layout with an accordion model.
- By default, only section `0` (Identity) and `1` (Transform) should be expanded.
- Clicking the `.section-header` toggles a `.collapsed` class on the parent wrapper, hiding `.section-body`.

### C. Scrubbable Inputs (Properties)
Replace manual number typing with "mouse scrubbing".
- Number labels (e.g., `X ↔`, `Scale`) become interactive (`cursor: ew-resize`).
- On `mousedown` + `mousemove`, calculate the delta X and apply it to the corresponding `NumberDraftInput` or numeric state.

### D. Numeric Hotkey Navigation
Enable lightning-fast keyboard navigation.
- If the user is NOT actively typing in an input (`document.activeElement.tagName !== 'INPUT'`), pressing `1`-`6` should:
  1. Open the corresponding properties section.
  2. Smooth scroll the panel so the section header is visible.

### E. Custom Dropdowns & Icon Masks
Standard `<select>` elements break the brutalist immersion.
- Replace them with a custom HTML structure (`.custom-select-container`).
- For the `+ ADD` Component dropdown, use the exact SVG data-URIs via the `mask-image` CSS property to render icons (Actor, Shadow, Inventory) that inherit the `currentColor` of the text.

## 5. Execution Plan for Coding Agent
When assigned to implement this, follow these steps:
1. **CSS First:** Extract the new CSS rules from the `<style>` blocks in `hierarchy_panel_mockup.html` and `four_panels_mockup.html`. Merge them into `src/index.css` and `src/editor.css`.
2. **Hierarchy Refactor:** Update `src/components/editor/HierarchyPanel.tsx` to use the new `.hierarchy-row` markup, SVG mask icons, and toolbar styling.
3. **Utils Refactor (Properties):** Modify `src/components/editor/properties/propertiesUtils.tsx` (`renderSection`) to support the new markup structure (collapsible states, hotkey badges, colored headers).
4. **Scrubber Hook:** Create a new React Hook `useScrubbable(value, step, onChange)` and apply it to the `e-label` spans next to numeric inputs.
5. **Component Updates:** Systematically go through `ActorProperties.tsx`, `SceneProperties.tsx`, `QuadProperties.tsx`, and `TriggerboxProperties.tsx` and refactor the form rows to match the grid layouts defined in the mockup.