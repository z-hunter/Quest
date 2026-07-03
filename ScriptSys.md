# Scripting System Guide

The Scanline Engine supports a hot-reloadable scripting system for gameplay logic and debug tools. This guide covers the basics of creating scripts, attaching them to objects, and using the API.

## Chapter 1: How to Create Your First Script

In this tutorial, we will create a simple script that moves an actor when a player steps on a trigger.

### 1.1 Create the Script File

Scripts are written in TypeScript and placed in the `src/scripts/` directory. They are automatically loaded at startup.

Create a new file called `my_first_script.ts` in `src/scripts/`:

```typescript
import { ScriptRegistry } from '../core/ScriptRegistry';

// Register the script with a unique ID ('my_first_script')
ScriptRegistry.register('my_first_script', ({ api }) => {
  api.log('Trigger activated! Moving the hero...');

  // Get the actor named 'hero'
  const hero = api.getActor('hero');
  
  if (hero) {
    // Make the hero walk to a specific coordinate
    hero.walkTo(200, 150);
  } else {
    api.log('Hero not found!');
  }
});
```

### 1.2 Attach the Script in the Editor

Now that the script is registered, you need to attach it to an object in your scene so it can be executed.

1. Open the **Scene Editor** (press `F1` in-game).
2. Create or select a **TriggerBox** object in the Hierarchy Panel.
3. In the Properties Panel for the TriggerBox, find the **script** property.
4. Enter `my_first_script` (the exact ID you used in `ScriptRegistry.register`).
5. Save the scene.

### 1.3 Test the Script

1. Return to the game view.
2. Walk the hero into the TriggerBox.
3. The console will display *"Trigger activated! Moving the hero..."* and the hero will automatically walk to coordinates (200, 150).

> **Tip:** You can also test the script manually without a TriggerBox by opening the in-game console (`~`) and typing: `RUN my_first_script`

---

## Chapter 2: API Reference

The `ScriptContext` provides access to the `api` object.

| Method                 | Description                                             |
| :--------------------- | :------------------------------------------------------ |
| `api.log(message)`     | Prints a message to the in-game console.                |
| `api.wait(ms)`         | Async helper that resolves after `ms` game-time milliseconds. Automatically pauses if scene is inactive. |
| `api.makeGlobal()`     | Declares the script as global, meaning its timers will continue ticking regardless of the active scene. |
| `api.getQuad(name)`    | Returns a `QuadObject` by name, or `null`.              |
| `api.getActor(name)`   | Returns an `Actor` instance by name, or `null`.         |
| `api.getEntity(name)`  | Returns a generic `Entity` instance by name, or `null`. |
| `api.saveCheckpoint()` | Saves the current scene state to the Undo History.      |

### 2.1 QuadObject Methods

| Method                            | Description                                                                                                             |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| `quad.setVertex(idx, x?, y?, p?)` | Updates vertex properties. Returns `true` if successful, `false` if bound/invalid. Pass `undefined` to skip a property. |

### 2.2 Entity Properties (Common for all objects)

| Property          | Type      | Description                                                       |
| :---------------- | :-------- | :---------------------------------------------------------------- |
| `x`, `y`          | `number`  | World coordinates. Setters automatically update the Scene Editor. |
| `parallax`        | `number`  | Depth plane factor (1.0 = Default, <1.0 = Far, >1.0 = Near).      |
| `width`, `height` | `number`  | Visual dimensions (scaled by model scale and depth).              |
| `visible`         | `boolean` | Toggles rendering.                                                |
| `opacity`         | `number`  | Alpha value (0.0 to 1.0).                                         |
| `blur`            | `number`  | Blur filter in pixels.                                            |
| `blendMode`       | `string`  | Canvas `globalCompositeOperation` (e.g., 'screen', 'multiply').   |
| `color`           | `string`  | Fill color (used if sprite is missing).                           |

**Methods:**

- `setSprite(filename)`: Changes the object's visual sprite.

### 2.3 Actor Methods (Player & NPC)

| Method              | Description                                                  |
| :------------------ | :----------------------------------------------------------- |
| `walkTo(x, y)`      | Moves the actor to target coordinates, respecting walkboxes. |
| `moveTo(x, y)`      | Teleports or moves the actor linearly (ignores walkboxes).   |
| `stop()`            | Stops current movement and sets state to 'idle'.             |
| `playAnimSet(id)`   | Changes the animation set (e.g., 'dance', 'run').            |
| `setDirection(dir)` | Sets facing direction: 'up', 'down', 'left', 'right'.        |
| `setState(state)`   | Sets actor state (e.g., 'idle', 'walk').                     |

---

---

## Chapter 3: Lifecycles, Scopes, and Async Timing

Scanline Engine handles scripts securely, binding them to the lifecycle of the active scene.

### 3.1 Pausing and Resuming
By default, scripts are **Scene-Bound**. When a script calls `api.setInterval`, `api.setTimeout`, or `await api.wait(1000)`, those timers are ticked by the engine's `update(deltaTime)` loop.
If the player transitions to a different scene, the engine **pauses** the timers for the inactive scene. When the player returns, the timers **resume** perfectly from where they left off.

> **Editor Note:** If you manually reload a scene in the Scene Editor, all scripts bound to that scene are permanently stopped to prevent duplication.

### 3.2 Global Scripts
If you want a script to continue running in the background across all scenes (e.g., a global clock, or ambient system), declare it as global at the start of your script:

```typescript
ScriptRegistry.register('my_global_clock', ({ api }) => {
  api.makeGlobal(); // Now this script ticks regardless of the active scene

  api.setInterval(() => {
    // This runs every 1000ms, everywhere
  }, 1000);
});
```

### 3.3 Async/Await and Native Promises
You can use `async/await` in your scripts in combination with `api.wait()`.

```typescript
ScriptRegistry.register('cutscene', async ({ api }) => {
  const hero = api.getActor('hero');
  hero.walkTo(100, 100);
  await api.wait(2000); // Wait 2 seconds (in game time)
  hero.playAnimSet('dance');
});
```

> [!WARNING]
> **Native Promise Limitations**
> The engine can only pause its own timers (`api.wait`, `api.setInterval`). If you use native browser mechanisms like `fetch()` or `Promise.all()` over external events, those operations will continue running in the background even if the scene is inactive. Always try to build logic using the `api` methods to guarantee proper pause/resume behavior.

---

## Chapter 4: Debugging & Undo

- **Hot Reload**: Edits to scripts in `src/scripts/` are applied immediately without reloading the page.
- **Granular Undo**: Use `api.saveCheckpoint()` before making changes to allow users to `Undo` script actions step-by-step in the Editor.
