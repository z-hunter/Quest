# Commands

## Summary

`Commands` in `Scanline` are authored action specifications that describe **custom gameplay commands** without hardcoding one-off logic into `Parser.ts`.

The goal is to let us add commands such as:
- `TELEPORT WITH ID CARD`
- `UNLOCK DOOR WITH KEY`
- `REPAIR BOOMBOX WITH SOLDERING IRON`
- `USE ITEM ON TARGET`

while reusing the same generic parser and runtime systems for:
- target resolution
- ambiguity clarification
- missing-argument clarification
- no-effect handling
- linear plan execution in `Parser Core`

This document describes the first draft of the **custom command asset format** and how it maps into the parser architecture.

---

## Why Custom Command Assets Exist

Many story-specific commands are not generic enough to justify new built-in parser verbs, but they still need:
- natural language recognition
- reusable clarification behavior
- structured execution
- optional custom text

If each of these is implemented as a custom branch in `Parser.ts`, the parser becomes hard to maintain.

Instead:
- the parser provides the shared machinery
- each custom command is described by data
- `Parser Core` executes a generic plan

This is also the shared execution foundation for the LLM cascade and other actor-aware clients:
- lower layers, custom commands, mocked scenarios, NPC Puppet Master plans, and LLM outputs can emit the same plan format
- parser-produced plans still execute through `Parser Core`, while non-parser actor plans use the shared actor-aware executor instead of going through text parsing again

---

## Position In The Architecture

Custom command assets are authored content, not hardcoded `Game` logic. Their execution is shared runtime behavior, even when the initiating client is the parser.

They are:
- language-aware
- target-aware
- clarification-aware
- plan-oriented

They are not:
- runtime world logic
- arbitrary scripts
- direct `Game API` calls

The flow is:

1. Player input arrives
2. Stage 1 tries built-in parser logic
3. Stage 1 also checks custom command assets
4. A matching command asset produces a parser envelope / plan
5. `Parser Core` resolves arguments and executes the plan for parser-originated input
6. `Game API` / shared actor-aware runtime performs the actual world operations

---

## Built-In Group Syntax

Direct group syntax for standard commands is implemented in the built-in parser flow, not in custom command assets.

Currently this applies to standard `TAKE` and `PUT`:

```text
take all cassettes
take both cassettes
take blue and red pills
take blue pill and red pill
put all cassettes into recorder
put blue and red pills in box
```

The behavior is equivalent to resolving an ambiguity clarification and answering with multiple source items, but without asking the intermediate question.

Important rules:
- group syntax selects **source items**, not multiple destinations;
- source selection and clarification use actionable source scopes (`takable` for `TAKE`, `held + putSource` for `PUT`), not all visible/known objects;
- group input expands into a linear parser plan of ordinary `takeTarget` / `putTarget` actions;
- execution remains stop-on-error through `Parser Core`;
- `all` selects every matching source item in the command's normal source scope;
- `both` is valid only when exactly two source items match;
- list forms use comma / `and`;
- shared-head list forms such as `blue and red pills` expand to `blue pills` and `red pills`;
- simple trailing-`s` plural matching is supported for group source matching only.

For `PUT`, target resolution has priority:
- the destination is validated before source fallback or source clarification;
- unknown destinations such as `recirder` fail as target-not-found;
- source items already stored in the selected destination are filtered out before building the batch.
- relation targets such as `PUT cassette UNDER chair` resolve only to an existing `Inventory`/`Surface` slot for that relation; parser/runtime checks must not auto-create missing containers.
- `floor`/`ground` can resolve to a Walkbox pseudo-floor target for `PUT`/`DROP`, including `PUT item ON FLOOR` and `PUT item IN FLOOR`.
- For `LOOK floor` / `EXAMINE floor`, the parser first tries the current Walkbox pseudo-floor under the player, but only if it has the needed text field (`description` for `LOOK`, `details` for `EXAMINE`). Otherwise it falls back to a real visible/held object titled or synonymed `Floor`, then to `parser.look_default_object`.
- for untitled technical storage nodes, the relation to the player-facing target is the first spatial relation from the nearest titled parent to that technical chain. A Surface inside an untitled `UNDER` child of `Chair` is therefore treated as `UNDER chair`, even if the Surface's internal placement relation is `ON`.
- visible but currently unusable source items are reserved for diagnostics, not clarification. For example, a far cassette can produce a distance-specific failure, but it must not be offered as a selectable source option when a usable cassette is available.

Custom command assets do not currently declare group syntax. They should continue to use normal argument resolution and pending clarification until the command asset format explicitly grows a group-argument feature.

---

## Guiding Principles

1. Custom commands should be described by **data**, not ad-hoc parser code.
2. Clarification rules should stay **generic** whenever possible.
3. The command system should reuse:
   - `ParserWorldModel`
   - scope slices
   - pending clarification
   - unified envelope
   - `Parser Core`
4. Command-specific messages should be **overrides**, not separate parser logic.
5. Plans should remain **linear and constrained** in the first version.
6. Multi-argument commands should be expressed through the same generic machinery, not special parser branches.
7. Words like `with`, `on`, `to`, `in`, `under` should usually be treated as grammar hints for binding arguments or relations, not as standalone commands.

This now has a concrete parser-side consequence:
- built-in `LOOK` / `EXAMINE` can already recognize relation markers such as `under`, `in`, `behind`, `near`;
- custom commands keep using the same idea through grammar markers like `separatorsBefore`;
- full execution of relation semantics still depends on future runtime scene-relation data.

---

## Command Asset Location

Proposed location:

- `public/text/system/commands/<command_id>.json`

Examples:
- `public/text/system/commands/teleport_with.json`
- `public/text/system/commands/unlock_with.json`

These files are parser text assets, similar in spirit to:
- `public/text/system/parser.json`
- `public/text/system/parser-lexicon.json`
- `public/text/system/parser-training.json`

---

## First-Draft Command Asset Format

Example:

```json
{
  "id": "teleport_with",
  "phrases": ["teleport with", "teleport"],
  "arguments": [
    {
      "name": "item",
      "kind": "entity",
      "required": true,
      "scopes": ["held", "takable"],
      "validation": {
        "allowedTitles": ["your ID card"]
      },
      "messages": {
        "missing": "Teleport with what?",
        "ambiguous": "Which item do you want to teleport with: {options}?",
        "notFound": "You don't have anything like that.",
        "noEffect": "That doesn't work."
      }
    }
  ],
  "plan": [
    { "type": "resolveArgumentEntity", "arg": "item", "saveAs": "teleport_item" },
    { "type": "ensureHeldEntity", "ref": "teleport_item", "noEffectMessageId": "no_effect" },
    { "type": "goToSceneById", "sceneId": "test1" },
    { "type": "removeInventoryEntity", "ref": "teleport_item" },
    { "type": "showText", "messageId": "success" }
  ],
  "messages": {
    "success": "You vanish in a flash and arrive somewhere else."
  }
}
```

---

## Field Reference

### `id`

Unique command id.

Example:

```json
"id": "teleport_with"
```

Used for:
- debugging
- command registry
- future analytics / tracing

### `phrases`

List of trigger phrases recognized by lower parser layers.

Example:

```json
"phrases": ["teleport with"]
```

Notes:
- first draft should keep this simple
- exact phrase matching is enough for v1
- later this can evolve into richer grammar or language-pack integration
- in most cases, `phrases` should represent the verb-level command (`use`, `unlock`, `teleport`), while prepositions like `with` or `on` are handled by argument grammar

### `arguments`

Describes the arguments required by the command.

Example:

```json
{
  "name": "item",
  "kind": "entity",
  "required": true,
  "scopes": ["held", "takable"]
}
```

First-draft fields:
- `name`
- `kind`
- `required`
- `scopes`
- optional `validation`
- optional `messages`

For v1 we only need:
- `kind: "entity"`

### `validation`

Optional command-specific acceptance rules that run **after normal parser resolution**.

This is important:
- resolution and ambiguity should remain generic
- command validation should decide whether the resolved object is valid for this command

Example:

```json
"validation": {
  "allowedTitles": ["your ID card"]
}
```

First-draft validation fields:
- `allowedEntityIds`
- `allowedTitles`
- `allowedSynonyms`

If validation fails, parser should use the command-specific `noEffect` message when available, or fall back to the standard parser no-effect message.

### `plan`

Linear list of parser-planned actions.

This is the core of the command asset.

The plan is:
- declarative
- validated by `Parser Core`
- executed one step at a time

No arbitrary code is allowed here.

### `messages`

Optional command-specific message overrides.

These should be used only when generic parser messages are not enough.

The parser should still have shared defaults for:
- missing argument
- ambiguity
- target not found
- no effect
- generic failure

---

## Standard vs Custom Messages

The command system should not require every command to reinvent the same UX.

The parser should provide generic standard flows for:

- missing argument
- ambiguous target
- target not found
- no effect
- generic failure

Examples of generic messages:
- `Use what?`
- `Which item do you mean: ...?`
- `You don't see any ... here.`
- `That doesn't work.`
- `Nothing happens.`

Command assets may override those when the scene needs more specific flavour text.

This keeps parser UX consistent while still allowing authored exceptions.

---

## Relationship To Pending Clarification

Custom commands should reuse the same pending clarification machinery as built-in commands.

That means:
- if an argument is missing, parser asks a question
- if multiple candidates match, parser asks which one
- the next input can continue the same command

This is important:
- we should not build a second clarification system just for custom commands
- clarification may happen for any individual argument in a multi-argument command

---

## Relationship To Scope

Argument resolution should always happen through parser scope.

Example:

```json
"scopes": ["held", "takable"]
```

This means:
- the parser may look in inventory
- then among takeable scene objects

The command asset does not bypass scope rules.
It only says which scope slices are legal for that argument.

### Multi-Argument Commands

Commands may declare more than one argument.

Important distinction:
- the **command** is usually the verb or verb phrase (`use`, `unlock`, `teleport`)
- words like `with`, `on`, `to`, `in`, `under` are usually **argument-binding markers**
- they help parser assign roles to arguments, but they are not usually separate commands in themselves

For v1, arguments after the first may define `separatorsBefore`, for example:

```json
{
  "name": "target",
  "kind": "entity",
  "required": true,
  "scopes": ["visible", "held", "examinable"],
  "separatorsBefore": ["on"]
}
```

With this, input like:

```text
use key on door
```

is parsed as:
- `item = key`
- `target = door`

So for parser architecture purposes, `USE` is the command, while `ON` is a grammar hint that introduces the next argument.

If the separator is missing:
- earlier arguments keep the remaining text they can claim
- later required arguments may remain unresolved
- the usual parser clarification flow asks for the missing argument

---

## Relationship To DSL

Custom command assets are one of the producers of the unified parser DSL.

They are not a separate execution system.

Built-in commands and LLM outputs converge on the same general model:
- envelope
- plan
- `Parser Core`
- structured outcomes

This is why `TELEPORT WITH` is useful as a test scenario:
- it exercises a richer plan
- without needing a live LLM provider during deterministic tests

---

## First-Draft Planned Actions Needed For `TELEPORT WITH`

To support the first realistic custom command scenario, the first DSL expansion should include:

```ts
type ParserPlannedAction =
  | { type: 'resolveArgumentEntity'; arg: string; saveAs: string }
  | { type: 'ensureHeldEntity'; ref: string }
  | { type: 'goToSceneById'; sceneId: string }
  | { type: 'removeInventoryEntity'; ref: string }
  | {
      type: 'showText';
      textKey?: string;
      messageId?: string;
      params?: Record<string, string>;
      paramsFromRefs?: Record<string, string>;
    };
```

These actions are intentionally generic.

They are useful not only for teleportation, but later for:
- unlocking
- repairing
- giving
- consuming
- scripted inventory-driven actions

`paramsFromRefs` allows `showText` to interpolate values from resolved plan state.

Example:

```json
{
  "type": "showText",
  "messageId": "no_effect_pair",
  "paramsFromRefs": {
    "item": "use_item",
    "target": "use_target"
  }
}
```

---

## Plan State

To support command plans, `Parser Core` needs a small plan-state dictionary.

Example:

```ts
type ParserPlanState = Record<string, unknown>;
```

Use:
- `saveAs` writes into plan state
- later actions use `ref` to read from it

Example:
- resolve `item` and save as `teleport_item`
- later remove `teleport_item` from inventory

---

## Required Shared Game API Support

For the first real custom command plan, the shared `Game API` will likely need:

- `removeInventoryEntity(entity)`

This is not specific to teleportation.
It will also be useful for:
- consuming items
- giving items away
- one-use puzzle items
- future `use X on Y` flows

This should live in shared gameplay API, not inside parser-only logic.

---

## First Example: `TELEPORT WITH`

Planned parser behavior:

Input:

```text
teleport with id card
```

Expected flow:

1. Match custom command spec `teleport_with`
2. Resolve `item` inside `held + takable`
3. If missing:
   - ask `Teleport with what?`
4. If ambiguous:
   - ask which item
5. If the resolved item is not valid for this command:
   - report generic or command-specific no-effect
6. If found in scene but not held:
   - try to pick it up
7. If item still unavailable:
   - report failure
8. If item is available:
   - go to scene `test1`
   - remove item from inventory
   - show success message

This gives us a realistic multi-step scenario while still using the lower cascade.

---

## Second Example: `USE X ON Y`

This is the first generic multi-argument command supported by the current system.

Example command asset shape:

```json
{
  "id": "use_on",
  "phrases": ["use"],
  "arguments": [
    {
      "name": "item",
      "kind": "entity",
      "required": true,
      "scopes": ["held", "takable"]
    },
    {
      "name": "target",
      "kind": "entity",
      "required": true,
      "scopes": ["visible", "held", "examinable"],
      "separatorsBefore": ["on"]
    }
  ],
  "plan": [
    { "type": "resolveArgumentEntity", "arg": "item", "saveAs": "use_item" },
    { "type": "ensureHeldEntity", "ref": "use_item" },
    { "type": "resolveArgumentEntity", "arg": "target", "saveAs": "use_target" },
    {
      "type": "showText",
      "messageId": "no_effect_pair",
      "paramsFromRefs": {
        "item": "use_item",
        "target": "use_target"
      }
    }
  ]
}
```

This command is useful as a parser-system milestone because it exercises:
- multi-argument parsing
- per-argument clarification
- shared scope rules
- plan-state reuse
- dynamic final messaging from resolved refs

---

## Implementation Order

1. Add command-spec types
2. Add command asset loading to parser text layer
3. Extend parser DSL and plan state
4. Add shared API support such as `removeInventoryEntity(...)`
5. Add custom command matching in stage1
6. Implement `teleport_with.json`
7. Run smoke tests

---

## Future Expansion

Later, command assets may grow to support:
- multiple arguments
- typed targets like `entity`, `scene`, `inventory-item`
- richer scope policies
- optional conditions
- richer message overrides
- richer LLM-generated plans that still reuse the same execution model

But the first version should stay deliberately small and stable.
