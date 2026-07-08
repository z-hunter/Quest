# Scanline Engine вЂ” Technical Specification

> **Last audited**: 2026-07-07. Reflects current `src/` directory structure and implemented subsystems.

---

## 1. Architecture Overview

The Scanline Engine is a 2.5D retro-style adventure game engine built on a modern web stack. It emulates the aesthetics of early Sierra / LucasArts games while supporting complex semantic gameplay, AI-driven NPC behaviour, and an integrated visual editor.

### 1.1 Core Stack

| Layer | Technology |
|-------|-----------|
| Framework | **React 19 + Vite 7** |
| Language | **TypeScript ~5.9** |
| Rendering | HTML5 Canvas (game) + React DOM (editor UI) |
| State вЂ” Engine | Direct mutation of `Game` singleton + domain-specific service singletons |
| State вЂ” UI | Local React state + **Zustand 5** for ephemeral editor state |
| Styling | Vanilla CSS (no Tailwind) |
| Local ML Inference | **onnxruntime-web 1.27** (WASM backend) |
| NLP helpers | **@nlpjs** (noun phrase extraction, language detection) |
| Build output | Vite SPA в†’ `/dist`; optional Tauri native shell |
| Tests | **Vitest 4** |

### 1.2 Design Patterns

- **Domain Service Decomposition**: Core logic extracted from the `Game` monolith into dedicated services (`GameSemanticAPI`, `InventoryManager`, `ActorNavigationService`, `ComponentSystem`, `StateEventSystem`, `SoundManager`, etc.).
- **IGame Interface**: All runtime services depend on `src/core/IGame.ts`, not the concrete `Game` class, enabling isolated unit testing without a full engine context.
- **Semantic-Driven World Model**: The game world's behaviour is driven by Text Assets (TA) вЂ” external `.json` files that define descriptions, synonyms, tags, relation facts, authored commands, and failure messages. Engine code is decoupled from authored text.
- **Facade Pattern**: `SceneEditor` / `vetool.tsx` acts as a central editor facade, delegating operations to specialized managers.
- **Descriptive Renderer**: `SceneRenderer` is a stateless function that receives `Scene + Context`, fully decoupling rendering from state.
- **Platform Adapter**: `src/platform/fileApi.ts` transparently routes file I/O to either the Vite dev middleware or Tauri's native Rust commands.

---

## 2. Source Map (`src/`)

For new developers or AI agents вЂ” functional map of the `src/` directory:

### `src/core/` вЂ” Engine Core

| File | Role |
|------|------|
| `Game.ts` | Central game loop, systems wiring, global state holder |
| `IGame.ts` | Interface contract consumed by all services (enables testability) |
| `Console.ts` | In-game text console UI and message queue |
| `TextAssetManager.ts` | Loads and caches `.json` text assets; drives TA-Driven world model |
| `ScriptAPI.ts` | Public scripting surface for authored event scripts |
| `ScriptRegistry.ts` | Registers and invokes authored game scripts |
| `AssetLoader.ts` | Image, audio, and scene asset loading pipeline |
| `AudioManager.ts` | High-level audio manager facade |
| `Input.ts` | Keyboard, mouse, pointer input abstraction |

### `src/mechanics/` вЂ” Parser, LLM, NPC

| File / Dir | Role |
|------------|------|
| `Parser.ts` | Stage-1 deterministic text parser; rule-based verb + NLP cascade |
| `NlpCascade.ts` | NLP.js integration (noun phrase extraction, synonym matching) |
| `LlmCascade.ts` | Stage-2 LLM Game Master cascade (parser fallback, post-API recovery) |
| `ParserWorldModelBuilder.ts` | Builds the semantic world model snapshot for the LLM parser prompt |
| `NpcPuppetMaster.ts` | Autonomous NPC planning system (batch + individual wake triggers, multi-step plans, strategy, hybrid SLM routing) |
| `NpcWorldModelBuilder.ts` | Builds `NpcWorldModel` / `NpcActorContext` for each NPC |
| `ActorPlanExecutor.ts` | Executes typed `NpcPlanStep[]` (MOVE_TO, TAKE, PUT, COMMAND, SAY, вЂ¦) |
| `ActorCommandExecutor.ts` | Runs authored commands defined in Text Assets |
| `parserTypes.ts` | Parser DSL type definitions |
| `npcTypes.ts` | NPC plan, world model, and trigger type definitions |
| `llm/ILlmProvider.ts` | LLM provider abstraction interface |
| `llm/AnthropicProvider.ts` | Claude API via `/api/llm` proxy |
| `llm/OllamaProvider.ts` | Local Ollama OpenAI-compatible endpoint |
| `slm/` | **Hybrid SLM subsystem** вЂ” see В§4.3 and `docs/npc-pm-slm.md` |

### `src/systems/` вЂ” Gameplay Services

| File | Role |
|------|------|
| `GameSemanticAPI.ts` | Actor-aware semantic verbs: `look`, `examine`, `take`, `put`, `open`, `close`, `use` |
| `InventoryManager.ts` | Player + NPC inventory, container logic, spatial rules |
| `ActorNavigationService.ts` | A* approach planning, reachability checks, teleport plans |
| `ActorWorldQuery.ts` | Read-only spatial queries used by NPC and parser world models |
| `ComponentSystem.ts` | Component lifecycle: State, Switch, Subscene, InventoryContainer, Exit |
| `StateEventSystem.ts` | Type-safe state mutation + script dispatch on state change |
| `SoundManager.ts` | Spatial audio pipeline (Web Audio API, reverb, proximity EQ) |
| `ShadowSystem.ts` | Actor shadow depth-scaling and shape caching |
| `ThreeDParallaxSystem.ts` | 2.5D в†’ 3D coordinate mapping for audio spatialization |
| `BackfaceSystem.ts` | Sprite backface flipping for directional actors |

### `src/scene/` вЂ” Scene & Spatial Hierarchy

| File | Role |
|------|------|
| `Scene.ts` | Main scene data structure; `isWalkable` вЂ” the single collision oracle |
| `SceneManager.ts` | Scene transitions, cross-scene continuations, active scene lifecycle |
| `SceneInteraction.ts` | Interaction distance checks and entity picking |
| `SceneSpatialValidator.ts` | Topology enforcement (no recursive containment, relation rules) |
| `SceneLog.ts` | Per-scene event log (speech + action entries); NPC read cursor per actor |
| `SceneTextLayer.ts` | Subscene hierarchy resolution and text layer access |
| `SceneCamera.ts` | Camera position and viewport math |
| `SceneSubscene.ts` | Subscene open/close lifecycle |

### `src/entities/` вЂ” Visual Objects

| File | Role |
|------|------|
| `Entity.ts` | Base class: Transform, Visuals, Parallax, serialization |
| `Actor.ts` | `Entity` + pathfinding (`moveTo`), animation sets, directional sprites |
| `QuadObject.ts` | Perspective polygon objects (walls, floors) with per-vertex parallax |
| `Walkbox.ts` | Walkable floor area polygon |
| `Triggerbox.ts` | Script-triggering overlap zone |
| `Folder.ts` | Logical grouping entity |

### `src/platform/` вЂ” Platform Abstraction

| File | Role |
|------|------|
| `fileApi.ts` | Unified file I/O: routes to Vite dev middleware or Tauri Rust commands; `FileEventEmitter` + `useFileWatcher` hook for live reload |

### `src/editor/`, `src/components/`, `vetool.tsx` вЂ” Editor UI

React-based visual editor: scene tree (HierarchyPanel), properties inspector (PropertiesPanel), sprite sheet editor, walkbox/triggerbox painting tools.

### `src/platform/` вЂ” Platform Abstraction

`fileApi.ts` transparently routes to:
- **Vite dev mode**: Express middleware (`/api/*` endpoints in `vite.config.ts`)
- **Node.js tests**: native `fs` module (bypass fetch)
- **Tauri production**: native Rust IPC commands

---

## 3. Engine Systems

### 3.1 Navigation & Pathfinding

Actor movement (`Actor.moveTo`) uses **A\* grid pathfinding** via `ActorNavigationService`.

- **Single Collision Oracle**: `Scene.isWalkable(x, y)` вЂ” the only source of truth for walkbox and obstacle checks.
- **Approach Planning**: `planApproach(actor, target)` returns `already_reachable | route_available | unreachable` before committing movement.
- **Teleport Plans**: `planLocalTeleport` finds the nearest scene Exit and pre-plans a two-leg route (approach в†’ traverse) for cross-scene NPC movement.
- **Failure Reporting**: Impossible destinations are reported immediately; mid-route blockage is detected and reported as `route_invalidated`.

### 3.2 Rendering Pipeline

`SceneRenderer.ts` (stateless function):

1. **Parallax Layers Setup** вЂ” depth scale contexts
2. **Entity Sort** вЂ” by Layer, then Visual Y (screen-space depth)
3. **Render Pass** вЂ” Normal Layer в†’ Subscene Layer в†’ CRT shader post-processing
4. **Debug Overlays** вЂ” Walkboxes, Triggerboxes, selection handles, NPC debug info

### 3.3 Parallax & Coordinate System (2.5D)

Objects share World Coordinates (X, Y) but render at different screen positions based on their Parallax Factor (`p`) and Camera Position:

```
VisualPos = RawPos - Camera Г— (P - 1)
```

Interaction alignment and snapping are calculated in **Visual Space** (Screen Space) for WYSIWYG editing.

### 3.4 Component System

`ComponentSystem` manages typed components attached to scene objects:

| Component | Purpose |
|-----------|---------|
| `State` | Named state slot (string, number, boolean) with typed initial/current value |
| `Switch` | Toggleable state machine; supports key requirements and locking |
| `Subscene` | Modal close-up view with its own entity hierarchy |
| `InventoryContainer` | Capacity, spatial relation rules, access control for item storage |
| `Exit` | Scene transition trigger; used by `TRAVERSE_EXIT` NPC steps |
| `TriggerBox` | Script-executing overlap zone |
| `NPC` | NPC metadata, objectives, memory, and history |

### 3.5 State Event System

`StateEventSystem.setState(game, entity, stateId, value, source)` provides:
- **Type-safe mutation** вЂ” validates value type against `State` component's `valueType`.
- **Script dispatch** вЂ” automatically fires authored scripts attached to state transitions.
- **Source tracking** вЂ” `source: 'parser' | 'script-api' | 'llm' | 'custom-command'` for diagnostics.

### 3.6 Scene Log

`SceneLog` is the engine's shared event bus for NPC awareness:

- Records `speech` and `action` entries with `knownByActorIds` visibility.
- Maintains per-NPC read cursors (`lastPmProcessedAtByNpc`) so each NPC independently processes unread events.
- Entries expire after `SCENE_LOG_RETENTION_MS` (10 minutes).

### 3.7 Shadow System

`ShadowSystem` manages `Actor` drop shadows:

- **Shape Caching**: Captures the "Base Visual Shape" on assignment вЂ” prevents Parallax Drift (skewing) while maintaining authored shapes.
- Handles depth scaling and floor slope distortion.

### 3.8 3D Spatial Audio

Built on the Web Audio API, mapping 2.5D parallax to 3D coordinates:

- **Coordinate Mapping**: Parallax 1.1 = Z=0 (listener plane); higher parallax в†’ behind listener (+Z).
- **Proximity EQ**: Dynamic peaking filter (+6 dB at 250 Hz) within 100 px radius.
- **Convolution Reverb**: Scene-default IR; dynamic graph rebuild during IR hot-swap; distance-based dry/wet mix.
- **Gain Staging**: `REVERB_WET_OUTPUT_GAIN` trim + 120 ms fade-in on attachment.

---

## 4. Gameplay & AI Systems

### 4.1 Text Parser вЂ” Stage 1 (Deterministic)

`Parser.ts` is the primary player input processor:

- **Rule-based verb cascade**: Exact match в†’ NLP synonym в†’ multi-verb compound detection.
- **NLP.js integration** (`NlpCascade.ts`): Noun phrase extraction, stemming, and language-aware lemmatization for robust input parsing on standard CPU hardware.
- **Semantic World Model**: `ParserWorldModelBuilder` constructs a JSON snapshot of the current scene (takable items, openable containers, known entities, relation facts from Text Assets) and passes it to the LLM cascade.
- **Authored Commands**: Text Assets define `parserCommands` вЂ” structured command definitions with `requires`, `effects`, and `plan` steps that directly execute engine actions.

### 4.2 LLM Cascade вЂ” Stage 2 (AI Game Master)

`LlmCascade.ts` activates when Stage 1 cannot handle the input:

- **Parser GM Prompt**: Constructed from static prefix (cached, sent with `cache_control`) + dynamic player context.
- **Post-API Recovery**: On recoverable parser failures (e.g., `cannot_take`, `not_takeable`), the LLM can retry with a corrected plan, return atmospheric text, or explicitly fall back to the original parser response.
- **Provider switching**: Seamless toggle between `AnthropicProvider` (Claude) and `OllamaProvider` (local Ollama).

#### LLM Providers

| Provider | Class | Endpoint | Typical use |
|----------|-------|----------|------------|
| **Anthropic Claude** | `AnthropicProvider` | `/api/llm` proxy | Cloud / dev with API key |
| **Ollama (local)** | `OllamaProvider` | `http://localhost:11434/v1/...` | Offline play on CPU hardware |

**OllamaProvider optimizations** (CPU-targeted):
- Grammar-constrained JSON mode (`response_format: { type: 'json_object' }`)
- `num_ctx: 4096` вЂ” minimizes KV-cache memory pressure
- `keep_alive: -1` вЂ” model permanently loaded in RAM
- 600 s request timeout for cold prefill
- Recommended model: `qwen2.5:3b`

### 4.3 NPC Puppet Master

`NpcPuppetMaster.ts` drives fully autonomous NPC behaviour:

- **World Model**: `NpcWorldModelBuilder` builds a per-NPC context: position, visible entities (with interaction flags, approach status, switch state, commands), inventory, scene events (unread delta + recent history), known entities, action history, objectives, memory.
- **Scene Log Integration**: NPCs wake on unread `SceneLog` entries. Each NPC tracks its own cursor; `markProcessed` advances it after plan generation.
- **Plan DSL**: Typed `NpcPlanStep[]` covering `SAY`, `MOVE_TO`, `TRAVERSE_EXIT`, `LOOK`, `EXAMINE`, `OPEN`, `CLOSE`, `TAKE`, `PUT`, `COMMAND`, `USE`, `WAIT`, `THINK_STRATEGY`, `MEMORY_SET`, `OBJECTIVES_SET`.
- **Multi-step Plans with `interruptOn`**: Plans execute step-by-step; conditions `ITEM_FOUND`, `WORLD_CHANGED`, `STATE_CHANGED`, `ACTION_FAILED` can abort the chain.
- **Continuation System**: Asynchronous steps (MOVE_TO, WAIT) schedule wakeups; NPC resumes with `move_completed` / `action_completed` / `wait_elapsed` triggers.
- **Strategy Pass** (`THINK_STRATEGY`): Scheduled internal reflection that rewrites memory and objectives without producing speech or physical actions. Rate-limited to prevent premature triggering.
- **Rate Limiting**: Per-NPC and per-scene call budgets; player speech always bypasses autonomous rate limits.
- **Loop Watchdog**: Detects `repeated_without_progress` and `pattern_without_progress` loops; applies escalating sleep penalties.
- **Batch Processing**: NPCs waking within 50 ms are batched into a single LLM request.
- **Hybrid SLM Router**: If `SlmInferenceEngine.isReady()`, routine plans are served in < 5 ms locally. See В§4.4 and `docs/npc-pm-slm.md`.

### 4.4 Hybrid SLM вЂ” Offline NPC Inference

Located in `src/mechanics/slm/`:

| Module | Role |
|--------|------|
| `ShadowLogger.ts` | Captures Gold Standard dataset (successful LLM plans в†’ `logs/slm_shadow_dataset.jsonl`) |
| `SlmVocabulary.ts` | Static integer token vocabulary (actions, flags, special tokens; dynamic entities в‰Ґ 100) |
| `SlmInputAdapter.ts` | Encodes `NpcActorContext` в†’ `Int32Array` token sequence for ONNX inference |
| `SlmOutputAdapter.ts` | Decodes ONNX output tokens в†’ `NpcPlan[]`; escalates to LLM on structural failures |
| `SlmInferenceEngine.ts` | Singleton ONNX session manager; lazy model load; `isReady()` / `setEnabled()` / `infer()` |

**Status**: Phase 1вЂ“3 complete (infrastructure, adapters, hybrid router). Model (`slm_routine_v1.onnx`) requires training before activation. System gracefully escalates all requests to LLM when model is absent.

Full reference: [`docs/npc-pm-slm.md`](docs/npc-pm-slm.md)

### 4.5 Text Asset System (TA-Driven Model)

`TextAssetManager` loads external `.json` files from `public/text/` that define:

- Object titles, descriptions, synonyms, and failure messages
- `semanticTags` and `relationFacts` for LLM world model enrichment
- `parserCommands` вЂ” authored command definitions with `requires`, `effects`, and step plans
- NPC `objectives` and character lore
- Scene-level event scripts

Decouples authored text from engine code. Supports hot-reload in dev and Tauri environments.

### 4.6 Spatial Model & Semantic API

- **`GameSemanticAPI`**: Handles gameplay outcomes of actor-aware semantic actions (`lookEntityForActor`, `examineEntityForActor`, `takeEntityForActor`, `putEntityForActor`, `openEntityForActor`, `closeEntityForActor`). Manages reveal mechanics, access states, item manipulation.
- **Spatial Relations**: `in`, `on`, `under`, `behind`. `SceneSpatialValidator` enforces topology rules вЂ” no recursive containment, correct relation semantics per container type.
- **`ActorWorldQuery`**: Read-only spatial queries (visibility, reachability, containment lookups) shared by the NPC and parser world model builders.

---

## 5. Entities & Components

### 5.1 Entity Hierarchy

```
SceneObject (base)
в”њв”Ђв”Ђ Entity           в†ђ most scene objects; Transform + Visuals + Parallax
в”‚   в”њв”Ђв”Ђ Actor        в†ђ Entity + pathfinding + animation sets + NPC component
в”‚   в”њв”Ђв”Ђ QuadObject   в†ђ Perspective polygon (walls, floors)
в”‚   в”њв”Ђв”Ђ Walkbox      в†ђ Floor polygon
в”‚   в”њв”Ђв”Ђ Triggerbox   в†ђ Overlap trigger zone
в”‚   в””в”Ђв”Ђ Folder       в†ђ Logical group
в””в”Ђв”Ђ ...
```

### 5.2 Component Architecture

`ComponentSystem` uses a strict `AnyComponent` discriminated union (no `any[]`), eliminating runtime type errors. Components are serialised as part of the entity's JSON.

Standard components: `State`, `Switch`, `Subscene`, `InventoryContainer`, `Exit`, `TriggerBox`, `NPC`.

---

## 6. Editor Architecture

### 6.1 UI Structure

- **Technology**: React + Zustand; CSS custom properties design system (retro green palette).
- **Main panels**: `HierarchyPanel` (reactive scene tree), `PropertiesPanel` (two-way binding to engine state), `SpriteEditor`.
- **Tools**: Object locking (`Alt+L`), grid and entity-corner snapping, walkbox/triggerbox polygon painting.

### 6.2 Dynamic Tooltip System

Centralized tooltip injection in `PropertiesPanel`:

- **Registry**: All field tooltips defined in `propertiesConstants.ts` в†’ `PROPERTIES_LABEL_TOOLTIPS`.
- **Injection**: Side-effect scans `label.e-label` elements and injects `title` attributes by matching text content.
- **Convention**: Add to the registry, never hardcode `title` in specific property components.
- **Helper**: `normalizeTooltipLabelText` strips prefixes like "Mode:" for fuzzy matching.

### 6.3 Standard Buttons & Hotkey Styling (`.e-btn`)

- Convex 3D bevel: `box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 3px rgba(0,0,0,0.6)`
- Muted border variable: `var(--ui-btn-border-muted, #387d60)`
- Embedded hotkey badges: `<span class="hotkey-accent">[</span>` вЂ” automatically styled dark green inside button, resets to black on `.active-press`
- Keypress feedback: `.active-press` class applied for 150 ms on keyboard trigger

---

## 7. Coding Standards

### 7.1 Serialization

- `fromJSON` / `toJSON` in each class definition вЂ” single source of truth.
- Add property в†’ define field в†’ add to `SERIALIZABLE_PROPS` в†’ add `load(data)` side-effect if needed.

### 7.2 State Management

- **Engine state**: Mutable; modifications check `game.editor.enabled` to trigger UI sync.
- **UI state**: Immutable (React/Zustand); reacts to engine events.

### 7.3 IGame Contract

All services accept `IGame` (interface), not `Game` (class). This is the primary enabler of unit testing without a full engine context вЂ” tests construct minimal `IGame` mocks.

---

## 8. Testing

Tests live in `tests/`, mirroring `src/` structure. Runner: **Vitest 4**.

```bash
npm test              # full suite
npx vitest run tests/npc/    # NPC subsystem only
npx vitest run tests/parser/ # Parser subsystem only
npm run typecheck     # TypeScript type check (no emit)
```

### Test Coverage Areas (41 test files)

| Area | Test files (examples) |
|------|-----------------------|
| Parser + LLM cascade | `llm-cascade`, `llm-parser`, `world-model-context`, `preprocessor` |
| NPC Puppet Master | `puppet-master`, `observed-actor-actions`, `slm-adapters` |
| Semantic API | `semantic-api`, `scene-interaction`, `subscene-*` |
| Inventory | `commands`, `section-script-events` |
| Navigation / Spatial | `navigation-and-spatial`, `actor-movement`, `spatial-index` |
| Component System | `component-system-state`, `state-event-system`, `scene-log` |
| Text Assets | `text-asset-manager`, `section-identity` |
| Scene | `scene-spatial-validator`, `scene-transition`, `scene-parser-history` |
| Audio | `sound-manager` |
| Editor | `vetool`, `scene-editor-object-creation`, `editor-snapping-system` |
| Rendering | `quad-object`, `scene-correctional-scale`, `entity-ref-scale`, `shadow-system` |
| Provider | `ollama-provider`, `nlp-cache` |

---

## 9. Scripting API

The engine supports a hot-reloadable authored scripting system. Scripts are triggered by state changes, TriggerBox overlaps, and scene events.

Full reference: **[ScriptSys.md](ScriptSys.md)**

---

## 10. Native Application Build (Tauri)

### 10.1 Architecture

- **Tauri Shell**: Vite/React project inside a Tauri WebView shell.
- **File System Adapter**: `src/platform/fileApi.ts` вЂ” dynamically switches between Vite dev middleware and Tauri native Rust commands based on `isTauriRuntime()`.
- **File Monitoring**:
  - **Vite**: `chokidar` watcher в†’ WebSocket (`import.meta.hot.on('file-event')`)
  - **Tauri**: Rust `notify` crate в†’ `@tauri-apps/api/event`
  - Both pipelines converge in `FileEventEmitter`; subscribed via `useFileWatcher` hook.
- **Rust Backend**: `src-tauri/` implements file management and native OS Explorer commands.

### 10.2 Path Resolution & Portability

In release builds, `src-tauri/src/main.rs` uses `std::env::current_exe()` (not `CARGO_MANIFEST_DIR`) for path resolution вЂ” ensures the packaged app reads/writes relative to the `.exe` location.

### 10.3 Windows Build

- **Icon**: `tauri.conf.json` must declare `"icon": ["icons/icon.ico"]` in `bundle`; omitting causes `failed to bundle project`.
- **Artifacts**: `src-tauri\target\release\bundle\` вЂ” `.msi` and `.exe` (NSIS).

### 10.4 Build Commands

```bash
# Development with Tauri shell
npm run tauri:dev

# Production bundle (generates .msi / .exe)
npm run tauri:build
```

### 10.5 Requirements & Limitations

- **Tooling**: Node.js, Rust/Cargo, Tauri CLI (`@tauri-apps/cli ^2.10`).
- **Static Hosting**: Scene and Sprite editor features require a local backend. Non-functional on static web hosts.
- **Workspace Model**: Recommended to adopt an explicit workspace model for robust path handling in packaged player vs. editor builds.

---

## 11. Documentation Index

| Document | Subject |
|----------|---------|
| [`README.md`](README.md) | Quick start, installation, hosting |
| [`GDD.md`](GDD.md) | Game Design Document вЂ” source of truth for gameplay |
| [`tech-spec.md`](tech-spec.md) | **This file** вЂ” technical architecture reference |
| [`docs/npc-pm-slm.md`](docs/npc-pm-slm.md) | Hybrid SLM subsystem вЂ” architecture, adapters, training pipeline |
| [`Parser.md`](Parser.md) | Parser system deep dive |
| [`NPCsys.md`](NPCsys.md) | NPC system design |
| [`TextAssets.md`](TextAssets.md) | Text Asset schema and authoring guide |
| [`ScriptSys.md`](ScriptSys.md) | Scripting API reference |
| [`InventorySys.md`](InventorySys.md) | Inventory system |
| [`SpatialSys.md`](SpatialSys.md) | Spatial relation system |
| [`SoundSys.md`](SoundSys.md) | Audio system |
| [`Commands.md`](Commands.md) | Authored parser command format |
| [`Autotests.md`](Autotests.md) | Autotest harness and coverage |
| [`Sessions.md`](Sessions.md) | Development session log |
| [`Tauri.md`](Tauri.md) | Tauri build notes |

