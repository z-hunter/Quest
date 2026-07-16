---
type: implementation
system: audio
---

# AudioManager и SoundManager

## Core bridge

`src/core/AudioManager.ts` — thin Game-facing sound entrypoint. `src/systems/SoundManager.ts` — singleton Web Audio implementation with AudioContext, buffer caches, active playback nodes and master gain.

## Scene environment

`SceneSoundEnv` fields: `audioMaxDistance`, `reverbMaxDist`, `reverbMinPercent`, `zoomSensitivity`, panner ref/rolloff, `panningModel` (`HRTF|equalpower`), `distanceModel` (`linear|inverse|exponential`) and optional default reverb IR. Environment is sanitized before applying to active nodes.

## Playback graph

```text
AudioBufferSource
  → main Gain
  → Panner (optional position)
  → dry branch
  → Convolver/reverb wet branch
  → Delay/wet feedback branch
  → master gain → AudioContext destination
```

Public API: `init`, `unlock`, `loadSound`, `loadReverbIR`, `setEnvironment`, `play`, `attachSound`, `updateAttachedSounds`, `setPosition`, `setVolume`, `setAttachedVolume`, `setMasterVolume`, `stop`, `stopAll`, proximity EQ/effects methods.

Attached sounds follow entity position/parallax; scene zoom/environment updates panner/effect parameters without replacing playback identity.

Связанные: [[Dependencies-and-Platform]], [[Runtime-and-Rendering]], [[Scene-Schema]].
