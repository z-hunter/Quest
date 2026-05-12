# Sound System Architecture (SoundSys.md)

## Overview

The Scanline Engine uses a custom `SoundManager` built on top of the browser's native **Web Audio API**. It supports 3D spatial audio (HRTF), convolution reverb, distance-based equalization (proximity effect), and dynamic zoom scaling mapped to 2.5D parallax layers.

All audio routing is fully scriptable via the `ScriptAPI`, allowing in-game logic to dynamically spawn sounds, attach them to moving entities, and crossfade DSP effects.

## 2.5D Spatial Mathematics

Because Scanline is a 2.5D engine, mapping 2D objects to a 3D audio space requires a specialized coordinate system:

1. **The Listener (Camera):** The listener is permanently fixed at `Z = 0`. It looks "into" the screen along the negative Z-axis (`-Z`).
2. **Object Depth (Z):** An object's Z-depth is mapped non-linearly from its `parallax` property. We use a very shallow depth scale (factor 1000) to ensure that parallax alone doesn't overwhelm the mix:
   - `parallax = 1.1`: The object is located at `Z = 0` (Head level).
   - `parallax = 1.0`: The object is located at `Z = -100`.
   - `parallax = 0.0`: The object is located at `Z = -10000` (Max infinity).
   - `parallax = -2.0`: The object is located at `Z = 10000` (Behind).
3. **Camera Zoom:** Zooming interacts with audio distance differently depending on the direction:
   - **Zooming In (> 1.0):** Uses a parallax-weighted division (`Z = Z / effectiveZoom`) to pull foreground objects smoothly toward the camera without crossing the lens, naturally widening panning angles.
   - **Zooming Out (< 1.0):** Uses an additive push to send objects backward. This push follows a steep quartic curve (`extraZ = (1.0 - zoom)^4 * MaxDistance`). This ensures the volume remains completely stable in the primary gameplay zone (zoom 1.0 to 0.5), and only fades significantly when pulling back for a wide overview (zoom < 0.5). Combined with the `linear` distance model, the fade out is gentle and ends at an audible 30% volume.
   - At `parallax 0` (infinity), zoom has zero effect on the sound's volume or panning, anchoring the background perfectly.

## Audio Routing Graph

When a 3D sound is played, it creates a dedicated signal chain:
`BufferSource -> ProximityEQ (BiquadFilter) -> PannerNode (HRTF)`

From the PannerNode, the signal splits:
- **Dry Path:** `-> DryGain -> MasterGain`
- **Reverb Path:** `-> ConvolverNode -> ReverbWetGain -> MasterGain`
- **Delay Path:** `-> DelayNode -> DelayWetGain -> MasterGain`

## Proximity Effect (EQ & Reverb Scaling)

When `useProximityEQ: true` is enabled, the spatial relationship between the camera and the object drives a dynamic mixer:

### 1. Bass Boost (Proximity EQ)
The system applies a +6dB boost at 250Hz, but only when the source is extremely close to the listener's perceived "head":
- **Parallax Rule:** Peak boost (+6dB) at `parallax 1.1`. The effect fades to 0dB as parallax moves toward `0.9` or `1.2`.
- **X/Y Distance Rule:** The effect fades to 0dB if the screen distance between the camera and the object exceeds **100 pixels**.
- **Zoom Influence:** Screen distance is calculated as `World Distance * Camera Zoom`. Zooming in makes the proximity zone tighter in world units, while zooming out makes it larger.

### 2. Reverb & Dry Scaling
Atmospheric depth is controlled by the **Total 3D Distance** (including Z):
- **Close Distance:** Reverb is ducked to roughly 20% of its base amount, and the dry signal is kept at 80%. The sound feels "inside your head" with wide stereo.
- **Far Distance (e.g. Parallax 0):** The dry signal fades out entirely (0%), and the reverb wet multiplier increases to 100%. The sound becomes mono and gets "swallowed" by the room acoustics.
- **Scaling:** Uses an exponential curve (power of 1.5) to keep the sound drier for a wider radius before reverb takes over.

---

## Script API Reference

### 1. Loading Assets
```typescript
// Load a regular audio file
await api.loadSound('door_creak', '/sounds/door_creak.mp3');

// Load an Impulse Response (IR) file for the Convolution Reverb
await api.loadReverbIR('/sounds/ir/room_drum.wav');
```

### 2. Playing Sounds
```typescript
// Play a basic 2D sound (UI, background music, narrator)
const handle = api.playSound('ui_click', {
    volume: 0.8,
    loop: false
});

// Play a 3D sound attached to an entity
const handle3D = api.playSoundAttached('door_creak', 'Entity_Door_1', {
    volume: 1.0,
    useProximityEQ: true, // Enables distance-based EQ and reverb scaling
    reverbAmount: 0.5,    // Base reverb mix (0.0 to 1.0)
    delayAmount: 0.0      // Echo mix
});
```

### 3. Managing Playback
```typescript
// Dynamically change effects while the sound is playing
api.setSoundEffects(handle3D, { reverbAmount: 0.8, delayAmount: 0.2 });

// Stop the sound manually
api.stopSound(handle3D);
```

---

## Usage Examples

### Example 1: Spatial Reverb Room
```typescript
// This script runs when entering a large hall.
export async function main(api: any) {
    // 1. Load the impulse response for a large hall
    await api.loadReverbIR('/sounds/ir/large_hall.wav');
    await api.loadSound('ghost_whisper', '/sounds/whisper.wav');

    // 2. Play the sound attached to a ghost entity roaming the room
    const ghostSound = api.playSoundAttached('ghost_whisper', 'Ghost_NPC', {
        loop: true,
        reverbAmount: 0.8, // Heavy base reverb
        useProximityEQ: true
    });

    // As the ghost moves away, the ProximityEQ automatically makes it sound 
    // more muffled and drowns it in the large_hall reverb.
}
```

### Example 2: "In Your Head" Voice
```typescript
export async function main(api: any) {
    // By attaching a sound to an entity with Parallax = 0 (e.g. the camera or a UI element),
    // the distance to the listener is 0. 
    // The proximity effect will maximize bass and remove all room reverb.
    
    api.playSoundAttached('telepathic_voice', 'CameraTarget_Entity', {
        useProximityEQ: true,
        reverbAmount: 1.0 // This will be ducked drastically because the distance is 0!
    });
}
```

### Example 3: Echoing Footsteps
```typescript
export async function main(api: any) {
    // Play a footstep with a slight slapback delay
    api.playSoundAttached('footstep_stone', 'Player', {
        delayAmount: 0.3,    // 30% echo volume
        delayTime: 0.15,     // 150ms delay
        delayFeedback: 0.2   // Short feedback loop
    });
}
```
