# Current Task: CRT Shader Pipeline & Anti-Moiré Pixel Reconstruction

## Status: COMPLETED ✅

## Summary of the Implementation
- **Sinc-Fourier Scanlines**:
  - Implemented continuous analytical integration of Fourier harmonics with Sinc factors ($\text{sinc}(k\pi w)$ over $w = \text{fwidth}(pos)$) and Timothy Lottes phase jitter, completely eliminating 3-4-3-4 px quantization jumps on non-integer scaling.
- **Beam Spot Modulation**:
  - Dynamically widens electron beam spot on bright highlights, preserving crisp scanline valleys in dark shadows.
  - Linked to UI with dynamic hiding when `scanlineCount = 0` and zero-cost GPU bypass.
- **Screen Glow Pipeline Order**:
  - Moved front-faceplate glass diffuse scatter to execute **after** scanlines with Screen blend and 35% desaturation.
- **60 Hz AC Hum Bar**:
  - Emulated analog power ripple using dual video gain modulation and black pedestal cathode shift.
- **High-Voltage Anode Breathing (Raster Bloom)**:
  - Decoupled physical bezel/glass geometry from dynamic electron raster scaling with RC exponential decay ($\sim 80\text{ms}$).
- **Anti-Moiré 2D Pixel Reconstruction**:
  - Continuous bandlimited area box-filter integration (`getSmoothUV`) preserving 100% sharp pixel colors without moiré or bilinear blur. Added settings toggle.
- **WebGL Layout Sync & Slider Dragging Fix**:
  - Synchronized canvas backbuffer geometry on Game $\leftrightarrow$ Editor switch.
  - Fixed HTML5 `stepMismatch` locking on Bloom and CRT range sliders.

## Verification
- `npm run typecheck`: Passed with 0 errors.
- `vitest`: All 876 tests passed.

