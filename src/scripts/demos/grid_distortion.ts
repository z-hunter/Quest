import { ScriptRegistry } from '../../core/ScriptRegistry';

/**
 * Grid Distortion Script
 *
 * Applies dynamic "dent" and "bump" distortions to a 6x6 grid of Quads (q1-1 to q6-6).
 * Usage: RUN grid_distortion
 */
ScriptRegistry.register('grid_distortion', ({ api, args: _args }) => {
  api.log('Starting Grid Distortion...');

  const gridSize = 6;
  const quads: { id: string; quad: any; baseVertices: { x: number; y: number }[] }[] = [];

  // 1. Capture initial state
  for (let x = 1; x <= gridSize; x++) {
    for (let y = 1; y <= gridSize; y++) {
      const id = `q${x}-${y}`;
      const quad = api.getQuad(id);
      if (quad) {
        // Store base positions
        const baseVertices = (quad as any).vertices.map((v: any) => ({ x: v.x, y: v.y }));
        quads.push({ id, quad, baseVertices });
      }
    }
  }

  if (quads.length === 0) {
    api.log('No quads found (expected q1-1 to q6-6). Is the scene loaded?');
    return;
  }

  api.log(`Found ${quads.length} quads. Starting animation loop.`);

  // Distortion State
  interface Dent {
    x: number;
    y: number;
    radius: number;
    strength: number; // Positive = Expand (Bump), Negative = Contract (Dent)
    life: number;
    maxLife: number;
  }

  const dents: Dent[] = [];
  const maxDents = 5;

  // Bounds for spawning dents (approximate based on grid)
  // We can start with a rough guess or calculate bounding box of all quads
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  quads.forEach((q) => {
    q.baseVertices.forEach((v) => {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    });
  });

  // Animation Loop
  api.setInterval(() => {
    // 1. Manage Dents
    // Remove dead dents
    for (let i = dents.length - 1; i >= 0; i--) {
      dents[i].life--;
      if (dents[i].life <= 0) {
        dents.splice(i, 1);
      }
    }

    // Spawn new dent if needed
    if (dents.length < maxDents && Math.random() < 0.05) {
      dents.push({
        x: minX + Math.random() * (maxX - minX),
        y: minY + Math.random() * (maxY - minY),
        radius: 100 + Math.random() * 150,
        strength: (Math.random() < 0.5 ? -1 : 1) * (20 + Math.random() * 30), // Push/Pull amount
        life: 100,
        maxLife: 100,
      });
    }

    // 2. Apply Distortions
    quads.forEach(({ quad, baseVertices }) => {
      baseVertices.forEach((baseV, vIdx) => {
        let offsetX = 0;
        let offsetY = 0;

        dents.forEach((dent) => {
          const dx = baseV.x - dent.x;
          const dy = baseV.y - dent.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < dent.radius) {
            // Normalized distance (0 at center, 1 at edge)
            const t = dist / dent.radius;

            // Easing: Smooth bell curve or sine
            // Sin(t * PI) gives 0 at ends, 1 at center? No, cos.
            // Let's use (1 - t) * (1 - t) for falloff
            // const falloff = (1 - t) * (1 - t);
            const falloff = Math.pow(Math.cos((t * Math.PI) / 2), 2);

            // Lifecycle fade in/out
            const ageRatio = dent.life / dent.maxLife;
            const lifeFade = Math.sin(ageRatio * Math.PI); // Smooth fade in/out

            const force = dent.strength * falloff * lifeFade;

            // Direction: Vector from dent center to vertex
            // If strength > 0 (Bump/Expand), push away.
            // If strength < 0 (Dent/Pinch), pull towards.
            if (dist > 0.1) {
              // Avoid div by zero
              const dirX = dx / dist;
              const dirY = dy / dist;
              offsetX += dirX * force;
              offsetY += dirY * force;
            }
          }
        });

        // Apply
        // Note: setVertex might return false if bound, but in this version it propagates changes.
        // However, if we update V1 (bound to V2), V2 updates.
        // Then we update V2.
        // To avoid double processing or fighting, strict way is to only update if not bound or if "master".
        // But simplified: just setting everything to its target calculation is usually stable for this kind of "field" function.
        quad.setVertex(vIdx, baseV.x + offsetX, baseV.y + offsetY);
      });
    });
  }, 16); // ~60fps

  api.log('Grid Distortion running.');
});
